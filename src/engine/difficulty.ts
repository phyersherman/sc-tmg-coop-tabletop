import type { DifficultyId } from './types/game';

export interface DifficultyProfile {
  id: DifficultyId;
  name: string;
  blurb: string;
  budgetMult: number;
  supplyStartBonus: number;
  escalationBonus: number;
  respawn: { mode: 'none' | 'limited' | 'pooled' | 'unlimited'; delayRounds: number; maxTotal: number; modelsPct: number; poolPct: number };
  chargeDice: '1d6' | '2d6high';
  doctrineTier: 0 | 1 | 2;
  mutatorPoints: number;
  heroAllowed: boolean;
  passEarly: boolean;
}

export const DIFFICULTIES: Record<DifficultyId, DifficultyProfile> = {
  casual: {
    id: 'casual', name: 'Casual', blurb: 'Learn the app. Smaller AI army, no reinforcements.',
    budgetMult: 0.8, supplyStartBonus: 0, escalationBonus: 0,
    respawn: { mode: 'none', delayRounds: 1, maxTotal: 0, modelsPct: 1, poolPct: 0 },
    chargeDice: '1d6', doctrineTier: 0, mutatorPoints: 0, heroAllowed: false, passEarly: false,
  },
  normal: {
    id: 'normal', name: 'Normal', blurb: 'Even minerals. Destroyed AI units come back once, a round later.',
    budgetMult: 1.0, supplyStartBonus: 0, escalationBonus: 0,
    respawn: { mode: 'limited', delayRounds: 1, maxTotal: 1, modelsPct: 1, poolPct: 0 },
    chargeDice: '1d6', doctrineTier: 0, mutatorPoints: 0, heroAllowed: true, passEarly: false,
  },
  hard: {
    id: 'hard', name: 'Hard', blurb: '+25% AI minerals, better charges, a reinforcement pool worth half the AI army.',
    budgetMult: 1.25, supplyStartBonus: 1, escalationBonus: 0,
    respawn: { mode: 'pooled', delayRounds: 1, maxTotal: 99, modelsPct: 1, poolPct: 0.5 },
    chargeDice: '2d6high', doctrineTier: 1, mutatorPoints: 0, heroAllowed: true, passEarly: true,
  },
  brutal: {
    id: 'brutal', name: 'Brutal', blurb: '+50% AI minerals, faster supply, endless reinforcements at 75% strength.',
    budgetMult: 1.5, supplyStartBonus: 2, escalationBonus: 1,
    respawn: { mode: 'unlimited', delayRounds: 1, maxTotal: 99, modelsPct: 0.75, poolPct: 0 },
    chargeDice: '2d6high', doctrineTier: 2, mutatorPoints: 0, heroAllowed: true, passEarly: true,
  },
  brutalPlus: {
    id: 'brutalPlus', name: 'Brutal+', blurb: 'Brutal with two or three random mutators.',
    budgetMult: 1.5, supplyStartBonus: 2, escalationBonus: 1,
    respawn: { mode: 'unlimited', delayRounds: 1, maxTotal: 99, modelsPct: 0.75, poolPct: 0 },
    chargeDice: '2d6high', doctrineTier: 2, mutatorPoints: 5, heroAllowed: true, passEarly: true,
  },
};

/** AI mineral budget from the players' combined minerals. */
export function aiBudget(playerMinerals: number, difficulty: DifficultyId): number {
  return Math.round((playerMinerals * DIFFICULTIES[difficulty].budgetMult) / 10) * 10;
}

/** Mission supply values by scale, with difficulty and player-count bonuses. */
export function supplyFor(
  scale: 'skirmish' | 'standard' | 'grand',
  difficulty: DifficultyId,
  players: number,
  base?: { start: number; escalation: number },
): { start: number; escalation: number } {
  const b = base ?? (scale === 'skirmish' ? { start: 3, escalation: 1 } : scale === 'standard' ? { start: 6, escalation: 2 } : { start: 9, escalation: 3 });
  const d = DIFFICULTIES[difficulty];
  // Each player has the mission's pool to themselves, so the AI's is the whole table's: the pool for every
  // player at once, with the difficulty's bonus on top.
  const n = Math.max(1, players);
  return { start: b.start * n + d.supplyStartBonus, escalation: b.escalation * n + d.escalationBonus };
}
