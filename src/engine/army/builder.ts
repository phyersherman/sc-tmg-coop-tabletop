import type { CardDef, Faction, UnitDef } from '../types/units';
import type { AiArmy, AiUnitInstance } from '../types/army';
import { Rng } from '../rng';
import { currentSupply } from '../units/supply';
import type { AbilityDef, WeaponProfile } from '../types/units';
import { SLOT_TYPES, armySlots, cardEligible, cardFactionTags, cheapestCards, isCreepCard, needsCreepCard, noSlots, sameTag, slotOf, slotsUsed, startingSupply, unitFactionTags, unitNeeds, vespeneLimit, vespeneSpent, type SlotCount } from './rules';

type Opp = { def: UnitDef; models: number };
const TAGS = ['Light', 'Armoured', 'Biological', 'Mechanical', 'Flying', 'Ground', 'Massive', 'Psionic'];

/** How much damage a weapon deals across the players' units, favouring what its Surge and PIERCE are made for. */
function weaponValue(w: WeaponProfile, opps: Opp[]): number {
  const base = (w.roa * Math.max(0, 7 - w.hit) / 6) * w.dmg;
  if (!opps.length) return base;
  let v = 0;
  for (const o of opps) {
    const tags = o.def.tags as string[];
    if (w.target !== 'All' && !tags.includes(w.target)) continue;
    let mult = 1;
    if (w.surgeTypes.some((t) => tags.includes(t))) mult += 0.5;
    if (w.keywords.some((k) => k.k === 'PIERCE' && k.tag && tags.includes(k.tag))) mult += 0.5;
    if (w.keywords.some((k) => k.k === 'ANTI-EVADE') && o.def.stats.evade) mult += 0.3;
    v += base * mult * o.models * o.def.stats.hp;
  }
  const total = opps.reduce((a, o) => a + o.models * o.def.stats.hp, 0) || 1;
  return v / total;
}

/** What buying this weapon adds over what the unit would carry instead (0 or less: not worth it). */
function weaponGain(def: UnitDef, w: WeaponProfile, opps: Opp[]): number {
  const old = w.replaces ? def.weapons.find((x) => x.name.toLowerCase() === w.replaces!.toLowerCase()) : undefined;
  const now = weaponValue(w, opps);
  const before = old ? weaponValue(old, opps) : 0;
  return (now - before) / Math.max(0.5, before || now);
}

/**
 * An ability upgrade is worth something unless it names a kind of enemy the players do not field: a bonus against
 * Armoured units does nothing against an army of Light ones.
 */
function abilityGain(a: AbilityDef, opps: Opp[]): number {
  if (!opps.length) return a.kind === 'Passive' ? 0.3 : 0.2;
  const named = TAGS.filter((t) => new RegExp(`\\b${t}\\b`).test(a.text) && /Enemy|target/i.test(a.text));
  if (named.length && !opps.some((o) => named.some((t) => (o.def.tags as string[]).includes(t)))) return 0;
  const vsRanged = /Ranged Attack/i.test(a.text) && /Enemy|target(ing|ed)/i.test(a.text) && !/makes a Ranged Attack|its .* weapon/i.test(a.text);
  if (vsRanged && !opps.some((o) => o.def.weapons.some((w) => w.phase === 'Assault'))) return 0;
  return named.length ? 0.4 : a.kind === 'Passive' ? 0.3 : 0.25;
}

export interface Ownership {
  /** defId -> number of models the player physically owns. */
  [defId: string]: number;
}

export interface BuildOptions {
  faction: Faction;
  budget: number;
  ownership: Ownership;
  heroAllowed: boolean;
  seed: number;
  units: UnitDef[];
  cards: CardDef[];
  /**
   * How much to favour each unit (any scale). Units left out are still possible, just rare, so a force that
   * cannot be built from the favoured units alone still fills its budget.
   */
  weights?: Record<string, number>;
  /**
   * The players' armies, when known: the AI buys the upgrades that do the most against them and skips the ones
   * that do nothing (anti-Armoured weapons against an all-Light force, say).
   */
  opponents?: { defId: string; models: number }[];
  /** Models the players are fielding themselves, taken off what the AI may use (miniatures cannot be on both sides). */
  reserved?: Ownership;
  /**
   * The races the AI may draw on (default: `faction` alone). With several, it fields whatever unused models it
   * likes from any of them, and `faction` is only the fallback for an empty army.
   */
  factions?: Faction[];
  /**
   * A campaign's story force: it fields what the story fielded, whatever Army Slots and Faction Tags would allow
   * (its Vespene Gas still buys Tactical cards, the slots of as many of its Units as it pays for). Every other
   * army the AI builds is legal under Army Building (Part 9.1).
   */
  storyForce?: boolean;
}

