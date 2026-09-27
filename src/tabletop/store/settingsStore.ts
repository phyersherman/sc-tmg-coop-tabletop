import { create } from 'zustand';

import type { TerrainCatalogItem } from '@data/terrainCatalog';
import { TERRAIN_CATALOG, setContents, type TerrainSetId } from '@data/terrainCatalog';
import type { TerrainInventoryItem } from '@data/terrainCatalog';
import type { PlayerUnit } from '@engine/sense/types';
import type { Faction } from '@engine/types/units';

/** A saved army: its units (with their upgrades), its Faction and Tactical cards, and the game type it was built for. */
export interface RecentArmy {
  id: string;
  savedAt: number;
  name: string;
  faction: Faction;
  scale: 'skirmish' | 'standard' | 'grand';
  cost: number;
  units: PlayerUnit[];
  cards: string[];
}

export interface SettingsState {
  /** Ask before passing while units can still act. */
  confirmPass: boolean;
  /** Round and phase announcements go by without a click; the phase track shows the change instead. */
  skipPhaseBanners: boolean;
  appRollsAiDice: boolean;
  assistedSaves: boolean;
  ownership: Record<string, number>;
  /** Terrain pieces owned, by catalog or custom id -> count. */
  terrainOwned: Record<string, number>;
  /** Player-defined terrain pieces. */
  terrainCustom: TerrainCatalogItem[];
  /** Generate only from the owned collection. */
  useOwnTerrain: boolean;
  playerUnits: PlayerUnit[];
  /** The player's own army built with the unit builder (damage state is reset each game). */
  myArmy: PlayerUnit[];
  setMyArmy(units: PlayerUnit[]): void;
  /** Your Faction card and Tactical cards (definition ids, duplicates allowed for non-unique cards). */
  /** Armies fielded before, to field again: the picker offers those of the same game type within the budget. */
  recentArmies: RecentArmy[];
  /**
   * Save an army under its name (blank: a generic "Terran army 2"). The same army saved again, or another saved under
   * the same name, is replaced and moves to the top. Returns the name it was saved under.
   */
  pushRecentArmy(a: Omit<RecentArmy, 'id' | 'savedAt'>): string;
  removeRecentArmy(id: string): void;
  set(p: Partial<Pick<SettingsState, 'appRollsAiDice' | 'assistedSaves' | 'useOwnTerrain' | 'confirmPass' | 'skipPhaseBanners'>>): void;
  setPlayerUnits(units: PlayerUnit[]): void;
  setTerrainOwned(id: string, n: number): void;
  addCustomTerrain(item: Omit<TerrainCatalogItem, 'id'>, count: number): void;
  removeCustomTerrain(id: string): void;
  /** Add (+1) or remove (−1) one box of an official set. */
  addTerrainSet(setId: TerrainSetId, sign: 1 | -1): void;
  /** Photo thumbnails by terrain id (small data URLs). */
  terrainImages: Record<string, string>;
  setTerrainImage(id: string, dataUrl: string | null): void;
}

/** The inventory to hand to the generator (empty when not using own terrain). */
export function terrainInventory(s: Pick<SettingsState, 'terrainOwned' | 'terrainCustom' | 'useOwnTerrain'>): TerrainInventoryItem[] {
  if (!s.useOwnTerrain) return [];
  return [...TERRAIN_CATALOG, ...s.terrainCustom].map((i) => ({ ...i, count: s.terrainOwned[i.id] ?? 0 })).filter((i) => i.count > 0);
}

// Its own key: the full app's settings carry more than this edition keeps, and must not be overwritten by it.
const KEY = 'sctmg.tabletop.settings.v1';

function load(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem(KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<SettingsState>) : {};
    return saved;
  } catch {
    return {};
  }
}

function save(s: SettingsState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ confirmPass: s.confirmPass, skipPhaseBanners: s.skipPhaseBanners, appRollsAiDice: s.appRollsAiDice, assistedSaves: s.assistedSaves, ownership: s.ownership, terrainOwned: s.terrainOwned, terrainCustom: s.terrainCustom, useOwnTerrain: s.useOwnTerrain, playerUnits: s.playerUnits, terrainImages: s.terrainImages, myArmy: s.myArmy, recentArmies: s.recentArmies }));
  } catch {
    /* ignore */
  }
}

export const useSettings = create<SettingsState>((set, get) => ({
  confirmPass: true,
  skipPhaseBanners: false,
  appRollsAiDice: true,
  assistedSaves: false,
  ownership: {},
  terrainOwned: {},
  terrainCustom: [],
  useOwnTerrain: false,
  playerUnits: [],
  myArmy: [],
  recentArmies: [],
  terrainImages: {},
  ...load(),
  set: (p) => {
    set(p);
    save(get());
  },
  setMyArmy: (units) => {
    set({ myArmy: units });
    save(get());
  },
  pushRecentArmy: (a) => {
    const contents = (r: Omit<RecentArmy, 'id' | 'savedAt'>) => JSON.stringify([r.faction, r.scale, r.units.map((u) => [u.defId, u.composition, u.upgrades.slice().sort()]).sort(), r.cards.slice().sort()]);
    const all = get().recentArmies;
    const same = all.find((r) => contents(r) === contents(a));
    let name = a.name.trim();
    if (!name) {
      // No name given: keep the one this army was saved under before, or number a new one.
      if (same) name = same.name;
      else {
        let n = 1;
        while (all.some((r) => r.name.toLowerCase() === `${a.faction} army ${n}`.toLowerCase())) n++;
        name = `${a.faction} army ${n}`;
      }
    }
    const rest = all.filter((r) => contents(r) !== contents(a) && r.name.toLowerCase() !== name.toLowerCase());
    set({ recentArmies: [{ ...a, name, id: `army-${Date.now().toString(36)}`, savedAt: Date.now() }, ...rest].slice(0, 40) });
    save(get());
    return name;
  },
  removeRecentArmy: (id) => {
    set({ recentArmies: get().recentArmies.filter((r) => r.id !== id) });
    save(get());
  },
  setPlayerUnits: (units) => {
    set({ playerUnits: units });
    save(get());
  },
  setTerrainOwned: (id, n) => {
    set({ terrainOwned: { ...get().terrainOwned, [id]: Math.max(0, n) } });
    save(get());
  },
  addCustomTerrain: (item, count) => {
    const id = `custom-${Date.now().toString(36)}`;
    set({ terrainCustom: [...get().terrainCustom, { ...item, id }], terrainOwned: { ...get().terrainOwned, [id]: Math.max(1, count) } });
    save(get());
  },
  addTerrainSet: (setId, sign) => {
    const owned = { ...get().terrainOwned };
    for (const [id, n] of Object.entries(setContents(setId))) owned[id] = Math.max(0, (owned[id] ?? 0) + sign * n);
    set({ terrainOwned: owned, useOwnTerrain: true });
    save(get());
  },
  setTerrainImage: (id, dataUrl) => {
    const imgs = { ...get().terrainImages };
    if (dataUrl) imgs[id] = dataUrl;
    else delete imgs[id];
    set({ terrainImages: imgs });
    save(get());
  },
  removeCustomTerrain: (id) => {
    const owned = { ...get().terrainOwned };
    delete owned[id];
    const imgs = { ...get().terrainImages };
    delete imgs[id];
    set({ terrainCustom: get().terrainCustom.filter((i) => i.id !== id), terrainOwned: owned, terrainImages: imgs });
    save(get());
  },
}));
