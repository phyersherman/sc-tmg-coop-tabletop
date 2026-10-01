import { describe, expect, it } from 'vitest';
import { CARDS, UNITS, unitById } from '@data/index';
import { configCostOf, type UnitChoice } from '@engine/army/force';
import {
  addUnitProblem, armySlots, cardEligible, cardNeeds, cheapestCards, isCreepCard, needsCreepCard, noSlots, slotOf, slotsUsed,
  startingSupply, unitEligible, unitNeeds, validatePlayerArmy, vespeneLimit, vespeneSpent,
} from '@engine/army/rules';
import { toggleUpgrade } from '@engine/units/weapons';

const card = (id: string) => {
  const c = CARDS.find((x) => x.id === id);
  if (!c) throw new Error(`no card ${id}`);
  return c;
};
/** A Unit as it is bought: its upgrades named as the book names them (ids are the snapshot's business). */
const unit = (defId: string, composition: 'small' | 'large' = 'small', ...upgrades: string[]): UnitChoice => {
  const def = unitById(defId);
  return {
    defId, composition,
    upgrades: upgrades.map((name) => {
      const up = [...def.weapons, ...def.abilities].find((x) => x.upgradeCost && x.name.toLowerCase() === name.toLowerCase());
      if (!up) throw new Error(`${defId} has no upgrade ${name}`);
      return up.id;
    }),
  };
};
const codes = (army: Parameters<typeof validatePlayerArmy>[0]) => validatePlayerArmy(army).map((p) => p.code);

describe('Army Slots (Parts 5.2, 9.1.5, 9.1.6)', () => {
  it('the Faction card gives the first slots and every Tactical card copy adds its own', () => {
    expect(armySlots([card('terran_armed_forces')])).toEqual({ Core: 3, Elite: 1, Support: 1, Hero: 0, Air: 0 });
    expect(armySlots([card('terran_armed_forces'), card('barracks'), card('barracks'), card('factory')])).toEqual({ Core: 5, Elite: 3, Support: 1, Hero: 0, Air: 0 });
    expect(armySlots([])).toEqual(noSlots());
  });

  it('a Unit occupies slots of its own type equal to its starting Supply Value', () => {
    // Nine Marines are Supply 2: two Core slots. Four Hydralisks are Supply 3: three Elite slots (the book's own example).
    expect(slotsUsed([unit('marine', 'large')])).toEqual({ ...noSlots(), Core: 2 });
    expect(slotsUsed([unit('marine', 'small')])).toEqual({ ...noSlots(), Core: 1 });
    expect(slotsUsed([unit('hydralisk', 'large')])).toEqual({ ...noSlots(), Elite: 3 });
    expect(slotsUsed([unit('hydralisk', 'small')])).toEqual({ ...noSlots(), Elite: 2 });
    expect(slotsUsed([unit('marine', 'large'), unit('marauder'), unit('goliath'), unit('medic'), unit('jim_raynor')])).toEqual({ Core: 3, Elite: 2, Support: 1, Hero: 1, Air: 0 });
    for (const def of UNITS) for (const c of def.compositions) expect(startingSupply(def, c.label), `${def.id} ${c.label}`).toBe(c.supply);
  });

  it('Summoned Units are not in the Army List and occupy no slot (9.1.9)', () => {
    for (const def of UNITS.filter((u) => u.summoned)) {
      expect(slotOf(def), def.id).toBeNull();
      expect(slotsUsed([{ defId: def.id, composition: 'small' }])).toEqual(noSlots());
    }
    for (const def of UNITS.filter((u) => !u.summoned)) expect(slotOf(def), def.id).toBe(def.role);
  });
});

