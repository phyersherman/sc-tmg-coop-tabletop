import type { MissionMode } from '../types/mission';
import type { GameState, MarkerState, ScoringPrompt, Side } from '../types/game';
import type { AiUnitInstance } from '../types/army';
import { isStructure } from '../director/selectors';
import { aiHolding } from '../sense/query';
import { applyMarkerControl, controlled, countAnswer, leadBy, markerPrompts, officialMode, scaledSupply, vpResult } from './framework';

/** The mission's own lead rule, checked at the End of Game Check of each Scoring Phase; after the last round, the most VP wins and level VP is a Draw. */
const lead = (n: number) => (c: { state: GameState }, final: boolean) => leadBy(c.state, n) ?? (final ? vpResult(c.state) : null);

export const frontlines: MissionMode = officialMode({
  id: 'frontlines',
  name: 'Frontlines',
  blurb: 'Hold the line. From round 2, 1 VP per controlled marker, +2 more for each marker taken from the enemy that round.',
  onScoring: (c, a) => {
    const cap = applyMarkerControl(c.state, a);
    if (c.state.round >= 2) {
      c.state.vp.ai += controlled(c.state, 'ai').length + 2 * cap.ai.length;
      c.state.vp.players += controlled(c.state, 'players').length + 2 * cap.players.length;
    }
  },
  winCheck: lead(10),
});

export const holdPosition: MissionMode = officialMode({
  id: 'hold-position',
  name: 'Hold Position',
  blurb: 'From round 2: 1 VP per controlled neutral or own-colour marker, 2 VP per marker of the enemy colour.',
  onScoring: (c, a) => {
    applyMarkerControl(c.state, a);
    if (c.state.round >= 2) {
      for (const m of c.state.markers) {
        if (!m.active || !m.controlledBy) continue;
        const enemyColour = m.affinity !== 'neutral' && m.affinity !== m.controlledBy;
        c.state.vp[m.controlledBy] += enemyColour ? 2 : 1;
      }
    }
  },
  winCheck: lead(10),
});

/** Markers a side may Gather at: active, under its control, and neutral or of the Enemy colour. */
function gatherMarkers(state: GameState, side: Side): MarkerState[] {
  return state.markers.filter((m) => m.active && m.controlledBy === side && m.affinity !== side);
}

/** AI Units that spent their Assault Phase action this round: an attack, a Charge or a Run. */
function assaultActors(state: GameState): string[] {
  const rec = state.modeState['assaultActions'] as { round: number; ids: string[] } | undefined;
  return rec && rec.round === state.round ? rec.ids : [];
}

/** Within 3" of the marker: by the map where the Unit's models are on it, else by where it was last sent. */
function aiUnitAt(state: GameState, u: AiUnitInstance, m: MarkerState): boolean {
  if (state.sense?.ai[u.id]?.length) return aiHolding(state, m).some((x) => x.id === u.id);
  return u.atObjective && u.objective.kind === 'marker' && u.objective.markerId === m.id;
}

/**
 * The AI Units that Gather this round: Unengaged, Within 3" of a marker the AI controlled through the Assault
 * Phase, and with no Assault Phase action taken (a Hold, or no activation at all). Reckon it before this round's
 * marker control is applied: a marker taken at this Scoring Phase was not the AI's to Gather at.
 */
function aiGatherers(state: GameState): AiUnitInstance[] {
  const spots = gatherMarkers(state, 'ai');
  if (!spots.length) return [];
  const acted = assaultActors(state);
  return state.army.units.filter((u) => u.location === 'table' && !u.engaged && !isStructure(u) && !acted.includes(u.id) && spots.some((m) => aiUnitAt(state, u, m)));
}

/** No marker is controlled before the first Scoring Phase, so nobody Gathers in round 1. */
const playersMayGather = (state: GameState): boolean => state.round >= 2 && gatherMarkers(state, 'players').length > 0;

