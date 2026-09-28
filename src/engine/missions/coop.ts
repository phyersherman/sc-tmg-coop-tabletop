import type { MissionMode, MissionCtx } from '../types/mission';
import type { GameState, ScoringPrompt } from '../types/game';
import type { AiUnitInstance } from '../types/army';
import { unitById } from '@data/index';
import { missionTrainFor } from '@data/missionObjects';
import { applyMarkerControl, baseBriefing, controlled, markerPrompts, vpResult } from './framework';
import { processReturns } from '../respawn';
import { makeInstance, instanceCost } from '../army/builder';
import { dist } from '../terrain/geometry';
import { grantReward, takeCounter, withSideMarkers } from './sideMarkers';

const ms = (c: MissionCtx) => c.state.modeState as Record<string, any>;

function coopMode(p: Partial<MissionMode> & Pick<MissionMode, 'id' | 'name' | 'blurb' | 'sc2Inspiration' | 'briefing' | 'onSetup' | 'onRoundStart' | 'scoringPrompts' | 'onScoring' | 'winCheck'>): MissionMode {
  return { scales: ['skirmish', 'standard', 'grand'], rounds: 5, ...p };
}

/** Add a free copy of a unit def to the AI army with special flags. */
function addSpecialUnit(state: GameState, defId: string, label: string, special: Record<string, unknown>): AiUnitInstance {
  const def = unitById(defId);
  const n = (state.labelCounters[defId] ?? 0) + 100;
  state.labelCounters[defId] = n;
  const comp = def.compositions.some((c) => c.label === 'large') ? 'large' : 'small';
  const inst = makeInstance(def, comp, label, n);
  inst.special = special;
  state.army.units.push(inst);
  return inst;
}

function highestCostDefs(state: GameState, n: number, excludeHero = true): AiUnitInstance[] {
  return state.army.units
    .filter((u) => !u.special && (!excludeHero || unitById(u.defId).role !== 'Hero'))
    .sort((a, b) => instanceCost(unitById(b.defId), b) - instanceCost(unitById(a.defId), a))
    .slice(0, n);
}

// 1. Temple of the Past — hold the centre.
export const templeOfThePast = withSideMarkers(coopMode({
  id: 'temple-of-the-past',
  name: 'Temple of the Past',
  sc2Inspiration: 'Temple of the Past',
  blurb: 'Mission Marker 5 is the Temple, and the AI throws everything at it. Hold the Temple at three Scoring phases to win. If the AI holds it at two Scoring phases in a row, the players lose.',
  briefing: (s) => [
    ...baseBriefing(s),
    'Marker 5 is the Temple. Every AI unit heads for it.',
    'Waves: in rounds 2, 3 and 4, one extra AI unit deploys free of the Supply Pool, plus one more for each extra player.',
    'Scoring: from round 2, the side that controls the Temple scores 2 VP. After round 5, two holds also win if the players do not trail on VP.',
  ],
  onSetup: (c) => {
    ms(c).holds = 0;
    ms(c).aiStreak = 0;
  },
  onRoundStart: (c) => {
    const s = c.state;
    if (s.round >= 2 && s.round <= 4) {
      const n = s.config.players;
      const cands = s.army.units.filter((u) => u.location === 'reserves').sort((a, b) => instanceCost(unitById(a.defId), a) - instanceCost(unitById(b.defId), b));
      for (const u of cands.slice(0, n)) {
        u.special = { ...(u.special ?? {}), forceDeploy: true, freeSupply: true };
        c.log(`Wave: ${u.label} deploys this round, free of the Supply Pool.`);
      }
    }
  },
  roundNotes: (c) => (c.state.round >= 2 && c.state.round <= 4 ? ['An AI wave arrives this round. It deploys free of the Supply Pool.'] : []),
  objectiveFor: () => ({ kind: 'marker', markerId: 5 }),
  scoringPrompts: (c) => markerPrompts(c.state),
  onScoring: (c, a) => {
    applyMarkerControl(c.state, a);
    const m5 = c.state.markers.find((m) => m.id === 5);
    if (c.state.round >= 2 && m5?.controlledBy) c.state.vp[m5.controlledBy] += 2;
    if (m5?.controlledBy === 'players') {
      ms(c).holds++;
      ms(c).aiStreak = 0;
    } else if (m5?.controlledBy === 'ai') ms(c).aiStreak++;
    else ms(c).aiStreak = 0;
  },
  winCheck: (c, final) => {
    if (ms(c).aiStreak >= 2) return 'lost';
    if (ms(c).holds >= 3) return 'won';
    return final ? (ms(c).holds >= 2 && vpResult(c.state) !== 'lost' ? 'won' : 'lost') : null;
  },
}), [
  { marker: 1, object: 'guard', reward: 'requisition' },
  { marker: 2, object: 'structure', reward: 'reinforce' },
  { marker: 3, object: 'guard', reward: 'firepower' },
  { marker: 4, object: 'structure', reward: 'reinforce' },
]);

