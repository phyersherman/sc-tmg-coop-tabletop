import type { UnitStatus } from '../sense/types';
import type { Faction } from './units';

export type UnitLocation = 'reserves' | 'table' | 'destroyed' | 'exited';

export type AiObjective =
  | { kind: 'marker'; markerId: number }
  | { kind: 'enemy' }
  | { kind: 'follow'; unitId: string }
  | { kind: 'lane'; toEdge: 'E' | 'W' }
  | { kind: 'point'; x: number; y: number; label: string }
  | { kind: 'hold' };

export interface AiUnitInstance {
  id: string;
  defId: string;
  /** Display label, e.g. "Marines A". */
  label: string;
  composition: 'small' | 'large';
  upgrades: string[];
  maxModels: number;
  models: number;
  damageMarker: number;
  shieldsLeft: number;
  location: UnitLocation;
  activated: { movement: boolean; assault: boolean; combat: boolean };
  engaged: boolean;
  engagedEnemySupply: number;
  disengagedThisRound: boolean;
  objective: AiObjective;
  atObjective: boolean;
  /** Last marker the unit reached (dead-reckoning hint). */
  lastMarker?: number;
  respawns: number;
  deployedRound?: number;
  destroyedRound?: number;
  /** Mode-specific flags (train, thrasher, wave...). */
  special?: Record<string, unknown>;
  /** Statuses the unit carries: a Siege Tank that has dug itself in. */
  statuses?: UnitStatus[];
  /** DEBUFFs you put on it from the table: a penalty to a characteristic until the End of the Round. */
  statDebuffs?: StatDebuff[];
  /** Permanent camera tag for this unit configuration. */
  tagId?: number;
  /** Estimated leading-model position when no camera is used (inches). */
  est?: { x: number; y: number };
  /** Debuffs placed by player abilities (until the end of the round). */
  debuffs?: AiDebuff[];
  /** The action card this unit follows in the current phase: what it does to its numbers. */
  cardMods?: import('../ai/actionDecks').CardMods;
  /** Buffs from its action cards (its reactions, as the AI never reacts), until the End of the Round. */
  buffs?: import('../ai/actionDecks').CardBuff[];
  /** The Round in which a model of this unit last moved, was moved or was PLACED: it has no Stationary Status that Round. */
  movedRound?: number;
  /** Out of Coherency (4.4): at the end of its last repositioning a model was not Wholly Within Coherency of the Leading Model. Casualties never change it. */
  outOfCoherency?: boolean;
  /** What its abilities gave its weapons until the End of the Round (Stimpack's PRECISION). */
  fx?: AiFx[];
}

/** An ability's effect on an AI unit's numbers, until the End of the Round. */
export interface AiFx {
  source: string;
  precision?: number;
  /** Only weapons whose name contains one of these (lower case). */
  weapons?: string[];
  /** Only weapons of this Phase. */
  weaponPhase?: 'Assault' | 'Combat';
  /** +X to IMPACT Hit Rolls (Adrenal Overload). */
  impactHit?: number;
}

export interface AiDebuff {
  id: string;
  source: string;
  text: string;
  rangeMod?: number;
  noLongRange?: boolean;
  /** Goliath Target Lock: Autocannons gain Surge Light/Armoured D3+1 against this unit. */
  targetLock?: boolean;
  /** Zeratul's Sentenced to Death: his close combat weapons gain CRITICAL HIT (2) against this unit. */
  sentenced?: boolean;
  /** Void Prison and the like: the unit's Speed is reduced while it stays where it is. */
  speedMod?: number;
}

export interface AiArmy {
  faction: Faction;
  factionCardId: string;
  /** A mixed army: the Faction card of each race it fields (the lead race's is `factionCardId`). */
  factionCards?: Partial<Record<Faction, string>>;
  /**
   * The Tactical cards it bought with its Vespene Gas (10% of its budget), card ids, one entry per copy (a Zerg
   * army's Creep card among them): with the Faction cards they give the Army Slots its Units occupy, and they are
   * the card abilities it owns. Absent on an army built before cards were recorded.
   */
  tacticalCards?: string[];
  /** A campaign's story force: it fields what the story fielded, and is not held to Army Slots or Faction Tags. */
  storyForce?: boolean;
  budget: number;
  spent: number;
  units: AiUnitInstance[];
}

/** DEBUFF [Characteristic] (X): speed is X" slower; hit, armour and evade need X more on the die. */
export interface StatDebuff { stat: 'speed' | 'hit' | 'armour' | 'evade'; amount: number }
