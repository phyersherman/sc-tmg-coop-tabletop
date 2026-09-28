import type { GameState, MarkerControl } from '../types/game';
import type { AiUnitInstance } from '../types/army';
import type { PlayerUnit, Pt } from './types';
import { unitById } from '@data/index';
import { currentSupply } from '../units/supply';
import { dist } from '../terrain/geometry';
import { alongPath, bestEffortToward, losBlocked, shortestPath, type PathOptions } from './geometry2d';
import { centroid } from './homography';
import { aiUnitSize, playerUnitFlying, playerUnitSize, playerUnitSupply } from './playerUnits';
import { pathOptionsFor, closestBases, edgeDistance, edgeToPoint, ENGAGEMENT_IN, moveReach, shapeAt, unitGap, unitShapes } from './placement';
import { MARKER_RADIUS_IN } from '@data/bases';
import { isStructure } from '../director/selectors';
import { aiBurrowed } from '../ai/burrow';

export function hasSense(state: GameState): boolean {
  return !!state.sense && state.sense.calibrated;
}

export function aiModels(state: GameState, unit: AiUnitInstance): Pt[] | null {
  const pts = state.sense?.ai[unit.id];
  return pts && pts.length ? pts : null;
}

export function playerModels(state: GameState, pu: PlayerUnit): Pt[] {
  return state.sense?.players[pu.id] ?? [];
}

export function unitCentroid(state: GameState, unit: AiUnitInstance): Pt | null {
  const pts = aiModels(state, unit);
  return pts ? centroid(pts) : null;
}


/** Leading model = the AI model closest to a target point. */
export function leadingModel(pts: Pt[], toward: Pt): Pt {
  return pts.reduce((a, b) => (dist(a, toward) <= dist(b, toward) ? a : b));
}

/**
 * The model of an AI unit with the shortest legal walk to a point: the one to lead it there. A model boxed in by
 * a wall and other units may be nearest as the crow flies and still have the longest way round, or none at all —
 * then another model of the unit leads and the unit re-forms on it. With no way out for any of them, the nearest.
 */
export function leadingModelByPath(state: GameState, unit: AiUnitInstance, toward: Pt): Pt | null {
  const pts = state.sense?.ai[unit.id];
  if (!pts?.length) return null;
  const opts = pathOptionsFor(state, 'ai', unit.id);
  let best: { p: Pt; len: number } | null = null;
  for (const p of pts) {
    const { length } = shortestPath(p, toward, state.terrain.pieces, state.terrain.table, opts);
    if (!best || length < best.len - 1e-9) best = { p, len: length };
  }
  return best && best.len < Infinity ? best.p : leadingModel(pts, toward);
}

export interface EnemyView {
  unit: PlayerUnit;
  models: Pt[];
  /** AI models with at least one target model in range and visible. */
  firing: number;
  nearest: number;
  pathDist: number;
}

/** Player units the given AI unit could shoot: any AI model within `range` of a visible player model. */
export function visibleEnemies(state: GameState, unit: AiUnitInstance, range: number, groundOnly = false): EnemyView[] {
  const mine = aiModels(state, unit);
  if (!mine) return [];
  const def = unitById(unit.defId);
  const out: EnemyView[] = [];
  for (const pu of state.playerUnits) {
    if (pu.destroyed) continue;
    const flying = playerUnitFlying(pu);
    if (groundOnly && flying) continue;
    const theirs = playerModels(state, pu);
    if (!theirs.length) continue;
    let firing = 0;
    const myBases = unitShapes(state, 'ai', unit.id);
    const theirBases = unitShapes(state, 'players', pu.id);
    for (const m of myBases) {
      const ok = theirBases.some((t) => edgeDistance(m, t) <= range && (flying || !losBlocked(m, aiUnitSize(unit), t, playerUnitSize(pu), state.terrain.pieces)));
      if (ok) firing++;
    }
    if (firing === 0) continue;
    if (mine.length === 1) firing = unit.models; // one tag per unit: the whole unit is in range
    const nearest = Math.max(0, closestBases(myBases, theirBases).gap);
    out.push({ unit: pu, models: theirs, firing, nearest, pathDist: nearest });
  }
  return out;
}

/** Nearest player unit by ground path from the AI leading model. */
export function nearestEnemyByPath(state: GameState, unit: AiUnitInstance, groundOnly: boolean): EnemyView | null {
  const mine = aiModels(state, unit);
  if (!mine) return null;
  let best: EnemyView | null = null;
  for (const pu of state.playerUnits) {
    if (pu.destroyed) continue;
    if (groundOnly && playerUnitFlying(pu)) continue;
    const theirs = playerModels(state, pu);
    if (!theirs.length) continue;
    const tc = centroid(theirs);
    const lead = leadingModel(mine, tc);
    const target = theirs.reduce((a, b) => (dist(lead, a) <= dist(lead, b) ? a : b));
    const { length } = shortestPath(lead, target, state.terrain.pieces, state.terrain.table, pathOptionsFor(state, 'ai', unit.id));
    const view: EnemyView = { unit: pu, models: theirs, firing: 0, nearest: dist(lead, target), pathDist: length };
    if (!best || view.pathDist < best.pathDist || (view.pathDist === best.pathDist && pu.models < best.unit.models)) best = view;
  }
  return best;
}

/** Player units with a model within 1" of any model of the AI unit (ground only). */
export function engagedWith(state: GameState, unit: AiUnitInstance): PlayerUnit[] {
  const mine = aiModels(state, unit);
  if (!mine) return [];
  return state.playerUnits.filter((pu) => !pu.destroyed && pu.location === 'table' && !playerUnitFlying(pu) && unitGap(state, 'ai', unit.id, 'players', pu.id) <= ENGAGEMENT_IN + 0.01);
}

