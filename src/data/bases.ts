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
  // Wave 3 (Archon, 9 October 2026). Twilight Templar, Spec Ops Marauder and Vileling take their base Unit's.
  nova_assault_mode: round(40),
  nova_stealth_mode: round(40),
  sabotage_drone: round(40),
  holo_decoy: round(40),
  auto_turret: round(40),
  raven: round(100), // a 100×100mm cross, held here by its 100mm span
  zagara: round(100),
  bile_launcher: round(100),
  defiler: round(80),
  tassadar: round(40),
  high_templar: round(40),
};

const MM_PER_IN = 25.4;

/** Base footprint in inches: radius of the round part and half the straight length of an oval (0 for round bases). */
export function baseOf(defId: string): { r: number; half: number; oval: boolean } {
  const b = BASES[defId] ?? BASES[defId.replace(/__.*$/, '')] ?? round(32);
  const r = b.wMm / 2 / MM_PER_IN;
  const half = Math.max(0, (b.hMm - b.wMm) / 2 / MM_PER_IN);
  return { r, half, oval: half > 0 };
}

/**
 * Wave 3 tokens and templates (Archon, 9 October 2026), for the abilities that place them. Templates are 5" across;
 * the Force Wall is a 40×100mm piece.
 */
export const WAVE3_PIECES: Record<string, BaseSize> = {
  force_wall: { wMm: 40, hMm: 100 },
  dark_swarm: round(32),
  psi_storm: round(32),
  plague_template: round(5 * 25.4),
  psi_blast_template: round(5 * 25.4),
};

/** Mission markers are 32mm across. */
export const MARKER_RADIUS_IN = 16 / MM_PER_IN;
