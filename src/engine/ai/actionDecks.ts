import type { AbilityDef, CardDef, UnitDef } from '../types/units';
import type { AiUnitInstance } from '../types/army';
import type { FocusRule, GameState } from '../types/game';
import { CARDS, unitById } from '@data/index';
import { classify, type Profile } from './profiles';
import { availableWeapons } from '../units/weapons';
import type { Rng } from '../rng';

/**
 * Action decks: how the AI plays at a real table. Every unit type has a Movement deck and an Assault deck. The
 * first unit of a type to act in a phase draws a card, and every unit of that type follows it for the rest of the
 * phase. The Combat phase has no deck: engaged units fight as normal.
 *
 * Cards are built from the unit's own profile and abilities. Active abilities are used for free (the AI never pays
 * Biomass, Command Points or Psionic Energy). The AI never reacts: its Reactions are printed on cards as buffs that
 * last until the End of the Round. Passive abilities simply apply. The AI's Faction card boosts ride on the cards
 * that reshuffle the deck.
 */

export type DeckPhase = 'movement' | 'assault';
export type Focus = FocusRule['primary'];
/** Where a move or a run goes. */
export type MoveTo = 'objective' | 'focus' | 'marker' | 'friend' | 'cover';

export type CardStep =
  | { k: 'move'; mod: number; to: MoveTo }
  | { k: 'run'; mod: number; to: MoveTo }
  | { k: 'hold' }
  | { k: 'attack'; hit?: number; roa?: number; focus?: Focus; otherwise: 'run' | 'hold' }
  | { k: 'charge'; bonus?: number; twoDice?: boolean; focus?: Focus; orFire?: boolean; otherwise: 'run' | 'hold' }
  | { k: 'ability'; name: string; text: string; use?: string };

export interface CardBuff { name: string; text: string; source: 'reaction' | 'combat' }

export interface ActionCard {
  id: string;
  defId: string;
  phase: DeckPhase;
  name: string;
  /** Shuffle the whole deck back together at the End of the Round after this card is drawn. */
  shuffle?: boolean;
  steps: CardStep[];
  /** Reactions (and Combat abilities) the unit gets as buffs until the End of the Round when this card is drawn. */
  buffs: CardBuff[];
  /** A Faction card boost the AI uses when this card comes up. */
  boost?: { name: string; text: string; use?: string };
}

export interface DeckState {
  cards: ActionCard[];
  draw: string[];
  discard: string[];
  /** The card showing for this unit type in the current phase. */
  face?: { round: number; phase: DeckPhase; cardId: string };
  /** A reshuffle card was drawn: the deck is shuffled at the next round's start. */
  reshuffle?: boolean;
  /** Once-per-game effects already used from this deck. */
  used?: string[];
}

/** What a drawn card does to its unit for the rest of the phase. */
export interface CardMods {
  cardId: string;
  round: number;
  phase: DeckPhase;
  speed: number;
  hit: number;
  roa: number;
  focus?: Focus;
  twoDiceCharge?: boolean;
  chargeBonus?: number;
}

// ------------------------------------------------------------------------------------------------ rule reminders

/** One line each, printed on the cards and in the AI Rulebook: how the table runs an AI action. */
export const REMINDERS = {
  focus: 'Focus: the nearest enemy unit by the shortest path. Ties: fewest models, then lowest HP, then the players choose.',
  move: 'Move: the leading model goes by the shortest path (round Size 2+ terrain, through grass and scatter), the rest follow in coherency. Never end within 1" of an enemy or in your Zone of Influence.',
  run: 'Run: a move at full Speed in the Assault phase instead of attacking.',
  attack: 'Attack: only models in range and in line of sight of the focus fire. The app rolls the dice.',
  charge: 'Charge: needs a Ground enemy within Speed + 6" of the leading model by path. The app rolls the distance.',
  hold: 'Hold: the unit stays where it is; it still counts as activated.',
  ability: 'Abilities cost the AI nothing: ignore Biomass, Command Points and Psionic Energy.',
  buff: 'Buffs last until the End of the Round. The AI never reacts: these replace its reactions.',
  shuffle: 'Reshuffle: at the start of the next round this deck is shuffled back together.',
  objective: 'Objective: the Mission Marker the app gives the unit; hold it once there.',
} as const;
export type ReminderKey = keyof typeof REMINDERS;

