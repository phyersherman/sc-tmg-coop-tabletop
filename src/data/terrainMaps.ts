import type { TerrainLayout, TerrainPiece } from '@engine/types/terrain';
import raw from './terrainMaps.json';

/**
 * The pre-made map layouts on the last pages of the core rulebook (Part 9.3: "set terrain by selecting or
 * rolling for one of the pre-made maps"). Transcribed from the printed maps: each piece is the rulebook's own
 * terrain (Wall Set 1–6, Head Statue, Shrubs A …) at its printed position and angle. Standard maps are
 * printed upright and turned here onto the 54" × 36" table; an L-shaped wall is kept as its two sides.
 */
export interface RulebookMap {
  id: string;
  name: string;
  /** The page of the core rulebook it is printed on. */
  page: number;
  scale: 'skirmish' | 'standard';
  table: { width: number; height: number };
  /** How many Lost Temple Ramps it needs (0 for most). */
  ramps: number;
  pieces: TerrainPiece[];
}

export const RULEBOOK_MAPS: RulebookMap[] = (raw as unknown as { maps: RulebookMap[] }).maps;

export function rulebookMap(id: string): RulebookMap {
  const m = RULEBOOK_MAPS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown rulebook map ${id}`);
  return m;
}

/** The maps that fit a deployment's table. */
export function mapsFor(scale: 'skirmish' | 'standard' | 'grand'): RulebookMap[] {
  const s = scale === 'grand' ? 'standard' : scale;
  return RULEBOOK_MAPS.filter((m) => m.scale === s);
}

/** Roll for a map, as the rulebook allows: the same seed always gives the same map. */
export function rollMap(scale: 'skirmish' | 'standard' | 'grand', seed: number): RulebookMap {
  const list = mapsFor(scale);
  return list[Math.abs(seed) % list.length]!;
}

/** A rulebook map as the table's terrain. */
export function rulebookLayout(id: string): TerrainLayout {
  const m = rulebookMap(id);
  return { seed: 0, table: { ...m.table }, pieces: m.pieces.map((p) => ({ ...p, accessPoints: p.accessPoints?.map((a) => ({ ...a })) })), fireLanes: [], violations: [] };
}

/** The Lost Temple set, as the rulebook names its pieces: what to take out of the box for a map. */
export function piecesNeeded(m: { pieces: TerrainPiece[] }): { label: string; count: number }[] {
  const tally = new Map<string, number>();
  for (const p of m.pieces) {
    // The two sides of an L-shaped wall are one piece on the table.
    if (/— short side$/.test(p.label)) continue;
    const name = p.label.replace(/ \(L\) — long side$/, '');
    tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  return [...tally].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label));
}
