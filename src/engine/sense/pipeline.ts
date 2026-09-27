import type { Pt, SenseSnapshot, TagRegistry } from './types';
import type { TableSpec } from '../types/terrain';
import { applyH, centroid, computeHomography, type Homography } from './homography';

export interface DetectedMarker {
  id: number;
  /** Four corners in image pixels, clockwise from the marker's top-left. */
  corners: Pt[];
}

export interface PipelineOptions {
  /** Printed side length of the corner tags, in inches (their centres sit that far in from each table corner). */
  cornerTagInches: number;
  /** Previous homography to keep using when a corner tag is hidden. */
  prevH?: Homography | null;
  now?: number;
}

/** Convert detected markers into a table-space snapshot. Pure. */
export function processMarkers(markers: DetectedMarker[], reg: TagRegistry, table: TableSpec, opts: PipelineOptions): { snapshot: SenseSnapshot; H: Homography | null } {
  const byId = new Map<number, DetectedMarker>();
  for (const m of markers) byId.set(m.id, m);
  const inset = opts.cornerTagInches / 2;
  const dst: Pt[] = [
    { x: inset, y: inset },
    { x: table.width - inset, y: inset },
    { x: table.width - inset, y: table.height - inset },
    { x: inset, y: table.height - inset },
  ];
  const cornerMarkers = reg.corners.map((id) => byId.get(id));
  let H: Homography | null = opts.prevH ?? null;
  if (cornerMarkers.every(Boolean)) {
    const src = cornerMarkers.map((m) => centroid(m!.corners));
    H = computeHomography(src, dst) ?? H;
  }
  const snapshot: SenseSnapshot = { at: opts.now ?? Date.now(), calibrated: !!H, ai: {}, players: {}, terrain: {}, unknown: [] };
  if (!H) return { snapshot, H };
  for (const m of markers) {
    if (reg.corners.includes(m.id)) continue;
    const c = applyH(H, centroid(m.corners));
    const model = reg.models[m.id];
    if (model) {
      const bucket = model.side === 'ai' ? snapshot.ai : snapshot.players;
      (bucket[model.unitId] ??= []).push({ x: c.x, y: c.y });
      continue;
    }
    const tn = reg.terrain[m.id];
    if (tn !== undefined && m.corners.length >= 2) {
      const a = applyH(H, m.corners[0]!);
      const b = applyH(H, m.corners[1]!);
      const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      const rot = Math.abs(((ang % 180) + 180) % 180 - 90) < 45 ? 90 : 0;
      snapshot.terrain[tn] = { x: c.x, y: c.y, rot };
      continue;
    }
    snapshot.unknown.push(m.id);
  }
  return { snapshot, H };
}
