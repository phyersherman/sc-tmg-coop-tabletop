import type { GameState } from '../types/game';
import type { PlayerUnit, Pt } from '../sense/types';
import type { AiUnitInstance } from '../types/army';
import type { WeaponProfile } from '../types/units';
import type { TerrainPiece } from '../types/terrain';
import { unitById } from '@data/index';
import { closestOnSegment, dist, playerSegments, zoiRect, aiSegments, pointInRect, rampLevel } from '../terrain/geometry';
import { losBlocked, losBetweenBases, passable, shortestPath } from '../sense/geometry2d';
import { CONTACT_IN, pinnedModels, pathOptionsFor, baseFits, standingPieces, closestBases, edgeDistance, edgeToPoint, ENGAGEMENT_IN, moveReach, shapeAt, unitShapes, type Shape } from '../sense/placement';
import { playerUnitDef, playerUnitFlying, playerUnitSize, playerUnitSupply } from '../sense/playerUnits';
import { currentSupply, poolForRound } from '../units/supply';
import { effectiveSpeed, extraEntryPoints, hasAbility, isBurrowed, ownerOf } from '../abilities/index';
import { availableWeapons, maxRange } from '../units/weapons';
import { requisitionSupply } from '../missions/sideMarkers';
import { aiBurrowed } from '../ai/burrow';

export interface RuleCheck {
  ok: boolean;
  reason?: string;
  /** Deploy made through a structure (Warp Conduit / Omega Network). */
  via?: string;
}

const ok: RuleCheck = { ok: true };
const no = (reason: string): RuleCheck => ({ ok: false, reason });

export function playerPos(state: GameState, pu: PlayerUnit): Pt | null {
  const pts = state.sense?.players[pu.id];
  return pts && pts.length ? pts[0]! : null;
}

export function aiPos(state: GameState, u: AiUnitInstance): Pt | null {
  const pts = state.sense?.ai[u.id];
  if (pts && pts.length) return pts[0]!;
  return u.est ?? null;
}

/**
 * A player's Supply Pool this round, with a side marker's Requisition if they earned one. With several players,
 * name the player to count theirs; without a name it is the mission's pool alone.
 */
export function playerPool(state: GameState, owner?: number): number {
  const base = poolForRound(state.playerSupply.start, state.playerSupply.escalation, state.round, state.finalRound);
  const several = (state.config.players ?? 1) > 1;
  if (base === Infinity || (several && owner === undefined)) return base;
  return base + requisitionSupply(state, several ? owner : undefined);
}

/** Supply a player has on the table. With one player, everyone's. */
export function playerSupplyUsed(state: GameState, owner?: number): number {
  return state.playerUnits.filter((p) => p.location === 'table' && (owner === undefined || ownerOf(p) === owner)).reduce((a, p) => a + playerUnitSupply(p), 0);
}

/**
 * Supply a player may still deploy this round. Each player has the mission's whole pool to themselves: two
 * players field twice what one does, and one player's units never crowd the other's out.
 */
export function playerAvailable(state: GameState, owner?: number): number {
  const who = (state.config.players ?? 1) > 1 ? owner : undefined;
  const pool = playerPool(state, who);
  if (pool === Infinity) return Infinity;
  return Math.max(0, pool - playerSupplyUsed(state, who));
}

/** The first AI unit whose base would be within Engagement Range of this unit's Leading Model standing at `pt`. */
function nearEnemy(state: GameState, pu: PlayerUnit, pt: Pt, exclude: string[] = []): AiUnitInstance | null {
  const lead = shapeAt(pu.defId, pt);
  for (const u of state.army.units) {
    if (u.location !== 'table' || exclude.includes(u.id)) continue;
    if (unitShapes(state, 'ai', u.id).some((s) => edgeDistance(lead, s) <= ENGAGEMENT_IN)) return u;
  }
  return null;
}

/** Why the Leading Model's base cannot stand at `pt` (overlapping another base or terrain), or null. */
function baseBlocked(state: GameState, pu: PlayerUnit, pt: Pt, facing = 0): string | null {
  const lead = shapeAt(pu.defId, { ...pt, a: facing });
  if (baseFits(state, 'players', pu.id, lead)) return null;
  return 'The base would overlap another model or impassable terrain.';
}

