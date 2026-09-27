import type { CardDef, Faction, UnitDef } from '../types/units';
import type { AiArmy, AiUnitInstance } from '../types/army';
import { Rng } from '../rng';
import { currentSupply } from '../units/supply';
import type { AbilityDef, WeaponProfile } from '../types/units';

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

/** Pick the faction card: sub-faction card if the roster uses sub-faction units, else the generic one. */
export function chooseFactionCard(faction: Faction, cards: CardDef[], subFactions: Set<string>): CardDef | undefined {
  const fcs = cards.filter((c) => c.isFactionCard && c.faction === faction);
  for (const sf of subFactions) {
    const hit = fcs.find((c) => c.name.toLowerCase().includes(sf.toLowerCase().split("'")[0] ?? ''));
    if (hit) return hit;
  }
  const generic = fcs.find((c) => /armed forces|zerg swarm|daelaam/i.test(c.name));
  return generic ?? fcs[0];
}

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
  const pool = opts.units.filter((u) => races.has(u.faction) && !u.summoned && left(u) > 0);
  const units: AiUnitInstance[] = [];
  const counters: Record<string, number> = {};
  let spent = 0;
  let heroes = 0;
  let support = 0;
  let coreSpent = 0;
  const uniqueUsed = new Set<string>();
  const subFactions = new Set<string>();

  const remaining = () => opts.budget - spent;
  const top = Math.max(1e-9, ...Object.values(opts.weights ?? {}));
  const candidates = () =>
    pool.filter((u) => {
      if (u.unique && uniqueUsed.has(u.id)) return false;
      if (u.role === 'Hero' && (!opts.heroAllowed || heroes >= 1)) return false;
      if (u.role === 'Support' && support >= 2) return false;
      const small = u.compositions.find((c) => c.label === 'small');
      if (!small) return false;
      return left(u) >= small.models && small.cost <= remaining();
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
    const favour = (id: string) => (opts.weights ? Math.max(0.08, (opts.weights[id] ?? 0) / top) : 1);
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
    const useLarge = !!large && left(def) >= large.models && large.cost <= remaining();
    const comp = useLarge ? 'large' : 'small';
    const idx = (counters[def.id] ?? 0) + 1;
    counters[def.id] = idx;
    const base = unitLabelBase(def);
    const label = def.unique ? base : `${base} ${String.fromCharCode(64 + idx)}`;
    const inst = makeInstance(def, comp, label, idx);
    const cost = instanceCost(def, inst);
    spent += cost;
    if (def.role === 'Core') coreSpent += cost;
    if (def.role === 'Hero') heroes++;
    if (def.role === 'Support') support++;
    if (def.unique) uniqueUsed.add(def.id);
    if (def.subFaction) subFactions.add(def.subFaction);
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
  for (const race of byRace.keys()) {
    const subs = new Set([...subFactions].filter((sf) => opts.units.some((u) => u.faction === race && u.subFaction === sf)));
    const c = chooseFactionCard(race, opts.cards, subs);
    if (c) factionCards[race] = c.id;
  }
  return { faction: lead, factionCardId: factionCards[lead] ?? chooseFactionCard(lead, opts.cards, new Set())?.id ?? '', factionCards, budget: opts.budget, spent, units };
}

export interface ValidationIssue {
  level: 'error' | 'warn';
  text: string;
}

export function validateArmy(army: AiArmy, units: UnitDef[], cards: CardDef[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (army.spent > army.budget) issues.push({ level: 'error', text: `Over budget: ${army.spent} / ${army.budget} minerals.` });
  if (army.units.length < 2) issues.push({ level: 'error', text: 'The AI needs at least two units.' });
  const uniq = new Map<string, number>();
  for (const inst of army.units) {
    const def = units.find((u) => u.id === inst.defId);
    if (!def) {
      issues.push({ level: 'error', text: `Unknown unit ${inst.defId}` });
      continue;
    }
    if (def.unique) uniq.set(def.id, (uniq.get(def.id) ?? 0) + 1);
  }
  for (const [id, n] of uniq) if (n > 1) issues.push({ level: 'error', text: `${id} is Unique but appears ${n} times.` });
  const card = cards.find((c) => c.id === army.factionCardId);
  const subs = new Set(army.units.map((i) => units.find((u) => u.id === i.defId)).filter((d) => d?.faction === army.faction).map((d) => d?.subFaction).filter(Boolean) as string[]);
  if (subs.size > 1) issues.push({ level: 'warn', text: `Roster mixes sub-factions (${[...subs].join(', ')}); a real list could not do this.` });
  if (card && subs.size === 1) {
    const sf = [...subs][0]!;
    if (!card.name.toLowerCase().includes(sf.toLowerCase().split("'")[0] ?? '')) issues.push({ level: 'warn', text: `${sf} units need the ${sf} faction card.` });
  }
  const contesters = army.units.filter((i) => currentSupply(units.find((u) => u.id === i.defId)!, i.models) > 0);
  if (contesters.length === 0) issues.push({ level: 'warn', text: 'No AI unit has Supply above 0; it cannot win marker contests.' });
  return issues;
}
