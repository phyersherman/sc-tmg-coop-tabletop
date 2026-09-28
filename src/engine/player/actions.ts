/**
 * What one of your units can do right now, and why not. One source for the command card, map clicks and prompts.
 * Reasons describe legality only (never odds or outcomes).
 */
import type { GameState } from '../types/game';
import type { PlayerUnit } from '../sense/types';
import { chargeOptions, checkCharge, playerAvailable, playerCanAct, playerWeapons, validTargets, weaponSpent } from './rules';
import { playerUnitFlying, playerUnitSupply } from '../sense/playerUnits';
import { unitAbilities } from '../abilities/index';

export type ActionId = 'deploy' | 'move' | 'run' | 'disengage' | 'hold' | 'charge' | 'closeRanks' | 'endActivation' | `weapon:${string}` | `ability:${string}`;

export interface UnitAction {
  id: ActionId;
  label: string;
  enabled: boolean;
  /** Why it cannot be taken; or, for one that can, what still stands in its way (no target in sight yet). */
  reason?: string;
}

const isBurrowed = (pu: PlayerUnit) => (pu.statuses ?? []).includes('Burrowed');

export function availableActions(state: GameState, pu: PlayerUnit): UnitAction[] {
  const out: UnitAction[] = [];
  const turn = state.step.kind === 'PLAYERS_TURN';
  const phase = state.phase;
  const other = state.activeUnitId && state.activeUnitId !== pu.id ? state.playerUnits.find((p) => p.id === state.activeUnitId) : null;
  const acted = phase !== 'scoring' && pu.activated[phase];
  // The first reason that blocks every action of this unit.
  const blocked = !turn ? 'Wait for your turn'
    : other ? `Finish ${other.name}'s activation first`
    : pu.destroyed ? 'Destroyed'
    : pu.summoned ? 'Structures do not activate'
    : undefined;
  const add = (id: ActionId, label: string, reason?: string, hint?: string) => out.push({ id, label, enabled: !reason, reason: reason ?? hint });

  if (state.activeUnitId === pu.id && turn) add('endActivation', 'End activation');

  if (pu.location === 'reserves') {
    if (phase === 'movement') {
      const need = playerUnitSupply(pu);
      const avail = playerAvailable(state, pu.owner ?? 0);
      add('deploy', 'Deploy', blocked ?? (acted ? 'Already acted this phase' : need > avail ? `Needs ${need} Supply, ${avail} available` : !playerCanAct(state, pu) ? 'Cannot deploy now' : undefined));
    }
    return out;
  }
  if (pu.location !== 'table') return out;

  if (phase === 'movement') {
    add(pu.engaged ? 'disengage' : 'move', pu.engaged ? 'Disengage' : 'Move', blocked ?? (acted ? 'Already acted this phase' : undefined));
    add('hold', 'Hold', blocked ?? (acted ? 'Already acted this phase' : undefined));
  } else if (phase === 'assault') {
    const burrowed = isBurrowed(pu);
    for (const w of playerWeapons(state, pu)) {
      // Once it has fired, a unit may still use each SIDEARM (and its main weapon after a SIDEARM) in the same activation.
      const spent = acted ? weaponSpent(state, pu, w) : null;
      // With no target in sight the weapon can still be picked, to see its range on the map.
      const reason = blocked ?? spent ?? (burrowed ? 'Burrowed. Unburrow first' : pu.disengagedThisRound ? 'Disengaged this round' : undefined);
      add(`weapon:${w.id}`, w.name, reason, validTargets(state, pu, w).length ? undefined : 'No target in range and Line of Sight');
    }
    if (!pu.engaged) {
      const reachable = chargeOptions(state, pu).some((c) => checkCharge(state, pu, c.unit).ok);
      add('charge', 'Charge', blocked ?? (acted ? 'Already acted this phase' : burrowed ? 'Burrowed. Unburrow first' : playerUnitFlying(pu) ? 'Flying units cannot charge' : pu.disengagedThisRound ? 'Disengaged this round' : reachable ? undefined : 'No enemy within charge reach'));
      add('run', 'Run', blocked ?? (acted ? 'Already acted this phase' : undefined));
    }
    add('hold', 'Hold', blocked ?? (acted ? 'Already acted this phase' : undefined));
  } else if (phase === 'combat') {
    add('closeRanks', 'Close Ranks', blocked ?? (acted ? 'Already fought this phase' : !pu.engaged ? 'Not engaged' : pu.closedRanksRound === state.round ? 'Already closed ranks' : undefined));
    for (const w of playerWeapons(state, pu)) {
      add(`weapon:${w.id}`, w.name, blocked ?? (acted ? weaponSpent(state, pu, w) : null) ?? (!pu.engaged ? 'Not engaged' : validTargets(state, pu, w).length ? undefined : 'No enemy in Engagement Range'));
    }
  }
  for (const a of unitAbilities(state, pu)) {
    if (a.ability.kind === 'Passive' || !a.spec) continue;
    add(`ability:${a.ability.name}`, a.ability.name, a.ok ? (blocked && a.ability.kind === 'Active' ? blocked : undefined) : a.reason);
  }
  return out;
}

/** Your units that still have something they can do this phase (for Tab cycling and the pass reminder). */
export function unitsWithActions(state: GameState): PlayerUnit[] {
  return state.playerUnits.filter((pu) => playerCanAct(state, pu) && availableActions(state, pu).some((a) => a.enabled && a.id !== 'endActivation'));
}
