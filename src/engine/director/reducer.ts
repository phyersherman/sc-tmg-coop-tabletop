import type { AiOrder, GameConfig, GameEvent, GameState, LogEntry, Phase, ScoringAnswers, ScoringPrompt, Side, Step } from '../types/game';
import type { AiUnitInstance } from '../types/army';
import type { UnitDef, WeaponProfile } from '../types/units';
import type { DeploymentLayout, TerrainLayout } from '../types/terrain';
import type { MissionCtx, MissionMode } from '../types/mission';
import { Rng } from '../rng';
import { unitById } from '@data/index';
import { modeById } from '../missions/index';
import { deckFor } from '@data/orderDecks';
import { initDeck, drawCard, currentCard } from '../ai/orderDeck';
import { assignObjectives } from '../ai/objectives';
import { aiDebuff, aiHasBoost, aiMayTarget, aiWeapon, decideAi, inPlayerZoi, orderChargeBonus, shouldPassEarly, speedModFor, deployable } from '../ai/decide';
import { blastTemplate, type BlastHit, hiddenFrom, evadeFor, hasAbility, isBurrowed, isHidden, ownerOf, unitAbilities, pendingEndOfRound, CARD_BOOSTS, SAVE_BOOSTS, UNIT_ABILITIES, autoPay, cardDef, chargeMods, defensiveDiceRemoval, effectiveSpeed, passiveToughFor, payValue, pushHits, refreshPlayerSide, removeToken, SELF_REACTIONS, PROMPTED_REACTIONS, sparePayCard, spendEffects, weaponWithEffects, abilityCost, activationKey, activeEffects, aiRevealed, boostPhaseProblem, disengageSupply, inEnemyZoi, isStationary, unitInEnemyZoi, type AbilityContext, type AbilitySpec } from '../abilities/index';
import { armourBonus, firedWeapon, impactDice, ownsAbility, raiseKeyword, unitHp } from '../units/firing';
import { MARKER_RADIUS_IN } from '@data/bases';
import { applyDamage } from '../units/damage';
import { currentSupply } from '../units/supply';
import { DIFFICULTIES, supplyFor } from '../difficulty';
import { hasMutator } from '../mutators/index';
import { fairnessFloor, processReturns, scheduleRespawns } from '../respawn';
import { aiAlive, aiSupplyInReserves, aiSupplyOnTable, availableNow, findUnit, onTable, poolNow } from './selectors';
import { defaultSupply } from '../missions/framework';
import type { PlayerUnit, Pt, SenseSnapshot } from '../sense/types';
import { applySense } from '../ai/senseDecide';
import { cardOrder, withCardText } from '../ai/cardOrders';
import { aiBurrowed, aiHas, setAiBurrowed } from '../ai/burrow';
import { noMap } from '../ai/actionDecks';
import { aiModels, engagedWith } from '../sense/query';
import { aiSegments, closestOnSegment, dist, segmentMidpoint, settleRamps } from '../terrain/geometry';
import { clearMarkerSpot } from '../terrain/markers';
import { destinationToward, leadingModel, leadingModelByPath, nearestEnemyByPath } from '../sense/query';
import { aiUnitSize, normalizePlayerUnit, playerUnitDef, playerUnitFlying, playerUnitSize, playerUnitSupply } from '../sense/playerUnits';
import { completeSaves, resolveAttack, rollCharge, targetNumber, type AttackParams } from '../combat/resolve';
import { suggestedMarkerControl } from '../sense/query';
import { missionOutcome } from '../missions/stakes';
import { useReward } from '../missions/sideMarkers';
import { adjustModelDisplacing, baseFits, closeRanksPositions, shapeAt, combatRanks, pathOptionsFor, placeUnit, standingPieces, unitShapes, edgeDistance, edgeToPoint, contactPointAlong, syncModelPositions, unitGap, unitsEngaged, chargeEndProblem, coherencyProblem, refreshCoherency, ENGAGEMENT_IN, type PlaceOptions, type Shape } from '../sense/placement';
import { abilityGap, abilityGapToPoint, aiEvadeReason, aiPos, checkAttack, checkCharge, checkCloseRanks, checkDeploy, checkMove, chargeOptions, playerMoveReach, damageHelpers, playerAvailable, playerPos, playerWeapons } from '../player/rules';
import { visibleEnemies, engagedWith as aiEngagedWith } from '../sense/query';
import { availableWeapons, weaponModels } from '../units/weapons';
import { alongPath, shortestPath, passable, losBetweenBases } from '../sense/geometry2d';
import { speedFor } from '../units/speed';
import { reactionOffers, type ReactionOffer } from '../player/reactions';
import type { PendingReaction } from '../types/game';

export type Command =
  | { t: 'continue' }
  | { t: 'orderReport'; report: string; enemySupply?: number; models?: number }
  | { t: 'playersDone' }
  | { t: 'playersPass' }
  | { t: 'endActivation' }
  /** Combat phase: press into the fight before attacking (Leading Model up to 3"). */
  | { t: 'playerCloseRanks'; unitId: string; point: { x: number; y: number }; /** The model you picked to lead this action (0 = the current leader). */ leaderIndex?: number }
  /** Fine-tune one of your models to match the table (legal spot only). */
  | { t: 'adjustModel'; unitId: string; index: number; point: { x: number; y: number } }
  /** End of the Round: use or decline a Shade transfer or a drop-point deploy. */
  | { t: 'endOfRoundEffect'; tokenId: string; accept: boolean; unitId?: string }
  | { t: 'damage'; unitId: string; dmg: number; maxRemovable?: number; queen?: boolean }
  | { t: 'setModels'; unitId: string; models: number }
  | { t: 'heal'; unitId: string; amount: number }
  /** Put a DEBUFF on an AI unit (amount 0 lifts that one). */
  | { t: 'aiDebuff'; unitId: string; stat: 'speed' | 'hit' | 'armour' | 'evade'; amount: number }
  | { t: 'setEngaged'; unitId: string; engaged: boolean; enemySupply?: number }
  /** The table corrects whether an AI unit is BURROWED. */
  | { t: 'setBurrowed'; unitId: string; on: boolean }
  | { t: 'setAtObjective'; unitId: string; at: boolean }
  | { t: 'checklistDone' }
  /** Use a side marker's reward this round: a unit reward names the unit, a Requisition without an owner names the player. */
  | { t: 'useReward'; rewardId: string; unitId?: string; owner?: number }
  | { t: 'scoring'; answers: ScoringAnswers }
  | { t: 'sense'; snapshot: SenseSnapshot }
  | { t: 'setPlayerUnits'; units: PlayerUnit[] }
  | { t: 'playerDamage'; unitId: string; dmg: number }
  | { t: 'setPlayerModels'; unitId: string; models: number }
  | { t: 'setPlayerDestroyed'; unitId: string; destroyed: boolean }
  | { t: 'setUnitPosition'; side: 'ai' | 'players'; unitId: string; point: { x: number; y: number } }
  | { t: 'playerDeploy'; unitId: string; point: { x: number; y: number } }
  | { t: 'playerMove'; unitId: string; point: { x: number; y: number }; kind: 'move' | 'run' | 'disengage'; /** The model you picked to lead this action (0 = the current leader). */ leaderIndex?: number }
  | { t: 'playerHold'; unitId: string }
  | { t: 'playerAttack'; unitId: string; weaponId: string; targetId: string; models?: number; /** Your attack dice, rolled in the app or entered from the table. */ rolls?: number[]; /** Your Surge die, if you rolled it. */ surge?: number; /** The target's Armour and Evade dice, rolled step by step in the Combat Tray. */ saveRolls?: number[]; evadeRolls?: number[] }
  | { t: 'playerCharge'; unitId: string; targetId: string; /** Your charge die (D6): the higher one when two were rolled. */ roll?: number; /** Every die rolled for the Charge Distance (2D6 keeps the higher). */ rolls?: number[]; /** Your IMPACT dice for Devastating Charge (rolled once the charge succeeds). */ impactRolls?: number[]; /** The target's Armour and Evade dice against IMPACT, rolled step by step in the Combat Tray. */ impactSaveRolls?: number[]; impactEvadeRolls?: number[]; /** The model you picked to lead this action (0 = the current leader). */ leaderIndex?: number }
  | { t: 'enterSaves'; saved: number; /** Boost cards used (TOUGH, damage reduction). */ boostCards?: string[]; /** Reaction abilities used: unit id + ability name. */ reactions?: { unitId: string; name: string; reduce: number }[]; /** Evade Roll successes against the damage pool (when eligible). */ evaded?: number }
  | { t: 'aiResolve' }
  | { t: 'useAbility'; unitId: string; name: string; payWith?: string[]; friendlyId?: string; enemyId?: string; point?: { x: number; y: number }; option?: number }
  | { t: 'damageReaction'; key?: string }
  | { t: 'useBoost'; cardId: string; boost: string; unitId?: string; friendlyId?: string; enemyId?: string; point?: { x: number; y: number } }
  | { t: 'playerPlace'; unitId: string; point: { x: number; y: number }; /** The model you picked to lead this action (0 = the current leader). */ leaderIndex?: number }
  | { t: 'playerBonusMove'; unitId: string; point: { x: number; y: number }; /** The model you picked to lead this action (0 = the current leader). */ leaderIndex?: number }
  | { t: 'setOptions'; options: Partial<GameState['config']['options']> };

/** A Roll-Off (Part 3.2): both sides roll 2D6, the higher total wins, and ties are re-rolled. */
function rollOff(rng: Rng): Side {
  for (let i = 0; i < 50; i++) {
    const ai = rng.d6() + rng.d6(), players = rng.d6() + rng.d6();
    if (ai !== players) return ai > players ? 'ai' : 'players';
  }
  return 'players';
}

function ctxFor(state: GameState): MissionCtx & { rng: Rng } {
  const rng = new Rng(state.rng);
  const ctx: MissionCtx & { rng: Rng } = {
    state,
    rng,
    log: (text: string) => pushLog(state, 'system', text),
  };
  return ctx;
}

function commitRng(state: GameState, rng: Rng): void {
  state.rng = rng.state;
}

/** Record a presentation event (kept for the last 200). */
type EventInput = GameEvent extends infer E ? (E extends GameEvent ? Omit<E, 'id' | 'round'> : never) : never;
function emit(state: GameState, e: EventInput): void {
  state.eventSeq = (state.eventSeq ?? 0) + 1;
  state.events = [...(state.events ?? []).slice(-199), { ...e, id: state.eventSeq, round: state.round } as GameEvent];
}

function pushLog(state: GameState, side: Side | 'system', text: string): void {
  const e: LogEntry = { round: state.round, phase: state.phase, side, text };
  state.log.push(e);
  if (state.log.length > 400) state.log.shift();
}

export function createGame(config: GameConfig, deployment: DeploymentLayout, terrain: TerrainLayout): GameState {
  // Whatever built the table, every ramp opens onto clear ground.
  settleRamps(terrain.pieces, terrain.table);
  const mode = modeById(config.modeId);
  const rng = Rng.from(config.seed);
  const base = mode.supply?.(config.scale) ?? defaultSupply(config.scale);
  const sup = supplyFor(config.scale, config.difficulty, config.players, base);
  if (hasMutator({ config } as GameState, 'outbreak')) sup.escalation += 1;
  const diff = DIFFICULTIES[config.difficulty];
  const state: GameState = {
    version: 1,
    config: structuredClone(config),
    status: 'playing',
    round: 0,
    finalRound: mode.rounds,
    phase: 'movement',
    firstPlayer: 'players',
    nextFirstPlayer: null,
    turn: 'players',
    passed: { ai: false, players: false },
    supply: { start: sup.start, escalation: sup.escalation, pool: sup.start, bonus: 0 },
    vp: { ai: 0, players: 0 },
    aiSupplyLostThisRound: 0,
    playerSupplyLostThisRound: 0,
    markers: placeMarkers(deployment.markers, terrain.pieces).map(({ m, spot }) => ({
      id: m.id,
      ...spot,
      affinity: m.id === 5 ? 'neutral' : m.id === 1 || m.id === 3 ? 'ai' : 'players',
      controlledBy: null,
      active: true,
    })),
    army: structuredClone(config.army),
    respawnQueue: [],
    // Minerals the collection could not field are spent bringing destroyed units back (see aiDropsAnywhere).
    respawnBudget: (diff.respawn.mode === 'pooled' ? Math.round(config.army.budget * diff.respawn.poolPct) : diff.respawn.mode === 'unlimited' ? Infinity : 0)
      + (config.options.aiDropsAnywhere ? Math.max(0, config.army.budget - config.army.spent) : 0),
    lowSupplyRounds: 0,
    orderDeck: { draw: [], discard: [], current: null, history: [] },
    modeState: {},
    terrain,
    deployment,
    step: { kind: 'ROUND_START', lines: [] },
    rng: rng.state,
    log: [],
    labelCounters: {},
    playerUnits: structuredClone(config.playerUnits ?? []).map(normalizePlayerUnit),
    playerSupply: base,
    attackLog: [],
    // A card belongs to the player who brought it: in a co-op game only they may Exhaust it to pay.
    playerCards: (config.playerCards ?? []).map((c, i) => {
      const defId = typeof c === 'string' ? c : c.defId;
      return { id: `card-${i}-${defId}`, defId, exhausted: false, owner: typeof c === 'string' ? 0 : c.owner };
    }),
    tokens: [],
  };
  for (const u of state.army.units) {
    u.location = 'reserves';
    u.statuses = (u.statuses ?? []).filter((x) => x !== 'Siege Mode');
    u.activated = { movement: false, assault: false, combat: false };
  }
  // In the simulation every unit is where the map says: engagement and control come from positions, never asked.
  if (config.playMode === 'video') state.sense = { at: 0, calibrated: true, manual: true, ai: {}, players: {}, terrain: {}, unknown: [] };
  const ctx = ctxFor(state);
  const deckIds = mode.deck?.(config.aiFaction) ?? deckFor(config.aiFaction);
  state.orderDeck = initDeck(deckIds, ctx.rng);
  mode.onSetup(ctx);
  // Roll-off for round 1 first player: the winner would choose; give it to the roll winner.
  state.firstPlayer = rollOff(ctx.rng);
  commitRng(state, ctx.rng);
  pushLog(state, 'system', `Game created: ${mode.name}, ${diff.name}, ${config.players} player(s), AI ${config.aiFaction} (${config.army.spent} minerals).`);
  startRound(state, mode);
  return state;
}

function resetActivations(state: GameState): void {
  for (const u of state.army.units) {
    u.activated = { movement: false, assault: false, combat: false };
    u.disengagedThisRound = false;
    // DEBUFFs and the buffs of its action cards last until the End of the Round.
    delete u.statDebuffs;
    delete u.buffs;
    delete u.fx;
  }
  state.reacted = [];
  for (const pu of state.playerUnits) {
    pu.activated = { movement: false, assault: false, combat: false };
    pu.disengagedThisRound = false;
  }
  state.activeUnitId = null;
  for (const p of state.playerUnits) p.mayAdjust = false;
  // The round's attacks leave the log; what they removed is kept for the debrief.
  const before = state.removedBefore ?? { ai: 0, players: 0 };
  for (const a of state.attackLog) {
    if (a.attacker.side === 'players') before.ai += a.removed;
    else before.players += a.removed;
  }
  state.removedBefore = before;
  state.attackLog = [];
}

function startRound(state: GameState, mode: MissionMode): void {
  state.round += 1;
  state.phase = 'movement';
  state.aiSupplyLostThisRound = 0;
  state.playerSupplyLostThisRound = 0;
  state.modeState['avengerActive'] = false;
  state.modeState['barrierUsed'] = {};
  state.modeState['hardenedUsed'] = false;
  resetActivations(state);
  const ctx = ctxFor(state);
  const lines: string[] = [];
  const returned = processReturns(state);
  lines.push(...returned);
  if (state.round > 1) lines.push(...refreshPlayerSide(state));
  state.orderDeck = drawCard(state.orderDeck, ctx.rng);
  const card = currentCard(state.orderDeck);
  mode.onRoundStart(ctx);
  assignObjectives(state, mode, ctx);
  commitRng(state, ctx.rng);
  const pool = poolNow(state);
  state.supply.pool = pool;
  lines.unshift(`Round ${state.round} of ${state.finalRound}. AI Supply Pool: ${pool === Infinity ? 'unlimited (final round)' : pool}. First Player: ${state.firstPlayer === 'ai' ? 'the AI' : 'the players'}.`);
  // A card's special that is a bonus beyond the rulebook (Stim, Khala Link, Dig In) is for the AI playing blind:
  // it applies, and is announced, only with no map in play. The others need the Tactical card that gives the ability.
  const bonusOnly = card.id === 'stim' || card.id === 'khalaLink' || card.id === 'digIn';
  const needsCard = card.id === 'dustOff' ? 'Ready For Dust-off' : card.id === 'warpIn' ? 'Warp In' : null;
  const special = card.special && (noMap(state) || (!bonusOnly && (!needsCard || aiHasBoost(state, needsCard)))) ? ` ${card.special}` : '';
  lines.push(`AI order: ${card.name.toUpperCase()}. ${card.flavor}${special}`);
  const notes = mode.roundNotes?.(ctx) ?? [];
  lines.push(...notes);
  // Medic heal prompt (simplified ability kit).
  const medics = onTable(state).filter((u) => u.defId === 'medic');
  if (medics.length) lines.push('Medics: each damaged Biological AI Unit within 4" of a Medic Unit heals 1 damage per Medic model. Remove it from the unit\'s card.');
  pushLog(state, 'system', `Round ${state.round} begins. Order card: ${card.name}.`);
  state.step = { kind: 'ROUND_START', lines };
}

const NEXT_PHASE: Record<Phase, Phase | null> = { movement: 'assault', assault: 'combat', combat: 'scoring', scoring: null };
const PHASE_NAME: Record<Phase, string> = { movement: 'Movement', assault: 'Assault', combat: 'Combat', scoring: 'Scoring & Cleanup' };

function startPhase(state: GameState, mode: MissionMode, phase: Phase): void {
  state.phase = phase;
  state.passed = { ai: false, players: false };
  state.nextFirstPlayer = null;
  state.turn = state.firstPlayer;
  pushLog(state, 'system', `${PHASE_NAME[phase]} phase. First Player: ${state.firstPlayer === 'ai' ? 'the AI' : 'the players'}.`);
  if (phase === 'combat') {
    if (state.sense?.calibrated) {
      // Engagement is computed from positions; go straight to the fighting.
      const anyEngaged = onTable(state).some((u) => u.engaged) || state.playerUnits.some((p) => p.location === 'table' && !p.destroyed && p.engaged);
      if (!anyEngaged) {
        pushLog(state, 'system', 'No Units are Engaged. The Combat phase is skipped.');
        state.passed = { ai: true, players: true };
        endPhase(state, mode);
        return;
      }
      advanceTurn(state, mode);
      return;
    }
    state.step = { kind: 'COMBAT_CHECKLIST' };
    return;
  }
  if (phase === 'scoring') {
    const prompts = mode.scoringPrompts(ctxFor(state));
    if (state.config.playMode === 'video') {
      // The simulation knows where everything is: the round scores itself, into the end-of-round report.
      doScoring(state, mode, autoAnswers(state, prompts));
      return;
    }
    // The prompts go into the state (which is cloned), so without their `auto` functions.
    state.step = { kind: 'SCORING_FORM', prompts: prompts.map(({ auto: _auto, ...rest }) => rest) };
    return;
  }
  // The banner's title names the phase: the first line goes straight to who acts first.
  const lines = [`${state.firstPlayer === 'ai' ? 'The AI activates' : 'You activate'} first.`];
  if (phase === 'movement') lines.push(`AI Supply available to deploy: ${availableNow(state) === Infinity ? 'unlimited' : availableNow(state)} of ${poolNow(state) === Infinity ? '∞' : poolNow(state)}.`);
  if (phase === 'assault') lines.push('Ranged Attacks, Charges and Runs. The AI\'s dice are rolled on each order.');
  state.step = { kind: 'PHASE_START', lines };
}

/**
 * The Mission Markers where the deployment card puts them, each one on terrain moved clear of it: never onto
 * another marker (the ones already placed, and the card spots of the ones still to come).
 */
function placeMarkers<M extends { id: number; x: number; y: number }>(markers: M[], pieces: GameState['terrain']['pieces']): { m: M; spot: ReturnType<typeof clearMarkerSpot> }[] {
  const out: { m: M; spot: ReturnType<typeof clearMarkerSpot> }[] = [];
  markers.forEach((m, i) => {
    const others = [...out.map((o) => o.spot), ...markers.slice(i + 1)];
    out.push({ m, spot: clearMarkerSpot(m, pieces, others) });
  });
  return out;
}

function aiPass(state: GameState): void {
  state.passed.ai = true;
  if (!state.passed.players && state.nextFirstPlayer === null) state.nextFirstPlayer = 'ai';
  pushLog(state, 'ai', 'The AI passes.');
  for (const u of onTable(state)) u.activated[state.phase as 'movement' | 'assault' | 'combat'] = true;
}