function insideTable(state: GameState, pt: Pt): boolean {
  const t = state.terrain.table;
  return pt.x >= 0 && pt.y >= 0 && pt.x <= t.width && pt.y <= t.height;
}

/** Deployment from Reserves: within Speed of your entry edge, outside the AI zone, supply permitting. */
export function checkDeploy(state: GameState, pu: PlayerUnit, pt: Pt): RuleCheck {
  if (state.phase !== 'movement') return no('Units deploy in the Movement phase.');
  if (state.step.kind !== 'PLAYERS_TURN') return no('Wait for your activation.');
  if (pu.location !== 'reserves') return no(`${pu.name} is not in Reserves.`);
  if (pu.activated.movement) return no(`${pu.name} already acted this phase.`);
  const def = playerUnitDef(pu);
  const supply = currentSupply(def, pu.models);
  const avail = playerAvailable(state, ownerOf(pu));
  if (supply > avail) return no(`Not enough Supply: needs ${supply}, ${avail === Infinity ? '∞' : avail} available.`);
  if (!insideTable(state, pt)) return no('Place the unit on the table.');
  const t = state.terrain.table;
  const speed = effectiveSpeed(pu);
  let via: string | undefined;
  const d = Math.min(...playerSegments(state.deployment).map((s) => dist(closestOnSegment(s, t, pt), pt)));
  if (d > speed + 0.05) {
    // Other entry points: structures (Pylon, Omega Worm) or any non-player edge (Warp In and similar).
    const conduit = extraEntryPoints(state, pu).find((e) => dist(e.p, pt) <= speed + 1.05);
    const edgeD = Math.min(pt.x, pt.y, t.width - pt.x, t.height - pt.y);
    const farFromEnemies = !state.army.units.some((u) => u.location === 'table' && (() => { const q = aiPos(state, u); return !!q && dist(q, pt) <= 10; })());
    const ambush = hasAbility(pu, 'Burrow Ambush') && d <= 18.05 && !state.army.units.some((u) => u.location === 'table' && (() => { const q = aiPos(state, u); return !!q && dist(q, pt) <= 10; })());
    if (conduit) via = conduit.source;
    else if (ambush) via = 'Burrow Ambush';
    else if (pu.deployAnyEdge && edgeD <= speed + 0.05 && farFromEnemies) via = 'another table edge';
    else return no(`Too far from your entry edge: ${d.toFixed(1)}" (max ${speed}").${extraEntryPoints(state, pu).length ? ' Or deploy within Speed of your Pylon / Omega Worm.' : ''}`);
  }
  if (!via) for (const seg of aiSegments(state.deployment)) if (pointInRect(pt, zoiRect(seg, t))) return no("That is inside the AI's Zone of Influence.");
  if (!passable(pt, standingPieces(state, 'players', pu.id)) && !playerUnitFlying(pu)) return no('Cannot end on terrain (Size 1 and up).');
  const e = nearEnemy(state, pu, pt);
  if (e) return no(`Cannot end within 1" of ${e.label}.`);
  const blocked = baseBlocked(state, pu, pt);
  if (blocked) return no(blocked);
  return via ? { ok: true, via } : ok;
}

/** Move (Movement phase) or Run (Assault phase): path length within Speed, ending clear of enemies. */
export function checkMove(state: GameState, pu: PlayerUnit, pt: Pt, kind: 'move' | 'run' | 'disengage'): RuleCheck {
  if (state.step.kind !== 'PLAYERS_TURN') return no('Wait for your activation.');
  if (pu.location !== 'table') return no(`${pu.name} is not on the table.`);
  const phaseKey = state.phase === 'movement' ? 'movement' : state.phase === 'assault' ? 'assault' : null;
  if (!phaseKey) return no('Units do not move in this phase. In the Combat phase, use Close Ranks.');
  const planted = statusBlocks(pu, kind);
  if (planted) return no(planted);
  if (kind === 'run' && state.phase !== 'assault') return no('Run is an Assault phase action.');
  if ((kind === 'move' || kind === 'disengage') && state.phase !== 'movement') return no('Move is a Movement phase action.');
  if (pu.activated[phaseKey]) return no(`${pu.name} already acted this phase.`);
  if (pu.engaged && kind !== 'disengage') return no(`${pu.name} is Engaged. It can only Disengage, and only in the Movement phase.`);
  if (!pu.engaged && kind === 'disengage') return no(`${pu.name} is not engaged.`);
  const from = playerPos(state, pu);
  if (!from) return no('Position unknown.');
  if (!insideTable(state, pt)) return no('Stay on the table.');
  const speed = effectiveSpeed(pu);
  const flying = playerUnitFlying(pu);
  const m = playerMoveReach(state, pu, pt, speed);
  if (m.length === Infinity) return no('No path there.');
  // No part of the Leading Model's base may move more than Speed (Part 8.5.2): the base ends Wholly Within Speed of
  // where it started, measured from its edge along the path it takes.
  if (m.reach > speed + 0.05) return no(`Too far: ${m.reach.toFixed(1)}" of ${speed}". The whole base must end within ${speed}" of where it started.`);
  if (!passable(pt, standingPieces(state, 'players', pu.id)) && !flying) return no('Cannot end on terrain (Size 1 and up).');
  const e = nearEnemy(state, pu, pt);
  if (e && !flying) return no(`Cannot end within 1" of ${e.label}${kind === 'disengage' ? ' when disengaging' : ''}.`);
  const blocked = baseBlocked(state, pu, pt, m.facing);
  if (blocked && !flying) return no(blocked);
  return ok;
}

