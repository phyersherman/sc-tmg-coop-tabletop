import { describe, expect, it } from 'vitest';
import { UNITS } from '@data/index';
import { configCostOf } from '@engine/army/force';
import { instanceCost, makeInstance } from '@engine/army/builder';

describe('upgrades cost what the Unit\'s size says', () => {
  const cases = UNITS.flatMap((d) => [...d.weapons, ...d.abilities]
    .filter((x) => x.upgradeCost)
    .flatMap((x) => (['small', 'large'] as const).filter((size) => d.compositions.some((c) => c.label === size)).map((size) => ({ d, x, size }))));

  it('has large Units whose upgrades cost more', () => {
    expect(cases.some(({ x, size }) => size === 'large' && x.upgradeCost!.large !== x.upgradeCost!.small)).toBe(true);
  });

  it('charges each upgrade at the size of the Unit, for your army and the AI\'s', () => {
    for (const { d, x, size } of cases) {
      const base = d.compositions.find((c) => c.label === size)!.cost;
      const want = base + (size === 'large' ? x.upgradeCost!.large : x.upgradeCost!.small);
      expect(configCostOf({ defId: d.id, composition: size, upgrades: [x.id] }), `${d.id} ${size} ${x.name}`).toBe(want);
      const inst = makeInstance(d, size, d.name, 1);
      inst.upgrades = [x.id];
      expect(instanceCost(d, inst), `AI ${d.id} ${size} ${x.name}`).toBe(want);
    }
  });
});
