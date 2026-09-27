import { describe, expect, it } from 'vitest';
import { deploymentById } from '@data/index';
import { createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { aiEvadeReason } from '@engine/player/rules';
import { placeUnit } from '@engine/sense/placement';
import { rampLane, rampLevel } from '@engine/terrain/geometry';
import { makeConfig } from './helpers';
import type { GameState } from '@engine/types/game';
import type { TerrainPiece } from '@engine/types/terrain';

const dep = deploymentById('abandoned-camp');

/** A Zerg AI army led by Hydralisks (Evade 5+), and your Marines, on a table with one ramp. */
function game(pieces: TerrainPiece[] = []): GameState {
  const cfg = makeConfig({ modeId: 'frontlines', aiFaction: 'Zerg', playMode: 'video' });
  cfg.playerUnits = [makePlayerUnit('m1', 'marine', 'small', [], 'Marines', 100)];
  cfg.army = { ...cfg.army, units: [{
    id: 'hy', defId: 'hydralisk', label: 'Hydralisks A', composition: 'small', upgrades: [],
    maxModels: 2, models: 2, damageMarker: 0, shieldsLeft: 0, location: 'table',
    activated: { movement: false, assault: false, combat: false }, engaged: false, engagedEnemySupply: 0,
    disengagedThisRound: false, objective: { kind: 'enemy' }, atObjective: false, respawns: 0,
  }] } as typeof cfg.army;
  const s = createGame(cfg, dep, { seed: 1, table: dep.table, pieces, fireLanes: [], violations: [] });
  s.playerUnits[0]!.location = 'table';
  s.army.units[0]!.location = 'table';
  return s;
}

describe('when the AI rolls Evade against you', () => {
  it('rolls it when engaged and shot at, never in close combat', () => {
    const s = game();
    const hy = s.army.units[0]!;
    expect(aiEvadeReason(s, hy, 'Assault')).toBeNull();
    hy.engaged = true;
    expect(aiEvadeReason(s, hy, 'Assault')).toBe('engaged target');
    expect(aiEvadeReason(s, hy, 'Combat')).toBeNull();
  });

  it('rolls it against every attack while burrowed', () => {
    const s = game();
    const hy = s.army.units[0]!;
    hy.special = { burrowed: true };
    expect(aiEvadeReason(s, hy, 'Combat')).toBe('Burrowed');
  });

  it('never for a unit with no Evade', async () => {
    const { UNITS } = await import('@data/index');
    const plain = UNITS.find((u) => u.faction === 'Zerg' && !u.summoned && !u.stats.evade);
    expect(plain, 'a Zerg unit without an Evade characteristic').toBeTruthy();
    const s = game();
    const hy = s.army.units[0]!;
    hy.defId = plain!.id;
    hy.engaged = true;
    expect(aiEvadeReason(s, hy, 'Assault')).toBeNull();
  });

  it('rolls it from high ground against a shooter below, not against one up there too', () => {
    const ramp: TerrainPiece = { n: 1, catalogId: 'lt-ramp', size: 3, grass: false, x: 10, y: 12, w: 15.9, h: 8.15, label: 'Ramp', rampSide: 1 };
    const s = game([ramp]);
    const r = rampLane(ramp);
    const top = r.toTable(-r.hl + 3, 0);
    expect(rampLevel(top, ramp)).toBe(1);
    const hy = s.army.units[0]!;
    placeUnit(s, 'ai', 'hy', top);
    placeUnit(s, 'players', 'm1', { x: 18, y: 30 });
    expect(aiEvadeReason(s, hy, 'Assault', s.playerUnits[0]!)).toBe('high ground');
    // Your Marines up on the plateau as well: no Evade.
    placeUnit(s, 'players', 'm1', r.toTable(-r.hl + 6, 0));
    expect(aiEvadeReason(s, hy, 'Assault', s.playerUnits[0]!)).toBeNull();
  });
});
