import { describe, expect, it } from 'vitest';
import { deploymentById, unitById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { abilityGap, checkAttack, checkCharge, checkDeploy, checkMove, targetReport, validTargets, playerWeapons } from '@engine/player/rules';
import { autoPay, pendingEndOfRound, cardBoosts, cardDef, defensiveDiceRemoval, effectiveSpeed, saveBoostOptions, unitAbilities, weaponWithEffects } from '@engine/abilities/index';
import { makeConfig } from '../engine/helpers';
import type { GameState } from '@engine/types/game';
import { dist } from '@engine/terrain/geometry';
import { availableWeapons, weaponModels } from '@engine/units/weapons';

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

function terranGame(): GameState {
  const cfg = makeConfig({ modeId: 'frontlines' });
  cfg.playerUnits = [makePlayerUnit('m1', 'marine', 'small', [], 'Marines', 100), makePlayerUnit('md', 'medic', 'small', [], 'Medics', 102)];
  cfg.playerCards = ['terran_armed_forces', 'barracks', 'engineering_bay'];
  let s = createGame(cfg, dep, flat);
  s = toPlayersTurn(s);
  s = apply(s, { t: 'playerDeploy', unitId: 'm1', point: { x: 18, y: 3 } });
  s = toPlayersTurn(s);
  // As at the start of a later Movement phase: the Marines have not activated yet.
  s.playerUnits.find((p) => p.id === 'm1')!.activated.movement = false;
  return s;
}

describe('cards and resources', () => {
  it('pays ability costs by exhausting Ready cards, once per round', () => {
    let s = terranGame();
    const m = s.playerUnits.find((p) => p.id === 'm1')!;
    const before = effectiveSpeed(m);
    const stim = unitAbilities(s, m).find((a) => a.ability.name === 'Stimpack')!;
    expect(stim.ok).toBe(true);
    s = apply(s, { t: 'useAbility', unitId: 'm1', name: 'Stimpack' });
    const m2 = s.playerUnits.find((p) => p.id === 'm1')!;
    expect(effectiveSpeed(m2)).toBe(before + 3);
    expect(m2.damageMarker).toBe(2);
    expect(m2.models).toBe(m.models); // non-lethal
    expect(s.playerCards!.filter((c) => c.exhausted).length).toBe(1);
    // Once per round.
    const again = apply(s, { t: 'useAbility', unitId: 'm1', name: 'Stimpack' });
    expect(again.log[again.log.length - 1]!.text).toMatch(/already used/);
    // Stimpack precision reaches the rifle.
    const rifle = { id: 'c14', name: 'C-14 rifle', phase: 'Assault' as const, range: 12, target: 'All' as const, roa: 2, hit: 3, dmg: 1, surgeTypes: [], keywords: [], text: '' };
    const w = weaponWithEffects(m2, rifle, null, 10).weapon;
    expect(w.keywords.find((k) => k.k === 'PRECISION')?.v).toBe(3);
  });

  it('uses a card boost on the active unit and spends first-weapon effects', () => {
    let s = terranGame();
    const bay = s.playerCards!.find((c) => c.defId === 'engineering_bay')!;
    const m = s.playerUnits.find((p) => p.id === 'm1')!;
    expect(cardBoosts(s, m).some((b) => b.boost.name === 'Infantry Weapons' && b.ok)).toBe(true);
    s = apply(s, { t: 'useBoost', cardId: bay.id, boost: 'Infantry Weapons', unitId: 'm1' });
    expect(s.playerCards!.find((c) => c.id === bay.id)!.exhausted).toBe(true);
    const eff = s.playerUnits.find((p) => p.id === 'm1')!.effects!;
    expect(eff.some((e) => e.until === 'firstWeapon' && e.mods.critical === 1)).toBe(true);
  });

  it('refreshes cards and clears round effects at the next round', () => {
    let s = terranGame();
    s = apply(s, { t: 'useAbility', unitId: 'm1', name: 'Stimpack' });
    for (let i = 0; i < 200 && s.round < 2; i++) {
      if (s.step.kind === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
      else if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
      else if (s.step.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
      else if (s.step.kind === 'SCORING_FORM') s = apply(s, { t: 'scoring', answers: { markers: {}, playerSupplyLost: 0, extra: {} } });
      else if (s.step.kind === 'COMBAT_CHECKLIST') s = apply(s, { t: 'checklistDone' });
      else s = apply(s, { t: 'continue' });
    }
    expect(s.round).toBe(2);
    expect(s.playerCards!.every((c) => !c.exhausted)).toBe(true);
    const m = s.playerUnits.find((p) => p.id === 'm1')!;
    expect((m.effects ?? []).length).toBe(0);
    expect(m.used).toEqual([]);
  });
});

describe('summons and tokens', () => {
  it('Khalai Pylon Warp-In summons a Pylon that later acts as an entry point', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('z1', 'zealot', 'small', [], 'Zealots', 110), makePlayerUnit('st', 'stalker', 'small', [], 'Stalkers', 111)];
    cfg.playerCards = ['khalai', 'gateway'];
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    const khalai = s.playerCards!.find((c) => c.defId === 'khalai')!;
    s = apply(s, { t: 'useBoost', cardId: khalai.id, boost: 'Pylon Warp-In', point: { x: 18, y: 16 } });
    const pylon = s.playerUnits.find((p) => p.defId === 'pylon');
    expect(pylon?.location).toBe('table');
    expect(pylon?.summoned).toBe(true);
    // Not usable as an entry point in the round it arrived.
    const st = s.playerUnits.find((p) => p.id === 'st')!;
    // Stalkers have 80mm bases: set them clear of the Pylon's 80mm base.
    expect(checkDeploy(s, st, { x: 18, y: 20 }).ok).toBe(false);
    // Next round it is.
    s = { ...s, round: s.round + 1 };
    expect(checkDeploy(s, st, { x: 18, y: 20 }).via).toBe('Warp Conduit');
  });

  it('Guardian Shield removes a die from ranged attacks at nearby friends', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('se', 'sentry', 'small', [], 'Sentries', 120), makePlayerUnit('z1', 'zealot', 'small', [], 'Zealots', 121)];
    cfg.playerCards = ['daelaam', 'gateway'];
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'se', point: { x: 18, y: 3 } });
    // The Sentries stay active after deploying (they could use an ability); end the activation.
    s = apply(s, { t: 'endActivation' });
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'z1', point: { x: 20, y: 3 } });
    if (s.activeUnitId) s = apply(s, { t: 'endActivation' });
    s = toPlayersTurn(s);
    s.playerUnits.find((p) => p.id === 'se')!.activated.movement = false;
    s = apply(s, { t: 'useAbility', unitId: 'se', name: 'Guardian Shield' });
    const z = s.playerUnits.find((p) => p.id === 'z1')!;
    expect(defensiveDiceRemoval(s, z, false).remove).toBe(1);
  });

  it('Force Field blocks movement across it', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('se', 'sentry', 'small', [], 'Sentries', 130)];
    cfg.playerCards = ['daelaam', 'gateway'];
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'se', point: { x: 18, y: 3 } });
    s = toPlayersTurn(s);
    s.playerUnits.find((p) => p.id === 'se')!.activated.movement = false;
    const pieces = s.terrain.pieces.length;
    s = apply(s, { t: 'useAbility', unitId: 'se', name: 'Force Field', point: { x: 18, y: 8 } });
    expect(s.tokens!.some((t) => t.kind === 'forceField')).toBe(true);
    expect(s.terrain.pieces.length).toBe(pieces + 1);
    const se = s.playerUnits.find((p) => p.id === 'se')!;
    expect(checkMove(s, se, { x: 18, y: 8 }, 'move').ok).toBe(false);
  });
});

