import { describe, expect, it } from 'vitest';
import { CARDS, UNITS } from '@data/index';
import { buildAiArmy, chooseFactionCard, instanceCost, makeInstance, validateArmy } from '@engine/army/builder';
import { everything, physicalModelId } from '@engine/army/collection';
import { armySlots, slotsUsed, vespeneLimit, vespeneSpent } from '@engine/army/rules';
import { aiBudget, supplyFor } from '@engine/difficulty';
import type { AiArmy } from '@engine/types/army';
import type { Faction } from '@engine/types/units';

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
    // A Terran Faction card leads it. Which one is the army's own business: Jim Raynor needs a Hero slot, and
    // Terran Armed Forces has none, so he comes under Raynor's Raiders or with a Supply Depot.
    expect(['terran_armed_forces', 'raynor_s_raiders']).toContain(a.factionCardId);
    expect(a.factionCards).toEqual({ Terran: a.factionCardId });
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

const cardOf = (id: string) => CARDS.find((c) => c.id === id)!;
const defOf = (id: string) => UNITS.find((u) => u.id === id)!;
const errors = (a: AiArmy) => validateArmy(a, UNITS, CARDS).filter((i) => i.level === 'error').map((i) => i.text);
/** One box of everything, and a shelf four times as deep (so the budget, not the shelf, is what runs out). */
const shelf = (times: number) => Object.fromEntries(Object.entries(everything().models).map(([id, n]) => [id, n * times]));

