import { playerUnitSupply } from '../sense/playerUnits';
import type { GameState, MarkerControl, ScoringAnswers, ScoringPrompt } from '../types/game';
import type { MissionCtx, MissionMode } from '../types/mission';
import type { Scale } from '../types/game';

/** Apply sticky marker control from the player's report. Returns markers captured this round per side. */
export function applyMarkerControl(state: GameState, answers: ScoringAnswers): { ai: number[]; players: number[] } {
  const captured = { ai: [] as number[], players: [] as number[] };
  for (const m of state.markers) {
    const a: MarkerControl | undefined = answers.markers[m.id];
    if (m.locked) continue;
    if (!a || a === 'contested' || a === 'none') continue;
    if (m.controlledBy !== a) {
      if (m.controlledBy !== null) captured[a].push(m.id);
      m.controlledBy = a;
    }
  }
  return captured;
}

export function markerPrompts(state: GameState): ScoringPrompt[] {
  return [
    { id: 'markers', kind: 'markers', text: `Who has the higher total Supply within 3" of each active Mission Marker? An AI unit led by a Commander hero counts +1.${state.markers.some((m) => m.side) ? ' A side-marker guard adds no Supply, but a marker where it stands alone against your Units is contested.' : ''}` },
    { id: 'playerSupplyLost', kind: 'number', text: 'Player Supply destroyed this round: the Supply brackets the players\' units dropped by, added together.', min: 0, max: 30, defaultValue: 0, auto: (s) => s.playerSupplyLostThisRound ?? 0 },
    ...(state.round >= state.finalRound ? [{ id: 'playerReserveSupply', kind: 'number', text: 'Final round: total Supply of player units still in Reserves. These count as destroyed.', min: 0, max: 30, defaultValue: 0, auto: (s) => s.playerUnits.filter((p) => p.location === 'reserves' && !p.destroyed).reduce((a, p) => a + playerUnitSupply(p), 0) } as ScoringPrompt] : []),
  ];
}

export function controlled(state: GameState, side: 'ai' | 'players'): number[] {
  return state.markers.filter((m) => m.active && m.controlledBy === side).map((m) => m.id);
}

export function baseBriefing(state: GameState): string[] {
  const d = state.deployment;
  const sequence = 'All units start in Reserves. Each round has four phases: Movement, Assault, Combat and Scoring. The players and the AI take turns activating one unit at a time. The first side to pass takes the First Player Marker for the next phase.';
  // In Simulation the app is the table: setting markers and terrain out is not something you do, so it is not said.
  if (state.config.playMode === 'video') {
    return [
      `Battlefield: ${d.table.width}" × ${d.table.height}", ${d.name}. The AI plays Red and the players play Blue.`,
      sequence,
    ];
  }
  return [
    `Table: ${d.table.width}" × ${d.table.height}". Deployment card: ${d.name}. The AI plays Red and the players play Blue.`,
    // Where the markers really are: a card's spot that falls on terrain has been moved clear of it.
    `Set the Mission Markers at these positions, measured from the top-left corner: ${(state.markers.length ? state.markers : d.markers).map((m) => `#${m.id} at (${m.x}", ${m.y}")`).join(', ')}. Markers 1 & 3 are red, 2 & 4 blue, 5 neutral.`,
    'Place terrain as shown on the map. Pieces you own may stand in for the ones shown.',
    sequence,
  ];
}

export function defaultSupply(scale: Scale): { start: number; escalation: number } {
  return scale === 'skirmish' ? { start: 3, escalation: 1 } : scale === 'standard' ? { start: 6, escalation: 2 } : { start: 9, escalation: 3 };
}

/** Default end-of-game result by VP. */
export function vpResult(state: GameState): 'won' | 'lost' | 'draw' {
  if (state.vp.players > state.vp.ai) return 'won';
  if (state.vp.players < state.vp.ai) return 'lost';
  return 'draw';
}

export function leadBy(state: GameState, n: number): 'won' | 'lost' | null {
  if (state.vp.players - state.vp.ai >= n) return 'won';
  if (state.vp.ai - state.vp.players >= n) return 'lost';
  return null;
}


export const noop = (): void => undefined;

export function officialMode(partial: Partial<MissionMode> & Pick<MissionMode, 'id' | 'name' | 'blurb'>): MissionMode {
  return {
    sc2Inspiration: 'Official mission card',
    official: true,
    scales: ['skirmish', 'standard', 'grand'],
    rounds: 5,
    briefing: (s) => baseBriefing(s),
    onSetup: noop,
    onRoundStart: noop,
    scoringPrompts: (c) => markerPrompts(c.state),
    onScoring: noop,
    winCheck: (c, final) => (final ? vpResult(c.state) : null),
    ...partial,
  };
}
