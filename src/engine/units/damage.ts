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
  opts: { maxRemovable?: number } = {},
): DamageResult {
  const supplyBefore = currentSupply(def, target.models);
  let models = target.models;
  let shieldsLeft = target.shieldsLeft;
  let total = target.damageMarker + Math.max(0, Math.floor(dmg));
  let removed = 0;
  const cap = opts.maxRemovable ?? Number.POSITIVE_INFINITY;
  while (models > 0 && removed < cap) {
    const hp = def.stats.hp + shieldsLeft;
    if (total < hp) break;
    total -= hp;
    models--;
    removed++;
    shieldsLeft = 0;
  }
  if (models === 0) total = 0;
  else if (removed >= cap && cap !== Number.POSITIVE_INFINITY) total = target.damageMarker; // excess discarded, marker unchanged
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