// 2. Oblivion Express — intercept the trains.
export const oblivionExpress = withSideMarkers(coopMode({
  id: 'oblivion-express',
  name: 'Oblivion Express',
  sc2Inspiration: 'Oblivion Express',
  blurb: 'Three Armoured Trains cross the table from left to right, one each in rounds 1, 3 and 5. Destroy two before they leave to win. If two escape, the players lose.',
  briefing: (s) => [
    ...baseBriefing(s),
    'Each train enters from the left edge at the table\'s vertical centre. In the Movement and Assault phases it moves straight for the right edge, unless it is Engaged. A train has no weapons and never attacks.',
    'Scoring: the players score 3 VP for each train destroyed. A train that leaves by the right edge scores the AI 3 VP and adds 1 to its Supply escalation.',
  ],
  onSetup: (c) => {
    const s = c.state;
    // An armoured train of its own (18 HP, Armour 5+), never a copy of whatever the AI's priciest unit is.
    const defId = missionTrainFor(s.army.faction).id;
    for (let i = 1; i <= 3; i++) {
      const u = addSpecialUnit(s, defId, `Train ${i}`, { train: true, noRespawn: true, fixedObjective: true, trainRound: [1, 3, 5][i - 1] });
      u.objective = { kind: 'lane', toEdge: 'E' };
    }
    ms(c).killed = 0;
    ms(c).escaped = 0;
  },
  onRoundStart: (c) => {
    for (const u of c.state.army.units) if (u.special?.train && u.location === 'reserves') u.special.forceDeploy = u.special.trainRound === c.state.round;
    // Stall: the train on the line (the one furthest along), or else the one arriving now, does not run this round.
    for (let k = 0; k < 2 && takeCounter(c, 'stall'); k++) {
      const trains = c.state.army.units.filter((u) => u.special?.train && !(Number(u.special.holdUntil ?? 0) > c.state.round));
      const t = trains.filter((u) => u.location === 'table').sort((a, b) => (a.deployedRound ?? 0) - (b.deployedRound ?? 0))[0]
        ?? trains.find((u) => u.location === 'reserves' && u.special?.trainRound === c.state.round);
      if (t) {
        t.special = { ...t.special, holdUntil: c.state.round + 1 };
        c.log(`${t.label} is stalled: it does not run this round.`);
      } else c.log('No train is on the line this round. The stall is lost.');
    }
  },
  roundNotes: (c) => (c.state.army.units.some((u) => u.special?.train && u.special.trainRound === c.state.round) ? ['A train arrives this round from the left edge.'] : []),
  deployFilter: (c, cands) => cands.filter((u) => !u.special?.train || u.special.trainRound === c.state.round),
  onOrderReport: (c, u, report) => {
    if (u.special?.train && report === 'exited') {
      ms(c).escaped++;
      c.state.vp.ai += 3;
      c.state.supply.escalation += 1;
      c.log(`${u.label} escaped: AI +3 VP and +1 Supply escalation.`);
    }
  },
  onAiUnitDestroyed: (c, u) => {
    if (u.special?.train) {
      ms(c).killed++;
      c.state.vp.players += 3;
      c.log(`${u.label} destroyed: players +3 VP.`);
    }
  },
  scoringPrompts: (c) => markerPrompts(c.state),
  onScoring: (c, a) => {
    applyMarkerControl(c.state, a);
  },
  winCheck: (c, final) => {
    if (ms(c).killed >= 2) return 'won';
    if (ms(c).escaped >= 2) return 'lost';
    return final ? 'lost' : null;
  },
}), [
  { marker: 1, object: 'guard', reward: 'firepower' },
  { marker: 2, object: 'structure', reward: 'stall' },
  { marker: 3, object: 'guard', reward: 'requisition' },
  { marker: 4, object: 'structure', reward: 'stall' },
]);

