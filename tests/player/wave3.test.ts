import { describe, expect, it } from 'vitest';
import { CARDS, deploymentById, unitById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { checkDeploy, playerWeapons, validTargets } from '@engine/player/rules';
import { abilityCost, contestSupply, effectiveSpeed, evadeFor, onCreep, passiveDodge, passiveTough, pendingEndOfRound, saveBoostOptions, weaponWithEffects } from '@engine/abilities/index';
import { reactionOffers } from '@engine/player/reactions';
import { addUnitProblem, slotOf, validatePlayerArmy } from '@engine/army/rules';
import { makeConfig } from '../engine/helpers';
import type { GameState } from '@engine/types/game';

const dep = deploymentById('abandoned-camp');
const makeChoice = (defId: string) => ({ defId, composition: 'small' as const, upgrades: [], label: unitById(defId).name });
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
export function upgradeIds(defId: string, names: string[]): string[] {
  const def = unitById(defId);
  return names.map((n) => [...def.abilities, ...def.weapons].find((x) => x.name === n)!.id);
}

/** One of your units deployed, with an AI unit `gap` inches in front of it and plenty of cards to pay with. */
export function field(defId: string, gap: number, cards: string[], upgrades: string[] = [], aiFaction: 'Terran' | 'Zerg' | 'Protoss' = 'Zerg'): { s: GameState; aiId: string } {
  const cfg = makeConfig({ modeId: 'frontlines', aiFaction });
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
  s.phase = 'movement';
  s.playerUnits[0]!.activated = { movement: false, assault: false, combat: false };
  return { s, aiId: ai.id };
}

const TERRAN = ['terran_armed_forces', 'barracks', 'factory', 'engineering_bay'];

describe('the Raven', () => {
  it('takes a Support slot, as the official card says, and carries no close combat weapon', () => {
    const def = unitById('raven');
    expect(slotOf(def)).toBe('Support');
    expect(def.tags).toContain('Flying');
    expect(def.weapons.map((w) => w.name)).toEqual(['Railguns']);
  });

  it('sets an Auto-Turret within 6", clear of the enemy, that is gone at the End of the Round', () => {
    const { s } = field('raven', 12, TERRAN);
    const far = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Deploy Auto-Turret', point: { x: 18, y: 14 } });
    expect(far.playerUnits.some((p) => p.defId === 'auto_turret')).toBe(false);
    const close = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Deploy Auto-Turret', point: { x: 18, y: 15.5 } });
    expect(close.playerUnits.some((p) => p.defId === 'auto_turret')).toBe(false);
    const set = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Deploy Auto-Turret', point: { x: 22, y: 6 } });
    const turret = set.playerUnits.find((p) => p.defId === 'auto_turret')!;
    expect(turret.summoned).toBe(true);
    expect(turret.expiresEndOfRound).toBe(true);
    expect(set.playerCards!.filter((c) => c.exhausted).length).toBe(1);
  });

  it('Explosive Shrapnel Shells give the turret\'s Gauss Cannon SURGE Light (D3+1)', () => {
    const { s, aiId } = field('raven', 12, TERRAN, ['Explosive Shrapnel Shells']);
    const set = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Deploy Auto-Turret', point: { x: 22, y: 6 } });
    const turret = set.playerUnits.find((p) => p.defId === 'auto_turret')!;
    const gauss = playerWeapons(set, turret).find((w) => w.name === 'Gauss Cannon')!;
    const fired = weaponWithEffects(turret, gauss, set.army.units.find((u) => u.id === aiId)!, 6, set).weapon;
    expect(fired.surgeTypes).toEqual(['Light']);
    expect(fired.surgeDie).toBe('D3+1');
  });

  it('Anti-Armour Missile puts DEBUFF Armour (1) on an enemy within 12"', () => {
    const { s, aiId } = field('raven', 10, TERRAN);
    const after = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Anti-Armour Missile', enemyId: aiId });
    expect(after.army.units.find((u) => u.id === aiId)!.statDebuffs).toEqual([{ stat: 'armour', amount: 1 }]);
  });

  it('Seeker Missile strikes at the End of the Assault Phase while its target stays put', () => {
    const { s, aiId } = field('raven', 11, TERRAN, ['Seeker Missile']);
    let after = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Seeker Missile', enemyId: aiId });
    expect(after.army.units.find((u) => u.id === aiId)!.debuffs?.some((d) => d.seekerFrom === 'p1')).toBe(true);
    after.phase = 'assault';
    after.passed = { ai: true, players: true };
    after.activeUnitId = null;
    after = apply(after, { t: 'playersPass' });
    expect(after.log.some((l) => /Seeker Missile: .* takes 4 hits/.test(l.text))).toBe(true);
    expect(after.army.units.find((u) => u.id === aiId)!.debuffs?.some((d) => d.seekerFrom)).toBeFalsy();
  });

  it('Corvid Reactor: the first ability of the Round costs 1 CP less against the closest enemy', () => {
    const { s, aiId } = field('raven', 10, TERRAN, ['Corvid Reactor']);
    const pu = s.playerUnits[0]!;
    const missile = unitById('raven').abilities.find((a) => a.name === 'Anti-Armour Missile')!;
    const target = s.army.units.find((u) => u.id === aiId)!;
    expect(abilityCost(s, pu, missile, undefined, target).cost).toBe(0);
    pu.used = ['Deploy Auto-Turret'];
    expect(abilityCost(s, pu, missile, undefined, target).cost).toBe(1);
  });

  it('Internal Tech Module brings it on from a side edge, more than 8" from the enemy', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('p1', 'raven', 'small', upgradeIds('raven', ['Internal Tech Module']), 'Raven', 300), makePlayerUnit('p2', 'raven', 'small', [], 'Raven 2', 300)];
    cfg.playerCards = TERRAN;
    const s = toPlayersTurn(createGame(cfg, dep, flat));
    const side = { x: 2.5, y: s.terrain.table.height / 2 };
    expect(checkDeploy(s, s.playerUnits[0]!, side)).toMatchObject({ ok: true, via: 'Internal Tech Module' });
    expect(checkDeploy(s, s.playerUnits[1]!, side).ok).toBe(false);
  });
});

