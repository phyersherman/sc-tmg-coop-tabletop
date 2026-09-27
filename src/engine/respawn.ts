import type { GameState } from './types/game';
import type { AiUnitInstance } from './types/army';
import { DIFFICULTIES } from './difficulty';
import { hasMutator } from './mutators/index';
import { unitById } from '@data/index';
import { instanceCost } from './army/builder';
import { aiSupplyInReserves, aiSupplyOnTable, poolNow } from './director/selectors';

/** Schedule returns for units destroyed this round. Returns log lines. */
export function scheduleRespawns(state: GameState): string[] {
  const d = DIFFICULTIES[state.config.difficulty];
  const lines: string[] = [];
  const died = state.army.units.filter((u) => u.location === 'destroyed' && u.destroyedRound === state.round && !u.special?.noRespawn);
  const usedTotal = state.army.units.reduce((a, u) => a + u.respawns, 0) + state.respawnQueue.length;
  const maxTotal = d.respawn.maxTotal + (d.respawn.mode === 'limited' ? state.config.players - 1 : 0);
  let used = usedTotal;
  for (const u of died) {
    if (state.respawnQueue.some((q) => q.unitId === u.id)) continue;
    let ok = false;
    let pct = d.respawn.modelsPct;
    let delay = d.respawn.delayRounds;
    if (d.respawn.mode === 'unlimited') ok = true;
    else if (d.respawn.mode === 'limited') ok = used < maxTotal;
    else if (d.respawn.mode === 'pooled') {
      const cost = instanceCost(unitById(u.defId), u);
      if (state.respawnBudget >= cost) {
        state.respawnBudget -= cost;
        ok = true;
      }
    }
    // The shortfall pool (aiDropsAnywhere): what the collection could not field comes back as the fallen return.
    if (!ok && state.config.options.aiDropsAnywhere) {
      const cost = instanceCost(unitById(u.defId), u);
      if (state.respawnBudget >= cost) {
        state.respawnBudget -= cost;
        ok = true;
        pct = 1;
      }
    }
    if (!ok && hasMutator(state, 'justDie') && u.respawns === 0) {
      ok = true;
      pct = 1;
    }
    if (ok && hasMutator(state, 'voidReanimators')) {
      delay = 0;
      pct = Math.min(pct, 0.5);
    }
    if (!ok) continue;
    used++;
    state.respawnQueue.push({ unitId: u.id, returnRound: state.round + delay, modelsPct: pct });
    lines.push(`${u.label} will return to Reserves ${delay === 0 ? 'immediately' : `in round ${state.round + delay}`}.`);
  }
  return lines;
}

/** Fairness floor: if the AI has too little supply for two rounds, bring one unit back. */
export function fairnessFloor(state: GameState): string | null {
  const pool = poolNow(state);
  if (pool === Infinity) return null;
  const have = aiSupplyOnTable(state) + aiSupplyInReserves(state);
  if (have < 0.4 * pool) state.lowSupplyRounds++;
  else state.lowSupplyRounds = 0;
  if (state.lowSupplyRounds < 2) return null;
  const cand = state.army.units
    .filter((u) => u.location === 'destroyed' && !state.respawnQueue.some((q) => q.unitId === u.id) && !u.special?.noRespawn)
    .sort((a, b) => (b.destroyedRound ?? 0) - (a.destroyedRound ?? 0))[0];
  if (!cand) return null;
  state.lowSupplyRounds = 0;
  state.respawnQueue.push({ unitId: cand.id, returnRound: state.round + 1, modelsPct: 1 });
  return `Reinforcements: ${cand.label} returns to Reserves next round (the AI was under-strength).`;
}

/** Bring back units whose return round has come. */
export function processReturns(state: GameState): string[] {
  const lines: string[] = [];
  const keep: typeof state.respawnQueue = [];
  for (const q of state.respawnQueue) {
    if (q.returnRound > state.round) {
      keep.push(q);
      continue;
    }
    const u = state.army.units.find((x) => x.id === q.unitId) as AiUnitInstance | undefined;
    if (!u) continue;
    const def = unitById(u.defId);
    u.location = 'reserves';
    u.models = Math.max(1, Math.ceil(u.maxModels * q.modelsPct));
    u.damageMarker = 0;
    u.shieldsLeft = def.stats.shields ?? 0;
    u.engaged = false;
    u.engagedEnemySupply = 0;
    u.atObjective = false;
    // A unit returned to Reserves loses SIEGE MODE.
    u.statuses = (u.statuses ?? []).filter((x) => x !== 'Siege Mode');
    delete u.lastMarker;
    delete u.deployedRound;
    delete u.est;
    u.respawns++;
    u.activated = { movement: false, assault: false, combat: false };
    lines.push(`${u.label} is back in Reserves with ${u.models} model${u.models === 1 ? '' : 's'}.`);
  }
  state.respawnQueue = keep;
  return lines;
}
