import type { UnitDef, WeaponProfile } from '../types/units';
import type { Rng } from '../rng';
import { applyDamage, type DamageTarget } from '../units/damage';

export interface AttackSide {
  side: 'ai' | 'players';
  unitId: string;
  label: string;
}

export interface AttackResult {
  id: string;
  attacker: AttackSide;
  defender: AttackSide;
  weapon: string;
  phase: 'Assault' | 'Combat' | 'Impact';
  models: number;
  dice: number;
  hit: number;
  hitMod: number;
  rolls: number[];
  precisionUsed: number;
  hits: number;
  surge?: { die: string; roll: number; applied: number; matched: boolean };
  critical: number;
  armour: number;
  saveRolls: number[];
  saved: number;
  toughUsed: number;
  evade?: { value: number; rolls: number[]; saved: number; reason: string };
  dmgPer: number;
  damage: number;
  removed: number;
  modelsAfter: number;
  destroyed: boolean;
  /** Saves not rolled yet: the defender will enter them by hand. */
  pendingSaves: boolean;
}

export interface AttackParams {
  attacker: AttackSide;
  defender: AttackSide;
  weapon: WeaponProfile;
  models: number;
  phase: 'Assault' | 'Combat' | 'Impact';
  hitMod?: number;
  defenderDef: UnitDef;
  defenderState: DamageTarget;
  /** Defender may Evade (engaged target of a ranged attack, high ground, HIDDEN...). */
  evadeReason?: string | null;
  toughFirst?: number;
  /** Roll saves later by hand. */
  manualSaves?: boolean;
  /** Attack dice already rolled (pre-rolled AI batches). */
  presetRolls?: number[];
  presetSurge?: number;
  /** Armour and Evade dice already rolled (the Combat Tray rolls each step as it comes up). */
  presetSaves?: number[];
  presetEvade?: number[];
  /** DEBUFFs on the defender: its Armour and Evade need this much more. */
  armourMod?: number;
  evadeMod?: number;
}

const kw = (w: WeaponProfile, k: string) => w.keywords.find((x) => x.k === k);

/** Full official attack sequence: hit → Surge/Critical → Armour → Evade → damage → casualties. */
export function resolveAttack(rng: Rng, p: AttackParams): AttackResult {
  const w = p.weapon;
  const dice = w.roa * p.models;
  const rolls = p.presetRolls ? p.presetRolls.slice(0, dice) : rng.rollD6(dice);
  while (rolls.length < dice) rolls.push(rng.d6());
  const need = w.hit - (p.hitMod ?? 0);
  let hits = rolls.filter((r) => r >= need).length;
  const prec = kw(w, 'PRECISION')?.v ?? 0;
  const precisionUsed = Math.min(prec, dice - hits);
  hits += precisionUsed;
  const tags = p.defenderDef.tags as string[];
  let applied = 0;
  let surge: AttackResult['surge'];
  if (w.surgeTypes.length && w.surgeDie) {
    // A Blast Template rolls no Surge die: its Surge result is the number of models it covered, passed in.
    const roll = w.surgeDie === 'BT' ? (p.presetSurge ?? 0) : p.presetSurge ?? (w.surgeDie === 'D6' ? rng.d6() : w.surgeDie === 'D3+1' ? rng.d3() + 1 : rng.d3());
    const matched = w.surgeTypes.some((t) => tags.includes(t));
    applied = matched ? Math.min(hits, roll) : 0;
    surge = { die: w.surgeDie, roll, applied, matched };
  }
  const crit = kw(w, 'CRITICAL HIT')?.v ?? 0;
  const critical = Math.min(crit, hits - applied);
  applied += critical;
  const armour = p.defenderDef.stats.armour + (p.armourMod ?? 0);
  const toSave = hits - applied;
  let saveRolls: number[] = [];
  let saved = 0;
  let toughUsed = 0;
  // With saves taken in their own step, the attack always stops there (even with nothing to save): the table
  // changes only when that step comes up, never ahead of the dice.
  const pendingSaves = !!p.manualSaves;
  if (!pendingSaves) {
    saveRolls = p.presetSaves ? p.presetSaves.slice(0, toSave) : rng.rollD6(toSave);
    while (saveRolls.length < toSave) saveRolls.push(rng.d6());
    saved = saveRolls.filter((r) => r >= armour).length;
    toughUsed = Math.min(p.toughFirst ?? 0, toSave - saved);
    saved += toughUsed;
  }
  let toDamage = toSave - saved + applied;
  let evade: AttackResult['evade'];
  const evadeValue = p.defenderDef.stats.evade ? p.defenderDef.stats.evade + (p.evadeMod ?? 0) : undefined;
  if (!pendingSaves && p.evadeReason && evadeValue && toDamage > 0) {
    const anti = kw(w, 'ANTI-EVADE')?.v ?? 0;
    const er = p.presetEvade ? p.presetEvade.slice(0, toDamage) : rng.rollD6(toDamage);
    while (er.length < toDamage) er.push(rng.d6());
    const es = er.filter((r) => r >= evadeValue + anti).length;
    evade = { value: evadeValue + anti, rolls: er, saved: es, reason: p.evadeReason };
    toDamage -= es;
  }
  const pierce = kw(w, 'PIERCE');
  const dmgPer = pierce && pierce.tag && tags.includes(pierce.tag) ? pierce.v ?? w.dmg : w.dmg;
  const damage = pendingSaves ? 0 : toDamage * dmgPer;
  const r = pendingSaves ? { ...p.defenderState, removed: 0, destroyed: false, supplyBefore: 0, supplyAfter: 0 } : applyDamage(p.defenderDef, p.defenderState, damage);
  return {
    id: `${Date.now().toString(36)}-${Math.floor(rng.next() * 1e6).toString(36)}`,
    attacker: p.attacker,
    defender: p.defender,
    weapon: w.name,
    phase: p.phase,
    models: p.models,
    dice,
    hit: need,
    hitMod: p.hitMod ?? 0,
    rolls,
    precisionUsed,
    hits,
    surge,
    critical,
    armour,
    saveRolls,
    saved,
    toughUsed,
    evade,
    dmgPer,
    damage,
    removed: r.removed,
    modelsAfter: r.models,
    destroyed: r.destroyed,
    pendingSaves,
  };
}

/** Finish an attack whose saves were entered by hand. */
export function completeSaves(a: AttackResult, saved: number, defenderDef: UnitDef, defenderState: DamageTarget): { attack: AttackResult; result: ReturnType<typeof applyDamage> } {
  const applied = (a.surge?.applied ?? 0) + a.critical;
  const toSave = a.hits - applied;
  const s = Math.max(0, Math.min(toSave, saved));
  const toDamage = toSave - s + applied;
  const damage = toDamage * a.dmgPer;
  const result = applyDamage(defenderDef, defenderState, damage);
  return { attack: { ...a, saved: s, saveRolls: [], damage, removed: result.removed, modelsAfter: result.models, destroyed: result.destroyed, pendingSaves: false }, result };
}

/** Charge distance roll. */
export function rollCharge(rng: Rng, speed: number, dice: '1d6' | '2d6high', bonus = 0): { roll: number; reach: number; rolls: number[] } {
  const rolls = dice === '2d6high' ? [rng.d6(), rng.d6()] : [rng.d6()];
  const roll = Math.max(...rolls);
  return { roll, reach: speed + roll + bonus, rolls };
}
