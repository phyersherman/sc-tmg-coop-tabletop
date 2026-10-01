import { describe, expect, it } from 'vitest';
import { deploymentById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { makeConfig } from '../engine/helpers';
import { availableActions } from '@engine/player/actions';
import { playerWeapons, validTargets } from '@engine/player/rules';
import type { GameState } from '@engine/types/game';

const dep = deploymentById('abandoned-camp');
const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };

function step(s: GameState): GameState {
  if (s.step.kind === 'AI_ORDER') return apply(s, { t: 'aiResolve' });
  if (s.step.kind === 'AI_SAVES') return apply(s, { t: 'enterSaves', saved: 0 });
  return apply(s, { t: 'continue' });
}

describe('SIDEARM in the simulation', () => {
  for (const manualSaves of [false, true]) it(`a Goliath fires a SIDEARM after its main weapon (manual saves ${manualSaves})`, () => {
    const cfg = makeConfig({ modeId: 'frontlines', playMode: 'video' });
    cfg.options = { ...cfg.options, manualSaves };
    cfg.playerUnits = [makePlayerUnit('g1', 'goliath', 'small', [], 'Goliath', 100)];
    let s = createGame(cfg, dep, flat);
    for (let i = 0; i < 80 && !(s.phase === 'assault' && s.step.kind === 'PLAYERS_TURN'); i++) {
      if (s.step.kind === 'PLAYERS_TURN' && s.phase === 'movement') {
        const g = s.playerUnits[0]!;
        s = g.location === 'reserves' ? apply(s, { t: 'playerDeploy', unitId: 'g1', point: { x: 18, y: 3 } }) : apply(s, { t: 'playersPass' });
        continue;
      }
      s = step(s);
    }
    expect(s.phase).toBe('assault');
    // An enemy in reach of both the Autocannon and the machine gun.
    const target = s.army.units.find((u) => u.location === 'table') ?? s.army.units[0]!;
    target.location = 'table';
    // Standing in the open, not BURROWED (a Burrowed unit is HIDDEN from 12" away).
    target.statuses = [];
    target.special = {};
    s.sense!.ai[target.id] = [{ x: 18, y: 8 }];
    target.est = { x: 18, y: 8 };
    s = apply(s, { t: 'playerAttack', unitId: 'g1', weaponId: 'goliath:autocannon:3', targetId: target.id });
    for (let i = 0; i < 10 && s.step.kind !== 'PLAYERS_TURN'; i++) s = step(s);
    expect(s.activeUnitId).toBe('g1');
    // The command card offers the machine gun (a SIDEARM in reach) but not the Autocannon again.
    const acts = availableActions(s, s.playerUnits[0]!);
    expect(acts.find((a) => a.id === 'weapon:goliath:underbelly-machine-gun:4')?.enabled).toBe(true);
    expect(acts.find((a) => a.id === 'weapon:goliath:autocannon:3')?.enabled).toBe(false);
  });
});

describe('coherency in the simulation', () => {
  it('a squad that moves stays active so you can adjust its models', () => {
    const cfg = makeConfig({ modeId: 'frontlines', playMode: 'video' });
    cfg.playerUnits = [makePlayerUnit('m1', 'marine', 'large', [], 'Marines', 100)];
    let s = createGame(cfg, dep, flat);
    for (let i = 0; i < 40 && s.step.kind !== 'PLAYERS_TURN'; i++) s = step(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'm1', point: { x: 18, y: 3 } });
    expect(s.activeUnitId).toBe('m1');
    expect(s.playerUnits[0]!.mayAdjust).toBe(true);
  });
});

describe('casualties leave the table', () => {
  it('range is never measured to a dead model: a sidearm the target was out of reach of stays out of reach', () => {
    const cfg = makeConfig({ modeId: 'frontlines', playMode: 'video' });
    cfg.playerUnits = [makePlayerUnit('g1', 'goliath', 'small', [], 'Goliath', 100)];
    let s = createGame(cfg, dep, flat);
    for (let i = 0; i < 80 && !(s.phase === 'assault' && s.step.kind === 'PLAYERS_TURN'); i++) {
      if (s.step.kind === 'PLAYERS_TURN' && s.phase === 'movement') { s = s.playerUnits[0]!.location === 'reserves' ? apply(s, { t: 'playerDeploy', unitId: 'g1', point: { x: 18, y: 3 } }) : apply(s, { t: 'playersPass' }); continue; }
      s = step(s);
    }
    const target = s.army.units.find((u) => u.location === 'table') ?? s.army.units[0]!;
    target.location = 'table';
    // Standing in the open, not BURROWED (a Burrowed unit is HIDDEN from 12" away).
    target.statuses = [];
    target.special = {};
    const gp = s.sense!.players['g1']![0]!;
    // A pack of Zerglings 12" south of the Goliath, a couple of them nearer: the nearest are within the machine
    // gun's 8" only once the pack is measured base to base... except the ones that die first.
    s.sense!.ai[target.id] = Array.from({ length: target.models }, (_, k) => ({ x: gp.x + (k % 4) * 0.7, y: gp.y + 12 + Math.floor(k / 4) * 0.7 }));
    target.est = { x: gp.x, y: gp.y + 12 };
    const gun = playerWeapons(s, s.playerUnits[0]!).find((w) => w.id.includes('underbelly'))!;
    expect(validTargets(s, s.playerUnits[0]!, gun)).toEqual([]);
    const before = target.models;
    s = apply(s, { t: 'playerAttack', unitId: 'g1', weaponId: 'goliath:autocannon:3', targetId: target.id, rolls: Array(9).fill(6) });
    const t2 = s.army.units.find((u) => u.id === target.id)!;
    expect(t2.models).toBeLessThan(before);
    // As many positions as models, and the machine gun still cannot reach.
    expect(s.sense!.ai[target.id]!.length).toBe(t2.models);
    expect(validTargets(s, s.playerUnits[0]!, gun)).toEqual([]);
  });
});