describe('the AI musters a legal army (Part 9.1)', () => {
  const RACES: Faction[] = ['Terran', 'Zerg', 'Protoss'];
  const cases = [...RACES.map((r) => [r]), RACES];

  for (const factions of cases) {
    it(`${factions.join(', ')}: every army passes at 1000, 2000 and 4000 Minerals`, () => {
      for (const times of [1, 4]) {
        const ownership = shelf(times);
        for (const budget of [1000, 2000, 4000]) {
          for (let seed = 1; seed <= 12; seed++) {
            const a = buildAiArmy({ faction: factions[0]!, factions, budget, ownership, heroAllowed: true, seed, units: UNITS, cards: CARDS });
            const at = `${factions.join('+')} ${budget} seed ${seed} x${times}`;
            expect(errors(a), at).toEqual([]);
            // Minerals and Vespene Gas are never overspent.
            expect(a.spent, at).toBeLessThanOrEqual(budget);
            expect(a.spent, at).toBe(a.units.reduce((n, u) => n + instanceCost(defOf(u.defId), u), 0));
            const tactical = (a.tacticalCards ?? []).map(cardOf);
            expect(a.tacticalCards, at).toBeDefined();
            expect(tactical.every((c) => c && !c.isFactionCard), at).toBe(true);
            expect(vespeneSpent(tactical), at).toBeLessThanOrEqual(vespeneLimit(budget));
            // Each race it fields is an army under its own Faction card, with a slot for every point of starting Supply.
            const races = new Set(a.units.map((u) => defOf(u.defId).faction));
            expect(Object.keys(a.factionCards ?? {}).sort(), at).toEqual([...races].sort());
            expect(races.has(a.faction), at).toBe(true);
            expect(a.factionCardId, at).toBe(a.factionCards![a.faction]);
            for (const race of races) {
              const fc = cardOf(a.factionCards![race]!);
              expect(fc.isFactionCard && fc.faction === race, at).toBe(true);
              const have = armySlots([fc, ...tactical.filter((c) => c.faction === race)]);
              const used = slotsUsed(a.units.filter((u) => defOf(u.defId).faction === race));
              for (const s of ['Core', 'Elite', 'Support', 'Hero', 'Air'] as const) expect(used[s], `${at} ${race} ${s}`).toBeLessThanOrEqual(have[s]);
              // Zerg Creep: exactly one Creep card.
              if (race === 'Zerg') expect(tactical.filter((c) => /creep$/.test(c.id)).length, at).toBe(1);
            }
            // The shelf and Unique Units.
            const models: Record<string, number> = {};
            for (const u of a.units) models[physicalModelId(u.defId)] = (models[physicalModelId(u.defId)] ?? 0) + u.maxModels;
            for (const [id, n] of Object.entries(models)) expect(n, `${at} ${id}`).toBeLessThanOrEqual(ownership[id] ?? 0);
            for (const u of a.units) if (defOf(u.defId).unique) expect(a.units.filter((x) => x.defId === u.defId).length, at).toBe(1);
            // A weapon is replaced once.
            for (const u of a.units) {
              const replaced = defOf(u.defId).weapons.filter((w) => u.upgrades.includes(w.id) && w.replaces).map((w) => w.replaces!.toLowerCase());
              expect(new Set(replaced).size, at).toBe(replaced.length);
            }
          }
        }
      }
    });
  }

  it('spends most of a budget its shelf can fill, Core first', () => {
    for (const faction of RACES) {
      for (let seed = 1; seed <= 12; seed++) {
        const a = buildAiArmy({ faction, budget: 2000, ownership: shelf(4), heroAllowed: true, seed, units: UNITS, cards: CARDS });
        expect(a.spent, `${faction} seed ${seed}`).toBeGreaterThanOrEqual(1700);
        expect(defOf(a.units[0]!.defId).role, `${faction} seed ${seed}`).toBe('Core');
      }
    }
  });

  it('fields a Hero only with a Hero slot: under a Faction card that has one, or with a Tactical card that gives one', () => {
    let heroes = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = buildAiArmy({ faction: 'Terran', budget: 1500, ownership: shelf(2), heroAllowed: true, seed, units: UNITS, cards: CARDS });
      if (!a.units.some((u) => u.defId === 'jim_raynor')) continue;
      heroes++;
      const cards = [cardOf(a.factionCardId), ...a.tacticalCards!.map(cardOf)];
      expect(armySlots(cards).Hero, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      if (a.factionCardId === 'terran_armed_forces') expect(a.tacticalCards, `seed ${seed}`).toContain('supply_depot');
    }
    expect(heroes).toBeGreaterThan(0);
    // No Vespene Gas for a Hero slot and no Sub-Faction card to give one: no Hero.
    const noSubCards = CARDS.filter((c) => !c.isFactionCard || c.factionTags.length === 0).filter((c) => c.id !== 'supply_depot');
    for (let seed = 1; seed <= 20; seed++) {
      const a = buildAiArmy({ faction: 'Terran', budget: 1500, ownership: shelf(2), heroAllowed: true, seed, units: UNITS, cards: noSubCards });
      expect(a.units.some((u) => u.defId === 'jim_raynor'), `seed ${seed}`).toBe(false);
      expect(validateArmy(a, UNITS, noSubCards).filter((i) => i.level === 'error')).toEqual([]);
    }
  });

  it('never ships two Sub-Factions of one race, and takes the Faction card its Sub-Faction Units need', () => {
    let khalai = 0;
    let nerazim = 0;
    // Praetor Guard are Khalai and Nerazim Watchers are Nerazim: whichever joins first, the other stays on the shelf.
    const ownership = shelf(4);
    for (let seed = 1; seed <= 60; seed++) {
      const a = buildAiArmy({ faction: 'Protoss', budget: 2000, ownership, heroAllowed: false, seed, units: UNITS, cards: CARDS });
      const subs = new Set(a.units.map((u) => defOf(u.defId).subFaction).filter(Boolean));
      expect(subs.size, `seed ${seed}`).toBeLessThanOrEqual(1);
      if (subs.has('Khalai')) { khalai++; expect(a.factionCardId).toBe('khalai'); }
      if (subs.has('Nerazim')) { nerazim++; expect(a.factionCardId).toBe('nerazim'); }
      expect(errors(a), `seed ${seed}`).toEqual([]);
    }
    expect(khalai).toBeGreaterThan(0);
    expect(nerazim).toBeGreaterThan(0);
  });

  it('buys Mode Transformation with a Siege Tank whenever the Minerals allow', () => {
    let tanks = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const a = buildAiArmy({ faction: 'Terran', budget: 2000, ownership: shelf(2), heroAllowed: false, seed, units: UNITS, cards: CARDS, weights: { siege_tank: 3, marine: 1, marauder: 1 } });
      for (const u of a.units.filter((x) => x.defId === 'siege_tank')) {
        tanks++;
        const mode = defOf('siege_tank').abilities.find((x) => x.name === 'Mode Transformation')!;
        // Without it only when not even its 20 Minerals were left once the tank was paid for.
        if (!u.upgrades.includes(mode.id)) expect(a.budget - a.spent, `seed ${seed}`).toBeLessThan(mode.upgradeCost!.small);
        else expect(u.upgrades[0], `seed ${seed}`).toBe(mode.id);
      }
      expect(errors(a)).toEqual([]);
    }
    expect(tanks).toBeGreaterThan(0);
    // A budget with room for it: always bought.
    const roomy = buildAiArmy({ faction: 'Terran', budget: 1000, ownership: { siege_tank: 1, marine: 6 }, heroAllowed: false, seed: 2, units: UNITS, cards: CARDS });
    const tank = roomy.units.find((u) => u.defId === 'siege_tank')!;
    expect(tank.upgrades).toContain(defOf('siege_tank').abilities.find((x) => x.name === 'Mode Transformation')!.id);
  });

  it('is the same army for the same seed, cards and all', () => {
    const o = { faction: 'Zerg' as Faction, factions: RACES, budget: 2000, ownership: shelf(2), heroAllowed: true, seed: 9, units: UNITS, cards: CARDS };
    expect(buildAiArmy(o)).toEqual(buildAiArmy(o));
  });
});

