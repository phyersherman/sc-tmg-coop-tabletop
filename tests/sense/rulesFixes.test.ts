import { describe, expect, it } from 'vitest';
import { deploymentById } from '@data/index';
import { createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import {
  baseFits, chargeEndProblem, coherencyOf, coherencyProblem, combatRanks, edgeDistance, pathOptionsFor, placeModels, placeUnit, refreshCoherency,
  sameElevationAsMarker, setModels, setUnit, shapeAt, shapesEngaged, standingPieces, syncModelPositions, unitShapes, unitsEngaged, whollyWithinGap,
} from '@engine/sense/placement';
import { shortestPath } from '@engine/sense/geometry2d';
import { rampLane } from '@engine/terrain/geometry';
import { baseOf } from '@data/bases';
import { makeConfig } from '../engine/helpers';
import type { GameState } from '@engine/types/game';
import type { AiUnitInstance } from '@engine/types/army';
import type { TerrainPiece } from '@engine/types/terrain';

const dep = deploymentById('abandoned-camp');
const R = baseOf('marine').r;

function aiUnit(id: string, defId: string, label: string, models: number): AiUnitInstance {
  return {
    id, defId, label, composition: 'small', upgrades: [],
    maxModels: models, models, damageMarker: 0, shieldsLeft: 0, location: 'reserves',
    activated: { movement: false, assault: false, combat: false }, engaged: false, engagedEnemySupply: 0,
    disengagedThisRound: false, objective: { kind: 'enemy' }, atObjective: false, respawns: 0,
  } as AiUnitInstance;
}

const wall = (n: number, x: number, y: number, w: number, h: number): TerrainPiece => ({ n, catalogId: 'ruined-wall', size: 2, grass: false, x, y, w, h, label: `Wall ${n}` });
const grass = (n: number, x: number, y: number): TerrainPiece => ({ n, catalogId: 'lt-grass-1', size: 2, grass: true, x, y, w: 2.8, h: 1.3, label: `Grass ${n}` });
const scatter = (n: number, x: number, y: number): TerrainPiece => ({ n, catalogId: 'scatter', size: 1, grass: false, x, y, w: 2, h: 2, label: `Scatter ${n}` });
const ramp: TerrainPiece = { n: 9, catalogId: 'lt-ramp', size: 3, grass: false, label: 'Lost Temple Ramp', x: 10, y: 14, w: 15.9, h: 8.15, accessPoints: [{ x: 25.9, y: 18.075 }] };

/** A game with nothing on the table: every unit waits in Reserves until a test sets it down. */
function game(pieces: TerrainPiece[] = []): GameState {
  const cfg = makeConfig({ modeId: 'frontlines', playMode: 'video' });
  cfg.playerUnits = [
    makePlayerUnit('ma', 'marine', 'small', [], 'Marines', 200),
    makePlayerUnit('st', 'stalker', 'small', [], 'Stalker', 201),
    makePlayerUnit('tk', 'siege_tank', 'small', [], 'Tank', 202),
    makePlayerUnit('pd', 'point_defense_drone', 'small', [], 'Drone', 203),
    makePlayerUnit('zl', 'zealot', 'small', [], 'Zealots', 204),
  ];
  cfg.army = { ...cfg.army, units: [aiUnit('z1', 'zergling', 'Zerglings A', 6), aiUnit('z2', 'zergling', 'Zerglings B', 6), aiUnit('ro', 'roach', 'Roaches', 3), aiUnit('dr', 'point_defense_drone', 'Drone', 1)] } as typeof cfg.army;
  const s = createGame(cfg, dep, { seed: 1, table: dep.table, pieces, fireLanes: [], violations: [] });
  s.sense = { at: 0, calibrated: true, ai: {}, players: {}, terrain: {}, unknown: [], manual: true };
  return s;
}
const pu = (s: GameState, id: string) => s.playerUnits.find((p) => p.id === id)!;
const au = (s: GameState, id: string) => s.army.units.find((u) => u.id === id)!;
/** Put a unit on the table with its models exactly here (no placement rules: the table as it stands). */
function stand(s: GameState, side: 'ai' | 'players', id: string, pts: { x: number; y: number }[]): void {
  if (side === 'ai') { au(s, id).location = 'table'; au(s, id).models = pts.length; s.sense!.ai[id] = pts; }
  else { pu(s, id).location = 'table'; pu(s, id).models = pts.length; s.sense!.players[id] = pts; }
}
function forceField(s: GameState, x: number, y: number): void {
  s.tokens = [...(s.tokens ?? []), { id: 'ff1', kind: 'forceField', x, y, label: 'Force Field', round: 1 }];
  s.terrain.pieces.push({ n: 901, catalogId: 'token:ff1', size: 2, grass: false, x: x - 0.75, y: y - 0.75, w: 1.5, h: 1.5, label: 'Force Field' });
}

describe('Engagement (7.2.1)', () => {
  it('two models Within 1" are Engaged; a Size 2 wall or a Force Field between them parts them; Grass does not', () => {
    const a = shapeAt('marine', { x: 10, y: 10 }), b = shapeAt('zergling', { x: 10 + 2 * R + 0.8, y: 10 });
    expect(shapesEngaged(game(), a, b)).toBe(true);
    expect(shapesEngaged(game([wall(1, 10 + R + 0.1, 6, 0.6, 8)]), a, b)).toBe(false);
    expect(shapesEngaged(game([{ ...grass(1, 0, 0), x: 10 + R + 0.1, y: 6, w: 0.6, h: 8 }]), a, b)).toBe(true);
    // Size 1 terrain: Engagement is possible across it.
    expect(shapesEngaged(game([{ ...scatter(1, 0, 0), x: 10 + R + 0.1, y: 6, w: 0.6, h: 8 }]), a, b)).toBe(true);
    const s = game();
    s.tokens = [{ id: 'ff1', kind: 'forceField', x: 10 + R + 0.4, y: 10, label: 'Force Field', round: 1 }];
    s.terrain.pieces.push({ n: 901, catalogId: 'token:ff1', size: 2, grass: false, x: 10 + R + 0.1, y: 6, w: 0.6, h: 8, label: 'Force Field' });
    expect(shapesEngaged(s, a, b)).toBe(false);
    // More than 1" apart is never Engaged.
    expect(shapesEngaged(game(), a, shapeAt('zergling', { x: 10 + 2 * R + 1.1, y: 10 }))).toBe(false);
  });

  it('a model on HIGH GROUND and one at GROUND LEVEL are never Engaged', () => {
    const s = game([ramp]);
    const above = shapeAt('marine', { x: 13, y: 14 + R + 0.05 }), below = shapeAt('zergling', { x: 13, y: 14 - R - 0.05 });
    expect(edgeDistance(above, below)).toBeLessThan(1);
    expect(shapesEngaged(s, above, below)).toBe(false);
    // Two models on the plateau are.
    expect(shapesEngaged(s, above, shapeAt('zergling', { x: 13 + 2 * R + 0.3, y: 14 + R + 0.05 }))).toBe(true);
  });

  it('a model on the ramp Engages one on the ground only beside the ramp\'s foot', () => {
    const s = game([ramp]);
    const lane = rampLane(ramp);
    const at = (u: number, v: number, defId: string) => shapeAt(defId, lane.toTable(u, lane.side * v));
    const mid = lane.ht - lane.w / 2;
    // At the foot: one just on the ramp, one just off its end.
    expect(shapesEngaged(s, at(lane.hl - 0.3, mid, 'marine'), at(lane.hl + R + 0.7, mid, 'zergling'))).toBe(true);
    // Halfway up, beside the ramp's open side: Within 1", but no ACCESS POINT joins them.
    const up = at(lane.hl - lane.len / 2, lane.ht - R - 0.05, 'marine'), beside = at(lane.hl - lane.len / 2, lane.ht + R + 0.3, 'zergling');
    expect(edgeDistance(up, beside)).toBeLessThan(1);
    expect(shapesEngaged(s, up, beside)).toBe(false);
  });

  it('Units: a Flying Unit is never Engaged, and Combat ranks count only models that are Engaged', () => {
    const s = game([wall(1, 10 + R + 0.1, 8, 0.6, 1.5)]);
    // One Marine faces a Zergling across the wall, one in the open.
    stand(s, 'players', 'ma', [{ x: 10, y: 9 }, { x: 10, y: 11 }]);
    stand(s, 'ai', 'z1', [{ x: 10 + 2 * R + 0.8, y: 9 }, { x: 10 + 2 * R + 0.8, y: 11 }]);
    expect(unitsEngaged(s, 'players', 'ma', 'ai', 'z1')).toBe(true);
    expect(combatRanks(s, 'players', 'ma', ['z1']).fighting).toBe(1);
    stand(s, 'ai', 'dr', [{ x: 10, y: 11 + 2 * R + 0.3 }]);
    expect(unitsEngaged(s, 'players', 'ma', 'ai', 'dr')).toBe(false);
    expect(combatRanks(s, 'players', 'ma', ['dr']).fighting).toBe(0);
  });
});

describe('Grass (8.5.3)', () => {
  it('is removed when a Ground Unit\'s Leading Model passes through it, or a model ends on it', () => {
    const s = game([grass(1, 14, 9.4), grass(2, 30, 30)]);
    stand(s, 'players', 'st', [{ x: 8, y: 10 }]);
    const rep = setUnit(s, 'players', 'st', { x: 22, y: 10 }, { avoidEngaging: true, path: [{ x: 8, y: 10 }, { x: 22, y: 10 }] });
    expect(rep.grass).toEqual(['Grass 1']);
    expect(s.terrain.pieces.map((t) => t.n)).toEqual([2]);
    expect(s.log.some((l) => /Stalker moves through Grass 1: removed from the game/.test(l.text))).toBe(true);
    // Ending on it, with no path given.
    placeUnit(s, 'players', 'st', { x: 31, y: 30.5 });
    expect(s.terrain.pieces).toHaveLength(0);
  });

  it('a Flying Unit passes above it, and removes it only by ending on it', () => {
    const s = game([grass(1, 14, 9.4)]);
    stand(s, 'players', 'pd', [{ x: 8, y: 10 }]);
    placeUnit(s, 'players', 'pd', { x: 22, y: 10 }, { path: [{ x: 8, y: 10 }, { x: 22, y: 10 }] });
    expect(s.terrain.pieces).toHaveLength(1);
    placeUnit(s, 'players', 'pd', { x: 15, y: 10 }, { path: [{ x: 22, y: 10 }, { x: 15, y: 10 }] });
    expect(s.terrain.pieces).toHaveLength(0);
  });
});

describe('ending on terrain (4.6)', () => {
  it('a base never ends overlapping terrain, however narrow a gap its Unit passes', () => {
    const s = game([wall(1, 12, 8, 3.2, 1), scatter(2, 20, 20)]);
    pu(s, 'ma').location = 'table';
    // A Marine passes a 1" gap on a 32mm base: the base itself must clear the wall to stand.
    expect(baseFits(s, 'players', 'ma', shapeAt('marine', { x: 13, y: 9 + R - 0.1 }))).toBe(false);
    expect(baseFits(s, 'players', 'ma', shapeAt('marine', { x: 13, y: 9 + R + 0.02 }))).toBe(true);
    // Size 1 terrain is passed through, never ended on.
    expect(baseFits(s, 'players', 'ma', shapeAt('marine', { x: 20 - R + 0.1, y: 21 }))).toBe(false);
  });

  it('a Siege Tank asked to stop in a 3" gap stops short of it, where its base fits, on the side it came from', () => {
    const s = game([wall(1, 12.8, 8, 3.2, 1), wall(2, 19.0, 8, 3.2, 1)]);
    stand(s, 'players', 'tk', [{ x: 17.5, y: 3.5 }]);
    const r = baseOf('siege_tank').r;
    expect(baseFits(s, 'players', 'tk', shapeAt('siege_tank', { x: 17.5, y: 8.5 }))).toBe(false);
    const [lead] = placeUnit(s, 'players', 'tk', { x: 17.5, y: 7.5 });
    expect(baseFits(s, 'players', 'tk', shapeAt('siege_tank', lead!))).toBe(true);
    // The round base comes as near as the walls' corners let it, and no nearer.
    const toCorner = Math.min(Math.hypot(lead!.x - 16, lead!.y - 8), Math.hypot(lead!.x - 19, lead!.y - 8));
    expect(toCorner).toBeGreaterThanOrEqual(r - 0.03);
    expect(toCorner).toBeLessThan(r + 0.3);
    expect(lead!.y).toBeLessThan(8);
  });
});

describe('Force Field', () => {
  it('stops a Unit of Size 2 or lower; a model of Size 3 or more moves over it, and it is then removed', () => {
    const s = game([wall(1, 0, 9, 17.25, 2), wall(2, 18.75, 9, 17.25, 2)]);
    forceField(s, 18, 10);
    stand(s, 'players', 'ma', [{ x: 18, y: 6 }]);
    stand(s, 'players', 'st', [{ x: 18, y: 5 }]);
    const to = { x: 18, y: 14 };
    // The only way through the wall is shut to the Marines.
    expect(shortestPath({ x: 18, y: 6 }, to, s.terrain.pieces, s.terrain.table, pathOptionsFor(s, 'players', 'ma')).length).toBe(Infinity);
    expect(standingPieces(s, 'players', 'ma').some((t) => t.catalogId === 'token:ff1')).toBe(true);
    // The Stalker (Size 3) needs a 3" gap to pass between the walls: open them up, and it walks over the Force Field.
    s.terrain.pieces = [wall(1, 0, 9, 16.4, 2), wall(2, 19.6, 9, 16.4, 2), s.terrain.pieces[2]!];
    const route = shortestPath({ x: 18, y: 5 }, to, s.terrain.pieces, s.terrain.table, pathOptionsFor(s, 'players', 'st'));
    expect(route.length).toBeCloseTo(9, 1);
    expect(standingPieces(s, 'players', 'st').some((t) => t.catalogId === 'token:ff1')).toBe(false);
    const rep = setUnit(s, 'players', 'st', to, { avoidEngaging: true, path: route.path });
    expect(rep.forceFields).toBe(1);
    expect(s.terrain.pieces.some((t) => t.catalogId === 'token:ff1')).toBe(false);
    expect(s.tokens).toEqual([]);
    expect(s.log.some((l) => /Stalker moves over a Force Field: removed/.test(l.text))).toBe(true);
  });

  it('is not removed by a Unit of Size 2 that ends beside it', () => {
    const s = game();
    forceField(s, 18, 10);
    stand(s, 'players', 'ma', [{ x: 18, y: 6 }]);
    const [lead] = placeUnit(s, 'players', 'ma', { x: 18, y: 10 }, { count: 1 });
    expect(s.terrain.pieces).toHaveLength(1);
    expect(Math.max(Math.abs(lead!.x - 18), Math.abs(lead!.y - 10))).toBeGreaterThanOrEqual(0.75 + R - 0.05);
  });
});

describe('tokens are Size 0 terrain (7.3.1)', () => {
  it('a model cannot end overlapping a Creep Tumor or Corrosive Bile; a Faction Indicator is no obstacle', () => {
    const s = game();
    pu(s, 'ma').location = 'table';
    s.tokens = [
      { id: 'c1', kind: 'creepTumor', x: 10, y: 10, label: 'Creep Tumor', round: 1 },
      { id: 'b1', kind: 'bile', x: 20, y: 10, label: 'Corrosive Bile', round: 1 },
      { id: 'i1', kind: 'indicator', x: 30, y: 10, label: 'Faction Indicator', round: 1 },
    ];
    expect(baseFits(s, 'players', 'ma', shapeAt('marine', { x: 10.5, y: 10 }))).toBe(false);
    expect(baseFits(s, 'players', 'ma', shapeAt('marine', { x: 20, y: 10.5 }))).toBe(false);
    expect(baseFits(s, 'players', 'ma', shapeAt('marine', { x: 30, y: 10 }))).toBe(true);
    // They are moved through freely.
    expect(shortestPath({ x: 6, y: 10 }, { x: 14, y: 10 }, s.terrain.pieces, s.terrain.table, pathOptionsFor(s, 'players', 'ma')).length).toBeCloseTo(8, 3);
    // Set down on the tumor, the whole Unit stands clear of it.
    const pts = placeUnit(s, 'players', 'ma', { x: 10, y: 10 });
    expect(pts).toHaveLength(6);
    for (const p of pts) expect(Math.hypot(p.x - 10, p.y - 10)).toBeGreaterThanOrEqual(R + 25 / 25.4 / 2 - 0.03);
  });

  it('DISPLACEMENT: the Leading Model may end on a Creep Tumor that STAYS IN PLAY, which is set Base-to-Base with it', () => {
    const s = game();
    pu(s, 'ma').location = 'table';
    s.tokens = [{ id: 'c1', kind: 'creepTumor', x: 10, y: 10, label: 'Creep Tumor', round: 1, stayInPlay: true }];
    expect(baseFits(s, 'players', 'ma', shapeAt('marine', { x: 10.3, y: 10 }))).toBe(true);
    const pts = placeUnit(s, 'players', 'ma', { x: 10.3, y: 10 });
    expect(pts[0]).toMatchObject({ x: 10.3, y: 10 });
    const t = s.tokens![0]!;
    expect(Math.hypot(t.x - 10.3, t.y - 10)).toBeCloseTo(R + 25 / 25.4 / 2, 1);
    // No model of the Unit stands on the token where it was set.
    for (const p of pts) expect(Math.hypot(p.x - t.x, p.y - t.y)).toBeGreaterThanOrEqual(R + 25 / 25.4 / 2 - 0.03);
  });
});

describe('Coherency (4.4)', () => {
  // A corridor an inch and a half wide, shut at its left end: the Marines can only line up along it.
  const corridor = () => [wall(1, 5, 9, 20, 1), wall(2, 5, 11.5, 20, 1), wall(3, 4, 9, 1, 3.5)];

  it('in the open every model is set Wholly Within 3" and the Unit is In Coherency', () => {
    const s = game();
    pu(s, 'ma').location = 'table';
    const rep = setUnit(s, 'players', 'ma', { x: 18, y: 18 });
    expect(rep.points).toHaveLength(6);
    expect(rep.outOfCoherency).toBe(false);
    expect(pu(s, 'ma').outOfCoherency).toBe(false);
    expect(coherencyProblem(s, 'players', 'ma', { x: 18, y: 18 })).toBeNull();
  });

  it('with no room, a model is set as close as possible with a Coherency Link, and the Unit is Out of Coherency', () => {
    const s = game(corridor());
    pu(s, 'ma').location = 'table';
    const rep = setUnit(s, 'players', 'ma', { x: 5.75, y: 10.75 });
    expect(rep.casualties).toBe(0);
    expect(rep.points).toHaveLength(6);
    expect(rep.outOfCoherency).toBe(true);
    expect(pu(s, 'ma').outOfCoherency).toBe(true);
    expect(s.log.some((l) => /Marines is Out of Coherency/.test(l.text))).toBe(true);
    const shapes = unitShapes(s, 'players', 'ma');
    // Nobody is stacked on the Leading Model, nobody stands across a wall: they file down the corridor.
    for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) expect(edgeDistance(shapes[i]!, shapes[j]!)).toBeGreaterThan(0);
    for (const m of shapes) { expect(m.y).toBeGreaterThan(10 + R - 0.03); expect(m.y).toBeLessThan(11.5 - R + 0.03); }
    expect(shapes.filter((m) => whollyWithinGap(m, shapes[0]!) > coherencyOf('marine') + 0.01).length).toBeGreaterThan(0);
    // As close as possible: the file is unbroken.
    expect(Math.max(...shapes.map((m) => m.x))).toBeLessThan(5.75 + 5 * (2 * R + 0.5));
    // A Deploy may never end Out of Coherency.
    expect(coherencyProblem(s, 'players', 'ma', { x: 5.75, y: 10.75 })).toMatch(/In Coherency/);
  });

  it('a model with no legal position at all is removed as a casualty', () => {
    // A closed box with room for two bases.
    const s = game([wall(1, 5, 9, 4.2, 1), wall(2, 5, 11.5, 4.2, 1), wall(3, 4, 9, 1, 3.5), wall(4, 8.2, 9, 1, 3.5)]);
    pu(s, 'ma').location = 'table';
    const rep = setUnit(s, 'players', 'ma', { x: 5.75, y: 10.75 });
    expect(rep.points.length).toBeLessThan(6);
    expect(rep.casualties).toBe(6 - rep.points.length);
    expect(pu(s, 'ma').models).toBe(rep.points.length);
    expect(s.log.some((l) => /no legal position and (is|are) removed as (a casualty|casualties)/.test(l.text))).toBe(true);
    for (const p of rep.points) { expect(p.x).toBeGreaterThan(5); expect(p.x).toBeLessThan(8.2); }
  });

  it('casualties never change it; the next repositioning does', () => {
    const s = game(corridor());
    pu(s, 'ma').location = 'table';
    placeUnit(s, 'players', 'ma', { x: 5.75, y: 10.75 });
    expect(pu(s, 'ma').outOfCoherency).toBe(true);
    pu(s, 'ma').models = 2;
    syncModelPositions(s, 'players', 'ma');
    expect(unitShapes(s, 'players', 'ma')).toHaveLength(2);
    expect(pu(s, 'ma').outOfCoherency).toBe(true);
    // Checked again where the models stand (Close Ranks, a model adjusted by hand).
    expect(refreshCoherency(s, 'players', 'ma')).toBe(false);
    pu(s, 'ma').outOfCoherency = true;
    placeUnit(s, 'players', 'ma', { x: 18, y: 25 });
    expect(pu(s, 'ma').outOfCoherency).toBe(false);
  });

  it('a Flying Unit\'s Coherency Links ignore terrain', () => {
    const s = game(corridor());
    pu(s, 'pd').location = 'table';
    // Three drones flying as one Unit: set round the Leading Model, across the corridor's walls.
    const set = setModels(s, 'players', 'pd', { x: 12, y: 10.75 }, { count: 3 });
    expect(set.points).toHaveLength(3);
    expect(set.outOfCoherency).toBe(false);
  });
});

