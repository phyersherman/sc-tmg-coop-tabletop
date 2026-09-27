/**
 * Side markers in the co-op missions: the reasons to leave the primary objective.
 *
 * Something of the AI's stands on each side marker: a guard (a unit that holds the marker and fights back) or a
 * Structure (a lot to bring down, and it never fights back). The rest of the AI's force leaves side markers alone.
 * Destroy what stands there, then hold the marker at a Scoring phase: the player whose unit holds it earns the
 * marker's reward, once, for the round after. Unused by the end of that round, it is lost.
 *
 * Unit rewards (Reinforce, Firepower) go to one unit. Requisition goes to the holding player. Counters change the
 * mission itself and apply on their own at the start of that round.
 */
import type { GameState, ScoringAnswers, ScoringPrompt } from '../types/game';
import type { AiUnitInstance } from '../types/army';
import type { MissionCtx, MissionMode } from '../types/mission';
import type { PlayerUnit } from '../sense/types';
import { unitById, unitsForFaction } from '@data/index';
import { missionStructureFor } from '@data/missionObjects';
import { instanceCost, makeInstance } from '../army/builder';
import { placeUnit } from '../sense/placement';
import { playerUnitsHolding } from '../sense/query';
import { playerUnitDef } from '../sense/playerUnits';

export type RewardKind =
  /** One of your destroyed units returns to Reserves at full strength. */
  | 'reinforce'
  /** +2 to your Supply Pool this round. */
  | 'requisition'
  /** One unit: +1 Rate of Attack on its ranged weapons this round. */
  | 'firepower'
  /** Oblivion Express: a train stalls, and does not run this round. */
  | 'stall'
  /** Dead of Night: the most expensive destroyed AI unit does not return tonight. */
  | 'nest'
  /** Dead of Night: the AI's Supply boost at nightfall is 1 less. */
  | 'floodlights'
  /** Void Thrashing: the next Thrasher due arrives a round later. */
  | 'cradle'
  /** Void Thrashing: the base regains 1 HP. */
  | 'shield'
  /** Rifts to Korhal: of two spots for this round's rift, it opens at the one nearer your units. */
  | 'recon'
  /** Rifts to Korhal: this round's rift opens within 6" of the marker. */
  | 'anchor'
  /** Mist Opportunities: the marker is one of this round's vents. */
  | 'vent';

export const REWARDS: Record<RewardKind, { name: string; text: string; scope: 'unit' | 'player' | 'mission'; /** A few words, for the printed token. */ short: string }> = {
  reinforce: { name: 'Reinforce', text: 'one of your destroyed units returns to Reserves at full strength', scope: 'unit', short: 'A lost unit returns' },
  requisition: { name: 'Requisition', text: '+2 to your Supply Pool this round', scope: 'player', short: '+2 Supply this round' },
  firepower: { name: 'Firepower', text: 'one of your units gets +1 Rate of Attack on its ranged weapons this round', scope: 'unit', short: '+1 RoA for one unit' },
  stall: { name: 'Stall the train', text: 'the train furthest along the line (or the one arriving now) does not run this round', scope: 'mission', short: 'A train stops a round' },
  nest: { name: 'Burn the nest', text: 'if this round is a night, the most expensive destroyed AI unit does not return', scope: 'mission', short: 'Its best unit stays dead' },
  floodlights: { name: 'Floodlights', text: 'if this round is a night, the AI\'s Supply boost at nightfall is 1 less', scope: 'mission', short: 'Night Supply −1' },
  cradle: { name: 'Seal the cradle', text: 'the next Thrasher due arrives a round later', scope: 'mission', short: 'Thrasher a round late' },
  shield: { name: 'Shield battery', text: 'your base regains 1 HP (up to 3)', scope: 'mission', short: 'Base +1 HP' },
  recon: { name: 'Recon', text: 'the app rolls two spots for this round\'s rift and opens it at the one nearer your units', scope: 'mission', short: 'Rift opens near you' },
  anchor: { name: 'Void anchor', text: 'this round\'s rift opens within 6" of this marker', scope: 'mission', short: 'Rift within 6" here' },
  vent: { name: 'Prime the vent', text: 'this marker is one of this round\'s vents', scope: 'mission', short: 'This marker vents' },
};

export interface SideSpec {
  marker: number;
  object: 'guard' | 'structure';
  reward: RewardKind;
}

export interface Reward {
  id: string;
  kind: RewardKind;
  marker: number;
  /** The round it can be used in: the one after it was earned. */
  round: number;
  /** Which player earned it (0-based); null when the holders were level and you choose when you use it. */
  owner: number | null;
  used: boolean;
  /** What it was used on, for the log and the strip. */
  usedOn?: string;
}

