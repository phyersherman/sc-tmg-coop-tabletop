import type { MissionMode } from '../types/mission';
import { applyMarkerControl, controlled, leadBy, markerPrompts, officialMode, vpResult } from './framework';

const lead = (n: number) => (c: { state: import('../types/game').GameState }, final: boolean) => leadBy(c.state, n) ?? (final ? vpResult(c.state) : null);

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

export const gatherTheResources: MissionMode = officialMode({
  id: 'gather-the-resources',
  name: 'Gather the Resources',
  blurb: 'From round 2: 2 VP per controlled marker of the enemy colour. Unengaged units within 3" of a controlled neutral or enemy marker may Gather (+1 VP) instead of acting in the Assault phase.',
  scoringPrompts: (c) => [
    ...markerPrompts(c.state),
    { id: 'gathers', kind: 'number', text: 'Gather actions your units performed this round (+1 VP each).', min: 0, max: 10, defaultValue: 0 },
  ],
  onScoring: (c, a) => {
    applyMarkerControl(c.state, a);
    c.state.vp.players += Number(a.extra['gathers'] ?? 0);
    if (c.state.round >= 2) {
      for (const m of c.state.markers) {
        if (!m.active || !m.controlledBy) continue;
        if (m.affinity !== 'neutral' && m.affinity !== m.controlledBy) c.state.vp[m.controlledBy] += 2;
      }
    }
    // The AI gathers with units holding a neutral/blue marker instead of moving.
    const gatherers = c.state.army.units.filter((u) => u.location === 'table' && u.atObjective && u.objective.kind === 'marker' && !u.engaged);
    let g = 0;
    for (const u of gatherers) {
      const m = c.state.markers.find((x) => x.id === (u.objective as { markerId: number }).markerId);
      if (m && m.controlledBy === 'ai' && m.affinity !== 'ai') g++;
    }
    if (g) {
      c.state.vp.ai += g;
      c.log(`AI units gathered resources: +${g} VP.`);
    }
  },
  winCheck: lead(10),
});

export const divideAndConquer: MissionMode = officialMode({
  id: 'divide-and-conquer',
  name: 'Divide and Conquer',
  rounds: 4,
  blurb: 'Split the table into quarters. Each round: 1 VP per quarter where your total Supply is higher, 2 VP for controlling Marker 5.',
  supply: (scale) => (scale === 'skirmish' ? { start: 4, escalation: 1 } : { start: 8, escalation: 2 }),
  scoringPrompts: (c) => [
    ...markerPrompts(c.state),
    { id: 'playerQuarters', kind: 'number', text: 'Quarters where the players\' total Supply (units wholly within) is higher than the AI\'s.', min: 0, max: 4, defaultValue: 0 },
    { id: 'aiQuarters', kind: 'number', text: 'Quarters where the AI\'s total Supply is higher (a unit controlling a marker counts +1).', min: 0, max: 4, defaultValue: 0 },
  ],
  onScoring: (c, a) => {
    applyMarkerControl(c.state, a);
    c.state.vp.players += Number(a.extra['playerQuarters'] ?? 0);
    c.state.vp.ai += Number(a.extra['aiQuarters'] ?? 0);
    const m5 = c.state.markers.find((m) => m.id === 5);
    if (m5?.controlledBy) c.state.vp[m5.controlledBy] += 2;
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
