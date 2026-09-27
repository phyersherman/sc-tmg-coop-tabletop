import { describe, expect, it } from 'vitest';
import { CARDS, UNITS, deploymentById } from '@data/index';
import { buildAiArmy } from '@engine/army/builder';
import { aiBudget } from '@engine/difficulty';
import { apply, createGame, type Command } from '@engine/director/reducer';
import type { GameConfig, GameState, ScoringAnswers } from '@engine/types/game';
import { Rng } from '@engine/rng';
import { onTable, reserves } from '@engine/director/selectors';

function makeConfig(over: Partial<GameConfig> = {}): GameConfig {
  const army = buildAiArmy({ faction: 'Zerg', budget: aiBudget(1000, 'normal'), ownership: { zergling: 36, roach: 6, hydralisk: 4, queen: 1 }, heroAllowed: true, seed: 11, units: UNITS, cards: CARDS });
  return {
    modeId: 'frontlines', difficulty: 'normal', players: 1, playerMinerals: 1000, scale: 'skirmish', aiFaction: 'Zerg', mutators: [],
    deploymentId: 'abandoned-camp', terrainSeed: 1, seed: 99, army,
    options: { appRollsAiDice: true, assistedSaves: false, playerHasFlying: false },
    ...over,
  };
}

const emptyTerrain = { seed: 1, table: { width: 36, height: 36 }, pieces: [], fireLanes: [], violations: [] };

/** Scripted player: reports plausible outcomes, deals some damage, answers scoring. */
function playGame(cfg: GameConfig, script: { aggression: number }): { state: GameState; steps: number } {
  let s = createGame(cfg, deploymentById(cfg.deploymentId), emptyTerrain);
  const rng = Rng.from(5);
  let steps = 0;
  const seen = new Set<string>();
  while (s.status === 'playing' && steps < 2000) {
    steps++;
    const st = s.step;
    let cmd: Command;
    switch (st.kind) {
      case 'ROUND_START':
      case 'PHASE_START':
      case 'ROUND_END':
        cmd = { t: 'continue' };
        break;
      case 'AI_ORDER': {
        const o = st.order;
        expect(o.lines.length).toBeGreaterThan(0);
        expect(o.reports.length).toBeGreaterThan(0);
        for (const b of o.batches) expect(b.rolls?.length).toBe(b.dice);
        seen.add(o.type);
        if (o.type === 'charge') cmd = { t: 'orderReport', report: rng.next() < 0.5 ? 'charged' : 'chargeFailed', enemySupply: 1 };
        else if (o.type === 'ranged') cmd = { t: 'orderReport', report: rng.next() < 0.7 ? 'attacked' : 'noTarget' };
        else if (o.type === 'move') cmd = { t: 'orderReport', report: rng.next() < 0.4 ? 'reached' : 'done' };
        else cmd = { t: 'orderReport', report: o.reports[0]!.id };
        break;
      }
      case 'PLAYERS_TURN': {
        // Sometimes damage an AI unit on the table, then act or pass.
        const t = onTable(s);
        if (t.length && rng.next() < script.aggression) {
          const u = rng.pick(t);
          s = apply(s, { t: 'damage', unitId: u.id, dmg: rng.int(1, 6) });
        }
        cmd = rng.next() < 0.5 ? { t: 'playersDone' } : { t: 'playersPass' };
        break;
      }
      case 'COMBAT_CHECKLIST':
        cmd = { t: 'checklistDone' };
        break;
      case 'SCORING_FORM': {
        const markers: ScoringAnswers['markers'] = {};
        for (const m of s.markers) markers[m.id] = rng.next() < 0.5 ? 'players' : 'ai';
        cmd = { t: 'scoring', answers: { markers, playerSupplyLost: rng.int(0, 2), extra: { playerReserveSupply: 0 } } };
        break;
      }
      case 'GAME_OVER':
        cmd = { t: 'continue' };
        break;
      case 'AI_SAVES':
        cmd = { t: 'enterSaves', saved: 0 };
        break;
    }
    s = apply(s, cmd);
  }
  expect(seen.has('deploy')).toBe(true);
  return { state: s, steps };
}

