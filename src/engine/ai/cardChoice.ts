import type { AiUnitInstance } from '../types/army';
import type { GameState } from '../types/game';
import { unitById } from '@data/index';
import { onTable } from '../director/selectors';
import type { Rng } from '../rng';
import { aiBurrowed, aiHas } from './burrow';
import type { ActionCard, CardStep } from './actionDecks';

/**
 * How an AI unit chooses its action card. Its deck is a pool of the actions it has, not a shuffled pile: every time
 * it activates it weighs each card against what it knows of itself, without a map. That is its statuses, whether it
 * holds its objective, the damage it has taken and the models it has lost, how its friends stand, the round and the
 * score. Cards it cannot play (an attack while Burrowed, a spent Once per Game ability) weigh nothing. The pick is
 * then made at random by weight, so it stays hard to read but plays to its situation.
 */

export interface Situation {
  phase: 'movement' | 'assault';
  /** Coming on from Reserves: the card only sets where it heads. */
  deploying: boolean;
  burrowed: boolean;
  hidden: boolean;
  /** It stands on the Mission Marker it was sent to. */
  onObjective: boolean;
  /** Share of its starting hit points gone, models lost included (0 fresh, near 1 almost dead). */
  hurt: number;
  lastModel: boolean;
  /** Another AI unit on the table has taken damage. */
  friendHurt: boolean;
  /** A players' unit has taken damage or lost models. */
  enemyHurt: boolean;
  /** The last two rounds. */
  late: boolean;
  /** The AI trails on Victory Points (or leads). */
  behind: boolean;
  ahead: boolean;
}

function hurtOf(u: AiUnitInstance): number {
  const hp = unitById(u.defId).stats.hp || 1;
  const full = u.maxModels * hp;
  const now = Math.max(0, u.models * hp - u.damageMarker);
  return full > 0 ? 1 - now / full : 0;
}

export function situationOf(state: GameState, u: AiUnitInstance): Situation {
  const phase = state.phase === 'assault' ? 'assault' : 'movement';
  return {
    phase,
    deploying: u.location === 'reserves',
    burrowed: aiBurrowed(u),
    hidden: (u.statuses ?? []).includes('Hidden'),
    onObjective: u.location === 'table' && u.atObjective && u.objective.kind === 'marker',
    hurt: hurtOf(u),
    lastModel: u.maxModels > 1 && u.models === 1,
    friendHurt: onTable(state).some((f) => f.id !== u.id && f.damageMarker > 0),
    enemyHurt: state.playerUnits.some((p) => !p.destroyed && (p.damageMarker > 0 || p.models < p.maxModels)),
    late: state.round >= state.finalRound - 1,
    behind: state.vp.ai < state.vp.players,
    ahead: state.vp.ai > state.vp.players,
  };
}

type Lead = Exclude<CardStep, { k: 'ability' }>;
const leadOf = (c: ActionCard) => c.steps.find((s): s is Lead => s.k !== 'ability') ?? null;

/** What the card's action is worth to a unit in this situation (before its abilities). */
function actionWeight(lead: Lead | null, s: Situation): number {
  const hurt = s.hurt >= 0.5 || s.lastModel;
  const fresh = s.hurt < 0.15;
  if (!lead) return 1;
  switch (lead.k) {
    case 'hold':
      return s.onObjective ? 2.5 : s.burrowed ? 1.8 : hurt ? 1.6 : 0.3;
    case 'move':
    case 'run': {
      if (s.burrowed && s.hurt > 0.2) return 0.4;
      switch (lead.to) {
        case 'cover': return s.onObjective ? 1.5 : hurt ? 2 : fresh ? 0.3 : 0.8;
        case 'friend': return hurt ? 1.5 : s.onObjective ? 0.2 : 0.6;
        case 'objective': return s.onObjective ? 0.2 : (lead.k === 'run' ? 0.8 : 1.5) * (s.late || s.behind ? 1.3 : 1);
        case 'marker': return s.onObjective ? 0.2 : (s.late || s.behind ? 1.6 : 1.1);
        case 'focus': return hurt ? 0.3 : s.onObjective ? 0.4 : (fresh ? 1.4 : 1) * (s.behind ? 1.2 : 1);
      }
      return 1;
    }
    case 'attack': {
      if (s.burrowed) return 0;
      let w = 2;
      // Staying put on the marker when nothing is in range beats running off it.
      if (s.onObjective) w = lead.otherwise === 'hold' ? 2.6 : 1.2;
      if (lead.focus === 'weakest' && s.enemyHurt) w += 0.6;
      if (lead.focus === 'highestSupply' && s.ahead) w += 0.4;
      return w;
    }
    case 'charge': {
      if (s.burrowed) return 0;
      if (hurt) return 0.3;
      if (s.onObjective) return lead.focus === 'onMarker' ? 1.6 : 0.5;
      let w = fresh ? 1.8 : 1.2;
      if (lead.focus === 'weakest' && s.enemyHurt) w += 0.6;
      if (lead.focus === 'onMarker' && (s.late || s.behind)) w += 0.5;
      return w * (s.behind ? 1.2 : s.ahead ? 0.85 : 1);
    }
  }
}

