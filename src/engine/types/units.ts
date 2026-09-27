/** Static unit / card definitions (facts only, snapshotted from official data). */

export type Faction = 'Terran' | 'Zerg' | 'Protoss';
export type UnitRole = 'Core' | 'Elite' | 'Support' | 'Hero' | 'Air' | 'Other';
export type CombatTag =
  | 'Biological'
  | 'Mechanical'
  | 'Light'
  | 'Armoured'
  | 'Psionic'
  | 'Ground'
  | 'Flying'
  | 'Unique';
export type SurgeType = 'Light' | 'Armoured';
/** BT: no die is rolled — the Surge result equals the models the Blast Template covered (Part 12.8). */
export type SurgeDie = 'D3' | 'D3+1' | 'D6' | 'BT';
export type PhaseName = 'Movement' | 'Assault' | 'Combat' | 'Any';
export type WeaponTarget = 'All' | 'Ground' | 'Flying';
export type ResourceKind = 'CP' | 'BM' | 'PE';

export interface WeaponKeyword {
  /** Canonical upper-case keyword, e.g. "LONG RANGE", "PIERCE", "SIDEARM". */
  k: string;
  /** Numeric argument, e.g. LONG RANGE (18) -> 18, PIERCE Armoured (3) -> 3. */
  v?: number;
  /** Tag argument for PIERCE / SURGE-like keywords. */
  tag?: SurgeType;
  /** Secondary numeric (BURST FIRE 8" (3) -> range 8, v 3). */
  range?: number;
}

export interface WeaponProfile {
  id: string;
  name: string;
  phase: 'Assault' | 'Combat';
  /** Inches, or 'E' for engagement range (melee). */
  range: number | 'E';
  target: WeaponTarget;
  roa: number;
  /** Target number: 3 means "3+". */
  hit: number;
  dmg: number;
  surgeTypes: SurgeType[];
  surgeDie?: SurgeDie;
  keywords: WeaponKeyword[];
  /** BLAST TEMPLATE: its RoA is this many dice plus the models the template covers. */
  blast?: boolean;
  /** A Status the unit must have to use this weapon at all ("SIEGE MODE Status" on the profile). */
  requiresStatus?: string;
  /** Mineral cost when purchased as an upgrade (small/large composition). Absent = base weapon. */
  upgradeCost?: { small: number; large: number };
  /** Name of the base weapon this replaces (↑ FOR). */
  replaces?: string;
  /** Original text for display. */
  text: string;
}

export interface AbilityDef {
  id: string;
  name: string;
  phase: PhaseName;
  kind: 'Passive' | 'Active' | 'Reaction';
  cost?: { resource: ResourceKind; amount: number | 'X' };
  text: string;
  upgradeCost?: { small: number; large: number };
}

export interface SquadTier {
  min: number;
  max: number;
  supply: number;
}

export interface Composition {
  label: 'small' | 'large';
  models: number;
  cost: number;
  supply: number;
}

export interface UnitStats {
  shields?: number;
  /** [normal, singleModel] speed in inches; null = cannot move. */
  speed: [number, number] | null;
  evade?: number;
  armour: number;
  hp: number;
  size: number;
  /** Rough close-combat reach hint from the source data (inches). */
  combatRange?: number;
}

export interface UnitDef {
  id: string;
  name: string;
  faction: Faction;
  role: UnitRole;
  tags: CombatTag[];
  /** Sub-faction requirement, e.g. "Kerrigan's Swarm". */
  subFaction?: string;
  unique: boolean;
  /** Zero-cost unit that only enters play via SUMMON / structure rules. */
  summoned: boolean;
  stats: UnitStats;
  compositions: Composition[];
  squadProfile: SquadTier[];
  weapons: WeaponProfile[];
  abilities: AbilityDef[];
  /** Parsed from "Devastating Charge: IMPACT (X) Y+". */
  impact?: { dice: number; hit: number };
}

export interface CardBoost {
  name: string;
  text: string;
}

export interface CardDef {
  id: string;
  name: string;
  faction: Faction | string;
  isFactionCard: boolean;
  unique: boolean;
  /** Vespene gas cost. */
  cost: number;
  /** Resource generated per round (CP/BM/PE). */
  resource: number;
  slots: Partial<Record<'Core' | 'Elite' | 'Support' | 'Hero' | 'Air', number>>;
  factionTags: string[];
  boosts: CardBoost[];
}

export interface DataSnapshot {
  version: string;
  takenAt: string;
  source: string;
  units: UnitDef[];
  cards: CardDef[];
}
