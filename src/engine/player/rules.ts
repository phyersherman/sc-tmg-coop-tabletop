import type { GameState } from '../types/game';
import type { PlayerUnit, Pt } from '../sense/types';
import type { AiUnitInstance } from '../types/army';
import type { WeaponProfile } from '../types/units';
import type { TerrainPiece } from '../types/terrain';
import { unitById } from '@data/index';
import { closestOnSegment, dist, playerSegments, zoiRect, aiSegments, pointInRect, rampLevel } from '../terrain/geometry';
import { losBlocked, losBetweenBases, passable, shortestPath } from '../sense/geometry2d';
import { CONTACT_IN, pinnedModels, pathOptionsFor, baseFits, standingPieces, closestBases, edgeDistance, edgeToPoint, ENGAGEMENT_IN, moveReach, shapeAt, unitShapes, chargeEndProblem, contactPointAlong, shapesEngaged, type Shape } from '../sense/placement';
import { aiUnitSize, playerUnitDef, playerUnitFlying, playerUnitSize, playerUnitSupply } from '../sense/playerUnits';
import { currentSupply, poolForRound } from '../units/supply';
import { activeEffects, aiRevealed, effectiveSpeed, extraEntryPoints, hasAbility, highGroundCover, inEnemyZoi, isBurrowed, isStationary, ownerOf, poolSupply, weaponWithEffects } from '../abilities/index';
import { availableWeapons, isSpecialist, maxRange, weaponModels } from '../units/weapons';
import { ownsAbility } from '../units/firing';
import { requisitionSupply } from '../missions/sideMarkers';
import { aiBurrowed } from '../ai/burrow';
import { playerPoolPenalty } from '../mutators/index';

export interface RuleCheck {
  ok: boolean;
  reason?: string;
  /** Deploy made some other way than the Entry Edge (Warp Conduit, Omega Network, Burrow Ambush, another edge...). */
  via?: string;
  /** Phase Prism: the Friendly Unit that returns to Reserves as this one takes its place. */
  swapId?: string;
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
  // Slim Pickings takes 1 from each player's pool (never in the final Round, when it is unlimited).
  const base = Math.max(0, poolForRound(state.playerSupply.start, state.playerSupply.escalation, state.round, state.finalRound) - playerPoolPenalty(state));
  const several = (state.config.players ?? 1) > 1;
  if (base === Infinity || (several && owner === undefined)) return base;
  return base + requisitionSupply(state, several ? owner : undefined);
}

/** Supply a player has on the table. With one player, everyone's. */
export function playerSupplyUsed(state: GameState, owner?: number): number {
  // Advanced Medic Facilities: that unit's Supply counts as 0 against the Supply Pool.
  return state.playerUnits.filter((p) => p.location === 'table' && (owner === undefined || ownerOf(p) === owner)).reduce((a, p) => a + poolSupply(p), 0);
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
  const flying = playerUnitFlying(pu);
  for (const u of state.army.units) {
    if (u.location !== 'table' || exclude.includes(u.id)) continue;
    // A Ground Unit keeps 1" from enemy Ground Units, a Flying Unit from enemy Flying Units: the two never Engage
    // each other, and may end in base contact (Part 8.5.3).
    if (unitById(u.defId).tags.includes('Flying') !== flying) continue;
    if (unitShapes(state, 'ai', u.id).some((s) => edgeDistance(lead, s) <= ENGAGEMENT_IN)) return u;
  }
  return null;
}

/** Why the Leading Model's base cannot stand at `pt` (overlapping another base or terrain), or null. */
function baseBlocked(state: GameState, pu: PlayerUnit, pt: Pt, facing = 0): string | null {
  const lead = shapeAt(pu.defId, { ...pt, a: facing });
  if (baseFits(state, 'players', pu.id, lead, [], { leader: true })) return null;
  return 'The base would overlap another model or impassable terrain.';
}

function insideTable(state: GameState, pt: Pt): boolean {
  const t = state.terrain.table;
  return pt.x >= 0 && pt.y >= 0 && pt.x <= t.width && pt.y <= t.height;
}