// 3. Dead of Night — day / night cycle.
const NIGHT = new Set([2, 4, 5]);
export const deadOfNight = withSideMarkers(coopMode({
  id: 'dead-of-night',
  name: 'Dead of Night',
  sc2Inspiration: 'Dead of Night',
  blurb: 'By day, in rounds 1 and 3, the AI deploys one unit and holds. By night, in rounds 2, 4 and 5, every destroyed AI unit returns, the AI Supply Pool grows, and the whole force attacks. The side with the most VP after round 5 wins.',
  briefing: (s) => [
    ...baseBriefing(s),
    'Day scoring: each side scores 1 VP for each marker it controls.',
    'Night scoring: the players score 3 VP if at least half of their starting Supply is still on the table at the end of the round.',
  ],
  onSetup: () => undefined,
  onRoundStart: (c) => {
    const s = c.state;
    if (NIGHT.has(s.round)) {
      // Burn the nest: the most expensive of the fallen stays down tonight, once per nest burned.
      const kept = new Set<string>();
      for (let k = 0; k < 2 && takeCounter(c, 'nest'); k++) {
        const top = s.army.units
          .filter((u) => u.location === 'destroyed' && !u.special?.noRespawn && !kept.has(u.id))
          .sort((a, b) => instanceCost(unitById(b.defId), b) - instanceCost(unitById(a.defId), a))[0];
        if (top) {
          kept.add(top.id);
          c.log(`${top.label} does not return tonight.`);
        }
      }
      s.respawnQueue = s.respawnQueue.filter((q) => !kept.has(q.unitId));
      for (const q of s.respawnQueue) q.returnRound = s.round;
      for (const u of s.army.units) if (u.location === 'destroyed' && !kept.has(u.id) && !s.respawnQueue.some((q) => q.unitId === u.id) && !u.special?.noRespawn) s.respawnQueue.push({ unitId: u.id, returnRound: s.round, modelsPct: 0.75 });
      for (const line of processReturns(s)) c.log(line);
      // Floodlights: the night's surge is smaller.
      s.supply.bonus += Math.max(0, s.supply.escalation - (takeCounter(c, 'floodlights') ? 1 : 0));
      s.orderDeck.current = s.config.aiFaction === 'Zerg' ? 'swarmSurge' : 'allIn';
      c.log('Night falls. The enemy attacks.');
    } else {
      s.orderDeck.current = 'hold';
      // A nest or the floodlights earned last night have nothing to do by day.
      for (const k of ['nest', 'nest', 'floodlights'] as const) if (takeCounter(c, k)) c.log('It is day. That reward has nothing to act on and is lost.');
    }
  },
  roundNotes: (c) => [NIGHT.has(c.state.round) ? 'NIGHT: every destroyed AI unit returns, the AI Supply Pool grows, and every AI unit hunts the players\' units.' : 'DAY: the AI deploys at most one unit and holds what it has.'],
  deployCap: (c) => (NIGHT.has(c.state.round) ? 99 : 1),
  objectiveFor: (c) => (NIGHT.has(c.state.round) ? { kind: 'enemy' } : undefined),
  scoringPrompts: (c) => [
    ...markerPrompts(c.state),
    ...(NIGHT.has(c.state.round) ? [{ id: 'survived', kind: 'yesno', text: 'Is at least half of the players\' starting Supply still on the table?', defaultValue: true } as ScoringPrompt] : []),
  ],
  onScoring: (c, a) => {
    applyMarkerControl(c.state, a);
    if (NIGHT.has(c.state.round)) {
      if (a.extra['survived']) c.state.vp.players += 3;
    } else {
      c.state.vp.players += controlled(c.state, 'players').length;
      c.state.vp.ai += controlled(c.state, 'ai').length;
    }
  },
  winCheck: (c, final) => (final ? vpResult(c.state) : null),
}), [
  { marker: 1, object: 'guard', reward: 'nest' },
  { marker: 3, object: 'structure', reward: 'nest' },
  { marker: 5, object: 'guard', reward: 'floodlights' },
]);