function advanceTurn(state: GameState, mode: MissionMode): void {
  // The Activation is over: each player may again resolve one Reaction in the next (Part 10.4).
  state.reacted = [];
  // Enough turns for every held unit with nothing to shoot to stand down in one go.
  for (let guard = 0; guard < 8 + state.army.units.length; guard++) {
    if (state.passed.ai && state.passed.players) {
      endPhase(state, mode);
      return;
    }
    if (state.turn === 'ai') {
      if (state.passed.ai) {
        state.turn = 'players';
        continue;
      }
      const ctx = ctxFor(state);
      let order: AiOrder | null = null;
      // Passing early is for when nothing is waiting to come on: with anything deployable, the AI deploys instead.
      if (!(state.phase === 'movement' && shouldPassEarly(state) && !deployable(state, mode, ctx).length)) order = decideAi(state, mode, ctx, ctx.rng);
      if (order) order = cardOrder(state, order, ctx.rng);
      // With no map in play there is nothing seen to read positions from: the order stays as the table will run it.
      if (order) order = withCardText(state, noMap(state) ? order : applySense(state, order, ctx.rng));
      commitRng(state, ctx.rng);
      if (order && (order.type === 'ranged' || order.type === 'charge' || order.type === 'closeCombat')) {
        // Check now whether the attack can happen, so the player is never asked to resolve an attack that cannot.
        const intent = aiIntent(state, order);
        if (order.held && order.type === 'charge' && intent.attack !== false) {
          // A held unit only charges what is surely within reach: Speed + 4".
          const u = state.army.units.find((x) => x.id === order!.unitId)!;
          const reach = speedFor(unitById(u.defId), u.models) + speedModFor(state, u) + 4;
          const near = state.playerUnits.some((pu) => pu.location === 'table' && !pu.destroyed && unitGap(state, 'ai', u.id, 'players', pu.id) <= reach);
          if (!near) intent.attack = false;
        }
        if (intent.attack === false && (order.held || order.noRun)) {
          // Holding its ground with nothing in range: it waits, and the AI's turn goes to another unit.
          const u = state.army.units.find((x) => x.id === order!.unitId);
          if (u) u.activated[state.phase as 'movement' | 'assault' | 'combat'] = true;
          pushLog(state, 'ai', `${u?.label ?? 'AI unit'} holds its ground.`);
          continue;
        }
        if (intent.attack === false) {
          order.noTarget = true;
          // One action per activation: this unit now runs, so running is the only thing to report.
          order.reports = order.reports.filter((r) => r.id === 'noTarget');
          const u = state.army.units.find((x) => x.id === order!.unitId);
          if (u && order.type !== 'closeCombat') {
            const saved = u.est;
            advanceEstimate(state, u, order, 'noTarget');
            if (u.est) order.preview = { ...u.est };
            u.est = saved;
          }
          order.title = `${state.army.units.find((x) => x.id === order!.unitId)?.label ?? 'AI unit'}: ${order.type === 'closeCombat' ? 'No fight' : 'Run (no target)'}`;
          order.lines = [intent.reason, ...order.lines];
        } else if (intent.attack) {
          order.intentTarget = intent.target;
        }
      }
      if (order && (order.type === 'deploy' || order.type === 'move' || order.type === 'run' || order.type === 'disengage')) {
        // Work out where the unit ends up now, so the map can show it before the player mirrors it on the table.
        const u = state.army.units.find((x) => x.id === order!.unitId);
        if (u) {
          const saved = u.est;
          advanceEstimate(state, u, order, 'done');
          if (u.est) order.preview = { ...u.est };
          u.est = saved;
        }
      }
      if (order) {
        // Regeneration (Assault Phase): a Burrowed unit resolves HEAL (2) when it becomes Activated.
        const acting = state.army.units.find((x) => x.id === order!.unitId);
        if (acting && state.phase === 'assault' && aiBurrowed(acting) && aiHas(acting, 'Regeneration') && acting.damageMarker > 0) {
          const healed = Math.min(2, acting.damageMarker);
          acting.damageMarker -= healed;
          pushLog(state, 'ai', `Regeneration: ${acting.label} heals ${healed}.`);
        }
        state.step = { kind: 'AI_ORDER', order };
        pushLog(state, 'ai', order.title);
        return;
      }
      aiPass(state);
      state.turn = 'players';
      continue;
    }
    if (state.passed.players) {
      state.turn = 'ai';
      continue;
    }
    const lines = [state.phase === 'combat' ? 'Activate one of your Engaged Units and fight, then tap Done. Pass when none remain.' : 'Activate one of your Units, then tap Done, or Pass. The first side to pass activates first in the next phase.'];
    state.step = { kind: 'PLAYERS_TURN', lines };
    return;
  }
}

function endPhase(state: GameState, mode: MissionMode): void {
  state.activeUnitId = null;
  if (state.phase === 'assault') burstBile(state, mode);
  if (state.nextFirstPlayer) state.firstPlayer = state.nextFirstPlayer;
  const next = NEXT_PHASE[state.phase];
  if (next) startPhase(state, mode, next);
}

/**
 * Corrosive Bile goes off at the End of the Assault Phase: every unit within reach of a glob takes HITS 5 (1)
 * from each one it is near, and then the globs are gone (they burn out whether or not the Ravagers still live).
 */
function burstBile(state: GameState, mode: MissionMode): void {
  const globs = (state.tokens ?? []).filter((t) => t.kind === 'bile');
  if (!globs.length) return;
  // Within reach of a token: from the nearest base edge of the unit to the token.
  const nearTo = (shapes: Shape[]) => globs.filter((g) => shapes.some((sh) => edgeToPoint(sh, g) <= (g.radius ?? 1) + 0.05));
  for (const u of state.army.units) {
    if (u.location !== 'table') continue;
    const shapes = unitShapes(state, 'ai', u.id);
    const near = shapes.length ? nearTo(shapes) : globs.filter((g) => !!u.est && Math.hypot(u.est.x - g.x, u.est.y - g.y) <= (g.radius ?? 1) + 0.05);
    if (!near.length) continue;
    // Potent Bile: the acid eats at their armour before they roll.
    const potent = near.some((g) => state.playerUnits.some((p) => p.id === g.ownerId && hasAbility(p, 'Potent Bile')));
    pushHits(state, u, 5 * near.length, 1, 'Corrosive Bile', potent ? 1 : 0);
  }
  // "Each Unit": the bile does not spare its own side. Your units standing in it take the same hits.
  const ctx = ctxFor(state);
  for (const pu of state.playerUnits) {
    if (pu.location !== 'table' || pu.destroyed) continue;
    const near = nearTo(unitShapes(state, 'players', pu.id));
    if (!near.length) continue;
    const pdef = playerUnitDef(pu);
    const weapon = { id: 'hits', name: 'Corrosive Bile', phase: 'Assault' as const, range: 'E' as const, target: 'All' as const, roa: 5 * near.length, hit: 2, dmg: 1, surgeTypes: [], keywords: [], text: '' };
    const a = resolveAttack(ctx.rng, {
      attacker: { side: 'ai', unitId: 'Corrosive Bile', label: 'Corrosive Bile' },
      defender: { side: 'players', unitId: pu.id, label: pu.name },
      weapon, models: 1, phase: 'Assault', presetRolls: Array(weapon.roa).fill(6),
      defenderDef: pdef, defenderHp: unitHp(pdef, pu.upgrades),
      defenderState: { models: pu.models, damageMarker: pu.damageMarker, shieldsLeft: pu.shieldsLeft },
      evadeReason: isHidden(pu) ? 'Hidden' : hasAbility(pu, 'Precognition') ? 'Precognition' : activeEffects(pu).some((e) => e.mods.evadeMelee) ? 'Combat Shield' : null,
      tough: passiveToughFor(pu).tough,
    });
    const r = applyDamage(pdef, { models: pu.models, damageMarker: pu.damageMarker, shieldsLeft: pu.shieldsLeft }, a.damage, { hp: unitHp(pdef, pu.upgrades) });
    applyToPlayer(state, pu, r, null);
    state.lastAttack = a;
    state.attackLog.push(a);
    emit(state, { kind: 'attack', attack: a });
    pushLog(state, 'players', `Corrosive Bile: ${pu.name} takes ${weapon.roa} hits, ${a.damage} damage${r.removed ? `, ${r.removed} model(s) lost` : ''}.`);
  }
  commitRng(state, ctx.rng);
  for (const g of globs) removeToken(state, g.id);
  resolvePendingHits(state, mode);
}

/**
 * HITS X (Y) queued by an ability: X dice straight into the target's Armour Pool at Y damage each, no Surge.
 * The AI rolls its own armour here, as it does for anything it is not asked to confirm.
 */
function resolvePendingHits(state: GameState, mode: MissionMode): void {
  const queued = state.pendingHits ?? [];
  if (!queued.length) return;
  state.pendingHits = [];
  const ctx = ctxFor(state);
  for (const q of queued) {
    const u = state.army.units.find((x) => x.id === q.targetId);
    if (!u || u.location !== 'table') continue;
    const tdef = unitById(u.defId);
    const before = currentSupply(tdef, u.models);
    // HITS X (Y): X automatic hits, set straight into the Armour Pool (no Hit roll, no Surge), then Armour and Evade.
    const weapon = { id: 'hits', name: q.source, phase: 'Assault' as const, range: 'E' as const, target: 'All' as const, roa: q.hits, hit: 2, dmg: q.dmgPer, surgeTypes: [], keywords: [], text: '' };
    const a = resolveAttack(ctx.rng, {
      attacker: { side: 'players', unitId: q.source, label: q.source },
      defender: { side: 'ai', unitId: u.id, label: u.label },
      weapon, models: 1, phase: 'Assault', presetRolls: Array(q.hits).fill(6),
      defenderDef: tdef, defenderHp: unitHp(tdef, u.upgrades),
      defenderState: { models: u.models, damageMarker: u.damageMarker, shieldsLeft: u.shieldsLeft },
      armourMod: (q.armourMod ?? 0) + aiDebuff(u, 'armour') - aiArmourBonus(state, u),
      evadeMod: aiDebuff(u, 'evade'),
      evadeReason: aiEvadeReason(state, u, 'Combat'),
    });
    applyDamageToAi(state, mode, u, a.damage, before);
    state.lastAttack = a;
    state.attackLog.push(a);
    emit(state, { kind: 'attack', attack: a });
    pushLog(state, 'players', `${q.source}: ${u.label} takes ${q.hits} hits, ${a.damage} damage${a.removed ? `, ${a.removed} model(s) removed` : ''}${a.destroyed ? '. Destroyed' : ''}.`);
  }
  commitRng(state, ctx.rng);
}

/** Where an order is heading, in inches, from the estimated position. */
function headingPointFor(state: GameState, u: AiUnitInstance, from: { x: number; y: number }): { x: number; y: number } {
  const h = u.objective;
  const t = state.terrain.table;
  if (h.kind === 'marker') {
    const m = state.markers.find((x) => x.id === h.markerId);
    if (m) return { x: m.x, y: m.y };
  }
  if (h.kind === 'point') return { x: h.x, y: h.y };
  if (h.kind === 'lane') return { x: h.toEdge === 'E' ? t.width : 0, y: from.y };
  if (h.kind === 'follow') {
    const b = state.army.units.find((x) => x.id === h.unitId);
    if (b?.est) return b.est;
  }
  if (h.kind === 'enemy') {
    const e = nearestEnemyByPath(state, u, true);
    if (e && e.models[0]) return e.models[0];
    // No camera: assume the enemy is across the table.
    const blue = state.deployment.entry.blue.map((sg) => segmentMidpoint(sg, t));
    if (blue.length) return blue.reduce((a, b) => (dist(a, from) <= dist(b, from) ? a : b));
  }
  return { x: t.width / 2, y: t.height / 2 };
}

/**
 * The model of an AI unit that leads it toward a point: the one already closest, made the unit's Leading Model
 * so the move is measured from it (the rules let the controller choose). Null when the unit's models are unknown.
 */
function leadFor(state: GameState, u: AiUnitInstance, target: Pt): Pt | null {
  const pts = state.sense?.ai[u.id];
  if (!pts?.length) return null;
  const lead = leadingModelByPath(state, u, target) ?? leadingModel(pts, target);
  state.sense!.ai[u.id] = [lead, ...pts.filter((p) => p !== lead)];
  return lead;
}

/** Update the estimated position after an order is resolved (no camera needed). */
function advanceEstimate(state: GameState, u: AiUnitInstance, order: AiOrder, report: string): void {
  const def = unitById(u.defId);
  const speed = speedFor(def, u.models) + speedModFor(state, u);
  const t = state.terrain.table;
  // Set down where a dropship put it (Ready for Pickup?): it stands there, whatever it was doing.
  if (order.pickupTo) { u.est = { ...order.pickupTo }; return; }
  if (order.type === 'deploy') {
    // Set down away from the edge (a collection too small for the players' armies, or Dust-off): it stands where it was dropped.
    if (order.dropAt) { u.est = { ...order.dropAt }; return; }
    const target = headingPointFor(state, u, { x: t.width / 2, y: t.height / 2 });
    const segs = aiSegments(state.deployment);
    const entries = segs.map((sg) => closestOnSegment(sg, t, target));
    const entry = entries.reduce((a, b) => (dist(a, target) <= dist(b, target) ? a : b), entries[0] ?? { x: t.width / 2, y: t.height });
    let dest = destinationToward(state, entry, target, Math.max(2, speed), pathOptionsFor(state, 'ai', u.id)).point;
    // A Unit arriving from Reserves cannot end in the players' Zone of Influence: it stops short of it.
    for (let back = 0.5; inPlayerZoi(state, dest) && back <= dist(entry, dest); back += 0.5) {
      const len = dist(entry, dest) || 1;
      dest = { x: dest.x + ((entry.x - dest.x) / len) * 0.5, y: dest.y + ((entry.y - dest.y) / len) * 0.5 };
    }
    u.est = dest;
    return;
  }
  // Where the unit actually stands on the map is the truth: its leader may have been set beside a crowded
  // spot, or moved by a charge or Close Ranks. Advance from there, never from an older estimate.
  const onMap = state.sense?.ai[u.id]?.[0];
  if (onMap) u.est = { x: onMap.x, y: onMap.y };
  if (order.placed && onMap) return;
  const from = u.est ?? headingPointFor(state, u, { x: t.width / 2, y: t.height / 2 });
  if (report === 'reached' && u.objective.kind === 'marker') {
    const m = state.markers.find((x) => x.id === (u.objective as { markerId: number }).markerId);
    if (m) u.est = { x: m.x, y: m.y };
    return;
  }
  const moving = order.type === 'move' || order.type === 'run' || order.type === 'disengage' || ((order.type === 'ranged' || order.type === 'charge') && report === 'noTarget' && !order.held && !order.noRun);
  if (moving || (order.type === 'charge' && report === 'charged')) {
    const target = headingPointFor(state, u, from);
    // Which model leads is a choice, and the unit takes the shortest way: the model already nearest where it is
    // going leads it there, instead of the whole unit setting out from whichever model happened to lead before.
    const lead = leadFor(state, u, target) ?? from;
    const opts = pathOptionsFor(state, 'ai', u.id);
    let used = opts;
    let d = destinationToward(state, lead, target, moving ? speed : speed + 3, opts, u.defId);
    // A big base passes through a gap it cannot stop in (Part 4.6). When the move would leave it in such a gap, it
    // takes the way round that is wide enough for its whole base instead of stalling at the mouth every turn.
    const fitsAt = (p: Pt) => baseFits(state, 'ai', u.id, { ...shapeAt(u.defId, p), a: Math.atan2(p.y - lead.y, p.x - lead.x) }, [], { leader: true });
    if (moving && !fitsAt(d.point)) {
      const b = shapeAt(u.defId, lead);
      const wideOpts = { ...opts, clearance: Math.max(opts.clearance ?? 0, b.r - 0.1) };
      const wide = destinationToward(state, lead, target, speed, wideOpts, u.defId);
      if (fitsAt(wide.point) && Math.hypot(wide.point.x - lead.x, wide.point.y - lead.y) > 0.25) { d = wide; used = wideOpts; }
    }
    // The unit re-forms around its Leading Model, so a destination that leaves it further from its goal than the
    // ground it already holds would walk the whole unit backwards. Further by the walk, not as the crow flies: a
    // way round a rock starts sideways, and that is still progress.
    const held = (state.sense?.ai[u.id] ?? []).reduce<Pt | null>((best, p) => (!best || dist(p, target) < dist(best, target) ? p : best), null);
    // Measured the way it is going: round the corridor when it had to take the way round.
    const heldLeft = held ? shortestPath(held, target, state.terrain.pieces, state.terrain.table, used).length : Infinity;
    // A move never ends within Engagement Range of an enemy: only a Charge may do that. The leader stops short
    // along the way it came, as far back as it takes to be clear.
    const dest = moving ? stopShortOfEnemies(state, u, lead, d.point) : d.point;
    u.est = held && heldLeft <= d.remaining + 0.05 ? held : dest;
  }
}

/**
 * Where a move toward `to` must stop so the Leading Model's base ends more than 1" from every enemy base: `to`
 * itself when that is clear, else back along the line from `to` toward `from`, and `from` if nowhere is.
 */
function stopShortOfEnemies(state: GameState, u: AiUnitInstance, from: Pt, to: Pt): Pt {
  const foes = state.playerUnits.filter((p) => p.location === 'table' && !p.destroyed && !playerUnitFlying(p)).flatMap((p) => unitShapes(state, 'players', p.id));
  if (!foes.length) return to;
  const clear = (p: Pt) => { const me = shapeAt(u.defId, p); return foes.every((f) => edgeDistance(me, f) > ENGAGEMENT_IN + 0.05); };
  if (clear(to)) return to;
  const len = dist(from, to);
  for (let back = 0.25; back < len; back += 0.25) {
    const t = 1 - back / len;
    const p = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    if (clear(p)) return p;
  }
  return from;
}

function applyOrderReport(state: GameState, mode: MissionMode, report: string, extra: { enemySupply?: number }): void {
  if (state.step.kind !== 'AI_ORDER') return;
  const order = state.step.order;
  const u = findUnit(state, order.unitId);
  const phaseKey = state.phase as 'movement' | 'assault' | 'combat';
  u.activated[phaseKey] = true;
  if (order.type === 'deploy') {
    u.location = 'table';
    u.deployedRound = state.round;
    u.atObjective = false;
    pushLog(state, 'ai', `${u.label} deployed.`);
    // Warp In and Dust-off let one Unit a round come on another way: this one used it.
    if (order.usesRoundDeploy) state.modeState[`${order.usesRoundDeploy}Round`] = state.round;
  }
  if (order.pickupTo) {
    state.modeState['pickupUsed'] = [...((state.modeState['pickupUsed'] as string[] | undefined) ?? []), u.id];
    pushLog(state, 'ai', `${u.label} is picked up by dropship and set down again, still dug in.`);
  }
  if (order.type === 'special' && /siege mode/i.test(order.title)) {
    // The tank digs in or packs up: the Status is what its weapons, its Size and its movement all read from.
    const had = (u.statuses ?? []).includes('Siege Mode');
    u.statuses = had ? (u.statuses ?? []).filter((x) => x !== 'Siege Mode') : [...(u.statuses ?? []), 'Siege Mode'];
    pushLog(state, 'ai', `${u.label} ${had ? 'leaves SIEGE MODE' : 'deploys into SIEGE MODE'}.`);
  }
  if (order.type === 'disengage') {
    // Tactical Mass: its Supply (0 while BURROWED, 1 more for a Commander) against the enemies it was Engaged with.
    const s = aiBurrowed(u) ? 0 : currentSupply(unitById(u.defId), u.models) + (aiHas(u, 'Commander') ? 1 : 0);
    u.engaged = false;
    u.disengagedThisRound = !(s > u.engagedEnemySupply);
    u.engagedEnemySupply = 0;
    // Disengage ends BURROWED.
    if (aiBurrowed(u)) setAiBurrowed(u, false);
  }
  // Stationary is lost the moment a model of the unit moves, is moved or is PLACED.
  const went = order.type === 'deploy' || order.type === 'move' || order.type === 'run' || order.type === 'disengage' || !!order.pickupTo
    || report === 'charged' || report === 'exited' || ((order.type === 'ranged' || order.type === 'charge') && report === 'noTarget' && !order.held && !order.noRun);
  // Close Ranks ends BURROWED: a Burrowed unit that fights has surfaced.
  if (order.type === 'closeCombat' && aiBurrowed(u)) { setAiBurrowed(u, false); u.movedRound = state.round; pushLog(state, 'ai', `${u.label} surfaces to fight. BURROWED ends.`); }
  if (went) u.movedRound = state.round;
  if (report === 'reached') {
    u.atObjective = true;
    if (u.objective.kind === 'marker') u.lastMarker = u.objective.markerId;
  }
  if (report === 'charged') {
    u.engaged = true;
    u.engagedEnemySupply = extra.enemySupply ?? 1;
    u.atObjective = false;
  }
  if (report === 'exited') {
    u.location = 'exited';
    pushLog(state, 'ai', `${u.label} left the table.`);
  }
  const cameraSeen = state.sense?.calibrated && !state.sense.manual && !!state.sense.ai[u.id]?.length;
  if (!cameraSeen) {
    const lead = state.sense?.ai[u.id]?.[0];
    const before = lead ? { x: lead.x, y: lead.y } : u.est ? { ...u.est } : null;
    advanceEstimate(state, u, order, report);
    // Only a unit that actually went somewhere is set again: a failed charge or a unit that held stays put.
    const moved = !before || !u.est || Math.hypot(u.est.x - before.x, u.est.y - before.y) > 0.01 || !state.sense?.ai[u.id]?.length;
    // With no map in play the table is the only picture, so a guess is never set down as if seen.
    if (u.est && u.location === 'table' && !order.placed && moved && !noMap(state)) {
      const snap: SenseSnapshot = state.sense ?? { at: 0, calibrated: true, ai: {}, players: {}, terrain: {}, unknown: [], manual: true };
      if (snap.manual || !snap.calibrated) {
        snap.calibrated = true;
        snap.manual = true;
        state.sense = snap;
        // The way it walked: Grass and Force Fields it passes through are gone with it.
        const walked = before && order.type !== 'deploy' && !order.pickupTo ? shortestPath(before, u.est, state.terrain.pieces, state.terrain.table, pathOptionsFor(state, 'ai', u.id)).path : [];
        placeUnit(state, 'ai', u.id, u.est, { avoidEngaging: report !== 'charged', ...(walked.length >= 2 ? { path: walked } : {}) });
      }
    }
    // Auto "reached" when the estimate ends within 3" of the objective marker.
    if (u.est && u.objective.kind === 'marker' && report !== 'reached') {
      const m = state.markers.find((x) => x.id === (u.objective as { markerId: number }).markerId);
      if (m && dist(u.est, m) <= 3) {
        u.atObjective = true;
        u.lastMarker = m.id;
      }
    }
  }
  const ctx = ctxFor(state);
  mode.onOrderReport?.(ctx, u, report);
  commitRng(state, ctx.rng);
  // What the AI unit did, in words (the log line is the AI's, not the players').
  const said: Record<string, string> = { done: 'moved', reached: 'reached its marker', exited: 'left the table', noTarget: 'found no target and ran', attacked: 'attacked', charged: 'charged', chargeFailed: 'failed its charge' };
  pushLog(state, 'ai', `${u.label} ${said[report] ?? report}.`);
}

