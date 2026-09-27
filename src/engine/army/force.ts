import { unitById } from '@data/index';

/** A unit as you buy it: which unit, how big, and its upgrades. */
export interface UnitChoice { defId: string; composition: 'small' | 'large'; upgrades: string[] }

/** Minerals a unit costs with its upgrades. */
export function configCostOf(cfg: UnitChoice): number {
  const def = unitById(cfg.defId);
  const comp = def.compositions.find((c) => c.label === cfg.composition) ?? def.compositions[0];
  let cost = comp?.cost ?? 0;
  for (const id of cfg.upgrades) {
    const uc = def.weapons.find((w) => w.id === id)?.upgradeCost ?? def.abilities.find((a) => a.id === id)?.upgradeCost;
    if (uc) cost += cfg.composition === 'large' ? uc.large : uc.small;
  }
  return cost;
}

/** What a force is worth. */
export const forceCost = (force: UnitChoice[]) => force.reduce((sum, u) => sum + configCostOf(u), 0);