// 4. Void Thrashing — kill the thrashers before the base falls.
export const voidThrashing = withSideMarkers(coopMode({
  id: 'void-thrashing',
  name: 'Void Thrashing',
  sc2Inspiration: 'Void Thrashing',
  blurb: 'Three Thrashers, the AI\'s most expensive units, march on Mission Marker 2, the players\' base. Destroy all three to win. If the base falls, the players lose.',
  briefing: (s) => [
    ...baseBriefing(s),
    'Marker 2 is the players\' base, with 3 HP. At each Scoring phase it loses 1 HP for every Thrasher within 3" of it.',
    'The Thrashers are the AI\'s three most expensive units, Heroes excepted. They arrive in rounds 1, 2 and 4 and never return once destroyed. Other AI units fight as normal.',
  ],
  onSetup: (c) => {
    const s = c.state;
    const picks = highestCostDefs(s, 3);
    const rounds = [1, 2, 4];
    picks.forEach((u, i) => {
      u.label = `Thrasher ${i + 1} (${u.label})`;
      u.special = { thrasher: true, noRespawn: true, fixedObjective: true, thrasherRound: rounds[i] };
      u.objective = { kind: 'marker', markerId: 2 };
    });
    ms(c).baseHp = 3;
    ms(c).thrashers = picks.length;
    ms(c).killed = 0;
  },
  onRoundStart: (c) => {
    const s = c.state;
    // Seal the cradle: the next Thrasher due comes a round later (never past the last round: it must still come).
    for (let k = 0; k < 2 && takeCounter(c, 'cradle'); k++) {
      const next = s.army.units
        .filter((u) => u.special?.thrasher && u.location === 'reserves' && Number(u.special.thrasherRound) >= s.round && Number(u.special.thrasherRound) < s.finalRound)
        .sort((a, b) => Number(a.special!.thrasherRound) - Number(b.special!.thrasherRound))[0];
      if (next) {
        next.special = { ...next.special, thrasherRound: Number(next.special!.thrasherRound) + 1 };
        c.log(`${next.label} is delayed: it now arrives in round ${next.special.thrasherRound}.`);
      } else c.log('No Thrasher can be delayed any more. The seal is lost.');
    }
    if (takeCounter(c, 'shield')) {
      ms(c).baseHp = Math.min(3, ms(c).baseHp + 1);
      c.log(`The base is at ${ms(c).baseHp} of 3 HP.`);
    }
    for (const u of s.army.units) if (u.special?.thrasher && u.location === 'reserves') u.special.forceDeploy = u.special.thrasherRound === s.round;
  },
  roundNotes: (c) => [`Base HP: ${ms(c).baseHp}/3. Thrashers destroyed: ${ms(c).killed}/${ms(c).thrashers}.`],
  deployFilter: (c, cands) => cands.filter((u) => !u.special?.thrasher || Number(u.special.thrasherRound) <= c.state.round),
  onAiUnitDestroyed: (c, u) => {
    if (u.special?.thrasher) {
      ms(c).killed++;
      c.log(`${u.label} destroyed (${ms(c).killed}/${ms(c).thrashers}).`);
    }
  },
  scoringPrompts: (c) => [...markerPrompts(c.state), { id: 'thrashersAtBase', kind: 'number', text: 'Thrashers within 3" of Mission Marker 2 (the base) right now?', min: 0, max: 3, defaultValue: 0 }],
  onScoring: (c, a) => {
    applyMarkerControl(c.state, a);
    const n = Number(a.extra['thrashersAtBase'] ?? 0);
    if (n > 0) {
      ms(c).baseHp -= n;
      c.log(`The base takes ${n} damage (HP ${Math.max(0, ms(c).baseHp)}/3).`);
    }
  },
  winCheck: (c, final) => {
    if (ms(c).baseHp <= 0) return 'lost';
    if (ms(c).killed >= ms(c).thrashers) return 'won';
    return final ? 'lost' : null;
  },
}), [
  { marker: 1, object: 'structure', reward: 'cradle' },
  { marker: 3, object: 'guard', reward: 'cradle' },
  { marker: 4, object: 'structure', reward: 'shield' },
  { marker: 5, object: 'guard', reward: 'firepower' },
]);