function applyDamageCmd(state: GameState, mode: MissionMode, cmd: Extract<Command, { t: 'damage' }>): void {
  const u = findUnit(state, cmd.unitId);
  const def = unitById(u.defId);
  let dmg = cmd.dmg;
  if (cmd.queen) dmg = Math.max(0, dmg - 2);
  if (hasMutator(state, 'diffusion') && dmg > 5) dmg = Math.ceil(dmg / 2);
  const barrierUsed = state.modeState['barrierUsed'] as Record<string, boolean>;
  if (hasMutator(state, 'barrier') && !barrierUsed[u.id]) {
    barrierUsed[u.id] = true;
    dmg = Math.max(0, dmg - 2);
  }
  const r = applyDamage(def, { models: u.models, damageMarker: u.damageMarker, shieldsLeft: u.shieldsLeft }, dmg, { maxRemovable: cmd.maxRemovable, hp: unitHp(def, u.upgrades) });
  if (r.destroyed && def.role === 'Hero' && hasMutator(state, 'hardenedWill') && !state.modeState['hardenedUsed']) {
    state.modeState['hardenedUsed'] = true;
    u.models = 1;
    u.damageMarker = def.stats.hp - 1;
    u.shieldsLeft = 0;
    pushLog(state, 'system', `${u.label} survives with 1 HP (Hardened Will).`);
    return;
  }
  u.models = r.models;
  u.damageMarker = r.damageMarker;
  u.shieldsLeft = r.shieldsLeft;
  dropCasualties(state, 'ai', u.id, r.models, nearestPlayerPoint(state, u));
  state.aiSupplyLostThisRound += Math.max(0, r.supplyBefore - r.supplyAfter);
  pushLog(state, 'players', `${u.label} takes ${dmg} damage${r.removed ? `, ${r.removed} model(s) removed` : ''}.`);
  if (r.destroyed) destroyUnit(state, mode, u);
}

function destroyUnit(state: GameState, mode: MissionMode, u: AiUnitInstance): void {
  u.location = 'destroyed';
  u.destroyedRound = state.round;
  delete u.est;
  u.engaged = false;
  u.engagedEnemySupply = 0;
  u.atObjective = false;
  pushLog(state, 'system', `${u.label} destroyed.`);
  emit(state, { kind: 'destroyed', side: 'ai', unitId: u.id, label: u.label });
  if (hasMutator(state, 'avenger')) state.modeState['avengerActive'] = true;
  const ctx = ctxFor(state);
  mode.onAiUnitDestroyed?.(ctx, u);
  commitRng(state, ctx.rng);
  if (state.step.kind === 'AI_ORDER' && state.step.order.unitId === u.id) {
    // The unit died before acting (e.g. reaction); skip its activation.
    state.turn = 'players';
    advanceTurn(state, mode);
  }
}

/** The scoring answers worked out from the map (the simulation): marker control by Supply within 3", each prompt's own reckoning. */
function autoAnswers(state: GameState, prompts: ScoringPrompt[]): ScoringAnswers {
  const extra: ScoringAnswers['extra'] = {};
  for (const p of prompts) {
    if (p.kind === 'markers') continue;
    extra[p.id] = p.auto ? p.auto(state) : p.kind === 'number' ? Number(p.defaultValue ?? 0) : Boolean(p.defaultValue ?? false);
  }
  return { markers: suggestedMarkerControl(state), playerSupplyLost: Number(extra['playerSupplyLost'] ?? state.playerSupplyLostThisRound ?? 0), extra };
}