/**
 * A move of this unit's Leading Model to `pt`, measured as the rules measure it (see `moveReach`): the path it
 * takes, how far the base reaches from the edge of where it started, and the facing it ends with. `limit` is the
 * distance allowed (Speed, 3" for Close Ranks, a free move's inches), so a tank that cannot turn and still reach
 * slides instead.
 */
export function playerMoveReach(state: GameState, pu: PlayerUnit, pt: Pt, limit: number, straightOnly = false): { reach: number; facing: number; length: number; path: Pt[] } {
  const start = unitShapes(state, 'players', pu.id)[0];
  const from = start ?? playerPos(state, pu);
  if (!from) return { reach: Infinity, facing: 0, length: Infinity, path: [] };
  const flying = playerUnitFlying(pu);
  const sp = flying || straightOnly ? { length: dist(from, pt), path: [from, pt] } : shortestPath(from, pt, state.terrain.pieces, state.terrain.table, pathOptionsFor(state, 'players', pu.id));
  const r = moveReach(pu.defId, start ?? shapeAt(pu.defId, from), pt, sp.length, limit);
  return { ...r, length: sp.length, path: sp.path };
}

export interface TargetOption {
  unit: AiUnitInstance;
  distance: number;
  longRange: boolean;
  visible: boolean;
}

/** AI units this player unit may shoot with `weapon` (range, LoS, target tag, engagement). */
/**
 * How far one of your units is from another unit for an ability's range: base edge to base edge, between the
 * closest models of the two, the way every range in the game is measured. Null when either side's models are not
 * known, and then a range cannot be enforced.
 */
export function abilityGap(state: GameState, pu: PlayerUnit, side: 'ai' | 'players', id: string): number | null {
  const a = unitShapes(state, 'players', pu.id), b = unitShapes(state, side, id);
  return a.length && b.length ? Math.max(0, closestBases(a, b).gap) : null;
}

/** The same, to a spot on the table: from the nearest of the unit's base edges. */
export function abilityGapToPoint(state: GameState, pu: PlayerUnit, p: Pt): number | null {
  const a = unitShapes(state, 'players', pu.id);
  return a.length ? Math.max(0, Math.min(...a.map((s) => edgeToPoint(s, p)))) : null;
}

/** How many of a unit's models are within `inches` of another unit, base edge to base edge. */
export function modelsWithin(state: GameState, unitId: string, ofId: string, inches: number): number {
  const mine = unitShapes(state, 'players', unitId);
  const theirs = unitShapes(state, 'players', ofId);
  if (!mine.length || !theirs.length) return 0;
  return mine.filter((s) => theirs.some((t) => edgeDistance(s, t) <= inches + 0.05)).length;
}

/** A Reaction offered to reduce Damage: who has it, and by how much it reduces. */
export interface DamageHelper { key: string; unitId: string; unit: string; name: string; reduce: number; cost: string }

/**
 * Friendly Reactions that can reduce Damage a unit of yours is suffering: Life Support and Transfusion, from
 * another Friendly unit within 4" of it. Offered for every Damage it suffers, an enemy attack or its own
 * Stimpack alike — the rules say "suffers Damage", not "is hit".
 */
