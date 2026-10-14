import { describe, expect, it } from 'vitest';
import { createGame, apply } from '@engine/director/reducer';
import { makeConfig } from './helpers';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { deploymentById } from '@data/index';

describe('an AI unit with nowhere worth moving', () => {
  it('does not step up to Engagement Range and back: it holds, and the AI passes', () => {
    const dep = deploymentById('abandoned-camp');
    const flat = { seed: 3, table: dep.table, pieces: [], fireLanes: [], violations: [] };
    const cfg = makeConfig({ aiFaction: 'Zerg', playMode: 'video', playerMinerals: 1000, difficulty: 'normal' });
    cfg.playerUnits = [makePlayerUnit('p1', 'marine', 'small', [], 'Marines', 300)];
    cfg.army = { ...cfg.army, units: [{
      id: 'zl', defId: 'zergling', label: 'Zerglings A', composition: 'small', upgrades: [],
      maxModels: 2, models: 2, damageMarker: 0, shieldsLeft: 0, location: 'table',
      activated: { movement: false, assault: false, combat: false }, engaged: false, engagedEnemySupply: 0,
      disengagedThisRound: false, objective: { kind: 'enemy' }, atObjective: false, respawns: 0,
    }] } as typeof cfg.army;
    const s0 = createGame(cfg, dep, flat);
    s0.playerUnits[0]!.location = 'table';
    s0.sense!.players['p1'] = [{ x: 18, y: 20 }, { x: 19.4, y: 20 }, { x: 16.6, y: 20 }, { x: 18, y: 18.6 }, { x: 19.4, y: 18.6 }, { x: 16.6, y: 18.6 }];
    s0.army.units[0]!.location = 'table';
    // Just clear of Engagement Range: a step closer would put it in.
    s0.sense!.ai['zl'] = [{ x: 18, y: 23.2 }, { x: 18.9, y: 23.6 }];
    const start = JSON.stringify(s0.sense!.ai['zl']);

    let s = s0;
    for (let i = 0; i < 40 && s.phase === 'movement' && s.round === 1; i++) {
      const k = s.step.kind;
      if (k === 'AI_ORDER') {
        expect(s.step.order.type).not.toBe('move');
        const o = s.step.order;
        s = apply(s, { t: 'aiResolve' });
        if (s.step.kind === 'AI_ORDER' && s.step.order === o) s = apply(s, { t: 'orderReport', report: o.reports[0]!.id });
      } else if (k === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
      else s = apply(s, { t: 'continue' });
    }
    expect(JSON.stringify(s.sense!.ai['zl'])).toBe(start);
  });
});