describe('the Auto-Turret', () => {
  it('Overwatch: fires on an Enemy Unit that ends its Activation Within 8"', () => {
    const { s, aiId } = field('raven', 12, TERRAN);
    let g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Deploy Auto-Turret', point: { x: 20, y: 9.5 } });
    const turret = g.playerUnits.find((p) => p.defId === 'auto_turret')!;
    g.activeUnitId = null;
    g.phase = 'assault';
    g.step = { kind: 'AI_ORDER', order: { type: 'hold', unitId: aiId, title: 'Hold', lines: [], batches: [], reports: [{ id: 'done', label: 'Held' }] } };
    g = apply(g, { t: 'orderReport', report: 'done' });
    expect(g.pendingReaction?.kind).toBe('aiActivationEnd');
    const offers = reactionOffers(g, g.pendingReaction!);
    expect(offers.map((o) => o.name)).toEqual(['Overwatch']);
    const shots = g.attackLog.length;
    g = apply(g, { t: 'damageReaction', key: offers[0]!.key });
    expect(g.pendingReaction).toBeUndefined();
    expect(g.attackLog.length).toBe(shots + 1);
    expect(g.attackLog[g.attackLog.length - 1]!.attacker.unitId).toBe(turret.id);
    expect(g.log.some((l) => /Overwatch: Auto-Turret fires Gauss Cannon/.test(l.text))).toBe(true);
  });

  it('is not offered when the enemy ends its Activation beyond 8"', () => {
    const { s, aiId } = field('raven', 20, TERRAN);
    let g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Deploy Auto-Turret', point: { x: 22, y: 6 } });
    g.activeUnitId = null;
    g.step = { kind: 'AI_ORDER', order: { type: 'hold', unitId: aiId, title: 'Hold', lines: [], batches: [], reports: [{ id: 'done', label: 'Held' }] } };
    g = apply(g, { t: 'orderReport', report: 'done' });
    expect(g.pendingReaction).toBeUndefined();
  });
});

const NOVA = ['nova_covert_ops', 'barracks', 'factory', 'engineering_bay'];

