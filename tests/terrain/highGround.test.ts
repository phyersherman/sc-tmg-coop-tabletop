import { describe, expect, it } from 'vitest';
import type { TerrainPiece } from '../../src/engine/types/terrain';
import { passable, shortestPath } from '../../src/engine/sense/geometry2d';
import { rampLane, rampLevel } from '../../src/engine/terrain/geometry';
import { RULEBOOK_MAPS } from '../../src/data/terrainMaps';
import { mapLayout } from '../../src/engine/terrain/remix';

const table = { width: 36, height: 36 };
// A Lost Temple Ramp lying lengthwise, its access point on the right-hand end.
const ramp: TerrainPiece = { n: 1, catalogId: 'lt-ramp', size: 3, grass: false, label: 'Lost Temple Ramp', x: 10, y: 14, w: 15.9, h: 8.15, accessPoints: [{ x: 25.9, y: 18.075 }] };
const scatter: TerrainPiece = { n: 2, catalogId: 'lt-scatter-3', size: 1, grass: false, label: 'Scatter', x: 4, y: 4, w: 3, h: 2 };
const plateau = { x: 13, y: 18 };

describe('high ground and scatter', () => {
  it('lays the ramp down one side, rising from the ground at the access end to the plateau', () => {
    const r = rampLane(ramp);
    const mouth = r.toTable(r.hl - 0.2, r.side * (r.ht - r.w / 2));
    expect(rampLevel(mouth, ramp)).toBeLessThan(0.1);
    expect(rampLevel(plateau, ramp)).toBe(1);
    expect(rampLevel({ x: 30, y: 30 }, ramp)).toBe(0);
  });

  it('climbs onto the plateau only by the ramp', () => {
    const from = { x: 13, y: 11 }; // just behind the piece's long side
    const walk = shortestPath(from, plateau, [ramp], table, { clearance: 0.5 });
    expect(walk.length).toBeLessThan(Infinity);
    // The way round goes out past the access end and up the ramp: far longer than the straight line.
    expect(walk.length).toBeGreaterThan(20);
    expect(walk.path.some((p) => p.x > 24)).toBe(true);
  });

  it('lets Raptor Strain go straight up the side', () => {
    const from = { x: 13, y: 11 };
    const leap = shortestPath(from, plateau, [ramp], table, { clearance: 0.5, climber: true });
    expect(leap.length).toBeCloseTo(7, 0);
  });

  it('stands models on the plateau but never on its edge', () => {
    expect(passable(plateau, [ramp])).toBe(true);
    expect(passable({ x: 10, y: 18 }, [ramp])).toBe(false);
  });

  it('walks through scatter but never ends on it (Part 4.5: Size 0 and 1 are passed through freely)', () => {
    expect(passable({ x: 5.5, y: 5 }, [scatter])).toBe(false);
    const through = shortestPath({ x: 2, y: 5 }, { x: 9, y: 5 }, [scatter], table, { clearance: 0.5 });
    expect(through.length).toBeCloseTo(7, 1);
  });

  it('opens every ramp on the rulebook maps onto clear ground, so its plateau can be reached', () => {
    for (const m of RULEBOOK_MAPS.filter((x) => x.pieces.some((p) => p.catalogId === 'lt-ramp'))) {
      const layout = mapLayout(m.id);
      for (const p of layout.pieces.filter((q) => q.catalogId === 'lt-ramp')) {
        const r = rampLane(p);
        const foot = r.toTable(r.hl + 1.5, r.side * (r.ht - r.w / 2));
        const top = r.toTable(-r.hl + 2.5, 0);
        expect(rampLevel(top, p), `${m.id} #${p.n}`).toBe(1);
        expect(passable(foot, layout.pieces), `${m.id} #${p.n}: the ramp's foot is blocked`).toBe(true);
        // Up the ramp for a small base at least: the rulebook stands scatter on some ramps and walls by their feet.
        expect(shortestPath(foot, top, layout.pieces, layout.table, { clearance: 0.3 }).length, `${m.id} #${p.n}: no way up`).toBeLessThan(Infinity);
      }
    }
  });
});

describe('shooting from high ground', () => {
  it('a model on the plateau sees down over its edge; one at its foot is covered from the ground', async () => {
    const { losBlocked } = await import('../../src/engine/sense/geometry2d');
    const onTop = { x: 13, y: 18 };
    expect(rampLevel(onTop, ramp)).toBe(1);
    const atFoot = { x: 13, y: 22.6 }; // 0.45" south of the plateau's edge
    // Marine (Size 1) on the plateau, Hydralisk (Size 1) hugging the cliff below: the plateau is under the Marine, not between.
    expect(losBlocked(onTop, 1, atFoot, 1, [ramp])).toBe(false);
    // From the open ground beyond, the Hydralisk at the cliff's foot is in Direct Cover behind the plateau.
    const beyond = { x: 13, y: 8 };
    expect(losBlocked(beyond, 1, atFoot, 1, [ramp])).toBe(true);
    // A wall of Size 2 in the way does not cover a target from a Marine on the plateau (Effective Size 4).
    const wall: TerrainPiece = { n: 3, catalogId: 'lt-wall-1', size: 2, grass: false, label: 'Wall', x: 8, y: 26, w: 10, h: 1 };
    expect(losBlocked(onTop, 1, { x: 13, y: 30 }, 1, [ramp, wall])).toBe(false);
    expect(losBlocked({ x: 13, y: 24 }, 1, { x: 13, y: 30 }, 1, [ramp, wall])).toBe(true);
  });
});
