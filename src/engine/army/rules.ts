import { CARDS, unitById } from '@data/index';
import type { CardDef, UnitDef } from '../types/units';
import { configCostOf, type UnitChoice } from './force';

/**
 * Army Building (Part 9.1), in one place: the army pickers, the saved armies and the AI's own army all ask these
 * functions what an army may include. Nothing here draws anything or changes an army.
 */

/** The Army Slot types (Part 5.2): every Unit needs slots of its own type. */
export type SlotType = 'Core' | 'Elite' | 'Support' | 'Hero' | 'Air';
export const SLOT_TYPES: readonly SlotType[] = ['Core', 'Elite', 'Support', 'Hero', 'Air'];
export type SlotCount = Record<SlotType, number>;
export const noSlots = (): SlotCount => ({ Core: 0, Elite: 0, Support: 0, Hero: 0, Air: 0 });

const RACES = ['terran', 'zerg', 'protoss'];
/** Tags are compared as written, whatever the case or the kind of apostrophe. */
const norm = (tag: string) => tag.trim().toLowerCase().replace(/[\u2018\u2019]/g, "'");
/** Two Faction Tags are the same tag. */
export const sameTag = (a: string, b: string): boolean => norm(a) === norm(b);

/** A Creep card (Part 12.11): it gives no Army Slots and no resource. A Zerg army takes exactly one. */
export function isCreepCard(card: CardDef): boolean {
  return !card.isFactionCard && !card.resource && !SLOT_TYPES.some((s) => card.slots[s]);
}

/** Zerg Creep, on a Zerg Faction card: "select exactly one Creep Card and add it to the Army List". */
export function needsCreepCard(factionCard: CardDef | null | undefined): boolean {
  return !!factionCard && factionCard.boosts.some((b) => norm(b.name) === 'zerg creep');
}

/** The Army Slots an army's cards provide: the Faction card's, and those of every Tactical card copy (Part 9.1.5). */
export function armySlots(cards: CardDef[]): SlotCount {
  const out = noSlots();
  for (const c of cards) for (const s of SLOT_TYPES) out[s] += c.slots[s] ?? 0;
  return out;
}

/** The slot type a Unit occupies. Summoned Units are not in the Army List and occupy none (Part 9.1.9). */
export function slotOf(def: UnitDef): SlotType | null {
  return !def.summoned && (SLOT_TYPES as readonly string[]).includes(def.role) ? (def.role as SlotType) : null;
}

/** The starting Supply Value of a Composition Option: the Army Slots the Unit occupies (Part 9.1.6). */
export function startingSupply(def: UnitDef, composition: 'small' | 'large'): number {
  return (def.compositions.find((c) => c.label === composition) ?? def.compositions[0])?.supply ?? 0;
}

const knownUnit = (id: string): UnitDef | undefined => {
  try { return unitById(id); } catch { return undefined; }
};

/** The Army Slots the Units occupy: each one its starting Supply Value, in slots of its own type (Part 9.1.6). */
export function slotsUsed(units: Pick<UnitChoice, 'defId' | 'composition'>[], defOf: (id: string) => UnitDef | undefined = knownUnit): SlotCount {
  const out = noSlots();
  for (const u of units) {
    const def = defOf(u.defId);
    const slot = def && slotOf(def);
    if (def && slot) out[slot] += startingSupply(def, u.composition);
  }
  return out;
}

/** A Unit's Sub-Faction Tags (its Race Tag is its faction). */
export function unitFactionTags(def: UnitDef): string[] {
  return (def.subFaction ?? '').split(',').map((t) => t.trim()).filter((t) => t && !RACES.includes(norm(t)));
}

/** A card's Sub-Faction Tags. */
export function cardFactionTags(card: CardDef): string[] {
  return card.factionTags.map((t) => t.trim()).filter((t) => t && !RACES.includes(norm(t)));
}

/** What a Unit or Tactical card still needs from the Faction card: nothing, the race, or a Sub-Faction Tag. */
function missingTag(race: string, tags: string[], factionCard: CardDef | null | undefined): { none: true } | { race: string } | { tag: string } | null {
  if (!factionCard || !factionCard.isFactionCard) return { none: true };
  if (norm(factionCard.faction) !== norm(race)) return { race };
  const has = new Set(cardFactionTags(factionCard).map(norm));
  const tag = tags.find((t) => !has.has(norm(t)));
  return tag ? { tag } : null;
}

const needText = (m: NonNullable<ReturnType<typeof missingTag>>): string =>
  'none' in m ? 'Select a Faction card first.' : 'race' in m ? `Needs a ${m.race} Faction card.` : `Needs the ${m.tag} Faction card.`;