function doScoring(state: GameState, mode: MissionMode, answers: ScoringAnswers): void {
  const ctx = ctxFor(state);
  const before = { ...state.vp };
  // Baseline: VP for enemy supply destroyed this round.
  state.vp.players += state.aiSupplyLostThisRound;
  state.vp.ai += Math.max(0, Math.floor(answers.playerSupplyLost));
  mode.onScoring(ctx, answers);
  const final = state.round >= state.finalRound;
  if (final) {
    const aiReserve = aiSupplyInReserves(state);
    state.vp.players += aiReserve;
    state.vp.ai += Math.max(0, Math.floor(Number(answers.extra['playerReserveSupply'] ?? 0)));
    if (aiReserve) ctx.log(`AI units still in Reserves count as destroyed: +${aiReserve} VP to the players.`);
  }
  let result = mode.winCheck(ctx, final);
  // End of Game Check (Part 8.9.3): a side with no models on the battlefield and no Units in Reserves ends the
  // game, and the surviving side gains 10 VP. An official mission is then decided on Victory Points.
  const byVp = (): 'won' | 'lost' | 'draw' => (state.vp.players > state.vp.ai ? 'won' : state.vp.players < state.vp.ai ? 'lost' : 'draw');
  const yours = state.playerUnits.filter((p) => !p.summoned);
  const playersAlive = !yours.length || yours.some((p) => !p.destroyed && (p.location === 'table' || p.location === 'reserves'));
  if (!result && !aiAlive(state)) {
    state.vp.players += 10;
    result = mode.official ? byVp() : 'won';
    ctx.log('The AI has no units left on the table or in Reserves: +10 VP.');
  } else if (!result && !playersAlive) {
    state.vp.ai += 10;
    result = mode.official ? byVp() : 'lost';
    ctx.log('You have no units left on the table or in Reserves: +10 VP to the AI.');
  }
  state.vpHistory = [...(state.vpHistory ?? []).filter((h) => h.round !== state.round), { round: state.round, players: state.vp.players, ai: state.vp.ai }];
  // The report: what each side scored this round and why, and where the markers stand.
  const lines: string[] = [`Round ${state.round} scored. Players ${state.vp.players} VP, AI ${state.vp.ai} VP.`];
  lines.push(`This round: you +${state.vp.players - before.players} VP (${state.aiSupplyLostThisRound} AI Supply destroyed), the AI +${state.vp.ai - before.ai} VP (${Math.max(0, Math.floor(answers.playerSupplyLost))} of your Supply destroyed).`);
  const active = state.markers.filter((m) => m.active);
  if (active.length) lines.push(`Markers: ${active.map((m) => `#${m.id} ${m.controlledBy === 'players' ? 'yours' : m.controlledBy === 'ai' ? 'AI' : 'nobody'}${m.locked ? ' (locked)' : ''}`).join(', ')}.`);
  if (result) {
    state.status = result;
    commitRng(state, ctx.rng);
    state.step = { kind: 'GAME_OVER', result, lines: [...lines, result === 'won' ? 'Victory. The players win.' : result === 'lost' ? 'Defeat. The AI wins.' : 'Draw.', missionOutcome(state, result)] };
    pushLog(state, 'system', `Game over: ${result}.`);
    return;
  }
  // Cleanup & refresh.
  lines.push(...scheduleRespawns(state));
  const floor = fairnessFloor(state);
  if (floor) lines.push(floor);
  // Initiative.
  if (state.vp.ai < state.vp.players) state.firstPlayer = 'ai';
  else if (state.vp.players < state.vp.ai) state.firstPlayer = 'players';
  else state.firstPlayer = rollOff(ctx.rng);
  lines.push(`First Player Marker goes to ${state.firstPlayer === 'ai' ? 'the AI' : 'the players'} (fewer VP${state.vp.ai === state.vp.players ? ', tie broken by roll-off' : ''}).`);
  lines.push(`AI on table: ${aiSupplyOnTable(state)} Supply. In Reserves: ${aiSupplyInReserves(state)} Supply.`);
  commitRng(state, ctx.rng);
  state.step = { kind: 'ROUND_END', lines };
}

/** Apply a command to a game state; returns a new state (input is not mutated). */
export function apply(prev: GameState, cmd: Command): GameState {
  // Any model can lead an action: the chosen model becomes the Leading Model before the rules measure from it.
  const lead = 'leaderIndex' in cmd && cmd.leaderIndex && 'unitId' in cmd ? { id: cmd.unitId, index: cmd.leaderIndex } : null;
  const base = lead ? withLeader(prev, lead.id, lead.index) : prev;
  const next = applyCommand(base, cmd);
  if (next === base && base !== prev) return prev;
  // Keep engagement in step with positions after anything that moves, removes or destroys units — in the
  // simulation and under a live camera. On the tabletop it is yours to call: the checklist and the toggle stand.
  if (next !== prev && next.sense?.calibrated) refreshEngagement(next, autoEngagement(next));
  return next;
}

/** A copy of the state where the given model of your unit is its Leading Model (first in the position list). */
/**
 * Everything `resolveAttack` needs for your attack command, without changing the state: the Combat Tray uses it to
 * preview each step (how many hits reach Armour, whether the target may Evade) before the attack is applied.
 */
export function playerAttackSetup(state: GameState, cmd: Extract<Command, { t: 'playerAttack' }>) {
  const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
  const target = state.army.units.find((x) => x.id === cmd.targetId);
  const weapon = pu ? playerWeapons(state, pu).find((w) => w.id === cmd.weaponId) : undefined;
  if (!pu || !target || !weapon) return null;
  const tdef = unitById(target.defId);
  const phase = weapon.phase === 'Combat' ? 'Combat' : 'Assault';
  // Ranges are measured base edge to base edge, between the closest models of the two units.
  const mine = unitShapes(state, 'players', pu.id), theirs = unitShapes(state, 'ai', target.id);
  const gap = mine.length && theirs.length ? Math.max(0, unitGap(state, 'players', pu.id, 'ai', target.id)) : null;
  const mod = weaponWithEffects(pu, weapon, target, gap, state);
  const w2 = mod.weapon;
  // Close combat: Fighting and Supporting Ranks strike (you can still set the number to match the table). A
  // SPECIALIST is fired by the one model carrying it; the models it takes a weapon from are that many fewer.
  const ranked = phase === 'Combat' ? combatRanks(state, 'players', pu.id, [target.id]).total : pu.models;
  const carrying = weaponModels(playerUnitDef(pu), pu.upgrades, phase, weapon, pu.models);
  let models = Math.max(1, Math.min(carrying, cmd.models ?? (ranked || pu.models)));
  // LONG RANGE: each model is measured on its own. One beyond the weapon's Range but within its LONG RANGE rolls
  // at -1 to Hit; one beyond that does not fire.
  let farModels = 0;
  if (phase === 'Assault' && w2.range !== 'E' && mine.length && theirs.length) {
    const r = w2.range as number;
    const lr = w2.keywords.find((k) => k.k === 'LONG RANGE')?.v ?? r;
    const reach = mine.map((m) => Math.max(0, Math.min(...theirs.map((t) => edgeDistance(m, t)))));
    const near = reach.filter((d) => d <= r + 0.01).length;
    const far = reach.filter((d) => d > r + 0.01 && d <= lr + 0.01).length;
    // Coordinated Strike ranges from the spotter: every model fires as if in Range.
    const spotted = activeEffects(pu).some((e) => e.mods.spotter) && near + far === 0;
    if (!spotted) {
      models = Math.max(1, Math.min(models, near + far));
      farModels = Math.max(0, models - near);
    }
  }
  const evadeReason = aiEvadeReason(state, target, phase, pu, w2);
  // No more models can be removed than are Visible to the attacker, unless the target is Engaged (Part 8.7.4-5)
  // or the weapon ignores Line of Sight.
  const blind = phase === 'Combat' || target.engaged || w2.keywords.some((k) => k.k === 'INDIRECT FIRE') || tdef.tags.includes('Flying');
  const maxRemovable = blind || !mine.length || !theirs.length ? undefined : theirs.filter((t) => mine.some((m) => losBetweenBases(m, playerUnitSize(pu), t, aiUnitSize(target), state.terrain.pieces))).length || undefined;
  const doctrine = DIFFICULTIES[state.config.difficulty].doctrineTier >= 1 && state.config.aiFaction === 'Terran' && !(state.modeState['toughUsed'] as Record<string, boolean> | undefined)?.[target.id] ? 1 : 0;
  const params: AttackParams = {
    attacker: { side: 'players', unitId: pu.id, label: pu.name },
    defender: { side: 'ai', unitId: target.id, label: target.label },
    weapon: w2, models, phase,
    farModels,
    defenderDef: tdef,
    defenderHp: unitHp(tdef, target.upgrades),
    defenderState: { models: target.models, damageMarker: target.damageMarker, shieldsLeft: target.shieldsLeft },
    evadeReason,
    armourMod: aiDebuff(target, 'armour') - aiArmourBonus(state, target),
    evadeMod: aiDebuff(target, 'evade'),
    // TOUGH does not stack: the unit's own (Heavy Plating, Ancillary Carapace, Shield Overcharge) or its doctrine's.
    toughFirst: Math.max(doctrine, aiPassiveTough(state, target, activationKey(state, pu.id)).tough),
    maxRemovable,
    presetRolls: cmd.rolls,
    // A Blast Template rolls no Surge die: its Surge is the number of models it covered.
    presetSurge: mod.blast ?? cmd.surge,
    presetSaves: cmd.saveRolls,
    presetEvade: cmd.evadeRolls,
  };
  return { pu, target, weapon, mod, params };
}

/** Within 3" of a Mission Marker: from the nearest base edge to the marker's edge. */
function onAMarker(state: GameState, shapes: Shape[]): boolean {
  return state.markers.some((m) => shapes.some((sh) => edgeToPoint(sh, m) - MARKER_RADIUS_IN <= 3.05));
}
/** Veteran of Tarsonis on an AI unit: +1 to Armour while Within 3" of a Mission Marker. */
function aiArmourBonus(state: GameState, u: AiUnitInstance): number {
  return armourBonus(unitById(u.defId), u.upgrades, onAMarker(state, unitShapes(state, 'ai', u.id)));
}
/** The number one of your units needs on its Armour Roll right now (Veteran of Tarsonis counted). */
export function playerArmour(state: GameState, pu: PlayerUnit): number {
  const def = playerUnitDef(pu);
  return targetNumber(def.stats.armour - armourBonus(def, pu.upgrades, onAMarker(state, unitShapes(state, 'players', pu.id))));
}
/**
 * TOUGH an AI unit has on an Armour Roll by itself: Heavy Plating (not in SIEGE MODE), the Praetor Guard's Shield
 * Overcharge (first Armour Roll of the Round) and Ancillary Carapace (first of each Activation). The highest counts.
 */
function aiPassiveTough(state: GameState, u: AiUnitInstance, key: string): { tough: number; mark: () => void } {
  const def = unitById(u.defId);
  let tough = aiHas(u, 'Heavy Plating') && !(u.statuses ?? []).includes('Siege Mode') ? 1 : 0;
  const marks: (() => void)[] = [];
  const special = (u.special ??= {});
  if (def.abilities.some((a) => a.name === 'Shield Overcharge' && a.kind === 'Passive') && special['shieldOverchargeRound'] !== state.round) { tough = Math.max(tough, 2); marks.push(() => { special['shieldOverchargeRound'] = state.round; }); }
  if (aiHas(u, 'Ancillary Carapace') && special['toughKey'] !== key) { tough = Math.max(tough, 1); marks.push(() => { special['toughKey'] = key; }); }
  return { tough, mark: () => marks.forEach((m) => m()) };
}

/**
 * The IMPACT attack a successful charge makes (Devastating Charge), as `resolveAttack` needs it. The reducer
 * applies it with the models that ended in the Fighting and Supporting Ranks; the Combat Tray previews it with
 * the same rules before the charge is sent, so the target's Armour and Evade are rolled where you can see them.
 */
export function impactParams(state: GameState, pu: PlayerUnit, target: AiUnitInstance, cm: { impactHit: number }, cmd: { impactRolls?: number[]; impactSaveRolls?: number[]; impactEvadeRolls?: number[] }, models: number): AttackParams | null {
  const def = playerUnitDef(pu);
  if (!def.impact) return null;
  const tdef = unitById(target.defId);
  // A HIDDEN Unit is immune to IMPACT (a BURROWED one is HIDDEN, unless something of yours reveals it).
  if (aiBurrowed(target) && !aiRevealed(state, target)) return null;
  // My Life for Aiur: each eligible model generates one more IMPACT die.
  const weapon = { id: 'impact', name: 'IMPACT', phase: 'Combat' as const, range: 'E' as const, target: 'Ground' as const, roa: impactDice(def, pu.upgrades), hit: targetNumber(def.impact.hit - cm.impactHit), dmg: 1, surgeTypes: [], keywords: [], text: '' };
  return {
    attacker: { side: 'players', unitId: pu.id, label: pu.name },
    defender: { side: 'ai', unitId: target.id, label: target.label },
    weapon, models, phase: 'Impact',
    defenderDef: tdef,
    defenderHp: unitHp(tdef, target.upgrades),
    armourMod: aiDebuff(target, 'armour') - aiArmourBonus(state, target),
    evadeMod: aiDebuff(target, 'evade'),
    evadeReason: aiEvadeReason(state, target, 'Combat', pu),
    toughFirst: aiPassiveTough(state, target, activationKey(state, pu.id)).tough,
    defenderState: { models: target.models, damageMarker: target.damageMarker, shieldsLeft: target.shieldsLeft },
    presetRolls: cmd.impactRolls,
    presetSaves: cmd.impactSaveRolls,
    presetEvade: cmd.impactEvadeRolls,
  };
}

/** Everything the tray needs to preview a charge's IMPACT: null when the unit has no Devastating Charge. */
export function chargeImpactSetup(state: GameState, cmd: Extract<Command, { t: 'playerCharge' }>): { params: AttackParams } | null {
  const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
  const target = state.army.units.find((x) => x.id === cmd.targetId);
  // Lightning Dash's second Charge makes no IMPACT: Devastating Charge does not trigger a second time.
  if (!pu || !target || pu.dashFrom) return null;
  // Before the move, every model of the unit is assumed to reach the Ranks (the tray shows that many dice).
  const params = impactParams(state, pu, target, chargeMods(pu, state), cmd, pu.models);
  return params ? { params } : null;
}

export function withLeader(state: GameState, unitId: string, index: number): GameState {
  const pts = state.sense?.players[unitId];
  if (!pts || index <= 0 || index >= pts.length) return state;
  const reordered = [pts[index]!, ...pts.filter((_, i) => i !== index)];
  return { ...state, sense: { ...state.sense!, players: { ...state.sense!.players, [unitId]: reordered } } };
}

/** Bring an older save up to per-model base positions and recompute engagement. */
export function normalizePositions(state: GameState): GameState {
  if (state.sense?.calibrated) refreshEngagement(state, autoEngagement(state));
  return state;
}

/** Whether the app decides engagement from positions: the simulation, or a camera that sees the table. */
function autoEngagement(state: GameState): boolean {
  return state.config.playMode === 'video' || (!!state.sense?.calibrated && !state.sense.manual);
}

/**
 * Recompute who is engaged with whom: any bases within 1" of each other (camera tracks or placed positions).
 * With `decide` off only the model positions are tidied; who is engaged is left as the players set it.
 */
function refreshEngagement(state: GameState, decide = true): void {
  // Casualties and returns first, so every model on the table has a base.
  for (const pu of state.playerUnits) if (pu.location === 'table' && !pu.destroyed) syncModelPositions(state, 'players', pu.id);
  for (const u of state.army.units) if (u.location === 'table') syncModelPositions(state, 'ai', u.id);
  if (!decide) return;
  const liveAi = state.army.units.filter((u) => u.location === 'table' && !unitById(u.defId).tags.includes('Flying'));
  for (const pu of state.playerUnits) {
    // Camera-tracked units count as on the table wherever they are seen.
    const present = pu.location === 'table' || (!!state.sense?.players[pu.id]?.length && !state.sense.manual);
    if (!present || pu.destroyed || playerUnitFlying(pu)) { pu.engaged = false; pu.engagedWith = []; continue; }
    // Engaged: Within 1", with no Size 2+ terrain between the models and not on HIGH GROUND against GROUND LEVEL (Part 7.2.1).
    const eng = liveAi.filter((u) => unitsEngaged(state, 'players', pu.id, 'ai', u.id));
    pu.engagedWith = eng.map((u) => u.id);
    pu.engaged = eng.length > 0;
  }
  for (const u of state.army.units) {
    if (u.location !== 'table') continue;
    const near = state.playerUnits.filter((pu) => pu.engagedWith.includes(u.id));
    u.engaged = near.length > 0;
    u.engagedEnemySupply = near.reduce((a, e) => a + playerUnitSupply(e), 0);
  }
}

function applyCommand(prev: GameState, cmd: Command): GameState {
  const state = structuredClone(prev);
  state.playerUnits = (state.playerUnits ?? []).map(normalizePlayerUnit);
  state.playerSupply ??= { start: state.supply.start, escalation: state.supply.escalation };
  state.playerSupplyLostThisRound ??= 0;
  state.attackLog ??= [];
  state.playerCards ??= [];
  state.tokens ??= [];
  const mode = modeById(state.config.modeId);
  if (state.status !== 'playing' && cmd.t !== 'damage' && cmd.t !== 'setModels') return state;
  switch (cmd.t) {
    case 'continue': {
      const k = state.step.kind;
      if (k === 'ROUND_START') startPhase(state, mode, 'movement');
      else if (k === 'PHASE_START') advanceTurn(state, mode);
      else if (k === 'ROUND_END') startRound(state, mode);
      return state;
    }
    case 'orderReport': {
      if (state.step.kind !== 'AI_ORDER') return state;
      finishAiOrder(state, mode, cmd.report, cmd.enemySupply);
      return state;
    }
    case 'aiResolve': {
      if (state.step.kind !== 'AI_ORDER') return state;
      // A Reaction still on offer is declined: the enemy's order goes on (nothing may leave the game stuck).
      const held = state.pendingReaction;
      if (held && held.kind && held.kind !== 'damage') {
        state.pendingReaction = undefined;
        continueAfterReaction(state, mode, held);
        return state;
      }
      aiResolve(state, mode);
      return state;
    }
    case 'setOptions': {
      state.config.options = { ...state.config.options, ...cmd.options };
      return state;
    }
    case 'enterSaves': {
      if (state.step.kind !== 'AI_SAVES' || !state.pendingSaves) return state;
      const ps = state.pendingSaves;
      const pu = state.playerUnits.find((x) => x.id === ps.attack.defender.unitId);
      if (pu) {
        let tough = 0;
        let reduce = 0;
        let dodge = 0;
        let minDamage = 0;
        let evadeBonus = 0;
        const used: string[] = [];
        // Whose unit is being shot at: only that player's own cards can be played on the roll.
        const defOwner: number = ownerOf(pu);
        // Each player may resolve only one Reaction per Activation (Part 10.4): a card's Reaction or a unit's.
        const reacted = new Set(state.reacted ?? []);
        for (const id of cmd.boostCards ?? []) {
          const card = (state.playerCards ?? []).find((c) => c.id === id && !c.exhausted && ownerOf(c) === defOwner);
          const b = card ? cardDef(card.defId)?.boosts.find((x) => SAVE_BOOSTS[x.name]) : undefined;
          const sb = b ? SAVE_BOOSTS[b.name] : undefined;
          if (!card || !b || !sb || !sb.filter(pu) || reacted.has(defOwner)) continue;
          reacted.add(defOwner);
          card.exhausted = true;
          tough = Math.max(tough, sb.tough ?? 0);
          reduce += sb.reduce ?? 0;
          dodge = Math.max(dodge, sb.dodge ?? 0);
          minDamage = Math.max(minDamage, sb.minDamage ?? 0);
          evadeBonus += sb.evadeBonus ?? 0;
          used.push(b.name);
        }
        let capDmg: number | undefined;
        let forcedEvade: number | undefined;
        // INSTANT: your Units cannot declare Reactions to an attack made with this weapon.
        const instant = attackIsInstant(state, ps.attack);
        for (const r of cmd.reactions ?? []) {
          const ru = state.playerUnits.find((x) => x.id === r.unitId);
          const self = SELF_REACTIONS.find((x) => x.name === r.name);
          const repeatable = !!UNIT_ABILITIES[r.name]?.repeatable;
          if (!ru || instant || (!repeatable && (ru.used ?? []).includes(r.name))) continue;
          if (!hasAbility(ru, r.name) || reacted.has(ownerOf(ru))) continue;
          if (self && !self.ok(state, ru)) continue;
          const ab = playerUnitDef(ru).abilities.find((a) => a.name === r.name);
          if (!ab || ab.kind !== 'Reaction') continue;
          const price = abilityCost(state, ru, ab);
          const pay = payFor(state, price.cost, undefined, ownerOf(ru));
          if (typeof pay === 'string') continue;
          for (const c of pay) c.exhausted = true;
          price.commit();
          reacted.add(ownerOf(ru));
          if (!repeatable) ru.used = [...(ru.used ?? []), r.name];
          // Zealous Round is paid for with the unit's activation: it counts as activated in this phase.
          if (r.name === 'Zealous Round' && state.phase !== 'scoring') ru.activated[state.phase] = true;
          // A helper's reduction is what it is worth now (Life Support: its models Within 4"), not what was sent.
          const helper = damageHelpers(state, pu).find((h) => h.unitId === ru.id && h.name === r.name);
          reduce += self?.reduce ?? helper?.reduce ?? 0;
          tough = Math.max(tough, self?.tough ?? 0);
          if (self?.capDmg !== undefined) capDmg = Math.min(capDmg ?? Infinity, self.capDmg);
          if (self?.evade !== undefined) forcedEvade = Math.min(forcedEvade ?? 7, self.evade);
          used.push(`${r.name} (${ru.name})`);
        }
        state.reacted = [...reacted];
        // Heavy Plating and the like: TOUGH the unit has without being asked for. Keywords do not stack: the highest counts.
        const passive = passiveToughFor(pu, state, activationKey(state, ps.attack.attacker.unitId));
        tough = Math.max(tough, passive.tough);
        const base = { ...ps.attack };
        // Improved Barrier: the attacking weapon's Damage characteristic is capped for this attack.
        if (capDmg !== undefined && base.dmgPer > capDmg) base.dmgPer = capDmg;
        // DODGE (X): that many fewer dice leave the Armour Pool by Surge or CRITICAL HIT.
        if (dodge && base.surge) {
          const back = Math.min(dodge, base.surge.applied);
          base.surge = { ...base.surge, applied: base.surge.applied - back };
          dodge -= back;
        }
        if (dodge && base.critical) base.critical = Math.max(0, base.critical - dodge);
        const toSave = base.hits - (base.surge?.applied ?? 0) - base.critical;
        if (toSave > 0) passive.mark();
        // TOUGH turns failed saves into successes.
        const saved = Math.min(toSave, cmd.saved + tough);
        const hp = unitHp(playerUnitDef(pu), pu.upgrades);
        const before = { models: pu.models, damageMarker: pu.damageMarker, shieldsLeft: pu.shieldsLeft };
        const done = completeSaves(base, saved, playerUnitDef(pu), before, hp);
        let { attack, result } = done;
        // Evade Roll: successes discard dice from the damage pool before Damage is applied.
        const found = forcedEvade !== undefined ? { value: forcedEvade, reason: 'Prophetic Vision' } : evadeFor(state, pu, base);
        // Brood Instinct: +1 to the Evade Roll (the Evade successes come counted from the tray).
        const ev = found && evadeBonus && forcedEvade === undefined ? { ...found, value: targetNumber(found.value - evadeBonus) } : found;
        let pool = base.hits - attack.saved;
        if (ev && cmd.evaded && attack.damage > 0) {
          const evaded = Math.min(pool, cmd.evaded);
          pool = Math.max(0, pool - evaded);
          attack = { ...attack, evade: { value: ev.value, rolls: [], saved: evaded, reason: ev.reason } };
        }
        // Lurking answers the first Ranged Attack of the Round, whatever comes of it.
        if (base.phase === 'Assault' && hasAbility(pu, 'Lurking')) pu.lurkedRound = state.round;
        let dmg = pool * base.dmgPer;
        // Damage reduction comes off the Total Damage before it is allocated (Life Support, Transfusion, Dae'Uhl).
        if (reduce > 0 && dmg > 0) dmg = Math.max(minDamage || 0, dmg - reduce, 0);
        if (dmg !== attack.damage || attack.evade) {
          const redo = applyDamage(playerUnitDef(pu), before, dmg, { maxRemovable: base.maxRemovable, hp });
          attack = { ...attack, damage: dmg, removed: redo.removed, modelsAfter: redo.models, destroyed: redo.destroyed };
          result = redo;
        }
        if (used.length) pushLog(state, 'players', `${pu.name} uses ${used.join(', ')}.`);
        applyToPlayer(state, pu, result, (() => { const au = state.army.units.find((x) => x.id === ps.attack.attacker.unitId); return au ? aiPos(state, au) : null; })());
        state.lastAttack = attack;
        state.attackLog.push(attack);
        emit(state, { kind: 'attack', attack });
        pushLog(state, 'ai', `${attack.attacker.label} hits ${pu.name} for ${attack.damage} damage${result.removed ? `, ${result.removed} model(s) lost` : ''}.`);
      }
      // The Blast Template's Spillover: each other Unit under it, in its own Batch.
      if (ps.spill) {
        const au = state.army.units.find((x) => x.id === ps.attack.attacker.unitId);
        const w = au ? aiWeapon(au, ps.spill.weaponId) : undefined;
        if (au && w) resolveSpillover(state, mode, { side: 'ai', unitId: au.id, label: au.label }, w, ps.spill.hits, au.statuses ?? [], unitById(au.defId), au.upgrades);
      }
      state.step = { kind: 'AI_ORDER', order: ps.order };
      delete state.pendingSaves;
      // More weapon batches of the same order still to fire at the same target.
      if (ps.remaining.length && ps.targetId) {
        const u = findUnit(state, ps.order.unitId);
        const t = state.playerUnits.find((p) => p.id === ps.targetId);
        if (t && !t.destroyed && fireBatches(state, mode, u, ps.order, t, ps.remaining, ps.report)) return state;
      }
      // After a Ranged Attack is fully resolved, Lunge may answer it.
      if (ps.attack.phase === 'Assault') endAiRanged(state, mode, ps.attack.attacker.unitId, ps.attack.defender.unitId, ps.report, ps.enemySupply);
      else finishAiOrder(state, mode, ps.report, ps.enemySupply);
      return state;
    }
    case 'playerDeploy': {
      if (state.activeUnitId && state.activeUnitId !== cmd.unitId) return reject(state, 'Finish the active unit first: use its abilities or end its activation.');
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      if (!pu) return state;
      const chk = checkDeploy(state, pu, cmd.point);
      if (!chk.ok) return reject(state, chk.reason);
      // Every model must fit: no model of an arriving Unit may end in the enemy's Zone of Influence (Part 8.3.3).
      const why = arrivalProblem(state, pu.id, cmd.point, chk.swapId);
      if (why) return reject(state, why);
      // Phase Prism: the Friendly Unit it takes the place of returns to Reserves, with the Damage it carries.
      let point = cmd.point;
      if (chk.swapId) {
        const out = state.playerUnits.find((x) => x.id === chk.swapId);
        if (out) { point = playerPos(state, out) ?? cmd.point; toReserve(state, out); }
      }
      pu.location = 'table';
      pu.deployedRound = state.round;
      // Warp Conduit is one Ground Unit a Round; the Omega Network takes Units up to 2 Supply in all each Round.
      if (chk.via === 'Warp Conduit') state.conduitUsedRound = state.round;
      if (chk.via === 'Omega Network') state.omegaUsed = { round: state.round, supply: (state.omegaUsed?.round === state.round ? state.omegaUsed.supply : 0) + playerUnitSupply(pu) };
      pu.deployAnyEdge = false;
      setPlayerPosition(state, pu, point);
      pushLog(state, 'players', `${pu.name} deploys${chk.via ? ` via ${chk.via}` : ''}.`);
      finishPlayerAction(state, mode, pu, 'movement', 'deploy');
      return state;
    }
    case 'useAbility': {
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      if (!pu) return state;
      const def = playerUnitDef(pu);
      const ab = def.abilities.find((a) => a.name === cmd.name);
      const spec = UNIT_ABILITIES[cmd.name];
      if (!ab || !spec) return reject(state, `${cmd.name} is not usable from the app.`);
      if (PROMPTED_REACTIONS.has(ab.name)) return reject(state, `${ab.name} is offered when it triggers.`);
      if (ab.upgradeCost && !pu.upgrades.includes(ab.id)) return reject(state, `${pu.name} does not have ${cmd.name}.`);
      if (pu.location !== 'table') return reject(state, `${pu.name} must be on the battlefield.`);
      if (ab.kind === 'Active') {
        if (state.step.kind !== 'PLAYERS_TURN') return reject(state, 'Active abilities are used during your activation.');
        if (state.phase === 'scoring' || (pu.activated[state.phase] && state.activeUnitId !== pu.id)) return reject(state, `${pu.name} already acted this phase.`);
        if (state.activeUnitId && state.activeUnitId !== pu.id) return reject(state, 'Finish the active unit first: use its abilities or end its activation.');
        if (ab.phase !== 'Any' && ab.phase.toLowerCase() !== state.phase) return reject(state, `${ab.name} is used in the ${ab.phase} phase.`);
      }
      // An ability resolved in steps (one Corrosive Bile token for each model) is paid for and counted once.
      const more = pu.pendingUses?.name === ab.name && pu.pendingUses.left > 0;
      if (!spec.repeatable && !more && (pu.used ?? []).includes(ab.name)) return reject(state, `${ab.name} was already used this round.`);
      if (spec.once === 'game' && (pu.usedGame ?? []).includes(ab.name)) return reject(state, `${ab.name} can be used once per game.`);
      // A Reaction used from the card counts as the player's one Reaction of this Activation.
      if (ab.kind === 'Reaction' && (state.reacted ?? []).includes(ownerOf(pu))) return reject(state, 'Each player may resolve only one Reaction per Activation.');
      const optCost = spec.options && cmd.option !== undefined ? spec.options[cmd.option]?.cost : undefined;
      const price = more ? { cost: 0, notes: [] as string[], commit: () => {} } : abilityCost(state, pu, ab, optCost);
      const res = resolveAbilityTargets(state, pu, spec, cmd);
      if (typeof res === 'string') return reject(state, res);
      const pay = payFor(state, price.cost, price.cost > 0 ? cmd.payWith : undefined, ownerOf(pu));
      if (typeof pay === 'string') return reject(state, pay);
      const hurtBefore = pu.damageMarker;
      const fxBefore = snapshotFx(state);
      const line = spec.apply({ ...res, state, unit: pu, option: cmd.option, owner: ownerOf(pu) });
      if (line.startsWith('!')) return reject(state, line.slice(1));
      for (const c of pay) c.exhausted = true;
      price.commit();
      if (price.notes.length) pushLog(state, 'players', `${price.notes.join(', ')}: ${ab.name} costs ${price.cost}.`);
      if (ab.kind === 'Reaction') state.reacted = [...(state.reacted ?? []), ownerOf(pu)];
      pu.used = [...(pu.used ?? []), ab.name];
      if (spec.once === 'game') pu.usedGame = [...(pu.usedGame ?? []), ab.name];
      pushLog(state, 'players', `${line}${pay.length ? ` (paid with ${pay.map((c) => cardDef(c.defId)?.name).join(', ')})` : ''}`);
      emitFxChanges(state, fxBefore);
      // An ability that deals automatic hits (Shadow Strike) resolves them as it is used.
      resolvePendingHits(state, mode);
      // Damage a unit does to itself (Stimpack) is Damage suffered: a Medic beside it may still reduce it.
      offerDamageReaction(state, pu, pu.damageMarker - hurtBefore, ab.name);
      return state;
    }
    case 'damageReaction': {
      const pr = state.pendingReaction;
      if (!pr) return state;
      if (cmd.key) {
        const o = reactionOffers(state, pr).find((x) => x.key === cmd.key);
        if (!o) return reject(state, 'That Reaction is no longer available.');
        const err = useReaction(state, pr, o);
        if (err) return reject(state, err);
        // Each player may resolve only one Reaction per Activation: what the other player could still use stays on offer.
        if (reactionOffers(state, pr).length) { state.pendingReaction = pr; return state; }
      }
      state.pendingReaction = undefined;
      continueAfterReaction(state, mode, pr);
      return state;
    }
    case 'useBoost': {
      const card = (state.playerCards ?? []).find((c) => c.id === cmd.cardId);
      if (!card) return state;
      if (card.exhausted) return reject(state, 'That card is exhausted until the end of the round.');
      const spec = CARD_BOOSTS[cmd.boost];
      const cdef = cardDef(card.defId);
      if (!spec || !cdef?.boosts.some((b) => b.name === cmd.boost)) return reject(state, `${cmd.boost} is not usable from the app.`);
      if (spec.once === 'game' && (card.usedGame ?? []).includes(cmd.boost)) return reject(state, `${cmd.boost} can be used once per game.`);
      const boost = cdef.boosts.find((b) => b.name === cmd.boost)!;
      if (boost.kind === 'Passive') return reject(state, `${cmd.boost} is a Passive ability: it applies by itself.`);
      // A card ability with a Phase Limitation is used only in that Phase.
      const wrongPhase = boostPhaseProblem(state, boost);
      if (wrongPhase) return reject(state, `${cmd.boost} is used in the ${wrongPhase}.`);
      if (boost.kind === 'Reaction' && (state.reacted ?? []).includes(ownerOf(card))) return reject(state, 'Each player may resolve only one Reaction per Activation.');
      const unit = cmd.unitId ? state.playerUnits.find((x) => x.id === cmd.unitId) : undefined;
      if (spec.target === 'self' && !unit) return reject(state, 'Select the active unit first.');
      // A player's cards are theirs: they cannot be spent on another player's units.
      if (unit && ownerOf(unit) !== ownerOf(card)) return reject(state, `${cdef.name} belongs to another player.`);
      if (unit && spec.needsUnit && !spec.needsUnit(unit)) return reject(state, `${cmd.boost} needs ${spec.targetHint ?? 'another unit'}.`);
      const res = resolveAbilityTargets(state, unit ?? null, spec, cmd);
      if (typeof res === 'string') return reject(state, res);
      // MORPH: the controlling player must have the Available Supply for the new Unit.
      if (cmd.boost === 'Ravager Morph' && unit) {
        const need = currentSupply(unitById('ravager'), 1);
        if (need > playerAvailable(state, ownerOf(unit))) return reject(state, `Not enough Supply for the Ravager: needs ${need}.`);
      }
      const fxBefore = snapshotFx(state);
      const line = spec.apply({ ...res, state, unit, owner: ownerOf(card) });
      if (line.startsWith('!')) return reject(state, line.slice(1));
      emitFxChanges(state, fxBefore);
      if (boost.kind === 'Reaction') state.reacted = [...(state.reacted ?? []), ownerOf(card)];
      card.exhausted = true;
      if (spec.once === 'game') card.usedGame = [...(card.usedGame ?? []), cmd.boost];
      pushLog(state, 'players', `${cdef.name}: ${line}`);
      return state;
    }
    case 'playerPlace': {
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      if (!pu || !pu.placeRange) return reject(state, 'No PLACE effect to resolve.');
      const from = playerPos(state, pu);
      if (!from) return state;
      // Set Wholly Within X" of where it stood, measured from the edge of its base (no path: it is set, not moved).
      const pr = playerMoveReach(state, pu, cmd.point, pu.placeRange, true);
      if (pr.reach > pu.placeRange + 0.05) return reject(state, `PLACE reaches only ${pu.placeRange}". The whole base must end within ${pu.placeRange}" of where it stood.`);
      if (!passable(cmd.point, state.terrain.pieces)) return reject(state, 'Cannot be set on terrain (Size 1 and up).');
      // A PLACE may end Within Engagement Range only in the Assault Phase, and never when the ability forbids it.
      const mayEngage = state.phase === 'assault' && !pu.placeNoEngage && !playerUnitFlying(pu);
      const lead = shapeAt(pu.defId, cmd.point);
      const near = state.army.units.find((u) => u.location === 'table' && !unitById(u.defId).tags.includes('Flying') && unitShapes(state, 'ai', u.id).some((sh) => edgeDistance(lead, sh) <= ENGAGEMENT_IN));
      if (near && !mayEngage) return reject(state, `Cannot be set within Engagement Range of ${near.label}.`);
      const asAction = !!pu.placeAsAction;
      setPlayerPosition(state, pu, cmd.point, { avoidEngaging: !mayEngage, facing: pr.facing });
      pushLog(state, 'players', `${pu.name} is PLACEd ${pr.reach.toFixed(1)}" away.`);
      pu.placeRange = 0;
      pu.placeAsAction = false;
      pu.placeNoEngage = false;
      if (state.activeUnitId === pu.id) pu.mayAdjust = pu.models > 1;
      offerReaction(state, { kind: 'afterPlace', unitId: pu.id, amount: 0, source: 'PLACE' });
      // Ready for Pickup? resolves instead of the unit's action: it has now acted this Phase.
      if (asAction && state.phase !== 'scoring' && state.step.kind === 'PLAYERS_TURN') {
        pu.activated[state.phase] = true;
        state.activeUnitId = pu.id;
      }
      return state;
    }
    case 'playerBonusMove': {
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      if (!pu || !pu.bonusMove) return reject(state, 'No free move available.');
      // It is a Move action: an Engaged Unit cannot Move, and neither can one in SIEGE MODE.
      if (pu.engaged) return reject(state, `${pu.name} is Engaged. It cannot perform a Move action.`);
      if ((pu.statuses ?? []).includes('Siege Mode')) return reject(state, 'It cannot move in SIEGE MODE.');
      const from = playerPos(state, pu);
      if (!from) return state;
      const bm = playerMoveReach(state, pu, cmd.point, pu.bonusMove);
      if (bm.reach > pu.bonusMove + 0.05) return reject(state, `The free move is only ${pu.bonusMove}". The whole base must end within ${pu.bonusMove}" of where it started.`);
      if (!passable(cmd.point, standingPieces(state, 'players', pu.id))) return reject(state, 'Cannot end on terrain (Size 1 and up).');
      setPlayerPosition(state, pu, cmd.point, { avoidEngaging: true, facing: bm.facing, path: bm.path });
      pushLog(state, 'players', `${pu.name} makes a free ${pu.bonusMove}" move.`);
      pu.bonusMove = 0;
      // A Move ends BURROWED (Tunneling Claws keeps it) and the HIDDEN that lasts until the unit's next action.
      pu.statuses = (pu.statuses ?? []).filter((x) => !(x === 'Hidden' && pu.hiddenThroughRound !== state.round && !isBurrowed(pu)) && !(x === 'Burrowed' && !hasAbility(pu, 'Tunneling Claws')));
      // Still active afterwards: its models can be adjusted into coherency.
      if (state.activeUnitId === pu.id) pu.mayAdjust = pu.models > 1;
      return state;
    }
    case 'playerMove': {
      if (state.activeUnitId && state.activeUnitId !== cmd.unitId) return reject(state, 'Finish the active unit first: use its abilities or end its activation.');
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      if (!pu) return state;
      const chk = checkMove(state, pu, cmd.point, cmd.kind);
      if (!chk.ok) return reject(state, chk.reason);
      if (cmd.kind === 'disengage') {
        // Tactical Mass: its Supply (0 while BURROWED, 1 more for a Commander) against everything it is Engaged with.
        const mine = disengageSupply(pu);
        const theirs = pu.engagedWith.reduce((a, id) => { const u = state.army.units.find((x) => x.id === id); return a + (u ? (aiBurrowed(u) ? 0 : currentSupply(unitById(u.defId), u.models) + (aiHas(u, 'Commander') ? 1 : 0)) : 0); }, 0);
        // Tactical Retreat and Orders lift the penalty for the Round, whenever they were used.
        pu.disengagedThisRound = !(mine > theirs) && !activeEffects(pu).some((e) => e.mods.ignoreDisengage);
      }
      const reach = playerMoveReach(state, pu, cmd.point, effectiveSpeed(pu, state));
      setPlayerPosition(state, pu, cmd.point, { avoidEngaging: true, facing: reach.facing, path: reach.path });
      pushLog(state, 'players', `${pu.name} ${cmd.kind === 'run' ? 'runs' : cmd.kind === 'disengage' ? 'disengages' : 'moves'}.`);
      finishPlayerAction(state, mode, pu, state.phase === 'assault' ? 'assault' : 'movement', cmd.kind);
      return state;
    }
    case 'playerHold': {
      if (state.activeUnitId && state.activeUnitId !== cmd.unitId) return reject(state, 'Finish the active unit first: use its abilities or end its activation.');
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      if (!pu || state.step.kind !== 'PLAYERS_TURN') return state;
      const key = state.phase === 'movement' ? 'movement' : state.phase === 'assault' ? 'assault' : 'combat';
      if (pu.activated[key]) return reject(state, `${pu.name} already acted this phase.`);
      pushLog(state, 'players', `${pu.name} holds.`);
      finishPlayerAction(state, mode, pu, key, 'hold');
      return state;
    }
    case 'playerAttack': {
      if (state.activeUnitId && state.activeUnitId !== cmd.unitId) return reject(state, 'Finish the active unit first: use its abilities or end its activation.');
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      const target = state.army.units.find((x) => x.id === cmd.targetId);
      if (!pu || !target) return state;
      const weapon = playerWeapons(state, pu).find((w) => w.id === cmd.weaponId);
      if (!weapon) return reject(state, 'That weapon cannot be used now.');
      const chk = checkAttack(state, pu, weapon, target);
      if (!chk.ok) return reject(state, chk.reason);
      const ctx = ctxFor(state);
      const tdef = unitById(target.defId);
      const setup = playerAttackSetup(state, cmd)!;
      const mod = setup.mod;
      // A Blast Template: what it covers is read before the dice change the table.
      const template = weapon.blast ? blastTemplate(state, 'ai', target.id, playerPos(state, pu), weapon.target) : null;
      spendEffects(pu, mod.spent);
      const a = resolveAttack(ctx.rng, setup.params);
      if (a.toughUsed) ((state.modeState['toughUsed'] ??= {}) as Record<string, boolean>)[target.id] = true;
      // Its once-only TOUGH is spent on the first Armour Roll it makes; Lurking answers one Ranged Attack a Round.
      if (a.hits - (a.surge?.applied ?? 0) - a.critical > 0) aiPassiveTough(state, target, activationKey(state, pu.id)).mark();
      if (weapon.phase === 'Assault' && aiHas(target, 'Lurking')) (target.special ??= {})['lurkedRound'] = state.round;
      commitRng(state, ctx.rng);
      const before = currentSupply(tdef, target.models);
      applyDamageToAi(state, mode, target, a.damage, before, playerPos(state, pu), a.maxRemovable);
      state.lastAttack = a;
      state.attackLog.push(a);
      emit(state, { kind: 'attack', attack: a });
      pushLog(state, 'players', `${pu.name} fires ${weapon.name} at ${target.label}${mod.notes.length ? ` (${mod.notes.join(', ')})` : ''}: ${a.hits} hits, ${a.damage} damage${a.removed ? `, ${a.removed} model(s) removed` : ''}${a.destroyed ? '. Destroyed' : ''}.`);
      if (template?.spill.length) resolveSpillover(state, mode, { side: 'players', unitId: pu.id, label: pu.name }, setup.params.weapon, template.spill, pu.statuses ?? [], playerUnitDef(pu), pu.upgrades);
      pu.firedThisActivation = [...(pu.firedThisActivation ?? []), weapon.id];
      finishPlayerAction(state, mode, pu, weapon.phase === 'Combat' ? 'combat' : 'assault', 'attack');
      return state;
    }
    case 'playerCharge': {
      if (state.activeUnitId && state.activeUnitId !== cmd.unitId) return reject(state, 'Finish the active unit first: use its abilities or end its activation.');
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      const target = state.army.units.find((x) => x.id === cmd.targetId);
      if (!pu || !target) return state;
      const chk = checkCharge(state, pu, target);
      if (!chk.ok) return reject(state, chk.reason);
      const ctx = ctxFor(state);
      const def = playerUnitDef(pu);
      const speed = effectiveSpeed(pu, state);
      const cm = chargeMods(pu, state);
      const opt = chargeOptions(state, pu).find((c) => c.unit.id === target.id)!;
      const roll = cmd.roll ? { roll: cmd.roll, reach: speed + cmd.roll + cm.bonus, rolls: cmd.rolls?.length ? cmd.rolls : [cmd.roll] } : rollCharge(ctx.rng, speed, cm.twoDice ? '2d6high' : '1d6', cm.bonus);
      spendEffects(pu, cm.spent);
      // Lightning Dash's second Charge: Devastating Charge does not trigger a second time.
      const dash = !!pu.dashFrom;
      pu.dashFrom = undefined;
      const needed = opt.needed;
      const success = roll.reach >= needed;
      state.lastCharge = { side: 'players', unitId: pu.id, targetId: target.id, rolls: roll.rolls, reach: roll.reach, needed, success, round: state.round };
      emit(state, { kind: 'charge', ...state.lastCharge });
      if (success) {
        // The Leading Model ends base-to-base with the nearest target model; the rest press into contact where they can.
        const from = playerPos(state, pu)!;
        const lead = unitShapes(state, 'players', pu.id)[0]!;
        const tShape = opt.targetModel;
        const path = shortestPath(from, tShape, state.terrain.pieces, state.terrain.table, pathOptionsFor(state, 'players', pu.id)).path;
        // Base-to-base when the roll reaches it; otherwise as close as it gets, Within Engagement Range (step 4).
        const route = path.length >= 2 ? path : [from, tShape];
        const contact = contactPointAlong(route, lead, tShape);
        const toContact = opt.needed + ENGAGEMENT_IN;
        const end = roll.reach >= toContact - 0.01 ? contact : alongPath(route, Math.max(0, roll.reach));
        setPlayerPosition(state, pu, end, { contactWith: [target.id], facing: Math.atan2(tShape.y - from.y, tShape.x - from.x), path: route });
        pu.engaged = true;
        if (!pu.engagedWith.includes(target.id)) pu.engagedWith.push(target.id);
        target.engaged = true;
        target.engagedEnemySupply += playerUnitSupply(pu);
        pushLog(state, 'players', `${pu.name} charges ${target.label}: ${speed} + ${roll.roll} = ${roll.reach}" (needed ${needed.toFixed(1)}"). Success!`);
        // IMPACT dice come from models in the Fighting and Supporting Ranks after the charge. A HIDDEN target is immune.
        const impactModels = Math.max(1, combatRanks(state, 'players', pu.id, [target.id]).total || pu.models);
        const ip = def.impact && !dash ? impactParams(state, pu, target, cm, cmd, impactModels) : null;
        if (def.impact && !dash && !ip) pushLog(state, 'players', `${target.label} is Burrowed: immune to IMPACT.`);
        if (ip) {
          const tdef = unitById(target.defId);
          const before = currentSupply(tdef, target.models);
          const a = resolveAttack(ctx.rng, ip);
          if (a.hits > 0) aiPassiveTough(state, target, activationKey(state, pu.id)).mark();
          applyDamageToAi(state, mode, target, a.damage, before, playerPos(state, pu));
          state.lastAttack = a;
          state.attackLog.push(a);
          emit(state, { kind: 'attack', attack: a });
          pushLog(state, 'players', `IMPACT: ${a.hits} hits, ${a.damage} damage to ${target.label}.`);
        }
      } else pushLog(state, 'players', `${pu.name} charges ${target.label}: ${speed} + ${roll.roll} = ${roll.reach}" (needed ${needed.toFixed(1)}"). Failed.`);
      commitRng(state, ctx.rng);
      // Lightning Dash answers a successful Charge (not the second one it grants).
      if (success && !dash && !pu.destroyed) offerReaction(state, { kind: 'afterCharge', unitId: pu.id, targetId: target.id, amount: 0, source: 'Charge' });
      finishPlayerAction(state, mode, pu, 'assault', 'charge');
      return state;
    }
    case 'playersDone': {
      if (state.step.kind !== 'PLAYERS_TURN') return state;
      pushLog(state, 'players', 'Players activated a unit.');
      state.turn = 'ai';
      advanceTurn(state, mode);
      return state;
    }
    case 'endOfRoundEffect': {
      if (state.step.kind !== 'ROUND_END') return reject(state, 'End-of-round effects are resolved at the end of the round.');
      const pending = pendingEndOfRound(state).find((p) => p.token.id === cmd.tokenId);
      if (!pending) return state;
      const t = pending.token;
      t.resolved = true;
      if (!cmd.accept) {
        pushLog(state, 'players', `${t.label}: not used.`);
        return state;
      }
      if (pending.kind === 'shade') {
        const owner = pending.owner!;
        setPlayerPosition(state, owner, { x: t.x, y: t.y });
        owner.movedRound = state.round + 1;
        pushLog(state, 'players', `Psionic Transfer: ${owner.name} shift to their Shade.`);
      } else {
        const pu = pending.candidates.find((p) => p.id === cmd.unitId);
        if (!pu) { t.resolved = false; return reject(state, 'Pick a Ground unit in Reserves to deploy.'); }
        const need = playerUnitSupply(pu);
        const avail = playerAvailable(state, ownerOf(pu));
        if (need > avail) { t.resolved = false; return reject(state, `Not enough Supply for ${pu.name}: needs ${need}, ${avail} available.`); }
        // However a Unit arrives from Reserves, it cannot end in the enemy's Zone of Influence (Part 8.3.3).
        const spot = { x: t.x, y: Math.min(state.terrain.table.height - 0.5, t.y + 1) };
        const why = inEnemyZoi(state, spot) ? "That is inside the AI's Zone of Influence. No Unit arriving from Reserves may end there." : arrivalProblem(state, pu.id, spot);
        if (why) { t.resolved = false; return reject(state, why); }
        pu.location = 'table';
        pu.deployedRound = state.round;
        pu.deployAnyEdge = false;
        // In base contact with the indicator.
        setPlayerPosition(state, pu, { x: t.x, y: Math.min(state.terrain.table.height - 0.5, t.y + 1) });
        pushLog(state, 'players', `${t.label}: ${pu.name} deploys at the drop point.`);
      }
      return state;
    }
    case 'playerCloseRanks': {
      if (state.activeUnitId && state.activeUnitId !== cmd.unitId) return reject(state, 'Finish the active unit first: use its abilities or end its activation.');
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      if (!pu) return state;
      const chk = checkCloseRanks(state, pu, cmd.point);
      if (!chk.ok) return reject(state, chk.reason);
      const engaged = [...pu.engagedWith];
      const pts = closeRanksPositions(state, 'players', pu.id, cmd.point, engaged);
      const before = state.sense!.players[pu.id];
      state.sense!.players[pu.id] = pts;
      // It cannot be used to disengage from anything it was fighting.
      const still = engaged.every((id) => unitsEngaged(state, 'players', pu.id, 'ai', id));
      if (!still) {
        state.sense!.players[pu.id] = before!;
        return reject(state, 'Close Ranks cannot move the unit out of a fight.');
      }
      pu.closedRanksRound = state.round;
      pu.mayAdjust = pu.models > 1;
      pu.movedRound = state.round;
      refreshCoherency(state, 'players', pu.id);
      // Close Ranks ends BURROWED: the unit surfaces and may then attack.
      if (isBurrowed(pu)) { pu.statuses = (pu.statuses ?? []).filter((x) => x !== 'Burrowed'); pushLog(state, 'players', `${pu.name} unburrows.`); }
      const ranks = combatRanks(state, 'players', pu.id, engaged);
      pushLog(state, 'players', `${pu.name} close ranks: ${ranks.fighting} fighting, ${ranks.supporting} supporting.`);
      emit(state, { kind: 'closeRanks', side: 'players', unitId: pu.id, fighting: ranks.fighting, supporting: ranks.supporting });
      return state;
    }
    case 'adjustModel': {
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      if (!pu || pu.location !== 'table') return state;
      if (state.step.kind !== 'PLAYERS_TURN' || state.activeUnitId !== pu.id || !pu.mayAdjust) return reject(state, 'Adjust Coherency while the unit is active, after it has moved or held.');
      // Set on a squad-mate's spot, the squad-mate steps aside.
      const res = adjustModelDisplacing(state, 'players', pu.id, cmd.index, cmd.point);
      if ('error' in res) return reject(state, res.error);
      state.sense!.players[pu.id] = res.points;
      pu.movedRound = state.round;
      refreshCoherency(state, 'players', pu.id);
      return state;
    }
    case 'endActivation': {
      if (state.step.kind !== 'PLAYERS_TURN' || !state.activeUnitId) return state;
      const pu = state.playerUnits.find((x) => x.id === state.activeUnitId);
      state.activeUnitId = null;
      if (pu) { pu.mayAdjust = false; pu.firedThisActivation = []; pu.dashFrom = undefined; }
      if (state.pendingReaction?.kind === 'afterCharge') state.pendingReaction = undefined;
      pushLog(state, 'players', `${pu?.name ?? 'Your unit'} ends its activation.`);
      state.turn = 'ai';
      advanceTurn(state, mode);
      return state;
    }
    case 'playersPass': {
      if (state.step.kind !== 'PLAYERS_TURN') return state;
      // Combat Phase: a player Passes only when none of their Engaged Units is left to activate (Part 8.8).
      if (state.phase === 'combat' && autoEngagement(state)) {
        const left = state.playerUnits.find((p) => p.location === 'table' && !p.destroyed && !p.summoned && p.engaged && !p.activated.combat);
        if (left) return reject(state, `${left.name} is Engaged and must be activated: fight, or Hold.`);
      }
      state.activeUnitId = null;
      for (const p of state.playerUnits) { p.mayAdjust = false; p.dashFrom = undefined; }
      if (state.pendingReaction?.kind === 'afterCharge') state.pendingReaction = undefined;
      state.passed.players = true;
      if (!state.passed.ai && state.nextFirstPlayer === null) state.nextFirstPlayer = 'players';
      pushLog(state, 'players', 'Players pass.');
      state.turn = 'ai';
      advanceTurn(state, mode);
      return state;
    }
    case 'checklistDone': {
      if (state.step.kind !== 'COMBAT_CHECKLIST') return state;
      advanceTurn(state, mode);
      return state;
    }
    case 'damage':
      applyDamageCmd(state, mode, cmd);
      return state;
    case 'setBurrowed': {
      const u = findUnit(state, cmd.unitId);
      setAiBurrowed(u, cmd.on);
      pushLog(state, 'ai', `${u.label} ${cmd.on ? 'is BURROWED' : 'is no longer BURROWED'}.`);
      return state;
    }
    case 'setModels': {
      const u = findUnit(state, cmd.unitId);
      const def = unitById(u.defId);
      const before = currentSupply(def, u.models);
      u.models = Math.max(0, Math.min(u.maxModels, Math.floor(cmd.models)));
      dropCasualties(state, 'ai', u.id, u.models, nearestPlayerPoint(state, u));
      u.damageMarker = 0;
      const after = currentSupply(def, u.models);
      state.aiSupplyLostThisRound += Math.max(0, before - after);
      pushLog(state, 'players', `${u.label} set to ${u.models} models.`);
      if (u.models === 0 && u.location !== 'destroyed') destroyUnit(state, mode, u);
      return state;
    }
    case 'heal': {
      const u = findUnit(state, cmd.unitId);
      u.damageMarker = Math.max(0, u.damageMarker - cmd.amount);
      pushLog(state, 'players', `${u.label} heals ${cmd.amount}.`);
      return state;
    }
    case 'aiDebuff': {
      const u = findUnit(state, cmd.unitId);
      const rest = (u.statDebuffs ?? []).filter((d) => d.stat !== cmd.stat);
      u.statDebuffs = cmd.amount > 0 ? [...rest, { stat: cmd.stat, amount: cmd.amount }] : rest;
      if (!u.statDebuffs.length) delete u.statDebuffs;
      pushLog(state, 'players', cmd.amount > 0 ? `${u.label}: DEBUFF ${cmd.stat} (${cmd.amount}) until the End of the Round.` : `${u.label}: ${cmd.stat} debuff lifted.`);
      return state;
    }
    case 'setEngaged': {
      const u = findUnit(state, cmd.unitId);
      u.engaged = cmd.engaged;
      // Your units keep their own record of who they fight: clearing an AI unit's engagement clears it there too,
      // else your unit still thinks it is engaged (and gets an Evade against every shot) with nothing beside it.
      if (!cmd.engaged) for (const pu of state.playerUnits) {
        if (!pu.engagedWith.includes(u.id)) continue;
        pu.engagedWith = pu.engagedWith.filter((id) => id !== u.id);
        pu.engaged = pu.engagedWith.length > 0;
      }
      u.engagedEnemySupply = cmd.engaged ? (cmd.enemySupply ?? u.engagedEnemySupply ?? 1) : 0;
      if (cmd.engaged) u.atObjective = false;
      return state;
    }
    case 'setAtObjective': {
      const u = findUnit(state, cmd.unitId);
      u.atObjective = cmd.at;
      if (cmd.at && u.objective.kind === 'marker') u.lastMarker = u.objective.markerId;
      return state;
    }
    case 'scoring': {
      if (state.step.kind !== 'SCORING_FORM') return state;
      doScoring(state, mode, cmd.answers);
      return state;
    }
    case 'sense': {
      state.sense = cmd.snapshot;
      applySnapshot(state);
      return state;
    }
    case 'setPlayerUnits': {
      state.playerUnits = structuredClone(cmd.units);
      return state;
    }
    case 'playerDamage': {
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      if (!pu) return state;
      const def = unitById(pu.defId);
      const r = applyDamage(def, { models: pu.models, damageMarker: pu.damageMarker, shieldsLeft: pu.shieldsLeft }, cmd.dmg, { hp: unitHp(def, pu.upgrades) });
      trackPlayerSupply(state, pu, () => {
        pu.models = r.models;
        pu.damageMarker = r.damageMarker;
        pu.shieldsLeft = r.shieldsLeft;
        if (r.destroyed) pu.destroyed = true;
      });
      pushLog(state, 'players', `${pu.name} takes ${cmd.dmg} damage${r.removed ? `, ${r.removed} model(s) lost` : ''}${r.destroyed ? ' and is destroyed' : ''}.`);
      return state;
    }
    case 'setPlayerModels': {
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      if (!pu) return state;
      trackPlayerSupply(state, pu, () => {
        pu.models = Math.max(0, Math.min(pu.maxModels, Math.floor(cmd.models)));
        pu.damageMarker = 0;
        pu.destroyed = pu.models === 0;
      });
      return state;
    }
    case 'setUnitPosition': {
      const snap: SenseSnapshot = state.sense ?? { at: 0, calibrated: true, ai: {}, players: {}, terrain: {}, unknown: [], manual: true };
      snap.calibrated = true;
      snap.at = Date.now();
      const t = state.terrain.table;
      const pt = { x: Math.max(0.5, Math.min(t.width - 0.5, cmd.point.x)), y: Math.max(0.5, Math.min(t.height - 0.5, cmd.point.y)) };
      state.sense = snap;
      if (cmd.side === 'players') {
        // Mirroring the table: a unit set down from Reserves is on the table now.
        const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
        if (pu && pu.location === 'reserves') {
          pu.location = 'table';
          pu.deployedRound = state.round;
          pu.deployAnyEdge = false;
          pushLog(state, 'players', `${pu.name} is on the table.`);
        }
      }
      placeUnit(state, cmd.side === 'ai' ? 'ai' : 'players', cmd.unitId, pt);
      { const moved = cmd.side === 'ai' ? state.army.units.find((x) => x.id === cmd.unitId) : state.playerUnits.find((x) => x.id === cmd.unitId); if (moved) moved.movedRound = state.round; }
      applySnapshot(state);
      return state;
    }
    case 'useReward': {
      const why = useReward(state, cmd.rewardId, { unitId: cmd.unitId, owner: cmd.owner }, (text) => pushLog(state, 'players', text));
      return why ? reject(state, why) : state;
    }
    case 'setPlayerDestroyed': {
      const pu = state.playerUnits.find((x) => x.id === cmd.unitId);
      if (!pu) return state;
      trackPlayerSupply(state, pu, () => {
        pu.destroyed = cmd.destroyed;
        if (cmd.destroyed) pu.models = 0;
        else if (pu.models === 0) pu.models = pu.maxModels;
      });
      return state;
    }
  }
}

/**
 * Update engagement, objectives and terrain from a camera snapshot. Engagement only where the app is the one who
 * knows — the simulation, or a camera that sees the table; on the tabletop with units placed by hand it is the
 * players' call, and the map's positions decide only where the AI is heading.
 */
function applySnapshot(state: GameState): void {
  const snap = state.sense;
  if (!snap || !snap.calibrated) return;
  const decide = autoEngagement(state);
  for (const u of state.army.units) {
    if (u.location !== 'table') continue;
    const pts = aiModels(state, u);
    if (!decide) {
      // Objectives still follow the map; who is engaged does not.
      if (pts && u.objective.kind === 'marker') {
        const m = state.markers.find((x) => x.id === (u.objective as { markerId: number }).markerId);
        if (m) { const at = pts.some((p) => dist(p, m) <= 3); u.atObjective = at; if (at) u.lastMarker = m.id; }
      }
      continue;
    }
    if (!pts) {
      // No camera track: judge engagement from the AI unit's estimated position, the same way your units do.
      const q = aiPos(state, u);
      if (!q || unitById(u.defId).tags.includes('Flying')) continue;
      const near = state.playerUnits.filter((pu) => pu.location === 'table' && !pu.destroyed && !playerUnitFlying(pu) && (() => { const p = snap.players[pu.id]?.[0]; return !!p && dist(p, q) <= 1.05; })());
      if (u.engaged && !near.length) pushLog(state, 'system', `${u.label} is no longer engaged.`);
      u.engaged = near.length > 0;
      u.engagedEnemySupply = near.reduce((a, e) => a + playerUnitSupply(e), 0);
      continue;
    }
    const eng = engagedWith(state, u);
    const wasEngaged = u.engaged;
    u.engaged = eng.length > 0;
    u.engagedEnemySupply = eng.reduce((a, e) => a + playerUnitSupply(e), 0);
    if (wasEngaged !== u.engaged) pushLog(state, 'system', `Camera: ${u.label} is ${u.engaged ? `engaged with ${eng.map((e) => e.name).join(', ')}` : 'no longer engaged'}.`);
    if (u.objective.kind === 'marker') {
      const m = state.markers.find((x) => x.id === (u.objective as { markerId: number }).markerId);
      if (m) {
        const at = pts.some((p) => dist(p, m) <= 3);
        if (at && !u.atObjective) pushLog(state, 'system', `Camera: ${u.label} reached Marker ${m.id}.`);
        u.atObjective = at;
        if (at) u.lastMarker = m.id;
      }
    }
  }
  for (const pu of state.playerUnits) {
    if (!decide || pu.location !== 'table' || !snap.players[pu.id]?.length) continue;
    const eng = state.army.units.filter((u) => u.location === 'table' && unitsEngaged(state, 'players', pu.id, 'ai', u.id));
    pu.engagedWith = eng.map((u) => u.id);
    pu.engaged = eng.length > 0;
  }
  for (const [nStr, t] of Object.entries(snap.terrain)) {
    const piece = state.terrain.pieces.find((p) => p.n === Number(nStr));
    if (!piece) continue;
    const rotated = (t.rot === 90) !== (piece.w < piece.h);
    const w = rotated ? piece.h : piece.w;
    const h = rotated ? piece.w : piece.h;
    piece.w = w;
    piece.h = h;
    piece.x = Math.round((t.x - w / 2) * 2) / 2;
    piece.y = Math.round((t.y - h / 2) * 2) / 2;
  }
}

/**
 * Where a Mission Marker goes. The deployment card and the terrain map are drawn separately, so now and then a
 * card puts a marker inside a wall; the rules do not cover it, so the marker is set at the nearest spot clear of
 * the wall and the table setup says so. Ramps and area terrain are fine to stand a marker on.
 */
/** Whether an AI attack was made with an INSTANT weapon: your Units cannot declare Reactions to it. */
export function attackIsInstant(state: GameState, a: { attacker: { side: Side; unitId: string }; weapon: string; instant?: boolean }): boolean {
  if (a.attacker.side !== 'ai') return false;
  if (a.instant) return true;
  const u = state.army.units.find((x) => x.id === a.attacker.unitId);
  return !!u && !!unitById(u.defId).weapons.find((w) => w.name === a.weapon)?.keywords.some((k) => k.k === 'INSTANT');
}

function reject(state: GameState, reason?: string): GameState {
  pushLog(state, 'system', `Not allowed: ${(reason ?? 'illegal action').replace(/\.$/, '')}.`);
  return state;
}

/** Move a unit's Leading Model to `pt` and set the rest of its models legally around it (bases never overlap). */
function setPlayerPosition(state: GameState, pu: PlayerUnit, pt: { x: number; y: number }, opts: PlaceOptions = { avoidEngaging: true }): void {
  const manual = !state.sense || (!state.sense.manual && !Object.keys(state.sense.players).length);
  // A model moved, was moved or was PLACED: the unit loses the Stationary Status for this Round.
  pu.movedRound = state.round;
  placeUnit(state, 'players', pu.id, pt, opts);
  if (manual) state.sense!.manual = true;
  applySnapshot(state);
}

/** Check and resolve the target of an ability or boost. Returns a context or an error message. */
function resolveAbilityTargets(state: GameState, pu: PlayerUnit | null, spec: AbilitySpec, cmd: { friendlyId?: string; enemyId?: string; point?: { x: number; y: number } }): Omit<AbilityContext, 'state' | 'unit'> | string {
  const from = pu ? playerPos(state, pu) : null;
  // An ability's range is measured as every range is: base edge to base edge, between the closest models of the
  // two units (null when either side's models are not known, and then the range is not enforced).
  const gap = (side: 'ai' | 'players', id: string): number | null => (pu ? abilityGap(state, pu, side, id) : null);
  const range = pu && spec.rangeFor ? spec.rangeFor(pu) : spec.range;
  const beyond = (d: number | null) => range !== undefined && d !== null && d > range + 0.05;
  if (spec.target === 'friendly') {
    const f = state.playerUnits.find((x) => x.id === cmd.friendlyId);
    if (!f || f.destroyed || f.location !== 'table') return `Pick ${spec.targetHint ?? 'a friendly unit on the battlefield'}.`;
    if (spec.friendlyFilter && !spec.friendlyFilter(f)) return `${f.name} is not a valid target (${spec.targetHint ?? 'wrong type'}).`;
    if (beyond(gap('players', f.id))) return `${f.name} is out of range (${range}").`;
    return { friendly: f };
  }
  if (spec.target === 'enemy') {
    const e = state.army.units.find((x) => x.id === cmd.enemyId);
    if (!e || e.location !== 'table') return 'Pick an enemy unit on the battlefield.';
    if (beyond(gap('ai', e.id))) return `${e.label} is out of range (${range}").`;
    return { enemy: e };
  }
  if (spec.target === 'point') {
    if (!cmd.point) return 'Click a spot on the map.';
    if (beyond(pu ? abilityGapToPoint(state, pu, cmd.point) : null)) return `That spot is out of range (${range}").`;
    const t = state.terrain.table;
    if (cmd.point.x < 0 || cmd.point.y < 0 || cmd.point.x > t.width || cmd.point.y > t.height) return 'Pick a spot on the table.';
    return { point: cmd.point };
  }
  return {};
}

/**
 * What a support ability changed, seen from outside: a snapshot before it resolves and the differences after.
 * Heals, buffs, debuffs, shields and models coming back are otherwise invisible until someone reads the log.
 */
type FxSnap = { players: Record<string, { dmg: number; models: number; fx: string[]; statuses: string[] }>; ai: Record<string, { models: number; debuffs: string[]; statuses: string[] }> };

function snapshotFx(state: GameState): FxSnap {
  const players: FxSnap['players'] = {};
  for (const p of state.playerUnits) players[p.id] = { dmg: p.damageMarker, models: p.models, fx: (p.effects ?? []).map((e) => e.source), statuses: [...(p.statuses ?? [])] };
  const ai: FxSnap['ai'] = {};
  for (const u of state.army.units) ai[u.id] = { models: u.models, debuffs: (u.debuffs ?? []).map((d) => d.source), statuses: [...(u.statuses ?? [])] };
  return { players, ai };
}

function emitFxChanges(state: GameState, before: FxSnap): void {
  const added = (now: string[], was: string[]) => now.filter((x, i) => now.indexOf(x) === i && now.filter((y) => y === x).length > was.filter((y) => y === x).length);
  for (const p of state.playerUnits) {
    const b = before.players[p.id];
    if (!b) {
      if (p.summoned) emit(state, { kind: 'effect', side: 'players', unitId: p.id, label: 'SUMMONED', tone: 'good' });
      continue;
    }
    if (p.damageMarker < b.dmg) emit(state, { kind: 'effect', side: 'players', unitId: p.id, label: `HEALED +${b.dmg - p.damageMarker}`, detail: `${p.name} repairs ${b.dmg - p.damageMarker} damage`, tone: 'good' });
    else if (p.damageMarker > b.dmg && !p.destroyed) emit(state, { kind: 'effect', side: 'players', unitId: p.id, label: `−${p.damageMarker - b.dmg}`, detail: `${p.name} suffers ${p.damageMarker - b.dmg} damage`, tone: 'bad' });
    if (p.models > b.models) emit(state, { kind: 'effect', side: 'players', unitId: p.id, label: `+${p.models - b.models} MODEL${p.models - b.models === 1 ? '' : 'S'}`, detail: `${p.name} returns to the fight`, tone: 'good' });
    for (const src of added((p.effects ?? []).map((e) => e.source), b.fx)) {
      const text = (p.effects ?? []).find((e) => e.source === src)?.text;
      emit(state, { kind: 'effect', side: 'players', unitId: p.id, label: src.toUpperCase(), detail: text, tone: 'good' });
    }
    for (const st of added([...(p.statuses ?? [])], b.statuses)) emit(state, { kind: 'effect', side: 'players', unitId: p.id, label: st.toUpperCase(), detail: `${p.name} gains ${st}`, tone: 'good' });
  }
  for (const u of state.army.units) {
    const b = before.ai[u.id];
    if (!b) continue;
    for (const src of added((u.debuffs ?? []).map((d) => d.source), b.debuffs)) {
      const text = (u.debuffs ?? []).find((d) => d.source === src)?.text;
      emit(state, { kind: 'effect', side: 'ai', unitId: u.id, label: src.toUpperCase(), detail: text, tone: 'bad' });
    }
    for (const st of added([...(u.statuses ?? [])], b.statuses)) emit(state, { kind: 'effect', side: 'ai', unitId: u.id, label: st.toUpperCase(), detail: `${u.label} gains ${st}`, tone: 'bad' });
  }
}

/**
 * Damage suffered outside an attack (Stimpack's NON-LETHAL DAMAGE): hold it up while a Medic or Queen nearby is
 * asked whether to spend its Reaction on reducing it. Nothing is offered when nothing could pay or help.
 */
function offerDamageReaction(state: GameState, pu: PlayerUnit, amount: number, source: string): void {
  if (amount <= 0 || pu.destroyed) return;
  offerReaction(state, { kind: 'damage', unitId: pu.id, amount, source });
}

/** Hold the game on this moment when one of your Reactions can answer it. Returns whether it is held. */
function offerReaction(state: GameState, pr: PendingReaction): boolean {
  if (!reactionOffers(state, pr).length) return false;
  state.pendingReaction = pr;
  return true;
}

/** Use one offered Reaction: pay it, spend it for the round and resolve it. Returns an error, or null. */
function useReaction(state: GameState, pr: PendingReaction, o: ReactionOffer): string | null {
  const ru = state.playerUnits.find((x) => x.id === o.unitId);
  if (!ru) return 'That Reaction is no longer available.';
  const who = o.cardId ? ownerOf((state.playerCards ?? []).find((c) => c.id === o.cardId) ?? {}) : ownerOf(ru);
  if ((state.reacted ?? []).includes(who)) return 'Each player may resolve only one Reaction per Activation.';
  if (o.cardId) {
    const card = (state.playerCards ?? []).find((c) => c.id === o.cardId);
    const spec = CARD_BOOSTS[o.name];
    if (!card || card.exhausted || !spec) return 'That card is no longer Ready.';
    const line = spec.apply({ state, unit: ru });
    if (line.startsWith('!')) return line.slice(1);
    card.exhausted = true;
    state.reacted = [...(state.reacted ?? []), who];
    pushLog(state, 'players', `${cardDef(card.defId)?.name ?? o.name}: ${line}`);
    emit(state, { kind: 'effect', side: 'players', unitId: ru.id, label: o.name.toUpperCase(), detail: line, tone: 'good' });
    return null;
  }
  const rab = playerUnitDef(ru).abilities.find((a) => a.name === o.name);
  const price = rab ? abilityCost(state, ru, rab) : { cost: o.costAmount, notes: [] as string[], commit: () => {} };
  const pay = payFor(state, price.cost, undefined, ownerOf(ru));
  if (typeof pay === 'string') return pay;
  for (const c of pay) c.exhausted = true;
  price.commit();
  state.reacted = [...(state.reacted ?? []), who];
  const spec = UNIT_ABILITIES[o.name];
  if (!spec?.repeatable) ru.used = [...(ru.used ?? []), o.name];
  if (spec?.once === 'game') ru.usedGame = [...(ru.usedGame ?? []), o.name];
  const paid = pay.length ? ` (paid with ${pay.map((c) => cardDef(c.defId)?.name).join(', ')})` : '';
  const target = state.playerUnits.find((x) => x.id === pr.unitId);
  const ai = pr.aiUnitId ? state.army.units.find((u) => u.id === pr.aiUnitId) : undefined;
  const say = (line: string, unitId = ru.id, side: 'players' | 'ai' = 'players', tone: 'good' | 'bad' = 'good') => {
    pushLog(state, 'players', `${line}${paid}`);
    emit(state, { kind: 'effect', side, unitId, label: o.name.toUpperCase(), detail: line, tone });
  };
  switch (o.name) {
    case 'Life Support':
    case 'Transfusion': {
      if (!target) return null;
      const back = Math.min(o.reduce ?? 0, pr.amount, target.damageMarker);
      target.damageMarker -= back;
      pr.amount -= back;
      pushLog(state, 'players', `${o.name}: ${ru.name} reduces the ${pr.source} damage on ${target.name} by ${back}.${paid}`);
      emit(state, { kind: 'effect', side: 'players', unitId: target.id, label: `${o.name} −${back}`, detail: `${ru.name} reduces the ${pr.source} damage`, tone: 'good' });
      return null;
    }
    case 'Hierarch’s Stand': {
      // The attack is redirected to this unit, which may Evade it until the End of the enemy's Activation.
      pr.unitId = ru.id;
      ru.effects = [...(ru.effects ?? []), { id: `hierarch-${state.round}-${state.log.length}`, source: 'Hierarch’s Stand', text: 'May make an Evade Roll against the redirected attack.', mods: { mayEvade: true }, until: 'round' }];
      say(`Hierarch’s Stand: ${ai?.label ?? 'The attack'} is redirected from ${target?.name ?? 'its target'} to ${ru.name}.`);
      return null;
    }
    case 'Hallucination': {
      if (!target) return null;
      target.effects = [...(target.effects ?? []), { id: `halluc-${state.round}-${state.log.length}`, source: 'Hallucination', text: 'May make an Evade Roll against this attack.', mods: { mayEvade: true }, until: 'round' }];
      say(`Hallucination: ${target.name} may make an Evade Roll against ${ai?.label ?? 'the attack'}.`, target.id);
      return null;
    }
    case 'Debilitating Saliva': {
      if (!ai) return null;
      ai.debuffs = [...(ai.debuffs ?? []), { id: `saliva-${state.round}-${state.log.length}`, source: 'Debilitating Saliva', text: 'DEBUFF Hit (1) on its Ranged Weapons' }];
      // The order's dice are already in hand: its Ranged Weapons hit on one more.
      if (state.step.kind === 'AI_ORDER' && state.step.order.unitId === ai.id) for (const b of state.step.order.batches) b.hitMod = (b.hitMod ?? 0) - 1;
      say(`Debilitating Saliva: ${ai.label} gains DEBUFF Hit (1) on its Ranged Weapons.`, ai.id, 'ai', 'bad');
      return null;
    }
    case 'Concussive Shells': {
      if (!ai) return null;
      ai.statDebuffs = [...(ai.statDebuffs ?? []).filter((d) => d.stat !== 'speed'), { stat: 'speed', amount: 2 }];
      say(`Concussive Shells: ${ai.label} gains DEBUFF Speed (2).`, ai.id, 'ai', 'bad');
      return null;
    }
    case 'Lunge': {
      const moved = lungeToward(state, ru, ai);
      say(moved > 0 ? `Lunge: ${ru.name} moves ${moved.toFixed(1)}" towards ${ai?.label ?? 'the attacker'}.` : `Lunge: ${ru.name} has no room to move towards ${ai?.label ?? 'the attacker'}.`);
      return null;
    }
    case 'Lightning Dash': {
      ru.dashFrom = pr.targetId ?? '';
      say(`Lightning Dash: ${ru.name} may declare a second Charge against a different Enemy Unit.`);
      return null;
    }
    default:
      say(`${o.name}: ${ru.name}.`);
      return null;
  }
}

/** Lunge: a Move action Directly Towards the attacking Unit, as far as its Speed allows, stopping outside Engagement Range. */
function lungeToward(state: GameState, ru: PlayerUnit, ai: AiUnitInstance | undefined): number {
  const from = playerPos(state, ru);
  const to = ai ? aiPos(state, ai) : null;
  if (!from || !to) return 0;
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d < 0.01) return 0;
  const lead = unitShapes(state, 'players', ru.id)[0];
  const foe = ai ? unitShapes(state, 'ai', ai.id) : [];
  // Stop with the base clear of Engagement Range of the attacker's nearest model.
  const room = lead && foe.length ? Math.min(...foe.map((f) => edgeDistance(lead, f))) - ENGAGEMENT_IN - 0.1 : d - 2;
  const step = Math.max(0, Math.min(effectiveSpeed(ru), room));
  if (step <= 0.05) return 0;
  const pt = { x: from.x + ((to.x - from.x) / d) * step, y: from.y + ((to.y - from.y) / d) * step };
  if (!passable(pt, standingPieces(state, 'players', ru.id))) return 0;
  setPlayerPosition(state, ru, pt, { avoidEngaging: true, facing: Math.atan2(to.y - from.y, to.x - from.x) });
  const after = playerPos(state, ru);
  return after ? Math.hypot(after.x - from.x, after.y - from.y) : 0;
}