// 5. Rifts to Korhal — close the rifts.
export const riftsToKorhal = withSideMarkers(coopMode({
  id: 'rifts-to-korhal',
  name: 'Rifts to Korhal',
  sc2Inspiration: 'Rifts to Korhal',
  blurb: 'A void rift opens somewhere on the table each round. Close four rifts by the end of round 5 to win.',
  briefing: (s) => [
    ...baseBriefing(s),
    'A new rift opens at the start of each round, at the position given. AI units that deploy that round head for the newest rift.',
    'To close a rift, end the Movement phase with a unit within 3" of it and hold there through the Assault phase.',
    'Scoring: the AI scores 1 VP for each rift still open.',
  ],
  onSetup: (c) => {
    ms(c).rifts = [];
    ms(c).closed = 0;
  },
  onRoundStart: (c) => {
    const s = c.state;
    const t = s.deployment.table;
    const blueRects = s.deployment.entry.blue;
    const nearBlue = (x: number, y: number) => blueRects.some((seg) => (seg.edge === 'N' && y < 8) || (seg.edge === 'S' && y > t.height - 8) || (seg.edge === 'W' && x < 8) || (seg.edge === 'E' && x > t.width - 8));
    const inside = (x: number, y: number) => x >= 4 && y >= 4 && x <= t.width - 4 && y <= t.height - 4;
    const spot = (): { x: number; y: number } | null => {
      for (let i = 0; i < 100; i++) {
        const x = c.rng.int(4, t.width - 4);
        const y = c.rng.int(4, t.height - 4);
        if (s.markers.some((m) => dist(m, { x, y }) < 6) || nearBlue(x, y)) continue;
        return { x, y };
      }
      return null;
    };
    let at: { x: number; y: number } | null = null;
    // Void anchor: the rift opens within 6" of the marker (3" clear of it, so a unit can stand between).
    const anchor = takeCounter(c, 'anchor');
    const m = anchor ? s.markers.find((x) => x.id === anchor.marker) : undefined;
    if (m) {
      for (let i = 0; i < 60 && !at; i++) {
        const a = c.rng.int(0, 359) * (Math.PI / 180);
        const r = c.rng.int(3, 6);
        const x = Math.round(m.x + Math.cos(a) * r);
        const y = Math.round(m.y + Math.sin(a) * r);
        if (inside(x, y) && !s.markers.some((o) => o.id !== m.id && dist(o, { x, y }) < 6)) at = { x, y };
      }
    }
    // Recon: two spots, and the rift opens at the one nearer your units.
    const recon = !at && takeCounter(c, 'recon');
    if (!at) at = spot();
    if (recon && at) {
      const other = spot();
      const yours = s.playerUnits.filter((p) => p.location === 'table' && !p.destroyed).map((p) => s.sense?.players[p.id]?.[0]).filter((p): p is { x: number; y: number } => !!p);
      const near = (q: { x: number; y: number }) => (yours.length ? Math.min(...yours.map((p) => dist(p, q))) : Math.min(...blueRects.map((seg) => (seg.edge === 'N' ? q.y : seg.edge === 'S' ? t.height - q.y : seg.edge === 'W' ? q.x : t.width - q.x))));
      if (other && near(other) < near(at)) at = other;
    }
    if (at) {
      ms(c).rifts.push({ x: at.x, y: at.y, round: s.round, open: true });
      c.log(`A rift opens at (${at.x}", ${at.y}").`);
    }
  },
  roundNotes: (c) => {
    const open = (ms(c).rifts as { x: number; y: number; round: number; open: boolean }[]).filter((r) => r.open);
    return [`Open rifts: ${open.length ? open.map((r) => `(${r.x}", ${r.y}")`).join(', ') : 'none'}. Closed: ${ms(c).closed}/4.`];
  },
  objectiveFor: (c, u) => {
    const open = (ms(c).rifts as { x: number; y: number; round: number; open: boolean }[]).filter((r) => r.open);
    const newest = open[open.length - 1];
    if (!newest) return undefined;
    if (u.deployedRound === c.state.round || u.location === 'reserves') return { kind: 'point', x: newest.x, y: newest.y, label: `the rift at (${newest.x}", ${newest.y}")` };
    return undefined;
  },
  scoringPrompts: (c) => [...markerPrompts(c.state), { id: 'riftsClosed', kind: 'number', text: 'Rifts closed this round. A rift closes when a unit ends the Movement phase within 3" of it and holds there through the Assault phase.', min: 0, max: 5, defaultValue: 0 }],
  onScoring: (c, a) => {
    applyMarkerControl(c.state, a);
    const rifts = ms(c).rifts as { x: number; y: number; round: number; open: boolean }[];
    let n = Number(a.extra['riftsClosed'] ?? 0);
    for (const r of rifts) {
      if (n <= 0) break;
      if (r.open) {
        r.open = false;
        ms(c).closed++;
        n--;
      }
    }
    const open = rifts.filter((r) => r.open).length;
    c.state.vp.ai += open;
    if (open) c.log(`Open rifts score the AI ${open} VP.`);
  },
  winCheck: (c, final) => (ms(c).closed >= 4 ? 'won' : final ? 'lost' : null),
}), [
  { marker: 1, object: 'guard', reward: 'anchor' },
  { marker: 2, object: 'structure', reward: 'recon' },
  { marker: 3, object: 'structure', reward: 'anchor' },
  { marker: 4, object: 'guard', reward: 'recon' },
]);

