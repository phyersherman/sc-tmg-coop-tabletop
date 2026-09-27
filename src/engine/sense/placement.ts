/**
 * Model bases on the battlefield: footprints, edge-to-edge measuring and legal placement.
 * Rules 2.3: bases never overlap and every measurement is taken from bases.
 * Rules 4.4: after any repositioning, models are set Wholly Within 3" of the Leading Model.
 */
import type { GameState } from '../types/game';
import type { Pt, PlayerUnit } from './types';
import type { AiUnitInstance } from '../types/army';
import { unitById } from '@data/index';
import { aiUnitSize, playerUnitSize } from './playerUnits';
import { baseOf } from '@data/bases';
import { distToPiece, rampBlocks } from '../terrain/geometry';
import { blocksMovement, blocksStanding, isHighGround, type PathOptions } from './geometry2d';

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

/** How far a base reaches from its centre in any direction. */
const extent = (s: Shape) => s.r + s.half;

function clearOfTerrain(state: GameState, s: Shape): boolean {
  const [p1, p2] = segment(s);
  for (const t of state.terrain.pieces) {
    // A base never sits across the edge of high ground (only on its ramp or wholly on or off it).
    if (isHighGround(t)) {
      if (rampBlocks({ x: s.x, y: s.y }, t, s.r - 0.02) || rampBlocks(p1, t, s.r - 0.02) || rampBlocks(p2, t, s.r - 0.02)) return false;
      continue;
    }
    if (!blocksStanding(t)) continue;
    if (distToPiece(p1, t) < s.r - 0.02 || distToPiece(p2, t) < s.r - 0.02 || distToPiece({ x: s.x, y: s.y }, t) < s.r - 0.02) return false;
  }
  return true;
}

function onTable(state: GameState, s: Shape): boolean {
  const e = extent(s);
  const t = state.terrain.table;
  return s.x - e >= -0.01 && s.y - e >= -0.01 && s.x + e <= t.width + 0.01 && s.y + e <= t.height + 0.01;
}

/** Every base on the table except the given unit's, tagged by side. */
export function otherBases(state: GameState, side: Side, id: string): { side: Side; id: string; shape: Shape }[] {
  const out: { side: Side; id: string; shape: Shape }[] = [];
  for (const pu of state.playerUnits) {
    if (pu.location !== 'table' || pu.destroyed || (side === 'players' && pu.id === id)) continue;
    for (const s of unitShapes(state, 'players', pu.id)) out.push({ side: 'players', id: pu.id, shape: s });
  }
  for (const u of state.army.units) {
    if (u.location !== 'table' || (side === 'ai' && u.id === id)) continue;
    for (const s of unitShapes(state, 'ai', u.id)) out.push({ side: 'ai', id: u.id, shape: s });
  }
  return out;
}

/** Whether a single base could stand here: on the table, clear of terrain and not overlapping any other base. */
export function baseFits(state: GameState, side: Side, id: string, s: Shape, extra: Shape[] = []): boolean {
  if (!onTable(state, s) || !clearOfTerrain(state, s)) return false;
  for (const o of otherBases(state, side, id)) if (edgeDistance(s, o.shape) < -0.01) return false;
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
}

/**
 * Set a unit's models around its Leading Model: leader first, the rest Wholly Within 3" of it, no overlapping bases,
 * clear of impassable terrain and the table edge. Deterministic, so undo and replays give the same result.
 */
