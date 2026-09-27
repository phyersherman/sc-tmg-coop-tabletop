import type { TerrainSize } from '@engine/types/terrain';

export type TerrainSetId = 'lost-temple' | 'lost-temple-ramp';

export interface TerrainCatalogItem {
  id: string;
  size: TerrainSize;
  grass: boolean;
  w: number;
  h: number;
  label: string;
  /** Copies of this piece in one box of each Archon product that includes it. */
  sets?: Partial<Record<TerrainSetId, number>>;
  /** Footprint is an estimate, not a published value. */
  approx?: boolean;
  /**
   * The same piece in the rulebook's terrain key (its picture in public/terrain-ref), matched by footprint: the
   * Command Center editor and the rulebook name the Lost Temple pieces differently.
   */
  ref?: string;
}

export interface TerrainSet {
  id: TerrainSetId;
  name: string;
  blurb: string;
}

export const TERRAIN_SETS: TerrainSet[] = [
  { id: 'lost-temple', name: 'Lost Temple Terrain Expansion Set', blurb: 'The 15-piece box with the 54"×36" playmat: 6 walls, 5 scatter pieces and 4 grass patches, footprints as published in the Command Center map editor.' },
  { id: 'lost-temple-ramp', name: 'Lost Temple Ramp', blurb: 'The high-ground expansion: one 15.9"×8.15" Size 3 plateau with a ramp.' },
];

/** Official Archon terrain, footprints and Size values as published in the Command Center map editor. */
/** A catalog piece with how many of it you own. */
export interface TerrainInventoryItem extends TerrainCatalogItem {
  count: number;
}

export const TERRAIN_CATALOG: TerrainCatalogItem[] = [
  { id: 'lt-wall-i-1', size: 2, grass: false, w: 5.1, h: 1.7, label: 'Wall I type 1', sets: { 'lost-temple': 1 }, ref: 'wall-set-3' },
  { id: 'lt-wall-i-2', size: 2, grass: false, w: 7, h: 1.2, label: 'Wall I type 2', sets: { 'lost-temple': 1 }, ref: 'wall-set-1' },
  { id: 'lt-wall-i-3', size: 2, grass: false, w: 8.7, h: 2.2, label: 'Wall I type 3', sets: { 'lost-temple': 1 }, ref: 'wall-set-2' },
  { id: 'lt-wall-l-1', size: 2, grass: false, w: 7.5, h: 4, label: 'Wall L type 1', sets: { 'lost-temple': 1 }, ref: 'wall-set-4' },
  { id: 'lt-wall-l-2', size: 2, grass: false, w: 7.5, h: 4, label: 'Wall L type 2', sets: { 'lost-temple': 1 }, ref: 'wall-set-5' },
  { id: 'lt-wall-short', size: 2, grass: false, w: 3.2, h: 1, label: 'Wall short', sets: { 'lost-temple': 1 }, ref: 'wall-set-6' },
  { id: 'lt-scatter-1', size: 1, grass: false, w: 4.2, h: 2.9, label: 'Scatter type 1', sets: { 'lost-temple': 1 }, ref: 'head-statue' },
  { id: 'lt-scatter-2', size: 1, grass: false, w: 3.2, h: 2.6, label: 'Scatter type 2', sets: { 'lost-temple': 1 }, ref: 'statue-shard' },
  { id: 'lt-scatter-3', size: 1, grass: false, w: 3, h: 2, label: 'Scatter type 3', sets: { 'lost-temple': 1 }, ref: 'vespene-geyser' },
  { id: 'lt-scatter-4', size: 1, grass: false, w: 1.8, h: 0.8, label: 'Scatter type 4', sets: { 'lost-temple': 1 }, ref: 'protoss-banner' },
  { id: 'lt-scatter-5', size: 1, grass: false, w: 1.2, h: 1.2, label: 'Scatter type 5', sets: { 'lost-temple': 1 }, ref: 'temple-obelisk' },
  { id: 'lt-grass-1', size: 2, grass: true, w: 2.8, h: 1.3, label: 'Grass type 1', sets: { 'lost-temple': 4 }, ref: 'shrubs-a' },
  { id: 'lt-ramp', size: 3, grass: false, w: 15.9, h: 8.15, label: 'Lost Temple Ramp (high ground)', sets: { 'lost-temple-ramp': 1 }, ref: 'lost-temple-ramp' },
];

/** Counts for one box of a set. */
export function setContents(setId: TerrainSetId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of TERRAIN_CATALOG) {
    const n = i.sets?.[setId];
    if (n) out[i.id] = n;
  }
  return out;
}