// 6. Lock & Load — lock the markers.
export const lockAndLoad = withSideMarkers(coopMode({
  id: 'lock-and-load',
  name: 'Lock & Load',
  sc2Inspiration: 'Lock & Load',
  blurb: 'Lock the Mission Markers one by one. A locked marker never changes hands. Lock all five to win, or hold three locks at the end without trailing on VP.',
  briefing: (s) => [
    ...baseBriefing(s),
    'To lock a marker, control it at a Scoring phase with units from two different players. Playing solo, two different units will do. Report locks at Scoring.',
    'The AI ignores locked markers and piles onto the rest.',
    'Scoring: the players score 2 VP for each lock. The AI scores 1 VP for each marker it controls.',
    'Each lock earns a reward for the next round only. Choose who takes it. An unused reward is lost.',
    'Markers 1 and 3: Firepower. One unit gets +1 Rate of Attack on its ranged weapons.',
    'Markers 2 and 4: Reinforce. A destroyed unit returns to Reserves.',
    'Marker 5: Requisition. One player gets +2 Supply.',
  ],
  onSetup: () => undefined,
  onRoundStart: () => undefined,
  roundNotes: (c) => [`Locked markers: ${c.state.markers.filter((m) => m.locked).map((m) => m.id).join(', ') || 'none'}.`],
  scoringPrompts: (c) => [
    ...markerPrompts(c.state),
    { id: 'lockA', kind: 'number', text: 'Marker locked this round, or 0 for none. A lock needs units from two different players on the marker, or two units playing solo.', min: 0, max: 5, defaultValue: 0 },
    { id: 'lockB', kind: 'number', text: 'Second marker locked this round, or 0 for none.', min: 0, max: 5, defaultValue: 0 },
  ],
  onScoring: (c, a) => {
    applyMarkerControl(c.state, a);
    for (const k of ['lockA', 'lockB']) {
      const id = Number(a.extra[k] ?? 0);
      const m = c.state.markers.find((x) => x.id === id);
      if (m && !m.locked) {
        m.locked = true;
        m.controlledBy = 'players';
        c.state.vp.players += 2;
        c.log(`Marker ${id} locked (+2 VP).`);
        grantReward(c, id === 5 ? 'requisition' : id === 2 || id === 4 ? 'reinforce' : 'firepower', id, null);
      }
    }
    c.state.vp.ai += controlled(c.state, 'ai').length;
  },
  winCheck: (c, final) => {
    const locked = c.state.markers.filter((m) => m.locked).length;
    if (locked >= c.state.markers.length) return 'won';
    return final ? (locked >= 3 && vpResult(c.state) !== 'lost' ? 'won' : 'lost') : null;
  },
}), []);

