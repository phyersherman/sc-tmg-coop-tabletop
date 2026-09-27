import { describe, expect, it } from 'vitest';
import { deploymentById, unitById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { checkDeploy, checkMove, validTargets, chargeOptions, playerAvailable, weaponSpent } from '@engine/player/rules';
import { resolveAttack, completeSaves } from '@engine/combat/resolve';
import { Rng } from '@engine/rng';
import { makeConfig } from '../engine/helpers';
import type { GameState } from '@engine/types/game';

const dep = deploymentById('abandoned-camp');
const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };

function toPlayersTurn(s: GameState): GameState {
  for (let i = 0; i < 50 && s.step.kind !== 'PLAYERS_TURN'; i++) {
    if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
    else if (s.step.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
    else s = apply(s, { t: 'continue' });
  }
  return s;
}

describe('attack resolution', () => {
  it('runs the full sequence with preset dice', () => {
    const marine = unitById('marine');
    const w = marine.weapons.find((x) => x.name === 'C-14 rifle')!;
    const zergling = unitById('zergling');
    const a = resolveAttack(Rng.from(3), {
      attacker: { side: 'players', unitId: 'p', label: 'Marines' }, defender: { side: 'ai', unitId: 'z', label: 'Zerglings' },
      weapon: w, models: 6, phase: 'Assault', defenderDef: zergling, defenderState: { models: 12, damageMarker: 0, shieldsLeft: 0 },
      presetRolls: [6, 6, 6, 6, 6, 6, 1, 1, 1, 1, 1, 1], presetSurge: 2,
    });
    expect(a.dice).toBe(12);
    expect(a.hits).toBe(6);
    expect(a.surge?.matched).toBe(true); // zerglings are Light
    expect(a.surge?.applied).toBe(2);
    expect(a.saveRolls.length).toBe(4);
    expect(a.damage).toBe(a.dmgPer * (2 + (4 - a.saved)));
    expect(a.modelsAfter).toBe(12 - a.damage); // 1 HP each
  });
  it('supports manual saves', () => {
    const marine = unitById('marine');
    const w = marine.weapons.find((x) => x.name === 'C-14 rifle')!;
    const a = resolveAttack(Rng.from(1), { attacker: { side: 'ai', unitId: 'a', label: 'A' }, defender: { side: 'players', unitId: 'p', label: 'P' }, weapon: w, models: 3, phase: 'Assault', defenderDef: marine, defenderState: { models: 6, damageMarker: 0, shieldsLeft: 0 }, manualSaves: true, presetRolls: [6, 6, 6, 6, 6, 6] });
    expect(a.pendingSaves).toBe(true);
    expect(a.damage).toBe(0);
    const done = completeSaves(a, 4, marine, { models: 6, damageMarker: 0, shieldsLeft: 0 });
    expect(done.attack.damage).toBe(2);
    expect(done.result.models).toBe(5);
  });
});

describe('player rules', () => {
  const cfg = makeConfig({ modeId: 'frontlines' });
  cfg.playerUnits = [makePlayerUnit('m1', 'marine', 'small', [], 'Marines', 100), makePlayerUnit('g1', 'goliath', 'small', [], 'Goliath', 101)];
  it('lets a SIDEARM fire in the same activation as the main weapon, each weapon once', () => {
    const s = createGame(cfg, dep, flat);
    s.phase = 'assault';
    const g = s.playerUnits.find((p) => p.id === 'g1')!;
    const w = (name: string) => unitById('goliath').weapons.find((x) => x.name === name)!;
    const cannon = w('Autocannon'), mg = w('Underbelly Machine Gun');
    expect(weaponSpent(s, g, cannon)).toBeNull();
    // It fired its Autocannon and is still the active unit.
    g.activated.assault = true;
    g.firedThisActivation = [cannon.id];
    s.activeUnitId = 'g1';
    expect(weaponSpent(s, g, mg)).toBeNull();
    expect(weaponSpent(s, g, cannon)).toMatch(/already used/);
    // Sidearm first: the main weapon is still free, the sidearm is not.
    g.firedThisActivation = [mg.id];
    expect(weaponSpent(s, g, cannon)).toBeNull();
    expect(weaponSpent(s, g, mg)).toMatch(/already used/);
    // Once its activation is over, nothing more.
    s.activeUnitId = null;
    expect(weaponSpent(s, g, mg)).toMatch(/already acted/);
  });
  it('deploys only inside the rules', () => {
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    const m = s.playerUnits[0]!;
    expect(checkDeploy(s, m, { x: 18, y: 2 }).ok).toBe(true); // blue edge is the top
    expect(checkDeploy(s, m, { x: 18, y: 10 }).ok).toBe(false); // too far from the edge
    expect(checkDeploy(s, m, { x: 18, y: 34 }).ok).toBe(false); // AI zone / far
    expect(playerAvailable(s)).toBe(3);
    s = apply(s, { t: 'playerDeploy', unitId: 'm1', point: { x: 18, y: 2 } });
    expect(s.playerUnits[0]!.location).toBe('table');
    expect(s.playerUnits[0]!.activated.movement).toBe(true);
    // The unit stays active for coherency adjustments until its activation ends.
    expect(s.activeUnitId).toBe('m1');
    s = apply(s, { t: 'endActivation' });
    expect(s.turn === 'ai' || s.step.kind !== 'PLAYERS_TURN' || s.passed.ai).toBe(true);
  });
  it('limits moves to speed and legal endpoints', () => {
    let s = createGame(cfg, dep, flat);
    s = toPlayersTurn(s);
    s = apply(s, { t: 'playerDeploy', unitId: 'm1', point: { x: 18, y: 2 } });
    s = toPlayersTurn(s);
    // Next player activation in the movement phase: moving the same unit again is illegal, the goliath can deploy.
    const m = s.playerUnits[0]!;
    if (s.phase === 'movement') {
      expect(checkMove(s, m, { x: 18, y: 5 }, 'move').ok).toBe(false);
    }
    // Fresh game: move check math.
    let s2 = createGame(cfg, dep, flat);
    s2.playerUnits[0]!.location = 'table';
    s2.sense = { at: 0, calibrated: true, manual: true, ai: {}, players: { m1: [{ x: 18, y: 10 }] }, terrain: {}, unknown: [] };
    s2 = toPlayersTurn(s2);
    if (s2.phase === 'movement' && s2.step.kind === 'PLAYERS_TURN') {
      // A squad of Marines moves at the lower of 4"/7" (a lone Marine would move 7").
      expect(checkMove(s2, s2.playerUnits[0]!, { x: 18, y: 14 }, 'move').ok).toBe(true); // 4"
      expect(checkMove(s2, s2.playerUnits[0]!, { x: 18, y: 16 }, 'move').ok).toBe(false); // 6" > speed 4
    }
  });
  it('lists legal targets by range and line of sight', () => {
    let s = createGame(cfg, dep, flat);
    s.playerUnits[0]!.location = 'table';
    const z = s.army.units[0]!;
    z.location = 'table';
    s.sense = { at: 0, calibrated: true, manual: true, ai: { [z.id]: [{ x: 18, y: 20 }] }, players: { m1: [{ x: 18, y: 10 }] }, terrain: {}, unknown: [] };
    const m = s.playerUnits[0]!;
    const w = unitById('marine').weapons.find((x) => x.name === 'C-14 rifle')!;
    expect(validTargets(s, m, w).map((t) => t.unit.id)).toEqual([z.id]); // 10" < 12"
    s.sense.ai[z.id] = [{ x: 18, y: 30 }];
    expect(validTargets(s, m, w)).toEqual([]); // 20" away
    s.sense.ai[z.id] = [{ x: 18, y: 16 }];
    expect(chargeOptions(s, m).map((c) => c.unit.id)).toEqual([z.id]);
  });
});

describe('autopilot', () => {
  it('plays a whole game against a placed player army without any confirmations', () => {
    const cfg = makeConfig({ modeId: 'frontlines', difficulty: 'hard' });
    cfg.options.autopilot = true;
    cfg.playerUnits = [makePlayerUnit('m1', 'marine', 'large', [], 'Marines', 100), makePlayerUnit('g1', 'goliath', 'small', [], 'Goliath', 101), makePlayerUnit('r1', 'marauder', 'small', [], 'Marauders', 102)];
    let s = createGame(cfg, dep, flat);
    let steps = 0;
    let attacks = 0;
    while (s.status === 'playing' && steps < 1500) {
      steps++;
      const st = s.step;
      if (st.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
      else if (st.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 1 });
      else if (st.kind === 'PLAYERS_TURN' && s.activeUnitId) s = apply(s, { t: 'endActivation' });
      else if (st.kind === 'PLAYERS_TURN') {
        // Deploy in the movement phase, then push toward the centre and shoot when possible.
        const reserve = s.playerUnits.find((p) => p.location === 'reserves');
        const acted = false;
        if (s.phase === 'movement' && reserve && checkDeploy(s, reserve, { x: 12 + s.playerUnits.indexOf(reserve) * 6, y: 3 }).ok) {
          s = apply(s, { t: 'playerDeploy', unitId: reserve.id, point: { x: 12 + s.playerUnits.indexOf(reserve) * 6, y: 3 } });
          continue;
        }
        const ready = s.playerUnits.find((p) => p.location === 'table' && !p.activated[s.phase === 'combat' ? 'combat' : s.phase === 'assault' ? 'assault' : 'movement']);
        if (!ready) {
          s = apply(s, { t: 'playersPass' });
          continue;
        }
        if (s.phase === 'assault') {
          const w = unitById(ready.defId).weapons.find((x) => x.phase === 'Assault' && !x.upgradeCost && x.target !== 'Flying')!;
          const ts = validTargets(s, ready, w);
          if (ts.length) {
            s = apply(s, { t: 'playerAttack', unitId: ready.id, weaponId: w.id, targetId: ts[0]!.unit.id });
            attacks++;
            continue;
          }
        }
        if (s.phase === 'movement' && !ready.engaged) {
          const pos = s.sense!.players[ready.id]![0]!;
          const to = { x: pos.x, y: Math.min(pos.y + 4, 30) };
          if (checkMove(s, ready, to, 'move').ok) {
            s = apply(s, { t: 'playerMove', unitId: ready.id, point: to, kind: 'move' });
            continue;
          }
        }
        if (!acted) s = apply(s, { t: 'playerHold', unitId: ready.id });
      } else if (st.kind === 'COMBAT_CHECKLIST') s = apply(s, { t: 'checklistDone' });
      else if (st.kind === 'SCORING_FORM') {
        const markers: Record<number, 'ai' | 'players' | 'contested' | 'none'> = {};
        for (const m of s.markers) markers[m.id] = 'none';
        s = apply(s, { t: 'scoring', answers: { markers, playerSupplyLost: 0, extra: { playerReserveSupply: 0 } } });
      } else s = apply(s, { t: 'continue' });
    }
    expect(s.status).not.toBe('playing');
    expect(s.attackLog.length + attacks).toBeGreaterThan(0);
    expect(s.log.some((l) => /fires|charges|IMPACT/.test(l.text))).toBe(true);
  });
});
