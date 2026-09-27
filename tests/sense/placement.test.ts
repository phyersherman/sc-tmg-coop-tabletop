import { describe, expect, it } from 'vitest';
import { deploymentById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { chargeOptions, checkCloseRanks, checkMove, validTargets, playerWeapons } from '@engine/player/rules';
import { effectiveSpeed } from '@engine/abilities/index';
import { coherencyOf, whollyWithinGap, combatRanks, checkModelAdjust, edgeDistance, moveReach, pathOptionsFor, placeUnit, shapeAt, unitShapes, CONTACT_IN } from '@engine/sense/placement';
import { shortestPath } from '@engine/sense/geometry2d';
import { destinationToward } from '@engine/sense/query';
import { baseOf } from '@data/bases';
import { makeConfig } from '../engine/helpers';
import type { GameState } from '@engine/types/game';

const dep = deploymentById('abandoned-camp');
const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };

function game(): GameState {
  // The simulation: engagement follows the models' positions (on the tabletop it is the players' call).
  const cfg = makeConfig({ modeId: 'frontlines', playMode: 'video' });
  cfg.playerUnits = [
    makePlayerUnit('zl', 'zealot', 'large', [], 'Zealots', 200),
    makePlayerUnit('st', 'stalker', 'large', [], 'Stalkers', 201),
    makePlayerUnit('hy', 'hydralisk', 'large', [], 'Hydralisks', 202),
  ];
  const s = createGame(cfg, dep, flat);
  for (const p of s.playerUnits) p.location = 'table';
  return s;
}

function allBases(s: GameState) {
  return [
    ...s.playerUnits.filter((p) => p.location === 'table').flatMap((p) => unitShapes(s, 'players', p.id).map((b) => ({ id: p.id, b }))),
    ...s.army.units.filter((u) => u.location === 'table').flatMap((u) => unitShapes(s, 'ai', u.id).map((b) => ({ id: u.id, b }))),
  ];
}

