import { describe, expect, it } from 'vitest';
import { CARDS, UNITS, unitById } from '@data/index';
import { availableWeapons, toggleUpgrade } from '@engine/units/weapons';
import { buildAiArmy } from '@engine/army/builder';

const goliath = unitById('goliath');
const haywire = goliath.weapons.find((w) => w.name === 'Haywire Missiles')!;
const scatter = goliath.weapons.find((w) => w.name === 'Scatter Missiles')!;

describe('a weapon is replaced once (Part 5.1, ↑ FOR)', () => {
  it('a Goliath carries Haywire or Scatter Missiles, never both', () => {
    expect(haywire.replaces).toBe('Hellfire Missiles');
    expect(scatter.replaces).toBe('Hellfire Missiles');
    // Picking the second drops the first in the builder.
    const picked = toggleUpgrade(goliath, toggleUpgrade(goliath, [], haywire.id), scatter.id);
    expect(picked).toEqual([scatter.id]);
    // And an army list that somehow names both fields only the first, with the Hellfire gone.
    const names = availableWeapons(goliath, [haywire.id, scatter.id], 'Assault').map((w) => w.name);
    expect(names).toContain('Haywire Missiles');
    expect(names).not.toContain('Scatter Missiles');
    expect(names).not.toContain('Hellfire Missiles');
  });

  it('unrelated upgrades stack as before', () => {
    const ares = goliath.abilities.find((a) => a.name === 'Ares-Class Targeting System')!;
    expect(toggleUpgrade(goliath, [haywire.id], ares.id)).toEqual([haywire.id, ares.id]);
    expect(toggleUpgrade(goliath, [haywire.id, ares.id], haywire.id)).toEqual([ares.id]);
  });

  it('the AI never buys two replacements for one weapon', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const army = buildAiArmy({ faction: 'Terran', budget: 1500, ownership: { goliath: 4, marine: 18, medic: 3, marauder: 4 }, heroAllowed: false, seed, units: UNITS, cards: CARDS });
      for (const u of army.units) {
        const def = unitById(u.defId);
        const slots = def.weapons.filter((w) => u.upgrades.includes(w.id) && w.replaces).map((w) => w.replaces!.toLowerCase());
        expect(new Set(slots).size, `${u.label} seed ${seed}`).toBe(slots.length);
      }
    }
  });
});

describe('the AI buys upgrades against the players it faces', () => {
  const weapons = (army: ReturnType<typeof buildAiArmy>) => army.units.flatMap((u) => u.upgrades);
  it('never buys an upgrade that only works against a kind of unit the players do not field', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const army = buildAiArmy({ faction: 'Protoss', budget: 2000, ownership: { zealot: 12, stalker: 4, adept: 8, immortal: 2, sentry: 3 }, heroAllowed: false, seed, units: UNITS, cards: CARDS, opponents: [{ defId: 'zergling', models: 24 }] });
      for (const u of army.units) {
        const def = unitById(u.defId);
        for (const id of u.upgrades) {
          const a = def.abilities.find((x) => x.id === id);
          if (a && /\bArmoured\b/.test(a.text) && /Enemy|target/i.test(a.text)) throw new Error(`${u.label} bought ${a.name} against Zerglings`);
        }
      }
      expect(weapons(army).length).toBeGreaterThanOrEqual(0);
    }
  });
  it('takes the models the players field off what the AI may use', () => {
    const army = buildAiArmy({ faction: 'Terran', budget: 3000, ownership: { marine: 18 }, reserved: { marine: 18 }, heroAllowed: false, seed: 1, units: UNITS, cards: CARDS });
    expect(army.units.length).toBe(0);
  });
});

describe('a mixed AI army', () => {
  it('draws on any race it may use, with a Faction card for each race it fields', () => {
    let mixed = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const army = buildAiArmy({ faction: 'Zerg', factions: ['Terran', 'Zerg', 'Protoss'], budget: 2000, ownership: { marine: 18, marauder: 4, zergling: 24, roach: 6, zealot: 8, stalker: 4 }, heroAllowed: false, seed, units: UNITS, cards: CARDS });
      const races = new Set(army.units.map((u) => unitById(u.defId).faction));
      if (races.size > 1) mixed++;
      for (const r of races) expect(army.factionCards?.[r], `seed ${seed} ${r}`).toBeTruthy();
      expect(races.has(army.faction)).toBe(true);
    }
    expect(mixed).toBeGreaterThan(0);
  });
});
