import { describe, expect, it } from 'vitest';
import { CARDS, UNITS } from '@data/index';
import { buildAiArmy, validateArmy } from '@engine/army/builder';
import { aiBudget, supplyFor } from '@engine/difficulty';

const terranOwn = { marine: 18, marauder: 4, medic: 3, goliath: 2, jim_raynor: 1 };

describe('army builder', () => {
  it('stays within budget and ownership, deterministic per seed', () => {
    const a = buildAiArmy({ faction: 'Terran', budget: 1000, ownership: terranOwn, heroAllowed: true, seed: 7, units: UNITS, cards: CARDS });
    const b = buildAiArmy({ faction: 'Terran', budget: 1000, ownership: terranOwn, heroAllowed: true, seed: 7, units: UNITS, cards: CARDS });
    expect(a).toEqual(b);
    expect(a.spent).toBeLessThanOrEqual(1000);
    expect(a.spent).toBeGreaterThanOrEqual(850);
    const models: Record<string, number> = {};
    for (const u of a.units) models[u.defId] = (models[u.defId] ?? 0) + u.maxModels;
    for (const [id, n] of Object.entries(models)) expect(n).toBeLessThanOrEqual((terranOwn as any)[id]);
    expect(a.units.filter((u) => u.defId === 'jim_raynor').length).toBeLessThanOrEqual(1);
    expect(validateArmy(a, UNITS, CARDS).filter((i) => i.level === 'error')).toEqual([]);
    expect(a.factionCardId).toBe('terran_armed_forces');
  });
  it('respects heroAllowed=false and picks sub-faction cards', () => {
    const z = buildAiArmy({ faction: 'Zerg', budget: 1000, ownership: { zergling: 18, kerrigan: 1, kerrigan_swarm_raptor__zergling_: 6, roach: 6 }, heroAllowed: false, seed: 3, units: UNITS, cards: CARDS });
    expect(z.units.some((u) => u.defId === 'kerrigan')).toBe(false);
    expect(z.units.length).toBeGreaterThanOrEqual(2);
  });
  it('budget and supply helpers', () => {
    expect(aiBudget(2000, 'hard')).toBe(2500);
    expect(aiBudget(1000, 'casual')).toBe(800);
    // Two players each have the standard pool (6, +2 a round), so the AI faces both: 12 +4, plus Brutal's 2 and 1.
    expect(supplyFor('standard', 'brutal', 2)).toEqual({ start: 14, escalation: 5 });
    expect(supplyFor('skirmish', 'normal', 1)).toEqual({ start: 3, escalation: 1 });
  });
});

describe('the collection is counted in miniatures', () => {
  it('never fields more Adept models than you own, across Adepts and Nerazim Watchers together', async () => {
    const { buildAiArmy } = await import('@engine/army/builder');
    const { CARDS, UNITS } = await import('@data/index');
    const models = (army: { units: { defId: string; maxModels: number }[] }) =>
      army.units.filter((u) => /adept/.test(u.defId)).reduce((n, u) => n + u.maxModels, 0);
    // Four Adept miniatures, plenty of everything else, and a budget that would happily buy eight.
    for (let seed = 1; seed <= 30; seed++) {
      const own = buildAiArmy({ faction: 'Protoss', budget: 2000, ownership: { adept: 4, zealot: 12, stalker: 4, sentry: 2, immortal: 2 }, heroAllowed: false, seed, units: UNITS, cards: CARDS });
      expect(models(own), `seed ${seed} by model`).toBeLessThanOrEqual(4);
      // The same shelf written out per unit, every variant carrying the model's count, is the same shelf.
      const perUnit = buildAiArmy({ faction: 'Protoss', budget: 2000, ownership: { adept: 4, nerazim_watchers__adept_: 4, zealot: 12, praetor_guard__zealot_: 12, stalker: 4, sentry: 2, immortal: 2 }, heroAllowed: false, seed, units: UNITS, cards: CARDS });
      expect(models(perUnit), `seed ${seed} per unit`).toBeLessThanOrEqual(4);
      expect(perUnit.units.filter((u) => /zealot/.test(u.defId)).reduce((n, u) => n + u.maxModels, 0)).toBeLessThanOrEqual(12);
    }
  });
});
