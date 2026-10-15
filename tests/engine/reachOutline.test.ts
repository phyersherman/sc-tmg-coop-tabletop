import { describe, expect, it } from 'vitest';
import { reachOutline, reachRegion } from '@engine/sense/geometry2d';
import type { TerrainPiece } from '@engine/types/terrain';

const table = { width: 36, height: 36 };
const wall = (n: number, x: number, y: number, w: number, h: number): TerrainPiece => ({ n, catalogId: 'lt-wall-i-1', size: 2, grass: false, x, y, w, h, label: `Wall ${n}` });
const radiusAt = (pts: { x: number; y: number }[], from: { x: number; y: number }, angle: number) => {
  const n = pts.length;
  const i = ((Math.round((angle / (Math.PI * 2)) * n) % n) + n) % n;
  return Math.hypot(pts[i]!.x - from.x, pts[i]!.y - from.y);
};

describe('the reach as walked', () => {
  const from = { x: 18, y: 18 };
  it('is a full circle on open ground', () => {
    const pts = reachOutline(from, [], table, 6);
    expect(pts).toHaveLength(180);
    for (const p of pts) expect(Math.hypot(p.x - from.x, p.y - from.y)).toBeCloseTo(6, 0);
  });
  it('stops at a wall in the way, and keeps its distance on the open side', () => {
    // A long wall 3" east of the mover, running north-south.
    const pts = reachOutline(from, [wall(1, 21, 8, 1, 20)], table, 6);
    expect(radiusAt(pts, from, 0)).toBeLessThan(3.2);
    expect(radiusAt(pts, from, Math.PI)).toBeCloseTo(6, 0);
  });
  it('is shorter past the end of a wall, where the way round uses up the distance', () => {
    // A wall 2" east ends a little north of the mover: a ray just past its end has to skirt it, and the reach
    // along that ray is less than the straight distance but well past the wall.
    const pts = reachOutline(from, [wall(1, 20, 10, 1, 7)], table, 6);
    const beyond = radiusAt(pts, from, -Math.PI / 9);
    expect(beyond).toBeLessThan(5.9);
    expect(beyond).toBeGreaterThan(3);
  });
});

describe('the reach as ground', () => {
  const inside = (loops: { x: number; y: number }[][], p: { x: number; y: number }) => {
    let n = false;
    for (const poly of loops)
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!, b = poly[j]!;
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) n = !n;
      }
    return n;
  };
  // The Lost Temple Ramp: its plateau climbed only from the ramp's foot on the east side.
  const ramp: TerrainPiece = { n: 1, catalogId: 'lt-ramp', size: 3, grass: false, label: 'Lost Temple Ramp', x: 10, y: 14, w: 15.9, h: 8.15, accessPoints: [{ x: 25.9, y: 18.075 }] };

  it('is one disc on open ground', () => {
    const loops = reachRegion({ x: 18, y: 18 }, [], table, 6);
    expect(loops).toHaveLength(1);
    expect(inside(loops, { x: 23.8, y: 18 })).toBe(true);
    expect(inside(loops, { x: 24.3, y: 18 })).toBe(false);
  });
  it('leaves out a wall it cannot stand in, and the ground behind it out of reach', () => {
    const loops = reachRegion({ x: 18, y: 18 }, [wall(1, 21, 8, 1, 20)], table, 6);
    expect(inside(loops, { x: 21.5, y: 18 })).toBe(false);
    expect(inside(loops, { x: 23, y: 18 })).toBe(false);
    expect(inside(loops, { x: 13, y: 18 })).toBe(true);
  });
  it('does not climb the cliff: the plateau beside a model at its foot is out of reach', () => {
    const loops = reachRegion({ x: 7, y: 18 }, [ramp], table, 6);
    expect(inside(loops, { x: 4, y: 18 })).toBe(true);
    expect(inside(loops, { x: 12, y: 18 })).toBe(false);
  });
});
