import type { Faction } from './units';
import type { AiArmy, AiObjective } from './army';
import type { DeploymentLayout, TerrainLayout } from './terrain';
import type { DiceInstruction } from '../units/weapons';
import type { RngState } from '../rng';
import type { PlayerUnit, SenseSnapshot } from '../sense/types';
import type { AttackResult } from '../combat/resolve';

export type Phase = 'movement' | 'assault' | 'combat' | 'scoring';
export type Side = 'ai' | 'players';
export type DifficultyId = 'casual' | 'normal' | 'hard' | 'brutal' | 'brutalPlus';
export type Scale = 'skirmish' | 'standard' | 'grand';
export type MarkerControl = 'ai' | 'players' | 'contested' | 'none';

export interface MarkerState {
  id: 1 | 2 | 3 | 4 | 5;
  x: number;
  y: number;
  affinity: Side | 'neutral';
  controlledBy: Side | null;
  active: boolean;
  locked?: boolean;
  activatedRound?: number;
  /** Where the deployment card puts it, when that spot is inside a wall and it was set beside it instead. */
  movedFrom?: { x: number; y: number; piece: string };
  /** How far from the marker a unit contests it, in inches: 3" by the book, 8" for a campaign's single objective points. */
  contestIn?: number;
  /** A co-op side marker: something of the AI's stands on it, and the AI's force never heads for it. */
  side?: boolean;
}

export interface GameOptions {
  appRollsAiDice: boolean;
  assistedSaves: boolean;
  playerHasFlying: boolean;
  /** Enter your own Armour saves by hand instead of the app rolling them. */
  manualSaves?: boolean;
  /** The AI resolves its own orders without confirmation. */
  autopilot?: boolean;
  /** The enemy force is unknown until it deploys: units in Reserves are not listed anywhere. */
  hideAiRoster?: boolean;
  /**
   * Tabletop, with a collection too small for the players' armies: the AI makes up the shortfall by bringing
   * destroyed units back with the models they free, and its units may be set down anywhere on the table more
   * than 6" from the players' models — from the opening deployment on, not only at its entry edge.
   */
  aiDropsAnywhere?: boolean;
  /**
   * The AI decides from action decks (one Movement and one Assault deck per unit type), in every kind of game.
   * On unless set to false.
   */
  actionDecks?: boolean;
  /**
   * Tabletop, AI only (the tabletop edition): no map in play, the table is the only picture, and the action cards
   * are shown as cards. Older saves of that edition carry only `actionDecks: true`, which meant the same then.
   */
  noMap?: boolean;
}

export interface GameConfig {
  modeId: string;
  /** Tabletop (the app is the opponent across your table) or video game (the app plays it out), fixed at the start. */
  playMode?: 'tabletop' | 'video';
  /** Tabletop with the overhead camera reading unit tags: chosen at setup, it cannot be turned on later. */
  camera?: boolean;
  difficulty: DifficultyId;
  /** How many players face the AI: one or two. */
  players: 1 | 2;
  playerMinerals: number;
  scale: Scale;
  aiFaction: Faction;
  mutators: string[];
  deploymentId: string;
  terrainSeed: number;
  seed: number;
  army: AiArmy;
  options: GameOptions;
  /** Player units for camera sensing (optional). */
  playerUnits?: PlayerUnit[];
  /**
   * Your Faction card and Tactical cards (card definition ids). With several players each card says whose it
   * is; a bare id belongs to player 1, which is every one-player game.
   */
  playerCards?: (string | { defId: string; owner: number })[];
  /** The rulebook map the table is set up with (Part 9.3). Without one, the layout is generated from the seed. */
  terrainMapId?: string;
  /** The ground the battle is drawn on (a campaign mission's own tileset); the art setting can still override it. */
  tileset?: 'badlands' | 'jungle' | 'twilight' | 'ashworld' | 'desert' | 'ice' | 'platform' | 'install';
}

/** One of your Faction/Tactical cards in play. */
export interface PlayerCard {
  id: string;
  defId: string;
  exhausted: boolean;
  /** The player who brought it (0-based): only they may Exhaust it. Absent means player 1. */
  owner?: number;
  /** Boost names used this game (for Once per Game boosts). */
  usedGame?: string[];
}