describe('save boosts', () => {
  function underFire(s: GameState, hits: number, surge = 0): GameState {
    const ai = s.army.units[0]!;
    const attack = {
      id: 'atk1', attacker: { side: 'ai' as const, unitId: ai.id, label: ai.label }, defender: { side: 'players' as const, unitId: 'm1', label: 'Marines' },
      weapon: 'Test', phase: 'Assault' as const, models: 1, dice: hits, hit: 3, hitMod: 0, rolls: [], precisionUsed: 0, hits,
      surge: surge ? { die: 'D3', roll: surge, applied: surge, matched: true } : undefined, critical: 0, armour: 4, saveRolls: [], saved: 0, toughUsed: 0,
      dmgPer: 1, damage: 0, removed: 0, modelsAfter: 6, destroyed: false, pendingSaves: true,
    };
    s.pendingSaves = { attack, order: { unitId: ai.id, type: 'ranged', title: 't', lines: [], batches: [] } as never, report: '', remaining: [] };
    s.step = { kind: 'AI_SAVES', attack };
    return s;
  }

  it('offers Infantry Armor, and TOUGH turns a failed save into a success', () => {
    const s = terranGame();
    const m1 = s.playerUnits.find((p) => p.id === 'm1')!;
    const opts = saveBoostOptions(s, m1);
    expect(opts.map((o) => o.name)).toContain('Infantry Armor');
    const bay = opts.find((o) => o.name === 'Infantry Armor')!.card.id;
    const without = apply(underFire(structuredClone(s), 4), { t: 'enterSaves', saved: 1 });
    const withTough = apply(underFire(structuredClone(s), 4), { t: 'enterSaves', saved: 1, boostCards: [bay] });
    expect(without.lastAttack!.damage).toBe(3);
    expect(withTough.lastAttack!.saved).toBe(2);
    expect(withTough.lastAttack!.damage).toBe(2);
    expect(withTough.playerCards!.find((c) => c.id === bay)!.exhausted).toBe(true);
  });

  it('pays ability costs with cards that do not hold save boosts first', () => {
    const s = terranGame();
    const pay = autoPay(s, 1)!;
    expect(pay.length).toBeGreaterThan(0);
    expect(pay.some((c) => cardDef(c.defId)!.boosts.some((b) => b.name === 'Infantry Armor'))).toBe(false);
  });
});

