import unitsJson from './units.json';
import cardsJson from './cards.json';
import type { CardDef, Faction, UnitDef } from '@engine/types/units';
import { MISSION_STRUCTURES } from './missionObjects';

export const UNITS: UnitDef[] = (unitsJson as unknown as { units: UnitDef[] }).units;
export const CARDS: CardDef[] = (cardsJson as unknown as { cards: CardDef[] }).cards;

// Mission structures can be looked up like any unit, but are not in UNITS: no army picker offers them.
const byId = new Map([...UNITS, ...MISSION_STRUCTURES].map((u) => [u.id, u]));

export function unitById(id: string): UnitDef {
  const u = byId.get(id);
  if (!u) throw new Error(`Unknown unit ${id}`);
  return u;
}

export function unitsForFaction(faction: Faction): UnitDef[] {
  return UNITS.filter((u) => u.faction === faction);
}

export function factionCards(faction: Faction): CardDef[] {
  return CARDS.filter((c) => c.isFactionCard && c.faction === faction);
}

import deploymentsJson from './deployments.json';
import type { DeploymentLayout } from '@engine/types/terrain';
export const DEPLOYMENTS: DeploymentLayout[] = (deploymentsJson as unknown as { layouts: DeploymentLayout[] }).layouts;
export function deploymentById(id: string): DeploymentLayout {
  const d = DEPLOYMENTS.find((x) => x.id === id);
  if (!d) throw new Error(`Unknown deployment ${id}`);
  return d;
}
