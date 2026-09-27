import { create } from 'zustand';
import type { GameConfig, GameState } from '@engine/types/game';
import { apply, createGame, normalizePositions, type Command } from '@engine/director/reducer';
import { deploymentById } from '@data/index';
import { mapLayout, remixId } from '@engine/terrain/remix';

// Its own saved battle: a simulation save is not a tabletop one.
const KEY = 'sctmg.tabletop.save.v1';

interface Saved {
  game: GameState;
  undo: GameState[];
  savedAt: string;
}

export interface GameStore {
  game: GameState | null;
  undo: GameState[];
  savedAt: string | null;
  /** Last dispatched command, for animation triggers. */
  lastCommand: { seq: number; cmd: Command; unitId?: string } | null;
  start(config: GameConfig): GameState;
  dispatch(cmd: Command): void;
  undoLast(): void;
  abandon(): void;
  importSave(json: string): boolean;
  exportSave(): string;
}

function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (!s.game || s.game.version !== 1) return null;
    s.game = migrate(s.game);
    s.undo = (s.undo ?? []).map(migrate);
    return s;
  } catch {
    return null;
  }
}

/** Fill in fields added after a save was written. */
function migrate(g: GameState): GameState {
  g.playerUnits = (g.playerUnits ?? []).filter((pu) => 'defId' in pu);
  g.supply.bonus ??= 0;
  g.labelCounters ??= {};
  // Older saves stored one point per unit: set every model's base.
  return normalizePositions(g);
}

let timer: ReturnType<typeof setTimeout> | null = null;
function persist(get: () => GameStore): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      const { game, undo } = get();
      if (!game) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, JSON.stringify({ game, undo: undo.slice(-8), savedAt: new Date().toISOString() } satisfies Saved));
    } catch {
      /* storage may be unavailable */
    }
  }, 150);
}

const initial = load();

export const useGame = create<GameStore>((set, get) => ({
  game: initial?.game ?? null,
  undo: initial?.undo ?? [],
  savedAt: initial?.savedAt ?? null,
  lastCommand: null,
  start: (config) => {
    const dep = deploymentById(config.deploymentId);
    // A table in the rulebook's own style: the map asked for, or a remix of the printed maps from the seed.
    const terrain = mapLayout(config.terrainMapId ?? remixId(dep.scale, config.terrainSeed), dep);
    const game = createGame(config, dep, terrain);
    set({ game, undo: [], savedAt: new Date().toISOString() });
    persist(get);
    return game;
  },
  dispatch: (cmd) => {
    const { game, undo } = get();
    if (!game) return;
    const next = apply(game, cmd);
    const unitId = game.step.kind === 'AI_ORDER' ? game.step.order.unitId : undefined;
    set({ game: next, undo: [...undo.slice(-19), game], lastCommand: { seq: (get().lastCommand?.seq ?? 0) + 1, cmd, unitId } });
    persist(get);
  },
  undoLast: () => {
    const { undo } = get();
    const prev = undo[undo.length - 1];
    if (!prev) return;
    set({ game: prev, undo: undo.slice(0, -1) });
    persist(get);
  },
  abandon: () => {
    set({ game: null, undo: [], savedAt: null });
    persist(get);
  },
  importSave: (json) => {
    try {
      const s = JSON.parse(json) as Saved;
      if (!s.game || s.game.version !== 1) return false;
      set({ game: migrate(s.game), undo: (s.undo ?? []).map(migrate), savedAt: s.savedAt ?? null });
      persist(get);
      return true;
    } catch {
      return false;
    }
  },
  exportSave: () => JSON.stringify({ game: get().game, undo: [], savedAt: new Date().toISOString() }),
}));

// The live stores, for poking at a running game from the browser console while developing.
if (import.meta.env.DEV) (window as unknown as { __game: typeof useGame }).__game = useGame;
