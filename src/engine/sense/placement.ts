/**
 * Model bases on the battlefield: footprints, edge-to-edge measuring and legal placement.
 * Rules 2.3: bases never overlap and every measurement is taken from bases.
 * Rules 4.4: after any repositioning, models are set Wholly Within 3" of the Leading Model.
 */
import type { BoardToken, GameState } from '../types/game';
import type { TerrainPiece } from '../types/terrain';
import type { Pt, PlayerUnit } from './types';
import type { AiUnitInstance } from '../types/army';
import { unitById } from '@data/index';
import { aiUnitSize, playerUnitSize } from './playerUnits';
import { baseOf } from '@data/bases';
import { distToPiece, nearPiece, pieceLocal, pieceLowerBound, pieceParts, rampBlocks, rampBlocksBase, rampEndDistance, rampParts } from '../terrain/geometry';
import { baseElevation, blocksMovement, blocksStanding, isForceField, isHighGround, segmentHitsRect, type PathOptions } from './geometry2d';

/** A model's base: centre, radius of the round part, half the straight length (ovals), and facing angle (radians). */
export interface Shape {
  x: number;
  y: number;
  r: number;
  half: number;
  a: number;
}

export type Side = 'ai' | 'players';

/** Coherency: every model Wholly Within 3" of the Leading Model (4" with Squadron), measured from the leader's base edge. */
export const COHERENCY_IN = 3;

/** Horizontal Coherency for a unit: Squadron raises it to 4". */
export function coherencyOf(defId: string): number {
  return unitById(defId)?.abilities.some((a) => a.name === 'Squadron') ? 4 : COHERENCY_IN;
}

/**
 * How far a model's base sticks out past the Wholly Within ring: its farthest point, measured from the leader's
 * base edge. Zero or less means the whole base is inside. Both bases can be ovals, so this measures from the base
 * outline rather than from the centre — an oval standing beside the leader is not as far out as its own length.
 */
export function whollyWithinGap(model: Shape, leader: Shape): number {
  const [e1, e2] = segment(model);
  return Math.max(edgeToPoint(leader, e1), edgeToPoint(leader, e2)) + model.r;
}

/**
 * How far a move takes a model, measured as the rules measure it: no part of the base may travel more than the
 * distance allowed (Part 8.5.2), which is to say the moved base must end Wholly Within that distance of the base
 * where it started (Part 4.2), measured from its edge. So the reach is how far the moved base sticks out past the
 * starting base's edge, plus what a path round terrain adds over the straight line. A base that slides straight
 * scores the distance it slid; one that turns scores wherever its ends swing out to.
 *
 * The model faces the way it travels when that stays within `limit`; otherwise it keeps its facing (a tank that
 * cannot turn and still reach slides instead). `pathLength` is the length of the path the base follows.
 */
export function moveReach(defId: string, start: Shape, pt: Pt, pathLength: number, limit = Infinity): { reach: number; facing: number } {
  const straight = Math.hypot(pt.x - start.x, pt.y - start.y);
  const detour = Number.isFinite(pathLength) ? Math.max(0, pathLength - straight) : Infinity;
  const travel = straight > 0.2 ? Math.atan2(pt.y - start.y, pt.x - start.x) : start.a;
  const turned = Math.max(0, whollyWithinGap(shapeAt(defId, { ...pt, a: travel }), start)) + detour;
  if (turned <= limit + 0.05) return { reach: turned, facing: travel };
  const kept = Math.max(0, whollyWithinGap(shapeAt(defId, { ...pt, a: start.a }), start)) + detour;
  return kept < turned ? { reach: kept, facing: start.a } : { reach: turned, facing: travel };
}

/** Engagement Range between bases. */
export const ENGAGEMENT_IN = 1;
/** Bases closer than this count as touching (base-to-base contact). */
export const CONTACT_IN = 0.06;

export function defIdOf(state: GameState, side: Side, id: string): string | null {
  if (side === 'ai') return state.army.units.find((u) => u.id === id)?.defId ?? null;
  return state.playerUnits.find((p) => p.id === id)?.defId ?? null;
}

export function shapeAt(defId: string, p: Pt & { a?: number }): Shape {
  const b = baseOf(unitById(defId)?.id ?? defId);
  return { x: p.x, y: p.y, r: b.r, half: b.half, a: p.a ?? 0 };
}

/** Bases of a unit's models on the table (leading model first). */
export function unitShapes(state: GameState, side: Side, id: string): Shape[] {
  const defId = defIdOf(state, side, id);
  if (!defId) return [];
  const pts = side === 'ai' ? state.sense?.ai[id] ?? (() => { const u = state.army.units.find((x) => x.id === id); return u?.est ? [u.est] : []; })() : state.sense?.players[id] ?? [];
  return pts.map((p) => shapeAt(defId, p));
}

function segment(s: Shape): [Pt, Pt] {
  const dx = Math.cos(s.a) * s.half;
  const dy = Math.sin(s.a) * s.half;
  return [{ x: s.x - dx, y: s.y - dy }, { x: s.x + dx, y: s.y + dy }];
}

function pointSegDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = vx * vx + vy * vy;
  const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len)) : 0;
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

function segSegDist(a1: Pt, a2: Pt, b1: Pt, b2: Pt): number {
  return Math.min(pointSegDist(a1, b1, b2), pointSegDist(a2, b1, b2), pointSegDist(b1, a1, a2), pointSegDist(b2, a1, a2));
}

/** Gap between two bases (negative when they overlap). */
export function edgeDistance(a: Shape, b: Shape): number {
  if (!a.half && !b.half) return Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
  const [a1, a2] = segment(a);
  const [b1, b2] = segment(b);
  return segSegDist(a1, a2, b1, b2) - a.r - b.r;
}

/** Gap between a base and a point (e.g. a marker centre). */
export function edgeToPoint(a: Shape, p: Pt): number {
  const [a1, a2] = segment(a);
  return pointSegDist(p, a1, a2) - a.r;
}

/** Closest gap between any models of two units, and the pair of model centres that gives it. */
export function closestBases(a: Shape[], b: Shape[]): { gap: number; from: Shape | null; to: Shape | null } {
  let gap = Infinity;
  let from: Shape | null = null;
  let to: Shape | null = null;
  for (const p of a) for (const q of b) {
    const d = edgeDistance(p, q);
    if (d < gap) { gap = d; from = p; to = q; }
  }
  return { gap, from, to };
}

export function unitGap(state: GameState, sideA: Side, idA: string, sideB: Side, idB: string): number {
  return closestBases(unitShapes(state, sideA, idA), unitShapes(state, sideB, idB)).gap;
}

/** The nearest points of two bases to each other: one on each base's edge. */
function closestPoints(a: Shape, b: Shape): [Pt, Pt] {
  const [a1, a2] = segment(a);
  const [b1, b2] = segment(b);
  const onSeg = (p: Pt, q1: Pt, q2: Pt): Pt => {
    const vx = q2.x - q1.x, vy = q2.y - q1.y, len = vx * vx + vy * vy;
    const t = len > 0 ? Math.max(0, Math.min(1, ((p.x - q1.x) * vx + (p.y - q1.y) * vy) / len)) : 0;
    return { x: q1.x + vx * t, y: q1.y + vy * t };
  };
  // The nearest pair of points on the two straight parts (a round base's is its centre).
  let best: [Pt, Pt] = [a1, onSeg(a1, b1, b2)];
  const pairs: [Pt, Pt][] = [[a2, onSeg(a2, b1, b2)], [onSeg(b1, a1, a2), b1], [onSeg(b2, a1, a2), b2]];
  for (const p of pairs) if (Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) < Math.hypot(best[0].x - best[1].x, best[0].y - best[1].y)) best = p;
  const [ca, cb] = best;
  const d = Math.hypot(cb.x - ca.x, cb.y - ca.y);
  if (d < 1e-6) return [ca, cb];
  const ux = (cb.x - ca.x) / d, uy = (cb.y - ca.y) / d;
  // Out to each edge, but never past the other base's (overlapping bases meet in the middle).
  const ra = Math.min(a.r, d / 2), rb = Math.min(b.r, d / 2);
  return [{ x: ca.x + ux * ra, y: ca.y + uy * ra }, { x: cb.x - ux * rb, y: cb.y - uy * rb }];
}