export function damageHelpers(state: GameState, pu: PlayerUnit): DamageHelper[] {
  if (!unitById(pu.defId).tags.includes('Biological')) return [];
  return state.playerUnits.flatMap((ru): DamageHelper[] => {
    if (ru.id === pu.id || ru.location !== 'table' || ru.destroyed) return [];
    const gap = abilityGap(state, ru, 'players', pu.id);
    if (gap === null || gap > 4.05) return [];
    return unitById(ru.defId).abilities.filter((ab) => (ab.name === 'Life Support' || ab.name === 'Transfusion') && !(ru.used ?? []).includes(ab.name)).map((ab) => ({
      key: `${ru.id}:${ab.name}`,
      unitId: ru.id,
      unit: ru.name,
      name: ab.name,
      // Life Support reduces the damage by one for each of its own models within 4" of the damaged unit.
      reduce: ab.name === 'Transfusion' ? 2 : Math.max(1, modelsWithin(state, ru.id, pu.id, 4)),
      cost: ab.cost ? `${ab.cost.amount} ${ab.cost.resource}` : '',
    }));
  });
}

/**
 * Why an AI unit rolls Evade against your attack (Part 8.7.4), or null: it is Engaged and the attack is a Ranged
 * Attack; it is BURROWED (every attack); or every model of it stands on HIGH GROUND and at least one of the
 * attacking models does not — that last one only when the map knows where both units stand.
 */
export function aiEvadeReason(state: GameState, target: AiUnitInstance, phase: 'Assault' | 'Combat', attacker?: PlayerUnit): string | null {
  if (!unitById(target.defId).stats.evade) return null;
  if (aiBurrowed(target)) return 'Burrowed';
  if (phase !== 'Assault') return null;
  if (target.engaged) return 'engaged target';
  const high = state.terrain.pieces.filter((t) => t.catalogId.includes('ramp'));
  const mine = state.sense?.ai[target.id] ?? [];
  const onHigh = (p: Pt) => high.some((t) => rampLevel(p, t) > 0.5);
  if (attacker && mine.length && mine.every(onHigh)) {
    const theirs = state.sense?.players[attacker.id] ?? [];
    if (theirs.length && !playerUnitFlying(attacker) && theirs.some((p) => !onHigh(p))) return 'high ground';
  }
  return null;
}