export function placeModels(state: GameState, side: Side, id: string, leader: Pt, opts: PlaceOptions = {}): (Pt & { a?: number })[] {
  const defId = defIdOf(state, side, id);
  if (!defId) return [{ x: leader.x, y: leader.y }];
  const unit = side === 'ai' ? state.army.units.find((u) => u.id === id) : state.playerUnits.find((p) => p.id === id);
  const count = Math.max(1, opts.count ?? unit?.models ?? 1);
  const facing = opts.facing ?? 0;
  const make = (p: Pt): Shape => ({ ...shapeAt(defId, p), a: facing });
  const others = otherBases(state, side, id);
  const enemySide: Side = side === 'ai' ? 'players' : 'ai';
  const enemies = others.filter((o) => o.side === enemySide).map((o) => o.shape);
  const contact = opts.contactWith?.length ? others.filter((o) => o.side === enemySide && opts.contactWith!.includes(o.id)).map((o) => o.shape) : [];
  // Bases never overlap: a leader asked to stand on another base (or off the table, or in impassable terrain) takes the
  // nearest free spot instead.
  const leaderFree = (p: Pt) => {
    const sh = make(p);
    if (!(onTable(state, sh) && clearOfTerrain(state, sh) && others.every((o) => edgeDistance(sh, o.shape) >= -0.02))) return false;
    // A move (not a charge) ends clear of Engagement Range for the leader as for every other model.
    return !(opts.avoidEngaging && !contact.length && enemies.some((e) => edgeDistance(sh, e) <= ENGAGEMENT_IN));
  };
  if (!leaderFree(leader)) {
    search: for (let r = 0.25; r <= 6; r += 0.25) {
      const n = Math.ceil(r * 12);
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const p = { x: leader.x + Math.cos(ang) * r, y: leader.y + Math.sin(ang) * r };
        if (leaderFree(p)) { leader = p; break search; }
      }
    }
  }
  const lead = make(leader);
  const placed: Shape[] = [lead];
  for (const p of opts.pinned ?? []) {
    if (placed.length >= count) break;
    if (Math.hypot(p.x - lead.x, p.y - lead.y) < 0.01) continue;
    placed.push(make(p));
  }
  const coh = coherencyOf(defId);
  // A Coherency Link: a straight line to a model of this unit already set that does not cross other units' bases or
  // impassable terrain (it may cross enemies the unit is engaged with).
  const blockers = others.filter((o) => !(o.side === enemySide && contact.length && opts.contactWith!.includes(o.id))).map((o) => o.shape);
  const linkClear = (a: Shape, b: Shape) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d / 0.25));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (blockers.some((o) => edgeToPoint(o, p) < 0)) return false;
      for (const w of state.terrain.pieces) if (blocksMovement(w) && w.size >= 2 && distToPiece(p, w) <= 0) return false;
    }
    return true;
  };
  const legal = (s: Shape, reach: number) => {
    if (whollyWithinGap(s, lead) > reach + 0.01) return false;
    if (!onTable(state, s) || !clearOfTerrain(state, s)) return false;
    for (const o of others) if (edgeDistance(s, o.shape) < 0.01) return false;
    for (const o of placed) if (edgeDistance(s, o) < 0.01) return false;
    if (opts.avoidEngaging && !contact.length) for (const e of enemies) if (edgeDistance(s, e) <= ENGAGEMENT_IN) return false;
    // Coherency Link to one of the nearest models already set.
    const near = placed.slice().sort((m1, m2) => Math.hypot(m1.x - s.x, m1.y - s.y) - Math.hypot(m2.x - s.x, m2.y - s.y)).slice(0, 3);
    return near.some((m) => linkClear(s, m));
  };
  // Candidate spots: a hex lattice around the leader, rings at every radius that still fits inside coherency, plus
  // rings touching the enemy bases to contact. The extra rings matter in a crowd: a lattice alone leaves gaps that
  // a model could legally stand in, and every spot missed here is a model shoved out of coherency later.
  const candidates = (reach: number): Shape[] => {
    const out: Shape[] = [];
    const step = 2 * lead.r + 0.08;
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
    // Oval bases may be turned: a model set crosswise often fits where one facing the same way as the leader
    // would stick out of coherency.
    if (lead.half) for (const c of out.slice()) out.push({ ...c, a: c.a + Math.PI / 2 });
    return out;
  };
  const back = { x: -Math.cos(facing), y: -Math.sin(facing) };
  const score = (s: Shape) => {
    const toLead = Math.hypot(s.x - lead.x, s.y - lead.y);
    if (contact.length) {
      const gap = Math.min(...contact.map((e) => edgeDistance(s, e)));
      return (gap <= CONTACT_IN ? 0 : 100 + gap * 10) + toLead;
    }
    // Trail slightly behind the leader so the unit reads as moving forward.
    const behind = ((s.x - lead.x) * back.x + (s.y - lead.y) * back.y) / Math.max(0.001, toLead);
    return toLead - behind * 0.3;
  };
  // Coherency first, always. Only when the unit genuinely cannot fit does it spill, and then barely — a model set
  // several inches out would break coherency outright, which costs the unit its ability to hold markers.
  for (const reach of [coh, coh + 0.75]) {
    if (placed.length >= count) break;
    const pool = candidates(reach).sort((a, b) => score(a) - score(b));
    for (const c of pool) {
      if (placed.length >= count) break;
      if (legal(c, reach)) placed.push(c);
    }
  }
  // Nowhere left at all: stack the rest on the leader (the table cannot fit them either).
  while (placed.length < count) placed.push(make(leader));
  return placed.map((s) => (s.half ? { x: s.x, y: s.y, a: s.a } : { x: s.x, y: s.y }));
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

