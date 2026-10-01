/**
 * Player abilities and Tactical/Faction card boosts.
 *
 * Paying costs: Terran abilities cost CP, Zerg BM, Protoss PE. A cost is paid by Exhausting Ready cards whose
 * resource values add up to it (excess is lost). Using a card's own boost also Exhausts it. Cards refresh at Cleanup.
 * Active and Reaction abilities can be used once per round per unit (REPEATABLE excepted).
 *
 * Every usable ability has a spec here. `automated` specs change the game state (buffs that feed into movement,
 * charges and attacks, heals, tokens, summons, debuffs on AI units). The rest record a reminder effect on the unit so
 * the player resolves it on the table and can see it is active.
 */
import type { GameState, PlayerCard, BoardToken } from '../types/game';
import type { AbilityDef, CardDef, UnitDef, WeaponProfile, SurgeType } from '../types/units';
import type { AiUnitInstance } from '../types/army';
import type { PlayerUnit, Pt, UnitEffect, EffectMods } from '../sense/types';
import { CARDS, unitById } from '@data/index';
import { speedFor } from '../units/speed';
import { baseFits, edgeDistance, edgeToPoint, pathOptionsFor, placeUnit, sameElevationAsMarker, shapeAt, syncModelPositions, unitShapes, type Shape } from '../sense/placement';
import { baseElevation, isHighGround, losBetweenBases, segmentHitsRect, shortestPath } from '../sense/geometry2d';
import { aiUnitSize, playerUnitSize, playerUnitSupply } from '../sense/playerUnits';
import { currentSupply } from '../units/supply';
import { makePlayerUnit, playerUnitDef, playerUnitFlying } from '../sense/playerUnits';
import { aiSegments, playerSegments, closestOnSegment, pieceLocal, pieceParts, pointInRect, zoiRect } from '../terrain/geometry';
import { firedWeapon, ownsAbility, raiseKeyword } from '../units/firing';
import { targetNumber } from '../combat/resolve';
import { MARKER_RADIUS_IN } from '@data/bases';

export type Resource = 'CP' | 'BM' | 'PE';
export const RESOURCE_OF: Record<string, Resource> = { Terran: 'CP', Zerg: 'BM', Protoss: 'PE' };
export const RESOURCE_NAME: Record<Resource, string> = { CP: 'Command Points', BM: 'Biomass', PE: 'Psionic Energy' };

export type TargetKind = 'none' | 'self' | 'friendly' | 'enemy' | 'point';

export interface AbilityContext {
  state: GameState;
  /** The unit using the ability, or the active (selected) unit for card boosts. */
  unit?: PlayerUnit;
  friendly?: PlayerUnit;
  enemy?: AiUnitInstance;
  point?: Pt;
  /** Option picked for multi-choice abilities (Raynor's Orders). */
  option?: number;
  /** The player whose card or unit this is (0-based). */
  owner?: number;
}

export interface AbilitySpec {
  target: TargetKind;
  /** Range in inches from the using unit (or constraint description for points). */
  range?: number;
  /** A range an upgrade changes (Optical Flare with the A-13 Flash Grenade Launcher). */
  rangeFor?: (pu: PlayerUnit) => number;
  /** Short hint for the target picker. */
  targetHint?: string;
  /** For card boosts: the active unit must match. */
  needsUnit?: (pu: PlayerUnit) => boolean;
  friendlyFilter?: (pu: PlayerUnit) => boolean;
  options?: { label: string; cost: number }[];
  once?: 'game';
  repeatable?: boolean;
  /** The app changes the game state for this effect (otherwise it is a reminder you resolve on the table). */
  automated: boolean;
  /** Resolve. Returns a log line, or an error string starting with "!". */
  apply(ctx: AbilityContext): string;
}

// ------------------------------------------------------------------ helpers

const uid = (state: GameState, prefix: string) => `${prefix}-${state.round}-${state.log.length}-${Math.floor(Math.random() * 1e6)}`;
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function unitPos(state: GameState, pu: PlayerUnit): Pt | null {
  return state.sense?.players[pu.id]?.[0] ?? null;
}
export function aiUnitPos(state: GameState, u: AiUnitInstance): Pt | null {
  return state.sense?.ai[u.id]?.[0] ?? u.est ?? null;
}
const hasTag = (pu: PlayerUnit, tag: string) => (playerUnitDef(pu).tags as string[]).includes(tag);
const isBio = (pu: PlayerUnit) => hasTag(pu, 'Biological');
const isMech = (pu: PlayerUnit) => hasTag(pu, 'Mechanical');
const isGround = (pu: PlayerUnit) => !hasTag(pu, 'Flying');

function addEffect(pu: PlayerUnit, source: string, text: string, mods: EffectMods, until: UnitEffect['until'] = 'round'): void {
  pu.effects ??= [];
  // Same-named effects do not stack.
  pu.effects = pu.effects.filter((e) => e.source !== source || until === 'firstWeapon');
  pu.effects.push({ id: `${source}-${pu.effects.length}-${Math.floor(Math.random() * 1e6)}`, source, text, mods, until });
}
const reminder = (pu: PlayerUnit | undefined, source: string, text: string) => {
  if (pu) addEffect(pu, source, text, {});
  return `${source}: ${text}`;
};

function nearestEnemyDist(state: GameState, p: Pt): number {
  let best = Infinity;
  for (const u of state.army.units) {
    if (u.location !== 'table') continue;
    const q = aiUnitPos(state, u);
    if (q) best = Math.min(best, dist(p, q));
  }
  return best;
}

function heal(pu: PlayerUnit, x: number): number {
  const before = pu.damageMarker;
  pu.damageMarker = Math.max(0, pu.damageMarker - x);
  return before - pu.damageMarker;
}

/** How many models of one of your units are Within `inches` of another unit, base edge to base edge. All of them when positions are not known. */
function modelsNear(state: GameState, unit: PlayerUnit, other: PlayerUnit, inches: number): number {
  const mine = unitShapes(state, 'players', unit.id);
  const theirs = unitShapes(state, 'players', other.id);
  if (!mine.length || !theirs.length) return unit.models;
  return mine.filter((m) => theirs.some((t) => edgeDistance(m, t) <= inches + 0.05)).length;
}

/** Inside the AI's Zone of Influence: no Unit arriving from Reserves, by any means, may end there (Part 8.3.3). */
export function inEnemyZoi(state: GameState, p: Pt): boolean {
  const t = state.terrain.table;
  return aiSegments(state.deployment).some((seg) => pointInRect(p, zoiRect(seg, t)));
}

/** Whether any model of one of your units stands in the AI's Zone of Influence. */
export function unitInEnemyZoi(state: GameState, pu: PlayerUnit): boolean {
  const t = state.terrain.table;
  const zones = aiSegments(state.deployment).map((seg) => zoiRect(seg, t));
  // Within: any part of a base inside the zone.
  return unitShapes(state, 'players', pu.id).some((s) => zones.some((z) => s.x + s.r > z.x && s.x - s.r < z.x + z.w && s.y + s.r > z.y && s.y - s.r < z.y + z.h));
}

/**
 * RESPAWN (X): return up to X destroyed models, never pushing the unit into a higher Supply bracket (Part 12).
 * Returns how many came back.
 */
function respawn(pu: PlayerUnit, x: number): number {
  const def = playerUnitDef(pu);
  let back = 0;
  while (back < x && pu.models < pu.maxModels && currentSupply(def, pu.models + 1) <= currentSupply(def, pu.models)) { pu.models++; back++; }
  return back;
}

/** NON-LETHAL DAMAGE (X): add to the damage marker without removing models. */
function nonLethal(pu: PlayerUnit, x: number): void {
  pu.damageMarker += x;
}

function setUnitAt(state: GameState, pu: PlayerUnit, p: Pt): void {
  placeUnit(state, 'players', pu.id, p, { avoidEngaging: true });
}

function summon(state: GameState, defId: string, p: Pt, opts: { expires?: boolean; /** Whose unit it is. */ owner?: number; /** SUMMON: it cannot be Activated in the Phase it arrives in, and acts from the next. */ thisPhaseOnly?: boolean } = {}): PlayerUnit {
  const def = unitById(defId);
  const pu = makePlayerUnit(uid(state, defId), defId, 'small', [], def.name);
  pu.location = 'table';
  pu.summoned = true;
  pu.deployedRound = state.round;
  pu.movedRound = state.round;
  if (opts.owner) pu.owner = opts.owner;
  pu.activated = opts.thisPhaseOnly
    ? { movement: state.phase === 'movement', assault: state.phase === 'assault', combat: state.phase === 'combat' }
    : { movement: true, assault: true, combat: true };
  if (opts.expires) pu.expiresEndOfRound = true;
  state.playerUnits.push(pu);
  setUnitAt(state, pu, p);
  return pu;
}

function addToken(state: GameState, kind: BoardToken['kind'], p: Pt, label: string, extra: Partial<BoardToken> = {}): BoardToken {
  const t: BoardToken = { id: uid(state, kind), kind, x: p.x, y: p.y, label, round: state.round, ...extra };
  state.tokens ??= [];
  state.tokens.push(t);
  if (kind === 'forceField') {
    // Size 2 obstacle for movement (not for line of sight).
    state.terrain.pieces.push({ n: 900 + state.tokens.length, catalogId: `token:${t.id}`, size: 2, grass: false, x: p.x - 0.75, y: p.y - 0.75, w: 1.5, h: 1.5, label: 'Force Field' });
  }
  return t;
}

/** Tokens whose end-of-round effect is still waiting for a choice: Shades (move the Adepts) and drop points (deploy a unit). */
export function pendingEndOfRound(state: GameState): { token: BoardToken; kind: 'shade' | 'drop'; owner?: PlayerUnit; candidates: PlayerUnit[] }[] {
  const out: { token: BoardToken; kind: 'shade' | 'drop'; owner?: PlayerUnit; candidates: PlayerUnit[] }[] = [];
  for (const t of state.tokens ?? []) {
    if (t.resolved) continue;
    if (t.kind === 'shade') {
      const owner = state.playerUnits.find((p) => p.id === t.ownerId);
      if (owner && owner.location === 'table' && !owner.destroyed) out.push({ token: t, kind: 'shade', owner, candidates: [] });
    } else if (t.kind === 'dropPoint') {
      const candidates = state.playerUnits.filter((p) => p.location === 'reserves' && !p.destroyed && !p.summoned && isGround(p));
      if (candidates.length) out.push({ token: t, kind: 'drop', candidates });
    }
  }
  return out;
}

/**
 * A token the unit may step to at the end of the round (the Adept's Shade, the Ravager's Deep Tunnel): set Wholly
 * Within 12" of one of its models, somewhere it could stand and reach on foot. One per unit.
 */
function transferToken(state: GameState, pu: PlayerUnit, point: Pt, what: string): string {
  const models = unitShapes(state, 'players', pu.id);
  const mark = shapeAt(pu.defId, point);
  if (!models.length) return `!${pu.name} must be on the table.`;
  const within = models.some((m) => Math.hypot(m.x - mark.x, m.y - mark.y) + mark.r - m.r <= 12.01);
  if (!within) return `!The ${what} must be set Wholly Within 12" of a model of this unit.`;
  if (!baseFits(state, 'players', pu.id, mark)) return `!The ${what} cannot overlap models or impassable terrain.`;
  const from = models.reduce((a, b) => (Math.hypot(a.x - mark.x, a.y - mark.y) <= Math.hypot(b.x - mark.x, b.y - mark.y) ? a : b));
  const route = shortestPath(from, mark, state.terrain.pieces, state.terrain.table, pathOptionsFor(state, 'players', pu.id));
  if (route.length === Infinity) return `!The ${what} has no way to get there.`;
  for (const t of (state.tokens ?? []).filter((x) => x.kind === 'shade' && x.ownerId === pu.id)) removeToken(state, t.id);
  addToken(state, 'shade', point, `${pu.name} ${what}`, { ownerId: pu.id, path: route.path.length >= 2 ? route.path.map((p) => ({ x: p.x, y: p.y })) : [from, point] });
  return `${what} set. At the end of the round ${pu.name} may move to it.`;
}

/** HITS X (Y): X automatic hits straight into the target's Armour Pool, at Y damage each, no Surge (Part 12). */
export function pushHits(state: GameState, target: AiUnitInstance, hits: number, dmgPer: number, source: string, armourMod = 0): void {
  state.pendingHits = [...(state.pendingHits ?? []), { targetId: target.id, hits, dmgPer, source, armourMod }];
}

