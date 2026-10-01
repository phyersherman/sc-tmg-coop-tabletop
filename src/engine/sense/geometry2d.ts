import type { Pt } from './types';
import type { Rect, TerrainPiece } from '../types/terrain';
import { dist, distToPiece, nearPiece, pieceLocal, rampBlocks, rampLane, rampParts, rampZone, pieceParts, type RampZone } from '../terrain/geometry';

/**
 * A binary min-heap of lattice keys by priority. The path searches used to scan their whole open list for the
 * cheapest node on every step, which on the quarter-inch lattice cost long enough to lock the page on a slow
 * machine; ties still come out oldest first, so the paths found are the same.
 */
class KeyHeap {
  private keys: number[] = [];
  private pri: number[] = [];
  private seq: number[] = [];
  private n = 0;
  get size(): number { return this.keys.length; }
  /** The priority the next pop() was pushed with. */
  get topPriority(): number { return this.pri[0]!; }
  /** `order` breaks ties (lowest first); by default, the order pushed. */
  push(k: number, p: number, order = this.n++): void {
    this.keys.push(k); this.pri.push(p); this.seq.push(order);
    let i = this.keys.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (!this.less(i, up)) break;
      this.swap(i, up);
      i = up;
    }
  }
  pop(): number {
    const top = this.keys[0]!;
    const last = this.keys.length - 1;
    this.swap(0, last);
    this.keys.pop(); this.pri.pop(); this.seq.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.keys.length && this.less(l, m)) m = l;
      if (r < this.keys.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }
  private less(a: number, b: number): boolean {
    return this.pri[a]! < this.pri[b]! || (this.pri[a] === this.pri[b] && this.seq[a]! < this.seq[b]!);
  }
  private swap(a: number, b: number): void {
    [this.keys[a], this.keys[b]] = [this.keys[b]!, this.keys[a]!];
    [this.pri[a], this.pri[b]] = [this.pri[b]!, this.pri[a]!];
    [this.seq[a], this.seq[b]] = [this.seq[b]!, this.seq[a]!];
  }
}

/**
 * Which lattice points are shut, worked out only for the points a search actually reaches (testing every point
 * of the quarter-inch lattice against the terrain up front was most of a search's cost), and the tie order the
 * searches break equal costs by: the order each point was first queued in.
 */
function lattice(W: number, H: number, cell: number, open: (p: Pt) => boolean, alwaysOpen: number[]) {
  const state = new Uint8Array((W + 1) * (H + 1));
  for (const k of alwaysOpen) state[k] = 1;
  const first = new Int32Array((W + 1) * (H + 1)).fill(-1);
  let n = 0;
  return {
    blocked(k: number): boolean {
      if (!state[k]) state[k] = open({ x: (k % (W + 1)) * cell, y: Math.floor(k / (W + 1)) * cell }) ? 1 : 2;
      return state[k] === 2;
    },
    order(k: number): number {
      if (first[k]! < 0) first[k] = n++;
      return first[k]!;
    },
  };
}

/** Does segment a-b cross rectangle r? */
export function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  // Liang–Barsky clipping.
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: [number, number][] = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

/** A model's base for Line of Sight: a circle, or an oval (a capsule `half` long each way along its facing `a`). */
export interface LosBase { x: number; y: number; r: number; half?: number; a?: number }

/** What Line of Sight needs to know about the two models beyond their Size. */
export interface LosOptions {
  /** The first model is Flying (7.1.4): no Full Cover, never the model Within 1" for Direct Cover, no Size from terrain. */
  flyingA?: boolean;
  /** The second model is Flying. */
  flyingB?: boolean;
}

/** A traced point that may carry its model's base, so "Within 1" of the terrain" is measured from the base. */
type LosPoint = Pt & { r?: number; half?: number };

