import { describe, expect, it } from 'vitest';
import { deploymentById, UNITS } from '@data/index';
import { createGame } from '@engine/director/reducer';
import { mapLayout, remixId } from '@engine/terrain/remix';
import { rangedOrder } from '@engine/ai/decide';
import { Rng } from '@engine/rng';
import { makeConfig } from './helpers';

const marine = UNITS.find((u) => u.id === 'marine')!;
const rocket = marine.weapons.find((w) => /rocket/i.test(w.name))!.id;
const agg = marine.weapons.find((w) => /agg-12/i.test(w.name))!.id;

function nineMarines(upgrades: string[]) {
  const cfg = makeConfig({ aiFaction: 'Terran' });
  const dep = deploymentById(cfg.deploymentId);
  const s = createGame(cfg, dep, mapLayout(remixId(dep.scale, cfg.terrainSeed), dep));
  const u = s.army.units.find((x) => x.defId === 'marine')!;
  u.models = 9;
  u.upgrades = upgrades;
  return { s, u };
}

describe('AI SPECIALIST weapons', () => {
  it('a Rocket Launcher is fired by one Marine, who fires its rifle as well (a SIDEARM carried alongside it)', () => {
    const { s, u } = nineMarines([rocket]);
    const o = rangedOrder(s, u, Rng.from(1), 'rangedLine', false)!;
    const byName = Object.fromEntries(o.batches.map((b) => [b.weapon, b]));
    expect(byName['Rocket Launcher']!.models).toBe(1);
    expect(byName['Rocket Launcher']!.dice).toBe(4);
    expect(byName['C-14 rifle']!.models).toBe(9);
  });

  it('an AGG-12 fires alongside the rifles from its one model', () => {
    const { s, u } = nineMarines([agg, rocket]);
    const o = rangedOrder(s, u, Rng.from(1), 'rangedLine', false)!;
    const models = Object.fromEntries(o.batches.map((b) => [b.weapon, b.models]));
    // The AGG-12 replaces one Marine's rifle; the Rocket Launcher does not (Part 9.1.7).
    expect(models).toEqual({ 'C-14 rifle': 8, 'AGG-12': 1, 'Rocket Launcher': 1 });
  });

  it('without upgrades all nine fire the rifle', () => {
    const { s, u } = nineMarines([]);
    const o = rangedOrder(s, u, Rng.from(1), 'rangedLine', false)!;
    expect(o.batches.map((b) => [b.weapon, b.models])).toEqual([['C-14 rifle', 9]]);
  });
});