interface SideObject {
  unitId: string;
  object: 'guard' | 'structure';
  reward: RewardKind;
  claimed: boolean;
}

interface SideState {
  objects: Record<number, SideObject>;
  rewards: Reward[];
}

export const sideState = (s: GameState): SideState => ((s.modeState['side'] as SideState | undefined) ?? { objects: {}, rewards: [] });
const writeSide = (s: GameState): SideState => ((s.modeState['side'] as SideState | undefined) ??= { objects: {}, rewards: [] } as SideState) as SideState;

/** Rewards that can be used this round and have not been. */
export const rewardsReady = (s: GameState): Reward[] => sideState(s).rewards.filter((r) => r.round === s.round && !r.used);

/** A counter due this round, marked used. The mission calls this where the counter changes its rules. */
export function takeCounter(c: MissionCtx, kind: RewardKind): Reward | null {
  const r = sideState(c.state).rewards.find((x) => x.kind === kind && x.round === c.state.round && !x.used);
  if (!r) return null;
  r.used = true;
  c.log(`${REWARDS[kind].name} (Marker ${r.marker}): ${REWARDS[kind].text}.`);
  return r;
}

/** Extra Supply a player may deploy this round from Requisition. Without an owner (one player): all of it. */
export function requisitionSupply(s: GameState, owner?: number): number {
  return sideState(s).rewards.filter((r) => r.kind === 'requisition' && r.round === s.round && r.used && r.owner !== null && (owner === undefined || r.owner === owner)).length * 2;
}

const objectName = (s: GameState, u: AiUnitInstance) => unitById(u.defId).name;

/** The cheapest Core unit in the AI's army (a guard is a copy of it), else the cheapest that is not a hero. */
function guardDef(s: GameState) {
  const cost = (u: AiUnitInstance) => instanceCost(unitById(u.defId), u);
  const own = s.army.units.filter((u) => !u.special && unitById(u.defId).role !== 'Hero').sort((a, b) => cost(a) - cost(b));
  const core = own.find((u) => unitById(u.defId).role === 'Core') ?? own[0];
  if (core) return unitById(core.defId);
  return unitsForFaction(s.army.faction).filter((d) => d.role === 'Core' && !d.summoned).sort((a, b) => a.compositions[0]!.cost - b.compositions[0]!.cost)[0]!;
}

/** Set a guard or a structure on each side marker. Both are free: outside the AI's army and its Supply Pool. */
function placeObjects(c: MissionCtx, specs: SideSpec[]): void {
  const s = c.state;
  const side = writeSide(s);
  for (const spec of specs) {
    const m = s.markers.find((x) => x.id === spec.marker);
    if (!m) continue;
    const def = spec.object === 'structure' ? missionStructureFor(s.army.faction) : guardDef(s);
    const n = (s.labelCounters[def.id] ?? 0) + 200;
    s.labelCounters[def.id] = n;
    const u = makeInstance(def, 'small', `${def.name}${spec.object === 'guard' ? ' guard' : ''} (Marker ${m.id})`, n);
    u.location = 'table';
    u.deployedRound = 0;
    // A guard never leaves its marker to go anywhere else: it shoots, and fights what comes to it.
    u.special = { sideMarker: m.id, noRespawn: true, fixedObjective: true, holdUntil: 999 };
    u.objective = { kind: 'marker', markerId: m.id };
    u.atObjective = true;
    s.army.units.push(u);
    placeUnit(s, 'ai', u.id, { x: m.x, y: m.y });
    m.side = true;
    side.objects[m.id] = { unitId: u.id, object: spec.object, reward: spec.reward, claimed: false };
  }
}

function objectLine(s: GameState, id: number, o: SideObject): string {
  const u = s.army.units.find((x) => x.id === o.unitId);
  const name = u ? objectName(s, u) : '';
  const a = /^[aeiou]/i.test(name) ? 'an' : 'a';
  const what = u ? (o.object === 'guard' ? `${a} ${name} guarding it (it fights back)` : `${a} ${name} (a Structure: it never fights back)`) : 'a guard';
  return `Marker ${id}: ${what}. Reward: ${REWARDS[o.reward].name}, ${REWARDS[o.reward].text}.`;
}

function ownerName(s: GameState, owner: number | null): string {
  if ((s.config.players ?? 1) < 2) return 'you';
  return owner === null ? 'the player you choose' : `Player ${owner + 1}`;
}

