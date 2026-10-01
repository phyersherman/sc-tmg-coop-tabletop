import { describe, expect, it } from 'vitest';
import { deploymentById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { deployable } from '@engine/ai/decide';
import { poolNow } from '@engine/director/selectors';
import { modeById } from '@engine/missions/index';
import { applyMarkerControl, countAnswer, defaultSupply, vpResult } from '@engine/missions/framework';
import { MUTATORS, playerPoolPenalty } from '@engine/mutators/index';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { poolForRound } from '@engine/units/supply';
import { Rng } from '@engine/rng';
import type { AiOrder, GameConfig, GameState, MarkerControl, ScoringAnswers } from '@engine/types/game';
import type { AiUnitInstance } from '@engine/types/army';
import type { MissionCtx } from '@engine/types/mission';
import { makeConfig } from './helpers';

const dep = deploymentById('acropolis');
const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };

/** A tabletop game on open ground, round 1 begun, the players' two units in Reserves. */
function game(modeId: string, over: Partial<GameConfig> = {}): GameState {
  const cfg = makeConfig({ modeId, aiFaction: 'Terran', scale: 'standard', deploymentId: 'acropolis', ...over });
  cfg.playerUnits = [
    { ...makePlayerUnit('m1', 'zergling', 'small', [], 'Zerglings', 100), owner: 0 },
    { ...makePlayerUnit('m2', 'roach', 'small', [], 'Roaches', 101), owner: 0 },
  ];
  return createGame(cfg, dep, flat);
}

/** The mission's hooks called straight on a state, with what they logged. */
function hooks(s: GameState): { mode: ReturnType<typeof modeById>; ctx: MissionCtx; lines: string[] } {
  const lines: string[] = [];
  return { mode: modeById(s.config.modeId), ctx: { state: s, rng: Rng.from(7), log: (t) => lines.push(t) }, lines };
}

const answers = (markers: Record<number, MarkerControl>, extra: ScoringAnswers['extra'] = {}): ScoringAnswers => ({ markers, playerSupplyLost: 0, extra });
const every = (s: GameState, who: MarkerControl): Record<number, MarkerControl> => Object.fromEntries(s.markers.map((m) => [m.id, who]));
const marker = (s: GameState, id: number) => s.markers.find((m) => m.id === id)!;
const promptIds = (s: GameState) => modeById(s.config.modeId).scoringPrompts(hooks(s).ctx).map((p) => p.id);