export function removeToken(state: GameState, id: string): void {
  state.tokens = (state.tokens ?? []).filter((t) => t.id !== id);
  state.terrain.pieces = state.terrain.pieces.filter((p) => p.catalogId !== `token:${id}`);
}

/** Creep: within 6" of a Creep Tumor or a Source of Creep (Omega Worm). */
export function onCreep(state: GameState, pu: PlayerUnit): boolean {
  const def = playerUnitDef(pu);
  // ON CREEP: a Ground Zerg Unit Within 6" of a Creep Tumor token or a Source of Creep.
  if (def.faction !== 'Zerg' || !isGround(pu) || pu.location !== 'table') return false;
  const mine = unitShapes(state, 'players', pu.id);
  if (!mine.length) return false;
  if ((state.tokens ?? []).some((t) => t.kind === 'creepTumor' && mine.some((m) => edgeToPoint(m, t) <= 6.05))) return true;
  return state.playerUnits.some((o) => o.defId === 'omega_worm' && o.location === 'table' && !o.destroyed && (o.deployedRound ?? 0) < state.round
    && unitShapes(state, 'players', o.id).some((w) => mine.some((m) => edgeDistance(m, w) <= 6.05)));
}

const precisionFrom = (text: string) => Number(/PRECISION \((\d+)\)/.exec(text)?.[1] ?? 0);

// ------------------------------------------------------------------ unit abilities

const placeSpec = (range: number, extra?: (ctx: AbilityContext) => string | null, noEngage = false): AbilitySpec => ({
  target: 'self',
  automated: true,
  apply: (ctx) => {
    const pu = ctx.unit!;
    const err = extra?.(ctx);
    if (err) return err;
    pu.placeRange = range;
    pu.placeNoEngage = noEngage;
    pu.placeAsAction = false;
    return `${pu.name} may be PLACEd up to ${range}": drag it on the map.`;
  },
});

const chargeTwoDice = (name: string): AbilitySpec => ({
  target: 'self',
  automated: true,
  apply: ({ unit }) => { addEffect(unit!, name, 'Next charge rolls 2D6 and uses the higher result.', { chargeTwoDice: true }, 'charge'); return `${unit!.name}: ${name}. Its next charge rolls 2D6 and uses the higher result.`; },
});

export const UNIT_ABILITIES: Record<string, AbilitySpec> = {
  Stimpack: {
    target: 'self',
    automated: true,
    apply: ({ unit, state }) => {
      const pu = unit!;
      const ab = playerUnitDef(pu).abilities.find((a) => a.name === 'Stimpack');
      const prec = precisionFrom(ab?.text ?? '') || 3;
      nonLethal(pu, 2);
      addEffect(pu, 'Stimpack', `+3 Speed. C-14 Rifle / Quad K12 and close combat weapons gain PRECISION (${prec}). Suffered 2 non-lethal damage.`, { speed: 3 });
      addEffect(pu, 'Stimpack (ranged)', `PRECISION (${prec})`, { precision: prec, weapons: ['C-14', 'Quad K12'] });
      addEffect(pu, 'Stimpack (melee)', `PRECISION (${prec})`, { precision: prec, weaponPhase: 'Combat' });
      void state;
      return `${pu.name} uses Stimpack: +3 Speed, PRECISION (${prec}), 2 non-lethal damage.`;
    },
  },
  Medpack: {
    target: 'friendly',
    range: 4,
    friendlyFilter: (pu) => isBio(pu),
    targetHint: 'another friendly Biological unit within 4"',
    automated: true,
    apply: ({ unit, friendly, state }) => {
      if (!friendly || friendly.id === unit!.id) return '!Pick another friendly Biological unit.';
      // HEAL (X): X is the number of this unit's models Within 4" of the target (Stabilizer Medpacks counts one more).
      const x = modelsNear(state, unit!, friendly, 4) + (hasAbility(unit!, 'Stabilizer Medpacks') ? 1 : 0);
      const healed = heal(friendly, x);
      return `${unit!.name} Medpack heals ${friendly.name} for ${healed} (HEAL ${x}).`;
    },
  },
  'Optical Flare': {
    target: 'enemy',
    range: 12,
    rangeFor: (pu) => (hasAbility(pu, 'A-13 Flash Grenade Launcher') ? 16 : 12),
    automated: true,
    apply: ({ enemy, state }) => {
      const e = enemy!;
      e.debuffs ??= [];
      e.debuffs.push({ id: uid(state, 'flare'), source: 'Optical Flare', text: 'Ranged weapons −4" range, no LONG RANGE', rangeMod: -4, noLongRange: true });
      return `Optical Flare on ${e.label}. Its ranged weapons lose 4" of range and cannot use LONG RANGE this round.`;
    },
  },
  'Target Lock': {
    target: 'enemy',
    range: 12,
    automated: true,
    apply: ({ enemy, state }) => {
      const e = enemy!;
      e.debuffs ??= [];
      e.debuffs.push({ id: uid(state, 'lock'), source: 'Target Lock', text: 'Goliath Autocannons gain Surge Light/Armoured D3+1', targetLock: true });
      return `Target Lock on ${e.label}: Goliath Autocannons gain Surge (Light, Armoured) D3+1 against it.`;
    },
  },
  'Combat Shield': { target: 'self', automated: true, apply: ({ unit }) => { addEffect(unit!, 'Combat Shield', 'May make an Evade Roll against Close Combat Attacks and Damage from enemy Special Abilities this Round.', { evadeMelee: true }); return `${unit!.name} raises Combat Shield: it may make an Evade Roll against Close Combat Attacks this Round.`; } },
  'Leg Enhancements': { target: 'self', automated: true, apply: ({ unit }) => { if (unit!.engaged) return '!An Engaged Unit cannot perform a Move action.'; unit!.bonusMove = 2; return `${unit!.name} may make a free 2" Move: drag it on the map.`; } },
  Charge: chargeTwoDice('Charge'),
  'Metabolic Boost': chargeTwoDice('Metabolic Boost'),
  Leap: { target: 'self', automated: true, apply: ({ unit }) => { addEffect(unit!, 'Leap', '+2" to the next charge distance.', { chargeBonus: 2 }, 'charge'); return `${unit!.name}: Leap, +2" to its next charge.`; } },
  'Adrenal Overload': { target: 'self', automated: true, apply: ({ unit }) => { addEffect(unit!, 'Adrenal Overload', '+1 to IMPACT hit rolls this round.', { impactHit: 1 }); return `${unit!.name}: Adrenal Overload, +1 to IMPACT hit rolls.`; } },
  Blink: placeSpec(6, ({ unit }) => (unit!.engaged ? '!Blink cannot be used while Engaged. Disengage first.' : null), true),
  'Leaping Strike': placeSpec(6, ({ unit }) => (unit!.engaged ? '!Only while unengaged.' : null)),
  'Path of Shadows': {
    target: 'self',
    automated: true,
    apply: ({ unit }) => { unit!.statuses = [...new Set([...(unit!.statuses ?? []), 'Hidden' as const])]; return `${unit!.name} gains HIDDEN until it performs another action.`; },
  },
  Burrow: {
    target: 'self',
    automated: true,
    apply: ({ unit }) => {
      const pu = unit!;
      if (pu.engaged) return '!Only while unengaged.';
      if (hasAbility(pu, 'Underdeveloped Claws')) return '!This Unit cannot gain the Burrowed Status.';
      const on = pu.statuses?.includes('Burrowed');
      pu.statuses = on ? (pu.statuses ?? []).filter((s) => s !== 'Burrowed') : [...(pu.statuses ?? []), 'Burrowed'];
      return `${pu.name} ${on ? 'unburrows' : 'burrows (HIDDEN, Size 0, cannot contest markers)'}.`;
    },
  },
  'Glial Reconstitution': {
    target: 'self',
    automated: true,
    apply: ({ unit, state }) => { const n = onCreep(state, unit!) ? 2 : 1; addEffect(unit!, 'Glial Reconstitution', `+${n} Speed this round.`, { speed: n }); return `${unit!.name}: +${n} Speed.`; },
  },
  'Zergling Reconstitution': {
    target: 'self',
    automated: true,
    apply: ({ unit, state }) => {
      const n = onCreep(state, unit!) ? 3 : 2;
      const back = respawn(unit!, n);
      return `${unit!.name} respawns ${back} model${back === 1 ? '' : 's'} (RESPAWN ${n}).`;
    },
  },
  'Roachling Infestation': {
    target: 'self',
    once: 'game',
    automated: true,
    apply: ({ unit, state }) => {
      const p = unitPos(state, unit!);
      if (!p) return '!Place the unit on the table first.';
      const r = summon(state, 'roachling', { x: p.x + 1.2, y: p.y + 1.2 }, { owner: unit!.owner, thisPhaseOnly: true });
      r.summoned = false;
      r.name = 'Roachlings';
      // A summoned Unit cannot be set Within the opponent's Zone of Influence.
      if (unitInEnemyZoi(state, r)) {
        state.playerUnits = state.playerUnits.filter((x) => x.id !== r.id);
        if (state.sense) delete state.sense.players[r.id];
        return "!The Roachlings cannot be set Within the enemy's Zone of Influence.";
      }
      return `${unit!.name} spawns Roachlings next to it (they cannot activate this phase).`;
    },
  },
  'Spawn Creep Tumor': {
    target: 'point',
    range: 1.5,
    targetHint: 'a spot in base contact with the Queen',
    automated: true,
    apply: ({ state, point }) => { addToken(state, 'creepTumor', point!, 'Creep Tumor', { stayInPlay: hasStayInPlayCreep(state) }); return 'Creep Tumor set: Zerg units within 6" are ON CREEP.'; },
  },
  'Crushing Grip': {
    target: 'enemy',
    range: 12,
    automated: true,
    apply: ({ enemy, state }) => {
      const key = state.phase === 'scoring' ? null : state.phase;
      if (key) enemy!.activated[key] = true;
      return `Crushing Grip: ${enemy!.label} counts as activated this phase.`;
    },
  },
  'Mutating Carapace': { target: 'enemy', range: 18, automated: true, apply: ({ unit, enemy }) => { addEffect(unit!, 'Mutating Carapace', `Evade Roll, with a +2 Modifier, against all attacks made by ${enemy!.label} this Round.`, { evadeVs: enemy!.id, evadeBonus: 2 }); return `Mutating Carapace: ${unit!.name} may make an Evade Roll with a +2 Modifier against all attacks made by ${enemy!.label}.`; } },
  'Force Field': {
    target: 'point',
    range: 8,
    targetHint: 'an empty spot within 8"',
    automated: true,
    apply: ({ state, point }) => { addToken(state, 'forceField', point!, 'Force Field'); return 'Force Field set: Size 2 or smaller units cannot move across it.'; },
  },
  'Solid-Field Projectors': {
    target: 'point',
    range: 8,
    targetHint: 'an empty spot within 8"',
    automated: true,
    apply: ({ state, point }) => { addToken(state, 'forceField', point!, 'Force Field'); return 'Force Field set.'; },
  },
  'Guardian Shield': {
    target: 'self',
    automated: true,
    apply: ({ unit }) => { addEffect(unit!, 'Guardian Shield', 'Ranged attacks at friendly units within 4" roll 1 fewer die this round.', { auraFewerDice: 1 }); return `${unit!.name} raises Guardian Shield (4").`; },
  },
  'Psionic Transfer': {
    target: 'point',
    range: 12,
    targetHint: 'a spot within 12" for the Shade',
    automated: true,
    apply: ({ state, point, unit }) => transferToken(state, unit!, point!, 'Shade'),
  },
  // ---- Siege Tank -------------------------------------------------------------------------------------------
  'Mode Transformation': {
    target: 'self',
    automated: true,
    apply: ({ unit }) => {
      const pu = unit!;
      const had = (pu.statuses ?? []).includes('Siege Mode');
      pu.statuses = had ? (pu.statuses ?? []).filter((x) => x !== 'Siege Mode') : [...(pu.statuses ?? []), 'Siege Mode'];
      return had
        ? `${pu.name} leaves SIEGE MODE: it can move again, and its Shock Cannon is stowed.`
        : `${pu.name} enters SIEGE MODE: it cannot move, counts as Size 3, and fires only the Shock Cannon.`;
    },
  },
  'Coordinated Strike': {
    target: 'friendly',
    friendlyFilter: (pu) => !pu.engaged,
    targetHint: 'a friendly unit that is not engaged (no line of sight needed)',
    automated: true,
    apply: ({ friendly, unit }) => {
      addEffect(unit!, 'Coordinated Strike', `Shock Cannon may range from ${friendly!.name}: target an enemy within 8" of and visible to it.`, { spotter: friendly!.id, weapons: ['Shock Cannon'] });
      return `Coordinated Strike: ${unit!.name}'s Shock Cannon may fire on what ${friendly!.name} can see, ignoring its own Range.`;
    },
  },
  'Shaped Blast': {
    target: 'self',
    once: 'game',
    automated: true,
    apply: ({ unit }) => {
      if (!(unit!.statuses ?? []).includes('Siege Mode')) return '!Shaped Blast needs SIEGE MODE.';
      addEffect(unit!, 'Shaped Blast', 'Its next shot gains PINPOINT and LOCKED IN (4).', { pinpoint: true, lockedIn: 4 }, 'firstWeapon');
      return `Shaped Blast: ${unit!.name}'s next shot gains PINPOINT and LOCKED IN (4).`;
    },
  },
  'Smart Shells': {
    target: 'self',
    once: 'game',
    automated: true,
    apply: ({ unit }) => {
      if (!(unit!.statuses ?? []).includes('Siege Mode')) return '!Smart Shells need SIEGE MODE.';
      addEffect(unit!, 'Smart Shells', 'Its next shot gains INDIRECT FIRE and LONG RANGE (24").', { indirect: true, longRange: 24 }, 'firstWeapon');
      return `Smart Shells: ${unit!.name}'s next shot gains INDIRECT FIRE and LONG RANGE (24").`;
    },
  },
  // ---- Ravager ----------------------------------------------------------------------------------------------
  'Corrosive Bile': {
    target: 'point',
    range: 14,
    targetHint: 'a spot within 14" to spit bile at',
    automated: true,
    apply: ({ state, point, unit }) => {
      const pu = unit!;
      const models = unitShapes(state, 'players', pu.id);
      if (!models.length) return '!The Ravagers must be on the battlefield.';
      // One token for each model of the unit, each set Within 14" of its own model: one spot at a time.
      const mine = (state.tokens ?? []).filter((t) => t.kind === 'bile' && t.ownerId === pu.id && t.round === state.round).length;
      const free = models.filter((m) => edgeToPoint(m, point!) <= 14.05).length;
      if (!free) return '!No model of this unit is Within 14" of that spot.';
      if (mine >= pu.models) return '!Every model of this unit has set its Corrosive Bile token.';
      const radius = hasAbility(pu, 'Bloated Bile Ducts') ? 2 : 1;
      addToken(state, 'bile', point!, 'Corrosive Bile', { ownerId: pu.id, radius });
      const left = pu.models - mine - 1;
      pu.pendingUses = left > 0 ? { name: 'Corrosive Bile', left } : undefined;
      return `Corrosive Bile: token ${mine + 1} of ${pu.models} set.${left > 0 ? ` Set ${left} more.` : ''} At the End of the Assault Phase each Unit Within ${radius}" of a token suffers HITS 5 (1) for each.`;
    },
  },
  'Deep Tunnel': {
    target: 'point',
    range: 12,
    targetHint: 'a spot within 12" to tunnel to',
    automated: true,
    apply: ({ state, point, unit }) => transferToken(state, unit!, point!, 'Ravager Burrow'),
  },
  // ---- Zeratul ----------------------------------------------------------------------------------------------
  'Void Blink': placeSpec(6, ({ unit }) => (unit!.engaged ? '!Only while unengaged.' : null)),
  'Sentenced to Death': {
    target: 'enemy',
    targetHint: 'any enemy unit on the battlefield',
    automated: true,
    apply: ({ enemy, state, unit }) => {
      const e = enemy!;
      e.debuffs ??= [];
      e.debuffs.push({ id: uid(state, 'sentence'), source: 'Sentenced to Death', text: `${unit!.name}'s close combat weapons gain CRITICAL HIT (2) against it`, sentenced: true });
      return `Sentenced to Death: ${unit!.name} strikes ${e.label} with CRITICAL HIT (2).`;
    },
  },
  'Void Prison': {
    target: 'point',
    range: 8,
    targetHint: 'a spot within 8" to seal',
    automated: true,
    apply: ({ state, point }) => { addToken(state, 'indicator', point!, 'Void Prison', { radius: 2 }); return 'Void Prison set: enemy units within 2" of it suffer DEBUFF Speed (2).'; },
  },
  'Shadow Strike': {
    target: 'self',
    automated: true,
    apply: ({ state, unit }) => {
      const engaged = state.army.units.filter((u) => u.location === 'table' && unit!.engagedWith.includes(u.id));
      if (!engaged.length) return '!Shadow Strike needs an enemy engaged with this unit.';
      for (const e of engaged) pushHits(state, e, 4, 1, 'Shadow Strike');
      return `Shadow Strike: ${engaged.map((e) => e.label).join(', ')} suffer 4 hits each.`;
    },
  },
  'One With the Shadows': {
    target: 'self',
    automated: true,
    apply: ({ unit }) => { unit!.statuses = [...new Set([...(unit!.statuses ?? []), 'Hidden' as const])]; return `${unit!.name} slips back into the shadows (HIDDEN).`; },
  },
  'Resonating Glaives': { target: 'self', automated: true, apply: ({ unit }) => { addEffect(unit!, 'Resonating Glaives', 'Glaive Cannon +1 RoA this round.', { roa: 1, weapons: ['Glaive'] }); return `${unit!.name}: Glaive Cannon +1 RoA.`; } },
  Orders: {
    target: 'friendly',
    range: 8,
    friendlyFilter: (pu) => isBio(pu),
    targetHint: 'another friendly Biological unit within 8"',
    repeatable: true,
    options: [
      { label: 'First weapon gains CRITICAL HIT (2)', cost: 1 },
      { label: 'Ignore the Disengage penalty this round', cost: 1 },
      { label: 'Remove its Activation Marker', cost: 2 },
    ],
    automated: true,
    apply: ({ friendly, unit, option, state }) => {
      const f = friendly!;
      if (f.id === unit!.id) return '!Orders must target another unit.';
      if (option === 0) { addEffect(f, 'Orders: Critical', 'First weapon used gains CRITICAL HIT (2).', { critical: 2 }, 'firstWeapon'); return `Orders: ${f.name}'s first weapon gains CRITICAL HIT (2).`; }
      if (option === 1) { addEffect(f, 'Orders: Retreat', 'Ignores the Disengage penalty this round.', { ignoreDisengage: true }); f.disengagedThisRound = false; return `Orders: ${f.name} ignores the Disengage penalty.`; }
      const key = state.phase === 'scoring' ? null : state.phase;
      if (key) f.activated[key] = false;
      return `Orders: ${f.name} may activate again this phase.`;
    },
  },
  'Domineering Presence': { target: 'friendly', range: 6, targetHint: 'another friendly unit within 6"', automated: true, apply: ({ friendly, unit }) => { if (friendly!.id === unit!.id) return '!Select another Friendly Unit.'; addEffect(friendly!, 'Domineering Presence', '+1 Supply for markers and objectives this round.', { supplyBonus: 1 }); return `${friendly!.name} counts +1 Supply for markers this round.`; } },
  // Reactions resolved during AI attacks are offered in the saves panel; used from the card they are reminders.
  'Life Support': { target: 'none', automated: false, apply: ({ unit }) => reminder(unit, 'Life Support', 'Use when rolling saves: reduce damage by 1 per Medic model within 4".') },
  Transfusion: { target: 'none', automated: false, apply: ({ unit }) => reminder(unit, 'Transfusion', 'Use when rolling saves: reduce damage by 2.') },
  Restoration: { target: 'friendly', range: 4, automated: false, apply: ({ friendly }) => reminder(friendly, 'Restoration', 'All debuffs removed.') },
  'Concussive Shells': { target: 'none', automated: false, apply: ({ unit }) => reminder(unit, 'Concussive Shells', 'An enemy charging a friendly unit within 8" suffers −2 Speed.') },
  'Zealous Round': { target: 'none', automated: false, apply: ({ unit }) => reminder(unit, 'Zealous Round', 'When damaged while not activated: flip its activation to reduce damage by 2.') },
  Hallucination: { target: 'none', automated: false, apply: ({ unit }) => reminder(unit, 'Hallucination', 'A friendly unit within 4" targeted by a ranged attack may Evade.') },
  // Offered when its moment comes (engine/player/reactions): the command card only reminds you of it.
  "Hierarch’s Stand": { target: 'none', automated: false, apply: ({ unit }) => reminder(unit, "Hierarch's Stand", 'Redirect a ranged attack at a friendly unit within 8" to Artanis (he may Evade).') },
  'Lightning Dash': { target: 'none', automated: false, apply: ({ unit }) => reminder(unit, 'Lightning Dash', 'After a successful charge, declare a second charge at another enemy.') },
  Lunge: { target: 'none', automated: false, apply: ({ unit }) => reminder(unit, 'Lunge', 'After a friendly unit within 10" is shot, move directly toward the attacker.') },
  'Debilitating Saliva': { target: 'none', automated: false, apply: ({ unit }) => reminder(unit, 'Debilitating Saliva', 'An enemy within 8" declaring a ranged attack gets DEBUFF Hit (1).') },
};