describe('end of round', () => {
  it('Psionic Transfer moves the Adepts to their Shade when you choose it at the end of the round', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('ad', 'adept', 'small', [], 'Adepts', 160)];
    cfg.playerCards = ['daelaam', 'gateway'];
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'ad', point: { x: 18, y: 3 } });
    expect(s.activeUnitId).toBe('ad');
    s = apply(s, { t: 'useAbility', unitId: 'ad', name: 'Psionic Transfer', point: { x: 18, y: 12 } });
    expect(s.tokens!.some((t) => t.kind === 'shade')).toBe(true);
    s.step = { kind: 'ROUND_END', lines: [] };
    const pending = pendingEndOfRound(s);
    expect(pending.map((p) => p.kind)).toEqual(['shade']);
    const moved = apply(s, { t: 'endOfRoundEffect', tokenId: pending[0]!.token.id, accept: true });
    expect(moved.sense!.players['ad']![0]).toEqual({ x: 18, y: 12 });
    expect(pendingEndOfRound(moved)).toHaveLength(0);
    const stayed = apply(s, { t: 'endOfRoundEffect', tokenId: pending[0]!.token.id, accept: false });
    expect(stayed.sense!.players['ad']![0]).toEqual({ x: 18, y: 3 });
  });
});

describe('ranged targets', () => {
  it('a Stalker can shoot Roaches 5" away once they are no longer engaged, and explains when it cannot', () => {
    // The simulation: the app reads engagement from where the models stand (on the tabletop that call is yours).
    const cfg = makeConfig({ modeId: 'frontlines', playMode: 'video' });
    cfg.playerUnits = [makePlayerUnit('st', 'stalker', 'small', [], 'Stalkers', 170), makePlayerUnit('z1', 'zealot', 'small', [], 'Zealots', 171)];
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'st', point: { x: 18, y: 3 } });
    const ai = s.army.units[0]!;
    ai.location = 'table';
    ai.est = { x: 18, y: 15 };
    s.sense!.ai = {};
    s.sense!.players['st'] = [{ x: 18, y: 10 }];
    s.playerUnits[0]!.location = 'table';
    s.playerUnits[1]!.location = 'table';
    s.sense!.players['z1'] = [{ x: 5, y: 5 }];
    // Left over from an earlier charge: flagged engaged, but nothing of yours is next to it.
    ai.engaged = true;
    s.phase = 'assault';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s.activeUnitId = null;
    for (const p of s.playerUnits) p.activated.assault = false;
    // Any position update recomputes engagement.
    s = apply(s, { t: 'playerHold', unitId: 'z1' });
    const st = s.playerUnits.find((p) => p.id === 'st')!;
    const w = playerWeapons(s, st).find((x) => x.name === 'Particle Disruptors')!;
    expect(s.army.units[0]!.engaged).toBe(false);
    expect(validTargets(s, st, w).map((t) => t.unit.id)).toContain(ai.id);
    // Far away: the report says why.
    s.army.units[0]!.est = { x: 18, y: 30 };
    const far = targetReport(s, st, w).find((r) => r.unit.id === ai.id)!;
    expect(far.ok).toBe(false);
    expect(far.reason).toMatch(/Out of range/);
  });
});

