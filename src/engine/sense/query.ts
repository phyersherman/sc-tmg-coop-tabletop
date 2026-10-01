import type { GameState, MarkerControl } from '../types/game';
import type { AiUnitInstance } from '../types/army';
import type { PlayerUnit, Pt } from './types';
import { unitById } from '@data/index';
import { currentSupply } from '../units/supply';
import { dist } from '../terrain/geometry';
import { alongPath, bestEffortToward, losBetweenBases, losBlocked, shortestPath, type PathOptions } from './geometry2d';
import { centroid } from './homography';
import { aiUnitSize, playerUnitFlying, playerUnitSize, playerUnitSupply } from './playerUnits';
import { pathOptionsFor, closestBases, edgeDistance, edgeToPoint, ENGAGEMENT_IN, moveReach, sameElevationAsMarker, shapeAt, unitGap, unitsEngaged, unitShapes } from './placement';
import { MARKER_RADIUS_IN } from '@data/bases';
import { isStructure } from '../director/selectors';
import { aiBurrowed } from '../ai/burrow';
import { contestSupply } from '../abilities/index';

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
/**
 * Your units an AI unit can fire at within `range`: each with how many of the AI's models reach it with Line of
 * Sight. `indirect`: the weapon has INDIRECT FIRE and needs no Line of Sight.
 */
export function visibleEnemies(state: GameState, unit: AiUnitInstance, range: number, groundOnly = false, indirect = false): EnemyView[] {
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
      // A Flying target ignores Full Cover, but the shooter's own Direct Cover still hides it (Part 7.1.4).
      const ok = theirBases.some((t) => edgeDistance(m, t) <= range && (indirect || losBetweenBases(m, aiUnitSize(unit), t, playerUnitSize(pu), state.terrain.pieces, { flyingA: def.tags.includes('Flying'), flyingB: flying })));
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
  return state.playerUnits.filter((pu) => !pu.destroyed && pu.location === 'table' && unitsEngaged(state, 'ai', unit.id, 'players', pu.id));
}

/** Marker control suggestion: supply within 3" with line of sight to the marker. */
/**
 * The AI units holding a marker: on the table and within 3" of it, measured base edge to the marker's edge, the
 * same reach that decides control. A marker with any of these on it is still contested ground.
 */
export function aiHolding(state: GameState, m: Pt & { contestIn?: number }): AiUnitInstance[] {
  return state.army.units.filter((u) => {
    if (u.location !== 'table' || !aiModels(state, u)) return false;
    return unitShapes(state, 'ai', u.id).some((s) => reaches(state, s, aiUnitSize(u), m));
  });
}

/**
 * Who holds a marker from the Supply within 3" of it. A side-marker guard's Supply never counts, but where it
 * stands alone against the players' Units the marker is contested, never theirs: they take it from the guard only
 * with other AI Units there to outnumber, or once the guard is destroyed.
 */
export function markerHolder(ai: number, players: number, guard = false): MarkerControl {
  if (ai === 0 && players === 0) return 'none';
  if (guard && ai === 0) return 'contested';
  return ai > players ? 'ai' : players > ai ? 'players' : 'contested';
}

/** Whether a model contests a Mission Marker from where it stands: Within reach of it, with Line of Sight to it. */
function reaches(state: GameState, s: Parameters<typeof edgeToPoint>[0], size: number, m: Pt & { contestIn?: number }): boolean {
  // Within reach (3", or a campaign objective point's own wider reach), on the marker's own elevation, with Line of
  // Sight to it (the marker has Size 0).
  return edgeToPoint(s, m) - MARKER_RADIUS_IN <= (m.contestIn ?? 3) && sameElevationAsMarker(state, s, m) && !losBlocked(s, size, m, 0, state.terrain.pieces);
}

/**
 * Whether a unit stands within a marker's reach on its elevation (no Line of Sight needed): a campaign objective's
 * "within 8"" for an escort reaching it or the enemies wearing a position down.
 */
export function unitWithinMarker(state: GameState, side: 'ai' | 'players', id: string, m: Pt & { contestIn?: number }): boolean {
  return unitShapes(state, side, id).some((s) => edgeToPoint(s, m) - MARKER_RADIUS_IN <= (m.contestIn ?? 3) && sameElevationAsMarker(state, s, m));
}

/**
 * The AI units that can Contest a marker (Part 8.9.1): on the table, In Coherency, not Flying, not BURROWED, not a
 * Structure, with a model Within 3" of it and Line of Sight to it.
 */
function aiContesting(state: GameState, m: Pt & { contestIn?: number }): AiUnitInstance[] {
  return state.army.units.filter((u) => {
    if (u.location !== 'table' || isStructure(u) || aiBurrowed(u) || u.outOfCoherency || !aiModels(state, u)) return false;
    const def = unitById(u.defId);
    if (def.tags.includes('Flying')) return false;
    return unitShapes(state, 'ai', u.id).some((s) => reaches(state, s, aiUnitSize(u), m));
  });
}

/** Your units that can Contest a marker, by the same conditions. */
function playersContesting(state: GameState, m: Pt & { contestIn?: number }): PlayerUnit[] {
  return state.playerUnits.filter((pu) => {
    // On the battlefield: set there, or seen there by the camera wherever the app thinks it is.
    const present = pu.location === 'table' || !!state.sense?.players[pu.id]?.length;
    if (!present || pu.destroyed || playerUnitFlying(pu) || (pu.statuses ?? []).includes('Burrowed') || pu.outOfCoherency) return false;
    if (contestSupply(state, pu) === null) return false;
    return unitShapes(state, 'players', pu.id).some((s) => reaches(state, s, playerUnitSize(pu), m));
  });
}

export function suggestedMarkerControl(state: GameState): Record<number, MarkerControl> {
  const out: Record<number, MarkerControl> = {};
  for (const m of state.markers) {
    let ai = 0;
    /** A side-marker guard within reach: it adds no Supply, but the players cannot take the marker from it alone. */
    let guard = false;
    let aiThere = false;
    for (const u of aiContesting(state, m)) {
      if (typeof u.special?.sideMarker === 'number') { guard = true; continue; }
      const def = unitById(u.defId);
      aiThere = true;
      // Commander: 1 more Supply for Controlling and Contesting Mission Markers.
      ai += currentSupply(def, u.models) + (def.abilities.some((a) => a.name === 'Commander') ? 1 : 0);
    }
    const yours = playersContesting(state, m);
    const pl = yours.reduce((a, pu) => a + (contestSupply(state, pu) ?? 0), 0);
    // The higher total Controls; a tie is Contested and changes nothing. A side alone at the marker Controls it
    // even at Supply 0, but Supply 0 never wins a contest (Part 8.9.1).
    if (!aiThere && !yours.length) out[m.id] = 'none';
    else if (!yours.length) out[m.id] = 'ai';
    else if (!aiThere) out[m.id] = guard ? 'contested' : 'players';
    else out[m.id] = ai > pl ? 'ai' : pl > ai ? 'players' : 'contested';
  }
  return out;
}

/**
 * Your units holding a marker, one entry per unit within its contest range (the same reckoning as the marker's
 * control): who owns it and its Supply. Flying, Burrowed and Structure units hold nothing.
 */
export function playerUnitsHolding(state: GameState, markerId: number): { unitId: string; owner: number; supply: number }[] {
  const m = state.markers.find((x) => x.id === markerId);
  if (!m) return [];
  return playersContesting(state, m).map((pu) => ({ unitId: pu.id, owner: pu.owner ?? 0, supply: contestSupply(state, pu) ?? 0 }));
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
