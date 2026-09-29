/** Position sensing (overhead camera) types. Positions are table inches from the top-left corner. */

export interface Pt {
  x: number;
  y: number;
  /** Facing (radians) for oval bases. */
  a?: number;
}

/** A player unit built with the army builder; stats derive from the unit data. */
export interface PlayerUnit {
  id: string;
  /** Permanent tag from the saved-unit pool (one tag per unit). */
  tagId?: number;
  /** Which player fields this unit (0-based). Absent means player 1, as every one-player game is. */
  owner?: number;
  name: string;
  defId: string;
  composition: 'small' | 'large';
  upgrades: string[];
  maxModels: number;
  models: number;
  damageMarker: number;
  shieldsLeft: number;
  destroyed: boolean;
  location: 'reserves' | 'table' | 'destroyed';
  activated: { movement: boolean; assault: boolean; combat: boolean };
  /** Round in which this unit already used Close Ranks (once per Combat phase activation). */
  closedRanksRound?: number;
  /** Moved or held during its current activation: its models may be adjusted into coherency until the activation ends. */
  mayAdjust?: boolean;
  /** Weapons used in the current activation: its main weapon and each SIDEARM once (SIDEARM ignores one weapon per model). */
  firedThisActivation?: string[];
  engaged: boolean;
  /** AI unit ids this unit is engaged with. */
  engagedWith: string[];
  disengagedThisRound: boolean;
  deployedRound?: number;
  /** Buffs and reminders from abilities and cards (see engine/abilities). */
  effects?: UnitEffect[];
  /** Names of Active/Reaction abilities used this round (once per round each). */
  used?: string[];
  /** Once-per-game abilities already used. */
  usedGame?: string[];
  statuses?: UnitStatus[];
  /** Extra move granted by an ability (inches), not counting as the unit's action. */
  bonusMove?: number;
  /** A PLACE (X) effect waiting to be resolved: set the unit anywhere within X". */
  placeRange?: number;
  /** Summoned structure/token unit (Pylon, Omega Worm, drone): cannot be activated. */
  summoned?: boolean;
  /** Removed at the end of the round (Point Defence Drone). */
  expiresEndOfRound?: boolean;
  /** Next deploy may use any non-player table edge (Warp In and similar), ending >10" from enemies. */
  deployAnyEdge?: boolean;
  /** Lightning Dash: the Enemy Unit its first Charge hit. It may declare a second Charge against a different one. */
  dashFrom?: string;
}

export type UnitStatus = 'Burrowed' | 'Hidden' | 'Siege Mode';

/** Numeric modifiers an effect grants. */
export interface EffectMods {
  speed?: number;
  roa?: number;
  precision?: number;
  critical?: number;
  antiEvade?: number;
  rangeBuff?: number;
  instant?: boolean;
  impactHit?: number;
  chargeTwoDice?: boolean;
  chargeBonus?: number;
  /** Replace the weapon's Surge die (Grenades - Frag). */
  surgeDie?: 'D3' | 'D3+1' | 'D6';
  /** Only for weapons whose name matches (case-insensitive substring list). */
  weapons?: string[];
  /** Only Close Combat / only Ranged weapons. */
  weaponPhase?: 'Assault' | 'Combat';
  /** Only when the target is within this many inches. */
  within?: number;
  /** Aura radius (Guardian Shield): ranged attacks at friendly units within it lose dice. */
  auraFewerDice?: number;
  ignoreDisengage?: boolean;
  supplyBonus?: number;
  /** Shaped Blast / Smart Shells: keywords the next shot gains. */
  pinpoint?: boolean;
  indirect?: boolean;
  lockedIn?: number;
  longRange?: number;
  /** Coordinated Strike: the friendly unit this weapon may range from instead of measuring its own Range. */
  spotter?: string;
  /** Hallucination / Hierarch's Stand: the unit may make an Evade Roll against the current enemy attack. */
  mayEvade?: boolean;
}

export interface UnitEffect {
  id: string;
  /** Ability or card boost that created it. */
  source: string;
  text: string;
  mods: EffectMods;
  /** 'round' until cleanup; 'firstWeapon' is spent on the next matching attack; 'charge' on the next charge. */
  until: 'round' | 'firstWeapon' | 'charge' | 'action';
}

export interface TagRegistry {
  /** Tag ids for the table corners: top-left, top-right, bottom-right, bottom-left. */
  corners: [number, number, number, number];
  /** Tag id -> model. */
  models: Record<number, { side: 'ai' | 'players'; unitId: string; model: number }>;
  /** Tag id -> terrain piece number. */
  terrain: Record<number, number>;
}

export interface SensedTerrain {
  x: number;
  y: number;
  /** Rotation in degrees, snapped to 0 or 90. */
  rot: number;
}

export interface SenseSnapshot {
  at: number;
  calibrated: boolean;
  /** AI unit id -> model positions seen. */
  ai: Record<string, Pt[]>;
  /** Player unit id -> model positions seen. */
  players: Record<string, Pt[]>;
  terrain: Record<number, SensedTerrain>;
  unknown: number[];
  /** Positions were placed by hand on the map rather than seen by a camera. */
  manual?: boolean;
}