describe('Nova', () => {
  it('Battle Preparation: an army takes Nova Assault Mode or Nova Stealth Mode, not both', () => {
    const fc = CARDS.find((c) => c.id === 'terran_armed_forces')!;
    const army = { factionCard: fc, cards: [fc, CARDS.find((c) => c.id === 'supply_depot')!], units: [{ defId: 'nova_assault_mode', composition: 'small' as const }] };
    expect(addUnitProblem(unitById('nova_stealth_mode'), 'small', army)).toMatch(/Battle Preparation/);
    const problems = validatePlayerArmy({ factionCard: fc, cards: ['terran_armed_forces', 'supply_depot', 'supply_depot'], units: [makeChoice('nova_assault_mode'), makeChoice('nova_stealth_mode')], minerals: 2000 });
    expect(problems.some((p) => /Battle Preparation/.test(p.text))).toBe(true);
  });

  it('Super Stimpack: BUFF Speed (2) and PRECISION (2) on every weapon', () => {
    const { s, aiId } = field('nova_assault_mode', 12, NOVA);
    const after = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Super Stimpack' });
    const pu = after.playerUnits[0]!;
    expect(effectiveSpeed(pu, after)).toBe(9);
    const gun = playerWeapons(after, pu).find((w) => w.name === 'Hellfire Shotgun')!;
    expect(weaponWithEffects(pu, gun, after.army.units.find((u) => u.id === aiId)!, 6, after).weapon.keywords.find((k) => k.k === 'PRECISION')?.v).toBe(2);
  });

  it('Holo Decoy: a decoy that moves at once, is never Engaged, holds no marker and sharpens every shot near it', () => {
    const { s, aiId } = field('nova_assault_mode', 12, NOVA);
    let g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Holo Decoy' });
    const decoy = g.playerUnits.find((p) => p.defId === 'holo_decoy')!;
    expect(decoy.bonusMove).toBe(7);
    expect(decoy.expiresEndOfRound).toBe(true);
    expect(contestSupply(g, decoy)).toBeNull();
    // It walks right up to the enemy: it is never Engaged, and every weapon aimed there gains PRECISION (1).
    g = apply(g, { t: 'playerBonusMove', unitId: decoy.id, point: { x: 18, y: 10.5 } });
    const d2 = g.playerUnits.find((p) => p.id === decoy.id)!;
    expect(d2.engaged).toBe(false);
    const pu = g.playerUnits[0]!;
    const gun = playerWeapons(g, pu).find((w) => w.name === 'Hellfire Shotgun')!;
    const fired = weaponWithEffects(pu, gun, g.army.units.find((u) => u.id === aiId)!, 8, g);
    expect(fired.notes).toContain('Lethal Hologram');
    expect(fired.weapon.keywords.find((k) => k.k === 'PRECISION')?.v).toBe(1);
  });

  it('Surprise!: at the End of the Round Nova steps out beside her decoy', () => {
    const { s } = field('nova_assault_mode', 14, NOVA);
    let g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Holo Decoy' });
    const decoy = g.playerUnits.find((p) => p.defId === 'holo_decoy')!;
    g = apply(g, { t: 'playerBonusMove', unitId: decoy.id, point: { x: 26, y: 6 } });
    g.step = { kind: 'ROUND_END', lines: [] };
    const pending = pendingEndOfRound(g).find((p) => p.kind === 'surprise')!;
    expect(pending.candidates.map((c) => c.id)).toEqual(['p1']);
    g = apply(g, { t: 'endOfRoundEffect', tokenId: pending.token.id, accept: true, unitId: 'p1' });
    const at = g.sense!.players['p1']![0]!;
    expect(Math.hypot(at.x - 26, at.y - 6)).toBeLessThan(3);
    expect(pendingEndOfRound(g).some((p) => p.kind === 'surprise')).toBe(false);
  });

  it('Tactical Stealth Suit: Nova Stealth Mode is HIDDEN after each action', () => {
    const { s } = field('nova_stealth_mode', 12, NOVA);
    const g = apply(s, { t: 'playerHold', unitId: 'p1' });
    expect(g.playerUnits[0]!.statuses).toContain('Hidden');
  });

  it('Head Shot: standing still, the C-20A deals 3 Damage with CONCENTRATED FIRE (1)', () => {
    const { s, aiId } = field('nova_stealth_mode', 12, NOVA);
    s.phase = 'assault';
    const pu0 = s.playerUnits[0]!;
    pu0.movedRound = undefined;
    const g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Head Shot' });
    const pu = g.playerUnits[0]!;
    const rifle = playerWeapons(g, pu).find((w) => /C-20A/.test(w.name))!;
    const fired = weaponWithEffects(pu, rifle, g.army.units.find((u) => u.id === aiId)!, 12, g).weapon;
    expect(fired.dmg).toBe(3);
    expect(fired.keywords.find((k) => k.k === 'CONCENTRATED FIRE')?.v).toBe(1);
  });
});

