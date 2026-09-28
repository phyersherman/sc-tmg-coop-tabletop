import type { AiUnitInstance } from '../types/army';
import { unitById } from '@data/index';

/**
 * BURROWED on an AI unit (Part 2.4 statuses). A Burrowed unit may only Move, Run, Disengage, Hold or Close Ranks;
 * any action but Hold ends the status, except that Tunneling Claws keeps it through Move and Run.
 */
export const aiBurrowed = (u: AiUnitInstance): boolean => !!u.special?.burrowed || (u.statuses ?? []).includes('Burrowed');

export function setAiBurrowed(u: AiUnitInstance, on: boolean): void {
  const rest = (u.statuses ?? []).filter((s) => s !== 'Burrowed');
  u.statuses = on ? [...rest, 'Burrowed'] : rest;
  if (!on && u.special?.burrowed) delete u.special.burrowed;
}

/** The unit has this ability: printed on its card, or an upgrade the AI bought. */
export function aiHas(u: AiUnitInstance, name: string): boolean {
  return unitById(u.defId).abilities.some((a) => a.name === name && (!a.upgradeCost || u.upgrades.includes(a.id)));
}