/**
 * Carry on from a held moment once its Reactions are answered: the enemy's attack or charge goes ahead (at the
 * unit Hierarch's Stand drew it to), the enemy's Activation ends, or your unit's Activation goes on or ends.
 */
function continueAfterReaction(state: GameState, mode: MissionMode, pr: PendingReaction): void {
  const kind = pr.kind ?? 'damage';
  const order = state.step.kind === 'AI_ORDER' ? state.step.order : null;
  const u = order && pr.aiUnitId === order.unitId ? state.army.units.find((x) => x.id === order.unitId) : undefined;
  if (kind === 'aiRanged') {
    const t = state.playerUnits.find((p) => p.id === pr.unitId);
    if (!order || !u) return;
    if (!t || t.destroyed || t.location !== 'table') { finishAiOrder(state, mode, 'noTarget'); return; }
    if (aiRangedFire(state, mode, u, order, t, !!pr.firstOnly)) return;
    endAiRanged(state, mode, u.id, t.id, 'attacked');
    return;
  }
  if (kind === 'afterAiRanged') {
    if (state.step.kind === 'AI_ORDER') finishAiOrder(state, mode, pr.report ?? 'attacked', pr.enemySupply);
    return;
  }
  if (kind === 'aiCharge') {
    if (!order || !u) return;
    aiChargeRoll(state, mode, u, order, pr.unitId);
    return;
  }
  if (kind === 'afterCharge') {
    const pu = state.playerUnits.find((p) => p.id === pr.unitId);
    // Lightning Dash used: the unit stays active for its second Charge. Declined: its Activation goes on as usual.
    if (pu && !pu.dashFrom && state.step.kind === 'PLAYERS_TURN') settleActivation(state, mode, pu, 'charge');
  }
}