/** Something set on the battlefield by an ability (Creep Tumor, Force Field, Shade, Faction Indicator). */
export interface BoardToken {
  id: string;
  kind: 'creepTumor' | 'forceField' | 'shade' | 'indicator' | 'dropPoint' | 'bile';
  /** How far the token's effect reaches (Corrosive Bile: 1", or 2" with Bloated Bile Ducts). */
  radius?: number;
  x: number;
  y: number;
  label: string;
  /** Unit that created it (Shade belongs to its Adept unit). */
  ownerId?: string;
  /** The end-of-round choice for this token was made (used or declined). */
  resolved?: boolean;
  /** The route the token travelled when it was set (the Shade walks out from its Adepts). */
  path?: { x: number; y: number }[];
  stayInPlay?: boolean;
  round: number;
}

export interface FocusRule {
  primary: 'nearest' | 'weakest' | 'onMarker' | 'highestSupply' | 'lastAttacker' | 'nearestToMarker';
  markerId?: number;
  tieBreak: string[];
}

export type AiOrderType =
  | 'deploy'
  | 'move'
  | 'hold'
  | 'disengage'
  | 'ranged'
  | 'charge'
  | 'run'
  | 'closeCombat'
  | 'pass'
  | 'special';

export interface AiOrder {
  type: AiOrderType;
  unitId: string;
  title: string;
  /** Ordered instruction lines (the "if / otherwise" script). */
  lines: string[];
  focus?: FocusRule;
  heading?: AiObjective;
  headingText?: string;
  batches: DiceInstruction[];
  impact?: DiceInstruction;
  charge?: { speed: number; min: number; max: number; dice: '1d6' | '2d6high' };
  /** The rules engine already moved the unit on the map for this order (a charge into contact). */
  placed?: boolean;
  /** Buttons the player can press to report the outcome. */
  reports: OrderReportOption[];
  /** Where the unit's leading model will stand after this order (deploy / move), shown on the map before you confirm. */
  preview?: { x: number; y: number };
  /** A deploy set down away from the entry edge (see GameOptions.aiDropsAnywhere): where the leading model goes. */
  dropAt?: { x: number; y: number };
  /** Checked when the order was issued: the attack has no legal target, so the unit runs instead. */
  noTarget?: boolean;
  /** Its unit is holding its ground (a garrison before it may move): it fires or does nothing, never runs. */
  held?: boolean;
  /** Checked when the order was issued: who the AI will attack. */
  intentTarget?: string;
  /** The action card this order comes from (tabletop decks). */
  card?: import('../ai/actionDecks').ActionCard;
}

export type OrderReportOption =
  | { id: 'done'; label: string }
  | { id: 'reached'; label: string }
  | { id: 'charged'; label: string }
  | { id: 'chargeFailed'; label: string }
  | { id: 'attacked'; label: string }
  | { id: 'noTarget'; label: string }
  | { id: 'exited'; label: string };

export interface ScoringPrompt {
  id: string;
  kind: 'number' | 'yesno' | 'markers';
  text: string;
  min?: number;
  max?: number;
  defaultValue?: number | boolean;
  /** In the simulation, where every unit's position is known, the answer worked out from the map. */
  auto?: (state: GameState) => number | boolean;
}

export interface ScoringAnswers {
  markers: Record<number, MarkerControl>;
  playerSupplyLost: number;
  extra: Record<string, number | boolean>;
}

export type Step =
  | { kind: 'ROUND_START'; lines: string[] }
  | { kind: 'PHASE_START'; lines: string[] }
  | { kind: 'AI_ORDER'; order: AiOrder }
  | { kind: 'PLAYERS_TURN'; lines: string[] }
  | { kind: 'COMBAT_CHECKLIST' }
  | { kind: 'SCORING_FORM'; prompts: ScoringPrompt[] }
  | { kind: 'ROUND_END'; lines: string[] }
  | { kind: 'GAME_OVER'; result: 'won' | 'lost' | 'draw'; lines: string[] }
  | { kind: 'AI_SAVES'; attack: AttackResult };

export interface LogEntry {
  round: number;
  phase: Phase | 'setup';
  side: Side | 'system';
  text: string;
}

export interface OrderCardState {
  draw: string[];
  discard: string[];
  current: string | null;
  history: string[];
}

