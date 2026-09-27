import { describe, expect, it } from 'vitest';
import { deploymentById, unitById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { playerWeapons } from '@engine/player/rules';
import { makeConfig } from '../engine/helpers';
import type { GameState } from '@engine/types/game';
import { buildPools, commandFor, facesFromCount, planAttack, planCharge, resultItem, saveOptions } from '@ui/hud/combatPools';

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

/** Your unit on the table in the Assault phase with an AI unit `gap` inches in front of it. */
function assault(defId: string, gap: number): { s: GameState; aiId: string } {
  const cfg = makeConfig({ modeId: 'frontlines' });
  cfg.playerUnits = [makePlayerUnit('p1', defId, 'small', [], 'Unit', 300)];
  let s = createGame(cfg, dep, flat);
  s = toPlayersTurn(s);
  s = apply(s, { t: 'playerDeploy', unitId: 'p1', point: { x: 18, y: 4 } });
  const ai = s.army.units[0]!;
  ai.location = 'table';
  s.sense!.ai[ai.id] = [{ x: 18, y: 4 + gap }];
  s.phase = 'assault';
  s.step = { kind: 'PLAYERS_TURN', lines: [] };
  s.activeUnitId = null;
  s.playerUnits[0]!.activated.assault = false;
  return { s, aiId: ai.id };
}

describe('combat tray pools', () => {
  it('your ranged attack: ATTACK (and SURGE) are yours, then the AI rolls ARMOUR, then DAMAGE', () => {
    const { s, aiId } = assault('marine', 8);
    const w = playerWeapons(s, s.playerUnits[0]!).find((x) => x.phase !== 'Combat')!;
    const item = planAttack(s, { unitId: 'p1', weaponId: w.id, targetId: aiId, models: s.playerUnits[0]!.models })!;
    const ids = buildPools(s, item).map((p) => `${p.id}:${p.owner}`);
    expect(ids[0]).toBe('attack:you');
    if (w.surgeTypes.length) expect(ids[1]).toBe('surge:you');
    expect(ids.slice(-2)).toEqual(['armour:ai', 'damage:ai']);
    // Nothing is sent until your dice are in.
    expect(commandFor(s, item)).toBeNull();
    item.input.attack = facesFromCount(item.meta.dice!, 3, 1, item.meta.need!);
    if (w.surgeTypes.length) {
      expect(commandFor(s, item)).toBeNull();
      item.input.surge = 2;
    }
    // The AI's Armour is its own step: nothing is applied until those dice are in.
    const armour = buildPools(s, item).find((p) => p.id === 'armour')!;
    expect(armour.owner).toBe('ai');
    expect(armour.faces).toBeNull();
    expect(commandFor(s, item)).toBeNull();
    item.input.armour = facesFromCount(armour.dice, 1, 0, armour.need!);
    const cmd = commandFor(s, item);
    expect(cmd).toMatchObject({ t: 'playerAttack', unitId: 'p1', targetId: aiId, rolls: item.input.attack, saveRolls: item.input.armour });
    // The engine uses the dice rolled in the tray, and its result matches the preview.
    const after = apply(s, cmd!);
    if (w.surgeTypes.length) expect(after.lastAttack!.surge?.roll).toBe(2);
    expect(after.lastAttack!.rolls).toEqual(item.input.attack);
    expect(after.lastAttack!.saved).toBe(buildPools(s, item).find((p) => p.id === 'armour')!.successes);
  });

  it('an AI attack on a Burrowed unit waits for your ARMOUR and then your EVADE', () => {
    const { s } = assault('roach', 8);
    const r = s.playerUnits[0]!;
    r.statuses = ['Burrowed'];
    const ai = s.army.units[0]!;
    const attack = {
      id: 'ev1', attacker: { side: 'ai' as const, unitId: ai.id, label: ai.label }, defender: { side: 'players' as const, unitId: 'p1', label: 'Roaches' },
      weapon: 'Test', phase: 'Assault' as const, models: 1, dice: 4, hit: 3, hitMod: 0, rolls: [3, 4, 5, 6], precisionUsed: 0, hits: 4,
      critical: 0, armour: 3, saveRolls: [], saved: 0, toughUsed: 0, dmgPer: 1, damage: 0, removed: 0, modelsAfter: r.models, destroyed: false, pendingSaves: true,
    };
    s.pendingSaves = { attack, order: { unitId: ai.id, type: 'ranged', title: 't', lines: [], batches: [] } as never, report: '', remaining: [] };
    s.step = { kind: 'AI_SAVES', attack };
    s.config.options.manualSaves = true;
    const item = resultItem(s, { pending: attack });
    expect(buildPools(s, item).map((p) => `${p.id}:${p.owner}`)).toEqual(['attack:ai', 'armour:you', 'evade:you', 'damage:ai']);
    item.input.armour = facesFromCount(4, 1, 0, 3);
    const evade = buildPools(s, item).find((p) => p.id === 'evade')!;
    expect(evade.dice).toBe(3);
    expect(commandFor(s, item)).toBeNull();
    item.input.evade = facesFromCount(3, 2, 0, evade.need!);
    const cmd = commandFor(s, item);
    expect(cmd).toMatchObject({ t: 'enterSaves', saved: 1, evaded: 2 });
    expect(apply(s, cmd!).lastAttack!.damage).toBe(1);
    // Without "I roll my saves" (and no cards to use), the tray rolls them for you as their own steps.
    s.config.options.manualSaves = false;
    expect(buildPools(s, resultItem(s, { pending: attack })).map((p) => `${p.id}:${p.owner}`)).toEqual(['attack:ai', 'armour:ai', 'evade:ai', 'damage:ai']);
  });

  it('a successful charge adds IMPACT; a failed one ends at CHARGE', () => {
    const { s, aiId } = assault('zealot', 12);
    const item = planCharge(s, { unitId: 'p1', targetId: aiId })!;
    expect(buildPools(s, item).map((p) => p.id)).toEqual(['charge', 'impact', 'armour', 'damage']);
    const fail = structuredClone(item);
    fail.input.charge = [1];
    expect(buildPools(s, fail).map((p) => p.id)).toEqual(['charge']);
    expect(commandFor(s, fail)).toMatchObject({ t: 'playerCharge', roll: 1 });
    item.input.charge = [6];
    expect(buildPools(s, item)[0]!.bar!.reach).toBeGreaterThanOrEqual(item.meta.needed!);
    expect(commandFor(s, item)).toBeNull();
    item.input.impact = Array(item.meta.impact!.dice).fill(6);
    // The charge waits for the target's Armour as an attack does, so nothing is resolved before those dice land.
    const armour = buildPools(s, item).find((p) => p.id === 'armour')!;
    expect(armour.owner).toBe('ai');
    expect(armour.dice).toBeGreaterThan(0);
    expect(commandFor(s, item)).toBeNull();
    item.input.armour = facesFromCount(armour.dice, 0, 0, armour.need ?? 4);
    expect(commandFor(s, item)).toMatchObject({ t: 'playerCharge', roll: 6, impactRolls: item.input.impact, impactSaveRolls: item.input.armour });
  });

  it('table entry makes dice with the successes and sixes counted', () => {
    const f = facesFromCount(6, 4, 1, 4);
    expect(f.filter((x) => x >= 4)).toHaveLength(4);
    expect(f.filter((x) => x === 6)).toHaveLength(1);
  });

  it('offers Life Support from a Medic within 4", measured base to base', () => {
    const { s } = assault('marine', 8);
    const ai = s.army.units[0]!;
    const attack = {
      id: 'ls1', attacker: { side: 'ai' as const, unitId: ai.id, label: ai.label }, defender: { side: 'players' as const, unitId: 'p1', label: 'Marines' },
      weapon: 'Test', phase: 'Assault' as const, models: 1, dice: 4, hit: 3, hitMod: 0, rolls: [3, 4, 5, 6], precisionUsed: 0, hits: 4,
      critical: 0, armour: 5, saveRolls: [], saved: 0, toughUsed: 0, dmgPer: 1, damage: 0, removed: 0, modelsAfter: s.playerUnits[0]!.models, destroyed: false, pendingSaves: true,
    };
    // Medics standing off to one side: the leading model is more than 4" away, two others are inside it.
    s.playerUnits.push(makePlayerUnit('md', 'medic', 'small', [], 'Medics', 300));
    s.playerUnits[1]!.location = 'table';
    const near = s.sense!.players['p1']![0]!;
    s.sense!.players['md'] = [{ x: near.x + 14, y: near.y }, { x: near.x + 3, y: near.y }, { x: near.x + 3.4, y: near.y + 0.9 }];
    const life = saveOptions(s, attack).reactions.find((r) => r.name === 'Life Support');
    expect(life).toBeTruthy();
    // One damage soaked per Medic model within 4" of the damaged unit: the far one does not count.
    expect(life!.reduce).toBe(2);
  });

  it('a Blast Template shows the models it covered instead of asking for a Surge roll', () => {
    const { s, aiId } = assault('siege_tank', 12);
    // Dug in, with three of the target's models close enough together to be under the template.
    s.playerUnits[0]!.statuses = ['Siege Mode'];
    s.playerUnits[0]!.upgrades = [unitById('siege_tank').abilities.find((a) => a.name === 'Mode Transformation')!.id];
    s.sense!.ai[aiId] = [{ x: 18, y: 16 }, { x: 18.9, y: 16 }, { x: 18, y: 16.9 }, { x: 18, y: 26 }];
    const w = playerWeapons(s, s.playerUnits[0]!).find((x) => x.name === 'Shock Cannon')!;
    const item = planAttack(s, { unitId: 'p1', weaponId: w.id, targetId: aiId, models: 1 })!;
    // The template's models are extra dice in the attack pool.
    expect(item.meta.dice).toBe(w.roa + 3);
    item.input.attack = facesFromCount(item.meta.dice!, 4, 0, item.meta.need!);
    const surge = buildPools(s, item).find((p) => p.id === 'surge')!;
    expect(surge.label).toBe('TEMPLATE');
    expect(surge.dice).toBe(0);
    expect(surge.faces).toEqual([]);
    expect(surge.note).toMatch(/3 models under the template/);
    // Nothing waits on a Surge roll that is never made.
    const armour = buildPools(s, item).find((p) => p.id === 'armour')!;
    item.input.armour = facesFromCount(armour.dice, 0, 0, armour.need ?? 4);
    expect(commandFor(s, item)).toMatchObject({ t: 'playerAttack', weaponId: w.id });
  });

  it('a Surge that cannot touch the target is never waited for', () => {
    // The Marine's rifle Surges on Light. Against an Armoured, non-Light target no Surge step is shown, so
    // nothing may wait on one: the Armour roll has to be reachable or the attack stalls there for good.
    const { s, aiId } = assault('marine', 8);
    const target = s.army.units.find((u) => u.id === aiId)!;
    // Whatever the mission rolled up, make the target one the rifle's Light Surge cannot touch.
    const armoured = s.army.units.find((u) => !(unitById(u.defId).tags as string[]).includes('Light'));
    if (armoured) { target.defId = armoured.defId; }
    expect((unitById(target.defId).tags as string[]).includes('Light')).toBe(false);
    const w = playerWeapons(s, s.playerUnits[0]!).find((x) => x.name === 'C-14 rifle')!;
    const item = planAttack(s, { unitId: 'p1', weaponId: w.id, targetId: aiId, models: s.playerUnits[0]!.models })!;
    item.input.attack = facesFromCount(item.meta.dice!, 3, 0, item.meta.need!);
    const pools = buildPools(s, item);
    expect(pools.some((p) => p.id === 'surge')).toBe(false);
    const armour = pools.find((p) => p.id === 'armour')!;
    expect(armour.faces).toBeNull();
    expect(armour.dice).toBeGreaterThan(0);
    item.input.armour = facesFromCount(armour.dice, 1, 0, armour.need ?? 4);
    expect(commandFor(s, item)).toMatchObject({ t: 'playerAttack', saveRolls: item.input.armour });
  });
});

describe('your saves against an AI shot, Evade included', () => {
  /** AI Adepts have shot your engaged Zerglings (Evade 4+), and the engine is stopped for your saves. */
  function shotZerglings(): GameState {
    const cfg = makeConfig({ modeId: 'frontlines', aiFaction: 'Protoss', playMode: 'tabletop' });
    cfg.options = { ...cfg.options, manualSaves: true };
    cfg.playerUnits = [makePlayerUnit('z1', 'zergling', 'small', [], 'Zerglings', 300)];
    cfg.army = { ...cfg.army, units: [{
      id: 'ad', defId: 'adept', label: 'Adepts A', composition: 'small', upgrades: [],
      maxModels: 4, models: 4, damageMarker: 0, shieldsLeft: 8, location: 'table',
      activated: { movement: true, assault: false, combat: false }, engaged: false, engagedEnemySupply: 0,
      disengagedThisRound: false, objective: { kind: 'enemy' }, atObjective: false, respawns: 0,
    }] } as typeof cfg.army;
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'z1', point: { x: 18, y: 4 } });
    s.army.units[0]!.location = 'table';
    s.sense!.ai['ad'] = [{ x: 18, y: 10 }, { x: 19, y: 10 }, { x: 20, y: 10 }, { x: 21, y: 10 }];
    // Engaged, as the players say they are: the Zerglings get an Evade against the Adepts' shots.
    s.playerUnits[0]!.engaged = true;
    s.playerUnits[0]!.engagedWith = ['ad'];
    s.army.units[0]!.engaged = true;
    s.phase = 'assault';
    s.turn = 'ai';
    // The shot, as the engine leaves it when it stops for your saves: four hits, one of them a Surge hit.
    const attack = {
      id: 'shot-1', attacker: { side: 'ai' as const, unitId: 'ad', label: 'Adepts A' }, defender: { side: 'players' as const, unitId: 'z1', label: 'Zerglings' },
      weapon: 'Glaive Cannon', phase: 'Assault' as const, models: 4, dice: 8, hit: 4, hitMod: 0, rolls: [4, 4, 5, 6, 1, 2, 3, 3], precisionUsed: 0, hits: 4,
      surge: { die: 2, applied: 1, type: 'Light' }, critical: 0, armour: 6, saveRolls: [], saved: 0, toughUsed: 0, dmgPer: 1, damage: 0, removed: 0,
      modelsAfter: s.playerUnits[0]!.models, destroyed: false, pendingSaves: true,
    } as unknown as NonNullable<GameState['pendingSaves']>['attack'];
    const order = { type: 'ranged' as const, unitId: 'ad', title: 'Adepts A: Ranged attack', lines: [], batches: [], reports: [{ id: 'attacked' as const, label: 'Attacked' }] };
    s.pendingSaves = { attack, order, report: 'attacked', remaining: [] };
    s.step = { kind: 'AI_SAVES', attack };
    return s;
  }

  it('walks Armour then Evade, sends both, and the game moves on', () => {
    let s = shotZerglings();
    expect(s.step.kind).toBe('AI_SAVES');
    const ps = s.pendingSaves!;
    expect(ps.attack.hits).toBeGreaterThan(0);
    const item = resultItem(s, { pending: ps.attack });
    // Before any dice: Armour is yours and open, and nothing is sent.
    let pools = buildPools(s, item);
    const armour = pools.find((p) => p.id === 'armour')!;
    expect(armour.owner).toBe('you');
    expect(commandFor(s, item)).toBeNull();
    // Fail every save, so hits are left for the Evade roll.
    item.input.armour = Array.from({ length: armour.dice }, () => 1);
    pools = buildPools(s, item);
    const evade = pools.find((p) => p.id === 'evade');
    expect(evade, 'an Evade step for the engaged Zerglings').toBeTruthy();
    expect(evade!.owner).toBe('you');
    expect(evade!.faces).toBeNull();
    expect(evade!.dice).toBeGreaterThan(0);
    expect(evade!.note).toMatch(/engaged/i);
    // Still nothing sent until the Evade dice are in.
    expect(commandFor(s, item)).toBeNull();
    item.input.evade = Array.from({ length: evade!.dice }, () => 6);
    const cmd = commandFor(s, item);
    expect(cmd?.t).toBe('enterSaves');
    expect((cmd as { evaded?: number }).evaded).toBe(evade!.dice);
    const before = s.playerUnits[0]!.models;
    s = apply(s, cmd!);
    // Every hit evaded: no damage, and the saves step is over.
    expect(s.step.kind).not.toBe('AI_SAVES');
    expect(s.pendingSaves).toBeUndefined();
    expect(s.playerUnits[0]!.models).toBe(before);
  });

  it('reaches the Evade roll when Surge sent every hit past Armour (the stall from the table)', () => {
    let s = shotZerglings();
    // Four hits, the Surge die covers all four: no Armour roll at all, straight to Evade.
    const a = s.pendingSaves!.attack;
    (a as { surge?: { die: number; applied: number; type: string } }).surge = { die: 4, applied: 4, type: 'Light' };
    s.step = { kind: 'AI_SAVES', attack: a };
    const item = resultItem(s, { pending: a });
    let pools = buildPools(s, item);
    const armour = pools.find((p) => p.id === 'armour')!;
    expect(armour.dice).toBe(0);
    expect(armour.faces).toEqual([]);
    const evade = pools.find((p) => p.id === 'evade')!;
    expect(evade.faces).toBeNull();
    expect(evade.dice).toBe(4);
    // Rolling the Evade is enough: nothing else is owed, and the command goes.
    item.input.evade = [6, 6, 1, 1];
    pools = buildPools(s, item);
    expect(pools.find((p) => p.id === 'evade')!.faces).toEqual([6, 6, 1, 1]);
    const cmd = commandFor(s, item);
    expect(cmd?.t).toBe('enterSaves');
    expect((cmd as { saved: number; evaded?: number }).saved).toBe(0);
    expect((cmd as { saved: number; evaded?: number }).evaded).toBe(2);
    s = apply(s, cmd!);
    expect(s.step.kind).not.toBe('AI_SAVES');
  });

  it('can always be finished by letting the app roll the saves', async () => {
    const { autoSaves } = await import('@ui/hud/combatPools');
    let s = shotZerglings();
    const cmd = autoSaves(s, s.pendingSaves!.attack);
    expect(cmd.t).toBe('enterSaves');
    s = apply(s, cmd);
    expect(s.step.kind).not.toBe('AI_SAVES');
    expect(s.pendingSaves).toBeUndefined();
  });
});
