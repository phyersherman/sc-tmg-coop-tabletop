import { describe, expect, it } from 'vitest';
import { deploymentById, unitById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { playerWeapons, validTargets, checkMove } from '@engine/player/rules';
import { unitAbilities, weaponWithEffects, blastCover, passiveTough, SELF_REACTIONS } from '@engine/abilities/index';
import { makeConfig } from '../engine/helpers';
import { decideAi, planted, usableNow } from '@engine/ai/decide';
import type { MissionCtx } from '@engine/types/mission';
import { modeById } from '@engine/missions/index';
import { aiUnitSize } from '@engine/sense/playerUnits';
import { Rng } from '@engine/rng';
import type { GameState } from '@engine/types/game';

const dep = deploymentById('abandoned-camp');
const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };

function toPlayersTurn(s: GameState): GameState {
  for (let i = 0; i < 60 && s.step.kind !== 'PLAYERS_TURN'; i++) {
    if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
    else if (s.step.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
    else s = apply(s, { t: 'continue' });
  }
  return s;
}

/** The ids of a unit's named upgrades (abilities and weapons you pay minerals for). */
function upgradeIds(defId: string, names: string[]): string[] {
  const def = unitById(defId);
  return names.map((n) => [...def.abilities, ...def.weapons].find((x) => x.name === n)!.id);
}

/** One of your units deployed, with an AI unit `gap` inches in front of it and plenty of cards to pay with. */
function field(defId: string, gap: number, cards: string[], upgrades: string[] = []): { s: GameState; aiId: string } {
  const cfg = makeConfig({ modeId: 'frontlines' });
  cfg.playerUnits = [makePlayerUnit('p1', defId, 'small', upgradeIds(defId, upgrades), 'Unit', 300)];
  cfg.playerCards = cards;
  let s = createGame(cfg, dep, flat);
  s = toPlayersTurn(s);
  s = apply(s, { t: 'playerDeploy', unitId: 'p1', point: { x: 18, y: 4 } });
  s = toPlayersTurn(s);
  const ai = s.army.units[0]!;
  ai.location = 'table';
  s.sense!.ai[ai.id] = [{ x: 18, y: 4 + gap }];
  s.step = { kind: 'PLAYERS_TURN', lines: [] };
  s.activeUnitId = null;
  s.playerUnits[0]!.activated = { movement: false, assault: false, combat: false };
  return { s, aiId: ai.id };
}

describe('the Immortal', () => {
  it('is in the data with its shields, disruptors and reactions', () => {
    const def = unitById('immortal');
    expect(def.faction).toBe('Protoss');
    expect(def.stats.shields).toBe(6);
    expect(def.weapons.map((w) => w.name)).toContain('Left Photon Disruptor');
    expect(def.abilities.map((a) => a.name)).toEqual(expect.arrayContaining(['Shield Overcharge', 'Improved Barrier', 'Fury Unyielding', 'For the Ancients']));
  });

  it('For the Ancients sharpens a long shot, and Fury Unyielding a fight over a marker', () => {
    const { s, aiId } = field('immortal', 12, ['daelaam', 'forge'], ['For the Ancients', 'Fury Unyielding']);
    const pu = s.playerUnits[0]!;
    const w = playerWeapons(s, pu).find((x) => x.name === 'Left Photon Disruptor')!;
    const target = s.army.units.find((u) => u.id === aiId)!;
    const far = weaponWithEffects(pu, w, target, 12, s);
    expect(far.weapon.keywords.find((k) => k.k === 'PRECISION')?.v).toBe(1);
    const near = weaponWithEffects(pu, w, target, 6, s);
    expect(near.weapon.keywords.some((k) => k.k === 'PRECISION')).toBe(false);
    // Both of them standing on the same objective.
    const m = s.markers[0]!;
    s.sense!.players['p1'] = [{ x: m.x, y: m.y + 1 }];
    s.sense!.ai[aiId] = [{ x: m.x, y: m.y - 1 }];
    const onMarker = weaponWithEffects(pu, w, target, 2, s);
    expect(onMarker.weapon.keywords.find((k) => k.k === 'CRITICAL HIT')?.v).toBe(1);
  });

  it('keeps its defensive reactions while it is Shielded, and loses them when the shield is gone', () => {
    const { s } = field('immortal', 12, ['daelaam']);
    const pu = s.playerUnits[0]!;
    const shield = SELF_REACTIONS.find((r) => r.name === 'Shield Overcharge')!;
    const barrier = SELF_REACTIONS.find((r) => r.name === 'Improved Barrier')!;
    expect(shield.ok(s, pu)).toBe(true);
    expect(barrier.capDmg).toBe(1);
    pu.shieldsLeft = 0;
    expect(shield.ok(s, pu)).toBe(false);
    expect(barrier.ok(s, pu)).toBe(false);
  });
});

describe('the Siege Tank', () => {
  it('digs in: it cannot move, counts as Size 3, and swaps to the Shock Cannon', () => {
    const { s } = field('siege_tank', 12, ['terran_armed_forces', 'barracks', 'factory'], ['Mode Transformation']);
    const pu = s.playerUnits[0]!;
    expect(playerWeapons(s, pu).map((w) => w.name)).toEqual(['Twin Cannon']);
    expect(unitAbilities(s, pu).find((a) => a.ability.name === 'Mode Transformation')?.ok).toBe(true);
    const after = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Mode Transformation' });
    const tank = after.playerUnits[0]!;
    expect(tank.statuses).toContain('Siege Mode');
    expect(playerWeapons(after, tank).map((w) => w.name)).toEqual(['Shock Cannon']);
    expect(checkMove(after, tank, { x: 18, y: 8 }, 'move').ok).toBe(false);
    // Heavy Plating is the price of digging in.
    expect(passiveTough(s.playerUnits[0]!)).toBe(1);
    expect(passiveTough(tank)).toBe(0);
  });

  it('the Shock Cannon rolls the template it covers, and its Surge is that same number', () => {
    const { s, aiId } = field('siege_tank', 12, ['terran_armed_forces', 'barracks', 'factory'], ['Mode Transformation']);
    const sieged = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Mode Transformation' });
    const pu = sieged.playerUnits[0]!;
    const target = sieged.army.units.find((u) => u.id === aiId)!;
    // Three of the target's models are close enough together to be under the template.
    sieged.sense!.ai[aiId] = [{ x: 18, y: 16 }, { x: 18.9, y: 16 }, { x: 18, y: 16.9 }, { x: 18, y: 24 }];
    expect(blastCover(sieged, target, { x: 18, y: 4 })).toBe(3);
    const w = playerWeapons(sieged, pu).find((x) => x.name === 'Shock Cannon')!;
    const mod = weaponWithEffects(pu, w, target, 12, sieged);
    expect(mod.blast).toBe(3);
    expect(mod.weapon.roa).toBe(w.roa + 3);
    expect(mod.weapon.surgeDie).toBe('BT');
  });

  it('Point Blank keeps the dug-in gun off what it is fighting', () => {
    const { s, aiId } = field('siege_tank', 2, ['terran_armed_forces', 'barracks', 'factory'], ['Mode Transformation']);
    const sieged = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Mode Transformation' });
    const pu = sieged.playerUnits[0]!;
    pu.engaged = true;
    pu.engagedWith = [aiId];
    const w = playerWeapons(sieged, pu).find((x) => x.name === 'Shock Cannon')!;
    expect(validTargets(sieged, pu, w).some((t) => t.unit.id === aiId)).toBe(false);
  });
});

describe('the Ravager', () => {
  it('spits bile that bursts at the end of the Assault phase', () => {
    const { s, aiId } = field('ravager', 10, ['zerg_swarm', 'hatchery', 'spawning_pool']);
    s.phase = 'movement';
    const spat = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Corrosive Bile', point: { x: 18, y: 14 } });
    const globs = (spat.tokens ?? []).filter((t) => t.kind === 'bile');
    expect(globs.length).toBe(spat.playerUnits[0]!.models);
    expect(globs[0]!.radius).toBe(1);
    // An enemy standing in it when the phase ends takes the hits; the globs are then gone.
    spat.sense!.ai[aiId] = [{ x: 18, y: 14 }];
    const before = spat.army.units.find((u) => u.id === aiId)!.models;
    let after = spat;
    after.phase = 'assault';
    after.passed = { ai: true, players: true };
    after = apply(after, { t: 'playersPass' });
    const hit = after.army.units.find((u) => u.id === aiId)!;
    expect((after.tokens ?? []).some((t) => t.kind === 'bile')).toBe(false);
    expect(hit.models <= before).toBe(true);
    expect(after.log.some((l) => /Corrosive Bile/.test(l.text))).toBe(true);
  });

  it('Bloated Bile Ducts widens the glob', () => {
    const { s } = field('ravager', 10, ['zerg_swarm', 'hatchery', 'spawning_pool']);
    s.phase = 'movement';
    s.playerUnits[0]!.upgrades = upgradeIds('ravager', ['Bloated Bile Ducts']);
    const spat = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Corrosive Bile', point: { x: 18, y: 14 } });
    expect((spat.tokens ?? []).find((t) => t.kind === 'bile')!.radius).toBe(2);
  });
});

/** What a mission hook is handed: the state and somewhere to log. */
const ctxOf = (s: GameState): MissionCtx => ({ state: s, log: () => undefined } as unknown as MissionCtx);

describe('the AI with a Siege Tank', () => {
  /** A Terran AI army that owns a Siege Tank, against one of your units on the table. */
  function aiTank(): { s: GameState; tank: NonNullable<ReturnType<typeof findTank>> } {
    const cfg = makeConfig({ aiFaction: 'Terran', playerMinerals: 1400, playMode: 'video' });
    cfg.playerUnits = [makePlayerUnit('p1', 'marine', 'small', [], 'Marines', 300)];
    // A tank in the AI force, bought with the upgrade that lets it dig in.
    const def = unitById('siege_tank');
    const mode = def.abilities.find((a) => a.name === 'Mode Transformation')!;
    cfg.army = {
      ...cfg.army,
      units: [{
        id: 'ai-tank', defId: 'siege_tank', label: 'Siege Tank A', composition: 'small', upgrades: [mode.id],
        maxModels: 1, models: 1, damageMarker: 0, shieldsLeft: 0, location: 'table',
        activated: { movement: false, assault: false, combat: false }, engaged: false, engagedEnemySupply: 0,
        disengagedThisRound: false, objective: { kind: 'enemy' }, atObjective: false, respawns: 0,
      }],
    };
    const s = createGame(cfg, dep, flat);
    const tank = findTank(s)!;
    tank.location = 'table';
    s.playerUnits[0]!.location = 'table';
    s.sense!.ai['ai-tank'] = [{ x: 18, y: 20 }];
    s.sense!.players['p1'] = [{ x: 18, y: 6 }];
    return { s, tank };
  }
  const findTank = (s: GameState) => s.army.units.find((u) => u.id === 'ai-tank');

  it('buys Mode Transformation when it owns a tank, digs in, and packs up again', () => {
    const { s } = aiTank();
    // With your Marines 14" away the Shock Cannon (18") can reach them, so it sets up rather than walking.
    s.phase = 'movement';
    const order = decideAi(s, modeById(s.config.modeId)!, ctxOf(s), Rng.from(5));
    expect(order?.type).toBe('special');
    expect(order?.title).toMatch(/SIEGE MODE/i);
    const sieged = apply({ ...s, step: { kind: 'AI_ORDER', order: order! } }, { t: 'orderReport', report: 'done' });
    const tank = findTank(sieged)!;
    expect(tank.statuses).toContain('Siege Mode');
    // Dug in, it is Size 3 and may only use the Shock Cannon.
    expect(aiUnitSize(tank)).toBe(3);
    const guns = unitById('siege_tank').weapons.filter((w) => usableNow(tank, w) && w.phase === 'Assault');
    expect(guns.map((w) => w.name)).toEqual(['Shock Cannon']);
    // With nothing left in range it packs up.
    sieged.sense!.players['p1'] = [{ x: 2, y: 2 }];
    sieged.phase = 'movement';
    tank.activated.movement = false;
    const back = decideAi(sieged, modeById(sieged.config.modeId)!, ctxOf(sieged), Rng.from(5));
    expect(back?.title).toMatch(/Leave SIEGE MODE/i);
  });

  it('will not walk or charge while it is dug in', () => {
    const { s } = aiTank();
    const tank = findTank(s)!;
    tank.statuses = ['Siege Mode'];
    expect(planted(tank)).toBe(true);
    s.phase = 'movement';
    tank.activated.movement = false;
    // The only thing it does in the Movement phase is change stance, never a move order.
    const order = decideAi(s, modeById(s.config.modeId)!, ctxOf(s), Rng.from(5));
    expect(order === null || order.type === 'special').toBe(true);
  });
});