describe('burrow', () => {
  function roachGame(): GameState {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('r1', 'roach', 'small', ['roach:tunneling-claws:1'], 'Roaches', 180)];
    cfg.playerCards = ['zerg_swarm', 'evolution_chamber'];
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'r1', point: { x: 18, y: 3 } });
    if (s.activeUnitId) s = apply(s, { t: 'endActivation' });
    s = toPlayersTurn(s);
    s.activeUnitId = null;
    return s;
  }

  it('Burrowed Roaches cannot shoot or charge, keep Burrowed through a Move (Tunneling Claws) and Regenerate', () => {
    let s = roachGame();
    const r = () => s.playerUnits.find((p) => p.id === 'r1')!;
    s.phase = 'movement';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    r().activated.movement = false;
    s = apply(s, { t: 'useAbility', unitId: 'r1', name: 'Burrow' });
    expect(r().statuses).toContain('Burrowed');
    r().damageMarker = 3;
    r().activated.movement = false;
    s.phase = 'movement';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s = apply(s, { t: 'playerMove', unitId: 'r1', point: { x: 18, y: 6 }, kind: 'move' });
    if (s.activeUnitId) s = apply(s, { t: 'endActivation' });
    expect(r().statuses).toContain('Burrowed');
    expect(r().damageMarker).toBe(1);
    // Assault: no shooting or charging while Burrowed.
    const ai = s.army.units[0]!;
    ai.location = 'table';
    s.sense!.ai[ai.id] = [{ x: 18, y: 10 }];
    s.phase = 'assault';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    r().activated.assault = false;
    const w = playerWeapons(s, r()).find((x) => x.phase === 'Assault')!;
    expect(checkAttack(s, r(), w, ai).ok).toBe(false);
    expect(checkCharge(s, r(), ai).ok).toBe(false);
  });

  it('Burrow Ambush lets a Zerg unit deploy up to 18" from the entry edge, away from enemies', () => {
    const s = roachGame();
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('h1', 'hydralisk', 'small', ['hydralisk:burrow-ambush:3'], 'Hydralisks', 181)];
    let g = createGame(cfg, dep, flat);
    g = toPlayersTurn(g);
    void s;
    const h = g.playerUnits[0]!;
    const deep = checkDeploy(g, h, { x: 18, y: 16 });
    expect(deep.ok).toBe(true);
    expect(deep.via).toBe('Burrow Ambush');
  });
});