/**
 * Whether two models are Engaged where they stand (7.2, 7.2.1): Within Engagement Range (1") of each other, edge
 * to edge, with no Size 2+ terrain between them (a wall, a Force Field, the cliff of a plateau: Grass is stood in
 * and does not part them), and not one on HIGH GROUND with the other at GROUND LEVEL. A model on a ramp (MID
 * GROUND) and one above or below it are Engaged only beside the ACCESS POINT that joins them: both on or Within 1"
 * of that end of the ramp. Combat Tags are the Units' business: see `unitsEngaged`.
 */
export function shapesEngaged(state: GameState, a: Shape, b: Shape, within = ENGAGEMENT_IN): boolean {
  if (edgeDistance(a, b) > within) return false;
  const [pa, pb] = closestPoints(a, b);
  const pieces = state.terrain.pieces;
  const high = pieces.filter(isHighGround);
  // Just inside each footprint, so a base touching a wall it stands beside is not counted as behind it.
  const crosses = (local: (p: Pt) => Pt, r: { x: number; y: number; w: number; h: number }) =>
    r.w > 0.06 && r.h > 0.06 && segmentHitsRect(local(pa), local(pb), { x: r.x + 0.03, y: r.y + 0.03, w: r.w - 0.06, h: r.h - 0.06 });
  for (const t of pieces) {
    if (t.size < 2 || t.grass || isHighGround(t)) continue;
    for (const part of pieceParts(t)) if (crosses((p) => pieceLocal(p, part), part)) return false;
  }
  if (!high.length) return true;
  const ea = baseElevation(a, high), eb = baseElevation(b, high);
  if (ea.zone === eb.zone) {
    // On the ground either side of a corner of high ground: its cliffs stand between them.
    if (ea.zone === 'ground') for (const t of high) { const parts = rampParts(t); if ([...parts.plateau, parts.lane].some((r) => crosses(parts.toLocal, r))) return false; }
    return true;
  }
  if (ea.zone !== 'ramp' && eb.zone !== 'ramp') return false;
  // One on the ramp, the other above or below it: only beside the ACCESS POINT between their two elevations.
  const [onRamp, other, otherAt] = ea.zone === 'ramp' ? [a, b, eb] : [b, a, ea];
  const ramp = (ea.zone === 'ramp' ? ea : eb).piece!;
  if (otherAt.zone === 'plateau' && otherAt.piece !== ramp) return false;
  const end = otherAt.zone === 'plateau' ? 'top' : 'foot';
  return [onRamp, other].every((m) => rampEndDistance(m, ramp, end) - extent(m) <= 1);
}

/**
 * Whether two Units are Engaged where their models stand: Ground models Engage only Ground models (a Flying Unit
 * is never Engaged), and at least one model of each is Engaged with one of the other (see `shapesEngaged`).
 */
export function unitsEngaged(state: GameState, sideA: Side, idA: string, sideB: Side, idB: string): boolean {
  if (unitFlying(state, sideA, idA) || unitFlying(state, sideB, idB)) return false;
  const theirs = unitShapes(state, sideB, idB);
  return unitShapes(state, sideA, idA).some((m) => theirs.some((t) => shapesEngaged(state, m, t)));
}

/**
 * Whether a model of a Unit set at `s` would stand where its move may not end because of this enemy base: a Ground
 * model Within Engagement Range of an enemy Ground model it would be Engaged with; a Flying model less than 1" from
 * an enemy Flying model (8.5.3). A Ground model and a Flying one may end in Base-to-Base contact.
 */
function tooClose(state: GameState, moverFlying: boolean, s: Shape, o: OtherBase): boolean {
  if (moverFlying) return !!o.flying && edgeDistance(s, o.shape) < ENGAGEMENT_IN - 0.001;
  return !o.flying && shapesEngaged(state, s, o.shape);
}

/**
 * Why a Charge cannot end with the Leading Model here (8.7.7 step 3), or null: it would stand Within Engagement
 * Range of an Enemy Unit that was not declared as a target.
 */
export function chargeEndProblem(state: GameState, side: Side, id: string, leaderShape: Shape, targetIds: string[]): string | null {
  const enemySide: Side = side === 'ai' ? 'players' : 'ai';
  for (const o of otherBases(state, side, id)) {
    if (o.side !== enemySide || targetIds.includes(o.id) || o.flying || !shapesEngaged(state, leaderShape, o.shape)) continue;
    const name = enemySide === 'ai' ? state.army.units.find((u) => u.id === o.id)?.label : state.playerUnits.find((p) => p.id === o.id)?.name;
    return `A Charge cannot end Within Engagement Range of ${name ?? 'an Enemy Unit'}: it was not declared as a target.`;
  }
  return null;
}

/** Whether a model and a Mission Marker are on the same elevation (8.9.1): both on a plateau, both on a ramp, or both on the ground. */
export function sameElevationAsMarker(state: GameState, shape: Shape, marker: { x: number; y: number }): boolean {
  const high = state.terrain.pieces.filter(isHighGround);
  if (!high.length) return true;
  return baseElevation(shape, high).zone === baseElevation({ x: marker.x, y: marker.y }, high).zone;
}

/** How far a base reaches from its centre in any direction. */
const extent = (s: Shape) => s.r + s.half;

/** The unit itself, on either side. */
const unitOf = (state: GameState, side: Side, id: string): PlayerUnit | AiUnitInstance | undefined =>
  side === 'ai' ? state.army.units.find((u) => u.id === id) : state.playerUnits.find((p) => p.id === id);

/** A Unit with the Flying Combat Tag. */
export function unitFlying(state: GameState, side: Side, id: string): boolean {
  const defId = defIdOf(state, side, id);
  return !!defId && !!unitById(defId)?.tags.includes('Flying');
}

/** BURROWED: other models may move through the unit's models. */
function unitBurrowed(state: GameState, side: Side, id: string): boolean {
  const u = unitOf(state, side, id);
  return !!u && ((u.statuses ?? []).includes('Burrowed') || (side === 'ai' && !!(u as AiUnitInstance).special?.burrowed));
}

/** The Unit's Size as it stands (Siege Mode counts as 3, BURROWED as 0). */
function unitSizeNow(state: GameState, side: Side, id: string): number {
  const u = unitOf(state, side, id);
  return u ? (side === 'ai' ? aiUnitSize(u as AiUnitInstance) : playerUnitSize(u as PlayerUnit)) : 1;
}

/** How a Unit's base meets terrain and tokens when it is set down. */
interface TerrainFit {
  /** Large: it ends on, and removes, Size 0 and 1 terrain. */
  crusher: boolean;
  /** Half the gap the Unit passes: on a ramp, a base wider than that is measured as if it were that wide. */
  r: number;
  /** Size 3 or more: it moves over a Force Field, which is then removed. */
  big?: boolean;
  /** The unit being set: its own Shade never stands in its way. */
  id?: string;
  /** A model other than the Leading Model: DISPLACEMENT lets only the Leading Model end on a token. */
  follower?: boolean;
}
const terrainFit = (state: GameState, side: Side, id: string, follower = false): TerrainFit => ({
  crusher: crushesTerrain(state, side, id),
  r: passableGapFor(state, side, id) / 2,
  big: unitSizeNow(state, side, id) >= 3,
  id,
  follower,
});

