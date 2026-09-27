import { describe, expect, it } from 'vitest';
import { distToPiece, pieceBounds, pieceCorners } from '@engine/terrain/geometry';
import { losBlocked, passable } from '@engine/sense/geometry2d';
import type { TerrainPiece } from '@engine/types/terrain';

// A 10" × 1" wall centred on (10, 10), turned 45° so it runs from top-left to bottom-right.
const wall: TerrainPiece = { n: 1, catalogId: 'wall', size: 2, grass: false, x: 5, y: 9.5, w: 10, h: 1, label: 'Wall', rot: 45 };

describe('terrain set at an angle', () => {
  it('has its corners where the turned wall really is', () => {
    const c = pieceCorners(wall);
    const ends = c.map((p) => Math.round(p.x * 10) / 10);
    expect(Math.min(...ends)).toBeCloseTo(10 - 5 * Math.SQRT1_2 - 0.5 * Math.SQRT1_2, 1);
    const b = pieceBounds(wall);
    expect(b.w).toBeCloseTo(b.h, 5);
    expect(b.w).toBeGreaterThan(7);
  });

  it('measures distance to the turned footprint, not its unturned box', () => {
    // On the wall's diagonal: inside it.
    expect(distToPiece({ x: 12, y: 12 }, wall)).toBe(0);
    // Where the unturned box would be (the far right of it), but well off the turned wall.
    expect(distToPiece({ x: 14.5, y: 10 }, wall)).toBeGreaterThan(2);
  });

  it('blocks sight across it and movement through it, and nowhere else', () => {
    expect(losBlocked({ x: 13, y: 7 }, 1, { x: 7, y: 13 }, 1, [wall])).toBe(true);
    // Beside the unturned box's right end: clear of the turned wall.
    expect(losBlocked({ x: 14.5, y: 8 }, 1, { x: 14.5, y: 12 }, 1, [wall])).toBe(false);
    expect(passable({ x: 11, y: 11 }, [wall])).toBe(false);
    expect(passable({ x: 14.5, y: 10 }, [wall])).toBe(true);
  });
});