/** Place a unit's models and store them as its positions (creating the manual position snapshot if needed). */
export function placeUnit(state: GameState, side: Side, id: string, leader: Pt, opts: PlaceOptions = {}): (Pt & { a?: number })[] {
  const snap = state.sense ?? { at: 0, calibrated: true, ai: {}, players: {}, terrain: {}, unknown: [], manual: true };
  snap.calibrated = true;
  state.sense = snap;
  const prev = (side === 'ai' ? snap.ai[id] : snap.players[id])?.[0];
  const facing = opts.facing ?? (prev && Math.hypot(leader.x - prev.x, leader.y - prev.y) > 0.2 ? Math.atan2(leader.y - prev.y, leader.x - prev.x) : (prev as { a?: number } | undefined)?.a ?? Math.atan2(state.terrain.table.height / 2 - leader.y, state.terrain.table.width / 2 - leader.x));
  // Remove the unit's old bases first so they do not block its own new spots.
  if (side === 'ai') delete snap.ai[id];
  else delete snap.players[id];
  const pts = placeModels(state, side, id, leader, { ...opts, facing });
  if (side === 'ai') {
    snap.ai[id] = pts;
    const u = state.army.units.find((x) => x.id === id);
    if (u) u.est = { x: pts[0]!.x, y: pts[0]!.y };
  } else snap.players[id] = pts;
  displaceTokens(state, side, id, pts[0]!);
  return pts;
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
  const engagedBefore = unit?.engaged
    ? new Set(enemies.filter((e) => shapes.some((m) => edgeDistance(m, e.shape) <= ENGAGEMENT_IN)).map((e) => e.id))
    : new Set<string>();
  return { others, enemies, coh: coherencyOf(defId), engaged: !!unit?.engaged, engagedBefore };
}

/**
 * Why model `index` cannot stand as `moved`, with its squad-mates where `squad` has them, or null. `own` says which
 * squad-mates it may not overlap: all of them, or only the Leading Model (the others are moved aside).
 */
function spotProblem(state: GameState, ctx: ReturnType<typeof adjustContext>, index: number, moved: Shape, squad: Shape[], own: 'all' | 'leader'): string | null {
  const lead = squad[0]!;
  if (whollyWithinGap(moved, lead) > ctx.coh + 0.01) return `Models must stay Wholly Within ${ctx.coh}" of the Leading Model.`;
  if (!onTable(state, moved)) return 'Stay on the table.';
  if (!clearOfTerrain(state, moved)) return 'The base would overlap impassable terrain.';
  if (ctx.others.some((o) => edgeDistance(moved, o.shape) < -0.01)) return 'Bases cannot overlap.';
  for (let i = 0; i < squad.length; i++) {
    if (i === index || edgeDistance(moved, squad[i]!) >= -0.01) continue;
    if (i === 0) return own === 'leader' ? 'It cannot push the Leading Model aside.' : 'Bases cannot overlap.';
    if (own === 'all') return 'Bases cannot overlap.';
  }
  // Only a Charge puts a unit into Engagement Range. A unit that is not engaged may not end a model there while
  // it tidies its coherency, and one that is engaged may stay with the enemies it is fighting but not step into
  // the reach of another.
  const newEngage = ctx.enemies.find((e) => !ctx.engagedBefore.has(e.id) && edgeDistance(moved, e.shape) <= ENGAGEMENT_IN);
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
  return size >= 3 ? 3 : 1;
}

