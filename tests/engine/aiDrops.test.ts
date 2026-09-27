import { describe, expect, it } from 'vitest';
import { createGame, apply } from '@engine/director/reducer';
import { makeConfig } from './helpers';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { deploymentById } from '@data/index';
import { scheduleRespawns } from '@engine/respawn';
import type { GameState } from '@engine/types/game';

const dep = deploymentById('abandoned-camp');
const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };

/** A tabletop game where the collection fielded only part of the AI's budget. */
function shortGame(dropsAnywhere: boolean): GameState {
  const cfg = makeConfig({ modeId: 'frontlines', aiFaction: 'Zerg', playMode: 'tabletop', difficulty: 'normal', players: 2, playerMinerals: 1000 });
  cfg.army = { ...cfg.army, budget: 2000 };
  cfg.options = { ...cfg.options, aiDropsAnywhere: dropsAnywhere };
  cfg.playerUnits = [makePlayerUnit('m1', 'marine', 'small', [], 'Marines', 100)];
  const s = createGame(cfg, dep, flat);
  // Your Marines stand mid-table, known to the app.
  s.sense = { at: 0, calibrated: true, manual: true, ai: {}, players: { m1: [{ x: 18, y: 14 }, { x: 18.9, y: 14 }, { x: 18, y: 14.9 }] }, terrain: {}, unknown: [] };
  s.playerUnits[0]!.location = 'table';
  return s;
}

/** Play until the AI's first deploy order is on the table (you pass whenever it is your turn). */
function firstDeploy(s: GameState) {
  for (let i = 0; i < 60 && !(s.step.kind === 'AI_ORDER' && s.step.order.type === 'deploy'); i++) {
    if (s.step.kind === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
    else if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
    else if (s.step.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
    else s = apply(s, { t: 'continue' });
  }
  expect(s.step.kind).toBe('AI_ORDER');
  return s.step.kind === 'AI_ORDER' ? s.step.order : null!;
}

describe('an AI short of models for the players\' armies', () => {
  it('sets its units down away from its edge, near where they are heading and clear of yours', () => {
    const s = shortGame(true);
    const order = firstDeploy(s);
    expect(order.dropAt).toBeTruthy();
    const p = order.dropAt!;
    // Not at the AI's own edge (south), and never within 6" of your models or in your Zone of Influence.
    expect(p.y).toBeLessThan(dep.table.height - 6);
    expect(p.y).toBeGreaterThan(6);
    expect(Math.hypot(p.x - 18, p.y - 14)).toBeGreaterThan(6);
    expect(order.lines.join(' ')).toMatch(/anywhere on the table/);
  });

  it('keeps to its entry edge when the option is off', () => {
    const order = firstDeploy(shortGame(false));
    expect(order.dropAt).toBeUndefined();
    expect(order.lines.join(' ')).toMatch(/Enter from/);
  });

  it('spends the minerals it could not field on bringing destroyed units back', () => {
    const s = shortGame(true);
    // Normal difficulty alone brings one unit back per game; the shortfall pool pays for more.
    expect(s.respawnBudget).toBe(2000 - s.config.army.spent);
    const units = s.army.units.slice(0, 3);
    for (const u of units) { u.location = 'destroyed'; u.destroyedRound = s.round; }
    scheduleRespawns(s);
    const back = s.respawnQueue.map((q) => q.unitId);
    expect(units.every((u) => back.includes(u.id))).toBe(true);

    const plain = shortGame(false);
    for (const u of plain.army.units.slice(0, 3)) { u.location = 'destroyed'; u.destroyedRound = plain.round; }
    scheduleRespawns(plain);
    expect(plain.respawnQueue.length).toBeLessThan(3);
  });
});
