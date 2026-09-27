import { describe, expect, it } from 'vitest';
import { createGame, apply } from '@engine/director/reducer';
import { makeConfig } from './helpers';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { deploymentById } from '@data/index';

describe('an AI unit crossing the table', () => {
  it('advances toward you every round', () => {
    const dep = deploymentById('abandoned-camp');
    const flat = { seed: 3, table: dep.table, pieces: [], fireLanes: [], violations: [] };
    const cfg = makeConfig({ aiFaction: 'Zerg', playMode: 'video', playerMinerals: 1000, difficulty: 'normal' });
    cfg.playerUnits = [makePlayerUnit('p1', 'marine', 'small', [], 'Marines', 300)];
    cfg.army = { ...cfg.army, units: [{
      id: 'hyd', defId: 'hydralisk', label: 'Hydralisks A', composition: 'small', upgrades: [],
      maxModels: 2, models: 2, damageMarker: 0, shieldsLeft: 0, location: 'table',
      activated: { movement: false, assault: false, combat: false }, engaged: false, engagedEnemySupply: 0,
      disengagedThisRound: false, objective: { kind: 'enemy' }, atObjective: false, respawns: 0,
    }] } as typeof cfg.army;

    const s0 = createGame(cfg, dep, flat);
    // You stand at the far end; the Hydralisks start at their own edge.
    s0.playerUnits[0]!.location = 'table';
    s0.sense!.players['p1'] = [{ x: 18, y: 4 }, { x: 18.9, y: 4 }, { x: 18, y: 4.9 }];
    s0.army.units[0]!.location = 'table';
    s0.sense!.ai['hyd'] = [{ x: 18, y: 33 }, { x: 18, y: 34 }];

    let s = s0;
    const nearest = () => Math.min(...(s.sense!.ai['hyd'] ?? []).map((p) => Math.hypot(p.x - 18, p.y - 4)));
    const track: number[] = [nearest()];
    for (let i = 0; i < 260 && s.status === 'playing' && track.length < 5; i++) {
      const before = s.round;
      const k = s.step.kind;
      if (k === 'AI_ORDER') {
        const o = s.step.order;
        s = apply(s, { t: 'aiResolve' });
        if (s.step.kind === 'AI_ORDER' && s.step.order === o) s = apply(s, { t: 'orderReport', report: o.reports[0]!.id });
      } else if (k === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
      else if (k === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
      else if (k === 'SCORING_FORM') s = apply(s, { t: 'scoring', answers: { markers: {}, playerSupplyLost: 0, extra: {} } });
      else s = apply(s, { t: 'continue' });
      if (s.round !== before) track.push(nearest());
    }
    console.log('distance to your Marines at the end of each round:', track.map((d) => d.toFixed(1)).join(' → ')); // eslint-disable-line no-console
    // A Hydralisk moves 4" and runs 8": two rounds of walking should close well over 6".
    expect(track[0]! - track[2]!).toBeGreaterThan(6);
  });
});
