import { expect } from 'vitest';
import { CARDS, UNITS, deploymentById } from '@data/index';
import { buildAiArmy } from '@engine/army/builder';
import { aiBudget } from '@engine/difficulty';
import { apply, createGame, type Command } from '@engine/director/reducer';
import type { AiOrder, GameConfig, GameState, ScoringAnswers } from '@engine/types/game';
import { Rng } from '@engine/rng';
import { onTable } from '@engine/director/selectors';
import { mapLayout, remixId } from '@engine/terrain/remix';

export function makeConfig(over: Partial<GameConfig> = {}): GameConfig {
  const faction = over.aiFaction ?? 'Zerg';
  const ownership: Record<string, number> = faction === 'Zerg' ? { zergling: 36, roach: 6, hydralisk: 4, queen: 1, kerrigan: 1 } : faction === 'Terran' ? { marine: 18, marauder: 4, medic: 3, goliath: 2, jim_raynor: 1 } : { zealot: 6, adept: 4, stalker: 2, sentry: 2, artanis: 1 };
  const difficulty = over.difficulty ?? 'normal';
  const minerals = over.playerMinerals ?? 1000;
  const army = buildAiArmy({ faction, budget: aiBudget(minerals, difficulty), ownership, heroAllowed: true, seed: 11, units: UNITS, cards: CARDS });
  return {
    modeId: 'frontlines', difficulty, players: 1, playerMinerals: minerals, scale: 'skirmish', aiFaction: faction, mutators: [],
    deploymentId: 'abandoned-camp', terrainSeed: 1, seed: 99, army,
    options: { appRollsAiDice: true, assistedSaves: false, playerHasFlying: false },
    ...over,
  };
}

export interface PlayResult {
  state: GameState;
  steps: number;
  orderTypes: Set<string>;
  reportsGiven: string[];
}

/** Scripted player: reports plausible outcomes, deals damage, answers scoring prompts. */
export function playGame(cfg: GameConfig, opts: { aggression?: number; seed?: number; onScoring?: (s: GameState, a: ScoringAnswers) => void; onOrder?: (s: GameState, o: AiOrder) => void } = {}): PlayResult {
  const dep = deploymentById(cfg.deploymentId);
  let s = createGame(cfg, dep, mapLayout(cfg.terrainMapId ?? remixId(dep.scale, cfg.terrainSeed), dep));
  const rng = Rng.from(opts.seed ?? 5);
  const aggression = opts.aggression ?? 0.5;
  let steps = 0;
  const orderTypes = new Set<string>();
  const reportsGiven: string[] = [];
  while (s.status === 'playing' && steps < 3000) {
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
        opts.onOrder?.(s, o);
        expect(o.lines.length).toBeGreaterThan(0);
        expect(o.reports.length).toBeGreaterThan(0);
        for (const b of o.batches) expect(b.rolls?.length).toBe(b.dice);
        orderTypes.add(o.type);
        const ids = o.reports.map((r) => r.id);
        let report = ids[0]!;
        if (o.type === 'charge') report = rng.next() < 0.5 ? 'charged' : 'chargeFailed';
        else if (o.type === 'ranged') report = rng.next() < 0.7 ? 'attacked' : 'noTarget';
        else if (o.type === 'move' || o.type === 'run') {
          if (ids.includes('exited') && rng.next() < 0.3) report = 'exited';
          else if (ids.includes('reached') && rng.next() < 0.4) report = 'reached';
          else report = 'done';
        }
        reportsGiven.push(report);
        cmd = { t: 'orderReport', report, enemySupply: 1 };
        break;
      }
      case 'PLAYERS_TURN': {
        const t = onTable(s);
        if (t.length && rng.next() < aggression) {
          const u = rng.pick(t);
          s = apply(s, { t: 'damage', unitId: u.id, dmg: rng.int(1, 8) });
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
        const extra: ScoringAnswers['extra'] = { playerReserveSupply: 0 };
        for (const p of st.prompts) {
          if (p.kind === 'number' && p.id !== 'playerSupplyLost') extra[p.id] = rng.int(p.min ?? 0, Math.min(p.max ?? 3, 3));
          if (p.kind === 'yesno') extra[p.id] = rng.next() < 0.6;
        }
        const answers: ScoringAnswers = { markers, playerSupplyLost: rng.int(0, 2), extra };
        opts.onScoring?.(s, answers);
        cmd = { t: 'scoring', answers };
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
  return { state: s, steps, orderTypes, reportsGiven };
}
