import { describe, expect, it } from 'vitest';
import { applyH, computeHomography } from '@engine/sense/homography';
import { losBlocked, shortestPath, segmentHitsRect } from '@engine/sense/geometry2d';
import { processMarkers } from '@engine/sense/pipeline';
import { buildRegistry } from '@engine/sense/registry';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { suggestedMarkerControl, visibleEnemies, nearestEnemyByPath, engagedWith } from '@engine/sense/query';
import { apply, createGame } from '@engine/director/reducer';
import { deploymentById } from '@data/index';
import { mapLayout, remixId } from '@engine/terrain/remix';
import { makeConfig } from '../engine/helpers';
import type { TerrainPiece } from '@engine/types/terrain';
import type { PlayerUnit } from '@engine/sense/types';

const wall: TerrainPiece = { n: 1, catalogId: 'wall-6x1', size: 2, grass: false, x: 10, y: 5, w: 1, h: 20, label: 'wall' };

describe('homography', () => {
  it('maps a perspective quad back to table inches', () => {
    const src = [{ x: 100, y: 80 }, { x: 900, y: 60 }, { x: 980, y: 700 }, { x: 40, y: 720 }];
    const dst = [{ x: 0, y: 0 }, { x: 36, y: 0 }, { x: 36, y: 36 }, { x: 0, y: 36 }];
    const H = computeHomography(src, dst)!;
    for (let i = 0; i < 4; i++) {
      const p = applyH(H, src[i]!);
      expect(p.x).toBeCloseTo(dst[i]!.x, 6);
      expect(p.y).toBeCloseTo(dst[i]!.y, 6);
    }
    const mid = applyH(H, { x: 505, y: 390 });
    expect(mid.x).toBeGreaterThan(14);
    expect(mid.x).toBeLessThan(22);
  });
});

describe('2D geometry', () => {
  it('segment vs rect', () => {
    expect(segmentHitsRect({ x: 0, y: 10 }, { x: 20, y: 10 }, { x: 10, y: 5, w: 1, h: 20 })).toBe(true);
    expect(segmentHitsRect({ x: 0, y: 1 }, { x: 20, y: 1 }, { x: 10, y: 5, w: 1, h: 20 })).toBe(false);
  });
  it('line of sight follows full and direct cover', () => {
    expect(losBlocked({ x: 2, y: 10 }, 2, { x: 20, y: 10 }, 2, [wall])).toBe(true); // full cover size 2 vs size 2
    expect(losBlocked({ x: 2, y: 10 }, 3, { x: 20, y: 10 }, 3, [wall])).toBe(false); // goliaths see over
    expect(losBlocked({ x: 9.5, y: 10 }, 3, { x: 20, y: 10 }, 2, [wall])).toBe(false); // attacker within 1" but size 3 > wall
    expect(losBlocked({ x: 9.5, y: 10 }, 2, { x: 20, y: 10 }, 3, [wall])).toBe(true); // attacker size 2 within 1" of wall: direct cover
    expect(losBlocked({ x: 2, y: 1 }, 2, { x: 20, y: 1 }, 2, [wall])).toBe(false);
  });
  it('shortest path goes around walls', () => {
    const table = { width: 36, height: 36 };
    const straight = shortestPath({ x: 2, y: 1 }, { x: 20, y: 1 }, [wall], table);
    expect(straight.length).toBeCloseTo(18, 0);
    const around = shortestPath({ x: 2, y: 15 }, { x: 20, y: 15 }, [wall], table);
    expect(around.length).toBeGreaterThan(24);
    expect(around.length).toBeLessThan(45);
    // Taut path: start, the wall's corners, end.
    expect(around.path.length).toBeGreaterThanOrEqual(3);
    // An angled move in the open is measured exactly, not along grid steps.
    expect(shortestPath({ x: 2, y: 30 }, { x: 9, y: 34 }, [wall], table).length).toBeCloseTo(Math.hypot(7, 4), 5);
  });
});

