import { create } from 'zustand';
import { UNITS } from '@data/index';
import { emptyCollection, everything, ownedModels, physicalModelId, type Collection } from '@engine/army/collection';
import { useSettings } from './settingsStore';
import { allocateSlotTags, collectionSlots } from '@engine/sense/tags';
import { DICT_CAPACITY } from '@engine/sense/registry';

export { ownedModels, physicalModelId, type Collection };

const KEY = 'sctmg.collection.v1';

interface CollectionState extends Collection {
  /** Permanent camera tag ids, one per unit slot of the collection (see engine/sense/tags). */
  unitTags: Record<string, number>;
  /** Give every slot of the collection its tag (new slots only; existing ids never change). */
  ensureUnitTags(): Record<string, number>;
  setModels(modelId: string, n: number): void;
  setEnforce(p: Partial<Collection['enforce']>): void;
  ownEverything(): void;
  clear(): void;
}

function loadTags(): Record<string, number> {
  try { return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as { unitTags?: Record<string, number> }).unitTags ?? {}; } catch { return {}; }
}

function load(): Collection {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Collection & { sets?: Record<string, number> };
      return { ...emptyCollection(), models: saved.models ?? {}, enforce: { ...emptyCollection().enforce, ...saved.enforce } };
    }
  } catch { /* no storage: start empty */ }
  // First run: carry over whatever the old ownership stepper had, folded onto the physical models.
  try {
    const s = useSettings.getState();
    const seeded = emptyCollection();
    for (const [defId, n] of Object.entries(s.ownership)) {
      const id = physicalModelId(defId);
      seeded.models[id] = Math.max(seeded.models[id] ?? 0, n);
    }
    return seeded;
  } catch {
    return emptyCollection();
  }
}

function persist(c: Collection & { unitTags?: Record<string, number> }): void {
  try { localStorage.setItem(KEY, JSON.stringify({ version: c.version, models: c.models, enforce: c.enforce, unitTags: c.unitTags ?? {} })); } catch { /* private mode */ }
}

export const useCollection = create<CollectionState>((set, get) => ({
  ...load(),
  unitTags: loadTags(),
  ensureUnitTags: () => {
    const tags = allocateSlotTags(collectionSlots(get().models), get().unitTags, DICT_CAPACITY['36h12']);
    if (Object.keys(tags).length !== Object.keys(get().unitTags).length) { set({ unitTags: tags }); persist(get()); }
    return tags;
  },
  setModels: (modelId, n) => { set({ models: { ...get().models, [modelId]: Math.max(0, n) } }); persist(get()); },
  setEnforce: (p) => { set({ enforce: { ...get().enforce, ...p } }); persist(get()); },
  ownEverything: () => { set({ models: everything().models }); persist(get()); },
  clear: () => { set({ models: {} }); persist(get()); },
}));

/**
 * The miniatures a side is held to, or `undefined` when it is held to none: in the simulation nothing goes on a
 * real table, so neither army is limited by what is on your shelf, and with enforcement off the same is true.
 */
export function modelLimit(side: 'ai' | 'player', playMode: 'tabletop' | 'video' = 'tabletop'): Record<string, number> | undefined {
  const c = useCollection.getState();
  return c.enforce[side] && playMode === 'tabletop' ? ownedModels(c) : undefined;
}

/**
 * The same, as counts an army builder can subtract from as it spends. No limit is not "one squad of each": it is
 * as many as the budget will carry, so a simulation force can field three units of the same kind.
 */
export function availableModels(side: 'ai' | 'player', playMode: 'tabletop' | 'video' = 'tabletop'): Record<string, number> {
  return modelLimit(side, playMode) ?? unlimitedModels();
}

/** Every model in the game, in numbers no army could exhaust. */
export function unlimitedModels(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of UNITS) if (!u.summoned) out[u.id] = 999;
  return out;
}