describe('the Faction card the roster calls for', () => {
  it('matches Sub-Faction Tags against the card\'s own Faction Tags, exactly', () => {
    expect(chooseFactionCard('Terran', CARDS, new Set())!.id).toBe('terran_armed_forces');
    expect(chooseFactionCard('Zerg', CARDS, new Set())!.id).toBe('zerg_swarm');
    expect(chooseFactionCard('Protoss', CARDS, new Set())!.id).toBe('daelaam');
    expect(chooseFactionCard('Terran', CARDS, new Set(["Raynor's Raiders"]))!.id).toBe('raynor_s_raiders');
    expect(chooseFactionCard('Zerg', CARDS, new Set(["Kerrigan's Swarm"]))!.id).toBe('kerrigan_s_swarm');
    expect(chooseFactionCard('Protoss', CARDS, new Set(['Khalai']))!.id).toBe('khalai');
    expect(chooseFactionCard('Protoss', CARDS, new Set(['Nerazim']))!.id).toBe('nerazim');
    // The first tag named wins; a tag no card carries falls back to the race's plain card; a part of a name is no match.
    expect(chooseFactionCard('Protoss', CARDS, new Set(['Nerazim', 'Khalai']))!.id).toBe('nerazim');
    expect(chooseFactionCard('Protoss', CARDS, new Set(['Tal\'darim']))!.id).toBe('daelaam');
    expect(chooseFactionCard('Zerg', CARDS, new Set(['Kerrigan']))!.id).toBe('zerg_swarm');
    // Every Sub-Faction a Unit carries has its card.
    for (const u of UNITS.filter((x) => x.subFaction)) expect(chooseFactionCard(u.faction, CARDS, new Set([u.subFaction!]))!.factionTags, u.id).toContain(u.subFaction);
  });
});

