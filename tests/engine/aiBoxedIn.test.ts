import { describe, expect, it } from 'vitest';
import { createGame, apply } from '@engine/director/reducer';
import { makeConfig } from './helpers';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { deploymentById } from '@data/index';
import { placeUnit } from '@engine/sense/placement';
import type { GameState } from '@engine/types/game';
import type { AiUnitInstance } from '@engine/types/army';

/** An AI unit as the army builder would make it, on the table with nothing decided yet. */
function aiUnit(id: string, defId: string, label: string, models: number): AiUnitInstance {
  return {
    id, defId, label, composition: models > 12 || defId === 'hydralisk' && models > 2 ? 'large' : 'small', upgrades: [],
    maxModels: models, models, damageMarker: 0, shieldsLeft: 0, location: 'table',
    activated: { movement: false, assault: false, combat: false }, engaged: false, engagedEnemySupply: 0,
    disengagedThisRound: false, objective: { kind: 'enemy' }, atObjective: false, respawns: 0,
  } as AiUnitInstance;
}

/** Play rounds until `rounds` have passed, answering everything the way the scripted player does. */
function playRounds(s: GameState, rounds: number): GameState {
  const until = s.round + rounds;
  for (let i = 0; i < 400 && s.status === 'playing' && s.round < until; i++) {
    const k = s.step.kind;
    if (k === 'AI_ORDER') {
      const o = s.step.order;
      s = apply(s, { t: 'aiResolve' });
      if (s.step.kind === 'AI_ORDER' && s.step.order === o) s = apply(s, { t: 'orderReport', report: o.reports[0]!.id });
    } else if (k === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
    else if (k === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
    else if (k === 'SCORING_FORM') s = apply(s, { t: 'scoring', answers: { markers: {}, playerSupplyLost: 0, extra: {} } });
    else s = apply(s, { t: 'continue' });
  }
  return s;
}

const nearestTo = (s: GameState, id: string, p: { x: number; y: number }) => Math.min(...(s.sense!.ai[id] ?? []).map((q) => Math.hypot(q.x - p.x, q.y - p.y)));

describe('an AI unit boxed into its entry corner', () => {
  const dep = deploymentById('abandoned-camp');
  const you = { x: 18, y: 4 };

  /**
   * The corner from the report: a wall running up from the AI's edge a few inches in from the side, a Swarmling
   * blob already filling the pocket between wall and table edge, and a second unit set down behind it.
   */
  function corner(second: AiUnitInstance): GameState {
    const t = dep.table;
    const wall = { n: 1, catalogId: 'lt-wall', size: 2 as const, grass: false, x: 6, y: t.height - 9, w: 0.8, h: 8.5, label: 'Wall' };
    const cfg = makeConfig({ aiFaction: 'Zerg', playMode: 'video', playerMinerals: 1000, difficulty: 'normal' });
    cfg.playerUnits = [makePlayerUnit('p1', 'marine', 'small', [], 'Marines', 300)];
    cfg.army = { ...cfg.army, units: [aiUnit('blob', 'zergling', 'Swarmlings A', 18), second] } as typeof cfg.army;
    const s = createGame(cfg, dep, { seed: 3, table: t, pieces: [wall], fireLanes: [], violations: [] });
    s.playerUnits[0]!.location = 'table';
    s.sense!.players['p1'] = [you, { x: you.x + 0.9, y: you.y }, { x: you.x, y: you.y + 0.9 }];
    for (const u of s.army.units) u.location = 'table';
    // The blob packs the pocket against the edge; the second unit lands in what room is left behind it.
    placeUnit(s, 'ai', 'blob', { x: 3, y: t.height - 3.5 });
    placeUnit(s, 'ai', second.id, { x: 2, y: t.height - 1 });
    return s;
  }

  it('Zerglings set down behind the blob still get out and up the table', () => {
    let s = corner(aiUnit('late', 'zergling', 'Swarmlings B', 12));
    const before = nearestTo(s, 'late', you);
    s = playRounds(s, 2);
    const after = nearestTo(s, 'late', you);
    console.log('late Zerglings, nearest to you: before', before.toFixed(1), 'after', after.toFixed(1)); // eslint-disable-line no-console
    // Two rounds of Zerglings (4" move, 8" run) should be well clear of the corner.
    expect(before - after).toBeGreaterThan(6);
  });

  it('Hydralisks set down behind the blob still get out and up the table', () => {
    let s = corner(aiUnit('late', 'hydralisk', 'Hydralisks B', 4));
    const before = nearestTo(s, 'late', you);
    s = playRounds(s, 2);
    const after = nearestTo(s, 'late', you);
    console.log('late Hydralisks, nearest to you: before', before.toFixed(1), 'after', after.toFixed(1)); // eslint-disable-line no-console
    expect(before - after).toBeGreaterThan(6);
  });

  it('the blob itself leaves the pocket too', () => {
    let s = corner(aiUnit('late', 'zergling', 'Swarmlings B', 12));
    const before = nearestTo(s, 'blob', you);
    s = playRounds(s, 2);
    const after = nearestTo(s, 'blob', you);
    console.log('blob, nearest to you: before', before.toFixed(1), 'after', after.toFixed(1)); // eslint-disable-line no-console
    expect(before - after).toBeGreaterThan(6);
  });
});

describe('an AI unit whose goal is sealed off', () => {
  it('walks along the wall toward the enemy instead of standing still or stepping through it', () => {
    const dep = deploymentById('abandoned-camp');
    const t = dep.table;
    // A wall from the AI's edge up to well past the unit, sealing the enemy off on the far side of it.
    const wall = { n: 1, catalogId: 'lt-wall', size: 2 as const, grass: false, x: 9, y: t.height - 14, w: 0.8, h: 14, label: 'Wall' };
    const cfg = makeConfig({ aiFaction: 'Zerg', playMode: 'video', playerMinerals: 1000, difficulty: 'normal' });
    cfg.playerUnits = [makePlayerUnit('p1', 'marine', 'small', [], 'Marines', 300)];
    cfg.army = { ...cfg.army, units: [aiUnit('blob', 'zergling', 'Swarmlings A', 18)] } as typeof cfg.army;
    let s = createGame(cfg, dep, { seed: 3, table: t, pieces: [wall], fireLanes: [], violations: [] });
    s.playerUnits[0]!.location = 'table';
    const you = { x: 14, y: t.height - 3 };
    s.sense!.players['p1'] = [you, { x: you.x + 0.9, y: you.y }, { x: you.x, y: you.y + 0.9 }];
    s.army.units[0]!.location = 'table';
    placeUnit(s, 'ai', 'blob', { x: 3, y: t.height - 3.5 });
    const top = () => Math.min(...(s.sense!.ai['blob'] ?? []).map((p) => p.y));
    const before = top();
    s = playRounds(s, 2);
    console.log('sealed-off blob, highest model y: before', before.toFixed(1), 'after', top().toFixed(1)); // eslint-disable-line no-console
    // The way to the Marines is up and round the wall's top: the unit climbs the table, and never crosses x = 9.
    expect(before - top()).toBeGreaterThan(5);
    const crossed = (s.sense!.ai['blob'] ?? []).some((p) => p.x > 9 && p.y > t.height - 14);
    expect(crossed).toBe(false);
  });
});