/** The two ends of an oval's straight part (one point for a round base). */
function baseSpine(b: LosPoint): Pt[] {
  const half = b.half ?? 0, a = b.a ?? 0;
  if (!(half > 0)) return [{ x: b.x, y: b.y }];
  const dx = Math.cos(a) * half, dy = Math.sin(a) * half;
  return [{ x: b.x - dx, y: b.y - dy }, { x: b.x, y: b.y }, { x: b.x + dx, y: b.y + dy }];
}

/** Points around the edge of a base: both caps of an oval, eight each; the centre too, for a thin base. */
function baseEdge(b: LosBase): Pt[] {
  const half = b.half ?? 0, a = b.a ?? 0;
  const ends = half > 0 ? [{ x: b.x - Math.cos(a) * half, y: b.y - Math.sin(a) * half }, { x: b.x + Math.cos(a) * half, y: b.y + Math.sin(a) * half }] : [{ x: b.x, y: b.y }];
  const out: Pt[] = [{ x: b.x, y: b.y }];
  for (const e of ends) for (let k = 0; k < 8; k++) out.push({ x: e.x + Math.cos((k * Math.PI) / 4) * b.r, y: e.y + Math.sin((k * Math.PI) / 4) * b.r });
  return out;
}

/** From the edge of a base to a terrain piece (4.1): 0 when the base touches or overlaps it. */
export function baseToPiece(b: LosPoint, t: TerrainPiece): number {
  let best = Infinity;
  const spine = baseSpine(b);
  // Along an oval's length the nearest point may lie between its ends.
  for (let i = 0; i < spine.length; i++) {
    best = Math.min(best, distToPiece(spine[i]!, t));
    if (i + 1 < spine.length) for (let k = 1; k < 4; k++) best = Math.min(best, distToPiece({ x: spine[i]!.x + ((spine[i + 1]!.x - spine[i]!.x) * k) / 4, y: spine[i]!.y + ((spine[i + 1]!.y - spine[i]!.y) * k) / 4 }, t));
  }
  return Math.max(0, best - (b.r ?? 0));
}

function ptSeg(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x, vy = b.y - a.y, len = vx * vx + vy * vy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len)) : 0;
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/** Edge to edge between two bases (4.1), 0 when they touch. */
function baseGap(a: LosPoint, b: LosPoint): number {
  const sa = baseSpine(a), sb = baseSpine(b);
  const a1 = sa[0]!, a2 = sa[sa.length - 1]!, b1 = sb[0]!, b2 = sb[sb.length - 1]!;
  const d = Math.min(ptSeg(a1, b1, b2), ptSeg(a2, b1, b2), ptSeg(b1, a1, a2), ptSeg(b2, a1, a2));
  return Math.max(0, d - (a.r ?? 0) - (b.r ?? 0));
}

/** Where a model stands (8.5.3): GROUND LEVEL, MID GROUND on a ramp, or HIGH GROUND on a plateau, and on which piece. */
export interface Elevation { zone: RampZone; piece: TerrainPiece | null }

const ZONE_RANK: Record<RampZone, number> = { ground: 0, ramp: 1, plateau: 2 };

/**
 * The elevation of a model by its base: a base on more than one level stands on the highest of them. A base is
 * on a level it reaches along the ramp (its foot, its top); what hangs over the side of a ramp is not counted.
 */
export function baseElevation(b: LosPoint, pieces: TerrainPiece[]): Elevation {
  let out: Elevation = { zone: 'ground', piece: null };
  const reach = (b.r ?? 0) + (b.half ?? 0);
  for (const t of pieces) {
    if (!isHighGround(t)) continue;
    let zone = rampZone(b, t);
    if (zone !== 'plateau' && reach > 0) {
      const lane = rampLane(t);
      const { u, v } = lane.toLocal(b);
      for (const du of [-reach, reach]) {
        const z = rampZone(lane.toTable(u + du, v), t, 0.05);
        if (ZONE_RANK[z] > ZONE_RANK[zone]) zone = z;
      }
    }
    if (ZONE_RANK[zone] > ZONE_RANK[out.zone]) out = { zone, piece: t };
  }
  return out;
}