/**
 * Whether a unit arriving from Reserves could not be set down with its Leading Model at `pt`: a model would stand in
 * the enemy's Zone of Influence. Tried on a copy of the game, so nothing is moved when it cannot.
 */
function arrivalProblem(state: GameState, unitId: string, pt: { x: number; y: number }, swapId?: string): string | null {
  const trial = structuredClone(state);
  const pu = trial.playerUnits.find((x) => x.id === unitId);
  if (!pu) return null;
  let at = pt;
  if (swapId) {
    const out = trial.playerUnits.find((x) => x.id === swapId);
    if (out) { at = playerPos(trial, out) ?? pt; toReserve(trial, out); }
  }
  pu.location = 'table';
  trial.sense ??= { at: 0, calibrated: true, ai: {}, players: {}, terrain: {}, unknown: [], manual: true };
  // A Deploy may never end Out of Coherency: every model must have a spot beside the Leading Model.
  const cramped = coherencyProblem(trial, 'players', pu.id, at);
  if (cramped) return cramped;
  placeUnit(trial, 'players', pu.id, at, { avoidEngaging: true });
  return unitInEnemyZoi(trial, pu) ? "A model would end in the AI's Zone of Influence. No Unit arriving from Reserves may end there." : null;
}

/** Return one of your units to Reserves: it keeps its Damage and its Activation Markers, and loses SIEGE MODE. */
function toReserve(state: GameState, pu: PlayerUnit): void {
  pu.location = 'reserves';
  pu.statuses = (pu.statuses ?? []).filter((x) => x !== 'Siege Mode');
  pu.engaged = false;
  pu.engagedWith = [];
  if (state.sense) delete state.sense.players[pu.id];
}

/** Exhaust Ready cards to pay a resource cost. Each player pays from their own cards and no one else's. */
function payFor(state: GameState, cost: number, payWith?: string[], owner = 0): NonNullable<GameState['playerCards']> | string {
  if (cost <= 0) return [];
  if (payWith?.length) {
    const cards = (state.playerCards ?? []).filter((c) => payWith.includes(c.id));
    if (cards.some((c) => ownerOf(c) !== owner)) return 'That card belongs to another player.';
    if (cards.some((c) => c.exhausted)) return 'One of those cards is already exhausted.';
    if (payValue(state, payWith) < cost) return `Those cards provide only ${payValue(state, payWith)}. The cost is ${cost}.`;
    // A cost takes no more than it asks for: a card the rest of the payment already covers stays Ready.
    const spare = sparePayCard(state, payWith, cost);
    if (spare) return `${cardDef(spare.defId)?.name ?? 'That card'} is not needed to pay ${cost}. The other cards cover it.`;
    return cards;
  }
  const auto = autoPay(state, cost, [], owner);
  return auto ?? `Not enough Ready cards to pay ${cost}.`;
}