/** What the card's abilities add or take away: 0 when one of them cannot be played now. */
function abilityWeight(state: GameState, u: AiUnitInstance, card: ActionCard, s: Situation): number {
  let w = 1;
  const hurt = s.hurt >= 0.4 || s.lastModel;
  for (const step of card.steps) {
    if (step.k !== 'ability') continue;
    const t = step.text;
    if (/Once per Game/i.test(t) && usedBy(state, card, step.name)) return 0;
    if (/while this Unit has the Burrowed Status/i.test(t) && !/gains or loses/i.test(t) && !s.burrowed) return 0;
    if (step.name === 'Burrow') {
      // Down to heal and hide; up once it is whole again. A Burrowed unit cannot hold a marker.
      const regen = aiHas(u, 'Regeneration');
      if (s.burrowed) w *= s.hurt < 0.15 ? 2.5 : regen ? 0.15 : 0.6;
      else w *= s.onObjective ? 0.1 : hurt ? (regen ? 3 : 2) : 0.3;
      continue;
    }
    // An ability that costs the unit its own hit points (Stimpack) is for a unit that can spare them.
    if (/NON-LETHAL DAMAGE|suffers? \d+ Damage|this Unit (suffers|receives)/i.test(t) && !/Enemy/i.test(t.split('.')[0] ?? '')) w *= hurt ? 0.15 : 1.5;
    // Healing is for when someone is hurt.
    else if (/\bHEAL\b|Medpack|Transfusion|regain/i.test(t)) w *= s.friendHurt || s.hurt > 0 ? 2.5 : 0.1;
    // Slipping away: hiding or being set elsewhere suits a hurt unit.
    else if (/\bHIDDEN\b|\bPLACE\b/.test(t)) w *= hurt ? 1.8 : 1;
    // Speed, dice and charge buffs suit a unit going forward.
    else if (/BUFF|roll 2D6|Charge Distance/i.test(t)) w *= hurt ? 0.6 : 1.4;
    else w *= 1.2;
  }
  return w;
}

function usedBy(state: GameState, card: ActionCard, name: string): boolean {
  return Object.values(state.aiDecks ?? {}).some((d) => d.cards[0]?.defId === card.defId && (d.used ?? []).includes(name));
}

/** How much a unit in its situation wants to play this card now (0: it cannot or should not). */
export function cardWeight(state: GameState, u: AiUnitInstance, card: ActionCard, s = situationOf(state, u)): number {
  // Coming on from Reserves, only where the card sends it matters: an attack or a hold still brings it on.
  if (s.deploying) return abilityWeight(state, u, card, s) > 0 ? 1 : 0;
  return actionWeight(leadOf(card), s) * abilityWeight(state, u, card, s);
}

/** Picks a card at random by weight; a card its type played in the last two picks counts for half. */
export function chooseCard(state: GameState, u: AiUnitInstance, cards: ActionCard[], recent: string[], rng: Rng): ActionCard | null {
  const s = situationOf(state, u);
  const weighted = cards.map((c) => ({ c, w: cardWeight(state, u, c, s) * (recent.includes(c.id) ? 0.5 : 1) })).filter((x) => x.w > 0);
  const total = weighted.reduce((a, x) => a + x.w, 0);
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return x.c;
  }
  return weighted[weighted.length - 1]!.c;
}