/** A token's base: a Shade stands on its Adept's base, a Creep Tumor and Corrosive Bile on a 25mm one. */
const TOKEN_R = 25 / 25.4 / 2;
export function tokenShape(t: BoardToken): Shape | null {
  if (t.kind === 'shade') return shapeAt('adept', t);
  if (t.kind === 'creepTumor' || t.kind === 'bile') return { x: t.x, y: t.y, r: TOKEN_R, half: 0, a: 0 };
  // A Force Field stands among the terrain; Faction Indicators and drop points are Markers, with no physical presence.
  return null;
}

/** DISPLACEMENT: the Leading Model may end its move overlapping this token (a Shade; a Creep Tumor that STAYS IN PLAY). */
export const tokenDisplaces = (t: BoardToken): boolean => t.kind === 'shade' || (t.kind === 'creepTumor' && !!t.stayInPlay);

/**
 * A base clear of terrain and tokens where it is set. Gap Clearance (4.6) governs moving through a space, never
 * stopping in one: the whole base must fit, clear of every piece it may not end on. Tokens are Size 0 terrain
 * (7.3.1): passed through, never ended on, but for the Leading Model on one with DISPLACEMENT.
 */
function clearOfTerrain(state: GameState, s: Shape, fit: TerrainFit = { crusher: false, r: s.r }): boolean {
  const [p1, p2] = segment(s);
  const pts = s.half ? [p1, { x: s.x, y: s.y }, p2] : [{ x: s.x, y: s.y }];
  const onRamp = Math.min(s.r, fit.r);
  for (const t of state.terrain.pieces) {
    // Large (Siege Tank): it may end on Size 0 or 1 terrain, which is then removed (see `crushTerrain`).
    if (fit.crusher && crushable(t)) continue;
    // Size 3 or more: it moves over a Force Field, which is then removed (see `crossForceFields`).
    if (fit.big && isForceField(t)) continue;
    // A base never sits across the edge of high ground (only on its ramp or wholly on or off it).
    if (isHighGround(t)) {
      if (pts.some((p) => rampBlocksBase(p, t, s.r - 0.02, onRamp - 0.02))) return false;
      continue;
    }
    if (!blocksStanding(t)) continue;
    if (pts.some((p) => nearPiece(p, t, s.r - 0.02))) return false;
  }
  for (const t of state.tokens ?? []) {
    const tok = tokenShape(t);
    if (!tok || (t.ownerId && t.ownerId === fit.id)) continue;
    if (!fit.follower && tokenDisplaces(t)) continue;
    if (edgeDistance(s, tok) < -0.02) return false;
  }
  return true;
}

function onTable(state: GameState, s: Shape): boolean {
  const e = extent(s);
  const t = state.terrain.table;
  return s.x - e >= -0.01 && s.y - e >= -0.01 && s.x + e <= t.width + 0.01 && s.y + e <= t.height + 0.01;
}

/** A base of another unit on the table. */
export interface OtherBase {
  side: Side;
  id: string;
  shape: Shape;
  /** Its unit has the Flying Combat Tag: never Engaged, and Ground models pass through its base (and it through theirs). */
  flying?: boolean;
  /** Its unit is BURROWED: other models may move through it. */
  burrowed?: boolean;
  /** The model has DISPLACEMENT (the Point Defense Drone's Gliding): a Leading Model may end on it, and it is set aside. */
  displaces?: boolean;
}

/** Every base on the table except the given unit's, tagged by side. */
/** A unit whose models have DISPLACEMENT (the Point Defense Drone: "Gliding: This model has DISPLACEMENT"). */
export const hasDisplacement = (defId: string): boolean => !!unitById(defId)?.abilities.some((a) => /\bhas DISPLACEMENT\b/.test(a.text));

export function otherBases(state: GameState, side: Side, id: string): OtherBase[] {
  const out: OtherBase[] = [];
  for (const pu of state.playerUnits) {
    if (pu.location !== 'table' || pu.destroyed || (side === 'players' && pu.id === id)) continue;
    const flying = unitFlying(state, 'players', pu.id), burrowed = unitBurrowed(state, 'players', pu.id), displaces = hasDisplacement(pu.defId);
    for (const s of unitShapes(state, 'players', pu.id)) out.push({ side: 'players', id: pu.id, shape: s, flying, burrowed, displaces });
  }
  for (const u of state.army.units) {
    if (u.location !== 'table' || (side === 'ai' && u.id === id)) continue;
    const flying = unitFlying(state, 'ai', u.id), burrowed = unitBurrowed(state, 'ai', u.id), displaces = hasDisplacement(u.defId);
    for (const s of unitShapes(state, 'ai', u.id)) out.push({ side: 'ai', id: u.id, shape: s, flying, burrowed, displaces });
  }
  return out;
}

/** Whether a single base could stand here: on the table, clear of terrain and not overlapping any other base. */
export function baseFits(state: GameState, side: Side, id: string, s: Shape, extra: Shape[] = [], opts: { /** The Leading Model: it may end on a model with DISPLACEMENT. */ leader?: boolean } = {}): boolean {
  if (!onTable(state, s) || !clearOfTerrain(state, s, terrainFit(state, side, id))) return false;
  for (const o of otherBases(state, side, id)) if (!(opts.leader && o.displaces) && edgeDistance(s, o.shape) < -0.01) return false;
  for (const o of extra) if (edgeDistance(s, o) < -0.01) return false;
  return true;
}

export interface PlaceOptions {
  /** Facing of the unit (radians): oval bases line up with it, and followers trail behind the leader. */
  facing?: number;
  /** Enemy units to set models base-to-base with where possible (charges, Close Ranks). */
  contactWith?: string[];
  /** Models that stay exactly where they are (already in base contact). */
  pinned?: Pt[];
  /** Keep every model more than 1" from enemies (Move, Run, Deploy). */
  avoidEngaging?: boolean;
  /** How many models to set (defaults to the unit's model count). */
  count?: number;
  /** The Leading Model's path here: what it passed through is removed (Grass, a Force Field under a Size 3+ model, small terrain under a Large Unit). */
  path?: Pt[];
  /** Where the Leading Model started: a spot it cannot stand on is given up for the nearest one no further from there. */
  from?: Pt;
}

/** A unit's models as set around its Leading Model (4.4). */
export interface Placement {
  /** The Leading Model first. Shorter than the Unit's model count when models were removed as casualties. */
  points: (Pt & { a?: number })[];
  /** A model was set beyond Coherency of the Leading Model: the Unit is Out of Coherency. */
  outOfCoherency: boolean;
  /** Models with no legal position at all: removed as casualties. */
  casualties: number;
}

/** How far beyond Coherency a model is looked for a legal spot before it is given up as a casualty (inches). */
const SPILL_IN = 9;

/**
 * Set a unit's models around its Leading Model (4.4): leader first, then each of the rest Wholly Within 3" of it
 * with a Coherency Link, no overlapping bases, clear of terrain it may not end on and of the table edge. A model
 * with no such spot is set as close to the Leading Model as it can be, still with a Coherency Link, and the Unit
 * is then Out of Coherency; one with no legal spot at all is removed as a casualty. Deterministic, so undo and
 * replays give the same result. Nothing is stored: see `setUnit`.
 */