describe('Faction Tag Eligibility (9.1.2)', () => {
  it('every tag on the Unit must appear on the Faction card', () => {
    // The book's example: under Zerg Swarm, Zerglings are eligible and the Kerrigan Swarm Raptor is not.
    expect(unitEligible(unitById('zergling'), card('zerg_swarm'))).toBe(true);
    expect(unitEligible(unitById('kerrigan_swarm_raptor__zergling_'), card('zerg_swarm'))).toBe(false);
    expect(unitNeeds(unitById('kerrigan_swarm_raptor__zergling_'), card('zerg_swarm'))).toBe("Needs the Kerrigan's Swarm Faction card.");
    expect(unitEligible(unitById('kerrigan_swarm_raptor__zergling_'), card('kerrigan_s_swarm'))).toBe(true);
    // Fewer tags than the Faction card is fine.
    expect(unitEligible(unitById('zergling'), card('kerrigan_s_swarm'))).toBe(true);
    expect(unitEligible(unitById('raynor_s_raider__marine_'), card('terran_armed_forces'))).toBe(false);
    expect(unitEligible(unitById('raynor_s_raider__marine_'), card('raynor_s_raiders'))).toBe(true);
    expect(unitEligible(unitById('nerazim_watchers__adept_'), card('nerazim'))).toBe(true);
    expect(unitEligible(unitById('nerazim_watchers__adept_'), card('khalai'))).toBe(false);
    expect(unitEligible(unitById('praetor_guard__zealot_'), card('khalai'))).toBe(true);
    expect(unitEligible(unitById('praetor_guard__zealot_'), card('daelaam'))).toBe(false);
  });

  it('the Race Tag must match, and nothing is eligible before a Faction card is selected', () => {
    expect(unitEligible(unitById('marine'), card('zerg_swarm'))).toBe(false);
    expect(unitNeeds(unitById('marine'), card('zerg_swarm'))).toBe('Needs a Terran Faction card.');
    expect(unitEligible(unitById('marine'), undefined)).toBe(false);
    expect(unitNeeds(unitById('marine'), null)).toBe('Select a Faction card first.');
    // A Tactical card is not a Faction card.
    expect(unitEligible(unitById('marine'), card('barracks'))).toBe(false);
  });

  it('a Hero with no Sub-Faction Tag is eligible under every Faction card of its race', () => {
    for (const def of UNITS.filter((u) => u.role === 'Hero')) {
      for (const fc of CARDS.filter((c) => c.isFactionCard)) expect(unitEligible(def, fc), `${def.id} under ${fc.id}`).toBe(fc.faction === def.faction);
    }
  });

  it('holds for Tactical cards and Creep cards too', () => {
    expect(cardEligible(card('barracks'), card('terran_armed_forces'))).toBe(true);
    expect(cardEligible(card('barracks'), card('raynor_s_raiders'))).toBe(true);
    expect(cardEligible(card('barracks'), card('zerg_swarm'))).toBe(false);
    expect(cardEligible(card('malignant_creep'), card('kerrigan_s_swarm'))).toBe(true);
    expect(cardEligible(card('malignant_creep'), card('zerg_swarm'))).toBe(false);
    expect(cardNeeds(card('malignant_creep'), card('zerg_swarm'))).toBe("Needs the Kerrigan's Swarm Faction card.");
    expect(cardEligible(card('accelerating_creep'), card('zerg_swarm'))).toBe(true);
    expect(cardEligible(card('void_seeker'), card('nerazim'))).toBe(true);
    expect(cardEligible(card('void_seeker'), card('daelaam'))).toBe(false);
    expect(cardEligible(card('barracks'), null)).toBe(false);
  });

  it('the Creep cards are the two the book lists, and the Zerg Faction cards ask for one', () => {
    expect(CARDS.filter(isCreepCard).map((c) => c.id).sort()).toEqual(['accelerating_creep', 'malignant_creep']);
    for (const fc of CARDS.filter((c) => c.isFactionCard)) expect(needsCreepCard(fc), fc.id).toBe(fc.faction === 'Zerg');
    expect(needsCreepCard(undefined)).toBe(false);
  });
});