/** Who holds a marker now: the player with the most Supply on it; null when two players are level. */
function holderOf(s: GameState, markerId: number): number | null {
  if ((s.config.players ?? 1) < 2) return 0;
  const by = new Map<number, number>();
  for (const h of playerUnitsHolding(s, markerId)) by.set(h.owner, (by.get(h.owner) ?? 0) + h.supply + 0.01);
  const ranked = [...by.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  if (ranked.length > 1 && Math.abs(ranked[0]![1] - ranked[1]![1]) < 1e-6) return null;
  return ranked[0]![0];
}

/** A reward earned now, for the next round. Lock & Load grants its own; side markers grant theirs at Scoring. */
export function grantReward(c: MissionCtx, kind: RewardKind, marker: number, owner: number | null): void {
  const s = c.state;
  if (s.round >= s.finalRound) return;
  const side = writeSide(s);
  const r: Reward = { id: `reward-${s.round}-${marker}-${kind}`, kind, marker, round: s.round + 1, owner: REWARDS[kind].scope === 'mission' ? null : owner, used: false };
  side.rewards.push(r);
  c.log(`Marker ${marker} earns ${REWARDS[kind].name} for ${REWARDS[kind].scope === 'mission' ? 'the team' : ownerName(s, r.owner)}, for round ${r.round} only.`);
}

/** Claimable at this Scoring: the object is gone and the reward not yet earned. */
function claimable(s: GameState): [number, SideObject][] {
  return Object.entries(sideState(s).objects)
    .map(([id, o]) => [Number(id), o] as [number, SideObject])
    .filter(([, o]) => !o.claimed && s.army.units.find((u) => u.id === o.unitId)?.location !== 'table');
}

/** Wraps a co-op mission with its side markers. */
export function withSideMarkers(mode: MissionMode, specs: SideSpec[]): MissionMode {
  return {
    ...mode,
    briefing: (s) => !specs.length ? mode.briefing(s) : [
      ...mode.briefing(s),
      `Side markers: destroy what stands on one, then hold the marker at a Scoring phase. The player holding it earns its reward for the next round only, for one unit (level holders: you choose who). Unused, it is lost. The AI's force leaves side markers alone.${s.config.playMode === 'video' ? '' : ' Set each one on its marker before the battle; the map shows where.'}`,
      ...specs.map((sp) => {
        const o = sideState(s).objects[sp.marker];
        return o ? objectLine(s, sp.marker, o) : `Marker ${sp.marker}: ${sp.object === 'guard' ? 'a guard' : 'a Structure'}. Reward: ${REWARDS[sp.reward].name}, ${REWARDS[sp.reward].text}.`;
      }),
    ],
    onSetup: (c) => {
      mode.onSetup(c);
      placeObjects(c, specs);
    },
    onRoundStart: (c) => {
      const s = c.state;
      // Last round's rewards that were never used are gone.
      for (const r of sideState(s).rewards) if (!r.used && r.round < s.round) { r.used = true; r.usedOn = 'lost'; }
      // Requisition with a known player is theirs at once: the Supply is there to deploy with.
      for (const r of rewardsReady(s)) if (r.kind === 'requisition' && r.owner !== null) { r.used = true; r.usedOn = ownerName(s, r.owner); c.log(`Requisition (Marker ${r.marker}): ${ownerName(s, r.owner)} ${s.config.players > 1 ? 'has' : 'have'} +2 Supply this round.`); }
      mode.onRoundStart(c);
    },
    roundNotes: (c) => {
      const s = c.state;
      const ready = rewardsReady(s).map((r) => `Reward ready: ${REWARDS[r.kind].name} (Marker ${r.marker}) for ${ownerName(s, r.owner)}, ${REWARDS[r.kind].text}. Use it this round or lose it.`);
      const done = sideState(s).rewards.filter((r) => r.round === s.round && r.used && r.usedOn !== 'lost').map((r) => `${REWARDS[r.kind].name} (Marker ${r.marker}) is in play this round.`);
      const standing = Object.entries(sideState(s).objects).filter(([, o]) => s.army.units.find((u) => u.id === o.unitId)?.location === 'table').map(([id]) => id);
      const open = claimable(s).map(([id]) => id);
      return [
        ...(mode.roundNotes?.(c) ?? []),
        ...ready,
        ...done,
        ...(open.length ? [`Hold Marker${open.length > 1 ? 's' : ''} ${open.join(', ')} at Scoring to earn ${open.length > 1 ? 'their rewards' : 'its reward'}.`] : []),
        ...(standing.length ? [`Still guarded: Marker${standing.length > 1 ? 's' : ''} ${standing.join(', ')}.`] : []),
      ];
    },
    scoringPrompts: (c) => {
      const s = c.state;
      const base = mode.scoringPrompts(c);
      if ((s.config.players ?? 1) < 2 || s.round >= s.finalRound) return base;
      // Two players: whose unit holds each marker that can pay out now (0 when level, and you choose who later).
      return [
        ...base,
        ...claimable(s).map(([id]): ScoringPrompt => ({
          id: `holder-${id}`,
          kind: 'number',
          text: `Marker ${id} is clear. If you hold it, which player has the most Supply on it (1 or 2; 0 if level: you choose when you use it)?`,
          min: 0,
          max: 2,
          defaultValue: (holderOf(s, id) ?? -1) + 1,
          auto: (st) => (holderOf(st, id) ?? -1) + 1,
        })),
      ];
    },
    onScoring: (c, a: ScoringAnswers) => {
      mode.onScoring(c, a);
      const s = c.state;
      for (const [id, o] of claimable(s)) {
        if (a.markers[id] !== 'players') continue;
        o.claimed = true;
        const said = Number(a.extra[`holder-${id}`] ?? 0);
        const owner = (s.config.players ?? 1) < 2 ? 0 : said >= 1 ? said - 1 : null;
        grantReward(c, o.reward, id, owner);
      }
    },
    onAiUnitDestroyed: (c, u) => {
      mode.onAiUnitDestroyed?.(c, u);
      const id = u.special?.sideMarker;
      if (typeof id === 'number') {
        const m = c.state.markers.find((x) => x.id === id);
        // Cleared, it is an ordinary marker again: anyone may fight over it.
        if (m) m.side = false;
        c.log(`${u.label} is down. Hold Marker ${id} at a Scoring phase to earn its reward.`);
      }
    },
  };
}

/** The units a reward can go to now: destroyed units for Reinforce, units still in the battle for Firepower. */
export function rewardTargets(s: GameState, r: Reward): PlayerUnit[] {
  const mine = (p: PlayerUnit) => r.owner === null || (p.owner ?? 0) === r.owner;
  if (r.kind === 'reinforce') return s.playerUnits.filter((p) => mine(p) && (p.destroyed || p.location === 'destroyed') && !p.summoned && !p.expiresEndOfRound);
  // Firepower is for a unit with a ranged weapon to use it on.
  if (r.kind === 'firepower') return s.playerUnits.filter((p) => mine(p) && !p.destroyed && p.location !== 'destroyed' && !p.summoned && playerUnitDef(p).weapons.some((w) => w.phase === 'Assault' && w.range !== 'E'));
  return [];
}

/**
 * Use a reward now. A unit reward needs the unit; Requisition without an owner needs the player. Returns why it
 * cannot be used, or null once it is.
 */
export function useReward(s: GameState, rewardId: string, pick: { unitId?: string; owner?: number }, log: (t: string) => void): string | null {
  const r = sideState(s).rewards.find((x) => x.id === rewardId);
  if (!r) return 'No such reward.';
  if (r.used) return 'That reward has been used.';
  if (r.round !== s.round) return `That reward is for round ${r.round}.`;
  const info = REWARDS[r.kind];
  if (r.kind === 'requisition') {
    const owner = pick.owner ?? r.owner;
    if (owner === null || owner === undefined) return 'Choose the player who takes the Supply.';
    r.owner = owner;
    r.used = true;
    r.usedOn = ownerName(s, owner);
    log(`Requisition (Marker ${r.marker}): ${ownerName(s, owner)} ${s.config.players > 1 ? 'has' : 'have'} +2 Supply this round.`);
    return null;
  }
  if (info.scope !== 'unit') return 'That reward applies on its own.';
  const pu = s.playerUnits.find((p) => p.id === pick.unitId);
  if (!pu || !rewardTargets(s, r).some((p) => p.id === pu.id)) return r.kind === 'reinforce' ? 'Choose one of your destroyed units.' : 'Choose one of your units with a ranged weapon, still in the battle.';
  if (r.kind === 'reinforce') {
    pu.destroyed = false;
    pu.location = 'reserves';
    pu.models = pu.maxModels;
    pu.damageMarker = 0;
    pu.shieldsLeft = unitById(pu.defId).stats.shields ?? 0;
    pu.engaged = false;
    pu.engagedWith = [];
    pu.effects = [];
    pu.statuses = [];
    pu.activated = { movement: false, assault: false, combat: false };
    if (s.sense) delete s.sense.players[pu.id];
    log(`Reinforce (Marker ${r.marker}): ${pu.name} returns to Reserves at full strength.`);
  } else {
    pu.effects = [...(pu.effects ?? []), { id: `firepower-${r.id}`, source: `Firepower (Marker ${r.marker})`, text: '+1 Rate of Attack on ranged weapons this round.', mods: { roa: 1, weaponPhase: 'Assault' }, until: 'round' }];
    log(`Firepower (Marker ${r.marker}): ${pu.name} has +1 Rate of Attack on its ranged weapons this round.`);
  }
  r.owner = pu.owner ?? 0;
  r.used = true;
  r.usedOn = pu.name;
  return null;
}
