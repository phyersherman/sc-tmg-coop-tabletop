import type { PlayerUnit } from './types';
import type { UnitDef } from '../types/units';
import { unitById } from '@data/index';
import { currentSupply } from '../units/supply';

export function playerUnitDef(pu: PlayerUnit): UnitDef {
  return unitById(pu.defId);
}

export function playerUnitSupply(pu: PlayerUnit): number {
  if (pu.destroyed || pu.models <= 0) return 0;
  return currentSupply(playerUnitDef(pu), pu.models);
}

export function playerUnitFlying(pu: PlayerUnit): boolean {
  return playerUnitDef(pu).tags.includes('Flying');
}

export function playerUnitSize(pu: PlayerUnit): number {
  // BURROWED units count as Size 0 for all purposes.
  if ((pu.statuses ?? []).includes('Burrowed')) return 0;
  // A Siege Tank in SIEGE MODE is treated as Size 3 (Mode Transformation).
  if ((pu.statuses ?? []).includes('Siege Mode')) return Math.max(3, playerUnitDef(pu).stats.size);
  return playerUnitDef(pu).stats.size;
}


/** An AI unit's Size as it stands: a Siege Tank that has dug in counts as Size 3, as the player's does. */
export function aiUnitSize(u: { defId: string; statuses?: readonly string[]; special?: Record<string, unknown> }): number {
  // BURROWED: Size 0 for all purposes.
  if ((u.statuses ?? []).includes('Burrowed') || u.special?.burrowed) return 0;
  const size = unitById(u.defId).stats.size;
  return (u.statuses ?? []).includes('Siege Mode') ? Math.max(3, size) : size;
}

export function makePlayerUnit(id: string, defId: string, composition: 'small' | 'large', upgrades: string[], name?: string, tagId?: number): PlayerUnit {
  const def = unitById(defId);
  const comp = def.compositions.find((c) => c.label === composition) ?? def.compositions[0];
  const models = comp?.models ?? 1;
  const pu: PlayerUnit = { id, name: name ?? def.name, defId, composition, upgrades, maxModels: models, models, damageMarker: 0, shieldsLeft: def.stats.shields ?? 0, destroyed: false, location: 'reserves', activated: { movement: false, assault: false, combat: false }, engaged: false, engagedWith: [], disengagedThisRound: false };
  if (tagId !== undefined) pu.tagId = tagId;
  return pu;
}


/** Fill fields added after a unit was saved. */
export function normalizePlayerUnit(pu: PlayerUnit): PlayerUnit {
  pu.location ??= pu.destroyed ? 'destroyed' : 'reserves';
  pu.activated ??= { movement: false, assault: false, combat: false };
  pu.engaged ??= false;
  pu.engagedWith ??= [];
  pu.disengagedThisRound ??= false;
  return pu;
}
