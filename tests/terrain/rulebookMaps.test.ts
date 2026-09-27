import { describe, expect, it } from 'vitest';
import { DEPLOYMENTS } from '@data/index';
import { RULEBOOK_MAPS, mapsFor, piecesNeeded, rollMap, rulebookLayout } from '@data/terrainMaps';
import { distToPiece, rampLevel, pieceBounds } from '@engine/terrain/geometry';
import { createGame } from '@engine/director/reducer';
import { makeConfig } from '../engine/helpers';

describe('rulebook map layouts', () => {
  it('has the nine printed maps: six standard, three skirmish', () => {
    expect(RULEBOOK_MAPS).toHaveLength(9);
    expect(mapsFor('standard')).toHaveLength(6);
    expect(mapsFor('skirmish')).toHaveLength(3);
    expect(RULEBOOK_MAPS.map((m) => m.page)).toEqual([116, 117, 118, 119, 120, 121, 122, 123, 124]);
  });

  it('uses exactly the Lost Temple terrain the page asks for: one set on a skirmish table, two on a standard one', () => {
    const one: Record<string, number> = {
      'Head Statue': 1, 'Statue Shard': 1, 'Vespene Geyser': 1, 'Shrubs A': 2, 'Shrubs B': 2, 'Protoss Banner': 1,
      'Temple Obelisk': 1, 'Wall Set 1': 1, 'Wall Set 2': 1, 'Wall Set 3': 1, 'Wall Set 4': 1, 'Wall Set 5': 1, 'Wall Set 6': 1,
    };
    for (const m of RULEBOOK_MAPS) {
      const sets = m.scale === 'standard' ? 2 : 1;
      const need = Object.fromEntries(piecesNeeded(m).map((p) => [p.label, p.count]));
      for (const [label, n] of Object.entries(one)) expect(need[label], `${m.id} ${label}`).toBe(n * sets);
      expect(need['Lost Temple Ramp'] ?? 0, m.id).toBe(m.ramps);
    }
  });

  it('keeps every piece on the table', () => {
    for (const m of RULEBOOK_MAPS) {
      for (const p of m.pieces) {
        const b = pieceBounds(p);
        expect(b.x, `${m.id} #${p.n}`).toBeGreaterThan(-1.5);
        expect(b.y, `${m.id} #${p.n}`).toBeGreaterThan(-1.5);
        expect(b.x + b.w, `${m.id} #${p.n}`).toBeLessThan(m.table.width + 1.5);
        expect(b.y + b.h, `${m.id} #${p.n}`).toBeLessThan(m.table.height + 1.5);
      }
    }
  });

  it('never leaves a mission marker inside a wall, whatever deployment card is drawn', () => {
    let moved = 0;
    for (const m of RULEBOOK_MAPS) {
      for (const d of DEPLOYMENTS.filter((x) => (x.scale === 'grand' ? 'standard' : x.scale) === m.scale)) {
        const g = createGame(makeConfig({ modeId: 'frontlines', deploymentId: d.id, terrainMapId: m.id }), d, rulebookLayout(m.id));
        for (const mk of g.markers) {
          for (const p of g.terrain.pieces.filter((q) => q.size >= 2 && !q.grass && q.catalogId !== 'lt-ramp')) {
            expect(distToPiece(mk, p), `${m.id} on ${d.id}: marker ${mk.id} under ${p.label}`).toBeGreaterThanOrEqual(0.3);
          }
          // Never across two heights: wholly off the Lost Temple Ramp, or wholly on its plateau.
          for (const p of g.terrain.pieces.filter((q) => q.catalogId === 'lt-ramp')) {
            const d = distToPiece(mk, p);
            if (d > 0) expect(d, `${m.id} on ${d}: marker ${mk.id} on the edge of the ramp`).toBeGreaterThanOrEqual(2);
          }
          // A marker moved because of high ground goes up onto a plateau, never on the ramp or below it.
          if (mk.movedFrom?.piece === 'Lost Temple Ramp') {
            const up = g.terrain.pieces.some((p) => p.catalogId === 'lt-ramp' && distToPiece(mk, p) === 0 && rampLevel(mk, p) === 1);
            expect(up, `${m.id} on ${d.id}: marker ${mk.id} set below the plateau`).toBe(true);
          }
          if (mk.movedFrom) {
            moved++;
            // Set as close as it can be: within a few inches of the card's spot (up onto a ramp's plateau, further).
            expect(Math.hypot(mk.x - mk.movedFrom.x, mk.y - mk.movedFrom.y)).toBeLessThan(11);
          }
        }
      }
    }
    // Only the card-and-map pairs that really collide (a centre marker on a Lost Temple Ramp moves off it).
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(45);
  });

  it('rolls the same map for the same seed, and a layout is a fresh copy each time', () => {
    expect(rollMap('standard', 7).id).toBe(rollMap('standard', 7).id);
    const a = rulebookLayout('rulebook-1');
    a.pieces[0]!.x = 999;
    expect(rulebookLayout('rulebook-1').pieces[0]!.x).not.toBe(999);
  });
});