export function validTargets(state: GameState, pu: PlayerUnit, weapon: WeaponProfile): TargetOption[] {
  const from = playerPos(state, pu);
  if (!from) return [];
  const def = playerUnitDef(pu);
  const out: TargetOption[] = [];
  const pinpoint = weapon.keywords.some((k) => k.k === 'PINPOINT');
  for (const u of state.army.units) {
    if (u.location !== 'table') continue;
    const p = aiPos(state, u);
    if (!p) continue;
    const tdef = unitById(u.defId);
    const flying = tdef.tags.includes('Flying');
    if (weapon.target === 'Ground' && flying) continue;
    if (weapon.target === 'Flying' && !flying) continue;
    // Measured edge to edge between the closest bases of the two units.
    const near = closestBases(unitShapes(state, 'players', pu.id), unitShapes(state, 'ai', u.id));
    const d = Math.max(0, near.gap);
    // Point Blank: while in SIEGE MODE the gun cannot depress onto what it is fighting.
    if (hasAbility(pu, 'Point Blank') && (pu.statuses ?? []).includes('Siege Mode') && pu.engagedWith.includes(u.id)) continue;
    if (weapon.range === 'E') {
      if (!pu.engagedWith.includes(u.id)) continue;
      out.push({ unit: u, distance: d, longRange: false, visible: true });
      continue;
    }
    // A BURROWED unit is HIDDEN: it can be targeted only from within 4".
    if (aiBurrowed(u) && d > 4) continue;
    if (pu.engaged && !pu.engagedWith.includes(u.id)) continue;
    if (!pu.engaged && u.engaged && !pinpoint) continue;
    const r = weapon.range;
    const lr = maxRange(weapon);
    if (d > lr) continue;
    const visible = flying || unitSees(state, pu, u) || weapon.keywords.some((k) => k.k === 'INDIRECT FIRE');
    if (!visible) continue;
    out.push({ unit: u, distance: d, longRange: d > r, visible });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * Whether any model of the player's Unit has Line of Sight to any model of the AI Unit: drawn from any point of a
 * base's edge to any point of the target's, over terrain smaller than either of them.
 */
export function unitSees(state: GameState, pu: PlayerUnit, u: AiUnitInstance, pieces: TerrainPiece[] = state.terrain.pieces): boolean {
  const mine = unitShapes(state, 'players', pu.id);
  const theirs = unitShapes(state, 'ai', u.id);
  const sizeA = playerUnitSize(pu), sizeB = unitById(u.defId).stats.size;
  if (!mine.length || !theirs.length) return true;
  // Nearest pair first: it is the likeliest to see, and the search stops at the first that does.
  const near = closestBases(mine, theirs);
  if (near.from && near.to && losBetweenBases(near.from, sizeA, near.to, sizeB, pieces)) return true;
  return mine.some((m) => theirs.some((t) => losBetweenBases(m, sizeA, t, sizeB, pieces)));
}

/** Every AI unit on the table with whether this weapon can target it, and why not. */
export function targetReport(state: GameState, pu: PlayerUnit, weapon: WeaponProfile): { unit: AiUnitInstance; ok: boolean; reason?: string; distance: number | null }[] {
  const from = playerPos(state, pu);
  const legal = new Set(validTargets(state, pu, weapon).map((t) => t.unit.id));
  const def = playerUnitDef(pu);
  return state.army.units.filter((u) => u.location === 'table').map((u) => {
    const p = aiPos(state, u);
    const near = closestBases(unitShapes(state, 'players', pu.id), unitShapes(state, 'ai', u.id));
    const d = from && p ? Math.max(0, near.gap) : null;
    if (legal.has(u.id)) return { unit: u, ok: true, distance: d };
    const tdef = unitById(u.defId);
    const flying = tdef.tags.includes('Flying');
    let reason = 'Not a legal target';
    if (!from || !p) reason = 'Position unknown';
    else if (weapon.target === 'Ground' && flying) reason = `${weapon.name} cannot target Flying units`;
    else if (weapon.target === 'Flying' && !flying) reason = `${weapon.name} only targets Flying units`;
    else if (weapon.range === 'E') reason = 'Not engaged with it';
    else if (pu.engaged && !pu.engagedWith.includes(u.id)) reason = `${pu.name} is Engaged. It can only shoot units it is fighting`;
    else if (!pu.engaged && u.engaged && !weapon.keywords.some((k) => k.k === 'PINPOINT')) reason = `${u.label} is Engaged. Only a PINPOINT weapon can target it`;
    else if (d !== null && d > maxRange(weapon)) reason = `Out of range: ${d.toFixed(1)}" (range ${maxRange(weapon)}")`;
    else if (!flying && !unitSees(state, pu, u)) {
      const blocker = state.terrain.pieces.find((t) => t.size >= 1 && !t.catalogId.startsWith('token:') && !unitSees(state, pu, u, [t]));
      reason = `No Line of Sight${blocker ? ` (${blocker.label ?? 'terrain'} #${blocker.n})` : ''}`;
    }
    return { unit: u, ok: false, reason, distance: d };
  });
}

/**
 * Why a unit cannot use this weapon now for having acted, or null if it can. One weapon per model (Part 8.7.3),
 * except SIDEARM: in the same activation as its other attack, a unit may use each SIDEARM once, in its own
 * Batch, at the same or another target; and a SIDEARM used first still leaves its main weapon.
 */
export function weaponSpent(state: GameState, pu: PlayerUnit, weapon: WeaponProfile): string | null {
  const key = state.phase === 'assault' ? 'assault' : 'combat';
  if (!pu.activated[key]) return null;
  const fired = pu.firedThisActivation ?? [];
  if (state.activeUnitId !== pu.id || !fired.length) return `${pu.name} already acted this phase.`;
  if (fired.includes(weapon.id)) return `${pu.name} already used ${weapon.name} this activation.`;
  const isSidearm = (w: WeaponProfile | undefined) => !!w?.keywords.some((k) => k.k === 'SIDEARM');
  const mainUsed = fired.some((id) => !isSidearm(playerUnitDef(pu).weapons.find((w) => w.id === id)));
  if (!isSidearm(weapon) && mainUsed) return `${pu.name} already attacked with its main weapon. Only a SIDEARM can still fire.`;
  return null;
}

export function checkAttack(state: GameState, pu: PlayerUnit, weapon: WeaponProfile, target: AiUnitInstance): RuleCheck {
  if (state.step.kind !== 'PLAYERS_TURN') return no('Wait for your activation.');
  if (pu.location !== 'table') return no(`${pu.name} is not on the table.`);
  if (weapon.phase === 'Assault' && state.phase !== 'assault') return no('Ranged Attacks happen in the Assault phase.');
  if (weapon.phase === 'Combat' && state.phase !== 'combat') return no('Close combat happens in the Combat phase.');
  const spent = weaponSpent(state, pu, weapon);
  if (spent) return no(spent);
  if (pu.disengagedThisRound && state.phase === 'assault') return no(`${pu.name} disengaged this round and cannot attack.`);
  if (isBurrowed(pu)) return no(`${pu.name} is Burrowed. It can only Move, Run, Disengage, Hold or Close Ranks. Unburrow first.`);
  if (!validTargets(state, pu, weapon).some((t) => t.unit.id === target.id)) return no(targetReport(state, pu, weapon).find((r) => r.unit.id === target.id)?.reason ?? `${target.label} is not a legal target for ${weapon.name}.`);
  return ok;
}

export interface ChargeOption {
  unit: AiUnitInstance;
  /** Path length from the Leading Model to the nearest target model (centres). */
  pathDist: number;
  /** Charge distance needed: the gap between bases along that path, less Engagement Range. */
  needed: number;
  /** The target model the Leading Model charges into. */
  targetModel: Shape;
}

/** AI Ground units within the maximum charge reach by path. */
export function chargeOptions(state: GameState, pu: PlayerUnit): ChargeOption[] {
  const from = playerPos(state, pu);
  if (!from) return [];
  const speed = effectiveSpeed(pu);
  const out: ChargeOption[] = [];
  for (const u of state.army.units) {
    if (u.location !== 'table') continue;
    const p = aiPos(state, u);
    if (!p) continue;
    if (unitById(u.defId).tags.includes('Flying')) continue;
    const lead = unitShapes(state, 'players', pu.id)[0];
    const models = unitShapes(state, 'ai', u.id);
    if (!lead || !models.length) continue;
    const tm = models.reduce((a, b) => (edgeDistance(lead, a) <= edgeDistance(lead, b) ? a : b));
    const { length } = shortestPath(from, tm, state.terrain.pieces, state.terrain.table, pathOptionsFor(state, 'players', pu.id));
    if (length === Infinity) continue;
    const needed = Math.max(0, edgeDistance(lead, tm) + (length - Math.hypot(tm.x - from.x, tm.y - from.y)) - ENGAGEMENT_IN);
    if (needed <= speed + 6) out.push({ unit: u, pathDist: length, needed, targetModel: tm });
  }
  return out.sort((a, b) => a.needed - b.needed);
}

/** Close Ranks (Rule 8.8): an engaged unit, before it attacks, may move its Leading Model up to 3" toward the fight. */
export function checkCloseRanks(state: GameState, pu: PlayerUnit, pt: Pt): RuleCheck {
  if (state.step.kind !== 'PLAYERS_TURN') return no('Wait for your activation.');
  if (state.phase !== 'combat') return no('Close Ranks happens in the Combat phase.');
  if (pu.location !== 'table' || !pu.engaged) return no(`${pu.name} is not engaged.`);
  const stuck = statusBlocks(pu, 'closeRanks');
  if (stuck) return no(stuck);
  if (pu.activated.combat) return no(`${pu.name} already fought this phase.`);
  if (pu.closedRanksRound === state.round) return no(`${pu.name} already closed ranks.`);
  const from = playerPos(state, pu);
  if (!from) return no('Position unknown.');
  const cr = playerMoveReach(state, pu, pt, 3);
  if (cr.reach > 3.05) return no(`Close Ranks moves at most 3" (${cr.length === Infinity ? 'no path' : `${cr.reach.toFixed(1)}"`}). The whole base must end within 3" of where it started.`);
  const engaged = pu.engagedWith;
  const lead = shapeAt(pu.defId, pt);
  const cur = shapeAt(pu.defId, from);
  const gapTo = (s: Shape) => Math.min(...engaged.flatMap((id) => unitShapes(state, 'ai', id).map((e) => edgeDistance(s, e))));
  // A Leading Model already in base contact is pinned: it stays put and only the other models close in.
  if (gapTo(cur) <= CONTACT_IN) return ok;
  if (gapTo(lead) >= gapTo(cur) - 0.01) return no('The Leading Model must end closer to the enemy it is fighting.');
  const pinned = pinnedModels(state, 'players', pu.id).map((p) => shapeAt(pu.defId, p));
  if (!baseFits(state, 'players', pu.id, lead, pinned)) return no('The base would overlap another model or impassable terrain.');
  const newFoe = state.army.units.find((u) => u.location === 'table' && !engaged.includes(u.id) && unitShapes(state, 'ai', u.id).some((e) => edgeDistance(lead, e) <= ENGAGEMENT_IN));
  if (newFoe) return no(`Close Ranks cannot bring ${pu.name} into Engagement with ${newFoe.label}.`);
  return ok;
}

export function checkCharge(state: GameState, pu: PlayerUnit, target: AiUnitInstance): RuleCheck {
  if (state.step.kind !== 'PLAYERS_TURN') return no('Wait for your activation.');
  if (state.phase !== 'assault') return no('Charges happen in the Assault phase.');
  if (pu.location !== 'table') return no(`${pu.name} is not on the table.`);
  if (pu.activated.assault) return no(`${pu.name} already acted this phase.`);
  if (pu.engaged) return no(`${pu.name} is already engaged.`);
  const planted = statusBlocks(pu, 'charge');
  if (planted) return no(planted);
  if (pu.disengagedThisRound) return no(`${pu.name} disengaged this round and cannot charge.`);
  if (playerUnitFlying(pu)) return no('Flying units cannot charge.');
  if (isBurrowed(pu)) return no(`${pu.name} is Burrowed and cannot charge. Unburrow first.`);
  if (!chargeOptions(state, pu).some((c) => c.unit.id === target.id)) return no(`${target.label} is out of charge reach.`);
  return ok;
}

/** Weapons the unit can use in the current phase. */
export function playerWeapons(state: GameState, pu: PlayerUnit): WeaponProfile[] {
  const def = playerUnitDef(pu);
  const phase = state.phase === 'combat' ? 'Combat' : 'Assault';
  const all = availableWeapons(def, pu.upgrades, phase);
  // A weapon profile that names a Status can only be used while the unit has it, and while a unit has SIEGE MODE
  // no other weapon can be used (SIEGE MODE, Part 12).
  const statuses = (pu.statuses ?? []) as string[];
  const sieged = statuses.includes('Siege Mode');
  return all.filter((w) => (w.requiresStatus ? statuses.includes(titleStatus(w.requiresStatus)) : !sieged));
}

/** "SIEGE MODE" on a weapon profile is the 'Siege Mode' Status a unit carries. */
const titleStatus = (s: string) => s.replace(/\w\S*/g, (t) => t[0]!.toUpperCase() + t.slice(1).toLowerCase());

/** Actions a Status forbids outright: a unit in SIEGE MODE is planted where it stands. */
export function statusBlocks(pu: PlayerUnit, action: 'move' | 'run' | 'disengage' | 'charge' | 'closeRanks'): string | null {
  void action;
  return (pu.statuses ?? []).includes('Siege Mode') ? 'It cannot move in SIEGE MODE. Change mode first.' : null;
}

/** Whether one of your units still has something to do in the current phase. */
/** Whether the unit may attack now at all, before asking whether a given weapon is spent (see `weaponSpent`). */
export function playerCanFire(state: GameState, pu: PlayerUnit): boolean {
  if (pu.destroyed || pu.summoned || pu.location !== 'table') return false;
  if (state.phase !== 'assault' && state.phase !== 'combat') return false;
  if (state.activeUnitId && state.activeUnitId !== pu.id) return false;
  return state.phase !== 'combat' || pu.engaged;
}

export function playerCanAct(state: GameState, pu: PlayerUnit): boolean {
  if (pu.destroyed || pu.summoned) return false;
  if (state.phase === 'scoring') return false;
  if (state.activeUnitId && state.activeUnitId !== pu.id) return false;
  const key = state.phase;
  if (pu.location === 'reserves') return key === 'movement' && !pu.activated.movement;
  if (pu.location !== 'table' || pu.activated[key]) return false;
  return key !== 'combat' || pu.engaged;
}

/** Your units that can still act this phase. */
export function actableUnits(state: GameState): PlayerUnit[] {
  return state.playerUnits.filter((p) => playerCanAct(state, p));
}