/** A unit that may gain the Burrowed Status: not a Structure, and not one whose card forbids it (Roachlings). */
const canBurrow = (pu: PlayerUnit): boolean => !pu.summoned && !playerUnitDef(pu).abilities.some((a) => a.name === 'Underdeveloped Claws' || a.name === 'Structure');

function hasStayInPlayCreep(state: GameState): boolean {
  return (state.playerCards ?? []).some((c) => c.defId === 'malignant_creep' || c.defId === 'accelerating_creep');
}

// ------------------------------------------------------------------ card boosts

const activeIs = (pred: (pu: PlayerUnit) => boolean, label: string) => ({ needsUnit: pred, targetHint: label });
const firstWeapon = (source: string, text: string, mods: EffectMods, pred: (pu: PlayerUnit) => boolean = () => true, label = 'the active unit', needs?: (ctx: AbilityContext) => string | null): AbilitySpec => ({
  target: 'self',
  ...activeIs(pred, label),
  automated: true,
  apply: (ctx) => { const why = needs?.(ctx); if (why) return why; addEffect(ctx.unit!, source, text, mods, 'firstWeapon'); return `${source}: ${ctx.unit!.name}. ${text}`; },
});
/** Stationary: no model of the unit has moved, been moved or been PLACED this Round. */
export const isStationary = (state: GameState, u: { movedRound?: number }): boolean => u.movedRound !== state.round;
const dropPoint = (source: string): AbilitySpec => ({
  target: 'point',
  targetHint: 'a spot more than 10" from every enemy',
  automated: true,
  apply: ({ state, point }) => {
    if (nearestEnemyDist(state, point!) <= 10) return '!Must be more than 10" from every enemy model.';
    addToken(state, 'dropPoint', point!, source);
    return `${source}: drop point set. At the end of the round you may deploy one Ground unit in base contact with it.`;
  },
});
const detector = (source: string): AbilitySpec => ({
  target: 'point',
  targetHint: 'anywhere on the battlefield',
  automated: true,
  apply: ({ state, point }) => { addToken(state, 'indicator', point!, source); return `${source}: enemy units within 6" lose HIDDEN.`; },
});
const armourBoost = (source: string, pred: (pu: PlayerUnit) => boolean): AbilitySpec => ({
  target: 'none',
  automated: false,
  apply: () => `!Use ${source} while rolling saves against an AI attack.`,
  needsUnit: pred,
});
const creepSpread = (source: string): AbilitySpec => ({
  target: 'point',
  targetHint: 'within 6" of your entry edge or an existing Creep Tumor',
  automated: true,
  apply: ({ state, point }) => {
    const p = point!;
    const t = state.terrain.table;
    const nearEdge = playerSegments(state.deployment).some((s) => dist(closestOnSegment(s, t, p), p) <= 6);
    const nearTumor = (state.tokens ?? []).some((k) => k.kind === 'creepTumor' && dist(k, p) <= 6);
    if (!nearEdge && !nearTumor) return '!Within 6" of your entry edge or an existing Creep Tumor.';
    addToken(state, 'creepTumor', p, 'Creep Tumor', { stayInPlay: hasStayInPlayCreep(state) });
    return `${source}: Creep Tumor set.`;
  },
});
const toReserves = (source: string): AbilitySpec => ({
  target: 'self',
  ...activeIs((pu) => pu.location === 'table' && !pu.engaged && isGround(pu), 'the active unengaged Ground unit'),
  automated: true,
  apply: ({ unit, state }) => {
    const pu = unit!;
    pu.location = 'reserves';
    // A unit returned to Reserves loses SIEGE MODE.
    pu.statuses = (pu.statuses ?? []).filter((x) => x !== 'Siege Mode');
    pu.engaged = false;
    pu.engagedWith = [];
    if (state.sense) delete state.sense.players[pu.id];
    const key = state.phase === 'scoring' ? null : state.phase;
    if (key) pu.activated[key] = true;
    return `${source}: ${pu.name} returns to Reserves.`;
  },
});
const anyEdgeDeploy = (source: string, pred: (pu: PlayerUnit) => boolean, label: string, /** "Cannot be used if another Friendly … Unit has already Deployed this Round": which units count. */ bars?: { who: (pu: PlayerUnit) => boolean; what: string }): AbilitySpec => ({
  target: 'self',
  ...activeIs((pu) => pu.location === 'reserves' && pred(pu), label),
  automated: true,
  apply: ({ unit, state }) => {
    const pu = unit!;
    if (bars && state.playerUnits.some((o) => o.id !== pu.id && !o.summoned && ownerOf(o) === ownerOf(pu) && o.deployedRound === state.round && bars.who(o))) return `!${source} cannot be used: another Friendly ${bars.what} Unit has already Deployed this Round.`;
    pu.deployAnyEdge = true;
    return `${source}: ${pu.name} may deploy from any non-player table edge, more than 10" from enemies.`;
  },
});