/**
 * Deployment from Reserves: the Leading Model enters at your Entry Edge and moves up to its Speed by the path it
 * takes, supply permitting. However it arrives (its own edge, a Pylon or Omega Worm, another table edge, Burrow
 * Ambush, Rapid Reinforcements, Phase Prism), it cannot end in the enemy's Zone of Influence (Part 8.3.3).
 */
export function checkDeploy(state: GameState, pu: PlayerUnit, pt: Pt): RuleCheck {
  if (state.phase !== 'movement') return no('Units deploy in the Movement phase.');
  if (state.step.kind !== 'PLAYERS_TURN') return no('Wait for your activation.');
  if (pu.location !== 'reserves') return no(`${pu.name} is not in Reserves.`);
  if (pu.activated.movement) return no(`${pu.name} already acted this phase.`);
  const supply = poolSupply(pu);
  const avail = playerAvailable(state, ownerOf(pu));
  if (supply > avail) return no(`Not enough Supply: needs ${supply}, ${avail === Infinity ? '∞' : avail} available.`);
  if (!insideTable(state, pt)) return no('Place the unit on the table.');
  const t = state.terrain.table;
  const speed = effectiveSpeed(pu, state);
  const flying = playerUnitFlying(pu);
  let via: string | undefined;
  let swapId: string | undefined;
  // The way in from the Entry Edge: measured along the path the Leading Model takes, around Size 2+ terrain.
  const entries = playerSegments(state.deployment).map((sg) => closestOnSegment(sg, t, pt));
  const d = Math.min(...entries.map((e) => (flying ? dist(e, pt) : Math.max(dist(e, pt), shortestPath(e, pt, state.terrain.pieces, t, pathOptionsFor(state, 'players', pu.id)).length))));
  const crow = Math.min(...entries.map((e) => dist(e, pt)));
  const enemyWithin = (inches: number) => state.army.units.some((u) => u.location === 'table' && unitShapes(state, 'ai', u.id).some((sh) => edgeToPoint(sh, pt) <= inches));
  if (d > speed + 0.05) {
    // Other ways onto the battlefield: a structure's entry, another table edge, or a PLACE from Reserves.
    const conduit = extraEntryPoints(state, pu).find((e) => dist(e.p, pt) <= speed + 1.05);
    const edgeD = Math.min(pt.x, pt.y, t.width - pt.x, t.height - pt.y);
    const ambush = hasAbility(pu, 'Burrow Ambush') && crow <= 18.05 && !enemyWithin(10);
    const friends = state.playerUnits.filter((o) => o.id !== pu.id && o.location === 'table' && !o.destroyed && !o.summoned);
    // Phase Prism: PLACE (0) from another Friendly Unit, which returns to Reserves.
    const prism = hasAbility(pu, 'Phase Prism') ? friends.find((o) => ownerOf(o) === ownerOf(pu) && unitShapes(state, 'players', o.id).some((sh) => edgeToPoint(sh, pt) <= 0.05)) : undefined;
    // Rapid Reinforcements: PLACE (10) from another Friendly Unit, no model Within 8" of an Enemy model.
    const reinforce = hasAbility(pu, 'Rapid Reinforcements') && !enemyWithin(8) && friends.some((o) => unitShapes(state, 'players', o.id).some((sh) => edgeToPoint(sh, pt) <= 10.05));
    if (conduit) via = conduit.source;
    else if (ambush) via = 'Burrow Ambush';
    else if (pu.deployAnyEdge && edgeD <= speed + 0.05 && !enemyWithin(10)) via = 'another table edge';
    else if (prism) { via = 'Phase Prism'; swapId = prism.id; }
    else if (reinforce) via = 'Rapid Reinforcements';
    else return no(`Too far from your entry edge: ${d === Infinity ? 'no path' : `${d.toFixed(1)}"`} (max ${speed}").${extraEntryPoints(state, pu).length ? ' Or deploy within Speed of your Pylon / Omega Worm.' : ''}`);
  }
  if (inEnemyZoi(state, pt)) return no("That is inside the AI's Zone of Influence. No Unit arriving from Reserves may end there.");
  if (!passable(pt, standingPieces(state, 'players', pu.id)) && !flying) return no('Cannot end on terrain (Size 1 and up).');
  if (!swapId) {
    const e = nearEnemy(state, pu, pt);
    if (e) return no(`Cannot end within 1" of ${e.label}.`);
    const blocked = baseBlocked(state, pu, pt);
    if (blocked) return no(blocked);
  }
  return via ? { ok: true, via, ...(swapId ? { swapId } : {}) } : ok;
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
  const speed = effectiveSpeed(pu, state);
  const flying = playerUnitFlying(pu);
  const m = playerMoveReach(state, pu, pt, speed);
  if (m.length === Infinity) return no('No path there.');
  // No part of the Leading Model's base may move more than Speed (Part 8.5.2): the base ends Wholly Within Speed of
  // where it started, measured from its edge along the path it takes.
  if (m.reach > speed + 0.05) return no(`Too far: ${m.reach.toFixed(1)}" of ${speed}". The whole base must end within ${speed}" of where it started.`);
  if (!passable(pt, standingPieces(state, 'players', pu.id)) && !flying) return no('Cannot end on terrain (Size 1 and up).');
  const e = nearEnemy(state, pu, pt);
  if (e) return no(`Cannot end within 1" of ${e.label}${kind === 'disengage' ? ' when disengaging' : ''}.`);
  // Even a Flying Unit must end where its base fits.
  const blocked = baseBlocked(state, pu, pt, m.facing);
  if (blocked) return no(blocked);
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
      // Stabilizer Medpacks: one more model counts as Within Range.
      reduce: ab.name === 'Transfusion' ? 2 : Math.max(1, modelsWithin(state, ru.id, pu.id, 4)) + (hasAbility(ru, 'Stabilizer Medpacks') ? 1 : 0),
      cost: ab.cost ? `${ab.cost.amount} ${ab.cost.resource}` : '',
    }));
  });
}

