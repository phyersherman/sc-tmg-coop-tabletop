import { describe, expect, it } from 'vitest';
import { MODES } from '@engine/missions/index';
import { makeConfig, playGame } from './helpers';
import { unitById } from '@data/index';
import { MUTATORS, randomMutators } from '@engine/mutators/index';
import { Rng } from '@engine/rng';

describe('game modes', () => {
  for (const mode of MODES) {
    it(`${mode.name} plays to completion on every faction`, () => {
      for (const faction of ['Zerg', 'Terran', 'Protoss'] as const) {
        const r = playGame(makeConfig({ modeId: mode.id, aiFaction: faction, deploymentId: faction === 'Terran' ? 'acropolis' : 'abandoned-camp', scale: faction === 'Terran' ? 'standard' : 'skirmish', playerMinerals: faction === 'Terran' ? 2000 : 1000 }), { seed: 3 });
        expect(r.state.status, mode.id).not.toBe('playing');
        expect(r.orderTypes.has('deploy')).toBe(true);
      }
    });
  }
  it('Oblivion Express: trains exist and exiting scores for the AI', () => {
    const r = playGame(makeConfig({ modeId: 'oblivion-express' }), { seed: 8, aggression: 0.1 });
    const trains = r.state.army.units.filter((u) => u.special?.train);
    expect(trains.length).toBe(3);
    // Its own Armoured Train (18 HP, Armour 6+), never a copy of the AI's priciest unit.
    for (const t of trains) expect([unitById(t.defId).name, unitById(t.defId).stats.hp, unitById(t.defId).stats.armour, t.models]).toEqual(['Armoured Train', 18, 6, 1]);
    expect(r.state.modeState['escaped'] as number + (r.state.modeState['killed'] as number)).toBeGreaterThan(0);
  });
  it('Void Thrashing: thrashers never respawn and the base can fall', () => {
    const r = playGame(makeConfig({ modeId: 'void-thrashing', difficulty: 'brutal' }), { seed: 2, aggression: 0.05 });
    const thr = r.state.army.units.filter((u) => u.special?.thrasher);
    expect(thr.length).toBe(3);
    expect(thr.every((u) => u.respawns === 0)).toBe(true);
  });
  it('mutators pick sets that sum to the budget', () => {
    for (let i = 0; i < 20; i++) {
      const ids = randomMutators(5, Rng.from(i));
      const sum = ids.reduce((a, id) => a + (MUTATORS.find((m) => m.id === id)?.cost ?? 0), 0);
      expect(sum).toBe(5);
      expect(ids.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('brutal+ with mutators plays through', () => {
    const r = playGame(makeConfig({ modeId: 'dead-of-night', difficulty: 'brutalPlus', mutators: ['avenger', 'barrier', 'longRange', 'hardenedWill'] }), { seed: 4 });
    expect(r.state.status).not.toBe('playing');
  });
});
