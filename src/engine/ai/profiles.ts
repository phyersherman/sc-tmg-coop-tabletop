import type { UnitDef } from '../types/units';
import { availableWeapons, maxRange } from '../units/weapons';

export type Profile = 'meleeRusher' | 'brawler' | 'rangedLine' | 'support';

const OVERRIDES: Record<string, Profile> = {
  medic: 'support',
  sentry: 'support',
  kerrigan: 'brawler',
};

/** Expected damage from one model's weapon attack, before saves. */
const punch = (w: { roa: number; hit: number; dmg: number }) => (w.roa * Math.max(0, 7 - w.hit) / 6) * w.dmg;

/**
 * How the AI plays a unit. A unit with a gun shoots (rangedLine) unless its close combat hits harder than its gun:
 * only then does it charge first and fire when it cannot reach (brawler). A unit with no gun rushes in.
 */
export function classify(def: UnitDef): Profile {
  const o = OVERRIDES[def.id];
  if (o) return o;
  const assault = availableWeapons(def, [], 'Assault').filter((w) => w.target !== 'Flying');
  if (assault.length === 0) return 'meleeRusher';
  const melee = availableWeapons(def, [], 'Combat');
  const gun = Math.max(...assault.map(punch));
  const fists = melee.length ? Math.max(...melee.map(punch)) : 0;
  return fists >= gun ? 'brawler' : 'rangedLine';
}

/** Preferred engagement range (inches) for movement stop conditions. */
export function preferredRange(def: UnitDef, upgrades: string[]): number {
  const ws = availableWeapons(def, upgrades, 'Assault').filter((w) => w.target !== 'Flying');
  if (ws.length === 0) return 0;
  return Math.max(...ws.map(maxRange));
}