export function setModels(state: GameState, side: Side, id: string, leader: Pt, opts: PlaceOptions = {}): Placement {
  const defId = defIdOf(state, side, id);
  if (!defId) return { points: [{ x: leader.x, y: leader.y }], outOfCoherency: false, casualties: 0 };
  const unit = unitOf(state, side, id);
  const count = Math.max(1, opts.count ?? unit?.models ?? 1);
  const facing = opts.facing ?? 0;
  const make = (p: Pt): Shape => ({ ...shapeAt(defId, p), a: facing });
  const others = otherBases(state, side, id);
  const enemySide: Side = side === 'ai' ? 'players' : 'ai';
  const flying = unitFlying(state, side, id);
  const foes = others.filter((o) => o.side === enemySide);
  const declared = (o: OtherBase) => !!opts.contactWith?.includes(o.id);
  const contact = opts.contactWith?.length ? foes.filter(declared).map((o) => o.shape) : [];
  // A Charge or Close Ranks ends Within Engagement Range of its targets only (8.7.7); any other move, of no enemy.
  // A Flying Unit is never Engaged, and always ends at least 1" from enemy Flying Units.
  const keepFrom = contact.length ? foes.filter((o) => !declared(o)) : opts.avoidEngaging || flying ? foes : [];
  const leadFit = terrainFit(state, side, id), modelFit = terrainFit(state, side, id, true);
  // Bases never overlap: a leader asked to stand on another base (or off the table, or on terrain it may not end on)
  // takes the nearest free spot instead.
  const leaderFree = (p: Pt) => {
    const sh = make(p);
    // DISPLACEMENT: the Leading Model may end overlapping such a model, which is then set aside (see `displaceModels`).
    if (!(onTable(state, sh) && clearOfTerrain(state, sh, leadFit) && others.every((o) => o.displaces || edgeDistance(sh, o.shape) >= -0.02))) return false;
    // A move (not a charge) ends clear of Engagement Range for the leader as for every other model.
    return contact.length ? !(flying && foes.some((o) => tooClose(state, flying, sh, o))) : !keepFrom.some((o) => tooClose(state, flying, sh, o));
  };
  if (!leaderFree(leader)) leader = nearestFree(state, leader, leaderFree, opts);
  const lead = make(leader);
  const placed: Shape[] = [lead];
  for (const p of opts.pinned ?? []) {
    if (placed.length >= count) break;
    if (Math.hypot(p.x - lead.x, p.y - lead.y) < 0.01) continue;
    placed.push(make(p));
  }
  const coh = coherencyOf(defId);
  // A Coherency Link: a straight line to a model of this unit already set that does not cross other units' bases,
  // terrain, or a gap the Leading Model could not move through (it may cross enemies the unit is Engaged with).
  // A Flying Unit's Links ignore terrain and other Units' models.
  const fighting = new Set([...(opts.contactWith ?? []), ...(side === 'players' ? (unit as PlayerUnit | undefined)?.engagedWith ?? [] : [])]);
  const blockers = others.filter((o) => !(o.side === enemySide && fighting.has(o.id))).map((o) => o.shape);
  const climber = !!unitById(defId)?.abilities.some((a) => a.name === 'Raptor Strain');
  const walls = state.terrain.pieces.filter((w) => blocksMovement(w) && !(modelFit.big && isForceField(w)) && !(climber && w.size <= 4));
  const cliffs = climber ? [] : state.terrain.pieces.filter(isHighGround);
  const gap = passableGapFor(state, side, id);
  const linkClear = (a: Shape, b: Shape) => {
    if (flying) return true;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d / 0.25));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (blockers.some((o) => edgeToPoint(o, p) < 0)) return false;
      // Through a wall, or between two pieces closer together than the gap the Unit passes (4.6).
      let nearest = Infinity, second = Infinity;
      for (const w of walls) {
        // Only the two nearest pieces matter: one no nearer than the second-nearest so far is not measured.
        if (pieceLowerBound(p, w) >= second) continue;
        const dw = distToPiece(p, w);
        if (dw <= 0) return false;
        if (dw < nearest) { second = nearest; nearest = dw; } else if (dw < second) second = dw;
      }
      if (nearest + second < gap - 0.05) return false;
      // Over the cliff of high ground: models change elevation only by its ramp. (The band is wider than a step
      // of this walk, so no line slips across it between two samples.)
      for (const w of cliffs) if (rampBlocks(p, w, 0.15)) return false;
    }
    return true;
  };
  const legal = (s: Shape, reach: number, links: Shape[]) => {
    if (whollyWithinGap(s, lead) > reach + 0.01) return false;
    if (!onTable(state, s) || !clearOfTerrain(state, s, modelFit)) return false;
    for (const o of others) if (edgeDistance(s, o.shape) < 0.01) return false;
    for (const o of placed) if (edgeDistance(s, o) < 0.01) return false;
    if (keepFrom.some((o) => tooClose(state, flying, s, o))) return false;
    return links.some((m) => linkClear(s, m));
  };
  // Coherency Link to one of the nearest models already set.
  const nearest = (s: Shape) => placed.slice().sort((m1, m2) => Math.hypot(m1.x - s.x, m1.y - s.y) - Math.hypot(m2.x - s.x, m2.y - s.y)).slice(0, 3);
  // Candidate spots: a hex lattice around the leader, rings at every radius that still fits inside coherency, plus
  // rings touching the enemy bases to contact. The extra rings matter in a crowd: a lattice alone leaves gaps that
  // a model could legally stand in, and every spot missed here is a model shoved out of coherency later.
  const step = 2 * lead.r + 0.08;
  const turned = (out: Shape[]) => {
    // Oval bases may be turned: a model set crosswise often fits where one facing the same way as the leader
    // would stick out of coherency.
    if (lead.half) for (const c of out.slice()) out.push({ ...c, a: c.a + Math.PI / 2 });
    return out;
  };
  const candidates = (reach: number): Shape[] => {
    const out: Shape[] = [];
    for (let rad = step * 0.9; rad <= reach + 0.01; rad += step * 0.45) {
      const n = Math.max(8, Math.round((2 * Math.PI * rad) / (step * 0.5)));
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        out.push(make({ x: lead.x + Math.cos(ang) * rad, y: lead.y + Math.sin(ang) * rad }));
      }
    }
    const rows = Math.ceil((reach + lead.r) / (step * 0.866)) + 1;
    for (let j = -rows; j <= rows; j++) {
      const cols = Math.ceil((reach + lead.r) / step) + 1;
      for (let i = -cols; i <= cols; i++) {
        const x = lead.x + (i + (j % 2 ? 0.5 : 0)) * step * (lead.half ? 1 : 1);
        const y = lead.y + j * step * 0.866 * (lead.half ? 1 + lead.half / lead.r : 1);
        out.push(make({ x, y }));
      }
    }
    for (const e of contact) {
      for (let k = 0; k < 24; k++) {
        const ang = (k / 24) * Math.PI * 2;
        const dx = Math.cos(ang);
        const dy = Math.sin(ang);
        // Walk out from the enemy base until just touching.
        let lo = 0;
        let hi = extent(e) + extent(lead) + 0.5;
        for (let it = 0; it < 20; it++) {
          const mid = (lo + hi) / 2;
          if (edgeDistance(make({ x: e.x + dx * mid, y: e.y + dy * mid }), e) < 0.02) lo = mid;
          else hi = mid;
        }
        out.push(make({ x: e.x + dx * hi, y: e.y + dy * hi }));
      }
    }
    return turned(out);
  };
  const back = { x: -Math.cos(facing), y: -Math.sin(facing) };
  // A Unit keeps to the Leading Model's elevation while there is room on it: a model is set on the ramp below a
  // plateau, or above the ground, only when nowhere else is left.
  // (By its centre: a base that only reaches another level from where it stands is not preferred either.)
  const zoneAt = (s: Shape) => baseElevation({ x: s.x, y: s.y }, cliffs).zone;
  const leadZone = cliffs.length ? zoneAt(lead) : 'ground';
  const offLevel = (s: Shape) => (cliffs.length && zoneAt(s) !== leadZone ? 50 : 0);
  const score = (s: Shape) => {
    const toLead = Math.hypot(s.x - lead.x, s.y - lead.y) + offLevel(s);
    if (contact.length) {
      // Priority A: Base-to-Base with a declared target. B: Within its Engagement Range. C: close to the Leading Model.
      const near = contact.reduce((best, e) => (edgeDistance(s, e) < edgeDistance(s, best) ? e : best), contact[0]!);
      const g = edgeDistance(s, near);
      return (g <= CONTACT_IN ? 0 : shapesEngaged(state, s, near) ? 100 + g * 10 : 300) + toLead;
    }
    // Trail slightly behind the leader so the unit reads as moving forward.
    const behind = ((s.x - lead.x) * back.x + (s.y - lead.y) * back.y) / Math.max(0.001, toLead);
    return toLead - behind * 0.3;
  };
  // Coherency first, always.
  if (placed.length < count) {
    const pool = candidates(coh).sort((a, b) => score(a) - score(b));
    for (const c of pool) {
      if (placed.length >= count) break;
      if (legal(c, coh, nearest(c))) placed.push(c);
    }
  }
  // No room Wholly Within Coherency: each model left is set as close as possible to the Leading Model, still with
  // a Coherency Link. The Unit is then Out of Coherency.
  if (placed.length < count) {
    const far: Shape[] = [];
    for (let rad = step * 0.9; rad <= lead.r + lead.half + coh + SPILL_IN; rad += 0.25) {
      const n = Math.max(12, Math.round((2 * Math.PI * rad) / 0.5));
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        far.push(make({ x: lead.x + Math.cos(ang) * rad, y: lead.y + Math.sin(ang) * rad }));
      }
    }
    const pool = turned(far).map((c) => ({ c, out: whollyWithinGap(c, lead) })).sort((a, b) => a.out - b.out);
    for (const { c } of pool) {
      if (placed.length >= count) break;
      if (legal(c, Infinity, placed)) placed.push(c);
    }
  }
  // Nowhere left at all: the models that cannot be set are removed as casualties.
  return {
    points: placed.map((s) => (s.half ? { x: s.x, y: s.y, a: s.a } : { x: s.x, y: s.y })),
    outOfCoherency: placed.some((m, i) => i > 0 && whollyWithinGap(m, lead) > coh + 0.01),
    casualties: count - placed.length,
  };
}

