import { describe, expect, it } from 'vitest';
import type { TerrainPiece } from '@engine/types/terrain';
import { DEPLOYMENTS } from '@data/index';
import { piecesNeeded } from '@data/terrainMaps';
import { remixMap } from '@engine/terrain/remix';
import { distToPiece, pieceBounds } from '@engine/terrain/geometry';

const tally = (pieces: TerrainPiece[]) => piecesNeeded({ pieces }).map((p) => `${p.count}×${p.label}`).sort().join(', ');

describe('rulebook-style random tables', () => {
  for (const scale of ['standard', 'skirmish'] as const) {
    it(`${scale}: always the pieces of its printed template, on the table, with markers clear`, () => {
      const deps = DEPLOYMENTS.filter((d) => (d.scale === 'grand' ? 'standard' : d.scale) === scale);
      const shapes = new Set<string>();
      // A remix never covers a marker; only the rare fall-back to the printed map can (the game then sets the marker aside).
      let onMarker = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const dep = deps[seed % deps.length]!;
        const t = remixMap(scale, seed, dep);
        expect(tally(t.pieces), `seed ${seed}`).toBe(tally(t.template.pieces));
        for (const p of t.pieces) {
          const b = pieceBounds(p);
          expect(b.x).toBeGreaterThanOrEqual(-0.9);
          expect(b.x + b.w).toBeLessThanOrEqual(t.table.width + 0.9);
          expect(b.y).toBeGreaterThanOrEqual(-0.9);
          expect(b.y + b.h).toBeLessThanOrEqual(t.table.height + 0.9);
        }
        if (dep.markers.some((m) => t.pieces.some((p) => p.size >= 2 && !p.grass && !p.catalogId.includes('ramp') && distToPiece(m, p) < 0.3))) onMarker++;
        shapes.add(t.pieces.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(';'));
      }
      // Plenty of different tables, not the same few.
      expect(shapes.size).toBeGreaterThan(30);
      expect(onMarker).toBeLessThanOrEqual(2);
    });
  }

  it('keeps the standard tables point-symmetric, as every printed one is', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const t = remixMap('standard', seed);
      const W = t.table.width, H = t.table.height;
      for (const p of t.pieces) {
        const c = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
        const twin = t.pieces.find((q) => q.catalogId === p.catalogId && Math.hypot(q.x + q.w / 2 - (W - c.x), q.y + q.h / 2 - (H - c.y)) < 0.05);
        expect(twin, `seed ${seed} ${p.label}`).toBeDefined();
      }
    }
  });

  it('gives the same table for the same seed', () => {
    expect(JSON.stringify(remixMap('skirmish', 9).pieces)).toBe(JSON.stringify(remixMap('skirmish', 9).pieces));
  });
});

describe('ramps in a random table', () => {
  it('stay square to the table', () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const p of remixMap('standard', seed).pieces.filter((q) => q.catalogId.includes('ramp'))) expect(Math.abs(p.rot ?? 0) % 180, `seed ${seed}`).toBe(0);
    }
  });
});
