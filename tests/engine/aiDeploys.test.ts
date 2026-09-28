import { describe, expect, it } from 'vitest';
import { deploymentById, unitById } from '@data/index';
import { createGame, apply } from '@engine/director/reducer';
import { mapLayout, remixId } from '@engine/terrain/remix';
import { poolNow, aiSupplyOnTable } from '@engine/director/selectors';
import { currentSupply } from '@engine/units/supply';
import type { GameState } from '@engine/types/game';
import { makeConfig } from './helpers';

/** Plays the first Movement phase with the players passing, and returns the state once it is over. */
function firstMovement(modeId: string, seed: number): GameState {
  const cfg = makeConfig({ modeId, aiFaction: 'Terran', playMode: 'tabletop', seed });
  const dep = deploymentById(cfg.deploymentId);
  let s = createGame(cfg, dep, mapLayout(remixId(dep.scale, cfg.terrainSeed), dep));
  for (let i = 0; i < 200 && s.round === 1 && s.phase === 'movement'; i++) {
    if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
    else if (s.step.kind === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
    else s = apply(s, { t: 'continue' });
  }
  return s;
}

describe('AI deployment', () => {
  it('fills its Supply Pool in an official mission, whatever order card it drew', () => {
    // Seeds 1, 4 and 6 draw Dig In or Focus Fire, which let the AI bring on one unit a round in co-op missions.
    for (const seed of [1, 2, 4, 6]) {
      const s = firstMovement('frontlines', seed);
      const room = poolNow(s) - aiSupplyOnTable(s);
      const fits = s.army.units.filter((u) => u.location === 'reserves' && currentSupply(unitById(u.defId), u.models) <= room);
      expect(fits.map((u) => u.label), `seed ${seed}: ${room} Supply unused`).toEqual([]);
    }
  });
});