/**
 * The nearest spot to `want` where the Leading Model's base fits (`free`). Back along the path it came by when
 * that is known; otherwise the nearest spot round it that is no further from where it started and not across a
 * wall from `want`; failing both, the nearest free spot of all.
 */
function nearestFree(state: GameState, want: Pt, free: (p: Pt) => boolean, opts: PlaceOptions): Pt {
  const path = opts.path && opts.path.length >= 2 ? opts.path : null;
  if (path) {
    let total = 0;
    for (let i = 1; i < path.length; i++) total += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
    for (let back = 0.1; back < total - 0.05; back += 0.1) {
      let left = total - back, at = path[0]!;
      for (let i = 0; i + 1 < path.length; i++) {
        const a = path[i]!, b = path[i + 1]!;
        const seg = Math.hypot(b.x - a.x, b.y - a.y);
        if (seg >= left) { const t = seg ? left / seg : 0; at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; break; }
        left -= seg;
        at = b;
      }
      if (free(at)) return at;
    }
  }
  const start = opts.from ?? path?.[0];
  const walls = state.terrain.pieces.filter(blocksMovement);
  const sameSide = (p: Pt) => {
    const d = Math.hypot(p.x - want.x, p.y - want.y);
    const steps = Math.max(1, Math.ceil(d / 0.2));
    for (let k = 1; k < steps; k++) {
      const q = { x: want.x + ((p.x - want.x) * k) / steps, y: want.y + ((p.y - want.y) * k) / steps };
      if (walls.some((w) => distToPiece(q, w) <= 0)) return false;
    }
    return true;
  };
  const limit = start ? Math.hypot(want.x - start.x, want.y - start.y) + 0.01 : Infinity;
  const ring = (ok: (p: Pt) => boolean): Pt | null => {
    for (let r = 0.125; r <= 6; r += r < 1 ? 0.125 : 0.25) {
      const n = Math.max(12, Math.ceil(r * 12));
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const p = { x: want.x + Math.cos(ang) * r, y: want.y + Math.sin(ang) * r };
        if (ok(p) && free(p)) return p;
      }
    }
    return null;
  };
  return (start ? ring((p) => Math.hypot(p.x - start.x, p.y - start.y) <= limit && sameSide(p)) : null) ?? ring(() => true) ?? want;
}

/**
 * Set a unit's models around its Leading Model and return where each stands (see `setModels`, which also says
 * whether the Unit is Out of Coherency and how many models had no legal position).
 */
export function placeModels(state: GameState, side: Side, id: string, leader: Pt, opts: PlaceOptions = {}): (Pt & { a?: number })[] {
  return setModels(state, side, id, leader, opts).points;
}

/**
 * Why a Deploy with the Leading Model at `leaderPoint` cannot be made, or null: a Deploy may never end with the
 * Unit Out of Coherency, so every model must have a spot Wholly Within Coherency of the Leading Model there.
 */
export function coherencyProblem(state: GameState, side: Side, id: string, leaderPoint: Pt): string | null {
  const t = state.terrain.table;
  const facing = Math.atan2(t.height / 2 - leaderPoint.y, t.width / 2 - leaderPoint.x);
  const set = setModels(state, side, id, leaderPoint, { avoidEngaging: true, facing });
  if (!set.casualties && !set.outOfCoherency) return null;
  return 'There is no room here to set every model In Coherency with the Leading Model.';
}

/**
 * Check a Unit's Coherency where its models stand, and record it on the unit: Out of Coherency when a model is not
 * Wholly Within Coherency of the Leading Model. For the end of a repositioning action whose positions are stored by
 * the caller (Close Ranks, a model adjusted by hand); casualties never call for it (4.4).
 */
export function refreshCoherency(state: GameState, side: Side, id: string): boolean {
  const unit = unitOf(state, side, id);
  const defId = defIdOf(state, side, id);
  if (!unit || !defId) return false;
  const [lead, ...rest] = unitShapes(state, side, id);
  const out = !!lead && rest.some((m) => whollyWithinGap(m, lead) > coherencyOf(defId) + 0.01);
  unit.outOfCoherency = out;
  return out;
}

/** Keep a unit's stored model positions in step with its model count (casualties removed from the back, returns added). */
export function syncModelPositions(state: GameState, side: Side, id: string): void {
  const snap = state.sense;
  if (!snap) return;
  const store = side === 'ai' ? snap.ai : snap.players;
  const pts = store[id];
  const unit = side === 'ai' ? state.army.units.find((u) => u.id === id) : state.playerUnits.find((p) => p.id === id);
  if (!pts?.length || !unit || unit.location !== 'table') return;
  const want = Math.max(1, unit.models);
  if (pts.length === want) return;
  if (pts.length > want) {
    const lead = pts[0]!;
    const rest = pts.slice(1).sort((a, b) => Math.hypot(a.x - lead.x, a.y - lead.y) - Math.hypot(b.x - lead.x, b.y - lead.y));
    store[id] = [lead, ...rest.slice(0, want - 1)];
    return;
  }
  store[id] = placeModels(state, side, id, pts[0]!, { pinned: pts.slice(1), count: want, facing: (pts[0] as { a?: number }).a });
}

/** What setting a unit down did (see `setUnit`). */
export interface PlaceReport extends Placement {
  /** Labels of the Size 0 and 1 pieces a Large Unit removed. */
  crushed: string[];
  /** Labels of the Grass pieces removed. */
  grass: string[];
  /** Force Fields removed by a model of Size 3 or more. */
  forceFields: number;
}

/**
 * Set a unit down: place its models round the Leading Model, store them as its positions (creating the manual
 * position snapshot if needed) and resolve what the repositioning does. Coherency is checked and recorded on the
 * unit (4.4), models with no legal position are removed as casualties, tokens with DISPLACEMENT are set aside, and
 * the terrain the move removes leaves the game: Grass, a Force Field under a model of Size 3 or more, small terrain
 * under a Large Unit. Each is written to the log and returned.
 */
