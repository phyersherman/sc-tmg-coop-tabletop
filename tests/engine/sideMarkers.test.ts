import { describe, expect, it } from 'vitest';
import { deploymentById, unitById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { aiSupplyOnTable, isStructure, onSideMarker } from '@engine/director/selectors';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { playerAvailable } from '@engine/player/rules';
import { rewardsReady, sideState } from '@engine/missions/sideMarkers';
import type { GameState, ScoringAnswers } from '@engine/types/game';
import { makeConfig, playGame } from './helpers';

const dep = deploymentById('acropolis');
const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };

function game(modeId: string, players: 1 | 2 = 1): GameState {
  const cfg = makeConfig({ modeId, aiFaction: 'Terran', players, scale: 'standard', deploymentId: 'acropolis' });
  cfg.playerUnits = [
    { ...makePlayerUnit('m1', 'zergling', 'small', [], 'Zerglings', 100), owner: 0 },
    { ...makePlayerUnit('m2', 'roach', 'small', [], 'Roaches', 101), owner: players > 1 ? 1 : 0 },
  ];
  return createGame(cfg, dep, flat);
}

/** Play on, passing every turn and resolving the AI's, until the step is `kind`. */
function until(s: GameState, kind: GameState['step']['kind']): GameState {
  for (let i = 0; i < 400 && s.step.kind !== kind; i++) {
    const st = s.step;
    if (st.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
    else if (st.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
    else if (st.kind === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
    else if (st.kind === 'COMBAT_CHECKLIST') s = apply(s, { t: 'checklistDone' });
    else if (st.kind === 'SCORING_FORM') s = apply(s, { t: 'scoring', answers: { markers: {}, playerSupplyLost: 0, extra: {} } });
    else s = apply(s, { t: 'continue' });
  }
  expect(s.step.kind).toBe(kind);
  return s;
}

const objectOn = (s: GameState, marker: number) => s.army.units.find((u) => u.id === sideState(s).objects[marker]!.unitId)!;
const score = (s: GameState, markers: ScoringAnswers['markers'], extra: ScoringAnswers['extra'] = {}) => apply(s, { t: 'scoring', answers: { markers, playerSupplyLost: 0, extra } });

describe('co-op side markers', () => {
  it('stands a guard or a Structure on each side marker, outside the AI\'s force and pool', () => {
    const s = game('temple-of-the-past');
    expect(Object.keys(sideState(s).objects).map(Number)).toEqual([1, 2, 3, 4]);
    expect(isStructure(objectOn(s, 2))).toBe(true);
    expect(isStructure(objectOn(s, 1))).toBe(false);
    expect(unitById(objectOn(s, 1).defId).role).toBe('Core');
    for (const id of [1, 2, 3, 4]) {
      const u = objectOn(s, id);
      expect(u.location).toBe('table');
      expect(s.markers.find((m) => m.id === id)!.side).toBe(true);
    }
    expect(aiSupplyOnTable(s)).toBe(0);
  });

  it('never activates a Structure, and never sends the AI\'s force to a side marker', () => {
    for (const modeId of ['temple-of-the-past', 'oblivion-express', 'dead-of-night', 'void-thrashing', 'rifts-to-korhal', 'lock-and-load', 'mist-opportunities']) {
      const cfg = makeConfig({ modeId, aiFaction: 'Terran' });
      const r = playGame(cfg, {
        onOrder: (s, o) => {
          const u = s.army.units.find((x) => x.id === o.unitId);
          if (u) expect(isStructure(u)).toBe(false);
          for (const x of s.army.units) {
            if (onSideMarker(x) || x.objective.kind !== 'marker') continue;
            const m = s.markers.find((mm) => mm.id === (x.objective as { markerId: number }).markerId)!;
            expect(m.side, `${modeId}: ${x.label} heads for side Marker ${m.id}`).not.toBe(true);
          }
        },
      });
      expect(r.state.status).not.toBe('playing');
    }
  });

  it('pays out once, the round after the object is destroyed and the marker held, then is lost if unused', () => {
    let s = until(game('temple-of-the-past'), 'SCORING_FORM');
    // Held but still standing: nothing.
    s = score(s, { 2: 'players' });
    expect(sideState(s).rewards).toHaveLength(0);
    s = until(s, 'PLAYERS_TURN');
    s = apply(s, { t: 'damage', unitId: objectOn(s, 2).id, dmg: 40 });
    expect(objectOn(s, 2).location).toBe('destroyed');
    expect(s.markers.find((m) => m.id === 2)!.side).toBe(false);
    s = until(s, 'SCORING_FORM');
    // Destroyed but not held: nothing yet.
    s = score(s, { 2: 'ai' });
    expect(sideState(s).rewards).toHaveLength(0);
    s = until(s, 'SCORING_FORM');
    const earnedIn = s.round;
    s = score(s, { 2: 'players' });
    expect(sideState(s).rewards).toMatchObject([{ kind: 'reinforce', marker: 2, round: earnedIn + 1, owner: 0, used: false }]);
    // Held again later: the marker pays only once.
    s = until(s, 'SCORING_FORM');
    expect(rewardsReady(s)).toHaveLength(1);
    s = score(s, { 2: 'players' });
    expect(sideState(s).rewards).toHaveLength(1);
    s = until(s, 'ROUND_START');
    // Never used: gone.
    expect(rewardsReady(s)).toHaveLength(0);
    expect(sideState(s).rewards[0]!.usedOn).toBe('lost');
  });

  it('Reinforce brings back one destroyed unit; Firepower buffs one unit; Requisition adds Supply', () => {
    let s = until(game('temple-of-the-past'), 'PLAYERS_TURN');
    for (const id of [1, 2, 3]) s = apply(s, { t: 'damage', unitId: objectOn(s, id).id, dmg: 60 });
    s = until(s, 'SCORING_FORM');
    s = score(s, { 1: 'players', 2: 'players', 3: 'players' });
    s = until(s, 'PLAYERS_TURN');
    const ready = rewardsReady(s);
    expect(ready.map((r) => r.kind).sort()).toEqual(['firepower', 'reinforce']);
    // Requisition was the player's at once.
    expect(playerAvailable(s, 0)).toBe(s.playerSupply.start + s.playerSupply.escalation + 2);

    const reinforce = ready.find((r) => r.kind === 'reinforce')!;
    // Only a destroyed unit can come back.
    let t = apply(s, { t: 'useReward', rewardId: reinforce.id, unitId: 'm1' });
    expect(rewardsReady(t)).toHaveLength(2);
    s = apply(s, { t: 'setPlayerDestroyed', unitId: 'm1', destroyed: true });
    s = apply(s, { t: 'useReward', rewardId: reinforce.id, unitId: 'm1' });
    const m1 = s.playerUnits.find((p) => p.id === 'm1')!;
    expect(m1.destroyed).toBe(false);
    expect(m1.location).toBe('reserves');
    expect(m1.models).toBe(m1.maxModels);

    const fire = ready.find((r) => r.kind === 'firepower')!;
    s = apply(s, { t: 'useReward', rewardId: fire.id, unitId: 'm2' });
    expect(s.playerUnits.find((p) => p.id === 'm2')!.effects!.some((e) => e.mods.roa === 1 && e.until === 'round')).toBe(true);
    // Used once, it cannot be used again.
    t = apply(s, { t: 'useReward', rewardId: fire.id, unitId: 'm1' });
    expect(t.playerUnits.find((p) => p.id === 'm1')!.effects ?? []).toHaveLength(0);
    expect(rewardsReady(s)).toHaveLength(0);
  });

  it('gives a reward to the player who holds the marker, or lets the players choose when level', () => {
    let s = until(game('temple-of-the-past', 2), 'PLAYERS_TURN');
    for (const id of [2, 4]) s = apply(s, { t: 'damage', unitId: objectOn(s, id).id, dmg: 60 });
    s = until(s, 'SCORING_FORM');
    const prompts = s.step.kind === 'SCORING_FORM' ? s.step.prompts.map((p) => p.id) : [];
    expect(prompts).toEqual(expect.arrayContaining(['holder-2', 'holder-4']));
    s = score(s, { 2: 'players', 4: 'players' }, { 'holder-2': 2, 'holder-4': 0 });
    const [a, b] = sideState(s).rewards;
    expect(a).toMatchObject({ marker: 2, owner: 1 });
    expect(b).toMatchObject({ marker: 4, owner: null });
    s = until(s, 'PLAYERS_TURN');
    s = apply(s, { t: 'setPlayerDestroyed', unitId: 'm1', destroyed: true });
    s = apply(s, { t: 'setPlayerDestroyed', unitId: 'm2', destroyed: true });
    // Player 2's reward cannot bring back player 1's unit; the level one can go to either.
    let t = apply(s, { t: 'useReward', rewardId: a!.id, unitId: 'm1' });
    expect(t.playerUnits.find((p) => p.id === 'm1')!.destroyed).toBe(true);
    t = apply(s, { t: 'useReward', rewardId: b!.id, unitId: 'm1' });
    expect(t.playerUnits.find((p) => p.id === 'm1')!.destroyed).toBe(false);
    expect(sideState(t).rewards[1]!.owner).toBe(0);
  });

  it('turns mission counters on by themselves: a Thrasher delayed, a vent primed', () => {
    let s = until(game('void-thrashing'), 'PLAYERS_TURN');
    s = apply(s, { t: 'damage', unitId: objectOn(s, 1).id, dmg: 60 });
    s = until(s, 'SCORING_FORM');
    const due2 = s.army.units.find((u) => u.special?.thrasher && u.special.thrasherRound === 2);
    s = score(s, { 1: 'players' });
    s = until(s, 'ROUND_START');
    if (due2) expect(s.army.units.find((u) => u.id === due2.id)!.special!.thrasherRound).toBe(3);

    let m = until(game('mist-opportunities'), 'PLAYERS_TURN');
    m = apply(m, { t: 'damage', unitId: objectOn(m, 3).id, dmg: 60 });
    m = until(m, 'SCORING_FORM');
    m = score(m, { 3: 'players' });
    m = until(m, 'ROUND_START');
    expect(m.markers.find((x) => x.id === 3)!.active).toBe(true);
  });

  it('earns a reward with each lock in Lock & Load', () => {
    let s = until(game('lock-and-load'), 'SCORING_FORM');
    s = score(s, { 5: 'players' }, { lockA: 5 });
    expect(sideState(s).rewards).toMatchObject([{ kind: 'requisition', marker: 5, owner: null }]);
    s = until(s, 'PLAYERS_TURN');
    const r = rewardsReady(s)[0]!;
    const before = playerAvailable(s, 0);
    s = apply(s, { t: 'useReward', rewardId: r.id, owner: 0 });
    expect(playerAvailable(s, 0)).toBe(before + 2);
  });
});