describe('an army that may be fielded (validatePlayerArmy)', () => {
  const legal = {
    cards: ['terran_armed_forces', 'barracks', 'factory', 'orbital_command'],
    units: [unit('marine', 'large'), unit('marauder'), unit('marauder'), unit('medic'), unit('goliath')],
    minerals: 1000,
  };

  it('passes a legal army, however the Faction card is handed over', () => {
    expect(validatePlayerArmy(legal)).toEqual([]);
    expect(validatePlayerArmy({ ...legal, factionCard: 'terran_armed_forces' })).toEqual([]);
    expect(validatePlayerArmy({ ...legal, factionCard: card('terran_armed_forces'), cards: legal.cards.slice(1).map(card) })).toEqual([]);
  });

  it('every army must include exactly one Faction card (5.4)', () => {
    expect(codes({ ...legal, cards: ['barracks', 'factory', 'orbital_command'] })).toContain('no-faction-card');
    expect(codes({ cards: [], units: [], minerals: 1000 })).toEqual(['no-faction-card']);
    expect(codes({ ...legal, cards: [...legal.cards, 'raynor_s_raiders'] })).toContain('faction-cards');
    expect(codes({ ...legal, factionCard: 'raynor_s_raiders' })).toContain('faction-cards');
  });

  it('the Mineral cost must not exceed the limit (9.1.3)', () => {
    const cost = legal.units.reduce((n, u) => n + configCostOf(u), 0);
    expect(codes({ ...legal, minerals: cost })).not.toContain('minerals');
    expect(codes({ ...legal, minerals: cost - 10 })).toContain('minerals');
    // Upgrades are paid in Minerals too.
    expect(codes({ ...legal, units: [...legal.units.slice(0, 4), unit('goliath', 'small', 'Scatter Missiles')], minerals: cost })).toContain('minerals');
    expect(validatePlayerArmy({ ...legal, minerals: 500 }).find((p) => p.code === 'minerals')!.text).toBe(`The army costs ${cost} Minerals. The limit is 500.`);
  });

  it('Tactical and Creep cards are paid in Vespene Gas, 10% of the Minerals (9.1.1, 9.1.4)', () => {
    expect(vespeneLimit(1000)).toBe(100);
    expect(vespeneLimit(2000)).toBe(200);
    expect(vespeneLimit(750)).toBe(75);
    expect(vespeneSpent(legal.cards.map(card))).toBe(card('barracks').cost + card('factory').cost + card('orbital_command').cost);
    const over = { ...legal, cards: [...legal.cards, 'academy'] };
    expect(vespeneSpent(over.cards.map(card))).toBeGreaterThan(100);
    expect(codes(over)).toEqual(['vespene']);
    expect(codes({ ...over, minerals: 2000 })).toEqual([]);
    // The Creep card's cost counts.
    const zerg = { cards: ['kerrigan_s_swarm', 'malignant_creep'], units: [unit('zergling')], minerals: 1000 };
    expect(codes(zerg)).toEqual([]);
    expect(vespeneSpent(zerg.cards.map(card))).toBe(card('malignant_creep').cost);
    expect(codes({ ...zerg, minerals: card('malignant_creep').cost * 10 - 10 })).toContain('vespene');
  });

  it('no more Army Slots may be occupied than the cards give, type by type (9.1.6)', () => {
    // The book's example: Kerrigan's Swarm gives 2 Elite slots; a full-strength Hydralisk Unit occupies 3.
    const ks = { cards: ['kerrigan_s_swarm', 'accelerating_creep'], minerals: 1000 };
    expect(codes({ ...ks, units: [unit('hydralisk', 'small')] })).toEqual([]);
    const over = validatePlayerArmy({ ...ks, units: [unit('hydralisk', 'large')] });
    expect(over.map((p) => [p.code, p.slot])).toEqual([['slots', 'Elite']]);
    expect(over[0]!.text).toBe('Units occupy 3 Elite Army Slots. The cards give 2.');
    expect(codes({ ...ks, cards: [...ks.cards, 'hydralisk_den'], units: [unit('hydralisk', 'large')] })).toEqual([]);
    // A second copy of a Tactical card gives its slots again.
    const core = { cards: ['terran_armed_forces'], units: [unit('marine', 'large'), unit('marine', 'large'), unit('marine', 'small')], minerals: 1000 };
    expect(codes(core)).toEqual(['slots']);
    expect(codes({ ...core, cards: ['terran_armed_forces', 'barracks'] })).toEqual(['slots']);
    expect(codes({ ...core, cards: ['terran_armed_forces', 'barracks', 'barracks'] })).toEqual([]);
    // Removing a Tactical card leaves the Units without their slots: it is reported, not passed over.
    expect(codes({ ...legal, cards: legal.cards.filter((c) => c !== 'factory') })).toEqual(['slots']);
    // A Hero needs a Hero slot: Terran Armed Forces has none.
    expect(validatePlayerArmy({ cards: ['terran_armed_forces'], units: [unit('jim_raynor')], minerals: 1000 }).map((p) => p.slot)).toEqual(['Hero']);
    expect(codes({ cards: ['terran_armed_forces', 'supply_depot'], units: [unit('jim_raynor')], minerals: 1000 })).toEqual([]);
    expect(codes({ cards: ['raynor_s_raiders'], units: [unit('jim_raynor')], minerals: 1000 })).toEqual([]);
  });

  it('a Unit or Tactical card with a tag the Faction card lacks cannot be included (9.1.2)', () => {
    const z = { cards: ['zerg_swarm', 'accelerating_creep'], minerals: 1000 };
    const raptor = validatePlayerArmy({ ...z, units: [unit('kerrigan_swarm_raptor__zergling_')] });
    expect(raptor.map((p) => p.code)).toEqual(['unit-ineligible']);
    expect(raptor[0]!.text).toBe("Kerrigan Swarm Raptor (Zergling): Needs the Kerrigan's Swarm Faction card.");
    expect(codes({ cards: ['zerg_swarm', 'malignant_creep'], units: [unit('zergling')], minerals: 1000 })).toEqual(['card-ineligible']);
    expect(codes({ ...z, units: [unit('marine')] })).toContain('unit-ineligible');
    expect(codes({ ...z, cards: [...z.cards, 'barracks'], units: [unit('zergling')] })).toEqual(['card-ineligible']);
    // Changing the Faction card under an army built for another is reported Unit by Unit, each named once.
    const swapped = validatePlayerArmy({ cards: ['daelaam'], units: [unit('nerazim_watchers__adept_'), unit('nerazim_watchers__adept_'), unit('praetor_guard__zealot_')], minerals: 2000 });
    expect(swapped.filter((p) => p.code === 'unit-ineligible').map((p) => p.text)).toEqual([
      'Nerazim Watchers (Adept): Needs the Nerazim Faction card.',
      'Praetor Guard (Zealot): Needs the Khalai Faction card.',
    ]);
  });

  it('a Unique Unit is included once', () => {
    const two = validatePlayerArmy({ cards: ['raynor_s_raiders', 'supply_depot'], units: [unit('jim_raynor'), unit('jim_raynor')], minerals: 1000 });
    expect(two.map((p) => p.code)).toEqual(['unique-unit']);
    expect(two[0]!.text).toBe('Jim Raynor is Unique. Only one may be included in the army.');
    // Not Unique: as many as the slots hold.
    expect(codes({ cards: ['terran_armed_forces'], units: [unit('marine'), unit('marine'), unit('marine')], minerals: 1000 })).toEqual([]);
  });

  it('any Tactical card may be taken more than once, Unique or not', () => {
    expect(card('academy').unique).toBe(true);
    expect(codes({ cards: ['terran_armed_forces', 'academy', 'academy', 'barracks', 'barracks'], units: [unit('medic'), unit('medic'), unit('medic')], minerals: 2000 })).toEqual([]);
  });

  it('a Zerg army takes exactly one Creep card (Zerg Creep)', () => {
    const z = { units: [unit('zergling')], minerals: 1000 };
    expect(codes({ ...z, cards: ['zerg_swarm'] })).toEqual(['creep-missing']);
    expect(codes({ ...z, cards: ['zerg_swarm', 'accelerating_creep'] })).toEqual([]);
    expect(codes({ ...z, cards: ['kerrigan_s_swarm', 'accelerating_creep', 'malignant_creep'] })).toEqual(['creep-many']);
    expect(codes({ ...z, cards: ['zerg_swarm', 'accelerating_creep', 'accelerating_creep'] })).toEqual(['creep-many']);
    // The other races take none.
    expect(codes({ cards: ['terran_armed_forces'], units: [unit('marine')], minerals: 1000 })).toEqual([]);
  });

  it('skips Units it does not know (an army saved from older data) without failing', () => {
    expect(codes({ cards: ['terran_armed_forces'], units: [{ defId: 'no_such_unit', composition: 'small', upgrades: [] }, unit('marine')], minerals: 1000 })).toEqual([]);
  });
});

