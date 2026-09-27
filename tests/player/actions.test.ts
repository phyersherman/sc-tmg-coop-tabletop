import { describe, expect, it } from 'vitest';
import { deploymentById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { availableActions, unitsWithActions } from '@engine/player/actions';
import { checkModelAdjust, edgeDistance, ENGAGEMENT_IN, placeUnit, shapeAt, unitShapes } from '@engine/sense/placement';
import { makeConfig } from '../engine/helpers';

const dep = deploymentById('abandoned-camp');
const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };

describe('available actions', () => {
  it('lists what a unit can do with a legality reason for everything it cannot', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('r1', 'roach', 'small', [], 'Roaches', 300), makePlayerUnit('m1', 'marine', 'small', [], 'Marines', 301)];
    let s = createGame(cfg, dep, flat);
    for (const p of s.playerUnits) p.location = 'table';
    placeUnit(s, 'players', 'r1', { x: 10, y: 5 });
    placeUnit(s, 'players', 'm1', { x: 25, y: 5 });
    s.phase = 'assault';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s = apply(s, { t: 'setOptions', options: {} } as never);
    const roach = s.playerUnits[0]!;
    // Nothing in range: weapons and Charge are disabled with a reason, Hold is fine.
    const acts = availableActions(s, roach);
    expect(acts.find((a) => a.id === 'hold')?.enabled).toBe(true);
    for (const a of acts.filter((x) => !x.enabled)) expect(a.reason).toBeTruthy();
    expect(acts.find((a) => a.id === 'charge')?.reason).toMatch(/charge reach/);
    // Burrowed: shooting and charging say why.
    roach.statuses = ['Burrowed'];
    const b = availableActions(s, roach);
    expect(b.find((a) => a.id.startsWith('weapon:'))?.reason).toMatch(/Burrowed/);
    // Another unit still active blocks this one.
    s.activeUnitId = 'm1';
    expect(availableActions(s, roach).find((a) => a.id === 'hold')?.reason).toMatch(/Finish Marines/);
    s.activeUnitId = null;
    roach.activated.assault = true;
    expect(unitsWithActions(s).map((p) => p.id)).toEqual(['m1']);
  });
});

describe('presentation events', () => {
  it('emits one event per resolved charge and attack, with increasing ids', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('z1', 'zealot', 'small', [], 'Zealots', 310)];
    let s = createGame(cfg, dep, flat);
    s.playerUnits[0]!.location = 'table';
    placeUnit(s, 'players', 'z1', { x: 18, y: 4 });
    const ai = s.army.units[0]!;
    ai.location = 'table';
    placeUnit(s, 'ai', ai.id, { x: 18, y: 12 });
    s.phase = 'assault';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    const before = s.events?.length ?? 0;
    s = apply(s, { t: 'playerCharge', unitId: 'z1', targetId: ai.id, roll: 6, impactRolls: [6, 6, 6, 6, 6, 6] });
    const fresh = (s.events ?? []).slice(before);
    expect(fresh.filter((e) => e.kind === 'charge')).toHaveLength(1);
    expect(fresh.filter((e) => e.kind === 'attack')).toHaveLength(1);
    const ids = (s.events ?? []).map((e) => e.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('a charge is stamped with the round it happened in', () => {
    // The game screen holds the AI until you acknowledge a charge, keyed by this round. Before it was stamped,
    // the key was built from the current round, so the same charge became news again every round after.
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('z1', 'zealot', 'small', [], 'Zealots', 310)];
    let s = createGame(cfg, dep, flat);
    s.playerUnits[0]!.location = 'table';
    placeUnit(s, 'players', 'z1', { x: 18, y: 4 });
    const ai = s.army.units[0]!;
    ai.location = 'table';
    placeUnit(s, 'ai', ai.id, { x: 18, y: 12 });
    s.phase = 'assault';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s = apply(s, { t: 'playerCharge', unitId: 'z1', targetId: ai.id, roll: 1 });
    expect(s.lastCharge?.round).toBe(s.round);
    const stamped = s.lastCharge!.round;
    // Rounds go by; the charge keeps the round it was rolled in, so an acknowledgement still counts.
    s = { ...s, round: s.round + 2 };
    expect(s.lastCharge!.round).toBe(stamped);
  });

  it('coherency tidying never walks a model into engagement range', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('m1', 'marine', 'small', [], 'Marines', 320)];
    let s = createGame(cfg, dep, flat);
    s.playerUnits[0]!.location = 'table';
    placeUnit(s, 'players', 'm1', { x: 18, y: 10 });
    const ai = s.army.units[0]!;
    ai.location = 'table';
    placeUnit(s, 'ai', ai.id, { x: 18, y: 12.2 });
    s.phase = 'movement';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s.activeUnitId = 'm1';
    s.playerUnits[0]!.mayAdjust = true;
    // Every spot a model could be dragged to: none of the ones that reach an enemy may be allowed, and the
    // ordinary ones behind the leader still must be.
    const lead = s.sense!.players['m1']![0]!;
    const enemies = unitShapes(s, 'ai', ai.id);
    const mine = shapeAt('marine', { x: 0, y: 0 });
    let refusedNear = 0;
    let allowedClear = 0;
    for (let dx = -3; dx <= 3; dx += 0.25) {
      for (let dy = -3; dy <= 3; dy += 0.25) {
        const pt = { x: lead.x + dx, y: lead.y + dy };
        const reason = checkModelAdjust(s, 'players', 'm1', 1, pt);
        const gap = Math.min(...enemies.map((e) => edgeDistance({ ...mine, x: pt.x, y: pt.y }, e)));
        if (gap <= ENGAGEMENT_IN && gap > 0.05) { expect(reason).not.toBeNull(); if (/Engagement Range/.test(reason!)) refusedNear++; }
        if (reason === null) { expect(gap).toBeGreaterThan(ENGAGEMENT_IN); allowedClear++; }
      }
    }
    expect(refusedNear).toBeGreaterThan(0);
    expect(allowedClear).toBeGreaterThan(0);
  });
});