export function setUnit(state: GameState, side: Side, id: string, leader: Pt, opts: PlaceOptions = {}): PlaceReport {
  const snap = state.sense ?? { at: 0, calibrated: true, ai: {}, players: {}, terrain: {}, unknown: [], manual: true };
  snap.calibrated = true;
  state.sense = snap;
  const prev = (side === 'ai' ? snap.ai[id] : snap.players[id])?.[0];
  const facing = opts.facing ?? (prev && Math.hypot(leader.x - prev.x, leader.y - prev.y) > 0.2 ? Math.atan2(leader.y - prev.y, leader.x - prev.x) : (prev as { a?: number } | undefined)?.a ?? Math.atan2(state.terrain.table.height / 2 - leader.y, state.terrain.table.width / 2 - leader.x));
  // Remove the unit's old bases first so they do not block its own new spots.
  if (side === 'ai') delete snap.ai[id];
  else delete snap.players[id];
  const set = setModels(state, side, id, leader, { ...opts, facing, from: opts.from ?? (prev ? { x: prev.x, y: prev.y } : undefined) });
  const pts = set.points;
  const unit = unitOf(state, side, id);
  if (side === 'ai') {
    snap.ai[id] = pts;
    if (unit) (unit as AiUnitInstance).est = { x: pts[0]!.x, y: pts[0]!.y };
  } else snap.players[id] = pts;
  const name = (side === 'ai' ? (unit as AiUnitInstance | undefined)?.label : (unit as PlayerUnit | undefined)?.name) ?? 'The Unit';
  const say = (text: string) => state.log.push({ round: state.round, phase: state.phase, side, text });
  if (unit) {
    // Coherency is checked at the end of every action that repositions models, and at no other time.
    unit.outOfCoherency = set.outOfCoherency;
    if (set.casualties > 0) {
      unit.models = Math.max(1, unit.models - set.casualties);
      say(`${name}: ${set.casualties} model${set.casualties === 1 ? ' has' : 's have'} no legal position and ${set.casualties === 1 ? 'is' : 'are'} removed as ${set.casualties === 1 ? 'a casualty' : 'casualties'}.`);
    }
    if (set.outOfCoherency) say(`${name} is Out of Coherency.`);
  }
  displaceTokens(state, side, id, pts[0]!);
  displaceModels(state, side, id, pts[0]!);
  const crushed = crushTerrain(state, side, id, opts.path);
  if (crushed.length) say(`${name} crushes ${crushed.join(', ')}: removed from the game.`);
  const grass = trampleGrass(state, side, id, opts.path);
  if (grass.length) say(`${name} moves through ${grass.join(', ')}: removed from the game.`);
  const forceFields = crossForceFields(state, side, id, opts.path);
  if (forceFields) say(`${name} moves over ${forceFields === 1 ? 'a Force Field' : `${forceFields} Force Fields`}: removed.`);
  return { ...set, crushed, grass, forceFields };
}

/** Place a unit's models and store them as its positions (see `setUnit`, which also reports what the move did). */
export function placeUnit(state: GameState, side: Side, id: string, leader: Pt, opts: PlaceOptions = {}): (Pt & { a?: number })[] {
  return setUnit(state, side, id, leader, opts).points;
}

/** The leader position that puts its base just touching the target base, travelling along `path` toward it. */
export function contactPointAlong(path: Pt[], mover: Shape, target: Shape): Pt {
  // Walk the path until the moving base would touch the target base.
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  const at = (d: number): Pt => {
    let left = d;
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (seg >= left) { const t = seg ? left / seg : 0; return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
      left -= seg;
    }
    return path[path.length - 1]!;
  };
  let lo = 0;
  let hi = total;
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    const p = at(mid);
    if (edgeDistance({ ...mover, x: p.x, y: p.y }, target) > 0.02) lo = mid;
    else hi = mid;
  }
  return at(lo);
}

/**
 * Whether one model of your unit may be moved to `pt` to match the table: its base must stay clear of every other
 * base and impassable terrain, Wholly Within 3" of the Leading Model, not start or end in a new engagement, and a
 * model already in base contact with an enemy stays pinned.
 */
export function checkModelAdjust(state: GameState, side: Side, id: string, index: number, pt: Pt, opts: { displace?: boolean } = {}): string | null {
  if (side === 'players') {
    const pu = state.playerUnits.find((p) => p.id === id);
    if (!pu || state.step.kind !== 'PLAYERS_TURN' || state.activeUnitId !== id || !pu.mayAdjust) return 'Adjust coherency while the unit is active, after it has moved or held.';
    if (pu.models <= 1) return 'A single model has no coherency to adjust.';
  }
  // The Leading Model stays where its move ended; only the other models are set around it.
  if (index === 0) return 'The Leading Model stays where it moved; adjust the other models.';
  const shapes = unitShapes(state, side, id);
  const cur = shapes[index];
  const lead = shapes[0];
  if (!cur || !lead) return 'Unknown model.';
  const ctx = adjustContext(state, side, id, shapes);
  if (ctx.enemies.some((e) => edgeDistance(cur, e.shape) <= CONTACT_IN)) return 'This model is in base contact with an enemy and stays pinned.';
  return spotProblem(state, ctx, index, { ...cur, x: pt.x, y: pt.y }, shapes, opts.displace ? 'leader' : 'all');
}

/** What a coherency adjustment is measured against: the enemies, every other base, and who the unit is fighting. */
function adjustContext(state: GameState, side: Side, id: string, shapes: Shape[]) {
  const enemySide: Side = side === 'ai' ? 'players' : 'ai';
  const others = otherBases(state, side, id);
  const enemies = others.filter((o) => o.side === enemySide);
  const defId = defIdOf(state, side, id)!;
  const unit = side === 'ai' ? state.army.units.find((u) => u.id === id) : state.playerUnits.find((p) => p.id === id);
  const flying = unitFlying(state, side, id);
  const engagedBefore = unit?.engaged
    ? new Set(enemies.filter((e) => shapes.some((m) => tooClose(state, flying, m, e))).map((e) => e.id))
    : new Set<string>();
  // Every model it sets is one other than the Leading Model.
  return { others, enemies, coh: coherencyOf(defId), engaged: !!unit?.engaged, engagedBefore, flying, fit: terrainFit(state, side, id, true) };
}

/**
 * Why model `index` cannot stand as `moved`, with its squad-mates where `squad` has them, or null. `own` says which
 * squad-mates it may not overlap: all of them, or only the Leading Model (the others are moved aside).
 */
function spotProblem(state: GameState, ctx: ReturnType<typeof adjustContext>, index: number, moved: Shape, squad: Shape[], own: 'all' | 'leader'): string | null {
  const lead = squad[0]!;
  if (whollyWithinGap(moved, lead) > ctx.coh + 0.01) return `Models must stay Wholly Within ${ctx.coh}" of the Leading Model.`;
  if (!onTable(state, moved)) return 'Stay on the table.';
  if (!clearOfTerrain(state, moved, ctx.fit)) return 'The base would overlap terrain or a token.';
  if (ctx.others.some((o) => edgeDistance(moved, o.shape) < -0.01)) return 'Bases cannot overlap.';
  for (let i = 0; i < squad.length; i++) {
    if (i === index || edgeDistance(moved, squad[i]!) >= -0.01) continue;
    if (i === 0) return own === 'leader' ? 'It cannot push the Leading Model aside.' : 'Bases cannot overlap.';
    if (own === 'all') return 'Bases cannot overlap.';
  }
  // Only a Charge puts a unit into Engagement Range. A unit that is not engaged may not end a model there while
  // it tidies its coherency, and one that is engaged may stay with the enemies it is fighting but not step into
  // the reach of another.
  const newEngage = ctx.enemies.find((e) => !ctx.engagedBefore.has(e.id) && tooClose(state, ctx.flying, moved, e));
  if (newEngage) return ctx.engaged ? 'That would move into Engagement Range of another enemy unit.' : 'That would end within Engagement Range of an enemy: only a Charge may do that.';
  return null;
}

/**
 * A coherency adjustment where the model may be set on a squad-mate's spot: the squad-mates it lands on step
 * aside, first into the spot it left (a swap), otherwise to the nearest spot around them that keeps every rule.
 * Returns every model's new position, or why it cannot be done.
 */