const PLURAL: Record<string, string> = {
  marine: 'Marines', zergling: 'Zerglings', zealot: 'Zealots', marauder: 'Marauders', medic: 'Medics',
  hydralisk: 'Hydralisks', roach: 'Roaches', adept: 'Adepts', sentry: 'Sentries', stalker: 'Stalkers',
};

export function unitLabelBase(def: UnitDef): string {
  const maxModels = Math.max(1, ...def.compositions.map((c) => c.models));
  if (maxModels === 1) return def.name;
  return PLURAL[def.id] ?? def.name;
}

export function makeInstance(def: UnitDef, comp: 'small' | 'large', label: string, idx: number): AiUnitInstance {
  const c = def.compositions.find((x) => x.label === comp) ?? def.compositions[0];
  const models = c?.models ?? 1;
  return {
    id: `${def.id}-${idx}`,
    defId: def.id,
    label,
    composition: comp,
    upgrades: [],
    maxModels: models,
    models,
    damageMarker: 0,
    shieldsLeft: def.stats.shields ?? 0,
    location: 'reserves',
    activated: { movement: false, assault: false, combat: false },
    engaged: false,
    engagedEnemySupply: 0,
    disengagedThisRound: false,
    objective: { kind: 'hold' },
    atObjective: false,
    respawns: 0,
  };
}

export function instanceCost(def: UnitDef, inst: AiUnitInstance): number {
  const c = def.compositions.find((x) => x.label === inst.composition);
  let cost = c?.cost ?? 0;
  for (const upId of inst.upgrades) {
    const w = def.weapons.find((x) => x.id === upId);
    const a = def.abilities.find((x) => x.id === upId);
    const uc = w?.upgradeCost ?? a?.upgradeCost;
    if (uc) cost += inst.composition === 'large' ? uc.large : uc.small;
  }
  return cost;
}

/**
 * Pick the Faction card: the one that carries the roster's Sub-Faction Tag (matched exactly against the card's
 * Faction Tags; with several, the first named wins, so name the most-fielded first), else the race's card with
 * no Sub-Faction Tag.
 */
export function chooseFactionCard(faction: Faction, cards: CardDef[], subFactions: Set<string>): CardDef | undefined {
  const fcs = cards.filter((c) => c.isFactionCard && c.faction === faction);
  for (const sf of subFactions) {
    const hit = fcs.find((c) => cardFactionTags(c).some((t) => sameTag(t, sf)));
    if (hit) return hit;
  }
  return fcs.find((c) => cardFactionTags(c).length === 0) ?? fcs[0];
}

/**
 * What a Unit is bought with whenever the Minerals allow, before anything else: the AI only enters SIEGE MODE
 * with a Siege Tank that has Mode Transformation.
 */
const KIT: Record<string, string[]> = { siege_tank: ['Mode Transformation'] };

/** Seeded greedy army builder from the units the player owns. */
/** The miniature a unit is fielded with: a variant ("nerazim_watchers__adept_") is an Adept model. */
const modelOf = (id: string) => /__(.+)_$/.exec(id)?.[1] ?? id;