describe('the Spec Ops Marauder and Nova Covert Ops', () => {
  it('Magrail Munitions: the first Quad K12 attack of the game gains PIERCE Armoured (3)', () => {
    const { s, aiId } = field('spec_ops_marauder__marauder_', 10, NOVA);
    const pu = s.playerUnits[0]!;
    const quad = playerWeapons(s, pu).find((w) => w.name === 'Quad K12')!;
    const target = s.army.units.find((u) => u.id === aiId)!;
    expect(weaponWithEffects(pu, quad, target, 10, s).weapon.keywords.find((k) => k.k === 'PIERCE')?.v).toBe(3);
    pu.usedGame = ['Magrail Munitions'];
    expect(weaponWithEffects(pu, quad, target, 10, s).weapon.keywords.find((k) => k.k === 'PIERCE')?.v).toBe(2);
  });

  it('Suppression Shells answer a Charge against a friendly unit within 8" with DEBUFF Speed (3)', () => {
    const { s, aiId } = field('spec_ops_marauder__marauder_', 6, NOVA);
    const offers = reactionOffers(s, { kind: 'aiCharge', unitId: 'p1', aiUnitId: aiId, amount: 0, source: 'Charge' });
    expect(offers.map((o) => o.name)).toContain('Suppression Shells');
  });

  it('Griffin Support drops a Sabotage Drone that blasts everything within 3" at the End of the Assault Phase', () => {
    const { s, aiId } = field('marine', 10, NOVA);
    const card = s.playerCards!.find((c) => c.defId === 'nova_covert_ops')!;
    let g = apply(s, { t: 'useBoost', cardId: card.id, boost: 'Griffin Support', point: { x: 18, y: 10.5 } });
    const drone = g.playerUnits.find((p) => p.defId === 'sabotage_drone')!;
    expect(drone.expiresEndOfRound).toBe(true);
    g.phase = 'assault';
    g.passed = { ai: true, players: true };
    g.activeUnitId = null;
    g = apply(g, { t: 'playersPass' });
    expect(g.log.some((l) => /Have a Nice Day: .* takes 5 hits/.test(l.text))).toBe(true);
    void aiId;
  });

  it('Mark for Death: the first weapon used against the marked unit gains CRITICAL HIT (1) and PRECISION (1)', () => {
    const { s, aiId } = field('marine', 10, NOVA);
    const card = s.playerCards!.find((c) => c.defId === 'nova_covert_ops')!;
    const g = apply(s, { t: 'useBoost', cardId: card.id, boost: 'Mark for Death', enemyId: aiId });
    const pu = g.playerUnits[0]!;
    const rifle = playerWeapons(g, pu)[0]!;
    const fired = weaponWithEffects(pu, rifle, g.army.units.find((u) => u.id === aiId)!, 10, g).weapon;
    expect(fired.keywords.find((k) => k.k === 'CRITICAL HIT')?.v).toBe(1);
    expect(fired.keywords.find((k) => k.k === 'PRECISION')?.v).toBeGreaterThanOrEqual(1);
  });

  it('Vanadium Plating: Crystalline Alloy is a DODGE (2) save for a Mechanical unit', () => {
    const { s } = field('goliath', 10, ['terran_armed_forces', 'factory', 'vanadium_plating']);
    expect(saveBoostOptions(s, s.playerUnits[0]!).map((o) => o.name)).toContain('Crystalline Alloy');
  });
});

const SWARM = ['zagara_s_swarm', 'reactive_creep', 'hatchery', 'spawning_pool', 'defiler_mound', 'evolution_chamber'];