export const CARD_BOOSTS: Record<string, AbilitySpec> = {
  'Pylon Warp-In': {
    target: 'point',
    targetHint: 'ground level, more than 10" from every enemy',
    automated: true,
    apply: ({ state, point, owner }) => {
      if (state.playerUnits.some((p) => p.defId === 'pylon' && p.location === 'table' && !p.destroyed && ownerOf(p) === (owner ?? 0))) return '!You already have a Pylon on the battlefield.';
      if (nearestEnemyDist(state, point!) <= 10) return '!Must be more than 10" from every enemy model.';
      summon(state, 'pylon', point!, { owner });
      return 'A Pylon warps in. From next round, a Ground unit may deploy from its base once per round (Warp Conduit).';
    },
  },
  'Omega Network': {
    target: 'point',
    targetHint: 'ground level, more than 10" from every enemy',
    automated: true,
    apply: ({ state, point, owner }) => {
      if (state.playerUnits.some((p) => p.defId === 'omega_worm' && p.location === 'table' && !p.destroyed && ownerOf(p) === (owner ?? 0))) return '!You already have an Omega Worm on the battlefield.';
      if (nearestEnemyDist(state, point!) <= 10) return '!Must be more than 10" from every enemy model.';
      summon(state, 'omega_worm', point!, { owner });
      return 'An Omega Worm bursts up. It is a Source of Creep and an entry point for up to 2 Supply per round.';
    },
  },
  'Rapid Ingress': {
    target: 'point',
    targetHint: 'more than 1" from every enemy',
    automated: true,
    apply: ({ state, point, owner }) => {
      if (nearestEnemyDist(state, point!) <= 1) return '!More than 1" from every enemy model.';
      summon(state, 'point_defense_drone', point!, { expires: true, owner });
      return 'Point Defence Drone set until the end of the round: the first ranged attack at a friendly unit within 4" loses 2 dice.';
    },
  },
  'Creep Spread': creepSpread('Creep Spread'),
  'Excrete Creep': creepSpread('Excrete Creep'),
  Surveillance: detector('Surveillance'),
  'Scanner Sweep': detector('Scanner Sweep'),
  'Oversight Mode': detector('Oversight Mode'),
  'Warp Conduit': dropPoint('Warp Conduit'),
  'Ventral Sacs': dropPoint('Ventral Sacs'),
  'Ready For Dust-off': dropPoint('Ready For Dust-off'),
  'Ground Weapons': firstWeapon('Ground Weapons', 'First ranged weapon gains CRITICAL HIT (1).', { critical: 1, weaponPhase: 'Assault' }, isGround, 'the active Ground unit'),
  'Infantry Weapons': firstWeapon('Infantry Weapons', 'First ranged weapon gains CRITICAL HIT (1).', { critical: 1, weaponPhase: 'Assault' }, isBio, 'the active Biological unit'),
  'Vehicle Weapons': firstWeapon('Vehicle Weapons', 'First ranged weapon gains CRITICAL HIT (1).', { critical: 1, weaponPhase: 'Assault' }, isMech, 'the active Mechanical unit'),
  'Quick Strikes': firstWeapon('Quick Strikes', 'First close combat weapon gains PRECISION (2).', { precision: 2, weaponPhase: 'Combat' }),
  'Feral Rage': firstWeapon('Feral Rage', 'First close combat weapon gains PRECISION (2).', { precision: 2, weaponPhase: 'Combat' }),
  'Ancient Pride': firstWeapon('Ancient Pride', 'First weapon gains INSTANT.', { instant: true }),
  'Missile Attacks': firstWeapon('Missile Attacks', 'First ranged weapon gains PRECISION (1).', { precision: 1, weaponPhase: 'Assault' }),
  "Let's Have a Blast!": firstWeapon("Let's Have a Blast!", 'First ranged weapon gains ANTI-EVADE (1).', { antiEvade: 1, weaponPhase: 'Assault' }, isBio, 'the active Biological unit'),
  'Weapons of the Firstborn': firstWeapon('Weapons of the Firstborn', 'First ranged weapon gains +4" range.', { rangeBuff: 4, weaponPhase: 'Assault' }, isGround, 'the active Ground unit'),
  Predation: { target: 'self', automated: true, apply: ({ unit }) => { addEffect(unit!, 'Predation', 'Close combat weapons gain INSTANT this round.', { instant: true, weaponPhase: 'Combat' }); return `Predation: ${unit!.name}'s close combat weapons gain INSTANT.`; } },
  'Extended Claws': { target: 'self', automated: true, apply: ({ unit }) => { addEffect(unit!, 'Extended Claws', '+1 to IMPACT hit rolls this round.', { impactHit: 1 }); return `Extended Claws: ${unit!.name} +1 to IMPACT hit rolls.`; } },
  'Wild Mutation': {
    target: 'self',
    automated: true,
    apply: ({ unit, state }) => {
      if (!onCreep(state, unit!)) return '!The active unit must be ON CREEP.';
      addEffect(unit!, 'Wild Mutation', '+1 Speed this round.', { speed: 1 });
      addEffect(unit!, 'Wild Mutation (weapon)', 'First weapon gains PRECISION (1).', { precision: 1 }, 'firstWeapon');
      return `Wild Mutation: ${unit!.name} +1 Speed and PRECISION (1) on its first weapon.`;
    },
  },
  'Go! Go! Go!': { target: 'self', ...activeIs((pu) => isBio(pu) && pu.location === 'table', 'the active Biological unit'), automated: true, apply: ({ unit }) => { if (unit!.engaged) return '!An Engaged Unit cannot perform a Move action.'; if ((unit!.statuses ?? []).includes('Siege Mode')) return '!A Unit in SIEGE MODE cannot perform a Move action.'; unit!.bonusMove = 2; return `Go! Go! Go!: ${unit!.name} may make a free 2" Move.`; } },
  'Zealous Charge': { target: 'self', automated: true, apply: ({ unit }) => { addEffect(unit!, 'Zealous Charge', '+2 Speed this round.', { speed: 2 }); return `Zealous Charge: ${unit!.name} +2 Speed.`; } },
  Phase: { target: 'self', ...activeIs((pu) => pu.location === 'table', 'the active unit'), automated: true, apply: ({ unit }) => { unit!.placeRange = 3; unit!.placeNoEngage = false; unit!.placeAsAction = false; return `Phase: ${unit!.name} may be PLACEd up to 3".`; } },
  'Ready for Pickup?': {
    target: 'self', once: 'game', ...activeIs((pu) => pu.location === 'table', 'the active unit'), automated: true,
    apply: ({ unit, state }) => {
      const pu = unit!;
      // It resolves instead of a standard action: the unit must still have its action this Phase.
      if (state.phase !== 'scoring' && pu.activated[state.phase]) return `!${pu.name} has already taken its action this Phase.`;
      pu.placeRange = 12; pu.placeNoEngage = true; pu.placeAsAction = true;
      return `Ready for Pickup?: ${pu.name} may be PLACEd up to 12", but not within Engagement Range. This replaces its action.`;
    },
  },
  'Field Repair': { target: 'self', ...activeIs(isMech, 'the active Mechanical unit'), automated: true, apply: ({ unit }) => `Field Repair: ${unit!.name} repairs ${heal(unit!, 2)} damage.` },
  // ---- Cards that came with the Immortal, Siege Tank and Ravager ---------------------------------------------
  "Pound 'em Flat!": firstWeapon("Pound 'em Flat!", 'Its first ranged weapon gains PRECISION (2).', { precision: 2, weaponPhase: 'Assault' }, isMech, 'the active Mechanical unit', ({ unit, state }) => (isStationary(state, unit!) ? null : '!The active Unit has moved this Round: it has lost the Stationary Status.')),
  'Spawn Larva': {
    target: 'self',
    ...activeIs((pu) => isBio(pu) && playerUnitDef(pu).stats.size === 1 && !(playerUnitDef(pu).tags as string[]).includes('Unique'), 'the active non-Unique Biological unit of Size 1'),
    automated: true,
    apply: ({ unit }) => { const back = respawn(unit!, 2); return `Spawn Larva: ${back} model${back === 1 ? '' : 's'} crawl back into ${unit!.name} (RESPAWN 2).`; },
  },
  'Ravager Morph': {
    target: 'self',
    once: 'game',
    ...activeIs((pu) => /roach/i.test(pu.defId), 'the active Roach unit'),
    automated: true,
    apply: ({ state, unit }) => {
      const pu = unit!;
      if (pu.models < 1) return '!There is no model left to morph.';
      const at = state.sense?.players[pu.id]?.[pu.models - 1] ?? state.sense?.players[pu.id]?.[0];
      if (!at) return '!The Roaches must be on the battlefield.';
      // MORPH (Name): one model becomes the new unit, in base contact, and cannot act again this round.
      const born = summon(state, 'ravager', at, { owner: pu.owner });
      born.summoned = false;
      born.name = 'Ravager';
      if (pu.models === 1) { pu.destroyed = true; pu.location = 'destroyed'; if (state.sense) delete state.sense.players[pu.id]; }
      else { pu.models -= 1; syncModelPositions(state, 'players', pu.id); }
      return `Ravager Morph: a Roach swells into a Ravager. It cannot be activated again this round.`;
    },
  },
  'Darkness Descends': {
    target: 'self',
    ...activeIs(isBio, 'the active Biological unit'),
    automated: true,
    apply: ({ unit, state }) => { unit!.statuses = [...new Set([...(unit!.statuses ?? []), 'Hidden' as const])]; unit!.hiddenThroughRound = state.round; return `Darkness Descends: ${unit!.name} is HIDDEN until the end of the round.`; },
  },
  "Anakh Su'n": {
    target: 'self',
    automated: true,
    apply: ({ unit }) => { unit!.statuses = [...new Set([...(unit!.statuses ?? []), 'Hidden' as const])]; return `Anakh Su'n: ${unit!.name} is HIDDEN until it performs another action.`; },
  },
  'Might Of The Nerazim': {
    target: 'friendly',
    targetHint: 'the friendly unit that just lost HIDDEN',
    automated: true,
    apply: ({ friendly }) => {
      addEffect(friendly!, 'Might Of The Nerazim', '+2 Speed this round.', { speed: 2 });
      addEffect(friendly!, 'Might Of The Nerazim: strike', 'First weapon used gains CRITICAL HIT (2).', { critical: 2 }, 'firstWeapon');
      return `Might Of The Nerazim: ${friendly!.name} gains +2 Speed and CRITICAL HIT (2) on its first weapon.`;
    },
  },
  'Personal Transport': {
    target: 'self',
    ...activeIs((pu) => !pu.engaged && isGround(pu), 'the active, unengaged Ground unit'),
    automated: true,
    apply: ({ state, unit }) => {
      const pu = unit!;
      if (pu.engaged) return '!It cannot be picked up while it is engaged.';
      pu.location = 'reserves';
      pu.statuses = (pu.statuses ?? []).filter((x) => x !== 'Siege Mode');
      pu.engagedWith = [];
      pu.activated = { ...pu.activated, movement: false };
      if (state.sense) delete state.sense.players[pu.id];
      return `Personal Transport: ${pu.name} is back in Reserves and may deploy again now.`;
    },
  },
  'Veil of Shadows': { target: 'self', automated: true, apply: ({ unit }) => `Veil of Shadows: ${unit!.name} heals ${heal(unit!, 2)} damage.` },
  'Strategic Recall': toReserves('Strategic Recall'),
  'Strap in!': toReserves('Strap in!'),
  'Mass Recall': {
    target: 'point',
    once: 'game',
    targetHint: 'any spot. Protoss Units within 6" of it return to Reserves',
    automated: true,
    apply: ({ state, point }) => {
      const back = state.playerUnits.filter((pu) => pu.location === 'table' && !pu.summoned && playerUnitDef(pu).faction === 'Protoss' && (() => { const q = unitPos(state, pu); return !!q && dist(q, point!) <= 6; })());
      for (const pu of back) { pu.location = 'reserves'; pu.engaged = false; pu.engagedWith = []; pu.statuses = (pu.statuses ?? []).filter((x) => x !== 'Siege Mode'); if (state.sense) delete state.sense.players[pu.id]; }
      return `Mass Recall: ${back.map((b) => b.name).join(', ') || 'no units'} return${back.length === 1 ? 's' : ''} to Reserves.`;
    },
  },
  'Warp In': anyEdgeDeploy('Warp In', isGround, 'a Ground unit in Reserves', { who: isGround, what: 'Ground' }),
  'Armed and Ready': anyEdgeDeploy('Armed and Ready', isBio, 'a Biological unit in Reserves', { who: isBio, what: 'Biological' }),
  'Timing Push': anyEdgeDeploy('Timing Push', (pu) => /zergling/i.test(pu.defId), 'a Zergling unit in Reserves'),
  'Tactical Retreat': { target: 'self', automated: true, apply: ({ unit }) => { addEffect(unit!, 'Tactical Retreat', 'Ignores the Disengage penalty this round.', { ignoreDisengage: true }); unit!.disengagedThisRound = false; return `Tactical Retreat: ${unit!.name} ignores the Disengage penalty.`; } },
  'Terran Tenacity': { target: 'none', once: 'game', automated: true, apply: ({ state }) => {
    state.firstPlayer = 'players';
    // Nobody else may claim it for the rest of this phase (passing first does not take it back).
    state.nextFirstPlayer = 'players';
    // Claimed as the phase opens, before anyone has gone: you go first in it.
    if (state.step.kind === 'PHASE_START') state.turn = 'players';
    return 'Terran Tenacity: you claim the First Player Marker.';
  } },
  'Bound by the Khala': { target: 'none', automated: false, apply: () => 'Bound by the Khala: after this activation, activate another friendly Unit at once, before the AI takes its turn.' },
  'Lie in Wait': { target: 'self', ...activeIs((pu) => pu.location === 'table' && !pu.engaged && isGround(pu) && canBurrow(pu), 'the active unengaged Ground unit'), automated: true, apply: ({ unit }) => { unit!.statuses = [...new Set([...(unit!.statuses ?? []), 'Burrowed' as const])]; return `Lie in Wait: ${unit!.name} burrows.`; } },
  'Rapid Burrowing': { target: 'friendly', targetHint: 'a friendly, unengaged Ground Zerg unit on the battlefield', automated: true, friendlyFilter: (pu) => pu.location === 'table' && !pu.engaged && isGround(pu) && playerUnitDef(pu).faction === 'Zerg' && canBurrow(pu), apply: ({ friendly }) => { friendly!.statuses = [...new Set([...(friendly!.statuses ?? []), 'Burrowed' as const])]; return `Rapid Burrowing: ${friendly!.name} burrows.`; } },
  'Nasty Surprise': { target: 'self', automated: true, apply: ({ unit }) => { unit!.statuses = (unit!.statuses ?? []).filter((s) => s !== 'Burrowed'); return `Nasty Surprise: ${unit!.name} unburrows.`; } },
  'Additional Supply Depots': { target: 'self', automated: true, apply: ({ unit }) => { addEffect(unit!, 'Additional Supply Depots', '+1 Supply for markers and objectives this round.', { supplyBonus: 1 }); return `Additional Supply Depots: ${unit!.name} +1 Supply for markers.`; } },
  'Gravitic Boosters': { target: 'self', automated: true, apply: ({ unit }) => { addEffect(unit!, 'Gravitic Boosters', '+1" to the next charge distance.', { chargeBonus: 1 }, 'charge'); return `Gravitic Boosters: ${unit!.name} +1" on its next charge.`; } },
  'Pneumatized Carapace': chargeTwoDice('Pneumatized Carapace'),
  'ComSat Station': { target: 'none', automated: false, apply: () => 'ComSat Station: pick a non-player table edge. Enemy Units cannot deploy from it this round.' },
  'Photon Overcharge': { target: 'none', automated: false, apply: () => 'Photon Overcharge: an enemy entering from somewhere other than its own entry edge suffers HITS 3 (1).' },
  'Advanced Training': { target: 'none', automated: false, apply: () => 'Advanced Training: the next Support unit CP ability this round costs 1 less.' },
  'Guardian Shell': armourBoost('Guardian Shell', isGround),
  'Ground Armor': armourBoost('Ground Armor', isGround),
  'Infantry Armor': armourBoost('Infantry Armor', isBio),
  'Vehicle Plating': armourBoost('Vehicle Plating', isMech),
  Carapace: armourBoost('Carapace', () => true),
  'Dae’Uhl': armourBoost('Dae’Uhl', () => true),
  'Brood Instinct': armourBoost('Brood Instinct', () => true),
};

