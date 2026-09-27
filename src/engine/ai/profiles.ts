import type { UnitDef } from '../types/units';
import { availableWeapons, maxRange } from '../units/weapons';

export type Profile = 'meleeRusher' | 'brawler' | 'rangedLine' | 'support';

const OVERRIDES: Record<string, Profile> = {
  queen: 'brawler',
  medic: 'support',
  sentry: 'support',
  adept: 'brawler',
  kerrigan: 'brawler',
};

export function classify(def: UnitDef): Profile {
  const o = OVERRIDES[def.id];
  if (o) return o;
  const assault = availableWeapons(def, [], 'Assault').filter((w) => w.target !== 'Flying');
  if (assault.length === 0) return 'meleeRusher';
  const range = Math.max(...assault.map((w) => (w.range === 'E' ? 0 : w.range)));
  if (range >= 12) return 'rangedLine';
  if (def.impact || def.role === 'Hero') return 'brawler';
  return 'rangedLine';
}

/** Preferred engagement range (inches) for movement stop conditions. */
export function preferredRange(def: UnitDef, upgrades: string[]): number {
  const ws = availableWeapons(def, upgrades, 'Assault').filter((w) => w.target !== 'Flying');
  if (ws.length === 0) return 0;
  return Math.max(...ws.map(maxRange));
}