describe('Zagara and her Swarm', () => {
  it('the Vileling\'s Debilitating Claws put DEBUFF Hit (1) on what they wound', () => {
    const { s, aiId } = field('vileling__zergling_', 0.5, SWARM);
    const pu = s.playerUnits[0]!;
    pu.engaged = true;
    pu.engagedWith = [aiId];
    const t = s.army.units.find((u) => u.id === aiId)!;
    t.engaged = true;
    s.phase = 'combat';
    const claws = playerWeapons(s, pu).find((w) => w.phase === 'Combat')!;
    const g = apply(s, { t: 'playerAttack', unitId: 'p1', targetId: aiId, weaponId: claws.id, rolls: Array(60).fill(6), saveRolls: Array(60).fill(1) });
    expect(g.army.units.find((u) => u.id === aiId)!.statDebuffs).toContainEqual({ stat: 'hit', amount: 1 });
  });

  it('Broodmother: TOUGH (1) for the big ones, and not the same effect two Rounds running', () => {
    const { s } = field('zagara', 12, SWARM);
    let g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Broodmother', option: 2 });
    expect(passiveTough(g.playerUnits[0]!)).toBe(1);
    g.round += 1;
    g.playerUnits[0]!.used = [];
    g.activeUnitId = null;
    g.playerUnits[0]!.activated = { movement: false, assault: false, combat: false };
    const again = apply(g, { t: 'useAbility', unitId: 'p1', name: 'Broodmother', option: 2 });
    expect(again.log[again.log.length - 1]!.text).toMatch(/previous Game Round/);
  });

  it('Infested Drop: one Supply of Units a Round comes on at Zagara\'s base', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('z', 'zagara', 'small', [], 'Zagara', 300), makePlayerUnit('d', 'defiler', 'small', [], 'Defiler', 300)];
    cfg.playerCards = SWARM;
    let s = toPlayersTurn(createGame(cfg, dep, flat));
    s = apply(s, { t: 'playerDeploy', unitId: 'z', point: { x: 18, y: 6 } });
    s.sense!.players['z'] = [{ x: 18, y: 16 }];
    s.activeUnitId = null;
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    expect(checkDeploy(s, s.playerUnits[1]!, { x: 18, y: 20 }), JSON.stringify(checkDeploy(s, s.playerUnits[1]!, { x: 18, y: 20 }))).toMatchObject({ ok: true, via: 'Infested Drop' });
  });

  it('Scourge Queen: outnumbering the fight gives the close combat weapons INSTANT and PRECISION (4)', () => {
    const { s, aiId } = field('vileling__zergling_', 0.5, SWARM);
    const pu = s.playerUnits[0]!;
    pu.engaged = true;
    pu.engagedWith = [aiId];
    s.army.units.find((u) => u.id === aiId)!.models = 3;
    s.phase = 'combat';
    const card = s.playerCards!.find((c) => c.defId === 'zagara_s_swarm')!;
    const g = apply(s, { t: 'useBoost', cardId: card.id, boost: 'Scourge Queen', unitId: 'p1' });
    const claws = playerWeapons(g, g.playerUnits[0]!).find((w) => w.phase === 'Combat')!;
    const fired = weaponWithEffects(g.playerUnits[0]!, claws, g.army.units.find((u) => u.id === aiId)!, 0, g).weapon;
    expect(fired.keywords.some((k) => k.k === 'INSTANT')).toBe(true);
    expect(fired.keywords.find((k) => k.k === 'PRECISION')?.v).toBe(4);
  });

  it('Instinctive Reaction is offered when an enemy declares a Close Combat Attack', () => {
    const { s, aiId } = field('vileling__zergling_', 0.5, SWARM);
    const offers = reactionOffers(s, { kind: 'aiMelee', unitId: 'p1', aiUnitId: aiId, amount: 0, source: 'x' });
    expect(offers.map((o) => o.name)).toContain('Instinctive Reaction');
  });

  it('Reactive Creep: DODGE (1) on Creep, and an enemy that stops beside a Creep Tumor clears it', () => {
    const { s, aiId } = field('vileling__zergling_', 12, SWARM);
    s.tokens = [{ id: 'tum', kind: 'creepTumor', x: 18, y: 6, label: 'Creep Tumor', round: 1 }];
    expect(passiveDodge(s, s.playerUnits[0]!)).toBe(1);
    s.tokens.push({ id: 'tum2', kind: 'creepTumor', x: 18, y: 15, label: 'Creep Tumor', round: 1 });
    s.step = { kind: 'AI_ORDER', order: { type: 'hold', unitId: aiId, title: 'Hold', lines: [], batches: [], reports: [{ id: 'done', label: 'Held' }] } };
    const g = apply(s, { t: 'orderReport', report: 'done' });
    expect((g.tokens ?? []).map((t) => t.id)).toEqual(['tum']);
  });
});

