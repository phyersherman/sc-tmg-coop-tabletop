import type { Faction, UnitDef } from '@engine/types/units';

/**
 * The structures that stand on a co-op mission's side markers. They are not official units (the official data has
 * no Terran structure to stand on a marker), so they live here and never in units.json: the snapshot refresh cannot
 * lose them, and no army picker ever offers them. Each one carries the official Structure rule, word for word.
 */
const STRUCTURE_TEXT =
  'This Unit cannot be Activated in any Phase and cannot perform actions. Additionally, its Current Supply Value is treated as 0, and it can never Control or Contest Mission Markers, ignoring the standard Zero Supply Exception. This Unit cannot be a target of an ability, unless stated otherwise.';

function structure(id: string, name: string, faction: Faction, tags: UnitDef['tags'], stats: UnitDef['stats']): UnitDef {
  return {
    id,
    name,
    faction,
    role: 'Other',
    tags,
    unique: false,
    summoned: true,
    stats,
    compositions: [{ label: 'small', models: 1, cost: 0, supply: 0 }],
    squadProfile: [{ min: 1, max: 1, supply: 0 }],
    weapons: [],
    abilities: [{ id: `${id}:structure:0`, name: 'Structure', phase: 'Any', kind: 'Passive', text: STRUCTURE_TEXT }],
  };
}

/** Heavy and slow to bring down, and it never fights back: the cost of taking the marker is time and firepower. */
export const MISSION_STRUCTURES: UnitDef[] = [
  structure('mission_refinery', 'Refinery', 'Terran', ['Armoured', 'Mechanical', 'Ground'], { speed: null, armour: 5, hp: 12, size: 3 }),
  structure('mission_extractor', 'Extractor', 'Zerg', ['Armoured', 'Biological', 'Ground'], { speed: null, armour: 5, hp: 14, size: 3 }),
  structure('mission_assimilator', 'Assimilator', 'Protoss', ['Armoured', 'Mechanical', 'Ground'], { speed: null, armour: 5, hp: 8, size: 3, shields: 6 }),
];

export const missionStructureFor = (faction: Faction): UnitDef => MISSION_STRUCTURES.find((d) => d.faction === faction)!;