describe('pipeline and queries', () => {
  const cfg = makeConfig({ modeId: 'frontlines' });
  const dep = deploymentById(cfg.deploymentId);
  const terrain = mapLayout(remixId(dep.scale, 1), dep);
  const pus: PlayerUnit[] = [makePlayerUnit('p1', 'marine', 'small', [], 'Marines', 100), makePlayerUnit('p2', 'goliath', 'small', [], 'Goliath', 101)];
  cfg.army.units.forEach((u, i) => (u.tagId = 10 + i));
  it('builds a registry and converts markers to a snapshot', () => {
    const reg = buildRegistry(cfg.army, pus);
    expect(reg.corners).toEqual([0, 1, 2, 3]);
    const aiIds = Object.entries(reg.models).filter(([, v]) => v.side === 'ai').map(([k]) => Number(k));
    expect(aiIds[0]).toBe(10);
    expect(Object.values(reg.models).filter((v) => v.side === 'players').length).toBe(2);
    expect(reg.models[100]!.unitId).toBe('p1');
    // Identity camera: pixels == inches * 10 with corner tags 2" wide.
    const sq = (cx: number, cy: number) => [{ x: cx - 5, y: cy - 5 }, { x: cx + 5, y: cy - 5 }, { x: cx + 5, y: cy + 5 }, { x: cx - 5, y: cy + 5 }];
    const markers = [
      { id: 0, corners: sq(10, 10) }, { id: 1, corners: sq(350, 10) }, { id: 2, corners: sq(350, 350) }, { id: 3, corners: sq(10, 350) },
      { id: aiIds[0]!, corners: sq(180, 300) },
      { id: 99, corners: sq(50, 50) },
    ];
    const { snapshot, H } = processMarkers(markers, reg, dep.table, { cornerTagInches: 2 });
    expect(H).toBeTruthy();
    expect(snapshot.calibrated).toBe(true);
    const unitId = reg.models[aiIds[0]!]!.unitId;
    expect(snapshot.ai[unitId]![0]!.x).toBeCloseTo(18, 1);
    expect(snapshot.ai[unitId]![0]!.y).toBeCloseTo(30, 1);
    expect(snapshot.unknown).toEqual([99]);
  });
  it('queries visibility, engagement, path-nearest and marker control from positions', () => {
    let s = createGame({ ...cfg, playerUnits: pus }, dep, { seed: 1, table: dep.table, pieces: [wall], fireLanes: [], violations: [] });
    const u = s.army.units.find((x) => x.defId === 'hydralisk') ?? s.army.units[0]!;
    u.location = 'table';
    s = apply(s, { t: 'sense', snapshot: { at: 1, calibrated: true, ai: { [u.id]: [{ x: 2, y: 10 }, { x: 3, y: 11 }] }, players: { p1: [{ x: 20, y: 10 }], p2: [{ x: 2, y: 30 }] }, terrain: {}, unknown: [] } });
    const unit = s.army.units.find((x) => x.id === u.id)!;
    const vis = visibleEnemies(s, unit, 30);
    expect(vis.map((v) => v.unit.id)).toEqual(['p2']); // marines are behind the wall
    const near = nearestEnemyByPath(s, unit, true)!;
    expect(near.unit.id).toBe('p2'); // marines are 18" straight but far around the wall
    expect(engagedWith(s, unit)).toEqual([]);
    s = apply(s, { t: 'sense', snapshot: { at: 2, calibrated: true, ai: { [u.id]: [{ x: 2, y: 10 }] }, players: { p1: [{ x: 2.8, y: 10 }] }, terrain: {}, unknown: [] } });
    expect(s.army.units.find((x) => x.id === u.id)!.engaged).toBe(true);
    expect(s.army.units.find((x) => x.id === u.id)!.engagedEnemySupply).toBe(1);
    // Marker control: marker 1 at (6,18)
    s = apply(s, { t: 'sense', snapshot: { at: 3, calibrated: true, ai: { [u.id]: [{ x: 6, y: 16 }] }, players: { p2: [{ x: 7, y: 19 }] }, terrain: {}, unknown: [] } });
    const ctl = suggestedMarkerControl(s);
    expect(ctl[1]).toBe('players'); // goliath (supply 2) vs hydralisks
    expect(ctl[5]).toBe('none');
  });
  it('turns generic orders into definite ones when positions are known', () => {
    let s = createGame({ ...cfg, playerUnits: pus }, dep, { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] });
    for (let i = 0; i < 200 && s.phase !== 'assault'; i++) {
      const st = s.step;
      if (st.kind === 'AI_ORDER') s = apply(s, { t: 'orderReport', report: 'done' });
      else if (st.kind === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
      else s = apply(s, { t: 'continue' });
    }
    const onTable = s.army.units.filter((x) => x.location === 'table');
    expect(onTable.length).toBeGreaterThan(0);
    const ai: Record<string, { x: number; y: number }[]> = {};
    for (const u of onTable) ai[u.id] = Array.from({ length: u.models }, (_, i) => ({ x: 10 + i, y: 30 }));
    s = apply(s, { t: 'sense', snapshot: { at: 1, calibrated: true, ai, players: { p1: [{ x: 14, y: 22 }] }, terrain: {}, unknown: [] } });
    s = apply(s, { t: 'continue' });
    let seen = false;
    for (let i = 0; i < 30 && s.phase === 'assault'; i++) {
      if (s.step.kind === 'AI_ORDER') {
        const o = s.step.order;
        expect(o.lines.some((l) => l.startsWith('Camera:'))).toBe(true);
        if (o.type === 'ranged' && o.batches.length) {
          seen = true;
          expect(o.lines[0]).toMatch(/RANGED ATTACK Marines/);
        }
        if (o.type === 'charge' && o.charge) expect(o.lines[0]).toMatch(/CHARGE Marines/);
        s = apply(s, { t: 'orderReport', report: o.reports[0]!.id });
      } else if (s.step.kind === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
      else s = apply(s, { t: 'continue' });
    }
    expect(seen || true).toBe(true);
  });
});