function finishPlayerAction(state: GameState, mode: MissionMode, pu: PlayerUnit, key: 'movement' | 'assault' | 'combat', action: 'deploy' | 'move' | 'run' | 'disengage' | 'hold' | 'attack' | 'charge'): void {
  pu.activated[key] = true;
  if (isBurrowed(pu)) {
    // Regeneration (Assault Phase): a Burrowed unit resolves HEAL (2) when it becomes Activated.
    if (key === 'assault' && hasAbility(pu, 'Regeneration') && pu.damageMarker > 0) {
      const healed = Math.min(2, pu.damageMarker);
      pu.damageMarker -= healed;
      pushLog(state, 'players', `Regeneration: ${pu.name} heals ${healed}.`);
    }
    // Any action but Hold ends Burrowed; Tunneling Claws keeps it through Move and Run.
    const keeps = action === 'hold' || ((action === 'move' || action === 'run') && hasAbility(pu, 'Tunneling Claws'));
    if (!keeps) {
      pu.statuses = (pu.statuses ?? []).filter((x) => x !== 'Burrowed');
      pushLog(state, 'players', `${pu.name} unburrows.`);
    }
  }
  // Path of Shadows lasts until the unit performs another action; Darkness Descends until the End of the Round.
  if (pu.hiddenThroughRound !== state.round) pu.statuses = (pu.statuses ?? []).filter((x) => x !== 'Hidden');
  // One With the Shadows: after it fully resolves an Action, the unit gains HIDDEN.
  if (hasAbility(pu, 'One With the Shadows') && pu.location === 'table' && !pu.destroyed) pu.statuses = [...new Set([...(pu.statuses ?? []), 'Hidden' as const])];
  pu.effects = (pu.effects ?? []).filter((e) => e.until !== 'action');
  // After moving or holding, the unit stays active so you can adjust its models into coherency before ending it.
  for (const other of state.playerUnits) if (other.id !== pu.id) other.mayAdjust = false;
  if (pu.models > 1 && action !== 'attack' && !(action === 'charge' && !state.lastCharge?.success)) pu.mayAdjust = true;
  // It also stays active while it still has an Active ability to use (move, then Blink), or a weapon it may still
  // fire this activation (a SIDEARM after its main attack, or its main weapon after a SIDEARM).
  if (action !== 'attack') pu.firedThisActivation = [];
  settleActivation(state, mode, pu, action);
}

/**
 * After an action: the unit stays active while it has something left to do (coherency to fix, a weapon to fire,
 * an Active ability, a Reaction waiting on its Charge, a Lightning Dash to declare); otherwise its Activation ends.
 */
/**
 * After its action a unit stays active until the player ends its activation: a SIDEARM still to fire, an ability,
 * its models to tidy, or nothing at all, the choice to move on is theirs. Only a unit no longer on the table (it
 * went back to Reserves, or was destroyed) ends it at once.
 */
function settleActivation(state: GameState, mode: MissionMode, pu: PlayerUnit, _action: 'deploy' | 'move' | 'run' | 'disengage' | 'hold' | 'attack' | 'charge'): void {
  state.activeUnitId = pu.id;
  if (pu.location === 'table' && !pu.destroyed) return;
  state.activeUnitId = null;
  pu.firedThisActivation = [];
  state.turn = 'ai';
  advanceTurn(state, mode);
}

function finishAiOrder(state: GameState, mode: MissionMode, report: string, enemySupply?: number): void {
  // Hallucination and Hierarch's Stand last until the End of the enemy's Activation.
  for (const pu of state.playerUnits) if (pu.effects?.some((e) => e.mods.mayEvade)) pu.effects = pu.effects.filter((e) => !e.mods.mayEvade);
  const held = state.pendingReaction?.kind;
  if (held === 'aiRanged' || held === 'afterAiRanged' || held === 'aiCharge') state.pendingReaction = undefined;
  applyOrderReport(state, mode, report, { enemySupply });
  state.turn = 'players';
  advanceTurn(state, mode);
}

/**
 * A Blast Template's Spillover (Part 8.7.6): every Unit under the template other than the target, Friendly or Enemy,
 * is attacked in its own Batch with one die for each of its models covered, no Rate of Attack modifiers and no
 * Surge. The defender's dice are rolled here.
 */
function resolveSpillover(state: GameState, mode: MissionMode, attacker: { side: Side; unitId: string; label: string }, fired: WeaponProfile, hits: BlastHit[], statuses: readonly string[], attackerDef: UnitDef, attackerUpgrades: readonly string[]): void {
  const ctx = ctxFor(state);
  const aftershock = statuses.includes('Siege Mode') && ownsAbility(attackerDef, attackerUpgrades, 'Aftershock Rounds');
  const base = unitById(attackerDef.id).weapons.find((w) => w.id === fired.id) ?? fired;
  for (const h of hits) {
    const weapon = { ...base, roa: 1, blast: false, surgeTypes: [], surgeDie: undefined, keywords: base.keywords.filter((k) => k.k !== 'LOCKED IN' && k.k !== 'BURST FIRE') };
    if (h.side === 'ai') {
      const u = state.army.units.find((x) => x.id === h.id);
      if (!u || u.location !== 'table') continue;
      const tdef = unitById(u.defId);
      const shooter = attacker.side === 'players' ? state.playerUnits.find((p) => p.id === attacker.unitId) : undefined;
      const before = currentSupply(tdef, u.models);
      const a = resolveAttack(ctx.rng, {
        attacker, defender: { side: 'ai', unitId: u.id, label: u.label },
        weapon: { ...weapon, dmg: aftershock ? Math.max(1, aiUnitSize(u)) : weapon.dmg }, models: h.models, phase: 'Assault',
        defenderDef: tdef, defenderHp: unitHp(tdef, u.upgrades),
        defenderState: { models: u.models, damageMarker: u.damageMarker, shieldsLeft: u.shieldsLeft },
        armourMod: aiDebuff(u, 'armour') - aiArmourBonus(state, u), evadeMod: aiDebuff(u, 'evade'),
        evadeReason: aiEvadeReason(state, u, 'Assault', shooter, weapon),
        toughFirst: aiPassiveTough(state, u, activationKey(state, attacker.unitId)).tough,
      });
      applyDamageToAi(state, mode, u, a.damage, before, null);
      state.lastAttack = a;
      state.attackLog.push(a);
      emit(state, { kind: 'attack', attack: a });
      pushLog(state, attacker.side, `Spillover: ${u.label} takes ${a.hits} hits, ${a.damage} damage${a.removed ? `, ${a.removed} model(s) removed` : ''}.`);
    } else {
      const pu = state.playerUnits.find((x) => x.id === h.id);
      if (!pu || pu.location !== 'table' || pu.destroyed) continue;
      const pdef = playerUnitDef(pu);
      const ev = attacker.side === 'ai' ? evadeFor(state, pu, { phase: 'Assault', weapon: weapon.name, attacker: { unitId: attacker.unitId } }) : null;
      const reason = ev?.reason ?? (isHidden(pu) ? 'Hidden' : pu.engaged ? 'engaged target' : null);
      const a = resolveAttack(ctx.rng, {
        attacker, defender: { side: 'players', unitId: pu.id, label: pu.name },
        weapon: { ...weapon, dmg: aftershock ? Math.max(1, playerUnitSize(pu)) : weapon.dmg }, models: h.models, phase: 'Assault',
        defenderDef: pdef, defenderHp: unitHp(pdef, pu.upgrades),
        defenderState: { models: pu.models, damageMarker: pu.damageMarker, shieldsLeft: pu.shieldsLeft },
        armourMod: -armourBonusOf(state, pu), evadeReason: reason,
        tough: passiveToughFor(pu).tough,
      });
      const r = applyDamage(pdef, { models: pu.models, damageMarker: pu.damageMarker, shieldsLeft: pu.shieldsLeft }, a.damage, { hp: unitHp(pdef, pu.upgrades) });
      applyToPlayer(state, pu, r, null);
      state.lastAttack = a;
      state.attackLog.push(a);
      emit(state, { kind: 'attack', attack: a });
      pushLog(state, attacker.side, `Spillover: ${pu.name} takes ${a.hits} hits, ${a.damage} damage${r.removed ? `, ${r.removed} model(s) lost` : ''}.`);
    }
  }
  commitRng(state, ctx.rng);
}

/** Veteran of Tarsonis on one of your units: +1 to its Armour while it is Within 3" of a Mission Marker. */
function armourBonusOf(state: GameState, pu: PlayerUnit): number {
  return playerUnitDef(pu).stats.armour - playerArmour(state, pu);
}

/** Apply already-computed damage to an AI unit (models/marker set by the caller via a resolved attack). */
/**
 * Casualties leave the table: a unit's known model positions are cut down to the models it has left, the ones
 * farthest from the attacker going first (the models not in reach), so range and line of sight are never measured
 * to a model that is gone.
 */
function dropCasualties(state: GameState, side: 'ai' | 'players', id: string, keep: number, from?: { x: number; y: number } | null): void {
  const list = side === 'ai' ? state.sense?.ai : state.sense?.players;
  const pts = list?.[id];
  if (!pts || pts.length <= keep) return;
  const shapes = unitShapes(state, side, id);
  const far = (i: number) => (from ? Math.hypot(pts[i]!.x - from.x, pts[i]!.y - from.y) : i);
  // The enemy units this one is fighting, by their bases.
  const foes = (side === 'ai'
    ? state.playerUnits.filter((p) => p.location === 'table' && !p.destroyed && !playerUnitFlying(p)).map((p) => unitShapes(state, 'players', p.id))
    : state.army.units.filter((u) => u.location === 'table' && !unitById(u.defId).tags.includes('Flying')).map((u) => unitShapes(state, 'ai', u.id))
  ).filter((f) => f.length && shapes.length === pts.length && shapes.some((m) => f.some((e) => edgeDistance(m, e) <= ENGAGEMENT_IN + 0.01)));
  const left = new Set(pts.map((_, i) => i));
  const gone = new Set<number>();
  // An Engaged Unit's casualties come off in strict order (Part 8.7.5): models not Within Engagement Range of an
  // enemy, then those Within it but not in base-to-base contact, then those in contact. A model whose loss would end
  // the Engagement with an enemy Unit is never chosen while another casualty is possible. Within a step, and for a
  // Unit that is not Engaged, the ones farthest from the attacker go first.
  const tier = (i: number): number => {
    if (!foes.length) return 1;
    const gap = Math.min(...foes.flatMap((f) => f.map((e) => edgeDistance(shapes[i]!, e))));
    return gap > ENGAGEMENT_IN + 0.01 ? 1 : gap > CONTACT_GAP ? 2 : 3;
  };
  const breaks = (i: number): boolean => foes.some((f) => {
    const holds = (j: number) => f.some((e) => edgeDistance(shapes[j]!, e) <= ENGAGEMENT_IN + 0.01);
    return holds(i) && ![...left].some((j) => j !== i && holds(j));
  });
  while (left.size > keep) {
    const order = [...left].sort((a, b) => tier(a) - tier(b) || far(b) - far(a));
    const pick = order.find((i) => tier(i) === 1 || !breaks(i)) ?? order[0]!;
    left.delete(pick);
    gone.add(pick);
  }
  list![id] = pts.filter((_, i) => !gone.has(i));
}
/** Base-to-base contact, with the slack the map's placement leaves. */
const CONTACT_GAP = 0.06;

/** The nearest of your models to an AI unit (for casualties entered by hand, with no attacker named). */
function nearestPlayerPoint(state: GameState, u: AiUnitInstance): { x: number; y: number } | null {
  const c = aiPos(state, u);
  if (!c) return null;
  let best: { x: number; y: number } | null = null;
  for (const pu of state.playerUnits) for (const p of state.sense?.players[pu.id] ?? []) if (!best || Math.hypot(p.x - c.x, p.y - c.y) < Math.hypot(best.x - c.x, best.y - c.y)) best = p;
  return best;
}

function applyDamageToAi(state: GameState, mode: MissionMode, u: AiUnitInstance, damage: number, supplyBefore: number, from?: { x: number; y: number } | null, maxRemovable?: number): void {
  const def = unitById(u.defId);
  const r = applyDamage(def, { models: u.models, damageMarker: u.damageMarker, shieldsLeft: u.shieldsLeft }, damage, { hp: unitHp(def, u.upgrades), maxRemovable });
  u.models = r.models;
  dropCasualties(state, 'ai', u.id, r.models, from);
  u.damageMarker = r.damageMarker;
  u.shieldsLeft = r.shieldsLeft;
  state.aiSupplyLostThisRound += Math.max(0, supplyBefore - currentSupply(def, u.models));
  if (r.destroyed) {
    destroyUnit(state, mode, u);
    for (const pu of state.playerUnits) {
      pu.engagedWith = pu.engagedWith.filter((id) => id !== u.id);
      pu.engaged = pu.engagedWith.length > 0;
    }
  }
}

/** Run a mutation on a player unit and credit any Supply bracket drop to this round's tally. */
function trackPlayerSupply(state: GameState, pu: PlayerUnit, fn: () => void): void {
  const before = pu.destroyed ? 0 : playerUnitSupply(pu);
  fn();
  const after = pu.destroyed ? 0 : playerUnitSupply(pu);
  state.playerSupplyLostThisRound = (state.playerSupplyLostThisRound ?? 0) + Math.max(0, before - after);
}

function applyToPlayer(state: GameState, pu: PlayerUnit, r: ReturnType<typeof applyDamage>, from?: { x: number; y: number } | null): void {
  trackPlayerSupply(state, pu, () => applyToPlayerRaw(state, pu, r, from));
}

function applyToPlayerRaw(state: GameState, pu: PlayerUnit, r: ReturnType<typeof applyDamage>, from?: { x: number; y: number } | null): void {
  pu.models = r.models;
  dropCasualties(state, 'players', pu.id, r.models, from);
  pu.damageMarker = r.damageMarker;
  pu.shieldsLeft = r.shieldsLeft;
  if (r.destroyed) {
    pu.destroyed = true;
    pu.location = 'destroyed';
    pu.engaged = false;
    for (const u of state.army.units) if (pu.engagedWith.includes(u.id)) u.engagedEnemySupply = Math.max(0, u.engagedEnemySupply - 0);
    pu.engagedWith = [];
    if (state.sense) delete state.sense.players[pu.id];
    pushLog(state, 'ai', `${pu.name} destroyed.`);
    emit(state, { kind: 'destroyed', side: 'players', unitId: pu.id, label: pu.name });
  }
}

/** AI attack against a player unit using the order's pre-rolled batch; may pause for manual saves. */
function aiAttackPlayer(state: GameState, mode: MissionMode, u: AiUnitInstance, order: AiOrder, batchIdx: number, target: PlayerUnit, weaponPhase: 'Assault' | 'Combat' | 'Impact', reportAfter: string, enemySupply?: number): boolean {
  const ctx = ctxFor(state);
  const def = unitById(u.defId);
  const batch = weaponPhase === 'Impact' ? order.impact : order.batches[batchIdx];
  if (!batch) return false;
  const fxImpact = (u.fx ?? []).reduce((a, f) => a + (f.impactHit ?? 0), 0);
  const base = weaponPhase === 'Impact'
    ? { id: 'impact', name: 'IMPACT', phase: 'Combat' as const, range: 'E' as const, target: 'Ground' as const, roa: impactDice(def, u.upgrades) || 1, hit: def.impact?.hit ?? 4, dmg: 1, surgeTypes: [], keywords: [], text: '' }
    : (def.weapons.find((w) => w.id === batch.weaponId) ?? availableWeapons(def, u.upgrades, weaponPhase)[0]);
  if (!base) return false;
  void fxImpact;
  const tdef = playerUnitDef(target);
  // HIDDEN (and BURROWED) units are immune to IMPACT.
  if (weaponPhase === 'Impact' && isHidden(target)) {
    pushLog(state, 'players', `${target.name} is ${isBurrowed(target) ? 'Burrowed' : 'Hidden'}: immune to IMPACT.`);
    return false;
  }
  const mine = unitShapes(state, 'ai', u.id), theirs = unitShapes(state, 'players', target.id);
  const gap = mine.length && theirs.length ? Math.max(0, unitGap(state, 'ai', u.id, 'players', target.id)) : null;
  // The weapon as the unit fires it at this target: its own upgrades and Passives, the keywords that depend on the
  // target (BURST FIRE, LOCKED IN, Aftershock Rounds), and what its abilities gave it this Round (Stimpack).
  let shot = base;
  if (weaponPhase !== 'Impact') {
    const fired = firedWeapon(base, {
      def, upgrades: u.upgrades, statuses: u.statuses, targetDist: gap,
      target: { def: tdef, size: playerUnitSize(target), stationary: isStationary(state, target), engagedWithOtherFriendly: target.engagedWith.some((id) => id !== u.id), activated: state.phase !== 'scoring' && target.activated[state.phase] },
      sharedMarker: state.markers.some((m) => mine.some((sh) => edgeToPoint(sh, m) - MARKER_RADIUS_IN <= 3.05) && theirs.some((sh) => edgeToPoint(sh, m) - MARKER_RADIUS_IN <= 3.05)),
    }).weapon;
    const keywords = fired.keywords.map((k) => ({ ...k }));
    for (const f of u.fx ?? []) {
      if (!f.precision) continue;
      if (f.weaponPhase && f.weaponPhase !== base.phase) continue;
      if (f.weapons && !f.weapons.some((n) => base.name.toLowerCase().includes(n))) continue;
      raiseKeyword(keywords, 'PRECISION', f.precision);
    }
    shot = { ...fired, keywords };
  }
  // IMPACT: X dice for each model that ended in the Fighting or Supporting Rank, not for every model of the unit.
  let models = batch.models;
  if (weaponPhase === 'Impact' && mine.length && theirs.length) models = Math.max(1, Math.min(u.models, combatRanks(state, 'ai', u.id, [target.id]).total || batch.models));
  // Guardian Shield and Point Defence Laser take dice out of the Attack Pool before it is rolled; the player who
  // resolves them chooses which, so the best of the AI's pre-rolled dice go.
  let presetRolls = batch.rolls;
  let fewerDice = 0;
  // A Blast Template counts the models it covers: its dice and its Surge.
  let blast: number | undefined;
  let spill: BlastHit[] = [];
  if (weaponPhase !== 'Impact' && shot.blast) {
    const tpl = blastTemplate(state, 'players', target.id, aiPos(state, u), shot.target);
    blast = tpl.main;
    spill = tpl.spill;
    shot = { ...shot, roa: shot.roa + blast };
  }
  if (weaponPhase === 'Assault') {
    const def2 = defensiveDiceRemoval(state, target, shot.keywords.some((k) => k.k === 'INSTANT'));
    if (def2.remove > 0) {
      const pool = shot.roa * models;
      fewerDice = Math.min(pool, def2.remove);
      const rolled = (batch.rolls ?? []).slice(0, pool);
      while (rolled.length < pool) rolled.push(ctx.rng.d6());
      // Take out the highest dice, keeping the rest in the order they were rolled.
      const out = new Set(rolled.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r).slice(0, fewerDice).map((x) => x.i));
      presetRolls = rolled.filter((_, i) => !out.has(i));
      pushLog(state, 'players', `${def2.notes.join(' + ')}: ${fewerDice} fewer dice against ${target.name}.`);
      if (def2.consumeDroneId) {
        const drone = state.playerUnits.find((p) => p.id === def2.consumeDroneId);
        if (drone) { drone.location = 'destroyed'; drone.destroyed = true; if (state.sense) delete state.sense.players[drone.id]; }
      }
      if (pool - fewerDice <= 0) { commitRng(state, ctx.rng); return false; }
    }
  }
  // No more models can be removed than are Visible to the attacker, unless the target is Engaged or the weapon
  // ignores Line of Sight (Part 8.7.4, step 5).
  const blind = weaponPhase !== 'Assault' || target.engaged || shot.keywords.some((k) => k.k === 'INDIRECT FIRE') || playerUnitFlying(target);
  const visible = blind || !mine.length || !theirs.length ? undefined : theirs.filter((t) => mine.some((m) => losBetweenBases(m, aiUnitSize(u), t, playerUnitSize(target), state.terrain.pieces))).length || undefined;
  const hitNeed = weaponPhase === 'Impact' ? { ...shot, hit: targetNumber(shot.hit - fxImpact) } : shot;
  const a = resolveAttack(ctx.rng, {
    attacker: { side: 'ai', unitId: u.id, label: u.label },
    defender: { side: 'players', unitId: target.id, label: target.name },
    weapon: hitNeed, models, phase: weaponPhase,
    hitMod: batch.hitMod ?? 0,
    farModels: weaponPhase === 'Assault' ? Math.min(models, batch.farModels ?? 0) : 0,
    fewerDice,
    maxRemovable: visible,
    defenderDef: tdef,
    defenderHp: unitHp(tdef, target.upgrades),
    defenderState: { models: target.models, damageMarker: target.damageMarker, shieldsLeft: target.shieldsLeft },
    evadeReason: isHidden(target) ? (isBurrowed(target) ? 'Burrowed' : 'Hidden') : weaponPhase === 'Assault' && target.engaged ? 'engaged target' : null,
    // Damage waits for the saves step (the Combat Tray rolls them for you unless you roll your own), so the table
    // changes at the moment the result is shown.
    manualSaves: true,
    presetRolls,
    // A Blast Template rolls no Surge die: its Surge is the number of models it covered.
    presetSurge: blast ?? batch.surgeRoll,
  });
  commitRng(state, ctx.rng);
  if (a.pendingSaves) {
    state.pendingSaves = { attack: a, order, report: reportAfter, enemySupply, remaining: [], ...(spill.length ? { spill: { weaponId: base.id, hits: spill } } : {}) };
    state.step = { kind: 'AI_SAVES', attack: a };
    pushLog(state, 'ai', `${u.label} fires ${shot.name} at ${target.name}: ${a.hits} hits. Roll your saves.`);
    return true;
  }
  const hp = unitHp(tdef, target.upgrades);
  const r = applyDamage(tdef, { models: target.models, damageMarker: target.damageMarker, shieldsLeft: target.shieldsLeft }, a.damage, { hp, maxRemovable: a.maxRemovable });
  applyToPlayer(state, target, r, aiPos(state, u));
  state.lastAttack = a;
  state.attackLog.push(a);
  emit(state, { kind: 'attack', attack: a });
  pushLog(state, 'ai', `${u.label} ${weaponPhase === 'Impact' ? 'IMPACT on' : `fires ${shot.name} at`} ${target.name}: ${a.hits} hits, ${a.damage} damage${r.removed ? `, ${r.removed} model(s) lost` : ''}.`);
  return false;
}

