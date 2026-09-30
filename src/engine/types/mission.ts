import type { GameState, Scale, ScoringAnswers, ScoringPrompt } from './game';
import type { AiObjective, AiUnitInstance } from './army';
import type { Faction } from './units';
import type { Rng } from '../rng';

export interface MissionCtx {
  state: GameState;
  rng: Rng;
  log(text: string): void;
}

export interface MissionMode {
  id: string;
  name: string;
  sc2Inspiration: string;
  blurb: string;
  official?: boolean;
  scales: Scale[];
  rounds: number;
  /** Base supply values before difficulty bonuses (defaults per scale if absent). */
  supply?(scale: Scale): { start: number; escalation: number };
  /** Optional replacement order deck (card ids). */
  deck?(faction: Faction): string[] | undefined;
  briefing(state: GameState): string[];
  onSetup(ctx: MissionCtx): void;
  onRoundStart(ctx: MissionCtx): void;
  /** Notes shown on the round start screen. */
  roundNotes?(ctx: MissionCtx): string[];
  deployFilter?(ctx: MissionCtx, candidates: AiUnitInstance[]): AiUnitInstance[];
  deployCap?(ctx: MissionCtx): number | undefined;
  objectiveFor?(ctx: MissionCtx, unit: AiUnitInstance): AiObjective | undefined;
  scoringPrompts(ctx: MissionCtx): ScoringPrompt[];
  onScoring(ctx: MissionCtx, answers: ScoringAnswers): void;
  /** Called after scoring. `final` = last round done. Return a result to end the game. */
  winCheck(ctx: MissionCtx, final: boolean): 'won' | 'lost' | 'draw' | null;
  onAiUnitDestroyed?(ctx: MissionCtx, unit: AiUnitInstance): void;
  onOrderReport?(ctx: MissionCtx, unit: AiUnitInstance, report: string): void;
  /** What the mission needs from the players right now, for the top strip (missions that don't say get a VP line). */
  stakes?(state: GameState): { text: string; tone: 'ok' | 'warn' | 'danger' };
}

export interface MutatorDef {
  id: string;
  name: string;
  cost: 1 | 2 | 3;
  text: string;
}