/**
 * Faction Tag Eligibility (Part 9.1.2): every Faction Tag on the Unit must also appear on the Faction card. A
 * Unit with no Sub-Faction Tag is eligible under any Faction card of its race.
 */
export function unitEligible(def: UnitDef, factionCard: CardDef | null | undefined): boolean {
  return !missingTag(def.faction, unitFactionTags(def), factionCard);
}

/** The same for a Tactical card (a Creep card is one): every tag on it must appear on the Faction card. */
export function cardEligible(card: CardDef, factionCard: CardDef | null | undefined): boolean {
  return !missingTag(card.faction, cardFactionTags(card), factionCard);
}

/** Why the Unit is not eligible under this Faction card ("Needs the Kerrigan's Swarm Faction card."), or null. */
export function unitNeeds(def: UnitDef, factionCard: CardDef | null | undefined): string | null {
  const m = missingTag(def.faction, unitFactionTags(def), factionCard);
  return m ? needText(m) : null;
}

/** Why the Tactical card is not eligible under this Faction card, or null. */
export function cardNeeds(card: CardDef, factionCard: CardDef | null | undefined): string | null {
  const m = missingTag(card.faction, cardFactionTags(card), factionCard);
  return m ? needText(m) : null;
}

/** The Vespene Limit: 10% of the Minerals (Part 9.1.1). */
export const vespeneLimit = (minerals: number): number => Math.floor(minerals * 0.1);

/** Vespene Gas spent: every Tactical card copy, and the Creep card (Part 9.1.4). */
export const vespeneSpent = (cards: CardDef[]): number => cards.reduce((sum, c) => sum + (c.isFactionCard ? 0 : c.cost), 0);

/**
 * Why this Unit cannot be added to the army as it stands, or null when it can: no Faction card yet, a Faction
 * Tag the Faction card lacks, a Unique Unit already in the army, or too few free Army Slots of its type for its
 * starting Supply Value (times the copies being added).
 */
export function addUnitProblem(def: UnitDef, composition: 'small' | 'large', army: { factionCard?: CardDef | null; cards: CardDef[]; units: Pick<UnitChoice, 'defId' | 'composition'>[] }, copies = 1): string | null {
  const factionCard = army.factionCard ?? army.cards.find((c) => c.isFactionCard);
  const needs = unitNeeds(def, factionCard);
  if (needs) return needs;
  if (def.unique && (copies > 1 || army.units.some((u) => u.defId === def.id))) return `${def.name} is Unique. Only one may be included in the army.`;
  const slot = slotOf(def);
  if (!slot) return null;
  const free = armySlots(army.cards)[slot] - slotsUsed(army.units)[slot];
  const need = startingSupply(def, composition) * copies;
  if (need <= free) return null;
  if (free <= 0) return `No free ${slot} Army Slot. Add a Tactical card that gives one.`;
  return `Occupies ${need} ${slot} Army Slots. ${free} ${free === 1 ? 'is' : 'are'} free. Add a Tactical card that gives one.`;
}

export type ArmyProblemCode =
  | 'no-faction-card' | 'faction-cards' | 'unit-ineligible' | 'card-ineligible' | 'unique-unit'
  | 'slots' | 'minerals' | 'vespene' | 'creep-missing' | 'creep-many';

export interface ArmyProblem {
  code: ArmyProblemCode;
  /** What is wrong, for the players. */
  text: string;
  /** The Army Slot type that is over, for `slots`. */
  slot?: SlotType;
}

export interface PlayerArmyInput {
  /** The army's Faction card. Left out, it is the first Faction card among `cards`. */
  factionCard?: CardDef | string | null;
  /** Every card in the army, one entry per copy (the Faction card may be among them). */
  cards: (CardDef | string)[];
  units: UnitChoice[];
  /** The Mineral limit the army is built to. */
  minerals: number;
}

/**
 * Everything that stops an army being fielded (Parts 5.4 and 9.1), most basic first. An empty list is a legal
 * army. Any Tactical card may be taken more than once; only the Faction card and the Creep card are single.
 */
