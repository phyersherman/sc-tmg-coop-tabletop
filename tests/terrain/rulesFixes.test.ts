import { describe, expect, it } from 'vitest';
import type { TerrainPiece } from '../../src/engine/types/terrain';
import { baseElevation, losBetweenBases, losBlocked, type LosBase } from '../../src/engine/sense/geometry2d';
import { rampLane, rampZone } from '../../src/engine/terrain/geometry';
import { baseOf } from '../../src/data/bases';

const base = (defId: string, x: number, y: number): LosBase => ({ x, y, r: baseOf(defId).r, half: baseOf(defId).half, a: 0 });
const wall = (n: number, x: number, y: number, w: number, h: number, size: 1 | 2 | 3 = 2): TerrainPiece => ({ n, catalogId: 'ruined-wall', size, grass: false, x, y, w, h, label: `Wall ${n}` });
// A Lost Temple Ramp lying lengthwise, its access point on the right-hand end; its plateau is the left part.
const ramp: TerrainPiece = { n: 9, catalogId: 'lt-ramp', size: 3, grass: false, label: 'Lost Temple Ramp', x: 10, y: 14, w: 15.9, h: 8.15, accessPoints: [{ x: 25.9, y: 18.075 }] };
const R = baseOf('marine').r;

describe('Direct Cover is measured from the model, one terrain piece at a time (7.1.1)', () => {
  // The rulebook's example: a Goliath (Size 3), Marines (Size 2), a ruined wall (Size 2) between them.
  const ruin = wall(1, 15, 5, 1, 10);
  const goliath = base('goliath', 8, 10);

  it('a Marine Within 1" of the wall is not Visible to the Goliath, nor the Goliath to it', () => {
    const hugging = base('marine', 16 + 0.5 + R, 10); // its base half an inch behind the wall
    expect(losBetweenBases(goliath, 3, hugging, 2, [ruin])).toBe(false);
    expect(losBetweenBases(hugging, 2, goliath, 3, [ruin])).toBe(false);
  });

  it('a Marine further than 1" from the wall is Visible: the wall is too short for Full Cover against a Goliath', () => {
    const back = base('marine', 16 + 1.5 + R, 10);
    expect(losBetweenBases(goliath, 3, back, 2, [ruin])).toBe(true);
  });

  it('Full Cover is unchanged: two Size 2 models do not see each other over a Size 2 wall', () => {
    expect(losBetweenBases(base('marine', 8, 10), 2, base('marine', 16 + 1.5 + R, 10), 2, [ruin])).toBe(false);
  });

  it('a trace that passes the end of the wall still sees a model beside it', () => {
    // Half an inch from the wall, but standing past its end: part of the base is seen round it.
    const pastEnd = base('marine', 16 + 0.5 + R, 15 + R);
    expect(losBetweenBases(goliath, 3, pastEnd, 2, [ruin])).toBe(true);
  });

  it('Close Quarters: both Within 1" of the same piece and Within 3" of each other, Direct Cover does not apply', () => {
    const near = base('goliath', 15 - 0.5 - baseOf('goliath').r, 10);
    const hugging = base('marine', 16 + 0.5 + R, 10);
    expect(losBetweenBases(near, 3, hugging, 2, [ruin])).toBe(true);
    // Full Cover still does: two Marines that close across the wall do not see each other.
    expect(losBetweenBases(base('marine', 15 - 0.5 - R, 10), 2, hugging, 2, [ruin])).toBe(false);
  });

  it('each piece is judged on its own: the 1" of one wall never joins the trace through another', () => {
    // The Marine hugs a wall that is beside it, not in the way; the wall in the way is 3" from it.
    const beside = wall(2, 18, 11.2, 4, 1);
    const between = wall(3, 15, 5, 1, 10);
    const marine = base('marine', 20, 10);
    expect(losBetweenBases(goliath, 3, marine, 2, [between, beside])).toBe(true);
  });

  it('a single trace is judged the same way when it carries the model\'s base', () => {
    const hugging = base('marine', 16 + 0.5 + R, 10);
    // From the far point of its base the wall is more than 1" away; the model is still Within 1" of it.
    const farEdge = { ...hugging, x: hugging.x + R };
    expect(losBlocked(goliath, 3, farEdge, 2, [ruin])).toBe(false);
    expect(losBlocked(goliath, 3, hugging, 2, [ruin])).toBe(true);
  });
});

