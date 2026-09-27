import type { DeploymentLayout, Edge, EdgeSegment, Rect, TableSpec } from '../types/terrain';

export interface Pt {
  x: number;
  y: number;
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

export function segmentMidpoint(seg: EdgeSegment, table: TableSpec): Pt {
  const m = (seg.from + seg.to) / 2;
  switch (seg.edge) {
    case 'N':
      return { x: m, y: 0 };
    case 'S':
      return { x: m, y: table.height };
    case 'W':
      return { x: 0, y: m };
    case 'E':
      return { x: table.width, y: m };
  }
}

/** Closest point on a segment to p. */
export function closestOnSegment(seg: EdgeSegment, table: TableSpec, p: Pt): Pt {
  const clamp = (v: number) => Math.max(seg.from, Math.min(seg.to, v));
  switch (seg.edge) {
    case 'N':
      return { x: clamp(p.x), y: 0 };
    case 'S':
      return { x: clamp(p.x), y: table.height };
    case 'W':
      return { x: 0, y: clamp(p.y) };
    case 'E':
      return { x: table.width, y: clamp(p.y) };
  }
}

/** Zone of influence rectangle (6" inward) for a segment. */
export function zoiRect(seg: EdgeSegment, table: TableSpec, depth = 6): Rect {
  switch (seg.edge) {
    case 'N':
      return { x: seg.from, y: 0, w: seg.to - seg.from, h: depth };
    case 'S':
      return { x: seg.from, y: table.height - depth, w: seg.to - seg.from, h: depth };
    case 'W':
      return { x: 0, y: seg.from, w: depth, h: seg.to - seg.from };
    case 'E':
      return { x: table.width - depth, y: seg.from, w: depth, h: seg.to - seg.from };
  }
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y);
}