export interface GameState {
  version: 1;
  config: GameConfig;
  status: 'playing' | 'won' | 'lost' | 'draw';
  round: number;
  finalRound: number;
  phase: Phase;
  firstPlayer: Side;
  nextFirstPlayer: Side | null;
  turn: Side;
  passed: { ai: boolean; players: boolean };
  supply: { start: number; escalation: number; pool: number; bonus: number };
  vp: { ai: number; players: number };
  /** AI supply destroyed this round (converted to player VP at scoring). */
  aiSupplyLostThisRound: number;
  /** Supply brackets your units dropped by this round (VP for the AI at scoring). */
  playerSupplyLostThisRound: number;
  markers: MarkerState[];
  army: AiArmy;
  respawnQueue: { unitId: string; returnRound: number; modelsPct: number }[];
  respawnBudget: number; // minerals remaining for pooled respawns; Infinity = unlimited
  lowSupplyRounds: number;
  orderDeck: OrderCardState;
  modeState: Record<string, unknown>;
  /** The AI's action decks, one per unit type and phase (tabletop play). */
  aiDecks?: Record<string, import('../ai/actionDecks').DeckState>;
  terrain: TerrainLayout;
  deployment: DeploymentLayout;
  step: Step;
  rng: RngState;
  log: LogEntry[];
  /** Units that have exited the table via a lane (mode use). */
  labelCounters: Record<string, number>;
  /** Latest camera snapshot, if a camera is in use. */
  sense?: SenseSnapshot;
  playerUnits: PlayerUnit[];
  /** Players' Supply Pool values (mission values, no difficulty bonus). */
  playerSupply: { start: number; escalation: number };
  /** Most recent fully resolved attack (either side), for the dice display. */
  lastAttack?: AttackResult;
  /** Recent attacks this round for the log panel. */
  attackLog: AttackResult[];
  /** What happened, in order, for the map and feeds to present once each (ids never repeat). */
  events?: GameEvent[];
  /** Victory points after each scored round. */
  vpHistory?: { round: number; players: number; ai: number }[];
  /** Models removed by attacks in the rounds already over (this round's are in `attackLog`), for the debrief. */
  removedBefore?: { ai: number; players: number };
  eventSeq?: number;
  /** An AI attack waiting for the defender's hand-entered saves. */
  pendingSaves?: { attack: AttackResult; order: AiOrder; report: string; enemySupply?: number; /** Batch indices still to fire after the saves, at targetId. */ remaining: number[]; targetId?: string };
  /** Your Faction and Tactical cards. */
  playerCards?: PlayerCard[];
  /** Tokens set by abilities. */
  tokens?: BoardToken[];
  /** HITS X (Y) waiting to be resolved against AI units (Corrosive Bile, Shadow Strike). */
  pendingHits?: { targetId: string; hits: number; dmgPer: number; source: string; armourMod?: number }[];
  /** Damage a unit of yours has just suffered outside an attack (Stimpack), waiting on a Reaction that could reduce it. */
  pendingReaction?: { unitId: string; amount: number; source: string };
  /** Round in which a Pylon's Warp Conduit / Omega Network was used for a deploy. */
  conduitUsedRound?: number;
  /** Your unit that has taken its action but is still active: it can use abilities until you end its activation. */
  activeUnitId?: string | null;
  /** Last charge attempt, for display. */
  /** The last charge rolled, with the round it happened in: what waits for your Continue is that charge, not
   *  the same one again next round. */
  lastCharge?: { side: Side; unitId: string; targetId: string; rolls: number[]; reach: number; needed: number; success: boolean; round: number };
}

/** A presentation event: something that happened on the table. */
export type GameEvent =
  | { id: number; round: number; kind: 'attack'; attack: AttackResult }
  | { id: number; round: number; kind: 'charge'; side: Side; unitId: string; targetId: string; rolls: number[]; reach: number; needed: number; success: boolean }
  | { id: number; round: number; kind: 'closeRanks'; side: Side; unitId: string; fighting: number; supporting: number }
  | { id: number; round: number; kind: 'destroyed'; side: Side; unitId: string; label: string }
  /** A heal, buff, debuff or status that changed on a unit, so the table can see support abilities land. */
  | { id: number; round: number; kind: 'effect'; side: Side; unitId: string; label: string; detail?: string; tone: 'good' | 'bad' };
