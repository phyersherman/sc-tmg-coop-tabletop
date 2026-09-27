import { unitById } from '@data/index';
import { modelUnits, physicalModelId } from '../army/collection';
import { FIRST_ID } from './registry';

/**
 * Camera tags for a collection: besides the four corner tags, one tag per unit the collection can field at once.
 * 18 Marines field three units of 6 (the smallest a Marine unit comes in), so they get three tags: "Marines 1",
 * "Marines 2", "Marines 3". A tag belongs to that slot for good; in a game it is put on the leading model of
 * whichever unit of that miniature is fielded there, whatever its size or upgrades (the game keeps those).
 */
export interface TagSlot {
  /** `${modelId}#${n}` — the key a slot's tag is stored under. */
  key: string;
  modelId: string;
  /** 1-based: Marines 1, Marines 2… */
  n: number;
  label: string;
}

/** The unit slots a collection holds: per miniature, owned models over the smallest unit it can make. */
export function collectionSlots(models: Record<string, number>): TagSlot[] {
  const out: TagSlot[] = [];
  for (const def of modelUnits()) {
    const owned = models[def.id] ?? 0;
    if (owned <= 0) continue;
    const smallest = Math.max(1, Math.min(...def.compositions.map((c) => c.models)));
    const units = Math.floor(owned / smallest);
    for (let n = 1; n <= units; n++) out.push({ key: `${def.id}#${n}`, modelId: def.id, n, label: units > 1 ? `${def.name} ${n}` : def.name });
  }
  return out;
}

/** Give every slot a permanent id, keeping the ones already given (never renumbered). */
export function allocateSlotTags(slots: TagSlot[], tags: Record<string, number>, capacity: number): Record<string, number> {
  const out = { ...tags };
  let next = Math.max(FIRST_ID, ...Object.values(out).map((id) => id + 1));
  for (const s of slots) if (out[s.key] === undefined && next < capacity) out[s.key] = next++;
  return out;
}

/**
 * The tags for one game: each unit on either side takes the next free slot of its miniature (a Raynor's Raider is
 * a Marine). A unit with no slot left (more of a miniature fielded than owned) gets none and is listed.
 */
export function assignGameTags<A extends { id: string; defId: string; tagId?: number }, P extends { id: string; defId: string; tagId?: number }>(
  ai: A[], players: P[], tags: Record<string, number>,
): { ai: A[]; players: P[]; untagged: string[] } {
  const used = new Map<string, number>();
  const untagged: string[] = [];
  const give = <U extends { id: string; defId: string; tagId?: number }>(u: U, name: string): U => {
    const model = physicalModelId(u.defId);
    const n = (used.get(model) ?? 0) + 1;
    used.set(model, n);
    const tagId = tags[`${model}#${n}`];
    if (tagId === undefined) untagged.push(name);
    return { ...u, tagId };
  };
  // Your units first, so your own miniatures keep the lowest slots from game to game.
  const players2 = players.map((p) => give(p, (p as unknown as { name?: string }).name ?? unitById(p.defId).name));
  const ai2 = ai.map((u) => give(u, (u as unknown as { label?: string }).label ?? unitById(u.defId).name));
  return { ai: ai2, players: players2, untagged };
}