describe('Flying and BURROWED models in the way (8.5.3)', () => {
  it('a Ground model moves through a Flying model\'s base, and through the models of a BURROWED Unit', () => {
    const s = game();
    stand(s, 'players', 'ma', [{ x: 10, y: 10 }]);
    stand(s, 'ai', 'dr', [{ x: 14, y: 10 }]);
    stand(s, 'ai', 'ro', [{ x: 18, y: 10 }]);
    const at = (x: number) => pathOptionsFor(s, 'players', 'ma').circles!.some((c) => Math.abs(c.x - x) < 0.01);
    expect(at(14)).toBe(false);
    expect(at(18)).toBe(true);
    au(s, 'ro').statuses = ['Burrowed'];
    expect(at(18)).toBe(false);
    // And a Flying mover is stopped by nothing on the way.
    stand(s, 'players', 'pd', [{ x: 6, y: 10 }]);
    expect(pathOptionsFor(s, 'players', 'pd').circles).toEqual([]);
  });

  it('a Ground Unit may end in Base-to-Base contact with a Flying one: bases never overlap, but it is not Engaged', () => {
    const s = game();
    stand(s, 'ai', 'dr', [{ x: 14, y: 10 }]);
    pu(s, 'ma').location = 'table';
    const touching = { x: 14 + 2 * R + 0.02, y: 10 };
    const pts = placeUnit(s, 'players', 'ma', touching, { avoidEngaging: true });
    expect(pts[0]).toMatchObject(touching);
    const drone = unitShapes(s, 'ai', 'dr')[0]!;
    for (const m of unitShapes(s, 'players', 'ma')) expect(edgeDistance(m, drone)).toBeGreaterThan(-0.02);
    // Beside a Ground enemy it is moved out of Engagement Range.
    stand(s, 'ai', 'ro', [{ x: 24, y: 20 }]);
    const [lead] = placeUnit(s, 'players', 'ma', { x: 24 + baseOf('roach').r + R + 0.3, y: 20 }, { avoidEngaging: true });
    expect(edgeDistance(shapeAt('marine', lead!), unitShapes(s, 'ai', 'ro')[0]!)).toBeGreaterThan(1);
  });

  it('a Flying Unit ends where its base fits, at least 1" from enemy Flying Units', () => {
    const s = game([wall(1, 20, 20, 4, 1)]);
    stand(s, 'ai', 'dr', [{ x: 14, y: 10 }]);
    stand(s, 'ai', 'ro', [{ x: 14, y: 14 }]);
    pu(s, 'pd').location = 'table';
    const [a] = placeUnit(s, 'players', 'pd', { x: 14 + 2 * R + 0.3, y: 10 });
    expect(edgeDistance(shapeAt('point_defense_drone', a!), unitShapes(s, 'ai', 'dr')[0]!)).toBeGreaterThanOrEqual(1 - 0.01);
    // Beside a Ground enemy it may stay; on a wall it may not.
    const beside = { x: 14 + baseOf('roach').r + R + 0.1, y: 14 };
    expect(placeUnit(s, 'players', 'pd', beside)[0]).toMatchObject(beside);
    const [c] = placeUnit(s, 'players', 'pd', { x: 22, y: 20.5 });
    expect(baseFits(s, 'players', 'pd', shapeAt('point_defense_drone', c!))).toBe(true);
    expect(Math.hypot(c!.x - 22, c!.y - 20.5)).toBeGreaterThan(0.3);
  });
});