describe('bases and placement', () => {
  it('knows base sizes, including the Hydralisk oval', () => {
    expect(baseOf('marine').r).toBeCloseTo(16 / 25.4, 5);
    expect(baseOf('stalker').r).toBeCloseTo(40 / 25.4, 5);
    const h = baseOf('hydralisk');
    expect(h.oval).toBe(true);
    expect(h.r * 2 + h.half * 2).toBeCloseTo(100 / 25.4, 5);
  });

  it('places mixed units next to each other with no overlapping bases and every model in coherency', () => {
    const s = game();
    placeUnit(s, 'players', 'zl', { x: 10, y: 10 });
    placeUnit(s, 'players', 'st', { x: 13, y: 10 });
    placeUnit(s, 'players', 'hy', { x: 11, y: 14 }, { facing: Math.PI / 2 });
    const ai = s.army.units[0]!;
    ai.location = 'table';
    placeUnit(s, 'ai', ai.id, { x: 12, y: 18 });
    const bases = allBases(s);
    for (let i = 0; i < bases.length; i++) for (let j = i + 1; j < bases.length; j++) {
      expect(edgeDistance(bases[i]!.b, bases[j]!.b)).toBeGreaterThan(-0.02);
    }
    for (const id of ['zl', 'st', 'hy']) {
      const [lead, ...rest] = unitShapes(s, 'players', id);
      // Wholly Within Horizontal Coherency (3", or 4" with Squadron) of the leader's base edge.
      for (const m of rest) expect(whollyWithinGap(m, lead!), id).toBeLessThanOrEqual(coherencyOf(s.playerUnits.find((p) => p.id === id)!.defId) + 0.01);
    }
    expect(unitShapes(s, 'players', 'zl')).toHaveLength(s.playerUnits[0]!.models);
  });

  it('keeps a unit without Squadron inside 3", even hemmed in by its neighbours', () => {
    // Zealots have no Squadron: 3" is the whole allowance, and a crowd is no excuse to spread to 4".
    const s = game();
    placeUnit(s, 'players', 'st', { x: 10.5, y: 10 });
    placeUnit(s, 'players', 'hy', { x: 10, y: 13.5 });
    placeUnit(s, 'players', 'zl', { x: 10, y: 11.8 });
    const [lead, ...rest] = unitShapes(s, 'players', 'zl');
    expect(rest.length).toBeGreaterThan(0);
    for (const m of rest) expect(whollyWithinGap(m, lead!)).toBeLessThanOrEqual(3.01);
  });

  it('measures engagement edge to edge: 32mm bases 2.4" apart (centres) are not engaged, 2.1" apart are', () => {
    const r = baseOf('marine').r;
    const a = shapeAt('marine', { x: 0, y: 0 });
    expect(edgeDistance(a, shapeAt('marine', { x: 2.4, y: 0 }))).toBeCloseTo(2.4 - 2 * r, 5);
    expect(edgeDistance(a, shapeAt('marine', { x: 2.4, y: 0 })) <= 1).toBe(false);
    expect(edgeDistance(a, shapeAt('marine', { x: 2.1, y: 0 })) <= 1).toBe(true);
  });

  it('a successful charge sets the leader base-to-base and engages', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('z1', 'zealot', 'small', [], 'Zealots', 210)];
    let s = createGame(cfg, dep, flat);
    s.playerUnits[0]!.location = 'table';
    placeUnit(s, 'players', 'z1', { x: 18, y: 4 });
    const ai = s.army.units[0]!;
    ai.location = 'table';
    placeUnit(s, 'ai', ai.id, { x: 18, y: 14 });
    s.phase = 'assault';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    const opt = chargeOptions(s, s.playerUnits[0]!).find((c) => c.unit.id === ai.id)!;
    expect(opt.needed).toBeLessThan(10);
    s = apply(s, { t: 'playerCharge', unitId: 'z1', targetId: ai.id, roll: 6 });
    expect(s.lastCharge?.success).toBe(true);
    const lead = unitShapes(s, 'players', 'z1')[0]!;
    const gap = Math.min(...unitShapes(s, 'ai', ai.id).map((b) => edgeDistance(lead, b)));
    expect(gap).toBeLessThanOrEqual(CONTACT_IN);
    expect(s.playerUnits[0]!.engaged).toBe(true);
    const bases = allBases(s);
    for (let i = 0; i < bases.length; i++) for (let j = i + 1; j < bases.length; j++) expect(edgeDistance(bases[i]!.b, bases[j]!.b)).toBeGreaterThan(-0.02);
  });

  it('measures weapon range from the closest bases', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('st', 'stalker', 'small', [], 'Stalkers', 220)];
    const s = createGame(cfg, dep, flat);
    s.playerUnits[0]!.location = 'table';
    placeUnit(s, 'players', 'st', { x: 18, y: 4 }, { count: 1 });
    s.playerUnits[0]!.models = 1;
    const ai = s.army.units[0]!;
    ai.location = 'table';
    // Centre to centre 13.2": beyond 12" between centres, but the base gap is under 12".
    placeUnit(s, 'ai', ai.id, { x: 18, y: 17.2 }, { count: 1 });
    ai.models = 1;
    s.phase = 'assault';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    const w = playerWeapons(s, s.playerUnits[0]!).find((x) => x.name === 'Particle Disruptors')!;
    const t = validTargets(s, s.playerUnits[0]!, w).find((x) => x.unit.id === ai.id);
    expect(t).toBeDefined();
    expect(t!.distance).toBeLessThan(12);
  });

  it('movement paths go around enemy bases instead of through them', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('st', 'stalker', 'small', [], 'Stalkers', 230)];
    const s = createGame(cfg, dep, flat);
    s.playerUnits[0]!.location = 'table';
    placeUnit(s, 'players', 'st', { x: 18, y: 4 }, { count: 1 });
    s.playerUnits[0]!.models = 1;
    const ai = s.army.units.find((u) => u.defId === 'zergling') ?? s.army.units[0]!;
    ai.location = 'table';
    // A line of enemy bases straight across the path.
    s.sense!.ai[ai.id] = Array.from({ length: 9 }, (_, i) => ({ x: 14 + i * 1.3, y: 9 }));
    ai.models = 9;
    const straight = shortestPath({ x: 18, y: 4 }, { x: 18, y: 14 }, s.terrain.pieces, s.terrain.table);
    const blocked = shortestPath({ x: 18, y: 4 }, { x: 18, y: 14 }, s.terrain.pieces, s.terrain.table, pathOptionsFor(s, 'players', 'st'));
    expect(straight.length).toBeCloseTo(10, 5);
    expect(blocked.length).toBeGreaterThan(12);
  });

  it('a large base cannot squeeze through a gap narrower than itself', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('st', 'stalker', 'small', [], 'Stalkers', 240)];
    const walls = [
      { n: 1, catalogId: 'w1', size: 2 as const, grass: false, x: 0, y: 10, w: 17, h: 1, label: 'Wall' },
      { n: 2, catalogId: 'w2', size: 2 as const, grass: false, x: 19, y: 10, w: 17, h: 1, label: 'Wall' },
    ];
    const s = createGame(cfg, dep, { seed: 1, table: dep.table, pieces: walls, fireLanes: [], violations: [] });
    s.playerUnits[0]!.location = 'table';
    placeUnit(s, 'players', 'st', { x: 18, y: 5 }, { count: 1 });
    // The 2" gap lets a thin line through, but not an 80mm (3.15") base.
    const thin = shortestPath({ x: 18, y: 5 }, { x: 18, y: 15 }, s.terrain.pieces, s.terrain.table);
    const base = shortestPath({ x: 18, y: 5 }, { x: 18, y: 15 }, s.terrain.pieces, s.terrain.table, pathOptionsFor(s, 'players', 'st'));
    expect(thin.length).toBeLessThan(11);
    expect(base.length === Infinity || base.length > 20).toBe(true);
  });

  it('lets you fine-tune a model only to a legal spot', () => {
    const s = game();
    placeUnit(s, 'players', 'zl', { x: 10, y: 10 });
    const [lead] = unitShapes(s, 'players', 'zl');
    // Not active, or not yet moved: no adjusting.
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    expect(checkModelAdjust(s, 'players', 'zl', 1, { x: lead!.x + 2, y: lead!.y })).toMatch(/active, after it has moved or held/);
    s.activeUnitId = 'zl';
    expect(checkModelAdjust(s, 'players', 'zl', 1, { x: lead!.x + 2, y: lead!.y })).toMatch(/active, after it has moved or held/);
    s.playerUnits[0]!.mayAdjust = true;
    // Some spot 2" from the leader is free (40mm bases: 2" + 0.79" radius stays Wholly Within 3").
    const spot = Array.from({ length: 24 }, (_, k) => ({ x: lead!.x + Math.cos(k / 24 * Math.PI * 2) * 2, y: lead!.y + Math.sin(k / 24 * Math.PI * 2) * 2 }))
      .find((p) => checkModelAdjust(s, 'players', 'zl', 1, p) === null)!;
    expect(spot).toBeDefined();
    expect(checkModelAdjust(s, 'players', 'zl', 1, { x: lead!.x + 5, y: lead!.y })).toMatch(/Wholly Within 3/);
    expect(coherencyOf('stalker')).toBe(4);
    expect(coherencyOf('zealot')).toBe(3);
    expect(checkModelAdjust(s, 'players', 'zl', 1, { x: lead!.x + 0.3, y: lead!.y })).toMatch(/overlap/);
    const next = apply(s, { t: 'adjustModel', unitId: 'zl', index: 1, point: spot });
    expect(next.sense!.players['zl']![1]).toMatchObject(spot);
  });

  it('moves a squad-mate aside when a model is set on its spot', () => {
    const s = game();
    placeUnit(s, 'players', 'zl', { x: 10, y: 10 });
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s.activeUnitId = 'zl';
    s.playerUnits[0]!.mayAdjust = true;
    const before = unitShapes(s, 'players', 'zl');
    const mate = before[2]!;
    // Onto the third model's spot: refused without displacing, allowed with it.
    expect(checkModelAdjust(s, 'players', 'zl', 1, { x: mate.x, y: mate.y })).toMatch(/overlap/);
    expect(checkModelAdjust(s, 'players', 'zl', 1, { x: mate.x, y: mate.y }, { displace: true })).toBeNull();
    const next = apply(s, { t: 'adjustModel', unitId: 'zl', index: 1, point: { x: mate.x, y: mate.y } });
    const after = unitShapes(next, 'players', 'zl');
    expect(after[1]).toMatchObject({ x: mate.x, y: mate.y });
    // The Leading Model never moves; no two bases overlap; every model stays Wholly Within 3".
    expect(after[0]).toMatchObject({ x: before[0]!.x, y: before[0]!.y });
    for (let i = 0; i < after.length; i++) {
      for (let j = i + 1; j < after.length; j++) expect(edgeDistance(after[i]!, after[j]!)).toBeGreaterThanOrEqual(-0.01);
      if (i > 0) expect(whollyWithinGap(after[i]!, after[0]!)).toBeLessThanOrEqual(3.01);
    }
    // The squad-mate took the spot the moved model left, when that was free (a swap).
    expect(after[2]).toMatchObject({ x: before[1]!.x, y: before[1]!.y });
  });

  it('lets the Leading Model move up to its Speed and not a fraction more', () => {
    const s = game();
    placeUnit(s, 'players', 'zl', { x: 10, y: 10 });
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s.phase = 'movement';
    const pu = s.playerUnits[0]!;
    const speed = effectiveSpeed(pu);
    expect(checkMove(s, pu, { x: 10 + speed - 0.02, y: 10 }, 'move').ok).toBe(true);
    expect(checkMove(s, pu, { x: 10 + speed + 0.5, y: 10 }, 'move').ok).toBe(false);
    expect(checkMove(s, pu, { x: 10 + speed + 0.5, y: 10 }, 'move').reason).toMatch(/Too far/);
  });

  it('measures a move from the edge of the base, as Wholly Within: a turning oval pays for its swinging ends', () => {
    // A round base that slides 3" has moved 3", whichever way it faces.
    const round = shapeAt('zealot', { x: 10, y: 10, a: 0 });
    expect(moveReach('zealot', round, { x: 13, y: 10 }, 3).reach).toBeCloseTo(3, 2);
    // An oval sliding along its length moves exactly as far as it slides.
    const b = baseOf('hydralisk');
    expect(b.half).toBeGreaterThan(0);
    const oval = shapeAt('hydralisk', { x: 10, y: 10, a: 0 });
    expect(moveReach('hydralisk', oval, { x: 13, y: 10 }, 3).reach).toBeCloseTo(3, 2);
    // Turned side-on, its ends swing out past where the base started: the move is longer than the slide.
    const sideways = moveReach('hydralisk', oval, { x: 10, y: 13 }, 3);
    expect(sideways.facing).toBeCloseTo(Math.PI / 2, 3);
    expect(sideways.reach).toBeGreaterThan(3.5);
    // Held to 3", it keeps its facing and slides instead of turning.
    const held = moveReach('hydralisk', oval, { x: 10, y: 13 }, 3, 3);
    expect(held.facing).toBe(0);
    expect(held.reach).toBeCloseTo(3, 2);
    // A path round terrain adds what it goes out of the way.
    expect(moveReach('zealot', round, { x: 13, y: 10 }, 4).reach).toBeCloseTo(4, 2);
  });

  it('never pushes the Leading Model aside', () => {
    const s = game();
    placeUnit(s, 'players', 'zl', { x: 10, y: 10 });
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s.activeUnitId = 'zl';
    s.playerUnits[0]!.mayAdjust = true;
    const [lead] = unitShapes(s, 'players', 'zl');
    expect(checkModelAdjust(s, 'players', 'zl', 1, { x: lead!.x + 0.3, y: lead!.y }, { displace: true })).toMatch(/Leading Model/);
  });

  it('Close Ranks presses models into contact, keeps pinned models, and cannot move away or engage a new unit', () => {
    const cfg = makeConfig({ modeId: 'frontlines', playMode: 'video' });
    cfg.playerUnits = [makePlayerUnit('z1', 'zealot', 'large', [], 'Zealots', 250)];
    let s = createGame(cfg, dep, flat);
    const pu = s.playerUnits[0]!;
    pu.location = 'table';
    const [ai, other] = s.army.units;
    ai!.location = 'table';
    // Enemy models in a line; the Zealots' leader touches one, the rest stand back.
    s.sense = { at: 0, calibrated: true, manual: true, ai: { [ai!.id]: Array.from({ length: ai!.models }, (_, i) => ({ x: 14 + i * 1.4, y: 20 })) }, players: {}, terrain: {}, unknown: [] };
    const zr = shapeAt('zealot', { x: 0, y: 0 }).r;
    const er = unitShapes(s, 'ai', ai!.id)[0]!.r;
    const near = { x: 15.4, y: 20 - zr - er - 0.5 };
    const touching = { x: 14, y: 20 - zr - er - 0.01 };
    s.sense.players['z1'] = [near, touching, { x: 17.2, y: near.y - 2.2 }, { x: 12.2, y: near.y - 2.2 }, { x: 15.4, y: near.y - 2.6 }, { x: 10.5, y: near.y - 3 }].slice(0, pu.models);
    s.phase = 'combat';
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s = apply(s, { t: 'setOptions', options: {} } as never);
    const z = () => s.playerUnits[0]!;
    expect(z().engaged).toBe(true);
    const before = combatRanks(s, 'players', 'z1', z().engagedWith);
    // Moving the leader away from the fight is refused.
    expect(checkCloseRanks(s, z(), { x: 15.4, y: near.y - 1.5 }).ok).toBe(false);
    // Toward the enemy: the leader closes in, the pinned model stays, and others press into contact.
    s = apply(s, { t: 'playerCloseRanks', unitId: 'z1', point: { x: 16.2, y: near.y + 0.45 } });
    const after = combatRanks(s, 'players', 'z1', z().engagedWith);
    expect(after.total).toBeGreaterThan(before.total);
    expect(s.sense!.players['z1']!.some((p) => Math.abs(p.x - touching.x) < 1e-6 && Math.abs(p.y - touching.y) < 1e-6)).toBe(true);
    expect(z().closedRanksRound).toBe(s.round);
    // No overlapping bases after closing ranks.
    const bases = [...unitShapes(s, 'players', 'z1'), ...unitShapes(s, 'ai', ai!.id)];
    for (let i = 0; i < bases.length; i++) for (let j = i + 1; j < bases.length; j++) expect(edgeDistance(bases[i]!, bases[j]!)).toBeGreaterThan(-0.02);
    void other;
  });

  it('places a full unit of 18 Zerglings quickly, never across a wall from the rest of the unit', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('zg', 'zergling', 'large', [], 'Zerglings', 260)];
    // A long wall just behind the leader: models on its far side would have no Coherency Link.
    const wall = { n: 1, catalogId: 'w', size: 2 as const, grass: false, x: 8, y: 12.2, w: 20, h: 0.6, label: 'Wall' };
    const s = createGame(cfg, dep, { seed: 1, table: dep.table, pieces: [wall], fireLanes: [], violations: [] });
    const zg = s.playerUnits[0]!;
    zg.location = 'table';
    zg.models = 18;
    const t0 = performance.now();
    placeUnit(s, 'players', 'zg', { x: 18, y: 11 });
    expect(performance.now() - t0).toBeLessThan(400);
    const pts = s.sense!.players['zg']!;
    expect(pts).toHaveLength(18);
    // Nobody ended up beyond the wall.
    for (const p of pts) expect(p.y).toBeLessThan(12.2);
  });

  it('coherency can be adjusted only while the unit is active after it moved, until its activation ends', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('zl', 'zealot', 'large', [], 'Zealots', 270)];
    let s = createGame(cfg, dep, flat);
    for (let i = 0; i < 60 && s.step.kind !== 'PLAYERS_TURN'; i++) s = s.step.kind === 'AI_ORDER' ? apply(s, { t: 'aiResolve' }) : apply(s, { t: 'continue' });
    s = apply(s, { t: 'playerDeploy', unitId: 'zl', point: { x: 18, y: 3 } });
    expect(s.activeUnitId).toBe('zl');
    const [lead, second] = unitShapes(s, 'players', 'zl');
    const spot = Array.from({ length: 36 }, (_, k) => ({ x: lead!.x + Math.cos(k / 36 * Math.PI * 2) * 1.9, y: lead!.y + Math.sin(k / 36 * Math.PI * 2) * 1.9 }))
      .find((p) => checkModelAdjust(s, 'players', 'zl', 1, p) === null)!;
    expect(spot).toBeDefined();
    const adjusted = apply(s, { t: 'adjustModel', unitId: 'zl', index: 1, point: spot });
    expect(adjusted.sense!.players['zl']![1]).toMatchObject(spot);
    expect(second).toBeDefined();
    // Ended: no more adjusting.
    const ended = apply(adjusted, { t: 'endActivation' });
    expect(checkModelAdjust(ended, 'players', 'zl', 1, spot)).toMatch(/active, after it has moved or held/);
  });

  it('DISPLACEMENT: a Leading Model may end on the Shade, which is then set in base contact with it', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('ad', 'adept', 'small', [], 'Adepts', 280), makePlayerUnit('zl', 'zealot', 'small', [], 'Zealots', 281)];
    const s = createGame(cfg, dep, flat);
    for (const p of s.playerUnits) p.location = 'table';
    placeUnit(s, 'players', 'ad', { x: 10, y: 10 });
    s.tokens = [{ id: 'sh', kind: 'shade', x: 20, y: 10, label: 'Adepts Shade', round: 1, ownerId: 'ad' }];
    placeUnit(s, 'players', 'zl', { x: 20, y: 10 });
    const lead = unitShapes(s, 'players', 'zl')[0]!;
    const shade = shapeAt('adept', s.tokens![0]!);
    const gap = edgeDistance(lead, shade);
    expect(gap).toBeGreaterThanOrEqual(-0.01);
    expect(gap).toBeLessThanOrEqual(0.1);
  });

  it('coherency adjustment never moves the Leading Model, and single-model units cannot adjust', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('st', 'stalker', 'small', [], 'Stalker', 290), makePlayerUnit('zl', 'zealot', 'large', [], 'Zealots', 291)];
    let s = createGame(cfg, dep, flat);
    for (let i = 0; i < 60 && s.step.kind !== 'PLAYERS_TURN'; i++) s = s.step.kind === 'AI_ORDER' ? apply(s, { t: 'aiResolve' }) : apply(s, { t: 'continue' });
    s = apply(s, { t: 'playerDeploy', unitId: 'st', point: { x: 10, y: 3 } });
    expect(s.playerUnits[0]!.models).toBe(1);
    expect(s.playerUnits[0]!.mayAdjust).toBeFalsy();
    s.playerUnits[0]!.mayAdjust = true;
    expect(checkModelAdjust(s, 'players', 'st', 0, { x: 20, y: 20 })).toBeTruthy();
    const moved = apply(s, { t: 'adjustModel', unitId: 'st', index: 0, point: { x: 20, y: 20 } });
    expect(moved.sense!.players['st']![0]).toMatchObject(s.sense!.players['st']![0]!);
    s = apply(apply(s, { t: 'endActivation' }), { t: 'continue' });
  });

  it('a free move (Leg Enhancements) can be led by any model you pick', () => {
    const s = game();
    placeUnit(s, 'players', 'zl', { x: 10, y: 10 });
    const zl = s.playerUnits[0]!;
    zl.bonusMove = 2;
    s.step = { kind: 'PLAYERS_TURN', lines: [] };
    s.activeUnitId = 'zl';
    const picked = s.sense!.players['zl']![2]!;
    const target = { x: picked.x + 1.5, y: picked.y };
    const next = apply(s, { t: 'playerBonusMove', unitId: 'zl', point: target, leaderIndex: 2 });
    expect(next.playerUnits[0]!.bonusMove).toBe(0);
    expect(next.sense!.players['zl']![0]).toMatchObject(target);
  });
});

