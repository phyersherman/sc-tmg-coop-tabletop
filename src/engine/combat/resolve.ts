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
  /** Dice rolled by models beyond the weapon's Range (LONG RANGE): the last of `rolls`, at one harder to hit. */
  farDice?: number;
  /** The most models this attack may remove: the Visible ones, or CONCENTRATED FIRE (X). Whatever is left over is discarded. */
  maxRemovable?: number;
  /** Made with an INSTANT weapon: Enemy Units cannot declare or resolve Reactions to it. */
  instant?: boolean;
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
  /** LONG RANGE: how many of the attacking models are beyond the weapon's Range. They roll at -1 to Hit. */
  farModels?: number;
  /** The models of the target Visible to the attacker: no more than these can be removed (Part 8.7.4, step 5). */
  maxRemovable?: number;
  /** TOUGH the defender has on every Armour Roll, on top of `toughFirst`. */
  tough?: number;
  /** DODGE (X) on the defender: that many fewer dice skip Armour by Surge or CRITICAL HIT. */
  dodge?: number;
  /** Hit Points of the defender's models when an upgrade changes them (Kinetic Foam). */
  defenderHp?: number;
  /** Dice removed from the Attack Pool before it is rolled. */
  fewerDice?: number;
}

const kw = (w: WeaponProfile, k: string) => w.keywords.find((x) => x.k === k);

/**
 * A Target Number after its Modifiers (Part 3.4): never below 2+ and never above 6+, so a roll of 6 always succeeds
 * and a roll of 1 always fails (Part 3.6).
 */
export const targetNumber = (n: number): number => Math.max(2, Math.min(6, Math.round(n)));

/** The most models an attack with this weapon may remove: CONCENTRATED FIRE (X), and no more than are Visible. */
export function removalCap(w: WeaponProfile, visible?: number): number | undefined {
  const cf = kw(w, 'CONCENTRATED FIRE')?.v;
  if (cf === undefined && visible === undefined) return undefined;
  return Math.min(cf ?? Infinity, visible ?? Infinity);
}

/** Full official attack sequence: hit → Surge/Critical → Armour → Evade → damage → casualties. */
export function resolveAttack(rng: Rng, p: AttackParams): AttackResult {
  const w = p.weapon;
  // Dice a defensive ability took out of the Attack Pool (Guardian Shield, Point Defense Laser) are never rolled.
  const dice = Math.max(0, w.roa * p.models - Math.max(0, p.fewerDice ?? 0));
  const rolls = p.presetRolls ? p.presetRolls.slice(0, dice) : rng.rollD6(dice);
  while (rolls.length < dice) rolls.push(rng.d6());
  const need = targetNumber(w.hit - (p.hitMod ?? 0));
  // LONG RANGE: the models beyond the weapon's Range roll their dice apart, at one harder (the last dice of the pool).
  const farDice = Math.max(0, Math.min(dice, w.roa * Math.max(0, p.farModels ?? 0)));
  const farNeed = targetNumber(need + 1);
  let hits = rolls.filter((r, i) => r >= (i >= dice - farDice ? farNeed : need)).length;
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
  let critical = Math.min(crit, hits - applied);
  // DODGE (X): that many fewer dice leave the Armour Pool by Surge or CRITICAL HIT.
  let dodge = Math.max(0, p.dodge ?? 0);
  if (dodge && surge) { const back = Math.min(dodge, surge.applied); surge = { ...surge, applied: surge.applied - back }; applied -= back; dodge -= back; }
  if (dodge) critical = Math.max(0, critical - dodge);
  applied += critical;
  const armour = targetNumber(p.defenderDef.stats.armour + (p.armourMod ?? 0));
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
    toughUsed = Math.min((p.toughFirst ?? 0) + (p.tough ?? 0), toSave - saved);
    saved += toughUsed;
  }
  let toDamage = toSave - saved + applied;
  let evade: AttackResult['evade'];
  // A Null Value (-) never makes an Evade Roll; otherwise ANTI-EVADE and DEBUFFs move the Target Number, within 2+..6+.
  const anti = kw(w, 'ANTI-EVADE')?.v ?? 0;
  const evadeValue = p.defenderDef.stats.evade ? targetNumber(p.defenderDef.stats.evade + (p.evadeMod ?? 0) + anti) : undefined;
  if (!pendingSaves && p.evadeReason && evadeValue && toDamage > 0) {
    const er = p.presetEvade ? p.presetEvade.slice(0, toDamage) : rng.rollD6(toDamage);
    while (er.length < toDamage) er.push(rng.d6());
    const es = er.filter((r) => r >= evadeValue).length;
    evade = { value: evadeValue, rolls: er, saved: es, reason: p.evadeReason };
    toDamage -= es;
  }
  const pierce = kw(w, 'PIERCE');
  const dmgPer = pierce && pierce.tag && tags.includes(pierce.tag) ? pierce.v ?? w.dmg : w.dmg;
  const damage = pendingSaves ? 0 : toDamage * dmgPer;
  const maxRemovable = removalCap(w, p.maxRemovable);
  const r = pendingSaves ? { ...p.defenderState, removed: 0, destroyed: false, supplyBefore: 0, supplyAfter: 0 } : applyDamage(p.defenderDef, p.defenderState, damage, { maxRemovable, hp: p.defenderHp });
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
    ...(farDice ? { farDice } : {}),
    ...(kw(w, 'INSTANT') ? { instant: true } : {}),
    ...(maxRemovable !== undefined ? { maxRemovable } : {}),
  };
}

/** Finish an attack whose saves were entered by hand. */
export function completeSaves(a: AttackResult, saved: number, defenderDef: UnitDef, defenderState: DamageTarget, hp?: number): { attack: AttackResult; result: ReturnType<typeof applyDamage> } {
  const applied = (a.surge?.applied ?? 0) + a.critical;
  const toSave = a.hits - applied;
  const s = Math.max(0, Math.min(toSave, saved));
  const toDamage = toSave - s + applied;
  const damage = toDamage * a.dmgPer;
  const result = applyDamage(defenderDef, defenderState, damage, { maxRemovable: a.maxRemovable, hp });
  return { attack: { ...a, saved: s, saveRolls: [], damage, removed: result.removed, modelsAfter: result.models, destroyed: result.destroyed, pendingSaves: false }, result };
}

/** Charge distance roll. */
export function rollCharge(rng: Rng, speed: number, dice: '1d6' | '2d6high', bonus = 0): { roll: number; reach: number; rolls: number[] } {
  const rolls = dice === '2d6high' ? [rng.d6(), rng.d6()] : [rng.d6()];
  const roll = Math.max(...rolls);
  return { roll, reach: speed + roll + bonus, rolls };
}
