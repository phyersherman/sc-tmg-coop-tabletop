import { describe, expect, it } from 'vitest';
import { reachOutline } from '@engine/sense/geometry2d';
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