/** What one Line of Sight check is traced against: the rectangles that block it, each in its own frame. */
interface LosScene {
  /** A rule that needs no trace already blocks it (the Elevation Dead Zone). */
  blocked: boolean;
  blockers: { local: (p: Pt) => Pt; rect: Rect }[];
}

/**
 * Cover between two models (7.1.1), one terrain piece at a time: which pieces block a trace that passes through
 * them, by Full Cover or by Direct Cover, and whether the Elevation Dead Zone hides the two from each other.
 */
function losScene(a: LosPoint, sizeA: number, b: LosPoint, sizeB: number, pieces: TerrainPiece[], o: LosOptions = {}): LosScene {
  const high = pieces.filter(isHighGround);
  const elevA = high.length ? baseElevation(a, high) : { zone: 'ground' as RampZone, piece: null };
  const elevB = high.length ? baseElevation(b, high) : { zone: 'ground' as RampZone, piece: null };
  // Effective Size (7.1.2): a model on HIGH GROUND adds the Size of what it stands on, one on a ramp (Size 1) adds
  // 1. A Flying model's is higher than any terrain on the table, and terrain never adds to it (7.1.4).
  const raised = (e: Elevation) => (e.zone === 'plateau' ? e.piece!.size : e.zone === 'ramp' ? 1 : 0);
  const effA = o.flyingA ? Infinity : sizeA + raised(elevA);
  const effB = o.flyingB ? Infinity : sizeB + raised(elevB);
  const gap = baseGap(a, b);
  const scene: LosScene = { blocked: false, blockers: [] };
  for (const p of pieces) {
    if (p.size < 1 || p.catalogId.startsWith('token:')) continue;
    const nearA = baseToPiece(a, p), nearB = baseToPiece(b, p);
    // Close Quarters: both Within 1" of this piece and Within 3" of each other.
    const closeQuarters = nearA <= 1 && nearB <= 1 && gap <= 3;
    const covers = (size: number) => (size >= effA && size >= effB) || (!closeQuarters && ((nearA <= 1 && size >= effA) || (nearB <= 1 && size >= effB)));
    if (isHighGround(p)) {
      const onA = elevA.piece === p ? elevA.zone : 'ground', onB = elevB.piece === p ? elevB.zone : 'ground';
      if (onA === 'plateau' || onB === 'plateau') {
        // The surface a model stands on is never between it and its target. Elevation Dead Zone: from HIGH GROUND
        // (Size 3+), a model at GROUND LEVEL Within 1" of the base of the same piece cannot be seen, nor see back.
        const low = onA === 'plateau' ? (onB === 'plateau' ? null : { elev: elevB, near: nearB }) : { elev: elevA, near: nearA };
        if (low && p.size >= 3 && low.elev.zone === 'ground' && low.near <= 1 && !(gap <= 3)) scene.blocked = true;
        continue;
      }
      const parts = rampParts(p);
      // The plateau rises between two models that are not on it; its ramp (Size 1) only between models off the piece.
      if (covers(p.size)) for (const rect of parts.plateau) scene.blockers.push({ local: parts.toLocal, rect });
      if (onA === 'ground' && onB === 'ground' && covers(1)) scene.blockers.push({ local: parts.toLocal, rect: parts.lane });
      continue;
    }
    // Stacking Terrain (7.1.2): a piece set on HIGH GROUND or on a ramp gains the Size of what it stands on.
    const under = high.length ? baseElevation({ x: p.x + p.w / 2, y: p.y + p.h / 2 }, high) : null;
    if (!covers(p.size + (under ? raised(under) : 0))) continue;
    // Each part in its own frame, so a wall set at an angle blocks exactly what it covers, and an L wall only
    // where its arms stand.
    for (const rect of pieceParts(p)) scene.blockers.push({ local: (q) => pieceLocal(q, rect), rect });
  }
  return scene;
}

const traceBlocked = (scene: LosScene, a: Pt, b: Pt): boolean => scene.blocked || scene.blockers.some((k) => segmentHitsRect(k.local(a), k.local(b), k.rect));