export function adjustModelDisplacing(state: GameState, side: Side, id: string, index: number, pt: Pt): { points: (Pt & { a?: number })[] } | { error: string } {
  const err = checkModelAdjust(state, side, id, index, pt, { displace: true });
  if (err) return { error: err };
  const stored = (side === 'ai' ? state.sense?.ai[id] : state.sense?.players[id]) ?? [];
  const points = stored.map((p) => ({ ...p }));
  const squad = unitShapes(state, side, id);
  const ctx = adjustContext(state, side, id, squad);
  const left = squad[index]!;
  squad[index] = { ...left, x: pt.x, y: pt.y };
  points[index] = { ...points[index]!, x: pt.x, y: pt.y };
  for (let j = 1; j < squad.length; j++) {
    if (j === index || edgeDistance(squad[index]!, squad[j]!) >= -0.01) continue;
    const mate = squad[j]!;
    if (ctx.enemies.some((e) => edgeDistance(mate, e.shape) <= CONTACT_IN)) return { error: 'The model on that spot is in base contact with an enemy and stays pinned.' };
    const fits = (x: number, y: number) => { const c = { ...mate, x, y }; return spotProblem(state, ctx, j, c, squad, 'all') === null ? c : null; };
    let spot = fits(left.x, left.y);
    for (let r = 0.25; !spot && r <= ctx.coh + 2; r += 0.25) {
      const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.3));
      for (let k = 0; k < n && !spot; k++) {
        const a = (k / n) * Math.PI * 2;
        spot = fits(mate.x + Math.cos(a) * r, mate.y + Math.sin(a) * r);
      }
    }
    if (!spot) return { error: 'There is no room to move the model on that spot aside.' };
    squad[j] = spot;
    points[j] = { ...points[j]!, x: spot.x, y: spot.y };
  }
  return { points };
}

/**
 * How a unit's Leading Model may travel: its base keeps clear of impassable terrain, and it cannot pass through the
 * bases of enemy models or of other friendly units (it may pass through its own unit). BURROWED units can be moved
 * through, and a BURROWED unit with Tunneling Claws may move through other units' bases.
 */
/**
 * Gap Clearance (Part 4.6): the gap between terrain pieces a unit's Leading Model passes, whatever its base
 * measures — at least 1" for a unit of Size 2 or lower, at least 3" for Size 3 or larger. A Siege Tank dug in is
 * Size 3. Clearance is for moving through a space, never for stopping in one.
 */
export function passableGapFor(state: GameState, side: Side, id: string): number {
  const unit = side === 'ai' ? state.army.units.find((u) => u.id === id) : state.playerUnits.find((p) => p.id === id);
  const size = unit ? (side === 'ai' ? aiUnitSize(unit as AiUnitInstance) : playerUnitSize(unit as PlayerUnit)) : 1;
  // Large: it cannot pass through gaps narrower than 3", whatever its Size.
  return size >= 3 || crushesTerrain(state, side, id) ? 3 : 1;
}

/** Large (Siege Tank): the Unit ends on, and removes, Size 0 or Size 1 Impassible Terrain. */
export function crushesTerrain(state: GameState, side: Side, id: string): boolean {
  const defId = defIdOf(state, side, id);
  return !!defId && unitById(defId).abilities.some((a) => a.name === 'Large');
}

/** A piece the Large rule removes: Size 0 or 1 Impassible Terrain, not a token, not grass. */
const crushable = (t: TerrainPiece) => blocksStanding(t) && t.size <= 1 && !t.catalogId.startsWith('token:');

/** The terrain a Unit may not end its move on: for a Large Unit, the Size 0 and 1 pieces are not among it; for a Size 3+ Unit, nor is a Force Field. */
export function standingPieces(state: GameState, side: Side, id: string): TerrainPiece[] {
  const crusher = crushesTerrain(state, side, id), big = unitSizeNow(state, side, id) >= 3;
  // A model of Size 3 or more may end on a Force Field, which is then removed.
  return crusher || big ? state.terrain.pieces.filter((t) => !(crusher && crushable(t)) && !(big && isForceField(t))) : state.terrain.pieces;
}

/** Points along a path, a quarter inch apart. */
function walkedPoints(path: Pt[]): Pt[] {
  const walked: Pt[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!, b = path[i + 1]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.25));
    for (let k = 0; k <= steps; k++) walked.push({ x: a.x + (b.x - a.x) * (k / steps), y: a.y + (b.y - a.y) * (k / steps) });
  }
  return walked;
}

/** The pieces a unit's Leading Model passed through along `path`, or any of its models now stands on. */
function piecesUnder(state: GameState, side: Side, id: string, path: Pt[], which: (t: TerrainPiece) => boolean): TerrainPiece[] {
  const models = unitShapes(state, side, id);
  const r = models[0]?.r ?? 0.5;
  const walked = walkedPoints(path);
  const on = (m: Shape, t: TerrainPiece) => { const [p1, p2] = segment(m); return [p1, { x: m.x, y: m.y }, p2].some((p) => distToPiece(p, t) < m.r - 0.02); };
  return state.terrain.pieces.filter((t) => which(t) && (models.some((m) => on(m, t)) || walked.some((p) => distToPiece(p, t) < r - 0.02)));
}

/**
 * Large: every Size 0 or 1 Impassible Terrain piece the Leading Model's path passed through, or any model of the
 * Unit ends on, is removed from the game. Returns the labels of the pieces removed.
 */
export function crushTerrain(state: GameState, side: Side, id: string, path: Pt[] = []): string[] {
  if (!crushesTerrain(state, side, id)) return [];
  const gone = piecesUnder(state, side, id, path, crushable);
  if (!gone.length) return [];
  state.terrain.pieces = state.terrain.pieces.filter((t) => !gone.includes(t));
  return gone.map((t) => t.label);
}

/**
 * GRASS: a Grass piece the Leading Model's path of travel passes through, or any model of the Unit ends on, is
 * removed from the game at once. A Flying Unit passes above it and removes it only by ending on it. Returns the
 * labels of the pieces removed.
 */
export function trampleGrass(state: GameState, side: Side, id: string, path: Pt[] = []): string[] {
  const gone = piecesUnder(state, side, id, unitFlying(state, side, id) ? [] : path, (t) => t.grass);
  if (!gone.length) return [];
  state.terrain.pieces = state.terrain.pieces.filter((t) => !gone.includes(t));
  return gone.map((t) => t.label);
}

/**
 * Force Field: a model of Size 3 or more moves over it, and it is then removed, the terrain piece and its token.
 * Returns how many were removed.
 */
export function crossForceFields(state: GameState, side: Side, id: string, path: Pt[] = []): number {
  if (unitSizeNow(state, side, id) < 3) return 0;
  const gone = piecesUnder(state, side, id, unitFlying(state, side, id) ? [] : path, isForceField);
  if (!gone.length) return 0;
  const ids = gone.map((t) => t.catalogId.slice('token:'.length));
  state.terrain.pieces = state.terrain.pieces.filter((t) => !gone.includes(t));
  state.tokens = (state.tokens ?? []).filter((t) => !ids.includes(t.id));
  return gone.length;
}