/** Boosts offered in the saves panel: TOUGH saves or damage reduction. */
export const SAVE_BOOSTS: Record<string, { tough?: number; reduce?: number; dodge?: number; minDamage?: number; /** +X to the Evade Roll: offered only when the unit makes one. */ evadeBonus?: number; filter: (pu: PlayerUnit) => boolean; text: string }> = {
  'Ground Armor': { tough: 1, filter: isGround, text: 'TOUGH (1): one failed save succeeds.' },
  'Infantry Armor': { tough: 1, filter: isBio, text: 'TOUGH (1): one failed save succeeds.' },
  'Vehicle Plating': { tough: 1, filter: isMech, text: 'TOUGH (1): one failed save succeeds.' },
  Carapace: { tough: 1, filter: () => true, text: 'TOUGH (1): one failed save succeeds.' },
  'Guardian Shell': { dodge: 2, filter: isGround, text: 'DODGE (2): up to 2 Surge/Critical hits go back to the Armour pool.' },
  'Dae’Uhl': { reduce: 2, minDamage: 1, filter: () => true, text: 'Reduce the total damage by 2 (minimum 1).' },
  'Plasma Shields': { tough: 1, dodge: 1, filter: (pu) => isMech(pu) && isGround(pu) && isShielded(pu), text: 'TOUGH (1) and DODGE (1) while it is still Shielded.' },
  'Brood Instinct': { evadeBonus: 1, filter: () => true, text: 'A +1 Modifier to the Evade Roll.' },
};

// ------------------------------------------------------------------ queries

/** Ready cards with a save boost this unit could use before its Armour roll. */
export function saveBoostOptions(state: GameState, pu: PlayerUnit): { card: PlayerCard; name: string }[] {
  return readyCards(state).flatMap((c) => {
    const b = cardDef(c.defId)?.boosts.find((x) => SAVE_BOOSTS[x.name]?.filter(pu));
    return b ? [{ card: c, name: b.name }] : [];
  });
}

export function cardDef(id: string): CardDef | undefined {
  return CARDS.find((c) => c.id === id);
}

/** Which player fields this unit. Every one-player game is player 0, whether the field is set or not. */
export const ownerOf = (pu: { owner?: number }): number => pu.owner ?? 0;

/** The resource a player spends: their own faction's, so two players at one table may spend different ones. */
export function playerResource(state: GameState, owner?: number): Resource {
  const mine = state.playerUnits.filter((p) => !p.summoned && (owner === undefined || ownerOf(p) === owner));
  const f = mine.length ? playerUnitDef(mine[0]!).faction : 'Terran';
  return RESOURCE_OF[f] ?? 'CP';
}

/** Cards a player can still Exhaust. Without an owner, every player's — for counting, not for paying. */
export function readyCards(state: GameState, owner?: number): PlayerCard[] {
  return (state.playerCards ?? []).filter((c) => !c.exhausted && (owner === undefined || ownerOf(c) === owner));
}

/** The cards a player brought, Ready or not. */
export function cardsOf(state: GameState, owner?: number): PlayerCard[] {
  return (state.playerCards ?? []).filter((c) => owner === undefined || ownerOf(c) === owner);
}

/** Pick Ready cards to pay `amount`, preferring cards without boosts you might want, then smallest value. */
export function autoPay(state: GameState, amount: number, keep: string[] = [], owner?: number): PlayerCard[] | null {
  if (amount <= 0) return [];
  const cards = readyCards(state, owner).filter((c) => !keep.includes(c.id) && (cardDef(c.defId)?.resource ?? 0) > 0);
  // Spend cards whose boosts you are least likely to want later: save boosts (Armour, Dae'Uhl) go last.
  const worth = (c: PlayerCard) => (cardDef(c.defId)?.boosts ?? []).reduce((a, b) => a + (SAVE_BOOSTS[b.name] ? 2 : CARD_BOOSTS[b.name]?.automated ? 1 : 0), 0);
  cards.sort((a, b) => worth(a) - worth(b) || (cardDef(a.defId)?.resource ?? 0) - (cardDef(b.defId)?.resource ?? 0));
  const out: PlayerCard[] = [];
  let sum = 0;
  for (const c of cards) {
    if (sum >= amount) break;
    out.push(c);
    sum += cardDef(c.defId)?.resource ?? 0;
  }
  if (sum < amount) return null;
  // Never exhaust a card the cost does not need: one card worth 2 covers what two worth 1 were picked for. The
  // cards we would rather keep are last, so they are the first offered back.
  let picked = out;
  for (const c of out.slice().reverse()) {
    const rest = picked.filter((x) => x !== c);
    if (rest.reduce((a, x) => a + (cardDef(x.defId)?.resource ?? 0), 0) >= amount) picked = rest;
  }
  return picked;
}

/** A card in a payment that the cost does not need, because the others already cover it. */
export function sparePayCard(state: GameState, cardIds: string[], cost: number): PlayerCard | null {
  for (const id of cardIds) {
    if (payValue(state, cardIds.filter((x) => x !== id)) >= cost) return (state.playerCards ?? []).find((c) => c.id === id) ?? null;
  }
  return null;
}

/**
 * Click a card while paying: picked, or unpicked if it was already picked. A new card never stacks on top of a
 * cost that is already covered — whatever the cost no longer needs is handed back, so you can never exhaust
 * three cards for a cost of one.
 */
export function pickForPay(state: GameState, picked: string[], id: string, cost: number): string[] {
  if (picked.includes(id)) return picked.filter((x) => x !== id);
  let out = [...picked, id];
  for (const other of picked) {
    if (payValue(state, out.filter((x) => x !== other)) >= cost) out = out.filter((x) => x !== other);
  }
  return out;
}

export function payValue(state: GameState, cardIds: string[]): number {
  return cardIds.reduce((a, id) => a + (cardDef((state.playerCards ?? []).find((c) => c.id === id)?.defId ?? '')?.resource ?? 0), 0);
}

export interface UsableAbility {
  ability: AbilityDef;
  spec: AbilitySpec | undefined;
  cost: number;
  ok: boolean;
  reason?: string;
}

