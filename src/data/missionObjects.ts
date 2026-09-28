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

const TRAIN_TEXT = 'This Unit runs the line: it moves straight toward the far table edge in the Movement and Assault phases and leaves the table when it reaches it. It has no weapons and never attacks, but it can be Engaged, Charged and destroyed as normal.';

/**
 * Oblivion Express's armoured trains (the players' decision, 2026-09-27: one unit of its own, 18 HP, Armour 5+):
 * a big, slow-to-kill target that only runs the line. The same for every race; one per race so its dice and
 * colours are the AI's own.
 */
export const MISSION_TRAINS: UnitDef[] = (['Terran', 'Zerg', 'Protoss'] as Faction[]).map((faction) => ({
  id: `mission_train_${faction.toLowerCase()}`,
  name: 'Armoured Train',
  faction,
  role: 'Other',
  tags: ['Armoured', 'Mechanical', 'Ground'],
  unique: false,
  summoned: true,
  stats: { speed: [6, 6], armour: 5, hp: 18, size: 3 },
  compositions: [{ label: 'small', models: 1, cost: 0, supply: 0 }],
  squadProfile: [{ min: 1, max: 1, supply: 0 }],
  weapons: [],
  abilities: [{ id: `mission_train_${faction.toLowerCase()}:train:0`, name: 'Runs the Line', phase: 'Any', kind: 'Passive', text: TRAIN_TEXT }],
}));

export const missionTrainFor = (faction: Faction): UnitDef => MISSION_TRAINS.find((d) => d.faction === faction)!;