export function pathOptionsFor(state: GameState, side: Side, id: string): PathOptions {
  const defId = defIdOf(state, side, id);
  const b = baseOf(defId ? unitById(defId)?.id ?? defId : 'marine');
  // Clear of walls by half the gap its Size passes (a little under, so the search's lattice can land a point in a
  // gap exactly that wide); it still ends its move on open ground, never overlapping a piece.
  const r = passableGapFor(state, side, id) / 2 - 0.1;
  // Flying: the Leading Model moves point-to-point, ignoring all terrain and models between the start and the end.
  const flying = unitFlying(state, side, id);
  if (flying) return { clearance: r, circles: [], climber: true, crossesForceFields: true };
  const mover = side === 'players' ? state.playerUnits.find((p) => p.id === id) : undefined;
  const tunneling = mover && unitBurrowed(state, side, id) && unitById(mover.defId).abilities.some((a) => a.name === 'Tunneling Claws' && (!a.upgradeCost || mover.upgrades.includes(a.id)));
  // Size 3 or more: it moves over a Force Field (which is then removed).
  const crossesForceFields = unitSizeNow(state, side, id) >= 3;
  if (tunneling) return { clearance: r, circles: [], crossesForceFields };
  const def = defId ? unitById(defId) : null;
  const climber = !!def?.abilities.some((a) => a.name === 'Raptor Strain');
  // Other bases are still kept clear by the mover's whole base: two models never overlap. A Ground model passes
  // through a Flying model's base as if it were not there, and through the models of a BURROWED Unit, on either side.
  const own = b.r + b.half * 0.5;
  const circles = otherBases(state, side, id)
    .filter((o) => !o.burrowed && !o.flying)
    .map((o) => ({ x: o.shape.x, y: o.shape.y, r: own + o.shape.r + o.shape.half * 0.5 }));
  return { clearance: r, circles, climber, crossesForceFields };
}

/**
 * Close combat ranks (Rule 8.8): Fighting Rank models are Engaged with an enemy model (of the given units: Within 1",
 * no Size 2+ terrain between, not HIGH GROUND against GROUND LEVEL);
 * Supporting Rank models are in base contact with a friendly Fighting Rank model of the same unit.
 */
export function combatRanks(state: GameState, side: Side, id: string, enemyIds?: string[]): { fighting: number; supporting: number; total: number } {
  const mine = unitShapes(state, side, id);
  const enemySide: Side = side === 'ai' ? 'players' : 'ai';
  // Flying models are never Engaged and take no part in the Combat Phase.
  const foes = unitFlying(state, side, id) ? [] : otherBases(state, side, id).filter((o) => o.side === enemySide && !o.flying && (!enemyIds || enemyIds.includes(o.id))).map((o) => o.shape);
  const fighting = mine.map((m) => foes.some((f) => shapesEngaged(state, m, f, ENGAGEMENT_IN + 0.01)));
  const supporting = mine.map((m, i) => !fighting[i] && mine.some((o, j) => j !== i && fighting[j] && edgeDistance(m, o) <= CONTACT_IN));
  const f = fighting.filter(Boolean).length;
  const s = supporting.filter(Boolean).length;
  return { fighting: f, supporting: s, total: f + s };
}

/** Models of a unit already in base contact with an enemy model: pinned during Close Ranks. */
export function pinnedModels(state: GameState, side: Side, id: string): (Pt & { a?: number })[] {
  const enemySide: Side = side === 'ai' ? 'players' : 'ai';
  const foes = otherBases(state, side, id).filter((o) => o.side === enemySide).map((o) => o.shape);
  const pts = (side === 'ai' ? state.sense?.ai[id] : state.sense?.players[id]) ?? [];
  return pts.filter((p, i) => { const s = unitShapes(state, side, id)[i]; return !!s && foes.some((f) => edgeDistance(s, f) <= CONTACT_IN); });
}

/**
 * Close Ranks: move the Leading Model (unless it is pinned) and set the rest base-to-base with the engaged enemies where
 * possible, keeping pinned models where they are. Returns the new positions without storing them.
 */
export function closeRanksPositions(state: GameState, side: Side, id: string, leader: Pt, engagedIds: string[]): (Pt & { a?: number })[] {
  const pts = (side === 'ai' ? state.sense?.ai[id] : state.sense?.players[id]) ?? [];
  const pinned = pinnedModels(state, side, id);
  const leadPinned = pts[0] && pinned.some((p) => p.x === pts[0]!.x && p.y === pts[0]!.y);
  const defId = defIdOf(state, side, id);
  const overlapsPinned = !!defId && pinned.some((p) => p !== pts[0] && edgeDistance(shapeAt(defId, leader), shapeAt(defId, p)) < -0.01);
  const lead = leadPinned || overlapsPinned ? pts[0]! : leader;
  const snap = state.sense!;
  const store = side === 'ai' ? snap.ai : snap.players;
  const saved = store[id];
  delete store[id];
  try {
    return placeModels(state, side, id, lead, { contactWith: engagedIds, pinned: pinned.filter((p) => p !== pts[0]), facing: (pts[0] as { a?: number } | undefined)?.a });
  } finally {
    if (saved) store[id] = saved;
  }
}

/**
 * DISPLACEMENT (the Adept's Shade; a Creep Tumor that STAYS IN PLAY): a Leading Model may end its move overlapping
 * such a token. The token is then set in Base-to-Base contact with that Leading Model, or as close as possible.
 */
/**
 * DISPLACEMENT on a model (the Point Defense Drone): a Leading Model that ends overlapping it has its controlling
 * player set the model in Base-to-Base contact with the Leading Model, or as close as it can be.
 */
export function displaceModels(state: GameState, side: Side, id: string, leaderPt: Pt): void {
  const defId = defIdOf(state, side, id);
  if (!defId || !state.sense) return;
  const leader = shapeAt(defId, leaderPt);
  const groups: [Side, { id: string; defId: string }[]][] = [['players', state.playerUnits.filter((p) => p.location === 'table' && !p.destroyed)], ['ai', state.army.units.filter((u) => u.location === 'table')]];
  for (const [s, units] of groups) {
    for (const u of units) {
      if ((s === side && u.id === id) || !hasDisplacement(u.defId)) continue;
      const list = s === 'ai' ? state.sense.ai[u.id] : state.sense.players[u.id];
      if (!list) continue;
      list.forEach((p, i) => {
        const me = shapeAt(u.defId, p);
        if (edgeDistance(leader, me) >= -0.01) return;
        const dx = me.x - leader.x, dy = me.y - leader.y;
        const base = Math.hypot(dx, dy) > 0.01 ? Math.atan2(dy, dx) : 0;
        let best: Pt | null = null;
        for (let out = 0.03; out <= 6 && !best; out += 0.25) {
          const ring = leader.r + leader.half + me.r + me.half + out;
          for (let k = 0; k < 24 && !best; k++) {
            const ang = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
            const spot = { x: leader.x + Math.cos(ang) * ring, y: leader.y + Math.sin(ang) * ring };
            if (baseFits(state, s, u.id, { ...me, ...spot }, [leader])) best = spot;
          }
        }
        if (best) list[i] = { ...p, x: best.x, y: best.y };
      });
    }
  }
}

export function displaceTokens(state: GameState, side: Side, id: string, leaderPt: Pt): void {
  const defId = defIdOf(state, side, id);
  if (!defId) return;
  const leader = shapeAt(defId, leaderPt);
  for (const t of state.tokens ?? []) {
    const tok = tokenShape(t);
    if (!tok || !tokenDisplaces(t) || (t.ownerId && t.ownerId === id)) continue;
    if (edgeDistance(leader, tok) >= -0.01) continue;
    const dx = t.x - leader.x;
    const dy = t.y - leader.y;
    const base = Math.hypot(dx, dy) > 0.01 ? Math.atan2(dy, dx) : 0;
    const owner = t.ownerId ?? '';
    // Base-to-Base with the Leading Model where there is room; otherwise as close to it as there is.
    let best: Pt | null = null;
    for (let out = 0.03; out <= 6 && !best; out += 0.25) {
      const ring = leader.r + leader.half + tok.r + out;
      for (let k = 0; k < 24 && !best; k++) {
        const ang = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
        const spot = { x: leader.x + Math.cos(ang) * ring, y: leader.y + Math.sin(ang) * ring };
        if (baseFits(state, 'players', owner, { ...tok, ...spot }, [leader])) best = spot;
      }
    }
    const ring = leader.r + leader.half + tok.r + 0.03;
    const spot = best ?? { x: leader.x + Math.cos(base) * ring, y: leader.y + Math.sin(base) * ring };
    t.x = spot.x;
    t.y = spot.y;
    t.path = undefined;
  }
}
