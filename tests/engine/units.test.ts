import { describe, expect, it } from 'vitest';
import { unitById, UNITS } from '@data/index';
import { availableSupply, canDeploy, currentSupply, poolForRound } from '@engine/units/supply';
import { applyDamage, heal, initialTarget, respawnModels } from '@engine/units/damage';
import { availableWeapons, bestWeapon, diceInstruction, hitsFor, rollInstruction } from '@engine/units/weapons';
import { speedFor } from '@engine/units/speed';
import { Rng } from '@engine/rng';

describe('supply', () => {
  const marine = unitById('marine');
  const hydra = unitById('hydralisk');
  it('marine brackets', () => {
    expect(currentSupply(marine, 9)).toBe(2);
    expect(currentSupply(marine, 6)).toBe(1);
    expect(currentSupply(marine, 4)).toBe(1);
    expect(currentSupply(marine, 3)).toBe(0);
    expect(currentSupply(marine, 0)).toBe(0);
  });
  it('hydralisk brackets', () => {
    expect(currentSupply(hydra, 4)).toBe(3);
    expect(currentSupply(hydra, 2)).toBe(2);
    expect(currentSupply(hydra, 1)).toBe(1);
  });
  it('pool math', () => {
    expect(poolForRound(6, 2, 1, 5)).toBe(6);
    expect(poolForRound(6, 2, 3, 5)).toBe(10);
    expect(poolForRound(6, 2, 5, 5)).toBe(Infinity);
    expect(availableSupply(10, 7)).toBe(3);
    expect(canDeploy(2, 3)).toBe(true);
    expect(canDeploy(4, 3)).toBe(false);
    expect(canDeploy(0, 0)).toBe(true);
  });
});

describe('damage', () => {
  const marine = unitById('marine');
  const zealot = unitById('zealot');
  it('removes models and keeps a marker', () => {
    const r = applyDamage(marine, initialTarget(marine, 9), 5);
    expect(r.models).toBe(7);
    expect(r.damageMarker).toBe(1);
    expect(r.removed).toBe(2);
    expect(r.supplyBefore).toBe(2);
    expect(r.supplyAfter).toBe(2);
    const r2 = applyDamage(marine, r, 1);
    expect(r2.models).toBe(6);
    expect(r2.supplyAfter).toBe(1);
  });
  it('destroys and discards remainder', () => {
    const r = applyDamage(marine, initialTarget(marine, 2), 9);
    expect(r.models).toBe(0);
    expect(r.destroyed).toBe(true);
    expect(r.damageMarker).toBe(0);
  });
  it('caps removals by visible models', () => {
    const r = applyDamage(marine, initialTarget(marine, 6), 10, { maxRemovable: 2 });
    expect(r.removed).toBe(2);
    expect(r.models).toBe(4);
    expect(r.damageMarker).toBe(0);
  });
  it('shields protect the first model only', () => {
    const t = initialTarget(zealot, 3); // hp 4 + shield 3 = 7 on first model
    const r = applyDamage(zealot, t, 6);
    expect(r.models).toBe(3);
    expect(r.damageMarker).toBe(6);
    const r2 = applyDamage(zealot, r, 1);
    expect(r2.models).toBe(2);
    expect(r2.shieldsLeft).toBe(0);
    expect(r2.damageMarker).toBe(0);
    const r3 = applyDamage(zealot, r2, 4);
    expect(r3.models).toBe(1);
  });
  it('heal and respawn', () => {
    const t = heal({ models: 3, damageMarker: 2, shieldsLeft: 0 }, 5);
    expect(t.damageMarker).toBe(0);
    const z = unitById('zergling');
    const r = respawnModels(z, { models: 10, damageMarker: 0, shieldsLeft: 0 }, 3, 18);
    expect(r.models).toBe(12); // cannot cross into the 13-18 bracket
  });
});

describe('weapons', () => {
  it('lists available weapons with upgrades', () => {
    const marine = unitById('marine');
    const base = availableWeapons(marine, [], 'Combat').map((w) => w.name);
    expect(base).toEqual(['Strike']);
    const bayonet = marine.weapons.find((w) => w.name === 'Bayonet')!;
    const up = availableWeapons(marine, [bayonet.id], 'Combat').map((w) => w.name);
    expect(up).toEqual(['Bayonet']);
    expect(availableWeapons(marine, [], 'Assault').map((w) => w.name)).toEqual(['C-14 rifle']);
  });
  it('builds and rolls dice instructions deterministically', () => {
    const hydra = unitById('hydralisk');
    const w = bestWeapon(hydra, [], 'Assault')!;
    expect(w.name).toBe('Needle Spines');
    const instr = diceInstruction(w, 4);
    expect(instr.dice).toBe(12);
    expect(instr.surge?.die).toBe('D3+1');
    const a = rollInstruction(Rng.from(42), instr);
    const b = rollInstruction(Rng.from(42), instr);
    expect(a.rolls).toEqual(b.rolls);
    expect(a.rolls?.length).toBe(12);
    expect(a.surgeRoll).toBeGreaterThanOrEqual(2);
    const h = hitsFor(a, 2);
    expect(h.dice).toBe(6);
    expect(h.hits).toBe(a.rolls!.slice(0, 6).filter((r) => r >= 3).length);
  });
  it('every non-summoned unit has a combat weapon', () => {
    for (const u of UNITS.filter((u) => !u.summoned)) {
      expect(bestWeapon(u, [], 'Combat'), u.name).toBeDefined();
    }
  });
  it('speed split values', () => {
    const marine = unitById('marine');
    // A unit of several models moves at the lower value; a single model at the higher one.
    expect(speedFor(marine, 6)).toBe(4);
    expect(speedFor(marine, 1)).toBe(7);
    expect(speedFor(unitById('pylon'), 1)).toBe(0);
  });
});
