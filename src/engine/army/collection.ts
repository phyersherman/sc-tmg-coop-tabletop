import { UNITS } from '@data/index';
import type { UnitDef } from '../types/units';

/**
 * What you physically own, counted in models. Unit variants are the same miniatures on the shelf — Raynor's
 * Raiders are Marines, Swarmlings are Zerglings — so the collection is kept per physical model and every
 * variant draws on that pool.
 */
export interface Collection {
  version: 1;
  /** Physical model (base unit defId) -> models owned. */
  models: Record<string, number>;
  /** Only field models you own: off lets you proxy anything. */
  enforce: { ai: boolean; player: boolean };
}

export const emptyCollection = (): Collection => ({ version: 1, models: {}, enforce: { ai: true, player: true } });

/**
 * The miniature a unit is made of: "Raynor's Raider (Marine)" is a Marine, "Corpser (Roach)" is a Roach.
 * The unit ids carry the base model in brackets, e.g. `raynor_s_raider__marine_`.
 */
export function physicalModelId(defId: string): string {
  const m = /__(.+)_$/.exec(defId);
  return m ? m[1]! : defId;
}

/** The units that are their own miniature: what a collection is counted in. */
export function modelUnits(): UnitDef[] {
  return UNITS.filter((u) => !u.summoned && physicalModelId(u.id) === u.id);
}

/** Every unit that can be fielded from a physical model (the model itself and all its variants). */
export function unitsFromModel(modelId: string): UnitDef[] {
  return UNITS.filter((u) => !u.summoned && physicalModelId(u.id) === modelId);
}

/**
 * Models available per unit id, for the army builders: a variant can be fielded with the models of the unit
 * it is built from, so both share the same count.
 */
export function ownedModels(c: Collection): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of UNITS) {
    if (u.summoned) continue;
    const n = c.models[physicalModelId(u.id)] ?? 0;
    if (n > 0) out[u.id] = n;
  }
  return out;
}

/** Every miniature in the game, for "I own it all" and for play with the collection turned off. */
export function everything(): { models: Record<string, number> } {
  const models: Record<string, number> = {};
  for (const u of modelUnits()) models[u.id] = Math.max(...unitsFromModel(u.id).flatMap((v) => v.compositions.map((c) => c.models)));
  return { models };
}