// ------------------------------------------------------------------------------------------------ deck building

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** Abilities the engine plays itself or that the table cannot track: never on a card. */
const SKIP = new Set(['Mode Transformation']);
const summons = (a: AbilityDef) => /\bSUMMON\b/.test(a.text);

/** How the AI aims an ability that asks for a choice, so nobody has to decide for it. */
const AI_USE: Record<string, string> = {
  'Psionic Transfer': 'Shade: 12" toward its objective, as far as it goes.',
  'Force Field': 'Between its focus and the nearest friendly unit.',
  'Solid-Field Projectors': 'Between its focus and the nearest friendly unit.',
  'Guardian Shield': 'Covers the friendly units within 4".',
  'Blink': 'Toward its focus, ending out of engagement range.',
  'Void Blink': 'Toward its focus, ending out of engagement range.',
  'Leaping Strike': 'Toward its focus, ending out of engagement range.',
  'Sentenced to Death': 'Target: its focus.',
  'Void Prison': 'On the enemy unit nearest to it within 8".',
  'Target Lock': 'Target: the enemy unit within 12" with the highest Supply.',
  'Orders': 'The nearest friendly Biological unit within 8" gets CRITICAL HIT (2) on its first weapon this round.',
  'Medpack': 'Heals the most damaged friendly Biological unit within 4".',
  'Optical Flare': 'Target: the enemy unit within 12" with the longest range.',
  'Coordinated Strike': 'Spotter: the friendly unit nearest to the enemy.',
  'Crushing Grip': 'Target: the enemy unit within 12" with the highest Supply that has not activated.',
  'Mutating Carapace': 'Target: the enemy unit within 18" with the most ranged dice.',
  'Domineering Presence': 'On the friendly unit nearest to a Mission Marker.',
  'Corrosive Bile': 'On the enemy models nearest to it, one token per model.',
  'Deep Tunnel': 'Burrow token: 12" toward its objective.',
  'Spawn Creep Tumor': 'Beside the unit, toward its objective.',
  'Burrow': 'Burrows if an enemy is within 12", otherwise surfaces.',
};

/**
 * Who a Faction card boost picks when the AI plays it from a unit's card: the unit holding the card whenever the
 * boost may take it, so nothing is left for the table to choose.
 */
export function boostUse(text: string): string | undefined {
  const body = text.replace(/^Once per Game\.\s*/i, '');
  if (/Faction Indicator|anywhere on the battlefield/i.test(body)) return 'the spot beside this unit.';
  if (/(another|other) Friendly/i.test(body)) return 'the nearest other friendly unit it can take.';
  // A boost that waits for something to happen: the AI never reacts, so it covers this unit for the round.
  if (/^(When|Use before|Use when|If)\b/i.test(body) && /Friendly/i.test(body)) return 'this unit, until the End of the Round.';
  if (/(Select|Target|Choose)[^.]*Friendly/i.test(body) || /a Friendly Unit/i.test(body) || /the active( Biological)? Unit/i.test(body)) return 'this unit.';
  if (/(Select|Target|Choose)[^.]*Enemy/i.test(body)) return 'its focus.';
  return undefined;
}

