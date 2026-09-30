import type { SurgeDie, UnitDef, WeaponProfile } from '../types/units';
import type { Rng } from '../rng';
import { keywordText } from './keywords';

export interface DiceInstruction {
  weaponId: string;
  weapon: string;
  models: number;
  dice: number;
  hit: number;
  dmg: number;
  surge?: { types: string[]; die: SurgeDie };
  range: number | 'E';
  longRange?: number;
  target: string;
  keywordsText: string[];
  /** Pre-rolled d6 results, one per die (first models×roa are used). */
  rolls?: number[];
  surgeRoll?: number;
  /** Modifier applied to the hit roll (+1 = easier). */
  hitMod?: number;
  /** Extra range from effects (e.g. mutators). */
  rangeMod?: number;
}

/** SPECIALIST: one model of the unit carries this weapon, and the rest keep their own. */
export const isSpecialist = (w: WeaponProfile): boolean => w.keywords.some((k) => k.k === 'SPECIALIST');

/**
 * Weapons this unit actually carries given purchased upgrades. An upgrade that replaces another weapon takes it
 * off the unit — unless it is a SPECIALIST, which one model carries while everyone else keeps the weapon it
 * replaces (a Marine squad with an AGG-12 is eight rifles and one AGG-12, not nine of nothing).
 */
/**
 * A weapon can be replaced once (Part 5.1: a ↑ FOR weapon replaces the original entirely), so of two upgrades
 * that replace the same weapon — the Goliath's Haywire and Scatter Missiles both stand in for its Hellfire
 * Missiles — a unit carries only the first it took.
 */
export function purchasedWeapons(def: UnitDef, upgrades: string[]): WeaponProfile[] {
  const out: WeaponProfile[] = [];
  const taken = new Set<string>();
  for (const id of upgrades) {
    const w = def.weapons.find((x) => x.id === id && x.upgradeCost);
    if (!w) continue;
    const slot = w.replaces?.toLowerCase();
    if (slot && !isSpecialist(w)) {
      if (taken.has(slot)) continue;
      taken.add(slot);
    }
    out.push(w);
  }
  return out;
}

/** The upgrades a pick rules out: other replacements for the same weapon. */
export function toggleUpgrade(def: UnitDef, upgrades: string[], id: string): string[] {
  if (upgrades.includes(id)) return upgrades.filter((x) => x !== id);
  const w = def.weapons.find((x) => x.id === id);
  const slot = w?.replaces && !isSpecialist(w) ? w.replaces.toLowerCase() : null;
  const rest = slot ? upgrades.filter((x) => { const o = def.weapons.find((y) => y.id === x); return !(o?.replaces && o.replaces.toLowerCase() === slot && !isSpecialist(o)); }) : upgrades;
  return [...rest, id];
}

export function availableWeapons(def: UnitDef, upgrades: string[], phase: 'Assault' | 'Combat'): WeaponProfile[] {
  const purchased = purchasedWeapons(def, upgrades);
  const replaced = new Set(purchased.filter((w) => !isSpecialist(w)).map((w) => (w.replaces ?? '').toLowerCase()));
  const base = def.weapons.filter((w) => !w.upgradeCost && !replaced.has(w.name.toLowerCase()));
  return [...base, ...purchased].filter((w) => w.phase === phase);
}

/**
 * How many models of a unit fire a weapon: a SPECIALIST is the one model carrying it, and the rest of the unit
 * fires whatever it carries, one model fewer for each specialist among them.
 */
export function weaponModels(def: UnitDef, upgrades: string[], phase: 'Assault' | 'Combat', weapon: WeaponProfile, models: number): number {
  if (isSpecialist(weapon)) return 1;
  const specialists = availableWeapons(def, upgrades, phase).filter(isSpecialist).length;
  return Math.max(1, models - specialists);
}

export function surgeExpected(die: SurgeDie | undefined): number {
  if (!die) return 0;
  // BT is not rolled: it is however many models the template covers, two on a typical target.
  return die === 'D6' ? 3.5 : die === 'D3+1' ? 3 : die === 'BT' ? 2 : 2;
}

/** Rough expected damage per model vs an average target (armour 5+, no evade). */
export function expectedDamage(w: WeaponProfile): number {
  const pHit = (7 - w.hit) / 6;
  const hits = w.roa * pHit;
  const surgeShare = w.surgeTypes.length ? Math.min(hits, surgeExpected(w.surgeDie)) * 0.5 : 0; // 50% chance tag matches
  const armourPass = 4 / 6;
  return (surgeShare + (hits - surgeShare) * armourPass) * w.dmg;
}

/**
 * The weapon a unit leads with: the one with the best expected damage. `usable` narrows the choice to what the
 * unit may fire as it stands, so a dug-in Siege Tank picks among the guns SIEGE MODE actually leaves it.
 */
export function bestWeapon(def: UnitDef, upgrades: string[], phase: 'Assault' | 'Combat', usable: (w: WeaponProfile) => boolean = (w) => !w.requiresStatus): WeaponProfile | undefined {
  const all = availableWeapons(def, upgrades, phase).filter((w) => w.target !== 'Flying' && usable(w));
  // A squad leads with the gun most of it carries: a SPECIALIST's weapon is one model's, never the unit's lead.
  const ws = all.some((w) => !isSpecialist(w)) ? all.filter((w) => !isSpecialist(w)) : all;
  let best: WeaponProfile | undefined;
  let bestEv = -1;
  for (const w of ws) {
    const ev = expectedDamage(w);
    if (ev > bestEv) {
      best = w;
      bestEv = ev;
    }
  }
  return best;
}

/** Max range of a weapon including LONG RANGE. */
export function maxRange(w: WeaponProfile): number {
  if (w.range === 'E') return 0;
  const lr = w.keywords.find((k) => k.k === 'LONG RANGE');
  return lr?.v ?? w.range;
}

export function diceInstruction(w: WeaponProfile, models: number): DiceInstruction {
  const lr = w.keywords.find((k) => k.k === 'LONG RANGE');
  const instr: DiceInstruction = {
    weaponId: w.id,
    weapon: w.name,
    models,
    dice: w.roa * models,
    hit: w.hit,
    dmg: w.dmg,
    range: w.range,
    target: w.target,
    keywordsText: w.keywords.map(keywordText),
  };
  if (lr?.v) instr.longRange = lr.v;
  if (w.surgeTypes.length && w.surgeDie) instr.surge = { types: w.surgeTypes, die: w.surgeDie };
  return instr;
}

export function rollSurge(rng: Rng, die: SurgeDie): number {
  if (die === 'D6') return rng.d6();
  if (die === 'D3+1') return rng.d3() + 1;
  return rng.d3();
}

/** Pre-roll all dice for an instruction (deterministic via rng). */
export function rollInstruction(rng: Rng, instr: DiceInstruction): DiceInstruction {
  const rolls = rng.rollD6(instr.dice);
  const out: DiceInstruction = { ...instr, rolls };
  if (instr.surge) out.surgeRoll = rollSurge(rng, instr.surge.die);
  return out;
}

/** Hits for the first `models` models (each contributes roa dice) with optional hit modifier. */
export function hitsFor(instr: DiceInstruction, models: number, hitMod = instr.hitMod ?? 0): { dice: number; hits: number } {
  const roa = instr.models > 0 ? instr.dice / instr.models : instr.dice;
  const dice = Math.round(roa * Math.max(0, Math.min(models, instr.models)));
  const rolls = (instr.rolls ?? []).slice(0, dice);
  const need = instr.hit - hitMod;
  const hits = rolls.filter((r) => r >= need).length;
  return { dice, hits };
}