describe('adding a Unit in the army builder', () => {
  const army = (cards: string[], ...units: UnitChoice[]) => ({ cards: cards.map(card), units });

  it('needs a Faction card first', () => {
    expect(addUnitProblem(unitById('marine'), 'small', army([]))).toBe('Select a Faction card first.');
    expect(addUnitProblem(unitById('marine'), 'small', army(['terran_armed_forces']))).toBeNull();
  });

  it('needs the Faction card that carries its tags', () => {
    expect(addUnitProblem(unitById('kerrigan_swarm_raptor__zergling_'), 'small', army(['zerg_swarm']))).toBe("Needs the Kerrigan's Swarm Faction card.");
    expect(addUnitProblem(unitById('kerrigan_swarm_raptor__zergling_'), 'small', army(['kerrigan_s_swarm']))).toBeNull();
  });

  it('needs free Army Slots of its type for its starting Supply', () => {
    // Terran Armed Forces: 1 Elite. A Goliath (Supply 2) does not fit until a Tactical card gives another.
    expect(addUnitProblem(unitById('goliath'), 'small', army(['terran_armed_forces']))).toBe('Occupies 2 Elite Army Slots. 1 is free. Add a Tactical card that gives one.');
    expect(addUnitProblem(unitById('goliath'), 'small', army(['terran_armed_forces', 'armory']))).toBeNull();
    expect(addUnitProblem(unitById('goliath'), 'small', army(['terran_armed_forces', 'armory'], unit('goliath')))).toBe('No free Elite Army Slot. Add a Tactical card that gives one.');
    expect(addUnitProblem(unitById('jim_raynor'), 'small', army(['terran_armed_forces']))).toBe('No free Hero Army Slot. Add a Tactical card that gives one.');
    // The small squad fits where the large one does not, and copies are counted together.
    const two = army(['kerrigan_s_swarm']);
    expect(addUnitProblem(unitById('hydralisk'), 'small', two)).toBeNull();
    expect(addUnitProblem(unitById('hydralisk'), 'large', two)).toBe('Occupies 3 Elite Army Slots. 2 are free. Add a Tactical card that gives one.');
    expect(addUnitProblem(unitById('marine'), 'small', army(['terran_armed_forces']), 3)).toBeNull();
    expect(addUnitProblem(unitById('marine'), 'small', army(['terran_armed_forces']), 4)).toMatch(/^Occupies 4 Core Army Slots\. 3 are free\./);
  });

  it('takes a Unique Unit once', () => {
    const a = army(['raynor_s_raiders', 'supply_depot'], unit('jim_raynor'));
    expect(addUnitProblem(unitById('jim_raynor'), 'small', a)).toBe('Jim Raynor is Unique. Only one may be included in the army.');
    expect(addUnitProblem(unitById('jim_raynor'), 'small', army(['raynor_s_raiders']), 2)).toBe('Jim Raynor is Unique. Only one may be included in the army.');
  });
});