/** Numbers an ability hands the card: a Speed buff, extra attack dice, a better charge roll. */
function abilityMods(text: string): { speed: number; roa: number; twoDice: boolean; chargeBonus: number } {
  const n = (re: RegExp) => Number(re.exec(text)?.[1] ?? 0);
  return {
    speed: n(/BUFF Speed \((\d+)\)/i) || n(/performs a (\d+)" Move action/i),
    roa: n(/BUFF RoA \((\d+)\)/i),
    twoDice: /roll 2D6 instead of D6/i.test(text),
    chargeBonus: n(/add (\d+) to the Charge Distance/i),
  };
}

function has(def: UnitDef, upgrades: string[], a: AbilityDef): boolean {
  return !a.upgradeCost || upgrades.includes(a.id);
}

type Base = Omit<ActionCard, 'id' | 'defId' | 'phase' | 'buffs'>;

/** The cards every unit of a profile has, whatever its abilities. */
function baseCards(profile: Profile, phase: DeckPhase, ranged: boolean): Base[] {
  if (phase === 'movement') {
    switch (profile) {
      case 'rangedLine':
        return [
          { name: 'Advance', steps: [{ k: 'move', mod: 0, to: 'objective' }] },
          { name: 'Close to Range', steps: [{ k: 'move', mod: 0, to: 'focus' }] },
          { name: 'Take the Ground', steps: [{ k: 'move', mod: 1, to: 'marker' }] },
          { name: 'Dig In', shuffle: true, steps: [{ k: 'move', mod: -2, to: 'cover' }] },
        ];
      case 'meleeRusher':
        return [
          { name: 'Close In', steps: [{ k: 'move', mod: 0, to: 'focus' }] },
          { name: 'Rush', steps: [{ k: 'move', mod: 2, to: 'focus' }] },
          { name: 'Swarm the Objective', steps: [{ k: 'move', mod: 1, to: 'objective' }] },
          { name: 'Lie in Wait', shuffle: true, steps: [{ k: 'move', mod: -2, to: 'cover' }] },
        ];
      case 'brawler':
        return [
          { name: 'Advance', steps: [{ k: 'move', mod: 0, to: 'objective' }] },
          { name: 'Hunt', steps: [{ k: 'move', mod: 1, to: 'focus' }] },
          { name: 'Take the Ground', steps: [{ k: 'move', mod: 0, to: 'marker' }] },
          { name: 'Hold Fast', shuffle: true, steps: [{ k: 'hold' }] },
        ];
      case 'support':
        return [
          { name: 'Stay Close', steps: [{ k: 'move', mod: 0, to: 'friend' }] },
          { name: 'Advance', steps: [{ k: 'move', mod: 0, to: 'objective' }] },
          { name: 'Hang Back', shuffle: true, steps: [{ k: 'move', mod: -1, to: 'cover' }] },
        ];
    }
  }
  switch (profile) {
    case 'rangedLine':
      return [
        { name: 'Open Fire', steps: [{ k: 'attack', otherwise: 'run' }] },
        { name: 'Focus Fire', steps: [{ k: 'attack', focus: 'weakest', hit: 1, otherwise: 'run' }] },
        { name: 'Suppressing Fire', steps: [{ k: 'attack', focus: 'highestSupply', otherwise: 'hold' }] },
        { name: 'Reposition', shuffle: true, steps: [{ k: 'run', mod: 0, to: 'objective' }] },
      ];
    case 'meleeRusher':
      return [
        { name: 'Onslaught', steps: [{ k: 'charge', otherwise: 'run' }] },
        { name: 'Go for the Weak', steps: [{ k: 'charge', focus: 'weakest', otherwise: 'run' }] },
        { name: 'Overrun the Objective', steps: [{ k: 'charge', focus: 'onMarker', otherwise: 'run' }] },
        { name: 'Regroup', shuffle: true, steps: [{ k: 'run', mod: 0, to: 'objective' }] },
      ];
    case 'brawler':
      return [
        { name: 'Onslaught', steps: [{ k: 'charge', orFire: ranged, otherwise: 'run' }] },
        ...(ranged ? [{ name: 'Open Fire', steps: [{ k: 'attack', otherwise: 'run' } as CardStep] }] : []),
        { name: 'Go for the Weak', steps: [{ k: 'charge', focus: 'weakest', orFire: ranged, otherwise: 'run' }] },
        { name: 'Press On', shuffle: true, steps: [{ k: 'run', mod: 0, to: 'objective' }] },
      ];
    case 'support':
      return [
        ...(ranged ? [{ name: 'Covering Fire', steps: [{ k: 'attack', otherwise: 'run' } as CardStep] }] : []),
        { name: 'Stay Close', steps: [{ k: 'run', mod: 0, to: 'friend' }] },
        { name: 'Keep Low', steps: [{ k: 'hold' }] },
        { name: 'Fall In', shuffle: true, steps: [{ k: 'run', mod: 0, to: 'objective' }] },
      ];
  }
}

/** A card for one Active ability: the ability first, then what the unit does anyway. */
function abilityCard(profile: Profile, phase: DeckPhase, a: AbilityDef, ranged: boolean): Base {
  const m = abilityMods(a.text);
  const step: CardStep = { k: 'ability', name: a.name, text: a.text, ...(AI_USE[a.name] ? { use: AI_USE[a.name] } : {}) };
  if (phase === 'movement') {
    // A placement or a hide ends the unit's move; everything else is followed by a move.
    if (/\bPLACE\b|HIDDEN|Burrowed/.test(a.text)) return { name: a.name, steps: [step] };
    const to: MoveTo = profile === 'support' ? 'friend' : profile === 'rangedLine' ? 'objective' : 'focus';
    return { name: a.name, steps: [step, { k: 'move', mod: m.speed, to }] };
  }
  if (m.twoDice || m.chargeBonus) return { name: a.name, steps: [step, { k: 'charge', twoDice: m.twoDice, bonus: m.chargeBonus || undefined, orFire: ranged && profile !== 'meleeRusher', otherwise: 'run' }] };
  if (/IMPACT/.test(a.text)) return { name: a.name, steps: [step, { k: 'charge', otherwise: 'run' }] };
  if (/\bPLACE\b/.test(a.text)) return { name: a.name, steps: [step, ...(ranged ? [{ k: 'attack', otherwise: 'hold' } as CardStep] : [{ k: 'charge', otherwise: 'hold' } as CardStep])] };
  if (ranged) return { name: a.name, steps: [step, { k: 'attack', roa: m.roa || undefined, otherwise: 'run' }] };
  return { name: a.name, steps: [step, { k: 'charge', otherwise: 'run' }] };
}

/** Which deck an ability's card goes in (Any-phase actives are used as the unit moves). */
const deckOf = (a: AbilityDef): DeckPhase | null => (a.phase === 'Movement' || a.phase === 'Any' ? 'movement' : a.phase === 'Assault' ? 'assault' : null);

/**
 * Build one unit type's deck for a phase. `upgrades`: every upgrade any AI unit of this type has, so a card for an
 * upgrade ability is in the deck only when the AI bought it. `faction`: the AI's Faction card, whose boosts ride on
 * the reshuffle cards.
 */
export function buildDeck(def: UnitDef, upgrades: string[], phase: DeckPhase, faction?: CardDef): ActionCard[] {
  const profile = classify(def);
  const ranged = availableWeapons(def, upgrades, 'Assault').some((w) => w.target !== 'Flying' && !w.requiresStatus);
  const actives = def.abilities.filter((a) => a.kind === 'Active' && has(def, upgrades, a) && !SKIP.has(a.name) && !summons(a));
  const cards: Base[] = [...baseCards(profile, phase, ranged)];
  for (const a of actives) if (deckOf(a) === phase) cards.push(abilityCard(profile, phase, a, ranged));
  // Reactions become buffs on the cards of the phase they react in (Any: the Assault deck, where most of them bite);
  // an ability of the Combat phase rides on the Assault cards, ready for the fight that follows.
  const reactions = def.abilities.filter((a) => a.kind === 'Reaction' && has(def, upgrades, a));
  const combatActives = def.abilities.filter((a) => a.kind === 'Active' && a.phase === 'Combat' && has(def, upgrades, a));
  const buffsHere: CardBuff[] = [
    ...reactions.filter((a) => (a.phase === 'Movement' ? 'movement' : 'assault') === phase).map((a) => ({ name: a.name, text: a.text, source: 'reaction' as const })),
    ...(phase === 'assault' ? combatActives.map((a) => ({ name: a.name, text: a.text, source: 'combat' as const })) : []),
  ];
  const ids = new Set<string>();
  const out: ActionCard[] = cards.map((c, i) => {
    let id = `${def.id}:${phase}:${slug(c.name)}`;
    if (ids.has(id)) id += `-${i}`;
    ids.add(id);
    return { ...c, id, defId: def.id, phase, buffs: [] };
  });
  // Each buff is printed on two cards: the first card of the deck and the next one along, never the reshuffle card.
  const plain = out.filter((c) => !c.shuffle);
  buffsHere.forEach((b, i) => {
    for (const c of [plain[i % plain.length], plain[(i + 1) % plain.length]]) if (c && !c.buffs.some((x) => x.name === b.name)) c.buffs.push(b);
  });
  // Faction boosts: the first on the Movement reshuffle card, the second on the Assault one.
  const boost = faction?.boosts?.[phase === 'movement' ? 0 : 1];
  const shuffleCard = out.find((c) => c.shuffle);
  if (boost && shuffleCard) {
    const use = boostUse(boost.text);
    shuffleCard.boost = { name: boost.name, text: boost.text, ...(use ? { use } : {}) };
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ drawing

/** Every game's AI decides from its action decks, unless the game says otherwise. */
export const usesDecks = (state: GameState) => state.config.options.actionDecks !== false;

/**
 * Tabletop, AI only: no map in play and the cards shown as cards. (Before `noMap`, the tabletop edition was the only
 * game that set `actionDecks`.)
 */
export const noMap = (state: GameState) => state.config.options.noMap ?? state.config.options.actionDecks === true;

export const deckKey = (defId: string, phase: DeckPhase) => `${defId}:${phase}`;

/** The upgrades of every AI unit of a type: one deck serves them all. */
function typeUpgrades(state: GameState, defId: string): string[] {
  return [...new Set(state.army.units.filter((u) => u.defId === defId).flatMap((u) => u.upgrades))];
}

function ensureDeck(state: GameState, defId: string, phase: DeckPhase, rng: Rng): DeckState {
  state.aiDecks ??= {};
  const key = deckKey(defId, phase);
  let d = state.aiDecks[key];
  if (!d) {
    // The unit's own race's Faction card: a mixed army carries one for each race it fields.
    const def = unitById(defId);
    const cardId = state.army.factionCards?.[def.faction] ?? (state.army.faction === def.faction ? state.army.factionCardId : undefined);
    const faction = cardId ? CARDS.find((c) => c.id === cardId) : undefined;
    const cards = buildDeck(def, typeUpgrades(state, defId), phase, faction);
    d = { cards, draw: rng.shuffle(cards.map((c) => c.id)), discard: [] };
    state.aiDecks[key] = d;
  }
  return d;
}

/**
 * The card this unit follows in the current phase: the one its type already drew this phase, or a fresh draw.
 * Returns null outside the Movement and Assault phases.
 */
export function drawFor(state: GameState, unit: AiUnitInstance, rng: Rng): ActionCard | null {
  const phase = state.phase;
  if (phase !== 'movement' && phase !== 'assault') return null;
  const d = ensureDeck(state, unit.defId, phase, rng);
  if (d.face && d.face.round === state.round && d.face.phase === phase) return d.cards.find((c) => c.id === d.face!.cardId) ?? null;
  if (d.face) d.discard.push(d.face.cardId);
  if (!d.draw.length) {
    d.draw = rng.shuffle(d.discard);
    d.discard = [];
  }
  const id = d.draw.shift();
  const card = d.cards.find((c) => c.id === id) ?? null;
  if (!card) return null;
  d.face = { round: state.round, phase, cardId: card.id };
  if (card.shuffle) d.reshuffle = true;
  return card;
}

/** At a round's start: every deck that drew its reshuffle card is shuffled back together. */
export function reshuffleDecks(state: GameState, rng: Rng): void {
  for (const d of Object.values(state.aiDecks ?? {})) {
    if (!d.reshuffle) continue;
    d.draw = rng.shuffle([...d.draw, ...d.discard, ...(d.face ? [d.face.cardId] : [])]);
    d.discard = [];
    delete d.face;
    d.reshuffle = false;
  }
}

/** The card a unit type is showing this phase, if it has drawn one. */
export function faceCard(state: GameState, defId: string): ActionCard | null {
  const phase = state.phase;
  if (phase !== 'movement' && phase !== 'assault') return null;
  const d = state.aiDecks?.[deckKey(defId, phase)];
  if (!d?.face || d.face.round !== state.round || d.face.phase !== phase) return null;
  return d.cards.find((c) => c.id === d.face!.cardId) ?? null;
}

/** What a card does to the unit's numbers for this phase. */
export function modsOf(card: ActionCard, round: number): CardMods {
  const mods: CardMods = { cardId: card.id, round, phase: card.phase, speed: 0, hit: 0, roa: 0 };
  for (const s of card.steps) {
    if (s.k === 'move' || s.k === 'run') mods.speed += s.mod;
    if (s.k === 'attack') {
      mods.hit += s.hit ?? 0;
      mods.roa += s.roa ?? 0;
      if (s.focus) mods.focus = s.focus;
    }
    if (s.k === 'charge') {
      if (s.twoDice) mods.twoDiceCharge = true;
      if (s.bonus) mods.chargeBonus = (mods.chargeBonus ?? 0) + s.bonus;
      if (s.focus) mods.focus = s.focus;
    }
  }
  return mods;
}

/** The action a card leads with, which decides the order's shape. */
export function primaryStep(card: ActionCard): Exclude<CardStep, { k: 'ability' }> | null {
  return (card.steps.find((s) => s.k !== 'ability') as Exclude<CardStep, { k: 'ability' }> | undefined) ?? null;
}

/** The rule reminders a card needs, in the order its steps use them. */
export function remindersFor(card: ActionCard): ReminderKey[] {
  const keys: ReminderKey[] = [];
  const add = (k: ReminderKey) => { if (!keys.includes(k)) keys.push(k); };
  for (const s of card.steps) {
    if (s.k === 'ability') add('ability');
    if (s.k === 'move') { add('move'); if (s.to === 'focus') add('focus'); if (s.to === 'objective' || s.to === 'marker') add('objective'); }
    if (s.k === 'run') { add('run'); add('move'); }
    if (s.k === 'hold') add('hold');
    if (s.k === 'attack') { add('focus'); add('attack'); if (s.otherwise === 'run') add('run'); }
    if (s.k === 'charge') { add('focus'); add('charge'); if (s.orFire) add('attack'); if (s.otherwise === 'run') add('run'); }
  }
  if (card.buffs.length) add('buff');
  if (card.shuffle) add('shuffle');
  return keys;
}

/** Whether a once-per-game effect on this card has already been used. */
export function usedOnce(state: GameState, defId: string, name: string): boolean {
  return Object.values(state.aiDecks ?? {}).some((d) => d.cards[0]?.defId === defId && (d.used ?? []).includes(name));
}

/** Record the once-per-game effects a drawn card uses (its abilities, buffs and boost that say so). */
export function markOnceUsed(state: GameState, card: ActionCard): void {
  const d = state.aiDecks?.[deckKey(card.defId, card.phase)];
  if (!d) return;
  const once = [
    ...card.steps.filter((s): s is Extract<CardStep, { k: 'ability' }> => s.k === 'ability' && /Once per Game/i.test(s.text)).map((s) => s.name),
    ...card.buffs.filter((b) => /Once per Game/i.test(b.text)).map((b) => b.name),
    ...(card.boost && /Once per Game/i.test(card.boost.text) ? [card.boost.name] : []),
  ];
  // A boost belongs to the whole army: once used by any unit type, it is gone for all of them.
  const boostUsed = card.boost && /Once per Game/i.test(card.boost.text);
  for (const n of once) if (!(d.used ?? []).includes(n)) d.used = [...(d.used ?? []), n];
  if (boostUsed) for (const other of Object.values(state.aiDecks ?? {})) if (!(other.used ?? []).includes(card.boost!.name)) other.used = [...(other.used ?? []), card.boost!.name];
}
