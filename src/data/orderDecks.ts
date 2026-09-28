import type { Faction } from '@engine/types/units';
import type { FocusRule } from '@engine/types/game';

export interface OrderCard {
  id: string;
  name: string;
  flavor: string;
  reshuffle?: boolean;
  deployMax: number | 'all';
  deployBias: 'nearest' | 'flank' | 'ambush';
  advance: 'aggressive' | 'normal' | 'hold';
  chargeThreshold: 'likely' | 'possible';
  hitMod?: number;
  chargeBonus?: number;
  passEarly?: boolean;
  focus?: FocusRule['primary'];
  /** Faction rule text shown on the card. */
  special?: string;
}

export const ORDER_CARDS: Record<string, OrderCard> = {
  advance: { id: 'advance', name: 'Advance', flavor: 'Push forward and take ground.', deployMax: 2, deployBias: 'nearest', advance: 'normal', chargeThreshold: 'possible' },
  hold: { id: 'hold', name: 'Hold Objectives', flavor: 'Dig in on what we own.', deployMax: 1, deployBias: 'nearest', advance: 'hold', chargeThreshold: 'likely', passEarly: true, focus: 'onMarker' },
  focusFire: { id: 'focusFire', name: 'Focus Fire', flavor: 'Finish what we started.', deployMax: 1, deployBias: 'nearest', advance: 'normal', chargeThreshold: 'likely', focus: 'weakest' },
  flank: { id: 'flank', name: 'Flank', flavor: 'Hit them where they are thin.', deployMax: 2, deployBias: 'flank', advance: 'normal', chargeThreshold: 'possible', focus: 'nearestToMarker' },
  reinforce: { id: 'reinforce', name: 'Reinforce', flavor: 'Everything we have, now.', deployMax: 'all', deployBias: 'nearest', advance: 'normal', chargeThreshold: 'likely' },
  allIn: { id: 'allIn', name: 'All-In', flavor: 'No reserves, no retreat.', reshuffle: true, deployMax: 'all', deployBias: 'nearest', advance: 'aggressive', chargeThreshold: 'possible', chargeBonus: 1 },
  // Faction cards
  swarmSurge: { id: 'swarmSurge', name: 'Swarm Surge', flavor: 'The ground itself erupts.', deployMax: 'all', deployBias: 'ambush', advance: 'aggressive', chargeThreshold: 'possible', chargeBonus: 1, special: 'Units with Burrow Ambush may deploy anywhere within 18" of the AI\'s Entry Edge, with no model within 10" of a player model.' },
  stim: { id: 'stim', name: 'Stim', flavor: 'Pop it and push.', deployMax: 2, deployBias: 'nearest', advance: 'aggressive', chargeThreshold: 'likely', hitMod: 1, special: 'Stimpack: every Biological AI Unit that attacks this round takes 1 damage first.' },
  digIn: { id: 'digIn', name: 'Dig In', flavor: 'Hold the line.', deployMax: 1, deployBias: 'nearest', advance: 'hold', chargeThreshold: 'likely', passEarly: true, focus: 'onMarker', special: 'Combat Shield: AI Units that did not move re-roll their first failed Armour save.' },
  warpIn: { id: 'warpIn', name: 'Warp In', flavor: 'The Khala opens.', deployMax: 2, deployBias: 'flank', advance: 'normal', chargeThreshold: 'possible', special: 'One AI Unit may deploy from either side edge that is not a player\'s Entry Edge, more than 10" from every player model.' },
  khalaLink: { id: 'khalaLink', name: 'Khala Link', flavor: 'One mind, many blades.', deployMax: 2, deployBias: 'nearest', advance: 'normal', chargeThreshold: 'likely', hitMod: 1, special: 'AI attacks get +1 to hit this round.' },
};

const BASE = ['advance', 'advance', 'advance', 'hold', 'hold', 'focusFire', 'focusFire', 'flank', 'reinforce', 'allIn'];
const FACTION_EXTRA: Record<Faction, string[]> = {
  Zerg: ['swarmSurge', 'allIn'],
  Terran: ['stim', 'digIn'],
  Protoss: ['warpIn', 'khalaLink'],
};

export function deckFor(faction: Faction): string[] {
  return [...BASE, ...FACTION_EXTRA[faction]];
}