describe('follow-up rules', () => {
  it('a Burrowed unit evades dice from the damage pool when you roll your own saves', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('r1', 'roach', 'small', [], 'Roaches', 190)];
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'r1', point: { x: 18, y: 3 } });
    if (s.activeUnitId) s = apply(s, { t: 'endActivation' });
    const r = s.playerUnits.find((p) => p.id === 'r1')!;
    r.statuses = ['Burrowed'];
    const ai = s.army.units[0]!;
    const attack = {
      id: 'ev1', attacker: { side: 'ai' as const, unitId: ai.id, label: ai.label }, defender: { side: 'players' as const, unitId: 'r1', label: 'Roaches' },
      weapon: 'Test', phase: 'Assault' as const, models: 1, dice: 4, hit: 3, hitMod: 0, rolls: [], precisionUsed: 0, hits: 4,
      critical: 0, armour: 3, saveRolls: [], saved: 0, toughUsed: 0, dmgPer: 1, damage: 0, removed: 0, modelsAfter: r.models, destroyed: false, pendingSaves: true,
    };
    s.pendingSaves = { attack, order: { unitId: ai.id, type: 'ranged', title: 't', lines: [], batches: [] } as never, report: '', remaining: [] };
    s.step = { kind: 'AI_SAVES', attack };
    const plain = apply(structuredClone(s), { t: 'enterSaves', saved: 1 });
    const evaded = apply(structuredClone(s), { t: 'enterSaves', saved: 1, evaded: 2 });
    expect(plain.lastAttack!.damage).toBe(3);
    expect(evaded.lastAttack!.damage).toBe(1);
    expect(evaded.lastAttack!.evade?.reason).toBe('Burrowed');
  });

  it('uses your IMPACT dice for Devastating Charge', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('z1', 'zealot', 'small', [], 'Zealots', 191)];
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'z1', point: { x: 18, y: 4 } });
    const ai = s.army.units[0]!;
    ai.location = 'table';
    s.sense!.ai[ai.id] = [{ x: 18, y: 12 }];
    s.phase = 'assault';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s.activeUnitId = null;
    s.playerUnits[0]!.activated.assault = false;
    const dice = 3 * s.playerUnits[0]!.models;
    const hit = apply(s, { t: 'playerCharge', unitId: 'z1', targetId: ai.id, roll: 6, impactRolls: Array(dice).fill(6) });
    expect(hit.lastAttack!.phase).toBe('Impact');
    expect(hit.lastAttack!.rolls).toEqual(Array(dice).fill(6));
    expect(hit.lastAttack!.hits).toBe(dice);
  });

  it('measures an ability\'s range base to base, as every range is measured', () => {
    // Target Lock: an enemy Within 12" of the Goliath. Both bases are wide, so the gap between them is well
    // short of 12" while their centres are further apart than that.
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('g1', 'goliath', 'large', [], 'Goliath', 140)];
    cfg.playerCards = ['terran_armed_forces', 'barracks', 'engineering_bay'];
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'g1', point: { x: 18, y: 4 } });
    s = toPlayersTurn(s);
    s.phase = 'movement';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s.activeUnitId = null;
    s.playerUnits[0]!.activated.movement = false;
    const ai = s.army.units[0]!;
    ai.location = 'table';
    const me = s.sense!.players['g1']![0]!;
    s.sense!.ai[ai.id] = [{ x: me.x, y: me.y + 12.4 }];
    expect(dist(me, s.sense!.ai[ai.id]![0]!)).toBeGreaterThan(12);
    expect(abilityGap(s, s.playerUnits[0]!, 'ai', ai.id)).toBeLessThan(12);
    const locked = apply(s, { t: 'useAbility', unitId: 'g1', name: 'Target Lock', enemyId: ai.id });
    expect(locked.army.units[0]!.debuffs?.some((d) => d.targetLock)).toBe(true);
    // Out of range by the same measure: refused.
    s.sense!.ai[ai.id] = [{ x: me.x, y: me.y + 18 }];
    const missed = apply(s, { t: 'useAbility', unitId: 'g1', name: 'Target Lock', enemyId: ai.id });
    expect(missed.log[missed.log.length - 1]!.text).toMatch(/out of range/);
  });

  it('a SPECIALIST upgrade is carried by one model and leaves the unit its own weapon', () => {
    const def = unitById('marine');
    const agg = def.weapons.find((w) => w.name === 'AGG-12')!;
    const plain = availableWeapons(def, [], 'Assault');
    expect(plain.map((w) => w.name)).toEqual(['C-14 rifle']);
    // With the AGG-12 bought, the squad still carries its rifles: eight of them, and one AGG-12.
    const armed = availableWeapons(def, [agg.id], 'Assault');
    expect(armed.map((w) => w.name).sort()).toEqual(['AGG-12', 'C-14 rifle']);
    expect(weaponModels(def, [agg.id], 'Assault', agg, 9)).toBe(1);
    expect(weaponModels(def, [agg.id], 'Assault', armed.find((w) => w.name === 'C-14 rifle')!, 9)).toBe(8);
  });

  it('refuses a drop-point deploy without enough Supply', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('z1', 'zealot', 'large', [], 'Zealots', 192)];
    let s = createGame(cfg, dep, flat);
    s.tokens = [{ id: 'dp', kind: 'dropPoint', x: 18, y: 18, label: 'Warp Conduit', round: s.round }];
    s.step = { kind: 'ROUND_END', lines: [] };
    s.playerSupply = { start: 0, escalation: 0 };
    s.playerUnits[0]!.location = 'reserves';
    const out = apply(s, { t: 'endOfRoundEffect', tokenId: 'dp', accept: true, unitId: 'z1' });
    expect(out.playerUnits[0]!.location).toBe('reserves');
  });
});