describe('Charge placement (8.7.7)', () => {
  it('no model ends Within Engagement Range of an enemy Unit that was not declared as a target', () => {
    const s = game();
    // The target, and a second enemy Unit standing close beside it.
    stand(s, 'ai', 'z1', [{ x: 20, y: 20 }]);
    stand(s, 'ai', 'z2', [{ x: 20, y: 20 - 2 * R - 0.6 }, { x: 20 + 2 * R + 0.2, y: 20 - 2 * R - 0.6 }]);
    pu(s, 'zl').location = 'table';
    const r = baseOf('zealot').r;
    const lead = { x: 20 - R - r - 0.02, y: 20 + 0.6 };
    const pts = placeModels(s, 'players', 'zl', lead, { contactWith: ['z1'], facing: 0 });
    expect(pts).toHaveLength(3);
    const others = unitShapes(s, 'ai', 'z2');
    for (const p of pts.slice(1)) for (const o of others) expect(shapesEngaged(s, shapeAt('zealot', p), o)).toBe(false);
    // At least one of them still reaches the target.
    expect(pts.slice(1).some((p) => shapesEngaged(s, shapeAt('zealot', p), unitShapes(s, 'ai', 'z1')[0]!))).toBe(true);
  });

  it('says when the Leading Model would stand Within Engagement Range of an undeclared enemy Unit', () => {
    const s = game();
    stand(s, 'ai', 'z1', [{ x: 20, y: 20 }]);
    stand(s, 'ai', 'z2', [{ x: 20, y: 17.5 }]);
    pu(s, 'zl').location = 'table';
    const r = baseOf('zealot').r;
    const between = shapeAt('zealot', { x: 20 - R - r - 0.02, y: 18.75 });
    expect(chargeEndProblem(s, 'players', 'zl', between, ['z1'])).toMatch(/Zerglings B.*not declared as a target/);
    expect(chargeEndProblem(s, 'players', 'zl', between, ['z1', 'z2'])).toBeNull();
    expect(chargeEndProblem(s, 'players', 'zl', shapeAt('zealot', { x: 20 - R - r - 0.02, y: 20.5 }), ['z1'])).toBeNull();
  });
});

describe('Mission Markers and elevation (8.9.1)', () => {
  it('a model is on the same elevation as a Marker when both are on the plateau, both on the ramp or both on the ground', () => {
    const s = game([ramp]);
    const lane = rampLane(ramp);
    const onRamp = lane.toTable(lane.hl - lane.len / 2, lane.side * (lane.ht - lane.w / 2));
    const plateau = { x: 13, y: 18 }, ground = { x: 13, y: 12.5 };
    expect(sameElevationAsMarker(s, shapeAt('marine', plateau), { x: 14, y: 19 })).toBe(true);
    expect(sameElevationAsMarker(s, shapeAt('marine', ground), { x: 14, y: 19 })).toBe(false);
    expect(sameElevationAsMarker(s, shapeAt('marine', ground), { x: 5, y: 5 })).toBe(true);
    expect(sameElevationAsMarker(s, shapeAt('marine', plateau), { x: 5, y: 5 })).toBe(false);
    expect(sameElevationAsMarker(s, shapeAt('marine', onRamp), onRamp)).toBe(true);
    expect(sameElevationAsMarker(s, shapeAt('marine', onRamp), { x: 14, y: 19 })).toBe(false);
  });
});