/**
 * Official 2D top-down Line of Sight along one trace, from `a` to `b` (7.1). A point that carries its model's base
 * (`r`, and `half` and `a` for an oval) is measured from the base for "Within 1" of the terrain"; a bare point from itself.
 * Full Cover: a piece on the trace with Effective Size >= both models'.
 * Direct Cover: a piece on the trace with Effective Size >= that of a model Within 1" of it (not in Close Quarters).
 * Elevation Dead Zone: HIGH GROUND and the foot of the same piece never see each other (but for Close Quarters).
 */
export function losBlocked(a: Pt, sizeA: number, b: Pt, sizeB: number, pieces: TerrainPiece[], opts?: LosOptions): boolean {
  return traceBlocked(losScene(a, sizeA, b, sizeB, pieces, opts), a, b);
}

/**
 * Line of Sight between two models as the rules draw it (7.1): from any part of one base to any part of the other,
 * seen from above. Each terrain piece a trace passes through is judged on its own for Full Cover and Direct Cover,
 * the 1" of Direct Cover measured from the model's base. True when the two models see each other.
 */
export function losBetweenBases(a: LosBase, sizeA: number, b: LosBase, sizeB: number, pieces: TerrainPiece[], opts?: LosOptions): boolean {
  const scene = losScene(a, sizeA, b, sizeB, pieces, opts);
  if (scene.blocked) return false;
  if (!scene.blockers.length) return true;
  const from = baseEdge(a), to = baseEdge(b);
  // Centre to centre first: the common case, and the cheapest.
  if (!traceBlocked(scene, from[0]!, to[0]!)) return true;
  for (const p of from) for (const q of to) if (!traceBlocked(scene, p, q)) return true;
  return false;
}

/** A Lost Temple Ramp: high ground models stand on, reached up its ramp. */
export const isHighGround = (t: TerrainPiece) => t.catalogId.includes('ramp');
/**
 * Terrain a ground model cannot move through (Part 4.5): pieces of Size 2 and up — walls, and tokens such as a
 * Force Field. Grass is open, high ground has its own rules, and Size 0 and 1 scatter is passed through freely.
 */
export const blocksMovement = (t: TerrainPiece) => !t.grass && !isHighGround(t) && t.size >= 2;

/** Terrain a ground model cannot end its move overlapping: everything of Size 1 and up that is not grass. */
export const blocksStanding = (t: TerrainPiece) => !t.grass && !isHighGround(t) && t.size >= 1;

/**
 * Where a ground model may end up: not overlapping a wall or scatter, and on high ground only by its ramp (its
 * edges are a cliff). A `climber` (Raptor Strain) goes through or over all of it.
 */
export function passable(p: Pt, pieces: TerrainPiece[], climber = false): boolean {
  if (climber) return true;
  for (const t of pieces) {
    if (blocksStanding(t) && distToPiece(p, t) < 0.3) return false;
    if (isHighGround(t) && rampBlocks(p, t, 0.3)) return false;
  }
  return true;
}

/**
 * Shortest ground path length in inches, around Size 2+ terrain (scatter is walked through, never ended on).
 * Returns Infinity if unreachable. Also returns the path points for movement.
 */
/** Movement clearance: how wide the moving base is, and other bases it cannot pass through. */
export interface PathOptions {
  /** Radius of the moving base: it keeps this far from impassable terrain (default 0.3"). */
  clearance?: number;
  /** Bases the mover cannot pass through, already grown by the mover's radius (centre-to-centre limits). */
  circles?: { x: number; y: number; r: number }[];
  /** Raptor Strain: moves through impassable terrain (Size 4 or less) and changes height without the ramp. */
  climber?: boolean;
  /** A mover of Size 3 or more: it moves over Force Fields (which are then removed). */
  crossesForceFields?: boolean;
}

/** A Force Field token, kept among the terrain as the Size 2 obstacle it is to Units of Size 2 or lower. */
export const isForceField = (t: TerrainPiece) => t.catalogId.startsWith('token:');