export const gatherTheResources: MissionMode = officialMode({
  id: 'gather-the-resources',
  name: 'Gather the Resources',
  blurb: 'From round 2: 2 VP per controlled marker of the enemy colour. An Unengaged Unit Within 3" of a neutral or enemy-colour marker its side controls may Gather (+1 VP) instead of taking its Assault Phase action.',
  scoringPrompts: (c) => [
    ...markerPrompts(c.state),
    ...(playersMayGather(c.state)
      ? [{ id: 'gathers', kind: 'number', text: 'Gather actions your Units took this round: +1 VP each. To Gather, an Unengaged Unit Within 3" of a neutral or Enemy-colour Mission Marker you control gives up its Assault Phase action.', min: 0, max: 10, defaultValue: 0 } as ScoringPrompt]
      : []),
  ],
  onOrderReport: (c, u) => {
    const s = c.state;
    if (s.phase !== 'assault') return;
    // A Hold is no action. Every other Assault Phase order is an attack, a Charge or a Run.
    if (s.step.kind === 'AI_ORDER' && s.step.order.unitId === u.id && s.step.order.type === 'hold') return;
    const ids = assaultActors(s);
    s.modeState['assaultActions'] = { round: s.round, ids: ids.includes(u.id) ? ids : [...ids, u.id] };
  },
  onScoring: (c, a) => {
    // Gathers were made in the Assault Phase, at markers controlled since an earlier Scoring Phase.
    const mine = playersMayGather(c.state) ? countAnswer(a, 'gathers', 0, 10) : 0;
    const theirs = aiGatherers(c.state).length;
    applyMarkerControl(c.state, a);
    if (mine) {
      c.state.vp.players += mine;
      c.log(`Your Units Gather: +${mine} VP.`);
    }
    if (theirs) {
      c.state.vp.ai += theirs;
      c.log(`AI Units Gather: +${theirs} VP.`);
    }
    if (c.state.round >= 2) {
      for (const m of c.state.markers) {
        if (!m.active || !m.controlledBy) continue;
        if (m.affinity !== 'neutral' && m.affinity !== m.controlledBy) c.state.vp[m.controlledBy] += 2;
      }
    }
  },
  winCheck: lead(10),
});

export const divideAndConquer: MissionMode = officialMode({
  id: 'divide-and-conquer',
  name: 'Divide and Conquer',
  rounds: 4,
  blurb: 'Split the table into quarters. Each round: 1 VP per quarter where your total Supply is higher, 2 VP for controlling Marker 5.',
  supply: (scale) => scaledSupply(scale, { start: 4, escalation: 1 }),
  scoringPrompts: (c) => [
    ...markerPrompts(c.state),
    { id: 'playerQuarters', kind: 'number', text: 'Quarters where the players\' total Supply (units wholly within) is higher than the AI\'s.', min: 0, max: 4, defaultValue: 0 },
    { id: 'aiQuarters', kind: 'number', text: 'Quarters where the AI\'s total Supply is higher (a unit controlling a marker counts +1).', min: 0, max: 4, defaultValue: 0 },
  ],
  onScoring: (c, a) => {
    applyMarkerControl(c.state, a);
    // Four quarters, and a quarter scores for one side at most.
    const mine = countAnswer(a, 'playerQuarters', 0, 4);
    const theirs = Math.min(countAnswer(a, 'aiQuarters', 0, 4), 4 - mine);
    if (theirs < countAnswer(a, 'aiQuarters', 0, 4)) c.log(`The table has four quarters. The players score ${mine} and the AI scores ${theirs}.`);
    c.state.vp.players += mine;
    c.state.vp.ai += theirs;
    const m5 = c.state.markers.find((m) => m.id === 5);
    if (m5?.active && m5.controlledBy) c.state.vp[m5.controlledBy] += 2;
  },
  winCheck: lead(10),
});

export const supplyDrop: MissionMode = officialMode({
  id: 'supply-drop',
  name: 'Supply Drop',
  blurb: 'Markers start inactive. One random marker activates each round (Marker 5 in round 5). Controlling an active marker scores VP equal to the round it activated, then it is removed.',
  onSetup: (c) => {
    for (const m of c.state.markers) m.active = false;
  },
  onRoundStart: (c) => {
    const s = c.state;
    if (s.round >= 5) {
      const m5 = s.markers.find((m) => m.id === 5);
      if (m5 && !m5.activatedRound) {
        m5.active = true;
        m5.activatedRound = 5;
        c.log('Mission Marker 5 activates.');
      }
      return;
    }
    const inactive = s.markers.filter((m) => m.id !== 5 && !m.active && !m.activatedRound);
    if (inactive.length) {
      const m = c.rng.pick(inactive);
      m.active = true;
      m.activatedRound = s.round;
      c.log(`Supply drop: Mission Marker ${m.id} activates (worth ${s.round} VP).`);
    }
  },
  roundNotes: (c) => c.state.markers.filter((m) => m.active).map((m) => `Marker ${m.id} is active, worth ${m.activatedRound} VP.`),
  onScoring: (c, a) => {
    applyMarkerControl(c.state, a);
    for (const m of c.state.markers) {
      if (m.active && m.controlledBy) {
        c.state.vp[m.controlledBy] += m.activatedRound ?? 0;
        c.log(`Marker ${m.id} claimed by ${m.controlledBy === 'ai' ? 'the AI' : 'the players'} for ${m.activatedRound} VP and removed.`);
        m.active = false;
      }
    }
  },
  winCheck: lead(12),
});

export const OFFICIAL_MODES = [frontlines, holdPosition, gatherTheResources, divideAndConquer, supplyDrop];