describe('activation', () => {
  it('a Stalker can move and then Blink while it is still active; other units wait', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('st', 'stalker', 'small', [], 'Stalkers', 150), makePlayerUnit('z1', 'zealot', 'small', [], 'Zealots', 151)];
    cfg.playerCards = ['daelaam', 'gateway'];
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'st', point: { x: 18, y: 3 } });
    expect(s.activeUnitId).toBe('st');
    expect(s.step.kind).toBe('PLAYERS_TURN');
    // Another unit cannot act until the Stalkers finish.
    const blocked = apply(s, { t: 'playerDeploy', unitId: 'z1', point: { x: 22, y: 3 } });
    expect(blocked.playerUnits.find((p) => p.id === 'z1')!.location).toBe('reserves');
    const st = s.playerUnits.find((p) => p.id === 'st')!;
    expect(unitAbilities(s, st).find((a) => a.ability.name === 'Blink')?.ok).toBe(true);
    s = apply(s, { t: 'useAbility', unitId: 'st', name: 'Blink' });
    s = apply(s, { t: 'playerPlace', unitId: 'st', point: { x: 18, y: 8 } });
    expect(s.sense!.players['st']![0]).toEqual({ x: 18, y: 8 });
    s = apply(s, { t: 'endActivation' });
    expect(s.activeUnitId).toBeNull();
    expect(s.step.kind).not.toBe('PLAYERS_TURN');
  });
});

describe('charges', () => {
  it('moves the unit into contact only when the charge roll succeeds', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('z1', 'zealot', 'small', [], 'Zealots', 140)];
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'z1', point: { x: 18, y: 4 } });
    // Put an AI unit 12" away (Zealots: Speed 7 + the roll) on the table and move to the Assault phase on the players' turn.
    const ai = s.army.units[0]!;
    ai.location = 'table';
    s.sense!.ai[ai.id] = [{ x: 18, y: 16 }];
    s.phase = 'assault';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s.playerUnits[0]!.activated.assault = false;
    const failed = apply(s, { t: 'playerCharge', unitId: 'z1', targetId: ai.id, roll: 1 });
    const hit = apply(s, { t: 'playerCharge', unitId: 'z1', targetId: ai.id, roll: 6 });
    expect(failed.lastCharge?.success).toBe(false);
    expect(failed.sense!.players['z1']![0]).toEqual({ x: 18, y: 4 });
    expect(hit.lastCharge?.success).toBe(true);
    const hp = hit.sense!.players['z1']![0]!;
    expect(Math.hypot(hp.x - 18, hp.y - 16)).toBeLessThan(1.5);
    expect(hit.playerUnits[0]!.engaged).toBe(true);
  });
});

