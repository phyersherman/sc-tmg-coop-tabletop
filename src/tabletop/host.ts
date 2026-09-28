import type { ComponentType, ReactNode } from 'react';
import type { GameConfig, GameState } from '@engine/types/game';

/** How the app follows the table, chosen when a battle is set up. AI only is what this edition plays on its own. */
export type TableHow = 'aiOnly' | 'map' | 'camera' | 'simulation';

/**
 * What the full Co-op Command app adds when it hosts this edition: the battlefield for a game played with a map,
 * its own screens (campaigns, camera tags), and the settings and stylesheet those need. Unset when the tabletop
 * edition runs on its own (the published build), and then nothing offers them.
 */
export interface Simulation {
  /** The battlefield game screen, for a game played with a map. A game without one uses this edition's own. */
  GameScreen: ComponentType;
  /** Its own screens, by name. */
  screens: Record<string, ComponentType>;
  /** Nav entries that open them: the label, its icon, the screen it opens, and which screens count as it. */
  nav: { label: string; icon: string; screen: string; active: string[] }[];
  /** After the nav: full screen, quit, sound. */
  NavTail?: ComponentType;
  /** Mounted on every screen (the audio director, the tutorial coach). */
  Mount?: ComponentType;
  /** Its own settings, under this edition's. */
  Settings?: ComponentType;
  /** The way of playing the last battle was set up with. */
  defaultHow(): TableHow;
  /** The battle is set: it fits the config to the way of playing and says which screen comes next. */
  onLaunch(config: GameConfig, how: TableHow): string;
  /** A battle has ended: what to do with it (a campaign mission counts toward its campaign). */
  onDebrief?(g: GameState): void;
  /** The buttons under a debrief when the battle belongs to something bigger, or null for the usual ones. */
  debriefActions?(g: GameState, go: (screen: string) => void): ReactNode | null;
  /** A small battle on screen that teaches the game, step by step. */
  startPractice?(): void;
  /** Its stylesheet, on the page only while one of its screens is showing. */
  css: string;
}

export const host: { simulation?: Simulation } = {};

/** Whether this game is played with a map (the host's battlefield) or from the cards alone. */
export const usesMap = (g: GameState | null | undefined): boolean => !!g && !g.config.options.noMap && !!host.simulation;
