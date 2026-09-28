import { describe, expect, it } from 'vitest';
import { distToPiece, pieceParts } from '@engine/terrain/geometry';
import { losBlocked, passable } from '@engine/sense/geometry2d';
import type { TerrainPiece } from '@engine/types/terrain';

// Wall L type 1: a long arm along the top of its box, a short arm down the right end. The bottom-left of the box
// is open ground.
const lWall = (x: number, y: number, rot?: number): TerrainPiece => ({ n: 1, catalogId: 'lt-wall-l-1', size: 2, grass: false, x, y, w: 7.5, h: 4, label: 'Wall L type 1', rot });

describe('an L-shaped wall is its two arms', () => {
  it('has two parts, and its empty corner is open ground', () => {
    const w = lWall(10, 10);
    expect(pieceParts(w)).toHaveLength(2);
    // Inside the box, but in the corner the arms leave open: clear of the wall, so a model may stand there.
    const corner = { x: 11.5, y: 13 };
    expect(distToPiece(corner, w)).toBeGreaterThan(0.5);
    expect(passable(corner, [w])).toBe(true);
    // On the long arm: inside the wall.
    expect(distToPiece({ x: 13, y: 11.2 }, w)).toBe(0);
  });
  it('does not block sight across its empty corner', () => {
    const w = lWall(10, 10);
    // From below the box, up through the open corner, to a spot left of the box: no arm on the line.
    expect(losBlocked({ x: 12, y: 15 }, 1, { x: 8, y: 12.5 }, 1, [w])).toBe(false);
    // Straight through the long arm: blocked.
    expect(losBlocked({ x: 13, y: 8 }, 1, { x: 13, y: 14 }, 1, [w])).toBe(true);
  });
  it('keeps its arms when turned', () => {
    const w = lWall(10, 10, 90);
    const parts = pieceParts(w);
    expect(parts.every((p) => p.rot === 90)).toBe(true);
    // Turned a quarter, the box's centre stays put and the arms sit round it.
    const cx = 10 + 7.5 / 2, cy = 10 + 2;
    for (const p of parts) expect(Math.hypot(p.x + p.w / 2 - cx, p.y + p.h / 2 - cy)).toBeLessThan(4);
  });
});