/**
 * Why an AI unit rolls Evade against your attack (Part 8.7.4), or null: it is BURROWED or has Precognition (every
 * attack); it is Engaged and the attack is a Ranged Attack; every model of it stands on HIGH GROUND and at least one
 * of the attacking models does not; the shot is INDIRECT FIRE at a Unit the attacker cannot see; your Engaged
 * Indomitable unit fires at a Unit it is not Engaged with; or it is Lurking (Stationary, the first Ranged Attack of
 * the Round).
 */
export function aiEvadeReason(state: GameState, target: AiUnitInstance, phase: 'Assault' | 'Combat', attacker?: PlayerUnit, weapon?: WeaponProfile): string | null {
  const tdef = unitById(target.defId);
  if (!tdef.stats.evade) return null;
  if (aiBurrowed(target)) return 'Burrowed';
  if (ownsAbility(tdef, target.upgrades, 'Precognition')) return 'Precognition';
  if (phase !== 'Assault') return null;
  if (target.engaged) return 'engaged target';
  if (attacker && highGroundCover(state, unitShapes(state, 'ai', target.id), unitShapes(state, 'players', attacker.id), tdef.tags.includes('Flying'), playerUnitFlying(attacker))) return 'high ground';
  if (attacker && weapon?.keywords.some((k) => k.k === 'INDIRECT FIRE') && !unitSees(state, attacker, target)) return 'indirect fire';
  if (attacker && attacker.engaged && !attacker.engagedWith.includes(target.id) && hasAbility(attacker, 'Indomitable')) return 'Indomitable';
  if (ownsAbility(tdef, target.upgrades, 'Lurking') && isStationary(state, target) && target.special?.lurkedRound !== state.round) return 'Lurking';
  return null;
}

/** The weapon as this unit fires it at this target: its upgrades, effects and range. */
export function firedAt(state: GameState, pu: PlayerUnit, weapon: WeaponProfile, u: AiUnitInstance | null): WeaponProfile {
  const gap = u ? Math.max(0, closestBases(unitShapes(state, 'players', pu.id), unitShapes(state, 'ai', u.id)).gap) : null;
  return weaponWithEffects(pu, weapon, u, u && Number.isFinite(gap) ? gap : null, state).weapon;
}