describe('elevation (7.1.1, 7.1.2, 8.5.3)', () => {
  const lane = rampLane(ramp);
  const onPlateau = base('marine', 13, 18);
  const onRamp = (() => { const p = lane.toTable(lane.hl - lane.len * 0.2, lane.side * (lane.ht - lane.w / 2)); return base('marine', p.x, p.y); })();
  const upperRamp = (() => { const p = lane.toTable(lane.hl - lane.len * 0.8, lane.side * (lane.ht - lane.w / 2)); return base('marine', p.x, p.y); })();

  it('knows the plateau from the ramp and the ground', () => {
    expect(rampZone(onPlateau, ramp)).toBe('plateau');
    expect(baseElevation(onPlateau, [ramp]).zone).toBe('plateau');
    expect(baseElevation(onRamp, [ramp]).zone).toBe('ramp');
    expect(baseElevation(upperRamp, [ramp]).zone).toBe('ramp');
    expect(baseElevation(base('marine', 13, 30), [ramp]).zone).toBe('ground');
    // A base touching the cliff from the ground stands on the ground.
    expect(baseElevation(base('marine', 13, 14 - R), [ramp]).zone).toBe('ground');
  });

  it('Elevation Dead Zone: HIGH GROUND and a model Within 1" of the foot of the same piece never see each other', () => {
    // The rulebook's example: a Marine on HIGH GROUND, a Zergling at GROUND LEVEL at the foot of the cliff, more than 3" apart.
    const marine = base('marine', 13, 18);
    const zergling = base('zergling', 13, 22.15 + 0.4 + baseOf('zergling').r);
    expect(losBetweenBases(marine, 2, zergling, 1, [ramp])).toBe(false);
    expect(losBetweenBases(zergling, 1, marine, 2, [ramp])).toBe(false);
    // Clear of the foot of the cliff, it is seen from above.
    expect(losBetweenBases(marine, 2, base('zergling', 13, 22.15 + 1.5 + baseOf('zergling').r), 1, [ramp])).toBe(true);
    // Close Quarters: Within 3" of each other, standard Line of Sight.
    expect(losBetweenBases(base('marine', 13, 21.3), 2, zergling, 1, [ramp])).toBe(true);
  });

  it('a model on the ramp is at MID GROUND: Effective Size +1, not the plateau\'s Size', () => {
    // A Size 3 wall between the ramp and a Goliath on the ground, more than 1" from either.
    const tall = wall(4, 30, 10, 1, 16, 3);
    const goliath = base('goliath', 35, 18);
    // Marine (2) on the ramp is Effective Size 3: the wall is Full Cover between it and the Goliath (3).
    expect(losBetweenBases(upperRamp, 2, goliath, 3, [ramp, tall])).toBe(false);
    expect(losBetweenBases(onRamp, 2, goliath, 3, [ramp, tall])).toBe(false);
    // From the plateau (Effective Size 5) it sees over.
    expect(losBetweenBases(base('marine', 17, 18), 2, goliath, 3, [ramp, tall])).toBe(true);
  });

  it('Stacking Terrain: a wall set on HIGH GROUND gains its Size (the Marauder, the Roach and the Hydralisk)', () => {
    // Marauder (2) on HIGH GROUND (3) is Effective Size 5; a ruined wall (2) on the same plateau is Effective Size 5.
    const ruin = wall(5, 12, 15.2, 5, 0.8);
    const marauder = base('marauder', 14.5, 18);
    // The Roach at GROUND LEVEL beyond the wall cannot make a Line of Sight with the Marauder.
    const roach = base('roach', 14.5, 9);
    expect(losBetweenBases(roach, 2, marauder, 2, [ramp, ruin])).toBe(false);
    expect(losBetweenBases(marauder, 2, roach, 2, [ramp, ruin])).toBe(false);
    // The Hydralisk at GROUND LEVEL on the open side can: no obstacle in the way.
    const hydralisk = base('hydralisk', 14.5, 27);
    expect(losBetweenBases(hydralisk, 2, marauder, 2, [ramp, ruin])).toBe(true);
    // The same wall on the ground would be seen over from the plateau.
    expect(losBetweenBases(roach, 2, marauder, 2, [ramp, wall(6, 12, 11, 5, 0.8)])).toBe(true);
  });
});

describe('Flying models and Cover (7.1.4)', () => {
  const ruin = wall(1, 15, 5, 1, 10);
  const far = base('marine', 8, 10);

  it('ignore Full Cover', () => {
    const target = base('marine', 22, 10);
    expect(losBetweenBases(far, 2, target, 2, [ruin])).toBe(false);
    expect(losBetweenBases(far, 2, target, 2, [ruin], { flyingA: true })).toBe(true);
    expect(losBetweenBases(far, 2, target, 2, [ruin], { flyingB: true })).toBe(true);
  });

  it('never have Direct Cover as the model Within 1" of the terrain', () => {
    const hugging = base('point_defense_drone', 16 + 0.5 + R, 10);
    expect(losBetweenBases(base('goliath', 8, 10), 3, hugging, 0, [ruin])).toBe(false);
    expect(losBetweenBases(base('goliath', 8, 10), 3, hugging, 0, [ruin], { flyingB: true })).toBe(true);
  });

  it('still obey the Direct Cover of the other model', () => {
    const hugging = base('marine', 16 + 0.5 + R, 10);
    expect(losBetweenBases(far, 0, hugging, 2, [ruin], { flyingA: true })).toBe(false);
  });

  it('still obey the Elevation Dead Zone of the other model', () => {
    const above = base('point_defense_drone', 13, 18);
    const atFoot = base('marine', 13, 22.15 + 0.4 + R);
    expect(losBetweenBases(above, 0, atFoot, 2, [ramp], { flyingA: true })).toBe(false);
  });
});
