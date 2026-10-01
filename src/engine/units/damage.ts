import type { UnitDef } from '../types/units';
import { currentSupply, maxModelsInSameBracket } from './supply';

export interface DamageTarget {
  models: number;
  damageMarker: number;
  shieldsLeft: number;
}

export interface DamageResult extends DamageTarget {
  removed: number;
  destroyed: boolean;
  supplyBefore: number;
  supplyAfter: number;
}

/**
 * Apply `dmg` total damage to a unit following 8.7.4 step 5.
 * Shields add to the HP of the first model and are gone once that model is removed.
 * `maxRemovable` caps casualties (visible-model rule / CONCENTRATED FIRE); excess is discarded.
 */
export function applyDamage(
  def: UnitDef,
  target: DamageTarget,
  dmg: number,
  opts: { maxRemovable?: number; /** Hit Points of each model when an upgrade changes them (Kinetic Foam). */ hp?: number } = {},
): DamageResult {
  const supplyBefore = currentSupply(def, target.models);
  const baseHp = opts.hp ?? def.stats.hp;
  let models = target.models;
  let shieldsLeft = target.shieldsLeft;
  let total = target.damageMarker + Math.max(0, Math.floor(dmg));
  let removed = 0;
  const cap = opts.maxRemovable ?? Number.POSITIVE_INFINITY;
  while (models > 0 && removed < cap) {
    const hp = baseHp + shieldsLeft;
    if (total < hp) break;
    total -= hp;
    models--;
    removed++;
    shieldsLeft = 0;
  }
  if (models === 0) total = 0;
  // The cap is reached (the Visible models, or CONCENTRATED FIRE): what is left of the Total Damage is discarded.
  // It is not recorded on the Damage Marker and does not carry over.
  else if (removed >= cap && cap !== Number.POSITIVE_INFINITY) total = 0;
  return {
    models,
    damageMarker: models === 0 ? 0 : total,
    shieldsLeft,
    removed,
    destroyed: models === 0,
    supplyBefore,
    supplyAfter: currentSupply(def, models),
  };
}

/** HEAL (X): reduce accumulated damage. */
export function heal(target: DamageTarget, x: number): DamageTarget {
  return { ...target, damageMarker: Math.max(0, target.damageMarker - x) };
}

/** RESPAWN (X): return up to X models without crossing into a higher supply bracket. */
export function respawnModels(def: UnitDef, target: DamageTarget, x: number, maxModels: number): DamageTarget {
  const limit = Math.min(maxModels, maxModelsInSameBracket(def, target.models));
  const models = Math.min(limit, target.models + x);
  return { ...target, models };
}

export function initialTarget(def: UnitDef, models: number): DamageTarget {
  return { models, damageMarker: 0, shieldsLeft: def.stats.shields ?? 0 };
}