export function validatePlayerArmy(input: PlayerArmyInput): ArmyProblem[] {
  const card = (c: CardDef | string | null | undefined) => (typeof c === 'string' ? CARDS.find((x) => x.id === c) : c ?? undefined);
  const cards = input.cards.map(card).filter((c): c is CardDef => !!c);
  const given = card(input.factionCard);
  const factionCards = cards.filter((c) => c.isFactionCard);
  if (given && !factionCards.some((c) => c.id === given.id)) factionCards.unshift(given);
  const factionCard = given ?? factionCards[0];
  const tactical = cards.filter((c) => !c.isFactionCard);
  const units = input.units.map((u) => ({ u, def: knownUnit(u.defId) })).filter((x): x is { u: UnitChoice; def: UnitDef } => !!x.def);
  const out: ArmyProblem[] = [];

  if (!factionCard) out.push({ code: 'no-faction-card', text: 'Select a Faction card. Every army must include exactly one.' });
  else if (factionCards.length > 1) out.push({ code: 'faction-cards', text: `${factionCards.length} Faction cards. Every army must include exactly one.` });

  if (factionCard) {
    // Faction Tag Eligibility (9.1.2): each Unit and each Tactical card named once, however many copies.
    const seen = new Set<string>();
    for (const { def } of units) {
      const needs = unitNeeds(def, factionCard);
      if (needs && !seen.has(def.id)) out.push({ code: 'unit-ineligible', text: `${def.name}: ${needs}` });
      seen.add(def.id);
    }
    for (const c of tactical) {
      const needs = cardNeeds(c, factionCard);
      if (needs && !seen.has(`card:${c.id}`)) out.push({ code: 'card-ineligible', text: `${c.name}: ${needs}` });
      seen.add(`card:${c.id}`);
    }
  }

  const copies = new Map<string, number>();
  for (const { def } of units) if (def.unique) copies.set(def.id, (copies.get(def.id) ?? 0) + 1);
  for (const [id, n] of copies) if (n > 1) out.push({ code: 'unique-unit', text: `${unitById(id).name} is Unique. Only one may be included in the army.` });

  if (factionCard) {
    // Army Slots (9.1.6): the Faction card's and every Tactical card copy's, against the Units' starting Supply.
    const have = armySlots([factionCard, ...tactical]);
    const used = slotsUsed(units.map((x) => x.u));
    for (const s of SLOT_TYPES) {
      if (used[s] > have[s]) out.push({ code: 'slots', slot: s, text: `Units occupy ${used[s]} ${s} Army Slot${used[s] === 1 ? '' : 's'}. The cards give ${have[s]}.` });
    }
  }

  const minerals = units.reduce((sum, x) => sum + configCostOf(x.u), 0);
  if (minerals > input.minerals) out.push({ code: 'minerals', text: `The army costs ${minerals} Minerals. The limit is ${input.minerals}.` });
  const gas = vespeneSpent(tactical);
  const gasLimit = vespeneLimit(input.minerals);
  if (gas > gasLimit) out.push({ code: 'vespene', text: `The Tactical cards cost ${gas} Vespene Gas. The limit is ${gasLimit}.` });

  const creep = tactical.filter(isCreepCard).length;
  if (creep > 1) out.push({ code: 'creep-many', text: 'An army may include only one Creep card.' });
  else if (!creep && needsCreepCard(factionCard)) out.push({ code: 'creep-missing', text: 'Select a Creep card. A Zerg army must include exactly one.' });
  return out;
}

/**
 * The cheapest Tactical cards (copies allowed) that, with the Faction card, provide the Army Slots needed. Null
 * when no set of these cards does. `tactical` is the cards on offer: pass the ones eligible under the Faction card.
 */
export function cheapestCards(factionCard: CardDef, need: SlotCount, tactical: CardDef[]): { cards: CardDef[]; gas: number } | null {
  type Cover = { cards: CardDef[]; gas: number };
  const useful = tactical.filter((c) => !c.isFactionCard && SLOT_TYPES.some((s) => c.slots[s]));
  const memo = new Map<string, Cover | null>();
  const solve = (short: number[]): Cover | null => {
    if (short.every((n) => n === 0)) return { cards: [], gas: 0 };
    const key = short.join(',');
    if (memo.has(key)) return memo.get(key)!;
    let best: Cover | null = null;
    for (const c of useful) {
      const next = short.map((n, i) => Math.max(0, n - (c.slots[SLOT_TYPES[i]!] ?? 0)));
      if (next.every((n, i) => n === short[i])) continue;
      const rest = solve(next);
      if (!rest) continue;
      const gas = c.cost + rest.gas;
      // Cheapest first; at the same price, the set with more different cards in it (more abilities for the gas).
      if (!best || gas < best.gas || (gas === best.gas && new Set([c, ...rest.cards]).size > new Set(best.cards).size)) best = { cards: [c, ...rest.cards], gas };
    }
    memo.set(key, best);
    return best;
  };
  return solve(SLOT_TYPES.map((s) => Math.max(0, need[s] - (factionCard.slots[s] ?? 0))));
}