// 7. Mist Opportunities — gather terrazine.
export const mistOpportunities = withSideMarkers(coopMode({
  id: 'mist-opportunities',
  name: 'Mist Opportunities',
  sc2Inspiration: 'Mist Opportunities',
  blurb: 'Two markers vent terrazine each round, and the AI makes for them. Gather enough terrazine by the end of round 5 to win.',
  briefing: (s) => [
    ...baseBriefing(s),
    `Gather ${6 + 2 * (s.config.players - 1)} terrazine to win.`,
    'Each round two markers are active vents, and the vents change every round. A unit that holds within 3" of an active vent for the whole Movement phase gathers 1 terrazine.',
    'Scoring: the AI scores 1 VP for each marker it controls.',
  ],
  onSetup: (c) => {
    ms(c).terrazine = 0;
  },
  onRoundStart: (c) => {
    const s = c.state;
    // Prime the vent: a primed marker is one of this round's two vents; chance picks the rest.
    const primed: number[] = [];
    for (let k = 0; k < 2; k++) {
      const r = takeCounter(c, 'vent');
      if (r && !primed.includes(r.marker)) primed.push(r.marker);
    }
    const ids = [...primed, ...c.rng.shuffle(s.markers.map((m) => m.id).filter((id) => !primed.includes(id)))].slice(0, 2);
    for (const m of s.markers) m.active = ids.includes(m.id);
    c.log(`Terrazine vents: markers ${ids.join(' and ')}.`);
  },
  roundNotes: (c) => [`Active vents: markers ${c.state.markers.filter((m) => m.active).map((m) => m.id).join(' and ')}. Terrazine: ${ms(c).terrazine}/${6 + 2 * (c.state.config.players - 1)}.`],
  scoringPrompts: (c) => [...markerPrompts(c.state), { id: 'terrazine', kind: 'number', text: 'Terrazine gathered this round: 1 for each unit that held within 3" of an active vent through the Movement phase.', min: 0, max: 6, defaultValue: 0 }],
  onScoring: (c, a) => {
    applyMarkerControl(c.state, a);
    ms(c).terrazine += Number(a.extra['terrazine'] ?? 0);
    c.state.vp.ai += controlled(c.state, 'ai').length;
  },
  winCheck: (c, final) => (ms(c).terrazine >= 6 + 2 * (c.state.config.players - 1) ? 'won' : final ? 'lost' : null),
}), [
  { marker: 1, object: 'guard', reward: 'vent' },
  { marker: 2, object: 'structure', reward: 'reinforce' },
  { marker: 3, object: 'structure', reward: 'vent' },
  { marker: 4, object: 'guard', reward: 'reinforce' },
]);

export const COOP_MODES: MissionMode[] = [templeOfThePast, oblivionExpress, deadOfNight, voidThrashing, riftsToKorhal, lockAndLoad, mistOpportunities];
