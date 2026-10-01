import type { SurgeDie, SurgeType, UnitDef, WeaponKeyword, WeaponProfile } from '../types/units';

/**
 * A weapon as its unit actually fires it: the profile on the card, changed by the unit's own Passive abilities and
 * purchased upgrades, and by the keywords that depend on the target (BURST FIRE, LOCKED IN). One reckoning for both
 * sides, so a player's Hydralisks and the AI's carry the same Grooved Spines.
 */
export interface FiringContext {
  def: UnitDef;
  upgrades: readonly string[];
  statuses?: readonly string[];
  /** The target, when it is known. */
  target?: {
    def: UnitDef;
    /** Its Size as it stands (a Burrowed unit is 0, a Siege Tank in SIEGE MODE is 3). */
    size: number;
    /** It has the Stationary Status: no model of it moved, was moved or was PLACED this Round. */
    stationary?: boolean;
    /** It is Engaged with at least one other Unit friendly to the attacker (We Stand as One). */
    engagedWithOtherFriendly?: boolean;
    /** It has already been Activated during this Phase (Fury of the Nerazim). */
    activated?: boolean;
  };
  /** The gap between the closest bases of the two units, in inches. Null when positions are not known. */
  targetDist: number | null;
  /** Attacker and target are both Within 3" of the same Mission Marker (Fury Unyielding). */
  sharedMarker?: boolean;
  /** The target is Within 4" of a friendly Shade token whose Adepts have Psionic Presence. */
  nearShade?: boolean;
}

/** Whether a unit has this ability: printed on its card, or an upgrade it bought. */
export function ownsAbility(def: UnitDef, upgrades: readonly string[], name: string): boolean {
  return def.abilities.some((a) => a.name === name && (!a.upgradeCost || upgrades.includes(a.id)));
}

/** Keywords do not stack: a numeric keyword gained twice keeps only its highest value (Part 2.6.1). */
export function raiseKeyword(keywords: WeaponKeyword[], k: string, v?: number): void {
  const kw = keywords.find((x) => x.k === k);
  if (!kw) keywords.push(v === undefined ? { k } : { k, v });
  else if (v !== undefined) kw.v = Math.max(kw.v ?? 0, v);
}

export function firedWeapon(w: WeaponProfile, ctx: FiringContext): { weapon: WeaponProfile; notes: string[] } {
  const has = (name: string) => ownsAbility(ctx.def, ctx.upgrades, name);
  const keywords = w.keywords.map((k) => ({ ...k }));
  const notes: string[] = [];
  const name = w.name.toLowerCase();
  const ranged = w.phase === 'Assault' && w.range !== 'E';
  const melee = w.phase === 'Combat';
  const d = ctx.targetDist;
  let roa = w.roa;
  let dmg = w.dmg;
  let surgeTypes = w.surgeTypes.slice() as SurgeType[];
  let surgeDie: SurgeDie | undefined = w.surgeDie;
  const gain = (k: string, v: number | undefined, note: string) => { raiseKeyword(keywords, k, v); notes.push(note); };

  if (has('Ares-Class Targeting System') && /autocannon|underbelly machine gun/.test(name)) gain('PRECISION', 1, 'Ares-Class Targeting System');
  if (has('Guidance') && /glaive cannon/.test(name)) gain('ANTI-EVADE', 2, 'Guidance');
  if (has('Hydriodic Bile') && /acid saliva/.test(name)) { surgeTypes = ['Light']; surgeDie = 'D3+1'; notes.push('Hydriodic Bile'); }
  if (has('Laser Targeting Systems') && /quad k12/.test(name)) gain('LONG RANGE', 16, 'Laser Targeting Systems');
  if (has('Grooved Spines') && /needle spines/.test(name)) gain('LONG RANGE', 16, 'Grooved Spines');
  if (melee && has('Adrenal Glands') && /claws/.test(name)) gain('PRECISION', 2, 'Adrenal Glands');
  if (melee && has('We Stand as One') && ctx.target?.engagedWithOtherFriendly) gain('PRECISION', 2, 'We Stand as One');
  if (melee && has('Titan Killers') && ctx.target && ctx.target.size >= 3) { dmg = Math.max(dmg, 2); notes.push('Titan Killers'); }
  // The Marine's range upgrades: a C-14 Rifle at a target Within 8".
  if (ranged && /c-14/.test(name) && d !== null && d <= 8) {
    if (has('Slugthrower')) gain('ANTI-EVADE', 1, 'Slugthrower');
    if (has('Grenades - Frag') && surgeDie) { surgeDie = 'D6'; notes.push('Grenades - Frag'); }
  }
  if (ranged && has('For the Ancients') && d !== null && d > 8) gain('PRECISION', 1, 'For the Ancients');
  if (ranged && has('Fury Unyielding') && ctx.sharedMarker) gain('CRITICAL HIT', 1, 'Fury Unyielding');
  if (ctx.nearShade) gain('PRECISION', 1, 'Psionic Presence');
  if (ranged && has('Fury of the Nerazim') && /particle disruptors/.test(name) && ctx.target?.activated) gain('INSTANT', undefined, 'Fury of the Nerazim');
  // Aftershock Rounds: in SIEGE MODE the shell does Damage equal to the target's Size (at least 1).
  if ((ctx.statuses ?? []).includes('Siege Mode') && has('Aftershock Rounds') && ctx.target) { dmg = Math.max(1, ctx.target.size); notes.push('Aftershock Rounds'); }
  // BURST FIRE Y" (X): +X RoA at a target Within Y" of the attacking model.
  const burst = keywords.find((k) => k.k === 'BURST FIRE');
  if (ranged && burst?.v && d !== null && d <= (burst.range ?? 0)) { roa += burst.v; notes.push('BURST FIRE'); }
  // LOCKED IN (X): +X RoA at a target that has the Stationary Status.
  const locked = keywords.find((k) => k.k === 'LOCKED IN');
  if (ranged && locked?.v && ctx.target?.stationary) { roa += locked.v; notes.push('LOCKED IN'); }
  return { weapon: { ...w, keywords, roa, dmg, surgeTypes, surgeDie }, notes };
}

/** Hit Points of each model of a unit: Kinetic Foam adds one. */
export function unitHp(def: UnitDef, upgrades: readonly string[]): number {
  return def.stats.hp + (ownsAbility(def, upgrades, 'Kinetic Foam') ? 1 : 0);
}

/** Veteran of Tarsonis: +1 to Armour (the roll needs one less) while the unit is Within 3" of a Mission Marker. */
export function armourBonus(def: UnitDef, upgrades: readonly string[], nearMarker: boolean): number {
  return nearMarker && ownsAbility(def, upgrades, 'Veteran of Tarsonis') ? 1 : 0;
}

/** Devastating Charge with My Life for Aiur: each eligible model generates one more IMPACT die. */
export function impactDice(def: UnitDef, upgrades: readonly string[]): number {
  if (!def.impact) return 0;
  return def.impact.dice + (ownsAbility(def, upgrades, 'My Life for Aiur') ? 1 : 0);
}