describe('validateArmy holds the AI to Army Building', () => {
  const army = (units: [string, 'small' | 'large'][], over: Partial<AiArmy>): AiArmy => {
    const insts = units.map(([id, comp], i) => makeInstance(defOf(id), comp, id, i + 1));
    return { faction: 'Terran', factionCardId: 'terran_armed_forces', tacticalCards: [], budget: 2000, spent: 0, units: insts, ...over };
  };

  it('passes an army with a slot for every Unit', () => {
    expect(errors(army([['marine', 'large'], ['marauder', 'small'], ['goliath', 'small']], { tacticalCards: ['factory'] }))).toEqual([]);
  });

  it('reports more Army Slots occupied than the cards give', () => {
    // A Goliath is Supply 2: Terran Armed Forces alone has one Elite slot.
    expect(errors(army([['marine', 'large'], ['goliath', 'small']], {}))).toEqual(['Terran: Units occupy 2 Elite Army Slots. The cards give 1.']);
    // Jim Raynor under Terran Armed Forces: no Hero slot.
    expect(errors(army([['marine', 'large'], ['jim_raynor', 'small']], {}))).toEqual(['Terran: Units occupy 1 Hero Army Slots. The cards give 0.']);
    expect(errors(army([['marine', 'large'], ['jim_raynor', 'small']], { tacticalCards: ['supply_depot'] }))).toEqual([]);
  });

  it('reports a Unit whose Faction Tags the Faction card lacks', () => {
    const e = errors(army([['marine', 'small'], ['raynor_s_raider__marine_', 'small']], {}));
    expect(e).toEqual(["Raynor's Raider (Marine) under Terran Armed Forces: Needs the Raynor's Raiders Faction card."]);
    expect(errors(army([['marine', 'small'], ['raynor_s_raider__marine_', 'small']], { factionCardId: 'raynor_s_raiders' }))).toEqual([]);
  });

  it('reports two Sub-Factions of one race', () => {
    const e = errors(army([['praetor_guard__zealot_', 'small'], ['nerazim_watchers__adept_', 'small']], { faction: 'Protoss', factionCardId: 'khalai' }));
    expect(e.some((t) => /mix Sub-Factions \(Khalai, Nerazim\)/.test(t))).toBe(true);
    expect(e.some((t) => /Nerazim Watchers \(Adept\) under Khalai/.test(t))).toBe(true);
  });

  it('reports Vespene Gas overspent, a card of the wrong army, and a race without its Faction card', () => {
    expect(errors(army([['marine', 'small'], ['marauder', 'small']], { budget: 500, tacticalCards: ['barracks', 'barracks', 'barracks'] }))).toEqual(['Tactical cards cost 75 Vespene Gas. The limit is 50.']);
    expect(errors(army([['marine', 'small'], ['marauder', 'small']], { tacticalCards: ['spawning_pool'] }))).toEqual(['Spawning Pool belongs to no race the army fields.']);
    expect(errors(army([['marine', 'small'], ['zergling', 'small']], {}))).toEqual(['The Zerg Units have no Faction card.']);
    expect(errors(army([['marine', 'small'], ['zergling', 'small']], { factionCards: { Terran: 'terran_armed_forces', Zerg: 'zerg_swarm' } }))).toEqual(['Zerg Swarm takes exactly one Creep card. The army has 0.']);
    expect(errors(army([['marine', 'small'], ['zergling', 'small']], { factionCards: { Terran: 'terran_armed_forces', Zerg: 'zerg_swarm' }, tacticalCards: ['accelerating_creep'] }))).toEqual([]);
  });

  it('only warns about a story force, which is not mustered to slots', () => {
    const story = army([['goliath', 'small'], ['goliath', 'small'], ['raynor_s_raider__marine_', 'small']], { storyForce: true });
    expect(errors(story)).toEqual([]);
    expect(validateArmy(story, UNITS, CARDS).some((i) => i.level === 'warn')).toBe(true);
  });
});

describe('a story force (campaigns)', () => {
  it('fields what it is given whatever the slots, and still records the cards its Vespene Gas buys', () => {
    // Two Goliaths and nothing else: 4 Elite slots, where a mustered army at 500 Minerals (50 gas) gets 3 at most.
    const o = { faction: 'Terran' as Faction, budget: 500, ownership: { goliath: 2 }, heroAllowed: false, seed: 1, units: UNITS, cards: CARDS };
    const story = buildAiArmy({ ...o, storyForce: true });
    expect(story.units.map((u) => u.defId)).toEqual(['goliath', 'goliath']);
    expect(story.storyForce).toBe(true);
    expect(story.factionCardId).toBe('terran_armed_forces');
    expect(vespeneSpent(story.tacticalCards!.map(cardOf))).toBeLessThanOrEqual(50);
    expect(errors(story)).toEqual([]);
    const mustered = buildAiArmy(o);
    expect(mustered.units.map((u) => u.defId)).toEqual(['goliath']);
    expect(mustered.storyForce).toBeUndefined();
    expect(errors(mustered)).toEqual(['The AI needs at least two units.']);
  });
});
