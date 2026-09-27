import type { Pt } from './types';
import type { Rect, TerrainPiece } from '../types/terrain';
import { dist, distToPiece, distToRect, pieceLocal, rampBlocks, rampLevel } from '../terrain/geometry';

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

/**
 * Official 2D top-down line of sight between two models on ground level.
 * Full Cover: a blocking piece (size >= 1) on the line with size >= both models' sizes.
 * Direct Cover: a piece on the line with size >= the size of a model within 1" of it.
 */
export function losBlocked(a: Pt, sizeA: number, b: Pt, sizeB: number, pieces: TerrainPiece[]): boolean {
  // Effective Size: a model on high ground adds the Size of what it stands on (7.1.2), and the piece under it is
  // never between it and its target: a Marine on the plateau shoots down over its edge.
  const high = pieces.filter(isHighGround);
  const onA = high.find((p) => rampLevel(a, p) > 0), onB = high.find((p) => rampLevel(b, p) > 0);
  if (onA && rampLevel(a, onA) > 0.5) sizeA += onA.size;
  if (onB && rampLevel(b, onB) > 0.5) sizeB += onB.size;
  for (const p of pieces) {
    if (p.size < 1 || p.catalogId.startsWith('token:')) continue;
    if (p === onA || p === onB) continue;
    const r = { x: p.x, y: p.y, w: p.w, h: p.h };
    // Measure in the piece's own frame, so a wall set at an angle blocks exactly what it covers.
    const la = pieceLocal(a, p);
    const lb = pieceLocal(b, p);
    if (!segmentHitsRect(la, lb, r)) continue;
    if (p.size >= sizeA && p.size >= sizeB) return true;
    const closeQuarters = distToRect(la, r) <= 1 && distToRect(lb, r) <= 1 && dist(a, b) <= 3;
    if (closeQuarters) continue;
    if (distToRect(la, r) <= 1 && p.size >= sizeA) return true;
    if (distToRect(lb, r) <= 1 && p.size >= sizeB) return true;
  }
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
}

/** A point test for where the centre of a moving base may be. Obstacles it already touches at either end do not trap it. */
function freeCheck(pieces: TerrainPiece[], from: Pt, to: Pt, o?: PathOptions): (p: Pt) => boolean {
  const cl = o?.clearance ?? 0.3;
  const walls = pieces
    .filter((t) => blocksMovement(t) && !(o?.climber && t.size <= 4))
    .map((t) => {
      const rect = t;
      const near = Math.min(distToPiece(from, rect), distToPiece(to, rect));
      // Starting or ending tight against a wall: allow that much room there, never less than the thin-line minimum.
      return { rect, allow: near < cl ? Math.max(Math.min(cl, 0.3), near - 0.05) : cl };
    });
  const circles = (o?.circles ?? []).filter((c) => dist(c, from) >= c.r - 0.02 && dist(c, to) >= c.r - 0.02);
  const highs = o?.climber ? [] : pieces.filter(isHighGround);
  return (p: Pt) => {
    for (const w of walls) if (distToPiece(p, w.rect) < w.allow) return false;
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

function bestEffortOnGrid(from: Pt, to: Pt, pieces: TerrainPiece[], table: { width: number; height: number }, speed: number, cell: number, opts?: PathOptions): Pt {
  const free = freeCheck(pieces, from, to, opts);
  const W = Math.ceil(table.width / cell);
  const H = Math.ceil(table.height / cell);
  const key = (x: number, y: number) => y * (W + 1) + x;
  const at = (x: number, y: number) => ({ x: x * cell, y: y * cell });
  const sx = Math.max(0, Math.min(W, Math.round(from.x / cell)));
  const sy = Math.max(0, Math.min(H, Math.round(from.y / cell)));
  const blocked = new Uint8Array((W + 1) * (H + 1));
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) if (!free(at(x, y))) blocked[key(x, y)] = 1;
  blocked[key(sx, sy)] = 0;
  // Dijkstra out to `speed`, keeping the node that ends nearest the goal.
  const g = new Float64Array((W + 1) * (H + 1)).fill(Infinity);
  g[key(sx, sy)] = 0;
  const queue: number[] = [key(sx, sy)];
  let best = { k: key(sx, sy), d: dist(from, to) };
  while (queue.length) {
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (g[queue[i]!]! < g[queue[bi]!]!) bi = i;
    const k = queue.splice(bi, 1)[0]!;
    const x = k % (W + 1);
    const y = Math.floor(k / (W + 1));
    const d = dist(at(x, y), to);
    if (d < best.d - 1e-9) best = { k, d };
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx > W || ny > H) continue;
        const nk = key(nx, ny);
        if (blocked[nk]) continue;
        if (dx && dy && (blocked[key(x + dx, y)] || blocked[key(x, y + dy)]) && !clearWith(at(x, y), at(nx, ny), free)) continue;
        const ng = g[k]! + (dx && dy ? Math.SQRT2 : 1) * cell;
        if (ng <= speed + 1e-9 && ng < g[nk]!) {
          g[nk] = ng;
          queue.push(nk);
        }
      }
  }
  return best.k === key(sx, sy) ? from : at(best.k % (W + 1), Math.floor(best.k / (W + 1)));
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
  const blocked = new Uint8Array((W + 1) * (H + 1));
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) if (!open(at(x, y))) blocked[key(x, y)] = 1;
  blocked[key(sx, sy)] = 0;
  blocked[key(tx, ty)] = 0;
  const g = new Float64Array((W + 1) * (H + 1)).fill(Infinity);
  const prev = new Int32Array((W + 1) * (H + 1)).fill(-1);
  const queue: number[] = [key(sx, sy)];
  g[key(sx, sy)] = 0;
  const h = (x: number, y: number) => Math.hypot(x - tx, y - ty);
  const closed = new Uint8Array((W + 1) * (H + 1));
  while (queue.length) {
    let bi = 0;
    let bf = Infinity;
    for (let i = 0; i < queue.length; i++) {
      const k = queue[i]!;
      const f = g[k]! + h(k % (W + 1), Math.floor(k / (W + 1)));
      if (f < bf) {
        bf = f;
        bi = i;
      }
    }
    const k = queue.splice(bi, 1)[0]!;
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
        if (blocked[nk] || closed[nk]) continue;
        // A diagonal step past a blocked corner is allowed only when the straight line between the two spots
        // really is clear: that is what lets a base through a gap the lattice's corners would shut.
        if (dx && dy && (blocked[key(x + dx, y)] || blocked[key(x, y + dy)]) && !clear(at(x, y), at(nx, ny))) continue;
        const ng = g[k]! + (dx && dy ? Math.SQRT2 : 1) * cell;
        if (ng < g[nk]!) {
          g[nk] = ng;
          prev[nk] = k;
          queue.push(nk);
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