/** A point test for where the centre of a moving base may be. Obstacles it already touches at either end do not trap it. */
function freeCheck(pieces: TerrainPiece[], from: Pt, to: Pt, o?: PathOptions): (p: Pt) => boolean {
  const cl = o?.clearance ?? 0.3;
  const walls = pieces
    .filter((t) => blocksMovement(t) && !(o?.climber && t.size <= 4) && !(o?.crossesForceFields && isForceField(t)))
    .map((t) => {
      const rect = t;
      const near = Math.min(distToPiece(from, rect), distToPiece(to, rect));
      // Starting or ending tight against a wall: allow that much room there, never less than the thin-line minimum.
      return { rect, allow: near < cl ? Math.max(Math.min(cl, 0.3), near - 0.05) : cl };
    });
  const circles = (o?.circles ?? []).filter((c) => dist(c, from) >= c.r - 0.02 && dist(c, to) >= c.r - 0.02);
  const highs = o?.climber ? [] : pieces.filter(isHighGround);
  return (p: Pt) => {
    for (const w of walls) if (nearPiece(p, w.rect, w.allow)) return false;
    for (const t of highs) if (rampBlocks(p, t, Math.min(cl, 0.6))) return false;
    for (const c of circles) if (dist(p, c) < c.r - 0.02) return false;
    return true;
  };
}

