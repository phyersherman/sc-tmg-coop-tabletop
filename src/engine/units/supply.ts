import type { UnitDef } from '../types/units';

/** Current Supply Value for a unit with `models` models remaining. */
export function currentSupply(def: UnitDef, models: number): number {
  if (models <= 0) return 0;
  for (const t of def.squadProfile) if (models >= t.min && models <= t.max) return t.supply;
  // Above the top bracket (should not happen) -> use highest.
  const top = def.squadProfile[def.squadProfile.length - 1];
  return top ? top.supply : 0;
}

/** Supply Pool for a round. Infinity on the final round. */
export function poolForRound(start: number, escalation: number, round: number, finalRound: number): number {
  if (round >= finalRound) return Number.POSITIVE_INFINITY;
  return start + escalation * Math.max(0, round - 1);
}

export function availableSupply(pool: number, onTableSupply: number): number {
  return pool === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(0, pool - onTableSupply);
}

export function canDeploy(unitSupply: number, available: number): boolean {
  return unitSupply <= available;
}

/** Highest models count that keeps the unit within the supply bracket of `models` (for RESPAWN). */
export function maxModelsInSameBracket(def: UnitDef, models: number): number {
  const s = currentSupply(def, models);
  let best = models;
  for (const t of def.squadProfile) if (t.supply === s) best = Math.max(best, t.max);
  return best;
}