describe('AI placement', () => {
  it('a unit placed on top of another unit takes the nearest free spot: no base overlaps', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    const s = createGame(cfg, dep, flat);
    const [a, b] = s.army.units;
    a!.location = 'table';
    b!.location = 'table';
    placeUnit(s, 'ai', a!.id, { x: 18, y: 18 });
    placeUnit(s, 'ai', b!.id, { x: 18, y: 18 });
    for (const x of unitShapes(s, 'ai', a!.id)) for (const y of unitShapes(s, 'ai', b!.id)) expect(edgeDistance(x, y)).toBeGreaterThanOrEqual(-0.03);
  });
});

describe('AI charges on the map', () => {
  it('a unit that charged into contact ends in base contact with its target: no extra move, no overlap', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('zl', 'zealot', 'large', [], 'Zealots', 5), makePlayerUnit('mr', 'marine', 'large', [], 'Marines', 6)];
    let s = createGame(cfg, dep, flat);
    let seen = 0;
    let checked = 0;
    for (let i = 0; i < 300 && s.step.kind !== 'GAME_OVER'; i++) {
      if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
      else if (s.step.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
      else if (s.step.kind === 'PLAYERS_TURN') {
        const res = s.playerUnits.find((p) => p.location === 'reserves' && s.phase === 'movement' && !p.activated.movement);
        const tried = res ? apply(s, { t: 'playerDeploy', unitId: res.id, point: { x: res.id === 'zl' ? 12 : 24, y: 4 } }) : s;
        s = res && tried.playerUnits.find((p) => p.id === res.id)!.location === 'table' ? tried : apply(s, { t: 'playersPass' });
        if (s.activeUnitId) s = apply(s, { t: 'endActivation' });
      } else if (s.step.kind === 'SCORING_FORM') s = apply(s, { t: 'scoring', answers: { markers: {}, playerSupplyLost: 0, extra: {} } });
      else s = apply(s, { t: 'continue' });
      if (s.step.kind === 'AI_SAVES') continue;
      for (const e of s.events ?? []) {
        if (e.id <= seen || e.kind !== 'charge' || e.side !== 'ai' || !e.success) continue;
        const mine = unitShapes(s, 'ai', e.unitId);
        const theirs = unitShapes(s, 'players', e.targetId);
        if (!mine.length || !theirs.length) continue;
        const gaps = mine.flatMap((a) => theirs.map((b) => edgeDistance(a, b)));
        expect(Math.min(...gaps)).toBeLessThanOrEqual(1.01);
        expect(Math.min(...gaps)).toBeGreaterThanOrEqual(-0.05);
        checked++;
      }
      seen = s.events?.length ? s.events[s.events.length - 1]!.id : 0;
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});

describe('AI positions on the map', () => {
  it('a unit whose charge fails stays where the map has it, even when its estimate is out of date', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.options = { ...cfg.options, autopilot: false };
    let s = createGame(cfg, dep, flat);
    // Play until the AI is ordered to charge.
    for (let i = 0; i < 400 && !(s.step.kind === 'AI_ORDER' && s.step.order.type === 'charge'); i++) {
      if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'orderReport', report: s.step.order.reports[0]!.id, enemySupply: 1 });
      else if (s.step.kind === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
      else if (s.step.kind === 'SCORING_FORM') s = apply(s, { t: 'scoring', answers: { markers: {}, playerSupplyLost: 0, extra: {} } });
      else if (s.step.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
      else if (s.step.kind === 'COMBAT_CHECKLIST') s = apply(s, { t: 'checklistDone' });
      else s = apply(s, { t: 'continue' });
    }
    expect(s.step.kind).toBe('AI_ORDER');
    if (s.step.kind !== 'AI_ORDER') return;
    const u = s.army.units.find((x) => x.id === (s.step as { order: { unitId: string } }).order.unitId)!;
    const onMap = s.sense!.ai[u.id]!.map((p) => ({ ...p }));
    // The estimate lags behind the map (the unit was set beside a crowded spot, or moved by the table).
    u.est = { x: onMap[0]!.x + 8, y: onMap[0]!.y + 8 };
    s = apply(s, { t: 'orderReport', report: 'chargeFailed' });
    expect(s.sense!.ai[u.id]![0]).toMatchObject({ x: onMap[0]!.x, y: onMap[0]!.y });
  });
});

describe('one action per activation', () => {
  it('an AI unit told to run because nothing was in reach never also charges', () => {
    let hits = 0;
    for (let seed = 1; seed <= 30 && hits < 3; seed++) {
      const cfg = makeConfig({ modeId: 'frontlines', seed });
      cfg.playerUnits = [makePlayerUnit('m1', 'marine', 'large', [], 'Marines', 1)];
      let s = createGame(cfg, dep, flat);
      // Your Marines stand far off in a corner: out of every charge's reach.
      s.playerUnits[0]!.location = 'table';
      placeUnit(s, 'players', 'm1', { x: 2, y: 2 });
      for (let i = 0; i < 600 && s.status === 'playing'; i++) {
        const st = s.step;
        if (st.kind === 'AI_ORDER' && st.order.noTarget && st.order.type === 'charge') {
          hits++;
          // Put an enemy right beside it now: a charge from where it stands would reach.
          const lead = s.sense!.ai[st.order.unitId]![0]!;
          s.sense!.players['m1'] = [{ x: lead.x + 2.2, y: lead.y }];
          const events = (s.events ?? []).length;
          const next = apply(s, { t: 'aiResolve' });
          expect((next.events ?? []).slice(events).some((e) => e.kind === 'charge'), `seed ${seed}`).toBe(false);
          expect(st.order.reports.map((r) => r.id)).toEqual(['noTarget']);
          break;
        }
        if (st.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
        else if (st.kind === 'PLAYERS_TURN') s = apply(s, { t: 'playersPass' });
        else if (st.kind === 'SCORING_FORM') s = apply(s, { t: 'scoring', answers: { markers: {}, playerSupplyLost: 0, extra: {} } });
        else if (st.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
        else if (st.kind === 'COMBAT_CHECKLIST') s = apply(s, { t: 'checklistDone' });
        else s = apply(s, { t: 'continue' });
      }
    }
    expect(hits).toBeGreaterThan(0);
  });
});

describe('moving around terrain', () => {
  /** A wall across the table with a narrow gap, or none at all. */
  const wall = (gap: boolean, table: { width: number; height: number }) => {
    const pieces = [{ n: 1, catalogId: 'lt-wall', size: 2 as const, grass: false, x: 0, y: 17.6, w: gap ? table.width / 2 - 0.5 : table.width, h: 0.8, label: 'Wall' }];
    if (gap) pieces.push({ n: 2, catalogId: 'lt-wall', size: 2 as const, grass: false, x: table.width / 2 + 2.5, y: 17.6, w: table.width / 2 - 2.5, h: 0.8, label: 'Wall' });
    return pieces;
  };

  it('never walks through a wall when there is no way round it', () => {
    const s = game();
    const t = s.terrain.table;
    s.terrain.pieces = wall(false, t);
    const from = { x: t.width / 2, y: 22 };
    const to = { x: t.width / 2, y: 12 };
    const path = shortestPath(from, to, s.terrain.pieces, t, pathOptionsFor(s, 'players', 'zl'));
    expect(path.length).toBe(Infinity);
    // The unit still sets off that way, but stops on its own side of the wall.
    const d = destinationToward(s, from, to, 5, pathOptionsFor(s, 'players', 'zl'));
    expect(d.point.y).toBeGreaterThan(18.5);
  });

  it('measures the way round a wall, not the straight line through it', () => {
    const s = game();
    const t = s.terrain.table;
    s.terrain.pieces = wall(true, t);
    const from = { x: 6, y: 22 };
    const to = { x: 6, y: 12 };
    const opts = pathOptionsFor(s, 'players', 'zl');
    const path = shortestPath(from, to, s.terrain.pieces, t, opts);
    // The gap is at the middle of the table: the walk is far longer than the 10" straight line.
    expect(path.length).toBeGreaterThan(20);
    // Five inches of movement gets nowhere near the far side.
    const d = destinationToward(s, from, to, 5, opts);
    expect(d.point.y).toBeGreaterThan(18);
  });
});