describe('Terran Tenacity', () => {
  it('is offered as a phase opens while the AI holds the First Player Marker, and claimed you go first', async () => {
    const { tenacityOffer } = await import('@engine/abilities/index');
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('m1', 'marine', 'small', [], 'Marines', 100)];
    cfg.playerCards = ['terran_armed_forces'];
    let s = createGame(cfg, dep, flat);
    for (let i = 0; i < 5 && s.step.kind !== 'PHASE_START'; i++) s = apply(s, { t: 'continue' });
    expect(s.step.kind).toBe('PHASE_START');
    s.firstPlayer = 'ai';
    s.turn = 'ai';
    const card = tenacityOffer(s);
    expect(card?.defId).toBe('terran_armed_forces');
    s = apply(s, { t: 'useBoost', cardId: card!.id, boost: 'Terran Tenacity' });
    expect(s.firstPlayer).toBe('players');
    s = apply(s, { t: 'continue' });
    expect(s.step.kind).toBe('PLAYERS_TURN');
    // Once per game: never offered again.
    s.step = { kind: 'PHASE_START', lines: [] };
    s.firstPlayer = 'ai';
    s.playerCards!.forEach((c) => { c.exhausted = false; });
    expect(tenacityOffer(s)).toBeNull();
  });
});

describe('reactions to damage a unit does to itself', () => {
  /** Marines and Medics on the table beside each other, the Marines ready to Stim. */
  function stimGame(): GameState {
    const s = terranGame();
    const md = s.playerUnits.find((p) => p.id === 'md')!;
    md.location = 'table';
    const near = s.sense!.players['m1']![0]!;
    s.sense!.players['md'] = [{ x: near.x + 2, y: near.y }, { x: near.x + 2.6, y: near.y + 0.8 }];
    return s;
  }

  it('offers Life Support against Stimpack, and using it soaks the non-lethal damage', () => {
    let s = stimGame();
    s = apply(s, { t: 'useAbility', unitId: 'm1', name: 'Stimpack' });
    // The damage is taken, and the Medic beside the squad is asked before it settles.
    expect(s.playerUnits.find((p) => p.id === 'm1')!.damageMarker).toBe(2);
    expect(s.pendingReaction).toMatchObject({ unitId: 'm1', amount: 2, source: 'Stimpack' });
    const key = `md:Life Support`;
    s = apply(s, { t: 'damageReaction', key });
    expect(s.pendingReaction).toBeUndefined();
    // Two Medic models within 4": two damage soaked, and the Medics have spent their Reaction.
    expect(s.playerUnits.find((p) => p.id === 'm1')!.damageMarker).toBe(0);
    expect(s.playerUnits.find((p) => p.id === 'md')!.used).toContain('Life Support');
    expect(s.log.some((e) => /Life Support/.test(e.text))).toBe(true);
  });

  it('keeps the damage when the offer is declined, and asks nothing with no Medic in range', () => {
    let s = stimGame();
    s = apply(s, { t: 'useAbility', unitId: 'm1', name: 'Stimpack' });
    s = apply(s, { t: 'damageReaction' });
    expect(s.pendingReaction).toBeUndefined();
    expect(s.playerUnits.find((p) => p.id === 'm1')!.damageMarker).toBe(2);

    let far = stimGame();
    const near = far.sense!.players['m1']![0]!;
    far.sense!.players['md'] = [{ x: near.x + 12, y: near.y }];
    far = apply(far, { t: 'useAbility', unitId: 'm1', name: 'Stimpack' });
    expect(far.pendingReaction).toBeUndefined();
  });

  it('announces heals, buffs and debuffs as events the map can show', () => {
    let s = stimGame();
    s.playerUnits.find((p) => p.id === 'm1')!.damageMarker = 3;
    s.activeUnitId = null;
    s = apply(s, { t: 'useAbility', unitId: 'md', name: 'Medpack', friendlyId: 'm1' });
    const heal = (s.events ?? []).filter((e) => e.kind === 'effect');
    expect(heal.some((e) => e.kind === 'effect' && e.unitId === 'm1' && /HEALED/.test(e.label) && e.tone === 'good')).toBe(true);
    // A buff shows up the same way.
    s = apply(s, { t: 'useAbility', unitId: 'm1', name: 'Stimpack' });
    expect((s.events ?? []).some((e) => e.kind === 'effect' && /STIMPACK/.test(e.label))).toBe(true);
  });
});
