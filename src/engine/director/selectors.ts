import type { GameState } from '../types/game';
import type { AiUnitInstance } from '../types/army';
import { unitById } from '@data/index';
import { currentSupply, poolForRound } from '../units/supply';

export const onTable = (s: GameState): AiUnitInstance[] => s.army.units.filter((u) => u.location === 'table');
export const reserves = (s: GameState): AiUnitInstance[] => s.army.units.filter((u) => u.location === 'reserves');
export const destroyed = (s: GameState): AiUnitInstance[] => s.army.units.filter((u) => u.location === 'destroyed');

export function unitSupply(u: AiUnitInstance): number {
  return currentSupply(unitById(u.defId), u.models);
}

/**
 * A unit holding its ground: set on the table at the start (a garrison), it does not move, run or charge before
 * round `special.holdUntil`. It still shoots, and fights what engages it.
 */
/** A Structure (official rule): never activated, never acts, Supply 0, and never controls or contests a marker. */
export function isStructure(u: AiUnitInstance): boolean {
  return unitById(u.defId).abilities.some((a) => a.name === 'Structure');
}

/** What stands on a co-op side marker (a guard or a structure): not part of the AI's force, and outside its pool. */
export const onSideMarker = (u: AiUnitInstance): boolean => typeof u.special?.sideMarker === 'number';

export function heldInPlace(s: GameState, u: AiUnitInstance): boolean {
  return Number(u.special?.holdUntil ?? 0) > s.round;
}

/** What a garrison unit costs the AI's pool: half its Supply, and never nothing. */
export const garrisonSupply = (supply: number) => Math.max(1, Math.round(supply / 2));

/**
 * AI Supply on the table, against its Supply Pool. A mission's garrison (set on its objectives before the game,
 * paid for out of the enemy's budget) counts at half its Supply, at least one apiece: it is on the table, but the
 * rest of the force still comes on behind it.
 */
export function aiSupplyOnTable(s: GameState): number {
  return onTable(s).reduce((a, u) => a + (onSideMarker(u) ? 0 : typeof u.special?.guard === 'number' ? garrisonSupply(unitSupply(u)) : unitSupply(u)), 0);
}

export function aiSupplyInReserves(s: GameState): number {
  return reserves(s).reduce((a, u) => a + unitSupply(u), 0);
}

export function poolNow(s: GameState): number {
  const p = poolForRound(s.supply.start, s.supply.escalation, s.round, s.finalRound);
  return p === Infinity ? p : p + (s.supply.bonus ?? 0);
}

export function availableNow(s: GameState): number {
  const p = poolNow(s);
  return p === Infinity ? Infinity : Math.max(0, p - aiSupplyOnTable(s));
}

/**
 * AI units the player is allowed to see: the ones on the table (or already destroyed/exited). Units waiting
 * in Reserves are hidden while `hideAiRoster` is set, so the enemy force is only revealed as it deploys.
 * Everything is revealed once the game is over.
 */
export function visibleAiUnits(s: GameState): AiUnitInstance[] {
  if (!s.config.options.hideAiRoster || s.step.kind === 'GAME_OVER') return s.army.units;
  return s.army.units.filter((u) => u.location !== 'reserves');
}

export function findUnit(s: GameState, id: string): AiUnitInstance {
  const u = s.army.units.find((x) => x.id === id);
  if (!u) throw new Error(`Unknown AI unit ${id}`);
  return u;
}

export function aiAlive(s: GameState): boolean {
  // What stands on a side marker is not the AI's force: wiping out the force still wins with those left.
  return s.army.units.some((u) => (u.location === 'table' || u.location === 'reserves') && !onSideMarker(u)) || s.respawnQueue.length > 0;
}

/** Stable key for the AI order currently waiting, used by the UI turn-change gate. */
export function aiOrderKey(state: GameState): string | null {
  if (state.step.kind !== 'AI_ORDER') return null;
  return `${state.round}:${state.phase}:${state.step.order.unitId}:${state.log.length}`;
}