/** Abilities on the unit's card, with whether each can be used right now. */
export function unitAbilities(state: GameState, pu: PlayerUnit): UsableAbility[] {
  const def = playerUnitDef(pu);
  const out: UsableAbility[] = [];
  for (const ab of def.abilities) {
    if (ab.upgradeCost && !pu.upgrades.includes(ab.id)) continue;
    const spec = UNIT_ABILITIES[ab.name];
    // An ability resolved in several steps (one Corrosive Bile token for each model) is paid for once.
    const more = pu.pendingUses?.name === ab.name && pu.pendingUses.left > 0;
    const cost = more ? 0 : abilityCost(state, pu, ab).cost;
    let reason: string | undefined;
    if (ab.kind === 'Passive') reason = 'Passive';
    else if (PROMPTED_REACTIONS.has(ab.name)) reason = 'Offered when it triggers';
    else if (!spec) reason = 'Resolve on the table';
    else if (pu.location !== 'table') reason = 'On the battlefield only';
    else if (pu.summoned) reason = 'Structures cannot activate';
    else if (state.step.kind !== 'PLAYERS_TURN' && ab.kind === 'Active') reason = 'On your turn';
    else if (ab.kind === 'Active' && state.activeUnitId && state.activeUnitId !== pu.id) reason = 'Another unit is active';
    else if (ab.kind === 'Active' && state.phase !== 'scoring' && pu.activated[state.phase] && state.activeUnitId !== pu.id) reason = 'Already acted this phase';
    else if (ab.phase !== 'Any' && ab.phase.toLowerCase() !== state.phase) reason = `${ab.phase} phase`;
    else if (!spec.repeatable && !more && (pu.used ?? []).includes(ab.name)) reason = 'Used this round';
    else if (spec.once === 'game' && (pu.usedGame ?? []).includes(ab.name)) reason = 'Used this game';
    else if (cost > 0 && !autoPay(state, cost, [], ownerOf(pu))) reason = `Needs ${cost} ${playerResource(state, ownerOf(pu))}`;
    out.push({ ability: ab, spec, cost, ok: !reason, reason });
  }
  return out;
}

/**
 * Reactions the game offers at the moment they trigger (engine/player/reactions, and the saves step for the ones
 * that answer an attack on the unit), never from the command card, where they would be spent for nothing.
 */
export const PROMPTED_REACTIONS = new Set([
  "Hierarch’s Stand", 'Lightning Dash', 'Hallucination', 'Debilitating Saliva', 'Lunge', 'Concussive Shells',
  'Life Support', 'Transfusion', 'Zealous Round', 'Shield Overcharge', 'Improved Barrier', 'Prophetic Vision',
]);

/**
 * What an ability costs this unit right now, after the reductions its army gives it: Khalai Ingenuity (a Friendly
 * Pylon Within 4", once per Round, 1 less PE), Psionic Link (the Queen's own abilities with 7 Friendly models Within
 * 6", once per Round), Advanced Training (an Academy: a Support unit's CP ability, once per Round) and Raiders Roll!
 * (Stimpack as the Raiders deploy). `commit` marks the once-per-Round reductions as used: call it when the cost is paid.
 */
export function abilityCost(state: GameState, pu: PlayerUnit, ab: AbilityDef, optionCost?: number): { cost: number; notes: string[]; commit: () => void } {
  const base = optionCost ?? (ab.cost ? (ab.cost.amount === 'X' ? 1 : ab.cost.amount) : 0);
  let cost = base;
  const notes: string[] = [];
  const marks: (() => void)[] = [];
  const res = ab.cost?.resource;
  const owner = ownerOf(pu);
  if (cost > 0 && res === 'CP' && ab.name === 'Stimpack' && hasAbility(pu, 'Raiders Roll!') && pu.deployedRound === state.round && state.activeUnitId === pu.id && state.phase === 'movement' && !(pu.used ?? []).includes('Raiders Roll!')) {
    cost -= 1; notes.push('Raiders Roll!'); marks.push(() => { pu.used = [...(pu.used ?? []), 'Raiders Roll!']; });
  }
  if (cost > 0 && res === 'PE') {
    const pylon = state.playerUnits.find((o) => o.defId === 'pylon' && o.location === 'table' && !o.destroyed && ownerOf(o) === owner && (o.deployedRound ?? 0) < state.round && !(o.used ?? []).includes('Khalai Ingenuity')
      && (() => { const a = unitShapes(state, 'players', o.id), b = unitShapes(state, 'players', pu.id); return a.length > 0 && b.length > 0 && a.some((x) => b.some((y) => edgeDistance(x, y) <= 4.05)); })());
    if (pylon) { cost -= 1; notes.push('Khalai Ingenuity'); marks.push(() => { pylon.used = [...(pylon.used ?? []), 'Khalai Ingenuity']; }); }
  }
  if (cost > 0 && res === 'BM' && hasAbility(pu, 'Psionic Link') && !(pu.used ?? []).includes('Psionic Link')) {
    const me = unitShapes(state, 'players', pu.id);
    const near = state.playerUnits.filter((o) => o.id !== pu.id && o.location === 'table' && !o.destroyed).flatMap((o) => unitShapes(state, 'players', o.id)).filter((m) => me.some((q) => edgeDistance(m, q) <= 6.05)).length;
    if (near >= 7) { cost -= 1; notes.push('Psionic Link'); marks.push(() => { pu.used = [...(pu.used ?? []), 'Psionic Link']; }); }
  }
  if (cost > 0 && res === 'CP' && playerUnitDef(pu).role === 'Support') {
    const academy = (state.playerCards ?? []).find((c) => ownerOf(c) === owner && c.usedRound !== state.round && !!cardDef(c.defId)?.boosts.some((b) => b.name === 'Advanced Training'));
    if (academy) { cost -= 1; notes.push('Advanced Training'); marks.push(() => { academy.usedRound = state.round; }); }
  }
  return { cost: Math.max(0, cost), notes, commit: () => marks.forEach((m) => m()) };
}

export interface UsableBoost {
  card: PlayerCard;
  def: CardDef;
  boost: { name: string; text: string };
  spec: AbilitySpec | undefined;
  ok: boolean;
  reason?: string;
}

/**
 * Terran Tenacity, offered as a phase opens while the AI holds the First Player Marker: the card that has it,
 * ready and not yet used this game, or null.
 */
export function tenacityOffer(state: GameState): PlayerCard | null {
  // Terran Tenacity is an Active ability of the Movement Phase.
  if (state.step.kind !== 'PHASE_START' || state.firstPlayer !== 'ai' || state.phase !== 'movement') return null;
  return (state.playerCards ?? []).find((c) => !c.exhausted && !(c.usedGame ?? []).includes('Terran Tenacity') && !!cardDef(c.defId)?.boosts.some((b) => b.name === 'Terran Tenacity')) ?? null;
}

/** A card ability with a Phase Limitation can be used only in that Phase (Part 10.1). */
export function boostPhaseProblem(state: GameState, boost: { phase?: string }): string | undefined {
  return boost.phase && boost.phase !== 'Any' && boost.phase.toLowerCase() !== state.phase ? `${boost.phase} phase` : undefined;
}

export function cardBoosts(state: GameState, active: PlayerUnit | null): UsableBoost[] {
  const out: UsableBoost[] = [];
  for (const card of state.playerCards ?? []) {
    const def = cardDef(card.defId);
    if (!def) continue;
    for (const boost of def.boosts) {
      const spec = CARD_BOOSTS[boost.name];
      let reason: string | undefined;
      const wrongPhase = boostPhaseProblem(state, boost);
      if (card.exhausted) reason = 'Exhausted';
      // Another player's card: theirs to play, on their own units.
      else if (active && ownerOf(card) !== ownerOf(active)) reason = `Player ${ownerOf(card) + 1}'s card`;
      else if (boost.kind === 'Passive') reason = 'Passive';
      else if (wrongPhase && boost.kind !== 'Reaction') reason = wrongPhase;
      else if (!spec) reason = 'Resolve on the table';
      else if (SAVE_BOOSTS[boost.name]) reason = 'Used while rolling saves';
      else if (spec.once === 'game' && (card.usedGame ?? []).includes(boost.name)) reason = 'Used this game';
      else if (spec.target === 'self' && !active) reason = 'Select the active unit first';
      else if (spec.needsUnit && active && !spec.needsUnit(active)) reason = `Needs ${spec.targetHint ?? 'a different unit'}`;
      else if (spec.target === 'self' && active && state.step.kind === 'PLAYERS_TURN' && state.phase !== 'scoring' && active.activated[state.phase] && state.activeUnitId !== active.id && !/Veil|Field Repair/.test(boost.name)) reason = 'That unit already acted';
      out.push({ card, def, boost, spec, ok: !reason, reason });
    }
  }
  return out;
}

// ------------------------------------------------------------------ effects in the rules

export function activeEffects(pu: PlayerUnit): UnitEffect[] {
  return pu.effects ?? [];
}

/** Speed including buffs. */
export function effectiveSpeed(pu: PlayerUnit, state?: GameState): number {
  const base = speedFor(playerUnitDef(pu), pu.models);
  let speed = base + activeEffects(pu).reduce((a, e) => a + (e.mods.speed ?? 0), 0);
  // ON CREEP: Creep Speed (+2, the Queen's upgrade) and Speed on Creep (+1, the Accelerating Creep card).
  if (state && base > 0 && onCreep(state, pu)) {
    if (hasAbility(pu, 'Creep Speed')) speed += 2;
    if (cardsOf(state, ownerOf(pu)).some((c) => !!cardDef(c.defId)?.boosts.some((b) => b.name === 'Speed on Creep'))) speed += 1;
  }
  return speed;
}

function effectAppliesTo(e: UnitEffect, w: WeaponProfile, targetDist: number | null): boolean {
  if (e.mods.weaponPhase && e.mods.weaponPhase !== w.phase) return false;
  if (e.mods.weapons && !e.mods.weapons.some((n) => w.name.toLowerCase().includes(n.toLowerCase()))) return false;
  if (e.mods.within !== undefined && (targetDist === null || targetDist > e.mods.within)) return false;
  return true;
}

/** The weapon as modified by the unit's effects (and target debuffs), plus the one-shot effects it spends. */
/** The Blast Template's radius, in inches (a 3" template). */
export const BLAST_RADIUS_IN = 1.5;

/** One unit's models under a Blast Template. */
export interface BlastHit { side: 'ai' | 'players'; id: string; models: number }

/** Size 2 or larger terrain on the line from the Target Point to a model: that model is not affected (Part 8.7.6). */
function templateBlocked(state: GameState, a: Pt, b: Pt): boolean {
  return state.terrain.pieces.some((t) => t.size >= 2 && !isHighGround(t) && pieceParts(t).some((r) => segmentHitsRect(pieceLocal(a, r), pieceLocal(b, r), r)));
}

/**
 * A Blast Template set over the target Unit (Part 8.7.6): centred on the model of the target that puts the most of
 * its Unit under it (the attacker's choice; on a tie, the one nearest the attacker). A model is affected when its
 * base is partly or wholly covered, it stands on the Target Point's elevation, no Size 2+ terrain stands between
 * the Target Point and it, and it is a type the weapon can hit (Ground or Flying). Returns the Target Point, the
 * models of the target it covers, and every other Unit's covered models (Spillover, Friendly or Enemy).
 */
export function blastTemplate(state: GameState, targetSide: 'ai' | 'players', targetId: string, from: Pt | null, weaponTarget: 'All' | 'Ground' | 'Flying' = 'Ground'): { centre: Pt | null; main: number; spill: BlastHit[] } {
  const shapes = unitShapes(state, targetSide, targetId);
  if (!shapes.length) return { centre: null, main: 1, spill: [] };
  const affected = (sh: Shape, centre: Shape) => edgeToPoint(sh, centre) <= BLAST_RADIUS_IN + 0.01
    && sameElevationAsMarker(state, sh, centre)
    && (Math.hypot(sh.x - centre.x, sh.y - centre.y) < 0.01 || !templateBlocked(state, centre, sh));
  const covering = (c: Shape) => shapes.filter((sh) => affected(sh, c)).length;
  const centre = shapes.reduce((best, c) => {
    const d = covering(c) - covering(best);
    if (d !== 0) return d > 0 ? c : best;
    return from && dist(c, from) < dist(best, from) ? c : best;
  });
  const main = Math.max(1, covering(centre));
  const flyingOk = weaponTarget !== 'Ground';
  const groundOk = weaponTarget !== 'Flying';
  const spill: BlastHit[] = [];
  const consider = (side: 'ai' | 'players', id: string, defId: string) => {
    if (side === targetSide && id === targetId) return;
    const flying = (unitById(defId).tags as string[]).includes('Flying');
    if (flying ? !flyingOk : !groundOk) return;
    const n = unitShapes(state, side, id).filter((sh) => affected(sh, centre)).length;
    if (n) spill.push({ side, id, models: n });
  };
  for (const u of state.army.units) if (u.location === 'table') consider('ai', u.id, u.defId);
  for (const p of state.playerUnits) if (p.location === 'table' && !p.destroyed) consider('players', p.id, p.defId);
  return { centre: { x: centre.x, y: centre.y }, main, spill };
}

