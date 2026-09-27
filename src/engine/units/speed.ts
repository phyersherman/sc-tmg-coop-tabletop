import type { UnitDef } from '../types/units';

/**
 * Speed in inches from a split value like 4"/7": a unit with more than one model moves at the lower value; a
 * single model (once one remains, or a single-model unit) moves at the higher one.
 */
export function speedFor(def: UnitDef, models: number): number {
  if (!def.stats.speed) return 0;
  const [a, b] = def.stats.speed;
  return models <= 1 ? Math.max(a, b) : Math.min(a, b);
}

