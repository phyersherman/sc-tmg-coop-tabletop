import { describe, expect, it } from 'vitest';
import { deploymentById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { checkMove } from '@engine/player/rules';
import { makeConfig } from '../engine/helpers';
import type { GameState } from '@engine/types/game';
import type { TerrainPiece } from '@engine/types/terrain';

const dep = deploymentById('abandoned-camp');
const shrub = (n: number, x: number, y: number): TerrainPiece => ({ n, catalogId: 'lt-shrub-a', size: 1, grass: false, x, y, w: 2, h: 2, label: `Shrubs ${n}` });
const wall = (n: number, x: number, y: number): TerrainPiece => ({ n, catalogId: 'lt-wall-short', size: 2, grass: false, x, y, w: 3.2, h: 1, label: `Wall ${n}` });

function toPlayersTurn(s: GameState): GameState {
  for (let i = 0; i < 60 && s.step.kind !== 'PLAYERS_TURN'; i++) {
    if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
    else if (s.step.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
    else s = apply(s, { t: 'continue' });
  }
  return s;
}

function game(unit: 'siege_tank' | 'marine', pieces: TerrainPiece[]): GameState {
  const cfg = makeConfig({ modeId: 'frontlines' });
  cfg.playerUnits = [makePlayerUnit('u1', unit, 'small', [], unit === 'siege_tank' ? 'Tank' : 'Marines', 100)];
  cfg.playerCards = ['terran_armed_forces', 'barracks', 'factory'];
  let s = createGame(cfg, dep, { seed: 1, table: dep.table, pieces, fireLanes: [], violations: [] });
  s = toPlayersTurn(s);
  s = apply(s, { t: 'playerDeploy', unitId: 'u1', point: { x: 18, y: 3 } });
  s = toPlayersTurn(s);
  s.playerUnits.find((p) => p.id === 'u1')!.activated.movement = false;
  return s;
}

describe('Large (Siege Tank)', () => {
  it('may end its move on Size 1 terrain, which is then removed from the game', () => {
    let s = game('siege_tank', [shrub(1, 17, 7)]);
    const pu = s.playerUnits.find((p) => p.id === 'u1')!;
    expect(checkMove(s, pu, { x: 18, y: 8 }, 'move').ok).toBe(true);
    s = apply(s, { t: 'playerMove', unitId: 'u1', kind: 'move', point: { x: 18, y: 8 } });
    expect(s.terrain.pieces.some((t) => t.n === 1)).toBe(false);
    expect(s.log.some((l) => /crushes Shrubs 1/.test(l.text))).toBe(true);
  });
  it('removes Size 1 terrain its Leading Model drives through, but not a Size 2 wall', () => {
    let s = game('siege_tank', [shrub(1, 17, 5), wall(2, 30, 5)]);
    s = apply(s, { t: 'playerMove', unitId: 'u1', kind: 'move', point: { x: 18, y: 9 } });
    expect(s.terrain.pieces.map((t) => t.n)).toEqual([2]);
  });
  it('ends its 150mm base in a 3" gap between walls, as the rules let it through one', () => {
    let s = game('siege_tank', [{ ...wall(2, 12.8, 8), w: 3.2 }, { ...wall(3, 19.2, 8), w: 3.2 }]);
    const pu = s.playerUnits.find((p) => p.id === 'u1')!;
    expect(checkMove(s, pu, { x: 17.6, y: 8.5 }, 'move').ok).toBe(true);
    s = apply(s, { t: 'playerMove', unitId: 'u1', kind: 'move', point: { x: 17.6, y: 8.5 } });
    expect(s.sense!.players.u1![0]!.x).toBeCloseTo(17.6, 0);
  });
  it('other Units still cannot end on Size 1 terrain', () => {
    const s = game('marine', [shrub(1, 17, 7)]);
    const pu = s.playerUnits.find((p) => p.id === 'u1')!;
    expect(checkMove(s, pu, { x: 18, y: 8 }, 'move').ok).toBe(false);
  });
});