/** How many models of a unit a Blast Template covers. */
export function blastCover(state: GameState, target: AiUnitInstance, from: Pt | null): number {
  return blastTemplate(state, 'ai', target.id, from).main;
}

/**
 * The weapon as it is actually fired: the unit's effects, then its own passive abilities and the Blast Template,
 * which needs the battlefield to know what it covers and what the target is standing near.
 */
export function weaponWithEffects(pu: PlayerUnit, w: WeaponProfile, target: AiUnitInstance | null, targetDist: number | null, state?: GameState): { weapon: WeaponProfile; spent: string[]; notes: string[]; /** Models the Blast Template covered: its Surge result, and the dice it adds. */ blast?: number } {
  // The unit's own Passives and upgrades, and the keywords that depend on the target (BURST FIRE, LOCKED IN).
  const tdef = target ? unitById(target.defId) : undefined;
  // Within 3" of a Mission Marker: from the nearest base edge to the marker's edge.
  const mine = state ? unitShapes(state, 'players', pu.id) : [];
  const theirs = state && target ? unitShapes(state, 'ai', target.id) : [];
  const onMarker = (shapes: ReturnType<typeof unitShapes>, m: Pt) => shapes.some((sh) => edgeToPoint(sh, m) - MARKER_RADIUS_IN <= 3.05);
  const fired = firedWeapon(w, {
    def: playerUnitDef(pu),
    upgrades: pu.upgrades,
    statuses: pu.statuses,
    targetDist,
    target: target && tdef ? {
      def: tdef,
      size: (target.statuses ?? []).includes('Burrowed') ? 0 : aiUnitSize(target),
      stationary: !!state && target.location === 'table' && isStationary(state, target),
      engagedWithOtherFriendly: !!state && state.playerUnits.some((o) => o.id !== pu.id && o.location === 'table' && !o.destroyed && o.engagedWith.includes(target.id)),
    } : undefined,
    sharedMarker: !!state && !!target && state.markers.some((m) => onMarker(mine, m) && onMarker(theirs, m)),
    nearShade: !!state && !!target && shadeNear(state, target),
  });
  const keywords = fired.weapon.keywords.map((k) => ({ ...k }));
  let roa = fired.weapon.roa;
  let range = fired.weapon.range;
  let surgeTypes = fired.weapon.surgeTypes.slice() as SurgeType[];
  let surgeDie = fired.weapon.surgeDie;
  const dmg = fired.weapon.dmg;
  const spent: string[] = [];
  const notes: string[] = [...fired.notes];
  for (const e of activeEffects(pu)) {
    if (!effectAppliesTo(e, w, targetDist)) continue;
    const m = e.mods;
    let used = false;
    // Keywords do not stack: the highest value of each counts (Part 2.6.1). A BUFF to RoA or Range adds up.
    if (m.precision) { raiseKeyword(keywords, 'PRECISION', m.precision); used = true; }
    if (m.critical) { raiseKeyword(keywords, 'CRITICAL HIT', m.critical); used = true; }
    if (m.antiEvade) { raiseKeyword(keywords, 'ANTI-EVADE', m.antiEvade); used = true; }
    if (m.instant) { raiseKeyword(keywords, 'INSTANT'); used = true; }
    if (m.roa) { roa += m.roa; used = true; }
    if (m.rangeBuff && range !== 'E') { range = range + m.rangeBuff; used = true; }
    if (m.surgeDie) { surgeDie = m.surgeDie; used = true; }
    if (m.pinpoint) { raiseKeyword(keywords, 'PINPOINT'); used = true; }
    if (m.indirect) { raiseKeyword(keywords, 'INDIRECT FIRE'); used = true; }
    // LOCKED IN gained for this shot: its dice are added when the target has the Stationary Status.
    if (m.lockedIn) {
      raiseKeyword(keywords, 'LOCKED IN', m.lockedIn);
      if (state && target && target.location === 'table' && isStationary(state, target) && !fired.notes.includes('LOCKED IN')) { roa += m.lockedIn; notes.push('LOCKED IN'); }
      used = true;
    }
    if (m.longRange) { raiseKeyword(keywords, 'LONG RANGE', m.longRange); used = true; }
    if (used) {
      notes.push(e.source);
      if (e.until === 'firstWeapon') spent.push(e.id);
    }
  }
  // Goliath Target Lock.
  if (target?.debuffs?.some((d) => d.targetLock) && /autocannon/i.test(w.name)) {
    surgeTypes = ['Light', 'Armoured'];
    surgeDie = 'D3+1';
    notes.push('Target Lock');
  }
  // Zeratul's mark: the unit he has sentenced dies to his blade.
  if (w.phase === 'Combat' && target?.debuffs?.some((d) => d.sentenced) && hasAbility(pu, 'Sentenced to Death')) { raiseKeyword(keywords, 'CRITICAL HIT', 2); notes.push('Sentenced to Death'); }
  let blast: number | undefined;
  // The Blast Template: its dice and its Surge are both the models it covers (Part 12.8).
  if (w.blast && state && target) {
    blast = blastCover(state, target, state.sense?.players[pu.id]?.[0] ?? null);
    roa += blast;
    notes.push(`Blast Template (${blast} model${blast === 1 ? '' : 's'})`);
  }
  return { weapon: { ...w, keywords, roa, range, dmg, surgeTypes, surgeDie }, spent, notes, blast };
}

/** Psionic Presence: the enemy Unit is Within 4" of the Shade token of Adepts that have it. */
function shadeNear(state: GameState, target: AiUnitInstance): boolean {
  const foe = unitShapes(state, 'ai', target.id);
  if (!foe.length) return false;
  return (state.tokens ?? []).some((t) => {
    if (t.kind !== 'shade' || !t.ownerId) return false;
    const owner = state.playerUnits.find((p) => p.id === t.ownerId);
    return !!owner && !owner.destroyed && hasAbility(owner, 'Psionic Presence') && foe.some((f) => edgeToPoint(f, t) <= 4.05);
  });
}

/**
 * Whether something of yours takes HIDDEN off an enemy Unit: Within 6" of a Faction Indicator set by Scanner Sweep,
 * Surveillance or Oversight Mode, of your Omega Worm (Detection), or of a Nerazim Watchers' Shade (Nerazim Farsight).
 */
export function aiRevealed(state: GameState, u: AiUnitInstance): boolean {
  const foe = unitShapes(state, 'ai', u.id);
  if (!foe.length) return false;
  const within = (p: Pt) => foe.some((f) => edgeToPoint(f, p) <= 6.05);
  if ((state.tokens ?? []).some((t) => t.kind === 'indicator' && DETECTORS.has(t.label) && within(t))) return true;
  if ((state.tokens ?? []).some((t) => t.kind === 'shade' && within(t) && (() => { const o = state.playerUnits.find((p) => p.id === t.ownerId); return !!o && !o.destroyed && hasAbility(o, 'Nerazim Farsight'); })())) return true;
  return state.playerUnits.some((o) => o.location === 'table' && !o.destroyed && hasAbility(o, 'Detection') && (o.deployedRound ?? 0) < state.round && unitShapes(state, 'players', o.id).some((s) => foe.some((f) => edgeDistance(s, f) <= 6.05)));
}
const DETECTORS = new Set(['Surveillance', 'Scanner Sweep', 'Oversight Mode']);

/** Charge modifiers from effects (2D6, +X") and the effects a charge spends. */
export function chargeMods(pu: PlayerUnit, state?: GameState): { twoDice: boolean; bonus: number; impactHit: number; spent: string[] } {
  let twoDice = false;
  let bonus = 0;
  let impactHit = 0;
  const spent: string[] = [];
  // Malevolent Matriarch (Malignant Creep): a Zerg Unit that declares a Charge while ON CREEP has +1 to IMPACT Hit Rolls.
  if (state && onCreep(state, pu) && cardsOf(state, ownerOf(pu)).some((c) => !!cardDef(c.defId)?.boosts.some((b) => b.name === 'Malevolent Matriarch'))) impactHit += 1;
  for (const e of activeEffects(pu)) {
    if (e.mods.chargeTwoDice) twoDice = true;
    if (e.mods.chargeBonus) bonus += e.mods.chargeBonus;
    if (e.mods.impactHit) impactHit += e.mods.impactHit;
    if (e.until === 'charge') spent.push(e.id);
  }
  return { twoDice, bonus, impactHit, spent };
}

export function spendEffects(pu: PlayerUnit, ids: string[]): void {
  if (!ids.length) return;
  pu.effects = (pu.effects ?? []).filter((e) => !ids.includes(e.id));
}

/** Guardian Shield / Point Defence Drone: dice removed from a ranged attack at `target`. */
export function defensiveDiceRemoval(state: GameState, target: PlayerUnit, instant: boolean): { remove: number; notes: string[]; consumeDroneId?: string } {
  const theirs = unitShapes(state, 'players', target.id);
  if (!theirs.length) return { remove: 0, notes: [] };
  // Within 4": base edge to base edge, between the closest models of the two units.
  const within4 = (pu: PlayerUnit) => pu.id === target.id || unitShapes(state, 'players', pu.id).some((m) => theirs.some((t) => edgeDistance(m, t) <= 4.05));
  let remove = 0;
  const notes: string[] = [];
  for (const pu of state.playerUnits) {
    if (pu.location !== 'table' || pu.destroyed) continue;
    const shield = activeEffects(pu).find((e) => e.mods.auraFewerDice);
    if (shield && within4(pu)) { remove = Math.max(remove, shield.mods.auraFewerDice ?? 0); notes.push(`Guardian Shield (${pu.name})`); }
  }
  let consumeDroneId: string | undefined;
  if (!instant) {
    const drone = state.playerUnits.find((pu) => pu.defId === 'point_defense_drone' && pu.location === 'table' && !pu.destroyed && pu.id !== target.id && within4(pu));
    if (drone) { remove += 2; notes.push('Point Defence Laser'); consumeDroneId = drone.id; }
  }
  return { remove, notes, consumeDroneId };
}

/** Whether the unit has this ability (and its upgrade, if the ability needs one). */
export function hasAbility(pu: PlayerUnit, name: string): boolean {
  return ownsAbility(playerUnitDef(pu), pu.upgrades, name);
}

export const isBurrowed = (pu: PlayerUnit): boolean => (pu.statuses ?? []).includes('Burrowed');
/** BURROWED units have HIDDEN too. */
export const isHidden = (pu: PlayerUnit): boolean => (pu.statuses ?? []).some((s) => s === 'Hidden' || s === 'Burrowed');

/**
 * A unit's own Reaction abilities against an attack on it, offered while you roll its saves. `tough` turns failed
 * Armour dice into successes, `reduce` takes damage off the total, `capDmg` caps the attacking weapon's Damage
 * characteristic, and `evade` sets an Evade value that nothing can modify.
 */
export interface SelfReaction {
  name: string;
  tough?: number;
  reduce?: number;
  capDmg?: number;
  evade?: number;
  /** Whether the unit can use it against this attack right now. */
  ok: (state: GameState, pu: PlayerUnit) => boolean;
  note: string;
}
export const SELF_REACTIONS: SelfReaction[] = [
  { name: 'Zealous Round', reduce: 2, note: 'Counts as activated this phase', ok: (s, pu) => s.phase !== 'scoring' && !pu.activated[s.phase] },
  { name: 'Shield Overcharge', tough: 2, note: 'While Shielded', ok: (_s, pu) => isShielded(pu) },
  { name: 'Improved Barrier', capDmg: 1, note: 'While Shielded: the weapon does 1 damage per hit', ok: (_s, pu) => isShielded(pu) },
  { name: 'Prophetic Vision', evade: 4, note: 'Evade 4+, which nothing can modify', ok: () => true },
];