function clearWith(a: Pt, b: Pt, free: (p: Pt) => boolean): boolean {
  const d = dist(a, b);
  const steps = Math.max(1, Math.ceil(d / 0.2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (!free({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
  }
  return true;
}

/**
 * Where a mover can get to on the way toward a goal it cannot reach: the spot within `speed` inches of legal
 * walking that ends nearest the goal. A unit whose target is across a wall walks along the wall toward it, and one
 * with only a narrow way out of a pocket takes it, instead of standing still or stepping through the wall.
 */
export function bestEffortToward(from: Pt, to: Pt, pieces: TerrainPiece[], table: { width: number; height: number }, speed: number, opts?: PathOptions): Pt {
  const coarse = bestEffortOnGrid(from, to, pieces, table, speed, 0.5, opts);
  // Going nowhere on the half-inch lattice may only mean the way out is a squeeze: look again, finer.
  return coarse === from ? bestEffortOnGrid(from, to, pieces, table, speed, 0.25, opts) : coarse;
}

/**
 * How far it is, walking, to every lattice point within `speed` of `from`: Dijkstra over the lattice, stopped at
 * `speed`. `visit` sees each point as it is settled.
 */
function walkField(from: Pt, pieces: TerrainPiece[], table: { width: number; height: number }, speed: number, cell: number, opts: PathOptions | undefined, to: Pt, visit?: (k: number, p: Pt) => void) {
  const free = freeCheck(pieces, from, to, opts);
  const W = Math.ceil(table.width / cell);
  const H = Math.ceil(table.height / cell);
  const key = (x: number, y: number) => y * (W + 1) + x;
  const at = (x: number, y: number) => ({ x: x * cell, y: y * cell });
  const sx = Math.max(0, Math.min(W, Math.round(from.x / cell)));
  const sy = Math.max(0, Math.min(H, Math.round(from.y / cell)));
  const lat = lattice(W, H, cell, free, [key(sx, sy)]);
  const blocked = (k: number) => lat.blocked(k);
  const g = new Float64Array((W + 1) * (H + 1)).fill(Infinity);
  g[key(sx, sy)] = 0;
  const queue = new KeyHeap();
  queue.push(key(sx, sy), 0, lat.order(key(sx, sy)));
  while (queue.size) {
    const pri = queue.topPriority;
    const k = queue.pop();
    // A node reached more cheaply since this entry was queued has already been expanded from its better entry.
    if (pri > g[k]!) continue;
    const x = k % (W + 1);
    const y = Math.floor(k / (W + 1));
    visit?.(k, at(x, y));
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx > W || ny > H) continue;
        const nk = key(nx, ny);
        if (blocked(nk)) continue;
        if (dx && dy && (blocked(key(x + dx, y)) || blocked(key(x, y + dy))) && !clearWith(at(x, y), at(nx, ny), free)) continue;
        const ng = g[k]! + (dx && dy ? Math.SQRT2 : 1) * cell;
        if (ng <= speed + 1e-9 && ng < g[nk]!) {
          g[nk] = ng;
          queue.push(nk, ng, lat.order(nk));
        }
      }
  }
  return { g, W, H, key, at, start: key(sx, sy), free };
}

function bestEffortOnGrid(from: Pt, to: Pt, pieces: TerrainPiece[], table: { width: number; height: number }, speed: number, cell: number, opts?: PathOptions): Pt {
  // The settled node that ends nearest the goal.
  let best = { k: -1, d: dist(from, to) };
  const f = walkField(from, pieces, table, speed, cell, opts, to, (k, p) => { const d = dist(p, to); if (d < best.d - 1e-9) best = { k, d }; });
  return best.k < 0 || best.k === f.start ? from : f.at(best.k % (f.W + 1), Math.floor(best.k / (f.W + 1)));
}

/**
 * The edge of where a mover can get to within `speed` of walking: a ring, pushed in where terrain stands in the
 * way and where going round it uses up the distance. One point per ray, out from `from`, at the farthest spot on
 * that ray reached within `speed`, so ground round the end of a wall still shows.
 */
export function reachOutline(from: Pt, pieces: TerrainPiece[], table: { width: number; height: number }, speed: number, opts?: PathOptions, rays = 180): Pt[] {
  const cell = 0.25;
  const f = walkField(from, pieces, table, speed, cell, opts, from);
  // A spot in a clear straight line is measured exactly; the lattice's walk (which overestimates an angled
  // line) counts for the spots behind something.
  const reached = (p: Pt): boolean => {
    if (p.x < 0 || p.y < 0 || p.x > table.width || p.y > table.height) return false;
    if (f.free(p) && clearWith(from, p, f.free)) return true;
    const x = Math.round(p.x / cell), y = Math.round(p.y / cell);
    return f.g[f.key(x, y)]! <= speed + 1e-9;
  };
  const out: Pt[] = [];
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = 0;
    for (let s = cell; s <= speed + 1e-9; s += cell) if (reached({ x: from.x + dx * s, y: from.y + dy * s })) t = s;
    out.push({ x: from.x + dx * t, y: from.y + dy * t });
  }
  return out;
}

export function shortestPath(from: Pt, to: Pt, pieces: TerrainPiece[], table: { width: number; height: number }, opts?: PathOptions): { length: number; path: Pt[] } {
  const free = opts ? freeCheck(pieces, from, to, opts) : null;
  const clear = (a: Pt, b: Pt) => (free ? clearWith(a, b, free) : segmentClear(a, b, pieces));
  const open = (p: Pt) => (free ? free(p) : passable(p, pieces));
  // A clear straight line is measured exactly (the grid search below overestimates angled moves).
  if (clear(from, to)) return { length: dist(from, to), path: [from, to] };
  // A wide base squeezing between a wall and a rock has no room on a 1" lattice even though the gap is real —
  // a 40mm base needs its 1.6" and not much more — so a failed search is tried again on finer ones before the
  // way is called shut.
  for (const cell of [1, 0.5, 0.25]) {
    const found = gridPath(from, to, open, clear, table, cell);
    if (found) return found;
  }
  return { length: Infinity, path: [] };
}

/** A* between two points on a lattice of the given spacing, pulled taut afterwards. Null when nothing gets through. */
function gridPath(from: Pt, to: Pt, open: (p: Pt) => boolean, clear: (a: Pt, b: Pt) => boolean, table: { width: number; height: number }, cell: number): { length: number; path: Pt[] } | null {
  const W = Math.ceil(table.width / cell);
  const H = Math.ceil(table.height / cell);
  const key = (x: number, y: number) => y * (W + 1) + x;
  const at = (x: number, y: number) => ({ x: x * cell, y: y * cell });
  const sx = Math.max(0, Math.min(W, Math.round(from.x / cell)));
  const sy = Math.max(0, Math.min(H, Math.round(from.y / cell)));
  const tx = Math.max(0, Math.min(W, Math.round(to.x / cell)));
  const ty = Math.max(0, Math.min(H, Math.round(to.y / cell)));
  const lat = lattice(W, H, cell, open, [key(sx, sy), key(tx, ty)]);
  const blocked = (k: number) => lat.blocked(k);
  const g = new Float64Array((W + 1) * (H + 1)).fill(Infinity);
  const prev = new Int32Array((W + 1) * (H + 1)).fill(-1);
  g[key(sx, sy)] = 0;
  const h = (x: number, y: number) => Math.hypot(x - tx, y - ty);
  const queue = new KeyHeap();
  queue.push(key(sx, sy), h(sx, sy), lat.order(key(sx, sy)));
  const closed = new Uint8Array((W + 1) * (H + 1));
  while (queue.size) {
    const k = queue.pop();
    if (closed[k]) continue;
    closed[k] = 1;
    const x = k % (W + 1);
    const y = Math.floor(k / (W + 1));
    if (x === tx && y === ty) break;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx > W || ny > H) continue;
        const nk = key(nx, ny);
        if (closed[nk] || blocked(nk)) continue;
        // A diagonal step past a blocked corner is allowed only when the straight line between the two spots
        // really is clear: that is what lets a base through a gap the lattice's corners would shut.
        if (dx && dy && (blocked(key(x + dx, y)) || blocked(key(x, y + dy))) && !clear(at(x, y), at(nx, ny))) continue;
        const ng = g[k]! + (dx && dy ? Math.SQRT2 : 1) * cell;
        if (ng < g[nk]!) {
          g[nk] = ng;
          prev[nk] = k;
          queue.push(nk, ng + h(nx, ny), lat.order(nk));
        }
      }
  }
  const end = key(tx, ty);
  if (g[end] === Infinity) return null;
  const path: Pt[] = [];
  for (let k = end; k !== -1; k = prev[k]!) path.push(at(k % (W + 1), Math.floor(k / (W + 1))));
  path.reverse();
  // Snap the endpoints to the real points.
  if (path.length) {
    path[0] = from;
    path[path.length - 1] = to;
  }
  // Pull the grid path taut: skip corners while the straight line between points stays clear of terrain.
  const taut: Pt[] = [path[0]!];
  let i = 0;
  while (i < path.length - 1) {
    // Extend while the line stays clear (cheap enough to run on every drag update).
    let j = i + 1;
    while (j + 1 < path.length && clear(path[i]!, path[j + 1]!)) j++;
    taut.push(path[j]!);
    i = j;
  }
  let length = 0;
  for (let k = 1; k < taut.length; k++) length += dist(taut[k - 1]!, taut[k]!);
  return { length, path: taut };
}

/** True when a straight line between two points does not cross Size 2+ terrain (endpoints themselves excepted). */
export function segmentClear(a: Pt, b: Pt, pieces: TerrainPiece[]): boolean {
  const d = dist(a, b);
  const steps = Math.max(1, Math.ceil(d / 0.2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if ((t * d < 0.3 || (1 - t) * d < 0.3) && (!passable(a, pieces) || !passable(b, pieces))) continue;
    if (!passable(p, pieces)) return false;
  }
  return true;
}

/** Point reached after travelling `d` inches along a polyline. */
export function alongPath(path: Pt[], d: number): Pt {
  if (path.length === 0) return { x: 0, y: 0 };
  let left = d;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const seg = dist(a, b);
    if (seg >= left) {
      const t = seg === 0 ? 0 : left / seg;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= seg;
  }
  return path[path.length - 1]!;
}

export const r1 = (v: number): number => Math.round(v * 2) / 2;
export const fmtPt = (p: Pt): string => `(${r1(p.x)}", ${r1(p.y)}")`;
