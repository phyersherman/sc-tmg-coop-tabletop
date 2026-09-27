import { describe, expect, it } from 'vitest';
import { createGame, apply } from '@engine/director/reducer';
import { makeConfig } from './helpers';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { deploymentById, unitById } from '@data/index';

describe('an AI Siege Tank in a whole battle', () => {
  it('digs in where it stands, shells with the Shock Cannon, and packs up when nothing is left in range', () => {
    const dep = deploymentById('abandoned-camp');
    const flat = { seed: 3, table: dep.table, pieces: [], fireLanes: [], violations: [] };
    const cfg = makeConfig({ aiFaction: 'Terran', playMode: 'video', playerMinerals: 1200, difficulty: 'hard' });
    cfg.playerUnits = [makePlayerUnit('p1', 'marine', 'large', [], 'Marines', 300), makePlayerUnit('p2', 'marauder', 'small', [], 'Marauders', 301)];
    const mode = unitById('siege_tank').abilities.find((a) => a.name === 'Mode Transformation')!;
    cfg.army = { ...cfg.army, units: [
      { id: 'tank', defId: 'siege_tank', label: 'Siege Tank A', composition: 'small', upgrades: [mode.id], maxModels: 1, models: 1, damageMarker: 0, shieldsLeft: 0, location: 'reserves', activated: { movement: false, assault: false, combat: false }, engaged: false, engagedEnemySupply: 0, disengagedThisRound: false, objective: { kind: 'enemy' }, atObjective: false, respawns: 0 },
      ...cfg.army.units.slice(0, 2),
    ] } as typeof cfg.army;

    let s = createGame(cfg, dep, flat);
    // Your units are on the table from the start, in the middle, where the tank's gun can reach them.
    for (const [id, at] of [['p1', { x: 16, y: 18 }], ['p2', { x: 20, y: 19 }]] as const) {
      const pu = s.playerUnits.find((p) => p.id === id)!;
      pu.location = 'table';
      pu.deployedRound = 1;
      s.sense!.players[id] = Array.from({ length: pu.models }, (_, i) => ({ x: at.x + (i % 3) * 0.9, y: at.y + Math.floor(i / 3) * 0.9 }));
    }
    const orders: string[] = [];
    for (let i = 0; i < 600 && s.status === 'playing'; i++) {
      const k = s.step.kind;
      if (k === 'AI_ORDER') {
        const o = s.step.order;
        if (o.unitId === 'tank') orders.push(o.title);
        s = apply(s, { t: 'aiResolve' });
        if (s.step.kind === 'AI_ORDER' && s.step.order === o) s = apply(s, { t: 'orderReport', report: o.reports[0]!.id });
      } else if (k === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
      else if (k === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
      else if (k === 'SCORING_FORM') s = apply(s, { t: 'scoring', answers: { markers: {}, playerSupplyLost: 0, extra: {} } });
      else s = apply(s, { t: 'continue' });
    }
    // It sets up where it stands, shells with the gun only SIEGE MODE allows, and packs up when the shelling is
    // over. It never walks while it is dug in.
    expect(orders.some((t) => /Deploy SIEGE MODE/i.test(t))).toBe(true);
    expect(s.log.some((l) => /fires Shock Cannon/i.test(l.text))).toBe(true);
    expect(orders.some((t) => /Leave SIEGE MODE/i.test(t))).toBe(true);
    const sieged = orders.indexOf(orders.find((t) => /Deploy SIEGE MODE/i.test(t))!);
    const left = orders.indexOf(orders.find((t) => /Leave SIEGE MODE/i.test(t))!);
    expect(orders.slice(sieged + 1, left).some((t) => /Move|Run|Charge/i.test(t))).toBe(false);
  });
});