export function rectCenter(r: Rect): Pt {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function pointInRect(p: Pt, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

/** Distance from a point to a rect (0 if inside). */
export function distToRect(p: Pt, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

const EDGE_NAME: Record<Edge, string> = { N: 'top', S: 'bottom', W: 'left', E: 'right' };

export function describeSegment(seg: EdgeSegment, table: TableSpec): string {
  const full = seg.from === 0 && seg.to === (seg.edge === 'N' || seg.edge === 'S' ? table.width : table.height);
  const base = `${EDGE_NAME[seg.edge]} edge`;
  return full ? `the ${base}` : `the ${base}, ${seg.from}"–${seg.to}" from the ${seg.edge === 'N' || seg.edge === 'S' ? 'left' : 'top'}`;
}

export function aiSegments(layout: DeploymentLayout): EdgeSegment[] {
  return layout.entry.red;
}

export function playerSegments(layout: DeploymentLayout): EdgeSegment[] {
  return layout.entry.blue;
}

/** Which quarter (0..3) a point is in: 0 TL, 1 TR, 2 BL, 3 BR. */
export function quarterOf(p: Pt, table: TableSpec): number {
  const right = p.x >= table.width / 2 ? 1 : 0;
  const bottom = p.y >= table.height / 2 ? 2 : 0;
  return right + bottom;
}

/** Anything with a footprint that may be turned: a terrain piece. */
export interface Turnable extends Rect { rot?: number }

/**
 * A point in a piece's own frame: a piece turned by `rot` degrees is measured as if it were not, by turning the
 * point the other way about the piece's centre. Distances and crossings are unchanged by the turn, so every
 * rectangle check works on turned pieces through this.
 */
export function pieceLocal(p: Pt, t: Turnable): Pt {
  if (!t.rot) return p;
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const a = (-t.rot * Math.PI) / 180;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
}

/** Distance from a point to a (possibly turned) piece's footprint; 0 inside. */
export function distToPiece(p: Pt, t: Turnable): number {
  return distToRect(pieceLocal(p, t), t);
}

/** The four corners of a piece's footprint on the table. */
export function pieceCorners(t: Turnable): Pt[] {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const a = ((t.rot ?? 0) * Math.PI) / 180;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const dx = (sx! * t.w) / 2;
    const dy = (sy! * t.h) / 2;
    return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
  });
}

/** The upright box around a piece, turned or not. */
export function pieceBounds(t: Turnable): Rect {
  if (!t.rot) return { x: t.x, y: t.y, w: t.w, h: t.h };
  const c = pieceCorners(t);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/**
 * The ramp of a Lost Temple Ramp piece, as the model is built: a lane down one long side, climbing from the ground at
 * the access end to the plateau's level `RAMP_LEN` of the way along. The rest of the footprint is plateau.
 * In the piece's own frame: `u` runs along the long side toward the access end (0 at the centre), `v` across it,
 * with the lane on the `side` of `v`. Rules (movement, markers) and the battlefield art both draw on this.
 */
export interface RampLane {
  /** Half the long side and half the short side (inches). */
  hl: number;
  ht: number;
  /** Lane width and length (inches). */
  w: number;
  len: number;
  /** Which side of the long axis the lane runs down (+1 or -1). */
  side: 1 | -1;
  /** Table point → (u, v) in the piece's frame, and back. */
  toLocal(p: Pt): { u: number; v: number };
  toTable(u: number, v: number): Pt;
}
export const RAMP_LEN = 0.6;
// Worked out once per piece and position: the rules ask for it at every point a path search tries.
const lanes = new WeakMap<object, { key: string; lane: RampLane }>();
export function rampLane(t: Turnable & { accessPoints?: Pt[]; rampSide?: 1 | -1 }): RampLane {
  const key = `${t.x},${t.y},${t.w},${t.h},${t.rot ?? 0},${t.rampSide ?? 0},${t.accessPoints?.[0]?.x ?? ''},${t.accessPoints?.[0]?.y ?? ''}`;
  const hit = lanes.get(t);
  if (hit && hit.key === key) return hit.lane;
  const lane = makeRampLane(t);
  lanes.set(t, { key, lane });
  return lane;
}
function makeRampLane(t: Turnable & { accessPoints?: Pt[]; rampSide?: 1 | -1 }): RampLane {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const long = t.w >= t.h;
  const hl = (long ? t.w : t.h) / 2;
  const ht = (long ? t.h : t.w) / 2;
  const rot = ((t.rot ?? 0) * Math.PI) / 180;
  // The long axis on the table, turned to point at the access end.
  let dx = long ? Math.cos(rot) : -Math.sin(rot);
  let dy = long ? Math.sin(rot) : Math.cos(rot);
  const acc = t.accessPoints?.[0];
  if (acc && (acc.x - cx) * dx + (acc.y - cy) * dy < 0) { dx = -dx; dy = -dy; }
  // The across axis, a quarter turn clockwise from it.
  const nx = -dy, ny = dx;
  // The ramp's side: where the access point says, or (the rulebook sets it at the middle of the end) the side
  // facing down the table, as the battlefield is viewed, so the ramp is seen climbing onto the plateau.
  const av = acc ? (acc.x - cx) * nx + (acc.y - cy) * ny : 0;
  const side: 1 | -1 = t.rampSide ?? (Math.abs(av) > 0.5 ? (av < 0 ? -1 : 1) : Math.abs(ny) > 0.05 ? (ny > 0 ? 1 : -1) : nx > 0 ? 1 : -1);
  return {
    hl, ht, side,
    w: Math.min(ht * 2 * 0.47, 4),
    len: hl * 2 * RAMP_LEN,
    toLocal: (p) => ({ u: (p.x - cx) * dx + (p.y - cy) * dy, v: (p.x - cx) * nx + (p.y - cy) * ny }),
    toTable: (u, v) => ({ x: cx + u * dx + v * nx, y: cy + u * dy + v * ny }),
  };
}

/** How high a table point stands on a Lost Temple Ramp piece, 0 (ground) to 1 (plateau). */
export function rampLevel(p: Pt, t: Turnable & { accessPoints?: Pt[]; rampSide?: 1 | -1 }): number {
  const r = rampLane(t);
  const { u, v } = r.toLocal(p);
  if (Math.abs(u) > r.hl || Math.abs(v) > r.ht) return 0;
  const inner = r.hl - r.len;
  if (v * r.side >= r.ht - r.w && u >= inner) return 1 - (u - inner) / r.len;
  return 1;
}

/**
 * Whether a base centre at `p`, `cl` inches across, is blocked by a Lost Temple Ramp piece for a unit that has to use
 * its access point: the piece's edges are a cliff except where the ramp meets the ground, and the plateau's edge
 * along the ramp is a cliff except where the ramp tops out. Inside, the plateau and the ramp are open ground.
 */
export function rampBlocks(p: Pt, t: Turnable & { accessPoints?: Pt[]; rampSide?: 1 | -1 }, cl: number): boolean {
  // Far from the piece: nothing to check.
  const reach = Math.hypot(t.w, t.h) / 2 + cl;
  if (Math.abs(p.x - (t.x + t.w / 2)) > reach || Math.abs(p.y - (t.y + t.h / 2)) > reach) return false;
  const r = rampLane(t);
  const { u, v } = r.toLocal(p);
  const vs = v * r.side;
  const outside = Math.max(Math.abs(u) - r.hl, Math.abs(v) - r.ht);
  if (outside >= cl) return false;
  // Within the ramp's mouth: open, however close to the end edge.
  const inMouth = u > r.hl - r.len && vs >= r.ht - r.w + cl && vs <= r.ht - cl;
  if (!inMouth) {
    const inside = outside < 0;
    const toEdge = inside ? Math.min(r.hl - Math.abs(u), r.ht - Math.abs(v)) : outside;
    if (toEdge < cl) return true;
  }
  // The plateau's edge beside the ramp, where the ramp is more than about an inch below it.
  const inner = r.hl - r.len;
  if (Math.abs(vs - (r.ht - r.w)) < cl && u > inner + 1 && u < r.hl + cl) return true;
  return false;
}

/**
 * Choose the side each Lost Temple Ramp's ramp runs down, so it comes down onto clear ground: the patch just past
 * its foot must be on the table and free of other terrain (two ramp pieces set together, as rulebook map 5 has
 * them, interlock with their ramps on opposite sides). Otherwise the side facing down the table, as it is viewed.
 */
export function settleRamps(pieces: (Turnable & { catalogId: string; grass: boolean; accessPoints?: Pt[]; rampSide?: 1 | -1 })[], table: { width: number; height: number }): void {
  // Sets each ramp's side on the piece.
  for (const t of pieces) {
    if (!t.catalogId.includes('ramp')) continue;
    t.rampSide = undefined;
    const viewed = rampLane(t).side;
    const blocked = (side: 1 | -1) => {
      const r = rampLane({ ...t, rampSide: side });
      let n = 0;
      for (let du = 0.5; du <= 3; du += 0.5)
        for (let k = 0; k <= 4; k++) {
          const q = r.toTable(r.hl + du, side * (r.ht - r.w * (0.1 + 0.8 * (k / 4))));
          if (q.x < 0 || q.y < 0 || q.x > table.width || q.y > table.height) n++;
          else if (pieces.some((o) => o !== t && !o.grass && distToPiece(q, o) < 0.3)) n++;
        }
      return n;
    };
    const a = blocked(viewed), b = blocked(viewed === 1 ? -1 : 1);
    t.rampSide = b < a ? (viewed === 1 ? -1 : 1) : viewed;
  }
}