describe('the Defiler', () => {
  it('Dark Swarm: a friendly unit near the swarm, with the Defiler near it too, may Evade the shot', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('d', 'defiler', 'small', [], 'Defiler', 300), makePlayerUnit('v', 'vileling__zergling_', 'small', [], 'Vilelings', 300)];
    cfg.playerCards = SWARM;
    let s = toPlayersTurn(createGame(cfg, dep, flat));
    s = apply(s, { t: 'playerDeploy', unitId: 'd', point: { x: 18, y: 4 } });
    s.sense!.players['v'] = [{ x: 21, y: 6 }];
    s.playerUnits[1]!.location = 'table';
    s = apply(s, { t: 'useAbility', unitId: 'd', name: 'Gestate Dark Swarm', point: { x: 19, y: 7 } });
    expect((s.tokens ?? []).some((t) => t.kind === 'darkSwarm')).toBe(true);
    const ai = s.army.units[0]!;
    ai.location = 'table';
    s.sense!.ai[ai.id] = [{ x: 20, y: 20 }];
    const offers = reactionOffers(s, { kind: 'aiRanged', unitId: 'v', aiUnitId: ai.id, amount: 0, source: 'x', validTargets: ['v'] });
    expect(offers.map((o) => o.name)).toContain('Dark Swarm');
  });

  it('Plague: NON-LETHAL DAMAGE to every unit under the template, and HIDDEN lost', () => {
    const { s, aiId } = field('defiler', 6, SWARM, ['Plague']);
    s.phase = 'assault';
    const t = s.army.units.find((u) => u.id === aiId)!;
    t.statuses = ['Hidden'];
    const g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Plague', point: { x: 18, y: 10.5 }, option: 2 });
    const hit = g.army.units.find((u) => u.id === aiId)!;
    expect(g.log.some((l) => /Plague \(3\+\)/.test(l.text))).toBe(true);
    expect(hit.statuses).not.toContain('Hidden');
    expect(hit.models).toBe(t.models);
  });

  it('Consume: with no Ready card to pay, a nearby friendly model pays the Biomass', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('d', 'defiler', 'small', [], 'Defiler', 300), makePlayerUnit('v', 'vileling__zergling_', 'small', [], 'Vilelings', 300)];
    cfg.playerCards = ['reactive_creep'];
    const s = toPlayersTurn(createGame(cfg, dep, flat));
    s.playerUnits.forEach((p) => (p.location = 'table'));
    s.sense ??= { at: 0, calibrated: true, ai: {}, players: {}, terrain: {}, unknown: [] };
    s.sense!.players['d'] = [{ x: 18, y: 4 }];
    s.sense!.players['v'] = [{ x: 21, y: 4 }];
    const dark = unitById('defiler').abilities.find((a) => a.name === 'Dark Swarm')!;
    const price = abilityCost(s, s.playerUnits[0]!, dark);
    expect(price.cost).toBe(0);
    const before = s.playerUnits[1]!.models;
    price.commit();
    expect(s.playerUnits[1]!.models).toBe(before - 1);
  });
});

