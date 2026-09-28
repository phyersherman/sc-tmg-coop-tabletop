/**
 * The painted models from the official unit cards (the P2P card sheets at starcraft-tmg.com/downloads), one photo
 * per Unit, in public/models. A Unit without one (the mission objects) shows its race's die instead.
 */
const WITH_PHOTO = new Set([
  'adept', 'artanis', 'immortal', 'nerazim_watchers__adept_', 'praetor_guard__zealot_', 'pylon', 'sentry', 'stalker', 'zealot', 'zeratul',
  'goliath', 'jim_raynor', 'marauder', 'marine', 'medic', 'point_defense_drone', 'raynor_s_raider__marine_', 'siege_tank',
  'corpser__roach_', 'hydralisk', 'kerrigan', 'kerrigan_swarm_raptor__zergling_', 'omega_worm', 'queen', 'raptor__zergling_', 'ravager', 'roach',
  'roachling', 'swarmling__zergling_', 'vile__roach_', 'zergling',
]);

export function modelPhoto(defId: string): string | null {
  return WITH_PHOTO.has(defId) ? `${import.meta.env.BASE_URL}models/${defId}.webp` : null;
}

/** A race's face when no one Unit stands for the army: its hero. */
const HERO: Record<string, string> = { Terran: 'jim_raynor', Zerg: 'kerrigan', Protoss: 'artanis' };
export const factionPhoto = (faction: string): string | null => (HERO[faction] ? modelPhoto(HERO[faction]!) : null);