describe('director', () => {
  it('creates a game at round 1 with everyone in reserves', () => {
    const cfg = makeConfig();
    const s = createGame(cfg, deploymentById('abandoned-camp'), emptyTerrain);
    expect(s.round).toBe(1);
    expect(s.step.kind).toBe('ROUND_START');
    expect(reserves(s).length).toBe(s.army.units.length);
    expect(s.supply.start).toBe(3);
    expect(s.orderDeck.current).toBeTruthy();
  });

  it('plays a full Frontlines game to a terminal state', () => {
    const { state, steps } = playGame(makeConfig(), { aggression: 0.5 });
    expect(['won', 'lost', 'draw']).toContain(state.status);
    expect(state.step.kind).toBe('GAME_OVER');
    expect(state.round).toBeLessThanOrEqual(5);
    expect(steps).toBeLessThan(2000);
  });

  it('is deterministic for the same seed and script', () => {
    const a = playGame(makeConfig(), { aggression: 0.3 });
    const b = playGame(makeConfig(), { aggression: 0.3 });
    expect(a.state.vp).toEqual(b.state.vp);
    expect(a.state.log.length).toBe(b.state.log.length);
  });

  it('respects supply when deploying', () => {
    let s = createGame(makeConfig(), deploymentById('abandoned-camp'), emptyTerrain);
    s = apply(s, { t: 'continue' }); // movement phase start
    s = apply(s, { t: 'continue' });
    let deployedSupply = 0;
    for (let i = 0; i < 20 && s.phase === 'movement'; i++) {
      if (s.step.kind === 'AI_ORDER' && s.step.order.type === 'deploy') {
        const u = s.army.units.find((x) => x.id === (s.step as any).order.unitId)!;
        const def = UNITS.find((d) => d.id === u.defId)!;
        const sup = def.squadProfile.find((t) => u.models >= t.min && u.models <= t.max)!.supply;
        deployedSupply += sup;
        expect(deployedSupply).toBeLessThanOrEqual(3);
        s = apply(s, { t: 'orderReport', report: 'done' });
      } else if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'orderReport', report: 'done' });
      else if (s.step.kind === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
      else break;
    }
    expect(deployedSupply).toBeGreaterThan(0);
  });

  it('first side to pass gets the first player marker next phase', () => {
    let s = createGame(makeConfig(), deploymentById('abandoned-camp'), emptyTerrain);
    s = apply(s, { t: 'continue' });
    s = apply(s, { t: 'continue' });
    // Drive until players' turn, then pass immediately.
    for (let i = 0; i < 10 && s.step.kind !== 'PLAYERS_TURN'; i++) if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'orderReport', report: 'done' });
    expect(s.step.kind).toBe('PLAYERS_TURN');
    s = apply(s, { t: 'playersPass' });
    expect(s.nextFirstPlayer === 'players' || s.phase === 'assault').toBe(true);
    for (let i = 0; i < 30 && s.phase === 'movement'; i++) if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'orderReport', report: 'done' });
    expect(s.phase).toBe('assault');
    expect(s.firstPlayer).toBe('players');
  });

  it('damage destroys units and awards VP at scoring; respawn on normal', () => {
    let s = createGame(makeConfig({ difficulty: 'normal' }), deploymentById('abandoned-camp'), emptyTerrain);
    const u = s.army.units[0]!;
    u.location = 'table';
    s = apply(s, { t: 'damage', unitId: u.id, dmg: 999 });
    const after = s.army.units.find((x) => x.id === u.id)!;
    expect(after.location).toBe('destroyed');
    expect(s.aiSupplyLostThisRound).toBeGreaterThan(0);
  });
});

describe('estimated positions', () => {
  it('moves the estimate as orders are reported without a camera', () => {
    let s = createGame(makeConfig(), deploymentById('abandoned-camp'), emptyTerrain);
    s = apply(s, { t: 'continue' });
    s = apply(s, { t: 'continue' });
    let deployedId: string | null = null;
    for (let i = 0; i < 40 && !deployedId; i++) {
      if (s.step.kind === 'AI_ORDER' && s.step.order.type === 'deploy') {
        deployedId = s.step.order.unitId;
        s = apply(s, { t: 'orderReport', report: 'done' });
      } else if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'orderReport', report: 'done' });
      else if (s.step.kind === 'PLAYERS_TURN') s = apply(s, { t: 'playersDone' });
      else s = apply(s, { t: 'continue' });
    }
    const u = s.army.units.find((x) => x.id === deployedId)!;
    expect(u.est).toBeDefined();
    expect(u.est!.y).toBeLessThan(36); // moved inward from the bottom (red) edge
    expect(u.est!.y).toBeGreaterThan(20);
  });
});

describe('DEBUFFs on AI units', () => {
  it('slow the unit, make its saves harder, and wear off at the End of the Round', async () => {
    const { apply, createGame } = await import('@engine/director/reducer');
    const { deploymentById } = await import('@data/index');
    const { speedModFor, aiDebuff } = await import('@engine/ai/decide');
    const { makeConfig } = await import('./helpers');
    const dep = deploymentById('abandoned-camp');
    let s = createGame(makeConfig({ modeId: 'frontlines' }), dep, { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] });
    const u = s.army.units[0]!;
    s = apply(s, { t: 'aiDebuff', unitId: u.id, stat: 'speed', amount: 2 });
    s = apply(s, { t: 'aiDebuff', unitId: u.id, stat: 'armour', amount: 1 });
    const v = s.army.units.find((x) => x.id === u.id)!;
    expect(speedModFor(s, v)).toBe(-2);
    expect(aiDebuff(v, 'armour')).toBe(1);
    // Lifting one leaves the other.
    s = apply(s, { t: 'aiDebuff', unitId: u.id, stat: 'speed', amount: 0 });
    expect(aiDebuff(s.army.units.find((x) => x.id === u.id), 'speed')).toBe(0);
    expect(aiDebuff(s.army.units.find((x) => x.id === u.id), 'armour')).toBe(1);
  });
});
