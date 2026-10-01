import { deploymentById, unitById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { makeConfig } from '../engine/helpers';
import type { GameConfig, GameState, Phase } from '@engine/types/game';
import type { AiUnitInstance } from '@engine/types/army';

export const dep = deploymentById('abandoned-camp');
export const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };

/** The id of a unit's upgrade (a weapon or an ability), by its name on the card. */
export function up(defId: string, name: string): string {
  const d = unitById(defId);
  const x = [...d.weapons, ...d.abilities].find((e) => e.name === name);
  if (!x) throw new Error(`${defId} has no ${name}`);
  return x.id;
}

export interface Spot { id: string; defId: string; at?: { x: number; y: number }; upgrades?: string[]; models?: number; composition?: 'small' | 'large' }

export function aiUnit(sp: Spot): AiUnitInstance {
  const d = unitById(sp.defId);
  const comp = d.compositions.find((c) => c.label === (sp.composition ?? 'small')) ?? d.compositions[0]!;
  const models = sp.models ?? comp.models;
  return {
    id: sp.id, defId: sp.defId, label: `${d.name} ${sp.id}`, composition: comp.label, upgrades: sp.upgrades ?? [],
    maxModels: comp.models, models, damageMarker: 0, shieldsLeft: d.stats.shields ?? 0, location: sp.at ? 'table' : 'reserves',
    activated: { movement: false, assault: false, combat: false }, engaged: false, engagedEnemySupply: 0,
    disengagedThisRound: false, objective: { kind: 'enemy' }, atObjective: false, respawns: 0,
  };
}

const row = (at: { x: number; y: number }, n: number, step = 1.3) => Array.from({ length: n }, (_, k) => ({ x: at.x + (k % 3) * step, y: at.y + Math.floor(k / 3) * step }));

/**
 * A battle already under way on a flat table, in the simulation: your units and the AI's set where the test says
 * (a unit with no spot waits in Reserves), your turn, in the Phase asked for. Engagement follows the positions.
 */
export function battle(players: Spot[], ai: Spot[], opts: { cards?: string[]; phase?: Phase; config?: Partial<GameConfig> } = {}): GameState {
  const cfg = makeConfig({ modeId: 'frontlines', playMode: 'video', ...(opts.config ?? {}) });
  cfg.playerUnits = players.map((u, i) => makePlayerUnit(u.id, u.defId, u.composition ?? 'small', u.upgrades ?? [], unitById(u.defId).name, 400 + i));
  cfg.playerCards = opts.cards ?? [];
  cfg.army = { ...cfg.army, units: ai.map(aiUnit) };
  let s = structuredClone(createGame(cfg, dep, flat));
  s.sense ??= { at: 0, calibrated: true, manual: true, ai: {}, players: {}, terrain: {}, unknown: [] };
  for (const [i, sp] of ai.entries()) {
    const u = s.army.units[i]!;
    u.location = sp.at ? 'table' : 'reserves';
    if (sp.at) { s.sense.ai[u.id] = row(sp.at, u.models); u.est = { ...sp.at }; u.deployedRound = 0; }
  }
  for (const sp of players) {
    const pu = s.playerUnits.find((p) => p.id === sp.id)!;
    if (sp.models !== undefined) pu.models = sp.models;
    pu.location = sp.at ? 'table' : 'reserves';
    if (sp.at) { s.sense.players[pu.id] = row(sp.at, pu.models); pu.deployedRound = 0; }
  }
  const phase = opts.phase ?? 'assault';
  s.phase = phase;
  s.step = { kind: 'PLAYERS_TURN', lines: [] };
  s.turn = 'players';
  s.passed = { ai: false, players: false };
  s.activeUnitId = null;
  for (const pu of s.playerUnits) pu.activated = { movement: phase !== 'movement', assault: phase === 'combat', combat: false };
  for (const u of s.army.units) u.activated = { movement: phase !== 'movement', assault: phase === 'combat', combat: false };
  // Any command re-reads engagement from the positions.
  s = apply(s, { t: 'setOptions', options: {} });
  return s;
}

export const pu = (s: GameState, id: string) => s.playerUnits.find((p) => p.id === id)!;
export const ai = (s: GameState, id: string) => s.army.units.find((u) => u.id === id)!;
export const lastLog = (s: GameState) => s.log[s.log.length - 1]!.text;
