import { describe, expect, it } from 'vitest';
import { deploymentById, unitById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { buildAiArmy } from '@engine/army/builder';
import { emptyCollection, everything, modelUnits, ownedModels, physicalModelId, unitsFromModel } from '@engine/army/collection';
import { visibleAiUnits } from '@engine/director/selectors';
import { UNITS, CARDS } from '@data/index';
import { makeConfig } from '../engine/helpers';

const dep = deploymentById('abandoned-camp');
const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };

describe('collection', () => {
  it('counts miniatures, not unit entries: variants share the models they are built from', () => {
    // Raynor's Raiders are Marines, Swarmlings are Zerglings — one pool each.
    expect(physicalModelId('raynor_s_raider__marine_')).toBe('marine');
    expect(physicalModelId('swarmling__zergling_')).toBe('zergling');
    expect(physicalModelId('kerrigan_swarm_raptor__zergling_')).toBe('zergling');
    expect(physicalModelId('marine')).toBe('marine');
    // Only the miniatures are listed, never the variants.
    const ids = modelUnits().map((u) => u.id);
    expect(ids).toContain('marine');
    expect(ids).not.toContain('raynor_s_raider__marine_');
    expect(ids).not.toContain('vile__roach_');
    expect(unitsFromModel('zergling').map((u) => u.id).sort()).toEqual(['kerrigan_swarm_raptor__zergling_', 'raptor__zergling_', 'swarmling__zergling_', 'zergling']);
  });

  it('owning a model lets you field every unit built from it', () => {
    const c = { ...emptyCollection(), models: { marine: 9 } };
    const owned = ownedModels(c);
    expect(owned['marine']).toBe(9);
    expect(owned["raynor_s_raider__marine_"]).toBe(9);
    expect(owned['medic']).toBeUndefined();
  });

  it('a count can go back to zero', () => {
    const c = { ...emptyCollection(), models: { marine: 9 } };
    expect(ownedModels({ ...c, models: { marine: 0 } })).toEqual({});
  });

  it('"I own everything" covers every miniature', () => {
    const all = everything();
    for (const u of modelUnits()) expect(all.models[u.id], u.id).toBeGreaterThan(0);
    // Enough models for the biggest squad of any unit built from it.
    expect(all.models['zergling']).toBeGreaterThanOrEqual(18);
  });

  it('the AI never fields a model that is not in the collection', () => {
    const owned = ownedModels({ ...emptyCollection(), models: { zergling: 18, roach: 3, hydralisk: 4, queen: 1 } });
    const army = buildAiArmy({ faction: 'Zerg', budget: 2000, ownership: owned, heroAllowed: true, seed: 5, units: UNITS, cards: CARDS });
    expect(army.units.length).toBeGreaterThan(0);
    for (const u of army.units) expect(owned[u.defId] ?? 0, u.defId).toBeGreaterThan(0);
    // No Kerrigan model owned, so the hero can never appear.
    expect(army.units.some((u) => u.defId === 'kerrigan')).toBe(false);
  });
});

describe('hidden enemy force', () => {
  function game(hide: boolean) {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.options = { ...cfg.options, hideAiRoster: hide };
    return createGame(cfg, dep, flat);
  }

  it('lists only AI units that have shown themselves when the roster is hidden', () => {
    const s = game(true);
    expect(s.army.units.length).toBeGreaterThan(0);
    expect(s.army.units.every((u) => u.location === 'reserves')).toBe(true);
    expect(visibleAiUnits(s)).toHaveLength(0);
    // Once a unit is on the table it is known; a destroyed one stays known.
    s.army.units[0]!.location = 'table';
    s.army.units[1]!.location = 'destroyed';
    expect(visibleAiUnits(s).map((u) => u.id)).toEqual([s.army.units[0]!.id, s.army.units[1]!.id]);
  });

  it('reveals everything once the game is over, and always in a normal skirmish', () => {
    const open = game(false);
    expect(visibleAiUnits(open)).toHaveLength(open.army.units.length);
    const s = game(true);
    s.step = { kind: 'GAME_OVER', lines: [], result: 'won' };
    expect(visibleAiUnits(s)).toHaveLength(s.army.units.length);
  });

  it('a whole game can be played with the roster hidden', () => {
    let s = game(true);
    for (let i = 0; i < 40 && s.step.kind !== 'PLAYERS_TURN'; i++) {
      if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
      else if (s.step.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
      else s = apply(s, { t: 'continue' });
    }
    expect(s.step.kind).toBe('PLAYERS_TURN');
    // The AI deployed at least one unit, and exactly the deployed ones are visible.
    const onTable = s.army.units.filter((u) => u.location === 'table');
    expect(visibleAiUnits(s).length).toBe(onTable.length + s.army.units.filter((u) => u.location === 'destroyed' || u.location === 'exited').length);
  });
});