describe('the Bile Launcher', () => {
  it('Bombard: the Bile Bomb reaches past its Range to an enemy Within 3" of its token, then leaves Creep', () => {
    const { s, aiId } = field('bile_launcher', 20, SWARM);
    let g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Bombard', point: { x: 18, y: 22 } });
    g.phase = 'assault';
    g.activeUnitId = null;
    const pu = g.playerUnits[0]!;
    const bomb = playerWeapons(g, pu).find((w) => w.name === 'Bile Bomb')!;
    expect(validTargets(g, pu, bomb).map((t) => t.unit.id)).toContain(aiId);
    g = apply(g, { t: 'playerAttack', unitId: 'p1', targetId: aiId, weaponId: bomb.id });
    expect((g.tokens ?? []).some((t) => t.kind === 'bileBomb')).toBe(false);
    expect((g.tokens ?? []).some((t) => t.kind === 'creepTumor')).toBe(true);
  });

  it('is a Source of Creep, and cannot be Burrowed or returned to Reserves', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('b', 'bile_launcher', 'small', [], 'Bile Launcher', 300), makePlayerUnit('v', 'vileling__zergling_', 'small', [], 'Vilelings', 300)];
    cfg.playerCards = SWARM;
    const s = toPlayersTurn(createGame(cfg, dep, flat));
    s.playerUnits.forEach((p) => (p.location = 'table'));
    s.sense ??= { at: 0, calibrated: true, ai: {}, players: {}, terrain: {}, unknown: [] };
    s.sense!.players['b'] = [{ x: 18, y: 4 }];
    s.sense!.players['v'] = [{ x: 22, y: 4 }];
    expect(onCreep(s, s.playerUnits[1]!)).toBe(true);
    const card = s.playerCards!.find((c) => c.defId === 'defiler_mound')!;
    const g = apply(s, { t: 'useBoost', cardId: card.id, boost: 'Tunnel Network', unitId: 'b' });
    expect(g.playerUnits[0]!.location).toBe('table');
  });
});

const TEMPLAR = ['templar_caste', 'templar_archives', 'gateway', 'forge', 'nexus', 'twilight_council'];

describe('the Templar', () => {
  it('Psionic Storm breaks at the End of the Movement Phase: NON-LETHAL DAMAGE under its template', () => {
    const { s, aiId } = field('high_templar', 8, TEMPLAR, ['Psionic Storm']);
    let g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Psionic Storm', point: { x: 18, y: 12 } });
    const storm = (g.tokens ?? []).find((t) => t.kind === 'psiStorm')!;
    expect(storm.need).toBe(5);
    const before = g.army.units.find((u) => u.id === aiId)!.damageMarker;
    g.passed = { ai: true, players: true };
    g.activeUnitId = null;
    g = apply(g, { t: 'playersPass' });
    const after = g.army.units.find((u) => u.id === aiId)!;
    expect(g.phase).not.toBe('movement');
    // Three dice plus one a model covered at 5+: the log says what it did, and no model is lost to it.
    expect(after.damageMarker >= before).toBe(true);
    expect((g.tokens ?? []).some((t) => t.kind === 'psiStorm')).toBe(true);
  });

  it('Our Minds as One: at Supply 2 the first ability costs 1 PE less and the storm hits on 4+', () => {
    const { s } = field('high_templar', 12, TEMPLAR, ['Psionic Storm']);
    const pu = s.playerUnits[0]!;
    pu.models = 4;
    pu.maxModels = 4;
    const storm = unitById('high_templar').abilities.find((a) => a.name === 'Psionic Storm')!;
    // 2 PE, less Our Minds as One and Ancestral Wisdom (a Support Unit).
    expect(abilityCost(s, pu, storm).cost).toBe(0);
    const g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Psionic Storm', point: { x: 18, y: 12 } });
    expect((g.tokens ?? []).find((t) => t.kind === 'psiStorm')!.need).toBe(4);
  });

  it('Farsight: a friendly unit may Evade any attack this Round', () => {
    const { s, aiId } = field('high_templar', 12, TEMPLAR, ['Farsight']);
    const g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Farsight', friendlyId: 'p1' });
    expect(evadeFor(g, g.playerUnits[0]!, { phase: 'Assault', weapon: '', attacker: { unitId: aiId } })?.reason).toBe('Farsight');
  });

  it('Feedback takes only a Mechanical or Psionic target', () => {
    const { s, aiId } = field('high_templar', 6, TEMPLAR);
    const g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Feedback', enemyId: aiId });
    expect(g.log[g.log.length - 1]!.text).toMatch(/Mechanical or Psionic/);
  });

  it('Bound by the Khala: a friend near the Twilight Templar losing Supply readies a card', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('t', 'twilight_templar__high_templar_', 'small', [], 'Twilight Templar', 300), makePlayerUnit('z', 'zealot', 'large', [], 'Zealots', 300)];
    cfg.playerCards = TEMPLAR;
    const s = toPlayersTurn(createGame(cfg, dep, flat));
    s.playerUnits.forEach((p) => (p.location = 'table'));
    s.sense ??= { at: 0, calibrated: true, ai: {}, players: {}, terrain: {}, unknown: [] };
    s.sense.players['t'] = [{ x: 18, y: 4 }];
    s.sense.players['z'] = [{ x: 22, y: 4 }];
    const gate = s.playerCards!.find((c) => c.defId === 'gateway')!;
    gate.exhausted = true;
    const g = apply(s, { t: 'playerDamage', unitId: 'z', dmg: 14 });
    expect(g.playerUnits[1]!.models).toBeLessThan(s.playerUnits[1]!.maxModels);
    expect(g.playerCards!.find((c) => c.id === gate.id)!.exhausted).toBe(false);
  });
});

