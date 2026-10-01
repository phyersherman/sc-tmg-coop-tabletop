import { partsOf } from '@data/terrainCatalog';
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

/**
 * The rectangles a piece is measured by: itself, or for an L-shaped wall its two arms, each turned about its own
 * centre where the piece's turn would put it. Every check that measures a piece runs over these.
 */
export function pieceParts(t: Turnable & { catalogId?: string }): Turnable[] {
  const parts = t.catalogId ? partsOf(t.catalogId) : null;
  // The arms are laid out in the catalog piece's own box: a piece given another footprint is one rectangle.
  if (!parts || Math.abs(t.w - parts.box.w) > 0.05 || Math.abs(t.h - parts.box.h) > 0.05) return [t];
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const a = ((t.rot ?? 0) * Math.PI) / 180;
  return parts.arms.map((q) => {
    // The arm's centre in the piece's frame, turned with the piece about the piece's centre.
    const dx = t.x + q.x + q.w / 2 - cx;
    const dy = t.y + q.y + q.h / 2 - cy;
    const mx = cx + dx * Math.cos(a) - dy * Math.sin(a);
    const my = cy + dx * Math.sin(a) + dy * Math.cos(a);
    return { x: mx - q.w / 2, y: my - q.h / 2, w: q.w, h: q.h, rot: t.rot };
  });
}

/** A piece's parts and the circle round its whole footprint, kept until the piece is moved or turned. */
interface PieceInfo { x: number; y: number; w: number; h: number; rot: number; parts: Turnable[]; cx: number; cy: number; r: number }
const pieceInfo = new WeakMap<object, PieceInfo>();
function infoOf(t: Turnable & { catalogId?: string }): PieceInfo {
  const rot = t.rot ?? 0;
  const had = pieceInfo.get(t);
  if (had && had.x === t.x && had.y === t.y && had.w === t.w && had.h === t.h && had.rot === rot) return had;
  // Every part lies inside the piece's own box, which turns about its centre: this circle holds them all.
  const info = { x: t.x, y: t.y, w: t.w, h: t.h, rot, parts: pieceParts(t), cx: t.x + t.w / 2, cy: t.y + t.h / 2, r: Math.hypot(t.w, t.h) / 2 };
  pieceInfo.set(t, info);
  return info;
}

/** Distance from a point to a (possibly turned) piece's footprint; 0 inside. An L wall: to the nearer arm. */
export function distToPiece(p: Pt, t: Turnable & { catalogId?: string }): number {
  let best = Infinity;
  for (const part of infoOf(t).parts) best = Math.min(best, distToRect(pieceLocal(p, part), part));
  return best;
}

/** A distance no greater than `distToPiece(p, t)`, found without measuring the piece's parts. */
export function pieceLowerBound(p: Pt, t: Turnable & { catalogId?: string }): number {
  const info = infoOf(t);
  return Math.max(0, Math.hypot(p.x - info.cx, p.y - info.cy) - info.r);
}

/** Whether a point is closer than `d` to a piece's footprint: `distToPiece(p, t) < d`, skipping pieces far away. */
export function nearPiece(p: Pt, t: Turnable & { catalogId?: string }, d: number): boolean {
  const info = infoOf(t);
  if (Math.hypot(p.x - info.cx, p.y - info.cy) - info.r >= d) return false;
  return distToPiece(p, t) < d;
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

/** Where a point stands on a Lost Temple Ramp piece: off it (GROUND LEVEL), on its ramp (MID GROUND) or on its plateau (HIGH GROUND). */
export type RampZone = 'ground' | 'ramp' | 'plateau';

/**
 * The elevation of a table point on a Lost Temple Ramp piece (8.5.3): a ramp is Size 1 MID GROUND along its whole
 * surface, the rest of the footprint is the plateau, HIGH GROUND. `inset` is how far inside the footprint a point
 * must be to count as on the piece, so a base touching the cliff from the ground is still on the ground.
 */
export function rampZone(p: Pt, t: Turnable & { accessPoints?: Pt[]; rampSide?: 1 | -1 }, inset = 0): RampZone {
  const r = rampLane(t);
  const { u, v } = r.toLocal(p);
  if (Math.abs(u) > r.hl - inset || Math.abs(v) > r.ht - inset) return 'ground';
  return v * r.side >= r.ht - r.w && u >= r.hl - r.len ? 'ramp' : 'plateau';
}

/**
 * A Lost Temple Ramp piece in its own frame (`u` along the long side, `v` across): the rectangles its plateau
 * covers and the one its ramp covers, for a Line of Sight trace that a plateau blocks and a ramp does not.
 */
export function rampParts(t: Turnable & { accessPoints?: Pt[]; rampSide?: 1 | -1 }): { plateau: Rect[]; lane: Rect; toLocal(p: Pt): Pt } {
  const r = rampLane(t);
  const inner = r.hl - r.len;
  // Across the piece, the ramp takes `w` on its side and the plateau beside it the rest.
  const laneV = r.side === 1 ? r.ht - r.w : -r.ht;
  const besideV = r.side === 1 ? -r.ht : -r.ht + r.w;
  return {
    plateau: [
      { x: -r.hl, y: -r.ht, w: r.hl + inner, h: r.ht * 2 },
      { x: inner, y: besideV, w: r.len, h: r.ht * 2 - r.w },
    ],
    lane: { x: inner, y: laneV, w: r.len, h: r.w },
    toLocal: (p) => { const q = r.toLocal(p); return { x: q.u, y: q.v }; },
  };
}

/**
 * How far a table point is from one of the ramp's two ACCESS POINTS: its foot, where it meets the ground, or its
 * top, where it meets the plateau. Each is the full width of the ramp.
 */
export function rampEndDistance(p: Pt, t: Turnable & { accessPoints?: Pt[]; rampSide?: 1 | -1 }, end: 'foot' | 'top'): number {
  const r = rampLane(t);
  const { u, v } = r.toLocal(p);
  const at = end === 'foot' ? r.hl : r.hl - r.len;
  const vs = v * r.side;
  return Math.hypot(u - at, Math.max(r.ht - r.w - vs, 0, vs - r.ht));
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
 * Whether a base of radius `r` centred at `p` cannot be set here because of a Lost Temple Ramp piece (4.6: a model
 * is never set where its base does not fit). Off the piece and up on its plateau the whole base keeps clear of the
 * cliffs; on the ramp, and at its foot, a base wider than the ramp is measured by `onRamp`, the half-gap its Unit
 * passes, so the ramp stays open to it.
 */
export function rampBlocksBase(p: Pt, t: Turnable & { accessPoints?: Pt[]; rampSide?: 1 | -1 }, r: number, onRamp: number): boolean {
  if (!rampBlocks(p, t, r)) return false;
  if (onRamp >= r) return true;
  const lane = rampLane(t);
  const { u, v } = lane.toLocal(p);
  const vs = v * lane.side;
  const alongRamp = u >= lane.hl - lane.len && vs >= lane.ht - lane.w && vs <= lane.ht;
  return !alongRamp || rampBlocks(p, t, onRamp);
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
