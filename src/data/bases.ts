/**
 * Base sizes per unit (mm), as mounted on the table. Everything is measured from bases (Rules 2.3):
 * bases never overlap, Engagement Range is 1" between bases, and "Within" distances are taken edge to edge.
 */
export interface BaseSize {
  /** Width in mm (the short side for oval bases). */
  wMm: number;
  /** Length in mm (equal to the width for round bases). */
  hMm: number;
}

const round = (mm: number): BaseSize => ({ wMm: mm, hMm: mm });

const BASES: Record<string, BaseSize> = {
  // 32mm
  jim_raynor: round(32),
  marine: round(32),
  raynor_s_raider__marine_: round(32),
  medic: round(32),
  point_defense_drone: round(32),
  zergling: round(32),
  raptor__zergling_: round(32),
  swarmling__zergling_: round(32),
  kerrigan_swarm_raptor__zergling_: round(32),
  roachling: round(32),
  // 40mm
  adept: round(40),
  artanis: round(40),
  kerrigan: round(40),
  roach: round(40),
  corpser__roach_: round(40),
  vile__roach_: round(40),
  zealot: round(40),
  praetor_guard__zealot_: round(40),
  zeratul: round(40),
  // 100mm
  immortal: round(100),
  ravager: round(100),
  // 150mm
  siege_tank: round(150),
  // 40×100mm oval
  hydralisk: { wMm: 40, hMm: 100 },
  // 50mm
  marauder: round(50),
  sentry: round(50),
  // 80mm
  goliath: round(80),
  omega_worm: round(80),
  mission_refinery: round(80),
  mission_extractor: round(80),
  mission_assimilator: round(80),
  pylon: round(80),
  queen: round(80),
  stalker: round(80),
};

const MM_PER_IN = 25.4;

/** Base footprint in inches: radius of the round part and half the straight length of an oval (0 for round bases). */
export function baseOf(defId: string): { r: number; half: number; oval: boolean } {
  const b = BASES[defId] ?? BASES[defId.replace(/__.*$/, '')] ?? round(32);
  const r = b.wMm / 2 / MM_PER_IN;
  const half = Math.max(0, (b.hMm - b.wMm) / 2 / MM_PER_IN);
  return { r, half, oval: half > 0 };
}

/** Mission markers are 32mm across. */
export const MARKER_RADIUS_IN = 16 / MM_PER_IN;
