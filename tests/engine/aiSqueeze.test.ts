import { describe, expect, it } from 'vitest';
import { createGame, apply } from '@engine/director/reducer';
import { makeConfig } from './helpers';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { deploymentById } from '@data/index';
import { placeUnit } from '@engine/sense/placement';
import { passable, shortestPath } from '@engine/sense/geometry2d';
import { pathOptionsFor } from '@engine/sense/placement';
import { baseOf } from '@data/bases';
import type { GameState } from '@engine/types/game';
import type { AiUnitInstance } from '@engine/types/army';
import type { TerrainPiece } from '@engine/types/terrain';

function aiUnit(id: string, defId: string, label: string, models: number): AiUnitInstance {
  return {
    id, defId, label, composition: 'small', upgrades: [],
    maxModels: models, models, damageMarker: 0, shieldsLeft: 0, location: 'table',
    activated: { movement: false, assault: false, combat: false }, engaged: false, engagedEnemySupply: 0,
    disengagedThisRound: false, objective: { kind: 'enemy' }, atObjective: false, respawns: 0,
  } as AiUnitInstance;
}

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

describe('a wall with one gap in it', () => {
  const dep = deploymentById('abandoned-camp');
  const t = dep.table;
  const you = { x: 18, y: 4 };
  const piece = (n: number, catalogId: string, size: 1 | 2, x: number, y: number, w: number, h: number): TerrainPiece =>
    ({ n, catalogId, size, grass: false, x, y, w, h, label: catalogId });

  /** A wall right across the table with one opening `gap` inches wide, and an AI unit below it. */
  function pocket(gap: number, defId: string, models: number): GameState {
    const wallY = t.height - 8;
    const pieces = [
      piece(1, 'lt-wall-l-1', 2, 0, wallY, 18 - gap / 2, 1),
      piece(2, 'lt-wall-l-1', 2, 18 + gap / 2, wallY, 18 - gap / 2, 1),
    ];
    const cfg = makeConfig({ aiFaction: 'Protoss', playMode: 'video', playerMinerals: 1000, difficulty: 'normal' });
    cfg.playerUnits = [makePlayerUnit('p1', 'marine', 'small', [], 'Marines', 300)];
    cfg.army = { ...cfg.army, units: [aiUnit('u', defId, 'Unit A', models)] } as typeof cfg.army;
    const s = createGame(cfg, dep, { seed: 3, table: t, pieces, fireLanes: [], violations: [] });
    s.playerUnits[0]!.location = 'table';
    s.sense!.players['p1'] = [you, { x: you.x + 0.9, y: you.y }, { x: you.x, y: you.y + 0.9 }];
    s.army.units[0]!.location = 'table';
    placeUnit(s, 'ai', 'u', { x: 18, y: t.height - 3 });
    return s;
  }
  const through = (s: GameState) => shortestPath(s.sense!.ai['u']![0]!, you, s.terrain.pieces, s.terrain.table, pathOptionsFor(s, 'ai', 'u')).length < Infinity;

  // Gap Clearance (Part 4.6), with the official data's Sizes: Marine 2, Siege Tank 2 (3 dug in), Stalker 3.
  it('a Size 2 Marine passes an inch, and not less, whatever its base', () => {
    expect(baseOf('marine').r * 2).toBeGreaterThan(1.2);
    expect(through(pocket(1, 'marine', 3))).toBe(true);
    expect(through(pocket(0.7, 'marine', 3))).toBe(false);
  });

  it('a Siege Tank is Large: it needs three inches whatever its Size, and its base is never a further bar', () => {
    expect(baseOf('siege_tank').r * 2).toBeGreaterThan(5);
    expect(through(pocket(3, 'siege_tank', 1))).toBe(true);
    expect(through(pocket(2.5, 'siege_tank', 1))).toBe(false);
    const dug = pocket(2.5, 'siege_tank', 1);
    dug.army.units[0]!.statuses = ['Siege Mode'];
    expect(through(dug)).toBe(false);
  });

  it('a Size 3 Stalker needs three', () => {
    expect(through(pocket(3, 'stalker', 2))).toBe(true);
    expect(through(pocket(2.5, 'stalker', 2))).toBe(false);
  });

  it('scatter is walked through but never ended on', () => {
    const s = pocket(20, 'stalker', 2);
    // A rock right in the way: the path goes straight through it, and a spot on it is no place to stop.
    s.terrain.pieces.push(piece(9, 'lt-scatter-1', 1, 15.9, t.height - 14, 4.2, 2.9));
    const from = s.sense!.ai['u']![0]!;
    const path = shortestPath(from, you, s.terrain.pieces, s.terrain.table, pathOptionsFor(s, 'ai', 'u'));
    expect(path.length).toBeCloseTo(Math.hypot(you.x - from.x, you.y - from.y), 1);
    expect(passable({ x: 18, y: t.height - 12.5 }, s.terrain.pieces)).toBe(false);
  });

  it('and the Stalkers walk out through a three-inch gap', () => {
    let s = pocket(3, 'stalker', 2);
    const nearest = () => Math.min(...(s.sense!.ai['u'] ?? []).map((p) => Math.hypot(p.x - you.x, p.y - you.y)));
    const before = nearest();
    s = playRounds(s, 2);
    console.log('Stalkers, nearest to you: before', before.toFixed(1), 'after', nearest().toFixed(1)); // eslint-disable-line no-console
    expect(before - nearest()).toBeGreaterThan(5);
  });
});