export function buildAiArmy(opts: BuildOptions): AiArmy {
  const rng = Rng.from(opts.seed);
  // Stock is counted per miniature, not per unit: Adepts and Nerazim Watchers come out of the same four models.
  // Ownership may name the models or every unit (each variant carrying its model's count): either way, one pool.
  const stock: Ownership = {};
  for (const [id, n] of Object.entries(opts.ownership)) stock[modelOf(id)] = Math.max(stock[modelOf(id)] ?? 0, n);
  for (const [id, n] of Object.entries(opts.reserved ?? {})) if (stock[modelOf(id)] !== undefined) stock[modelOf(id)] = Math.max(0, stock[modelOf(id)]! - n);
  const left = (u: UnitDef) => stock[modelOf(u.id)] ?? 0;
  const races = new Set<Faction>(opts.factions?.length ? opts.factions : [opts.faction]);
  let pool = opts.units.filter((u) => races.has(u.faction) && !u.summoned && left(u) > 0);
  const units: AiUnitInstance[] = [];
  const counters: Record<string, number> = {};
  let spent = 0;
  let heroes = 0;
  let support = 0;
  let coreSpent = 0;
  const uniqueUsed = new Set<string>();

  // Army Building (Part 9.1). Each race the AI fields is an army of its own under one Faction card, and the
  // Vespene Gas (10% of the budget) buys the Tactical cards that open the Army Slots its Units occupy. A race's
  // cards are planned afresh with every Unit added: the Faction card and the cheapest Tactical cards that, between
  // them, carry the Units' Faction Tags and give a slot for each point of starting Supply.
  const legal = !opts.storyForce;
  const gasLimit = vespeneLimit(opts.budget);
  type Plan = { card: CardDef; tactical: CardDef[]; gas: number };
  const plans = new Map<Faction, Plan>();
  const need = new Map<Faction, SlotCount>();
  const tagsOf = new Map<Faction, string[]>();
  const planned = new Map<string, Plan | null>();
  const planFor = (race: Faction, slots: SlotCount, tags: string[]): Plan | null => {
    const key = `${race}|${SLOT_TYPES.map((s) => slots[s]).join(',')}|${tags.join('|')}`;
    if (planned.has(key)) return planned.get(key)!;
    // The Faction card the roster calls for is tried first, so it wins a tie on Vespene Gas.
    const first = chooseFactionCard(race, opts.cards, new Set(tags));
    const factionCards = opts.cards.filter((c) => c.isFactionCard && c.faction === race).sort((a, b) => (a === first ? -1 : 0) - (b === first ? -1 : 0));
    let best: Plan | null = null;
    for (const card of factionCards) {
      const carried = cardFactionTags(card);
      if (!tags.every((t) => carried.some((c) => sameTag(c, t)))) continue;
      const cover = cheapestCards(card, slots, opts.cards.filter((c) => !c.isFactionCard && !isCreepCard(c) && cardEligible(c, card)));
      if (cover && (!best || cover.gas < best.gas)) best = { card, tactical: cover.cards, gas: cover.gas };
    }
    planned.set(key, best);
    return best;
  };
  /** The race's cards with this Unit added, if the Vespene Gas left by the other races pays for them. */
  const planWith = (u: UnitDef, comp: 'small' | 'large'): Plan | null => {
    const slot = slotOf(u);
    if (!slot) return null;
    const slots = { ...(need.get(u.faction) ?? noSlots()) };
    slots[slot] += startingSupply(u, comp);
    const tags = [...new Set([...(tagsOf.get(u.faction) ?? []), ...unitFactionTags(u)])].sort();
    const plan = planFor(u.faction, slots, tags);
    if (!plan) return null;
    let others = 0;
    for (const [race, p] of plans) if (race !== u.faction) others += p.gas;
    return plan.gas + others <= gasLimit ? plan : null;
  };

  const remaining = () => opts.budget - spent;
  const top = Math.max(1e-9, ...Object.values(opts.weights ?? {}));
  const favour = (id: string) => (opts.weights ? Math.max(0.08, (opts.weights[id] ?? 0) / top) : 1);
  // One Sub-Faction to a race: no Faction card carries two (Khalai and Nerazim), so where the shelf holds Units
  // of both, the army is one or the other from the start, drawn by how much each is favoured. The other's Units
  // stay on the shelf rather than join an army that could not field them.
  if (legal) {
    for (const race of races) {
      const tags = [...new Set(pool.filter((u) => u.faction === race).flatMap(unitFactionTags))];
      const carriesAll = opts.cards.some((c) => c.isFactionCard && c.faction === race && tags.every((t) => cardFactionTags(c).some((x) => sameTag(x, t))));
      if (tags.length < 2 || carriesAll) continue;
      const weight = tags.map((t) => pool.filter((u) => u.faction === race && unitFactionTags(u).includes(t)).reduce((n, u) => n + favour(u.id), 0));
      let r = rng.next() * weight.reduce((a, b) => a + b, 0);
      let keep = tags[0]!;
      for (let i = 0; i < tags.length; i++) {
        r -= weight[i]!;
        if (r <= 0) { keep = tags[i]!; break; }
      }
      pool = pool.filter((u) => u.faction !== race || unitFactionTags(u).every((t) => t === keep));
    }
  }
  const candidates = () =>
    pool.filter((u) => {
      if (u.unique && uniqueUsed.has(u.id)) return false;
      if (u.role === 'Hero' && (!opts.heroAllowed || heroes >= 1)) return false;
      if (u.role === 'Support' && support >= 2) return false;
      const small = u.compositions.find((c) => c.label === 'small');
      if (!small) return false;
      if (!(left(u) >= small.models && small.cost <= remaining())) return false;
      // Only while an Army Slot of its type is free, or a Tactical card the Vespene Gas still buys gives one.
      return !legal || !!planWith(u, 'small');
    });

  for (let guard = 0; guard < 40; guard++) {
    if (spent >= opts.budget * 0.95) break;
    let cands = candidates();
    if (cands.length === 0) break;
    // Core first until 40% of the budget is core.
    if (coreSpent < opts.budget * 0.4) {
      const core = cands.filter((u) => u.role === 'Core');
      if (core.length) cands = core;
    }
    // Weighted: prefer units with fewer copies already, and the units the caller favours.
    const weights = cands.map((u) => favour(u.id) / (1 + (counters[u.id] ?? 0)));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng.next() * total;
    let def = cands[0] as UnitDef;
    for (let i = 0; i < cands.length; i++) {
      r -= weights[i] as number;
      if (r <= 0) {
        def = cands[i] as UnitDef;
        break;
      }
    }
    const large = def.compositions.find((c) => c.label === 'large');
    const useLarge = !!large && left(def) >= large.models && large.cost <= remaining() && (!legal || !!planWith(def, 'large'));
    const comp = useLarge ? 'large' : 'small';
    if (legal) {
      const plan = planWith(def, comp)!;
      const slots = need.get(def.faction) ?? noSlots();
      slots[slotOf(def)!] += startingSupply(def, comp);
      need.set(def.faction, slots);
      tagsOf.set(def.faction, [...new Set([...(tagsOf.get(def.faction) ?? []), ...unitFactionTags(def)])].sort());
      plans.set(def.faction, plan);
    }
    const idx = (counters[def.id] ?? 0) + 1;
    counters[def.id] = idx;
    const base = unitLabelBase(def);
    const label = def.unique ? base : `${base} ${String.fromCharCode(64 + idx)}`;
    const inst = makeInstance(def, comp, label, idx);
    spent += instanceCost(def, inst);
    for (const name of KIT[modelOf(def.id)] ?? []) {
      const up = [...def.weapons, ...def.abilities].find((x) => x.upgradeCost && x.name.toLowerCase() === name.toLowerCase());
      const price = up?.upgradeCost ? (comp === 'large' ? up.upgradeCost.large : up.upgradeCost.small) : Infinity;
      if (up && price <= remaining()) { inst.upgrades.push(up.id); spent += price; }
    }
    const cost = instanceCost(def, inst);
    if (def.role === 'Core') coreSpent += cost;
    if (def.role === 'Hero') heroes++;
    if (def.role === 'Support') support++;
    if (def.unique) uniqueUsed.add(def.id);
    stock[modelOf(def.id)] = left(def) - inst.maxModels;
    units.push(inst);
  }

  // Spend what is left on upgrades, best value against the players first. The AI plays its abilities from its
  // action cards, so Active abilities and Reactions are worth buying too; SPECIALIST weapons are not.
  const opps = (opts.opponents ?? []).map((o) => ({ def: opts.units.find((u) => u.id === o.defId), models: o.models })).filter((o): o is { def: UnitDef; models: number } => !!o.def);
  for (let guard = 0; guard < 60; guard++) {
    let best: { inst: AiUnitInstance; id: string; cost: number; score: number } | null = null;
    for (const inst of units) {
      const def = opts.units.find((u) => u.id === inst.defId)!;
      // A weapon is replaced once: with Haywire Missiles bought, Scatter Missiles are off the table.
      const replaced = new Set(def.weapons.filter((w) => inst.upgrades.includes(w.id) && w.replaces).map((w) => w.replaces!.toLowerCase()));
      const options = [
        ...def.weapons.filter((w) => w.upgradeCost && !w.keywords.some((k) => k.k === 'SPECIALIST') && !(w.replaces && replaced.has(w.replaces.toLowerCase()))),
        ...def.abilities.filter((a) => a.upgradeCost),
      ].filter((o) => !inst.upgrades.includes(o.id));
      for (const o of options) {
        const uc = o.upgradeCost!;
        const cost = inst.composition === 'large' ? uc.large : uc.small;
        if (cost <= 0 || cost > remaining()) continue;
        const score = 'roa' in o ? weaponGain(def, o, opps) : abilityGain(o, opps);
        if (score <= 0.05) continue;
        // Per mineral, with a little noise so two equal choices are not always taken in the same order.
        const per = (score / cost) * (0.9 + rng.next() * 0.2);
        if (!best || per > best.score) best = { inst, id: o.id, cost, score: per };
      }
    }
    if (!best) break;
    best.inst.upgrades.push(best.id);
    spent += best.cost;
  }

  // Each race in the army brings its own Faction card; the race the AI spent most on leads it (its order deck,
  // what guards the side markers).
  const byRace = new Map<Faction, number>();
  for (const inst of units) {
    const def = opts.units.find((u) => u.id === inst.defId)!;
    byRace.set(def.faction, (byRace.get(def.faction) ?? 0) + instanceCost(def, inst));
  }
  const lead = [...byRace.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? opts.faction;
  const factionCards: Partial<Record<Faction, string>> = {};
  const factionCardOf = new Map<Faction, CardDef>();
  const tacticalCards: string[] = [];
  let gas = 0;
  const offered = (card: CardDef) => opts.cards.filter((c) => !c.isFactionCard && !isCreepCard(c) && cardEligible(c, card));
  for (const race of byRace.keys()) {
    if (legal) {
      const plan = plans.get(race)!;
      factionCardOf.set(race, plan.card);
      tacticalCards.push(...plan.tactical.map((c) => c.id));
      gas += plan.gas;
      continue;
    }
    // A story force: the Sub-Faction the race fields most of names its Faction card, and the Vespene Gas buys
    // the Army Slots of as many of its Units, in the order they joined, as it pays for.
    const mine = units.map((inst) => ({ inst, def: opts.units.find((u) => u.id === inst.defId)! })).filter((x) => x.def.faction === race);
    const count = new Map<string, number>();
    for (const { def } of mine) for (const t of unitFactionTags(def)) count.set(t, (count.get(t) ?? 0) + 1);
    const card = chooseFactionCard(race, opts.cards, new Set([...count.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t)));
    if (!card) continue;
    factionCardOf.set(race, card);
    let slots = noSlots();
    let cover: { cards: CardDef[]; gas: number } = { cards: [], gas: 0 };
    for (const { inst, def } of mine) {
      const slot = slotOf(def);
      if (!slot) continue;
      const next = { ...slots, [slot]: slots[slot] + startingSupply(def, inst.composition) };
      const c = cheapestCards(card, next, offered(card));
      if (c && gas + c.gas <= gasLimit) { slots = next; cover = c; }
    }
    tacticalCards.push(...cover.cards.map((c) => c.id));
    gas += cover.gas;
  }
  for (const [race, card] of factionCardOf) factionCards[race] = card.id;
  // Zerg Creep: exactly one Creep card, the one made for the brood when the Vespene Gas left pays for it.
  for (const card of factionCardOf.values()) {
    if (!needsCreepCard(card)) continue;
    const creep = opts.cards
      .filter((c) => isCreepCard(c) && cardEligible(c, card) && gas + c.cost <= gasLimit)
      .sort((a, b) => cardFactionTags(b).length - cardFactionTags(a).length || a.cost - b.cost)[0];
    if (creep) { tacticalCards.push(creep.id); gas += creep.cost; }
  }
  // Unspent Vespene Gas is lost (9.1.4): what is left buys Tactical cards the army does not hold yet, for what
  // they do in the battle.
  for (let guard = 0; guard < 20; guard++) {
    const more = [...factionCardOf.values()].flatMap((card) => offered(card)).filter((c) => !tacticalCards.includes(c.id) && gas + c.cost <= gasLimit);
    if (!more.length) break;
    const pick = more[Math.floor(rng.next() * more.length)] ?? more[0]!;
    tacticalCards.push(pick.id);
    gas += pick.cost;
  }
  const army: AiArmy = { faction: lead, factionCardId: factionCards[lead] ?? chooseFactionCard(lead, opts.cards, new Set())?.id ?? '', factionCards, tacticalCards, budget: opts.budget, spent, units };
  if (!legal) army.storyForce = true;
  return army;
}

export interface ValidationIssue {
  level: 'error' | 'warn';
  text: string;
}

/**
 * What is wrong with an AI army. It is held to Army Building like any other (Part 9.1), each race it fields as an
 * army under its own Faction card: Faction Tags, Army Slots for every Unit's starting Supply, Vespene Gas for its
 * Tactical cards. A campaign's story force, and an army recorded before its Tactical cards were, is not held to
 * slots, and its Faction Tags only warn.
 */
export function validateArmy(army: AiArmy, units: UnitDef[], cards: CardDef[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (army.spent > army.budget) issues.push({ level: 'error', text: `Over budget: ${army.spent} / ${army.budget} minerals.` });
  if (army.units.length < 2) issues.push({ level: 'error', text: 'The AI needs at least two units.' });
  const uniq = new Map<string, number>();
  const fielded: { inst: AiUnitInstance; def: UnitDef }[] = [];
  for (const inst of army.units) {
    const def = units.find((u) => u.id === inst.defId);
    if (!def) {
      issues.push({ level: 'error', text: `Unknown unit ${inst.defId}` });
      continue;
    }
    fielded.push({ inst, def });
    if (def.unique) uniq.set(def.id, (uniq.get(def.id) ?? 0) + 1);
  }
  for (const [id, n] of uniq) if (n > 1) issues.push({ level: 'error', text: `${id} is Unique but appears ${n} times.` });

  const built = army.tacticalCards !== undefined && !army.storyForce;
  const level = built ? 'error' : 'warn';
  const tactical = (army.tacticalCards ?? []).map((id) => cards.find((c) => c.id === id)).filter((c): c is CardDef => !!c);
  for (const race of new Set(fielded.map((f) => f.def.faction))) {
    const mine = fielded.filter((f) => f.def.faction === race);
    const cardId = army.factionCards?.[race] ?? (army.faction === race ? army.factionCardId : undefined);
    const card = cards.find((c) => c.id === cardId && c.isFactionCard);
    if (!card) {
      issues.push({ level, text: `The ${race} Units have no Faction card.` });
      continue;
    }
    // Faction Tags (9.1.2): every tag on a Unit must appear on its race's Faction card.
    const subs = new Set(mine.flatMap((f) => unitFactionTags(f.def)));
    if (subs.size > 1 && !cards.some((c) => c.isFactionCard && c.faction === race && [...subs].every((t) => cardFactionTags(c).some((x) => sameTag(x, t))))) {
      issues.push({ level, text: `The ${race} Units mix Sub-Factions (${[...subs].join(', ')}). No Faction card carries them all.` });
    }
    const named = new Set<string>();
    for (const { def } of mine) {
      const needs = unitNeeds(def, card);
      if (needs && !named.has(def.id)) issues.push({ level, text: `${def.name} under ${card.name}: ${needs}` });
      named.add(def.id);
    }
    if (!built) continue;
    const own = tactical.filter((c) => c.faction === race);
    for (const c of new Set(own)) if (!cardEligible(c, card)) issues.push({ level: 'error', text: `${c.name} is not eligible under ${card.name}.` });
    // Army Slots (9.1.6): a slot of its type for each point of starting Supply.
    const have = armySlots([card, ...own]);
    const used = slotsUsed(mine.map((f) => f.inst), (id) => units.find((u) => u.id === id));
    for (const s of SLOT_TYPES) if (used[s] > have[s]) issues.push({ level: 'error', text: `${race}: Units occupy ${used[s]} ${s} Army Slots. The cards give ${have[s]}.` });
    const creep = own.filter(isCreepCard).length;
    if (creep > 1 || (needsCreepCard(card) && creep !== 1)) issues.push({ level: 'error', text: `${card.name} takes exactly one Creep card. The army has ${creep}.` });
  }
  if (built) {
    const stray = tactical.filter((c) => !fielded.some((f) => f.def.faction === c.faction));
    for (const c of new Set(stray)) issues.push({ level: 'error', text: `${c.name} belongs to no race the army fields.` });
    const gas = vespeneSpent(tactical);
    if (gas > vespeneLimit(army.budget)) issues.push({ level: 'error', text: `Tactical cards cost ${gas} Vespene Gas. The limit is ${vespeneLimit(army.budget)}.` });
  }
  const contesters = fielded.filter((f) => currentSupply(f.def, f.inst.models) > 0);
  if (contesters.length === 0) issues.push({ level: 'warn', text: 'No AI unit has Supply above 0; it cannot win marker contests.' });
  return issues;
}