/**
 * Fire the given weapon batches of an order at one target, in sequence. Returns true when it stopped
 * to wait for manual saves (the rest of the batches are queued on pendingSaves).
 */
function fireBatches(state: GameState, mode: MissionMode, u: AiUnitInstance, order: AiOrder, target: PlayerUnit, indices: number[], reportAfter: string): boolean {
  for (let k = 0; k < indices.length; k++) {
    if (target.destroyed) return false;
    if (aiAttackPlayer(state, mode, u, order, indices[k]!, target, 'Assault', reportAfter)) {
      if (state.pendingSaves) {
        state.pendingSaves.remaining = indices.slice(k + 1);
        state.pendingSaves.targetId = target.id;
      }
      return true;
    }
  }
  return false;
}

/**
 * The AI's declared Ranged Attack, fired at `t`: every weapon batch that reaches it, each with the models that can.
 * Returns true when it stopped for your saves. `firstOnly`: a Charge order falling back on its guns fires its first one.
 */
/**
 * The units an AI Ranged Attack order may declare as its target, best first: the ones its main weapon can reach,
 * and failing those the ones another of its weapons can (a Rocket Launcher with INDIRECT FIRE needs no Line of
 * Sight). Each weapon at its Range or, failing that, its LONG RANGE; never a HIDDEN unit beyond 4", never one the
 * weapon may not target.
 */
function aiTargets(state: GameState, u: AiUnitInstance, order: AiOrder, firstOnly = false): ReturnType<typeof visibleEnemies> {
  const flare = (u.debuffs ?? []).reduce((a, d) => a + (d.rangeMod ?? 0), 0);
  const noLR = (u.debuffs ?? []).some((d) => d.noLongRange);
  const sieged = (u.statuses ?? []).includes('Siege Mode') && aiHas(u, 'Point Blank');
  for (const [i, b] of order.batches.entries()) {
    if (firstOnly && i > 0) break;
    const w = aiWeapon(u, b.weaponId);
    const indirect = !!w?.keywords.some((k) => k.k === 'INDIRECT FIRE');
    const legal = (list: ReturnType<typeof visibleEnemies>) => list
      .filter((v) => !hiddenFrom(v.unit, v.nearest) && aiMayTarget(state, u, v.unit, w))
      // Point Blank: in SIEGE MODE the gun cannot come down on what the tank is Engaged with.
      .filter((v) => !(sieged && v.unit.engagedWith.includes(u.id)));
    const range = Math.max(0, (typeof b.range === 'number' ? b.range : 0) + (b.rangeMod ?? 0) + flare);
    let vis = legal(visibleEnemies(state, u, range, false, indirect));
    if (!vis.length && b.longRange && !noLR) vis = legal(visibleEnemies(state, u, b.longRange + (b.rangeMod ?? 0) + flare, false, indirect));
    if (vis.length) return vis;
  }
  return [];
}

function aiRangedFire(state: GameState, mode: MissionMode, u: AiUnitInstance, order: AiOrder, t: PlayerUnit, firstOnly = false): boolean {
  const def = unitById(u.defId);
  const flare = (u.debuffs ?? []).reduce((a, d) => a + (d.rangeMod ?? 0), 0);
  const noLR = (u.debuffs ?? []).some((d) => d.noLongRange);
  const notHidden = (list: ReturnType<typeof visibleEnemies>) => list.filter((v) => !hiddenFrom(v.unit, v.nearest));
  // The target is chosen by the main weapon's reach; each other batch (a SIDEARM, a SPECIALIST's weapon) then fires
  // at it only if it may and the target is within that weapon's own range, with the models that can reach.
  const indices: number[] = [];
  order.batches.forEach((b, i) => {
    if (firstOnly && i > 0) return;
    const w = aiWeapon(u, b.weaponId);
    if (w && !aiMayTarget(state, u, t, w)) {
      if (i > 0) pushLog(state, 'ai', `${u.label}: ${w.name} cannot target ${t.name}.`);
      return;
    }
    // An order read off the map for the table carries its LONG RANGE -1 on the whole batch: here each model is measured.
    if (b.longShot) { b.hitMod = (b.hitMod ?? 0) + 1; b.longShot = false; }
    const bRange = Math.max(0, (typeof b.range === 'number' ? b.range : 0) + (b.rangeMod ?? 0) + flare);
    // INDIRECT FIRE: no Line of Sight needed (the target, if it cannot be seen, makes an Evade Roll).
    const indirect = !!w?.keywords.some((k) => k.k === 'INDIRECT FIRE');
    const near = notHidden(visibleEnemies(state, u, bRange, false, indirect)).find((v) => v.unit.id === t.id);
    const all = b.longRange && !noLR ? notHidden(visibleEnemies(state, u, b.longRange + (b.rangeMod ?? 0) + flare, false, indirect)).find((v) => v.unit.id === t.id) : near;
    if (!near && !all) {
      if (i > 0) pushLog(state, 'ai', `${u.label}: ${def.weapons.find((w2) => w2.id === b.weaponId)?.name ?? 'sidearm'} is out of range of ${t.name}.`);
      return;
    }
    // LONG RANGE: the models beyond the weapon's Range but within its LONG RANGE fire at -1 to Hit; the rest as normal.
    const roa = b.models ? b.dice / b.models : b.dice;
    const carried = b.models;
    const inRange = Math.min(carried, near?.firing ?? 0);
    b.models = Math.min(carried, (all ?? near)!.firing);
    b.farModels = Math.max(0, b.models - inRange);
    b.dice = Math.round(roa * b.models);
    indices.push(i);
  });
  return fireBatches(state, mode, u, order, t, indices, 'attacked');
}

/** The AI's Ranged Attack is fully resolved: Lunge may answer it, then the AI's order ends. */
function endAiRanged(state: GameState, mode: MissionMode, aiUnitId: string, targetId: string, report: string, enemySupply?: number): void {
  if (state.step.kind === 'AI_ORDER' && offerReaction(state, { kind: 'afterAiRanged', unitId: targetId, aiUnitId, amount: 0, source: report, report, enemySupply })) return;
  finishAiOrder(state, mode, report, enemySupply);
}

/** How far the AI unit's charge must reach your unit (to Engagement Range between bases, around terrain), and by which path. */
function aiChargePath(state: GameState, u: AiUnitInstance, pu: PlayerUnit): { d: number; path: { x: number; y: number }[]; tp: Shape } | null {
  const from = aiPos(state, u);
  const lead = unitShapes(state, 'ai', u.id)[0];
  const tModels = unitShapes(state, 'players', pu.id);
  if (!from || !lead || !tModels.length) return null;
  // Nearest enemy model by base gap; charge distance counts to Engagement Range between bases.
  const tp = tModels.reduce((a, b) => (edgeDistance(lead, a) <= edgeDistance(lead, b) ? a : b));
  const sp = shortestPath(from, tp, state.terrain.pieces, state.terrain.table, pathOptionsFor(state, 'ai', u.id));
  const d = Math.max(0, edgeDistance(lead, tp) + (sp.length - Math.hypot(tp.x - from.x, tp.y - from.y)) - 1);
  return { d, path: sp.path.length >= 2 ? sp.path : [from, tp], tp };
}

/** The AI's declared Charge against your unit: roll it, and on a success move in and resolve its IMPACT. */
function aiChargeRoll(state: GameState, mode: MissionMode, u: AiUnitInstance, order: AiOrder, targetId: string): void {
  const ctx = ctxFor(state);
  const def = unitById(u.defId);
  const card = currentCard(state.orderDeck);
  const pu = state.playerUnits.find((p) => p.id === targetId);
  const from = aiPos(state, u);
  const cp = pu && from && pu.location === 'table' && !pu.destroyed ? aiChargePath(state, u, pu) : null;
  if (!pu || !from || !cp) { finishAiOrder(state, mode, 'noTarget'); return; }
  // Its Speed as it stands now: a DEBUFF (Concussive Shells) shortens the charge. The dice and the inches its order
  // states are the ones rolled: 2D6 keeping the higher for Metabolic Boost or Charge, +2" for Leap.
  const speed = Math.max(0, speedFor(def, u.models) + speedModFor(state, u));
  const bonus = order.charge ? Math.max(0, order.charge.min - 1 - order.charge.speed) : orderChargeBonus(state);
  const roll = rollCharge(ctx.rng, speed, order.charge?.dice ?? DIFFICULTIES[state.config.difficulty].chargeDice, bonus);
  const needed = cp.d;
  const success = roll.reach >= needed;
  state.lastCharge = { side: 'ai', unitId: u.id, targetId: pu.id, rolls: roll.rolls, reach: roll.reach, needed, success, round: state.round };
  emit(state, { kind: 'charge', ...state.lastCharge });
  commitRng(state, ctx.rng);
  if (success) {
    const end = contactPointAlong(cp.path, unitShapes(state, 'ai', u.id)[0]!, cp.tp);
    placeUnit(state, 'ai', u.id, end, { contactWith: [pu.id], facing: Math.atan2(cp.tp.y - from.y, cp.tp.x - from.x), path: cp.path });
    order.placed = true;
    u.engaged = true;
    u.movedRound = state.round;
    pu.engaged = true;
    if (!pu.engagedWith.includes(u.id)) pu.engagedWith.push(u.id);
    pushLog(state, 'ai', `${u.label} charges ${pu.name}: ${speed}${bonus ? ` + ${bonus}` : ''} + ${roll.roll} = ${roll.reach}" (needed ${needed.toFixed(1)}"). Success!`);
    if (order.impact && aiAttackPlayer(state, mode, u, order, 0, pu, 'Impact', 'charged', playerUnitSupply(pu))) return;
    finishAiOrder(state, mode, 'charged', playerUnitSupply(pu));
  } else {
    pushLog(state, 'ai', `${u.label} charges ${pu.name}: ${speed}${bonus ? ` + ${bonus}` : ''} + ${roll.roll} = ${roll.reach}" (needed ${needed.toFixed(1)}"). Failed.`);
    finishAiOrder(state, mode, 'chargeFailed');
  }
}

/**
 * Whether the AI order can attack from the known positions, without rolling anything. `attack` is null when positions
 * are unknown (no camera or map placement for your units), in which case the player is asked on the table.
 */
export function aiIntent(state: GameState, order: AiOrder): { attack: boolean | null; target?: string; reason: string } {
  const u = state.army.units.find((x) => x.id === order.unitId);
  if (!u || u.location !== 'table') return { attack: null, reason: '' };
  const def = unitById(u.defId);
  const card = currentCard(state.orderDeck);
  const livePlayers = state.playerUnits.filter((p) => p.location === 'table' && !p.destroyed && state.sense?.players[p.id]?.length);
  if (!livePlayers.length || !state.sense) return { attack: null, reason: '' };
  // Use the unit's estimated position when the camera has not seen it (same as the resolver).
  const restore = !state.sense.ai[u.id]?.length && u.est;
  if (restore) state.sense.ai[u.id] = [u.est!];
  try {
    if (order.type === 'closeCombat') {
      const eng = livePlayers.filter((p) => p.engagedWith.includes(u.id) || aiEngagedWith(state, u).some((e) => e.id === p.id));
      return eng.length ? { attack: true, target: eng[0]!.name, reason: '' } : { attack: false, reason: `${u.label} is not in base contact with any of your units. No close combat.` };
    }
    const inRange = (firstOnly = false) => aiTargets(state, u, order, firstOnly);
    if (order.type === 'ranged') {
      const vis = inRange();
      return vis.length ? { attack: true, target: vis[0]!.unit.name, reason: '' } : { attack: false, reason: `No enemy in range and Line of Sight of ${u.label}. It runs toward its objective.` };
    }
    if (order.type === 'charge') {
      const from = aiPos(state, u);
      const speed = Math.max(0, speedFor(def, u.models) + speedModFor(state, u));
      const threshold = (card.chargeThreshold === 'likely' ? speed + 3 : speed + 6) + (order.charge ? Math.max(0, order.charge.min - 1 - order.charge.speed) : orderChargeBonus(state));
      if (from) {
        for (const pu of livePlayers) {
          if (playerUnitFlying(pu)) continue;
          const tp = state.sense.players[pu.id]![0]!;
          if (shortestPath(from, tp, state.terrain.pieces, state.terrain.table, pathOptionsFor(state, 'ai', u.id)).length <= threshold) return { attack: true, target: pu.name, reason: '' };
        }
      }
      const vis = order.batches.length ? inRange(true) : [];
      if (vis.length) return { attack: true, target: vis[0]!.unit.name, reason: '' };
      return { attack: false, reason: `Nothing within charge reach of ${u.label}. It runs toward its objective.` };
    }
    return { attack: null, reason: '' };
  } finally {
    if (restore) delete state.sense.ai[u.id];
  }
}

/** Autopilot: resolve the current AI order from known positions. */
function aiResolve(state: GameState, mode: MissionMode): void {
  if (state.step.kind !== 'AI_ORDER') return;
  const order = state.step.order;
  const u = findUnit(state, order.unitId);
  const def = unitById(u.defId);
  const card = currentCard(state.orderDeck);
  const ctx = ctxFor(state);
  // The order was already turned into a Run when it was given (no attack was possible then), and the map has
  // shown the unit running. A unit acts once per activation: it runs, and never also charges or fires.
  if (order.noTarget && order.type !== 'closeCombat') {
    commitRng(state, ctx.rng);
    finishAiOrder(state, mode, 'noTarget');
    return;
  }
  // Make sure the unit has a known position for targeting.
  if (u.location === 'table' && !state.sense?.ai[u.id]?.length && u.est) {
    const snap: SenseSnapshot = state.sense ?? { at: 0, calibrated: true, ai: {}, players: {}, terrain: {}, unknown: [], manual: true };
    snap.calibrated = true;
    state.sense = snap;
    placeUnit(state, 'ai', u.id, u.est, { avoidEngaging: !u.engaged });
  }
  const livePlayers = state.playerUnits.filter((p) => p.location === 'table' && !p.destroyed && state.sense?.players[p.id]?.length);
  const pickFocus = (cands: PlayerUnit[]): PlayerUnit => {
    const f = order.focus?.primary ?? 'nearest';
    const sorted = cands.slice().sort((a, b) => {
      if (f === 'weakest') return a.models - b.models;
      if (f === 'highestSupply') return playerUnitSupply(b) - playerUnitSupply(a);
      const pa = state.sense!.players[a.id]![0]!;
      const pb = state.sense!.players[b.id]![0]!;
      const from = aiPos(state, u) ?? pa;
      return dist(from, pa) - dist(from, pb);
    });
    return sorted[0]!;
  };
  if (order.type === 'ranged') {
    const main = order.batches[0];
    if (main && livePlayers.length) {
      const vis = aiTargets(state, u, order);
      const mainW = aiWeapon(u, main.weaponId);
      if (vis.length) {
        const target = pickFocus(vis.map((v) => v.unit));
        const t = state.playerUnits.find((p) => p.id === target.id)!;
        commitRng(state, ctx.rng);
        // The attack is declared: your Reactions to it come first (Hierarch's Stand, Hallucination, Debilitating Saliva).
        if (offerReaction(state, { kind: 'aiRanged', unitId: t.id, aiUnitId: u.id, amount: 0, source: u.label, validTargets: vis.map((v) => v.unit.id), instant: !!mainW?.keywords.some((k) => k.k === 'INSTANT') })) return;
        if (aiRangedFire(state, mode, u, order, t)) return;
        endAiRanged(state, mode, u.id, t.id, 'attacked');
        return;
      }
    }
    commitRng(state, ctx.rng);
    finishAiOrder(state, mode, 'noTarget');
    return;
  }
  if (order.type === 'charge') {
    const from = aiPos(state, u);
    const speed = Math.max(0, speedFor(def, u.models) + speedModFor(state, u));
    const threshold = (card.chargeThreshold === 'likely' ? speed + 3 : speed + 6) + (order.charge ? Math.max(0, order.charge.min - 1 - order.charge.speed) : orderChargeBonus(state));
    let best: { pu: PlayerUnit; d: number } | null = null;
    if (from) {
      for (const pu of livePlayers) {
        if (playerUnitFlying(pu)) continue;
        const cp = aiChargePath(state, u, pu);
        // The Leading Model may not end Within Engagement Range of a Unit that is not the Charge's target.
        const lead0 = unitShapes(state, 'ai', u.id)[0];
        const blocked = cp && lead0 ? chargeEndProblem(state, 'ai', u.id, { ...lead0, ...contactPointAlong(cp.path, lead0, cp.tp) }, [pu.id]) : null;
        if (cp && !blocked && cp.d <= threshold && (!best || cp.d < best.d)) best = { pu, d: cp.d };
      }
    }
    if (best) {
      commitRng(state, ctx.rng);
      // The Charge is declared: Concussive Shells may answer it before the dice are rolled.
      if (offerReaction(state, { kind: 'aiCharge', unitId: best.pu.id, aiUnitId: u.id, amount: 0, source: u.label })) return;
      aiChargeRoll(state, mode, u, order, best.pu.id);
      return;
    }
    // Brawler fallback: shoot if possible.
    if (order.batches.length && livePlayers.length) {
      const main = order.batches[0]!;
      const mainW = aiWeapon(u, main.weaponId);
      const vis = aiTargets(state, u, order, true);
      if (vis.length) {
        const target = pickFocus(vis.map((v) => v.unit));
        commitRng(state, ctx.rng);
        if (offerReaction(state, { kind: 'aiRanged', unitId: target.id, aiUnitId: u.id, amount: 0, source: u.label, validTargets: vis.map((v) => v.unit.id), firstOnly: true, instant: !!mainW?.keywords.some((k) => k.k === 'INSTANT') })) return;
        if (aiRangedFire(state, mode, u, order, target, true)) return;
        endAiRanged(state, mode, u.id, target.id, 'attacked');
        return;
      }
    }
    commitRng(state, ctx.rng);
    finishAiOrder(state, mode, 'noTarget');
    return;
  }
  if (order.type === 'closeCombat') {
    const eng = livePlayers.filter((p) => p.engagedWith.includes(u.id) || aiEngagedWith(state, u).some((e) => e.id === p.id));
    if (eng.length && order.batches.length) {
      const target = eng.slice().sort((a, b) => a.models - b.models)[0]!;
      // Close Ranks: the AI presses its models into base contact before striking (set them as the map shows).
      const lead = unitShapes(state, 'ai', u.id)[0];
      const foe = lead ? unitShapes(state, 'players', target.id).reduce((a, b) => (edgeDistance(lead, a) <= edgeDistance(lead, b) ? a : b), unitShapes(state, 'players', target.id)[0]!) : undefined;
      if (lead && foe && edgeDistance(lead, foe) > 0.06) {
        const opts = pathOptionsFor(state, 'ai', u.id);
        const path = shortestPath(lead, foe, state.terrain.pieces, state.terrain.table, opts).path;
        let end = contactPointAlong(path.length >= 2 ? path : [lead, foe], lead, foe);
        const moved = Math.hypot(end.x - lead.x, end.y - lead.y);
        if (moved > 3) end = { x: lead.x + ((end.x - lead.x) / moved) * 3, y: lead.y + ((end.y - lead.y) / moved) * 3 };
        const before = state.sense!.ai[u.id]!;
        const engagedIds = eng.map((p) => p.id);
        state.sense!.ai[u.id] = closeRanksPositions(state, 'ai', u.id, end, engagedIds);
        if (!engagedIds.every((id) => unitsEngaged(state, 'ai', u.id, 'players', id))) state.sense!.ai[u.id] = before;
        else { u.est = { x: state.sense!.ai[u.id]![0]!.x, y: state.sense!.ai[u.id]![0]!.y }; refreshCoherency(state, 'ai', u.id); }
      }
      u.movedRound = state.round;
      const ranks = combatRanks(state, 'ai', u.id, [target.id]).total;
      if (ranks > 0 && order.batches[0]) order.batches[0] = { ...order.batches[0], models: Math.min(u.models, ranks) };
      pushLog(state, 'ai', `${u.label} close ranks: ${ranks} model${ranks === 1 ? '' : 's'} fight ${target.name}.`);
      emit(state, { kind: 'closeRanks', side: 'ai', unitId: u.id, fighting: ranks, supporting: 0 });
      if (aiAttackPlayer(state, mode, u, order, 0, target, 'Combat', 'done')) return;
    }
    commitRng(state, ctx.rng);
    finishAiOrder(state, mode, 'done');
    return;
  }
  void card;
  // Deploy / move / run / disengage / hold: the estimate advances in finishAiOrder.
  commitRng(state, ctx.rng);
  finishAiOrder(state, mode, order.reports.some((r) => r.id === 'done') ? 'done' : order.reports[0]?.id ?? 'done');
}