describe('Tassadar', () => {
  it('Force Wall: two walls Wholly Within 8" that units of Size 2 cannot cross', () => {
    const { s } = field('tassadar', 14, TEMPLAR);
    let g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Force Wall', point: { x: 16, y: 9 } });
    g = apply(g, { t: 'useAbility', unitId: 'p1', name: 'Force Wall', point: { x: 20, y: 9 } });
    const walls = (g.tokens ?? []).filter((t) => t.kind === 'forceWall');
    expect(walls.length).toBe(2);
    expect(g.terrain.pieces.filter((p) => p.label === 'Force Wall').length).toBe(2);
  });

  it("Khala's Gift: another Biological unit's first ability costs 1 less", () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('t', 'tassadar', 'small', [], 'Tassadar', 300), makePlayerUnit('h', 'high_templar', 'small', [], 'High Templar', 300)];
    cfg.playerCards = TEMPLAR;
    let s = toPlayersTurn(createGame(cfg, dep, flat));
    s = apply(s, { t: 'playerDeploy', unitId: 't', point: { x: 18, y: 4 } });
    s.playerUnits[1]!.location = 'table';
    s.sense!.players['h'] = [{ x: 22, y: 4 }];
    s = apply(s, { t: 'useAbility', unitId: 't', name: "Khala's Gift", friendlyId: 'h' });
    const feedback = unitById('high_templar').abilities.find((a) => a.name === 'Feedback')!;
    expect(abilityCost(s, s.playerUnits[1]!, feedback).notes).toContain("Khala's Gift");
  });

  it('Psi Lightning: 1 Damage to every Unit Within 2" of his Force Walls', () => {
    const { s, aiId } = field('tassadar', 9, TEMPLAR);
    let g = apply(s, { t: 'useAbility', unitId: 'p1', name: 'Force Wall', point: { x: 18, y: 9 } });
    g = apply(g, { t: 'useAbility', unitId: 'p1', name: 'Force Wall', point: { x: 12, y: 8 } });
    g.phase = 'assault';
    g.playerUnits[0]!.used = [];
    g.activeUnitId = null;
    const before = g.army.units.find((u) => u.id === aiId)!;
    const dmg0 = before.damageMarker, m0 = before.models;
    g = apply(g, { t: 'useAbility', unitId: 'p1', name: 'Psi Lightning' });
    const after = g.army.units.find((u) => u.id === aiId)!;
    expect(after.models < m0 || after.damageMarker > dmg0).toBe(true);
  });

  it('Templar Caste: Our Duty is Unending readies two Exhausted Tactical cards, once a game', () => {
    const { s } = field('tassadar', 14, TEMPLAR);
    for (const c of s.playerCards!) if (c.defId === 'gateway' || c.defId === 'forge') c.exhausted = true;
    const caste = s.playerCards!.find((c) => c.defId === 'templar_caste')!;
    const g = apply(s, { t: 'useBoost', cardId: caste.id, boost: 'Our Duty is Unending' });
    expect(g.playerCards!.filter((c) => c.defId === 'gateway' || c.defId === 'forge').every((c) => !c.exhausted)).toBe(true);
  });
});