describe('the cheapest Tactical cards for the slots needed', () => {
  const terran = CARDS.filter((c) => !c.isFactionCard && c.faction === 'Terran');
  it('needs none when the Faction card gives enough', () => {
    expect(cheapestCards(card('terran_armed_forces'), { ...noSlots(), Core: 3, Elite: 1 }, terran)).toEqual({ cards: [], gas: 0 });
  });
  it('covers every type, with copies when that is cheapest', () => {
    const need = { ...noSlots(), Core: 6, Elite: 3, Hero: 1 };
    const cover = cheapestCards(card('terran_armed_forces'), need, terran)!;
    const have = armySlots([card('terran_armed_forces'), ...cover.cards]);
    for (const s of ['Core', 'Elite', 'Support', 'Hero', 'Air'] as const) expect(have[s], s).toBeGreaterThanOrEqual(need[s]);
    expect(cover.gas).toBe(vespeneSpent(cover.cards));
    // Nothing cheaper exists: no single card can be dropped, and the price beats buying the slots one card at a time.
    for (let i = 0; i < cover.cards.length; i++) {
      const fewer = armySlots([card('terran_armed_forces'), ...cover.cards.filter((_, k) => k !== i)]);
      expect((['Core', 'Elite', 'Hero'] as const).some((s) => fewer[s] < need[s])).toBe(true);
    }
    expect(cover.gas).toBeLessThanOrEqual(3 * card('barracks').cost + card('factory').cost + card('supply_depot').cost);
  });
  it('is null when no card on offer gives the slot', () => {
    expect(cheapestCards(card('terran_armed_forces'), { ...noSlots(), Air: 1 }, terran)).toBeNull();
    expect(cheapestCards(card('terran_armed_forces'), { ...noSlots(), Hero: 1 }, [card('barracks')])).toBeNull();
  });
});