/** Play on, passing every turn and resolving the AI's, until the step is `kind`. */
function until(s: GameState, kind: GameState['step']['kind']): GameState {
  for (let i = 0; i < 400 && s.step.kind !== kind && s.status === 'playing'; i++) {
    const st = s.step;
    if (st.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
    else if (st.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
    else if (st.kind === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
    else if (st.kind === 'COMBAT_CHECKLIST') s = apply(s, { t: 'checklistDone' });
    else if (st.kind === 'SCORING_FORM') s = apply(s, { t: 'scoring', answers: answers({}) });
    else s = apply(s, { t: 'continue' });
  }
  expect(s.step.kind).toBe(kind);
  return s;
}

/** Stand an AI unit on a marker, as the table reports it (no map positions: `atObjective` is what is known). */
function standOn(s: GameState, markerId: number, index = 0): AiUnitInstance {
  const u = s.army.units.filter((x) => !x.special)[index]!;
  u.location = 'table';
  u.engaged = false;
  u.objective = { kind: 'marker', markerId };
  u.atObjective = true;
  return u;
}

/** The AI order on the table for `u`, as the reducer holds it while the report is applied. */
function order(s: GameState, u: AiUnitInstance, type: AiOrder['type']): void {
  s.step = { kind: 'AI_ORDER', order: { type, unitId: u.id, title: `${u.label}: ${type}`, lines: ['x'], batches: [], reports: [{ id: 'done', label: 'Done' }] } };
}

describe('marker control: a marker that is not active', () => {
  it('cannot be controlled: the report for it is ignored, sticky or not', () => {
    const s = game('frontlines');
    marker(s, 1).active = false;
    marker(s, 2).active = false;
    marker(s, 2).controlledBy = 'players';
    const cap = applyMarkerControl(s, answers(every(s, 'ai')));
    expect(marker(s, 1).controlledBy).toBeNull();
    // Held before it went out of play, it stays with its holder and is not captured.
    expect(marker(s, 2).controlledBy).toBe('players');
    expect(cap.ai).toEqual([]);
    expect(s.markers.filter((m) => m.active).every((m) => m.controlledBy === 'ai')).toBe(true);
  });

  it('Supply Drop: nobody holds a marker before its drop, and a marker pays only the side that takes it once active', () => {
    const s = game('supply-drop');
    const { mode, ctx } = hooks(s);
    const first = s.markers.filter((m) => m.active);
    expect(first).toHaveLength(1);
    expect(first[0]!.activatedRound).toBe(1);
    // Round 1: the AI is reported on every marker. Only the dropped one is its to take.
    mode.onScoring(ctx, answers(every(s, 'ai')));
    expect(s.vp).toEqual({ ai: 1, players: 0 });
    expect(s.markers.filter((m) => m.id !== first[0]!.id).every((m) => m.controlledBy === null)).toBe(true);
    expect(first[0]!.active).toBe(false);
    // Round 2: a new marker drops, and nobody stands on it. Nothing the AI stood on last round pays out.
    s.round = 2;
    mode.onRoundStart(ctx);
    const second = s.markers.filter((m) => m.active);
    expect(second).toHaveLength(1);
    expect(second[0]!.controlledBy).toBeNull();
    mode.onScoring(ctx, answers(every(s, 'none')));
    expect(s.vp).toEqual({ ai: 1, players: 0 });
    // Round 3: the players take the round 2 drop, still on the table, for its 2 VP; the claimed round 1 marker stays gone.
    s.round = 3;
    mode.onScoring(ctx, answers(every(s, 'players')));
    expect(s.vp.players).toBe(2);
    expect(first[0]!.controlledBy).toBe('ai');
  });

  it('Supply Drop through the reducer: a report on markers not yet dropped scores nothing later', () => {
    let s = until(game('supply-drop'), 'SCORING_FORM');
    const dropped = s.markers.find((m) => m.active)!.id;
    s = apply(s, { t: 'scoring', answers: answers(every(s, 'ai')) });
    const aiAfter1 = s.vp.ai;
    expect(s.markers.filter((m) => m.id !== dropped).every((m) => m.controlledBy === null)).toBe(true);
    s = until(s, 'SCORING_FORM');
    expect(s.round).toBe(2);
    s = apply(s, { t: 'scoring', answers: answers(every(s, 'none')) });
    expect(s.vp.ai).toBe(aiAfter1);
  });

  it('Mist Opportunities: a closed vent is not taken, and the AI scores for the active vents it controls', () => {
    const s = game('mist-opportunities');
    const { mode, ctx } = hooks(s);
    const vents = s.markers.filter((m) => m.active).map((m) => m.id);
    expect(vents).toHaveLength(2);
    mode.onScoring(ctx, answers(every(s, 'ai')));
    expect(s.markers.filter((m) => m.controlledBy === 'ai').map((m) => m.id)).toEqual(vents);
    expect(s.vp.ai).toBe(2);
    expect(mode.briefing(s).join(' ')).toMatch(/1 VP for each active vent it controls/);
  });
});

describe('Gather the Resources', () => {
  const GATHER = 'gather-the-resources';

  it('asks for no Gathers in round 1 and counts none', () => {
    const s = game(GATHER);
    expect(s.round).toBe(1);
    expect(promptIds(s)).not.toContain('gathers');
    const { mode, ctx } = hooks(s);
    mode.onScoring(ctx, answers({ 5: 'players' }, { gathers: 4 }));
    expect(s.vp.players).toBe(0);
  });

  it('counts the players\' Gathers from round 2, at a neutral or Enemy-colour marker they already control', () => {
    const s = game(GATHER);
    s.round = 2;
    marker(s, 5).controlledBy = 'players';
    const { mode, ctx } = hooks(s);
    const prompt = mode.scoringPrompts(ctx).find((p) => p.id === 'gathers')!;
    expect(prompt.text).toMatch(/Unengaged Unit Within 3" of a neutral or Enemy-colour Mission Marker you control/);
    expect(prompt.text).toMatch(/gives up its Assault Phase action/);
    expect(prompt.text).not.toMatch(/—/);
    mode.onScoring(ctx, answers({}, { gathers: 3 }));
    expect(s.vp.players).toBe(3);
  });

  it('counts no Gather at the players\' own colour, or at a marker only taken at this Scoring Phase', () => {
    const own = game(GATHER);
    own.round = 2;
    marker(own, 2).controlledBy = 'players';
    expect(promptIds(own)).not.toContain('gathers');
    hooks(own).mode.onScoring(hooks(own).ctx, answers({}, { gathers: 2 }));
    expect(own.vp.players).toBe(0);

    const late = game(GATHER);
    late.round = 2;
    expect(promptIds(late)).not.toContain('gathers');
    hooks(late).mode.onScoring(hooks(late).ctx, answers({ 5: 'players' }, { gathers: 2 }));
    expect(marker(late, 5).controlledBy).toBe('players');
    expect(late.vp.players).toBe(0);
  });

  it('the AI Gathers only with a Unit that gave up its Assault Phase action', () => {
    const s = game(GATHER);
    s.round = 2;
    marker(s, 5).controlledBy = 'ai';
    const [shooter, holder, idle, runner] = [0, 1, 2, 3].map((i) => standOn(s, 5, i));
    const { mode, ctx, lines } = hooks(s);
    // Movement Phase orders are no Assault Phase action.
    s.phase = 'movement';
    order(s, idle!, 'move');
    mode.onOrderReport!(ctx, idle!, 'reached');
    s.phase = 'assault';
    order(s, shooter!, 'ranged');
    mode.onOrderReport!(ctx, shooter!, 'attacked');
    order(s, holder!, 'hold');
    mode.onOrderReport!(ctx, holder!, 'done');
    order(s, runner!, 'run');
    mode.onOrderReport!(ctx, runner!, 'done');
    s.phase = 'scoring';
    mode.onScoring(ctx, answers({}));
    // The Hold and the Unit that was never activated Gather; the attack and the Run do not. Marker 5 is neutral: no 2 VP.
    expect(s.vp.ai).toBe(2);
    expect(lines).toContain('AI Units Gather: +2 VP.');
  });

  it('the AI does not Gather while Engaged, in round 1, at its own colour, or at a marker taken this Scoring Phase', () => {
    const engaged = game(GATHER);
    engaged.round = 2;
    marker(engaged, 5).controlledBy = 'ai';
    standOn(engaged, 5).engaged = true;
    hooks(engaged).mode.onScoring(hooks(engaged).ctx, answers({}));
    expect(engaged.vp.ai).toBe(0);

    const round1 = game(GATHER);
    standOn(round1, 5);
    hooks(round1).mode.onScoring(hooks(round1).ctx, answers({ 5: 'ai' }));
    expect(marker(round1, 5).controlledBy).toBe('ai');
    expect(round1.vp.ai).toBe(0);

    const ownColour = game(GATHER);
    ownColour.round = 2;
    marker(ownColour, 1).controlledBy = 'ai';
    standOn(ownColour, 1);
    hooks(ownColour).mode.onScoring(hooks(ownColour).ctx, answers({}));
    expect(ownColour.vp.ai).toBe(0);

    const taken = game(GATHER);
    taken.round = 2;
    standOn(taken, 5);
    hooks(taken).mode.onScoring(hooks(taken).ctx, answers({ 5: 'ai' }));
    expect(taken.vp.ai).toBe(0);
  });

  it('last round\'s Assault Phase actions are forgotten', () => {
    const s = game(GATHER);
    s.round = 2;
    marker(s, 5).controlledBy = 'ai';
    const u = standOn(s, 5);
    const { mode, ctx } = hooks(s);
    s.phase = 'assault';
    order(s, u, 'charge');
    mode.onOrderReport!(ctx, u, 'chargeFailed');
    mode.onScoring(ctx, answers({}));
    expect(s.vp.ai).toBe(0);
    s.round = 3;
    mode.onScoring(ctx, answers({}));
    expect(s.vp.ai).toBe(1);
  });
});

describe('Supply Pools', () => {
  it('Divide and Conquer has its own values at every scale, Grand included', () => {
    const supply = modeById('divide-and-conquer').supply!;
    expect(supply('skirmish')).toEqual({ start: 4, escalation: 1 });
    expect(supply('standard')).toEqual({ start: 8, escalation: 2 });
    expect(supply('grand')).toEqual({ start: 12, escalation: 3 });
    expect([defaultSupply('skirmish'), defaultSupply('standard'), defaultSupply('grand')]).toEqual([{ start: 3, escalation: 1 }, { start: 6, escalation: 2 }, { start: 9, escalation: 3 }]);
  });

  it('every mission\'s pool starts at its value in round 1 and grows by its escalation each round', () => {
    for (const id of ['frontlines', 'divide-and-conquer', 'supply-drop']) {
      const m = modeById(id);
      const v = m.supply?.('standard') ?? defaultSupply('standard');
      expect(poolForRound(v.start, v.escalation, 1, m.rounds)).toBe(v.start);
      expect(poolForRound(v.start, v.escalation, 3, m.rounds)).toBe(v.start + 2 * v.escalation);
      expect(poolForRound(v.start, v.escalation, m.rounds, m.rounds)).toBe(Infinity);
    }
  });

  it('Oblivion Express: an escaped train raises the escalation from the next round, not for rounds already played', () => {
    const s = game('oblivion-express');
    const { mode, ctx } = hooks(s);
    s.round = 3;
    const before3 = poolNow(s);
    s.round = 4;
    const before4 = poolNow(s);
    s.round = 3;
    const train = s.army.units.find((u) => u.special?.train)!;
    mode.onOrderReport!(ctx, train, 'exited');
    expect(s.vp.ai).toBe(3);
    expect(poolNow(s)).toBe(before3);
    s.round = 4;
    expect(poolNow(s)).toBe(before4 + 1);
  });

  it('Slim Pickings takes 1 from each player\'s pool in every round but the last', () => {
    const plain = game('frontlines');
    expect(playerPoolPenalty(plain)).toBe(0);
    const slim = game('frontlines', { mutators: ['slimPickings'] });
    expect(playerPoolPenalty(slim)).toBe(1);
    slim.round = slim.finalRound;
    expect(playerPoolPenalty(slim)).toBe(0);
    const text = MUTATORS.find((m) => m.id === 'slimPickings')!.text;
    expect(text).not.toMatch(/apply it yourself/);
    expect(text).toMatch(/1 lower/);
  });
});

describe('Lock & Load', () => {
  it('locks only a marker the players control once this round\'s control is applied', () => {
    const s = game('lock-and-load');
    const { mode, ctx, lines } = hooks(s);
    mode.onScoring(ctx, answers({ 1: 'ai', 5: 'players' }, { lockA: 1, lockB: 5 }));
    expect(marker(s, 1).locked).toBeFalsy();
    expect(marker(s, 1).controlledBy).toBe('ai');
    expect(marker(s, 5)).toMatchObject({ locked: true, controlledBy: 'players' });
    expect(lines).toContain('Marker 1 is not locked: the players do not control it.');
    // One lock: 2 VP. The AI scores for the marker it holds.
    expect(s.vp).toEqual({ players: 2, ai: 1 });
  });

  it('does not lock a marker nobody controls, or the same marker twice', () => {
    const s = game('lock-and-load');
    const { mode, ctx, lines } = hooks(s);
    mode.onScoring(ctx, answers({ 3: 'contested', 4: 'players' }, { lockA: 3, lockB: 3 }));
    expect(marker(s, 3).locked).toBeFalsy();
    expect(marker(s, 3).controlledBy).toBeNull();
    expect(lines.filter((l) => /Marker 3 is not locked/.test(l))).toHaveLength(1);
    mode.onScoring(ctx, answers({}, { lockA: 4, lockB: 4 }));
    expect(marker(s, 4).locked).toBe(true);
    expect(s.vp.players).toBe(2);
    // A locked marker never changes hands, and is not locked again.
    mode.onScoring(ctx, answers({ 4: 'ai' }, { lockA: 4 }));
    expect(marker(s, 4).controlledBy).toBe('players');
    expect(s.vp.players).toBe(2);
  });
});

describe('Void Thrashing', () => {
  const thrasher = (s: GameState, round: number) => s.army.units.find((u) => u.special?.thrasher && u.special.thrasherRound === round)!;

  it('a Thrasher is deployable in its round with no Supply left in the pool', () => {
    const s = game('void-thrashing');
    // Nothing left in the pool in any round but the last.
    s.supply.start = 0;
    s.supply.escalation = 0;
    s.supply.bonus = 0;
    const { mode, ctx } = hooks(s);
    for (const round of [1, 2, 4]) {
      s.round = round;
      mode.onRoundStart(ctx);
      const t = thrasher(s, round);
      expect(poolNow(s)).toBe(0);
      expect(t.special).toMatchObject({ forceDeploy: true, freeSupply: true });
      expect(deployable(s, mode, ctx).map((u) => u.id)).toContain(t.id);
      // The one due later waits for its round.
      if (round < 4) expect(deployable(s, mode, ctx).map((u) => u.id)).not.toContain(thrasher(s, 4).id);
      t.location = 'table';
      t.deployedRound = round;
    }
  });

  it('through the reducer: the first Thrasher is on the table in round 1 whatever the pool', () => {
    let s = game('void-thrashing');
    s.supply.start = 0;
    s.supply.escalation = 0;
    const id = thrasher(s, 1).id;
    s = until(s, 'SCORING_FORM');
    expect(s.round).toBe(1);
    expect(s.army.units.find((u) => u.id === id)).toMatchObject({ location: 'table', deployedRound: 1 });
  });

  it('only a Thrasher on the table can damage the base', () => {
    const s = game('void-thrashing');
    const { mode, ctx } = hooks(s);
    thrasher(s, 1).location = 'table';
    mode.onScoring(ctx, answers({}, { thrashersAtBase: 3 }));
    expect(s.modeState['baseHp']).toBe(2);
  });
});

describe('scores and the end of the game', () => {
  it('a counted answer is a whole number within the prompt\'s range', () => {
    expect(countAnswer(answers({}, { n: 7 }), 'n', 0, 4)).toBe(4);
    expect(countAnswer(answers({}, { n: -2 }), 'n', 0, 4)).toBe(0);
    expect(countAnswer(answers({}, { n: 2.9 }), 'n', 0, 4)).toBe(2);
    expect(countAnswer(answers({}), 'n', 0, 4)).toBe(0);
  });

  it('Divide and Conquer: the table has four quarters, and a quarter scores for one side', () => {
    const s = game('divide-and-conquer');
    const { mode, ctx } = hooks(s);
    mode.onScoring(ctx, answers({}, { playerQuarters: 3, aiQuarters: 3 }));
    expect(s.vp).toEqual({ players: 3, ai: 1 });
  });

  it('level VP after the last round is a Draw in a mission with no tiebreaker', () => {
    for (const id of ['frontlines', 'hold-position', 'gather-the-resources', 'divide-and-conquer', 'supply-drop', 'dead-of-night']) {
      const s = game(id);
      const { mode, ctx } = hooks(s);
      s.round = s.finalRound;
      s.vp = { players: 7, ai: 7 };
      expect(vpResult(s)).toBe('draw');
      expect(mode.winCheck(ctx, true), id).toBe('draw');
    }
  });

  it('an official mission ends early only on its own lead, checked after the round is scored', () => {
    for (const [id, lead] of [['frontlines', 10], ['hold-position', 10], ['gather-the-resources', 10], ['divide-and-conquer', 10], ['supply-drop', 12]] as const) {
      const s = game(id);
      const { mode, ctx } = hooks(s);
      s.vp = { players: lead - 1, ai: 0 };
      expect(mode.winCheck(ctx, false), id).toBeNull();
      s.vp = { players: lead, ai: 0 };
      expect(mode.winCheck(ctx, false), id).toBe('won');
      s.vp = { players: 0, ai: lead };
      expect(mode.winCheck(ctx, false), id).toBe('lost');
    }
  });

  it('Frontlines and Hold Position score markers only from round 2, and only for the side that controls them', () => {
    const f = game('frontlines');
    hooks(f).mode.onScoring(hooks(f).ctx, answers({ 1: 'players', 2: 'ai', 3: 'contested' }));
    expect(f.vp).toEqual({ players: 0, ai: 0 });
    f.round = 2;
    // Marker 2 is taken from the AI (+2), marker 1 stays the players' (sticky), marker 3 is nobody's.
    hooks(f).mode.onScoring(hooks(f).ctx, answers({ 2: 'players', 3: 'contested' }));
    expect(f.vp).toEqual({ players: 4, ai: 0 });
    expect(marker(f, 3).controlledBy).toBeNull();

    const h = game('hold-position');
    h.round = 2;
    // Marker 1 is the AI's colour: 2 VP to the players. Marker 2 is the players' colour: 2 VP to the AI. Marker 5 is neutral: 1 VP.
    hooks(h).mode.onScoring(hooks(h).ctx, answers({ 1: 'players', 2: 'ai', 5: 'players' }));
    expect(h.vp).toEqual({ players: 3, ai: 2 });
  });
});
