import type { AiArmy } from '../types/army';
import type { PlayerUnit, TagRegistry } from './types';

export const CORNER_IDS: [number, number, number, number] = [0, 1, 2, 3];
export const FIRST_ID = 10;
/** Id capacity per dictionary. */
export const DICT_CAPACITY: Record<'36h12' | 'aruco', number> = { '36h12': 250, aruco: 1023 };

export interface RegistryReport {
  registry: TagRegistry;
  warnings: string[];
}

/**
 * The tags the camera looks for in a game: the four corners, and one per unit (on its leading model), from the
 * tag each unit was given when the game was set up (engine/sense/tags). Terrain is not tagged: it is set where
 * the map says.
 */
export function buildRegistryReport(army: AiArmy, playerUnits: PlayerUnit[]): RegistryReport {
  const registry: TagRegistry = { corners: CORNER_IDS, models: {}, terrain: {} };
  const warnings: string[] = [];
  for (const u of army.units) {
    if (u.tagId === undefined) { warnings.push(`${u.label} has no tag: the collection has no free ${u.label.replace(/ [A-Z]$/, '')} slot.`); continue; }
    registry.models[u.tagId] = { side: 'ai', unitId: u.id, model: 0 };
  }
  for (const pu of playerUnits ?? []) {
    if (pu.tagId === undefined) { warnings.push(`${pu.name} has no tag: the collection has no free slot for it.`); continue; }
    registry.models[pu.tagId] = { side: 'players', unitId: pu.id, model: 0 };
  }
  return { registry, warnings };
}

export function buildRegistry(army: AiArmy, playerUnits: PlayerUnit[]): TagRegistry {
  return buildRegistryReport(army, playerUnits).registry;
}