describe('a weapon is replaced once in the Unit builder', () => {
  it('taking Scatter Missiles puts Haywire Missiles back, and one is paid for', () => {
    const goliath = unitById('goliath');
    const haywire = unit('goliath', 'small', 'Haywire Missiles').upgrades[0]!;
    const scatter = unit('goliath', 'small', 'Scatter Missiles').upgrades[0]!;
    const picked = toggleUpgrade(goliath, toggleUpgrade(goliath, [], haywire), scatter);
    expect(picked).toEqual([scatter]);
    expect(configCostOf({ defId: 'goliath', composition: 'small', upgrades: picked })).toBe(goliath.compositions[0]!.cost + goliath.weapons.find((w) => w.id === scatter)!.upgradeCost!.small);
  });
});

/**
 * The example armies of Part 12.12, at Skirmish scale (1,000 Minerals, 100 Vespene Gas). The data snapshot is the
 * authority on prices; where it differs from the printed book the difference is written down here, not corrected.
 */
describe('the example armies (Part 12.12)', () => {
  type Line = [UnitChoice, number];
  const examples: { name: string; cards: string[]; units: Line[]; bookGas: number }[] = [
    {
      name: 'Terran Starter', cards: ['terran_armed_forces', 'barracks', 'factory', 'orbital_command'], bookGas: 85,
      units: [
        [unit('marine', 'large', 'Combat Shield', 'Grenades - Frag', 'Bayonet'), 280],
        [unit('marauder', 'small', 'Laser Targeting Systems'), 170],
        [unit('marauder', 'small', 'Veteran of Tarsonis', 'Kinetic Foam'), 190],
        [unit('medic', 'small', 'Stabilizer Medpacks'), 140],
        [unit('goliath', 'small', 'Scatter Missiles'), 220],
      ],
    },
    {
      name: 'Terran Founders Edition Starter', cards: ['raynor_s_raiders', 'barracks', 'academy', 'orbital_command'], bookGas: 85,
      units: [
        [unit('marine', 'small', 'AGG-12', 'Rocket Launcher'), 210],
        [unit('raynor_s_raider__marine_'), 230],
        [unit('marauder', 'small', 'Veteran of Tarsonis', 'Kinetic Foam'), 190],
        [unit('medic', 'small', 'Stabilizer Medpacks'), 140],
        [unit('jim_raynor'), 230],
      ],
    },
    {
      name: 'Zerg Starter', cards: ['zerg_swarm', 'accelerating_creep', 'evolution_chamber', 'overseer', 'hydralisk_den'], bookGas: 90,
      units: [
        [unit('swarmling__zergling_'), 260],
        [unit('corpser__roach_', 'small', 'Burrow Ambush', 'Tunneling Claws'), 280],
        [unit('hydralisk', 'large', 'Ancillary Carapace'), 300],
        [unit('queen', 'small', 'Creep Speed'), 160],
      ],
    },
    {
      name: 'Zerg Founders Edition Starter', cards: ['kerrigan_s_swarm', 'malignant_creep', 'evolution_chamber', 'overseer', 'spawning_pool'], bookGas: 90,
      units: [[unit('zergling'), 180], [unit('kerrigan_swarm_raptor__zergling_'), 250], [unit('roach'), 170], [unit('queen'), 150], [unit('kerrigan'), 250]],
    },
    {
      name: 'Protoss Starter', cards: ['daelaam', 'forge', 'twilight_council', 'observer'], bookGas: 100,
      units: [
        [unit('zealot', 'small', 'My Life for Aiur', 'Leg Enhancements', 'We Stand as One'), 210],
        [unit('adept', 'small', 'Resonating Glaives', 'Glaive Strike'), 190],
        [unit('sentry', 'small', 'Solid-Field Projectors', 'Hallucination'), 180],
        [unit('stalker', 'small', 'Path of Shadows', 'Fury of the Nerazim'), 210],
        [unit('stalker', 'small', 'Path of Shadows', 'Fury of the Nerazim'), 210],
      ],
    },
    {
      name: 'Protoss Founders Edition Starter', cards: ['khalai', 'gateway', 'warp_prism', 'observer'], bookGas: 95,
      units: [
        [unit('zealot', 'small', 'My Life for Aiur'), 170],
        [unit('praetor_guard__zealot_'), 280],
        [unit('adept', 'small', 'Glaive Strike'), 170],
        [unit('sentry'), 130],
        [unit('artanis'), 250],
      ],
    },
  ];
  /**
   * Where the snapshot and the printed example disagree, [book, snapshot]. Jim Raynor is 250 in the data (the
   * example prints 230), and the Corpser with Burrow Ambush and Tunneling Claws comes to 270 (the example prints
   * 280). Either price is accepted here, so a corrected snapshot does not fail the test.
   */
  const differs: Record<string, [number, number]> = { jim_raynor: [230, 250], corpser__roach_: [280, 270] };

  for (const ex of examples) {
    it(`${ex.name}: every Unit costs what the book prints, and the army is legal`, () => {
      for (const [u, book] of ex.units) {
        const known = differs[u.defId];
        if (known) expect(known, `${u.defId}`).toContain(configCostOf(u));
        else expect(configCostOf(u), `${u.defId} ${u.upgrades.join(' ')}`).toBe(book);
      }
      expect(ex.units.reduce((n, [, book]) => n + book, 0)).toBe(1000);
      // Four Tactical cards cost less in the snapshot than in Part 12.11, so an example never costs more gas than printed.
      expect(vespeneSpent(ex.cards.map(card))).toBeLessThanOrEqual(ex.bookGas);
      const units = ex.units.map(([u]) => u);
      const cost = units.reduce((n, u) => n + configCostOf(u), 0);
      // Slots, tags, gas, Unique Units and the Creep card all hold. Minerals: the army is legal at its own price,
      // and at 1,000 unless the snapshot prices a Unit above the book (Terran Founders: Jim Raynor, 1,020).
      expect(validatePlayerArmy({ cards: ex.cards, units, minerals: Math.max(1000, cost) })).toEqual([]);
      expect(validatePlayerArmy({ cards: ex.cards, units, minerals: 1000 }).map((p) => p.code)).toEqual(cost > 1000 ? ['minerals'] : []);
    });
  }
});