/**
 * The Reactions of its own a unit may use against an attack on it: the ones on its card that are Reactions (the
 * Praetor Guard's Shield Overcharge is a Passive, and applies by itself), bought where they are upgrades, not yet
 * used this Round unless REPEATABLE, and usable as the unit stands.
 */
export function selfReactionsFor(state: GameState, pu: PlayerUnit): { ability: AbilityDef; reaction: SelfReaction }[] {
  if (pu.destroyed || pu.location !== 'table') return [];
  return playerUnitDef(pu).abilities.flatMap((ab) => {
    const r = SELF_REACTIONS.find((x) => x.name === ab.name);
    if (!r || ab.kind !== 'Reaction' || !hasAbility(pu, ab.name) || !r.ok(state, pu)) return [];
    if (!UNIT_ABILITIES[ab.name]?.repeatable && (pu.used ?? []).includes(ab.name)) return [];
    return [{ ability: ab, reaction: r }];
  });
}

/** SHIELDED: a unit keeps the Status while its Shield value has not been spent (Part 12). */
export const isShielded = (pu: PlayerUnit): boolean => (pu.shieldsLeft ?? 0) > 0;

/**
 * TOUGH a unit has on an Armour Roll without being asked: Heavy Plating (not in SIEGE MODE), the Praetor Guard's
 * Shield Overcharge (TOUGH (2) on its first Armour Roll each Round) and Ancillary Carapace (TOUGH (1) on the first
 * Armour Roll of each Activation). Keywords do not stack: the highest counts. `mark` records the once-only ones as
 * used, when the roll is made.
 */
export function passiveToughFor(pu: PlayerUnit, state?: GameState, activationKey?: string): { tough: number; mark: () => void } {
  let tough = hasAbility(pu, 'Heavy Plating') && !(pu.statuses ?? []).includes('Siege Mode') ? 1 : 0;
  const marks: (() => void)[] = [];
  const praetor = playerUnitDef(pu).abilities.some((a) => a.name === 'Shield Overcharge' && a.kind === 'Passive');
  if (praetor && state && !(pu.used ?? []).includes('Shield Overcharge')) { tough = Math.max(tough, 2); marks.push(() => { pu.used = [...(pu.used ?? []), 'Shield Overcharge']; }); }
  if (hasAbility(pu, 'Ancillary Carapace') && state && activationKey && pu.toughKey !== activationKey) { tough = Math.max(tough, 1); marks.push(() => { pu.toughKey = activationKey; }); }
  return { tough, mark: () => marks.forEach((m) => m()) };
}
export const passiveTough = (pu: PlayerUnit, state?: GameState, activationKey?: string): number => passiveToughFor(pu, state, activationKey).tough;

/** The enemy Activation an attack belongs to: what "once per Activation" effects are counted against. */
export const activationKey = (state: GameState, attackerUnitId: string): string => `${state.round}:${state.phase}:${attackerUnitId}`;

/**
 * Standing on HIGH GROUND: any part of the base on the plateau of a Size 3+ piece (its ramp is MID GROUND, and a
 * base on two levels counts as the higher).
 */
export function onHighGround(state: GameState, p: Pt & { r?: number; half?: number }): boolean {
  return baseElevation(p, state.terrain.pieces.filter(isHighGround)).zone === 'plateau';
}

/**
 * HIGH GROUND Cover (Part 7.1.3): every model of the target stands on HIGH GROUND and at least one model of the
 * attacker does not. Flying Units never benefit from it, and their attacks never come from a lower elevation.
 */
export function highGroundCover(state: GameState, defender: (Pt & { r?: number; half?: number })[], attacker: (Pt & { r?: number; half?: number })[], defenderFlying: boolean, attackerFlying: boolean): boolean {
  if (defenderFlying || attackerFlying || !defender.length || !attacker.length) return false;
  return defender.every((p) => onHighGround(state, p)) && attacker.some((p) => !onHighGround(state, p));
}

/**
 * Whether your unit may make an Evade Roll against this AI attack, and the number it needs. Eligible when HIDDEN or
 * BURROWED, with Precognition, when Engaged and hit by a Ranged Attack, on HIGH GROUND against a Ranged Attack from
 * below, against INDIRECT FIRE it cannot be seen by, with Lurking (Stationary, the first Ranged Attack of the Round),
 * with Combat Shield raised against Close Combat, against the enemy Mutating Carapace names, against an Engaged
 * Indomitable unit firing out of its fight, or when a Reaction granted it. A Null Evade (-) never rolls.
 * ANTI-EVADE and the Modifiers move the Target Number, never below 2+ or above 6+.
 */
export function evadeFor(state: GameState, pu: PlayerUnit, attack: { phase: string; weapon: string; attacker: { unitId: string } }): { value: number; reason: string } | null {
  const base = playerUnitDef(pu).stats.evade;
  if (!base) return null;
  const ai = state.army.units.find((u) => u.id === attack.attacker.unitId);
  const w = ai ? unitById(ai.defId).weapons.find((x) => x.name === attack.weapon) : undefined;
  const ranged = attack.phase === 'Assault';
  const fx = activeEffects(pu);
  const carapace = ai ? fx.find((e) => e.mods.evadeVs === ai.id) : undefined;
  let reason: string | null = null;
  let bonus = 0;
  if (isHidden(pu)) reason = isBurrowed(pu) ? 'Burrowed' : 'Hidden';
  else if (hasAbility(pu, 'Precognition')) reason = 'Precognition';
  else if (ranged && pu.engaged) reason = 'engaged against a ranged attack';
  else if (!ranged && fx.some((e) => e.mods.evadeMelee)) reason = 'Combat Shield';
  else {
    // Hallucination and Hierarch's Stand: eligible against the enemy attack they answered.
    const grant = fx.find((e) => e.mods.mayEvade);
    if (grant) reason = grant.source;
  }
  if (carapace) { reason ??= 'Mutating Carapace'; bonus += carapace.mods.evadeBonus ?? 0; }
  if (!reason && ranged && ai) {
    const mine = unitShapes(state, 'players', pu.id);
    const theirs = unitShapes(state, 'ai', ai.id);
    if (highGroundCover(state, mine, theirs.length ? theirs : ai.est ? [ai.est] : [], playerUnitFlying(pu), (unitById(ai.defId).tags as string[]).includes('Flying'))) reason = 'high ground';
  }
  if (!reason && ranged && ai && w?.keywords.some((k) => k.k === 'INDIRECT FIRE')) {
    const a = unitShapes(state, 'ai', ai.id), b = unitShapes(state, 'players', pu.id);
    if (a.length && b.length && !a.some((m) => b.some((t) => losBetweenBases(m, aiUnitSize(ai), t, playerUnitSize(pu), state.terrain.pieces)))) reason = 'indirect fire';
  }
  if (!reason && ranged && hasAbility(pu, 'Lurking') && pu.location === 'table' && isStationary(state, pu) && pu.lurkedRound !== state.round) {
    reason = 'Lurking';
    if (onCreep(state, pu)) bonus += 1;
  }
  // Indomitable: an Engaged unit firing at a Unit it is not Engaged with gives that Unit an Evade Roll.
  if (!reason && ranged && ai && ai.engaged && !pu.engagedWith.includes(ai.id) && ownsAbility(unitById(ai.defId), ai.upgrades, 'Indomitable')) reason = 'Indomitable';
  if (!reason) return null;
  const anti = w?.keywords.find((k) => k.k === 'ANTI-EVADE')?.v ?? 0;
  return { value: targetNumber(base + anti - bonus), reason };
}

/** HIDDEN / BURROWED units can only be targeted from within 4". */
export function hiddenFrom(pu: PlayerUnit, attackerDist: number): boolean {
  const hidden = (pu.statuses ?? []).some((s) => s === 'Hidden' || s === 'Burrowed');
  return hidden && attackerDist > 4;
}

/**
 * A unit's Supply for Controlling and Contesting Mission Markers, or null when it can never do either (a Structure).
 * Commander adds 1, Domineering Presence and Additional Supply Depots add what they say, and Freedom Fighters keeps
 * every Friendly Unit Within 8" of Jim Raynor from counting for less than 1.
 */
export function contestSupply(state: GameState, pu: PlayerUnit): number | null {
  if (pu.destroyed || pu.location === 'destroyed') return null;
  if (playerUnitDef(pu).abilities.some((a) => a.name === 'Structure')) return null;
  let supply = playerUnitSupply(pu);
  if (hasAbility(pu, 'Commander')) supply += 1;
  supply += activeEffects(pu).reduce((a, e) => a + (e.mods.supplyBonus ?? 0), 0);
  if (supply < 1) {
    const mine = unitShapes(state, 'players', pu.id);
    const raynor = state.playerUnits.some((o) => o.location === 'table' && !o.destroyed && hasAbility(o, 'Freedom Fighters')
      && (o.id === pu.id || unitShapes(state, 'players', o.id).some((s) => mine.some((m) => edgeDistance(s, m) <= 8.05))));
    if (raynor) supply = 1;
  }
  return supply;
}

/** A unit's Supply for Disengage checks: 0 while BURROWED, and Commander counts 1 more. */
export function disengageSupply(pu: PlayerUnit): number {
  if (isBurrowed(pu)) return 0;
  return playerUnitSupply(pu) + (hasAbility(pu, 'Commander') ? 1 : 0);
}

/** What a unit takes of its player's Supply Pool: nothing with Advanced Medic Facilities. */
export function poolSupply(pu: PlayerUnit): number {
  return hasAbility(pu, 'Advanced Medic Facilities') ? 0 : playerUnitSupply(pu);
}

/** Cleanup & Refresh for the player side (start of a new round). */
export function refreshPlayerSide(state: GameState): string[] {
  const lines: string[] = [];
  for (const c of state.playerCards ?? []) c.exhausted = false;
  const before = (state.tokens ?? []).length;
  for (const t of (state.tokens ?? []).filter((x) => !x.stayInPlay)) removeToken(state, t.id);
  if (before && before !== (state.tokens ?? []).length) lines.push('Cleanup: tokens removed.');
  state.reacted = [];
  for (const pu of state.playerUnits) {
    pu.used = [];
    pu.effects = (pu.effects ?? []).filter((e) => e.until !== 'round' && e.until !== 'charge' && e.until !== 'action');
    pu.bonusMove = 0;
    pu.placeRange = 0;
    pu.placeAsAction = false;
    pu.placeNoEngage = false;
    pu.pendingUses = undefined;
    pu.dashFrom = undefined;
    // Darkness Descends: HIDDEN until the End of the Round.
    if (pu.hiddenThroughRound !== undefined && pu.hiddenThroughRound < state.round) {
      pu.statuses = (pu.statuses ?? []).filter((x) => x !== 'Hidden');
      pu.hiddenThroughRound = undefined;
    }
    if (pu.expiresEndOfRound && pu.location === 'table') {
      pu.location = 'destroyed';
      pu.destroyed = true;
      if (state.sense) delete state.sense.players[pu.id];
    }
  }
  for (const u of state.army.units) u.debuffs = [];
  if ((state.playerCards ?? []).length) lines.push('Your cards are Ready again.');
  return lines;
}

/**
 * Deploy entry points granted by your own structures: the Pylon's Warp Conduit (one Ground Unit a Round) and the
 * Omega Worm's Omega Network (Units with a combined Supply of 2 or less each Round). Neither works in the Round the
 * structure was set down.
 */
export function extraEntryPoints(state: GameState, pu: PlayerUnit): { p: Pt; source: string }[] {
  const out: { p: Pt; source: string }[] = [];
  const def: UnitDef = playerUnitDef(pu);
  const need = currentSupply(def, pu.models);
  const wormUsed = state.omegaUsed?.round === state.round ? state.omegaUsed.supply : 0;
  for (const s of state.playerUnits) {
    if (s.location !== 'table' || s.destroyed || (s.deployedRound ?? 0) >= state.round || ownerOf(s) !== ownerOf(pu)) continue;
    const p = unitPos(state, s);
    if (!p) continue;
    if (s.defId === 'pylon' && isGround(pu) && state.conduitUsedRound !== state.round) out.push({ p, source: 'Warp Conduit' });
    if (s.defId === 'omega_worm' && wormUsed + need <= 2) out.push({ p, source: 'Omega Network' });
  }
  return out;
}