export function validTargets(state: GameState, pu: PlayerUnit, weapon: WeaponProfile): TargetOption[] {
  const from = playerPos(state, pu);
  if (!from) return [];
  const out: TargetOption[] = [];
  // BULKY: this weapon cannot make a Ranged Attack while the Unit is Engaged.
  if (weapon.range !== 'E' && pu.engaged && weapon.keywords.some((k) => k.k === 'BULKY')) return [];
  const indomitable = hasAbility(pu, 'Indomitable');
  // Coordinated Strike: the Shock Cannon may range from a Friendly Unit instead of measuring its own Range.
  const spotterId = activeEffects(pu).find((e) => e.mods.spotter && (!e.mods.weapons || e.mods.weapons.some((n) => weapon.name.toLowerCase().includes(n.toLowerCase()))))?.mods.spotter;
  const spotter = spotterId ? state.playerUnits.find((p) => p.id === spotterId && p.location === 'table' && !p.destroyed) : undefined;
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
    // The weapon as it is fired at this target: upgrades and effects may lengthen it or add keywords.
    const w = firedAt(state, pu, weapon, u);
    const has = (k: string) => w.keywords.some((x) => x.k === k);
    // A BURROWED unit is HIDDEN: it can be targeted only from within 4", unless something of yours reveals it.
    if (aiBurrowed(u) && d > 4 && !aiRevealed(state, u)) continue;
    // An Engaged Unit may only target what it is Engaged with; Indomitable lets it fire out of the fight.
    if (pu.engaged && !pu.engagedWith.includes(u.id) && !(indomitable && !u.engaged)) continue;
    // An Unengaged Unit cannot target an Engaged one without PINPOINT, unless that Unit is Indomitable.
    if (!pu.engaged && u.engaged && !has('PINPOINT') && !ownsAbility(tdef, u.upgrades, 'Indomitable')) continue;
    const r = w.range as number;
    const lr = maxRange(w);
    const los = unitSees(state, pu, u);
    // Coordinated Strike: within 8" of, and Visible to, a model of the spotting Unit.
    const spotted = !!spotter && Math.max(0, closestBases(unitShapes(state, 'players', spotter.id), unitShapes(state, 'ai', u.id)).gap) <= 8.05 && unitSees(state, spotter, u);
    if (d > lr && !spotted) continue;
    const visible = los || has('INDIRECT FIRE') || spotted;
    if (!visible) continue;
    out.push({ unit: u, distance: d, longRange: d > r && !spotted, visible });
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
  // Sizes as the units stand: a Burrowed unit is Size 0, a Siege Tank in SIEGE MODE Size 3.
  const sizeA = playerUnitSize(pu), sizeB = aiUnitSize(u);
  if (!mine.length || !theirs.length) return true;
  // Nearest pair first: it is the likeliest to see, and the search stops at the first that does.
  const near = closestBases(mine, theirs);
  // A Flying model ignores Full Cover; the other model's Direct Cover still applies (Part 7.1.4).
  const fly = { flyingA: playerUnitFlying(pu), flyingB: unitById(u.defId).tags.includes('Flying') };
  if (near.from && near.to && losBetweenBases(near.from, sizeA, near.to, sizeB, pieces, fly)) return true;
  return mine.some((m) => theirs.some((t) => losBetweenBases(m, sizeA, t, sizeB, pieces, fly)));
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
    else if (pu.engaged && weapon.keywords.some((k) => k.k === 'BULKY')) reason = `${weapon.name} is BULKY: it cannot fire while ${pu.name} is Engaged`;
    else if (aiBurrowed(u) && d !== null && d > 4) reason = `${u.label} is Burrowed: it can be targeted only from within 4"`;
    else if (pu.engaged && !pu.engagedWith.includes(u.id)) reason = `${pu.name} is Engaged. It can only shoot units it is fighting`;
    else if (!pu.engaged && u.engaged && !weapon.keywords.some((k) => k.k === 'PINPOINT')) reason = `${u.label} is Engaged. Only a PINPOINT weapon can target it`;
    else if (d !== null && d > maxRange(firedAt(state, pu, weapon, u))) reason = `Out of range: ${d.toFixed(1)}" (range ${maxRange(firedAt(state, pu, weapon, u))}")`;
    else if (!unitSees(state, pu, u)) {
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
  // A SIDEARM is fired on top of a model's weapon, and a SPECIALIST's weapon is another model's: each is its own
  // Batch, so neither is shut out by the unit's main weapon, nor shuts it out (Part 8.7.3, 9.1.7).
  const apart = (w: WeaponProfile | undefined) => !!w && (w.keywords.some((k) => k.k === 'SIDEARM') || isSpecialist(w));
  const mainUsed = fired.some((id) => !apart(playerUnitDef(pu).weapons.find((w) => w.id === id)));
  if (!apart(weapon) && mainUsed) return `${pu.name} already attacked with its main weapon. Only a SIDEARM or a SPECIALIST's weapon can still fire.`;
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
  /** Why the Charge cannot be declared: it would end in the Engagement Range of a Unit that is not its target. */
  blocked?: string;
}

/** AI Ground units within the maximum charge reach by path. */
export function chargeOptions(state: GameState, pu: PlayerUnit): ChargeOption[] {
  const from = playerPos(state, pu);
  if (!from) return [];
  const speed = effectiveSpeed(pu, state);
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
    const { length, path } = shortestPath(from, tm, state.terrain.pieces, state.terrain.table, pathOptionsFor(state, 'players', pu.id));
    if (length === Infinity) continue;
    const needed = Math.max(0, edgeDistance(lead, tm) + (length - Math.hypot(tm.x - from.x, tm.y - from.y)) - ENGAGEMENT_IN);
    // The Leading Model may not end Within Engagement Range of an Enemy Unit that is not a target of the Charge.
    const end = contactPointAlong(path.length >= 2 ? path : [from, tm], lead, tm);
    // (A unit making a second Charge with Lightning Dash stays Engaged with what it already fights.)
    const blocked = chargeEndProblem(state, 'players', pu.id, { ...lead, ...end }, [u.id, ...pu.engagedWith]) ?? undefined;
    if (needed <= speed + 6) out.push({ unit: u, pathDist: length, needed, targetModel: tm, blocked });
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
  const newFoe = state.army.units.find((u) => u.location === 'table' && !engaged.includes(u.id) && !unitById(u.defId).tags.includes('Flying') && unitShapes(state, 'ai', u.id).some((e) => shapesEngaged(state, lead, e)));
  if (newFoe) return no(`Close Ranks cannot bring ${pu.name} into Engagement with ${newFoe.label}.`);
  return ok;
}

export function checkCharge(state: GameState, pu: PlayerUnit, target: AiUnitInstance): RuleCheck {
  if (state.step.kind !== 'PLAYERS_TURN') return no('Wait for your activation.');
  if (state.phase !== 'assault') return no('Charges happen in the Assault phase.');
  if (pu.location !== 'table') return no(`${pu.name} is not on the table.`);
  // Lightning Dash: a second Charge in the same Activation, while Engaged, against a different Enemy Unit.
  const dash = !!pu.dashFrom && state.activeUnitId === pu.id;
  if (dash && (target.id === pu.dashFrom || pu.engagedWith.includes(target.id))) return no('Lightning Dash needs a different Enemy Unit.');
  if (pu.activated.assault && !dash) return no(`${pu.name} already acted this phase.`);
  if (pu.engaged && !dash) return no(`${pu.name} is already engaged.`);
  const planted = statusBlocks(pu, 'charge');
  if (planted) return no(planted);
  if (pu.disengagedThisRound) return no(`${pu.name} disengaged this round and cannot charge.`);
  if (playerUnitFlying(pu)) return no('Flying units cannot charge.');
  if (isBurrowed(pu)) return no(`${pu.name} is Burrowed and cannot charge. Unburrow first.`);
  const opt = chargeOptions(state, pu).find((c) => c.unit.id === target.id);
  if (!opt) return no(`${target.label} is out of charge reach.`);
  if (opt.blocked) return no(opt.blocked);
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
  return all
    .filter((w) => (w.requiresStatus ? statuses.includes(titleStatus(w.requiresStatus)) : !sieged))
    // A weapon every model has swapped away (the last Marine carrying the AGG-12 has no rifle) is not there to fire.
    .filter((w) => weaponModels(def, pu.upgrades, phase, w, pu.models) > 0);
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