export function pathOptionsFor(state: GameState, side: Side, id: string): PathOptions {
  const defId = defIdOf(state, side, id);
  const b = baseOf(defId ? unitById(defId)?.id ?? defId : 'marine');
  // Clear of walls by half the gap its Size passes (a little under, so the search's lattice can land a point in a
  // gap exactly that wide); it still ends its move on open ground, never overlapping a piece.
  const r = passableGapFor(state, side, id) / 2 - 0.1;
  const mover = side === 'players' ? state.playerUnits.find((p) => p.id === id) : undefined;
  const burrowed = (pu: { statuses?: string[] } | undefined) => !!pu?.statuses?.includes('Burrowed');
  const tunneling = mover && burrowed(mover) && unitById(mover.defId).abilities.some((a) => a.name === 'Tunneling Claws' && (!a.upgradeCost || mover.upgrades.includes(a.id)));
  if (tunneling) return { clearance: r, circles: [] };
  const def = defId ? unitById(defId) : null;
  const climber = !!def?.abilities.some((a) => a.name === 'Raptor Strain');
  // Other bases are still kept clear by the mover's whole base: two models never overlap.
  const own = b.r + b.half * 0.5;
  const circles = otherBases(state, side, id)
    .filter((o) => !(o.side === 'players' && burrowed(state.playerUnits.find((p) => p.id === o.id))))
    .map((o) => ({ x: o.shape.x, y: o.shape.y, r: own + o.shape.r + o.shape.half * 0.5 }));
  return { clearance: r, circles, climber };
}

/**
 * Close combat ranks (Rule 8.8): Fighting Rank models are within 1" of an enemy model (of the given units);
 * Supporting Rank models are in base contact with a friendly Fighting Rank model of the same unit.
 */
export function combatRanks(state: GameState, side: Side, id: string, enemyIds?: string[]): { fighting: number; supporting: number; total: number } {
  const mine = unitShapes(state, side, id);
  const enemySide: Side = side === 'ai' ? 'players' : 'ai';
  const foes = otherBases(state, side, id).filter((o) => o.side === enemySide && (!enemyIds || enemyIds.includes(o.id))).map((o) => o.shape);
  const fighting = mine.map((m) => foes.some((f) => edgeDistance(m, f) <= ENGAGEMENT_IN + 0.01));
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
 * DISPLACEMENT (e.g. the Adept Shade): a Leading Model may end its move on top of such a token. The token is then set
 * in base-to-base contact with that Leading Model, or as close as possible.
 */
export function displaceTokens(state: GameState, side: Side, id: string, leaderPt: Pt): void {
  const defId = defIdOf(state, side, id);
  if (!defId) return;
  const leader = shapeAt(defId, leaderPt);
  for (const t of state.tokens ?? []) {
    if (t.kind !== 'shade' || t.ownerId === id) continue;
    const tok = shapeAt('adept', t);
    if (edgeDistance(leader, tok) >= -0.01) continue;
    const dx = t.x - leader.x;
    const dy = t.y - leader.y;
    const base = Math.hypot(dx, dy) > 0.01 ? Math.atan2(dy, dx) : 0;
    const ring = leader.r + leader.half + tok.r + 0.03;
    const owner = t.ownerId ?? '';
    let best: Pt | null = null;
    for (let k = 0; k < 24 && !best; k++) {
      const ang = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
      const spot = { x: leader.x + Math.cos(ang) * ring, y: leader.y + Math.sin(ang) * ring };
      if (baseFits(state, 'players', owner, shapeAt('adept', spot), [leader])) best = spot;
    }
    const spot = best ?? { x: leader.x + Math.cos(base) * ring, y: leader.y + Math.sin(base) * ring };
    t.x = spot.x;
    t.y = spot.y;
    t.path = undefined;
  }
}