/** Marker control suggestion: supply within 3" with line of sight to the marker. */
/**
 * The AI units holding a marker: on the table and within 3" of it, measured base edge to the marker's edge, the
 * same reach that decides control. A marker with any of these on it is still contested ground.
 */
export function aiHolding(state: GameState, m: Pt & { contestIn?: number }): AiUnitInstance[] {
  return state.army.units.filter((u) => {
    if (u.location !== 'table' || !aiModels(state, u)) return false;
    const def = unitById(u.defId);
    return unitShapes(state, 'ai', u.id).some((s) => edgeToPoint(s, m) - MARKER_RADIUS_IN <= (m.contestIn ?? 3) && !losBlocked(s, def.stats.size, m, 0, state.terrain.pieces));
  });
}

export function suggestedMarkerControl(state: GameState): Record<number, MarkerControl> {
  const out: Record<number, MarkerControl> = {};
  for (const m of state.markers) {
    let ai = 0;
    let pl = 0;
    for (const u of state.army.units) {
      // A Structure never controls or contests a marker, not even unopposed.
      // Burrowed units cannot control or contest markers either.
      if (u.location !== 'table' || isStructure(u) || aiBurrowed(u)) continue;
      const pts = aiModels(state, u);
      if (!pts) continue;
      const def = unitById(u.defId);
      // Within 3" of the marker, measured from the base edge to the marker's edge.
      if (unitShapes(state, 'ai', u.id).some((s) => edgeToPoint(s, m) - MARKER_RADIUS_IN <= (m.contestIn ?? 3) && !losBlocked(s, def.stats.size, m, 0, state.terrain.pieces))) {
        ai += currentSupply(def, u.models) + (def.abilities.some((a) => a.name === 'Commander') ? 1 : 0);
        if (currentSupply(def, u.models) === 0) ai += 0.01; // supply 0 still counts when unopposed
      }
    }
    for (const pu of state.playerUnits) {
      // Flying and Burrowed units cannot control or contest markers.
      if (pu.destroyed || playerUnitFlying(pu) || (pu.statuses ?? []).includes('Burrowed')) continue;
      if (unitShapes(state, 'players', pu.id).some((s) => edgeToPoint(s, m) - MARKER_RADIUS_IN <= (m.contestIn ?? 3) && !losBlocked(s, playerUnitSize(pu), m, 0, state.terrain.pieces))) pl += playerUnitSupply(pu) + 0.01;
    }
    out[m.id] = ai === 0 && pl === 0 ? 'none' : ai > pl ? 'ai' : pl > ai ? 'players' : 'contested';
  }
  return out;
}

/**
 * Your units holding a marker, one entry per unit within its contest range (the same reckoning as the marker's
 * control): who owns it and its Supply. Flying and Burrowed units hold nothing.
 */
export function playerUnitsHolding(state: GameState, markerId: number): { unitId: string; owner: number; supply: number }[] {
  const m = state.markers.find((x) => x.id === markerId);
  if (!m) return [];
  return state.playerUnits
    .filter((pu) => pu.location === 'table' && !pu.destroyed && !playerUnitFlying(pu) && !(pu.statuses ?? []).includes('Burrowed'))
    .filter((pu) => unitShapes(state, 'players', pu.id).some((s) => edgeToPoint(s, m) - MARKER_RADIUS_IN <= (m.contestIn ?? 3) && !losBlocked(s, playerUnitSize(pu), m, 0, state.terrain.pieces)))
    .map((pu) => ({ unitId: pu.id, owner: pu.owner ?? 0, supply: playerUnitSupply(pu) }));
}

/** Destination after moving `speed` inches along the shortest path toward `to`. */
/**
 * Where a unit's Leading Model gets to moving `speed` toward `to` along the path round terrain. With `defId` the move
 * is measured as the rules measure it (`moveReach`): the whole base, turned the way it travels, ends within `speed`
 * of the base where it started, so an oval that swings round on a bend stops a little shorter.
 */
export function destinationToward(state: GameState, from: Pt & { a?: number }, to: Pt, speed: number, opts?: PathOptions, defId?: string): { point: Pt; remaining: number } {
  const { length, path } = shortestPath(from, to, state.terrain.pieces, state.terrain.table, opts);
  if (length === Infinity || path.length === 0) {
    // Nowhere legal leads all the way there. The unit still goes as near as its Speed and the ground allow — along
    // a wall, out of a pocket — never through what it cannot walk through, and never standing still if it can help it.
    const point = bestEffortToward(from, to, state.terrain.pieces, state.terrain.table, speed, opts);
    return { point, remaining: dist(point, to) };
  }
  if (defId) {
    // The furthest point along the path whose base still ends within reach, found by halving.
    const start = shapeAt(defId, from);
    const within = (d: number) => moveReach(defId, start, alongPath(path, d), d).reach <= speed + 0.01;
    let hi = Math.min(speed, length);
    if (!within(hi)) {
      let lo = 0;
      for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2; if (within(mid)) lo = mid; else hi = mid; }
      hi = lo;
    }
    return { point: alongPath(path, hi), remaining: Math.max(0, length - hi) };
  }
  let left = speed;
  let cur = path[0]!;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    const seg = dist(a, b);
    if (seg >= left) {
      const t = seg === 0 ? 0 : left / seg;
      cur = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      return { point: cur, remaining: Math.max(0, length - speed) };
    }
    left -= seg;
    cur = b;
  }
  return { point: cur, remaining: 0 };
}
