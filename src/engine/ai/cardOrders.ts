import type { AiOrder, GameState } from '../types/game';
import type { AiObjective, AiUnitInstance } from '../types/army';
import { unitById } from '@data/index';
import { classify } from './profiles';
import { chargeOrder, deployOrder, headingText, moveOrder, rangedOrder, report, speedModFor } from './decide';
import { drawFor, markOnceUsed, modsOf, noMap, primaryStep, usesDecks, type ActionCard, type CardStep, type MoveTo } from './actionDecks';
import { findUnit, onTable } from '../director/selectors';
import { aiBurrowed, aiHas, setAiBurrowed } from './burrow';
import { speedFor } from '../units/speed';
import { dist } from '../terrain/geometry';
import type { Rng } from '../rng';

/** Where a card sends the unit, as an objective the order builders understand. */
function aim(state: GameState, u: AiUnitInstance, to: MoveTo): AiObjective {
  if (to === 'focus') return { kind: 'enemy' };
  if (to === 'friend') {
    const from = u.est;
    const friends = onTable(state).filter((x) => x.id !== u.id && x.defId !== u.defId);
    const near = from ? friends.sort((a, b) => dist(a.est ?? from, from) - dist(b.est ?? from, from))[0] : friends[0];
    return near ? { kind: 'follow', unitId: near.id } : u.objective;
  }
  if (to === 'marker' && u.objective.kind !== 'marker') {
    // The nearest marker the AI does not hold yet.
    const free = state.markers.filter((m) => m.active !== false && m.controlledBy !== 'ai');
    const from = u.est;
    const m = from ? free.sort((a, b) => dist(a, from) - dist(b, from))[0] : free[0];
    return m ? { kind: 'marker', markerId: m.id } : u.objective;
  }
  return u.objective;
}

const aimed = (u: AiUnitInstance, objective: AiObjective): AiUnitInstance => ({ ...u, objective });

function speedOf(state: GameState, u: AiUnitInstance): number {
  return speedFor(unitById(u.defId), u.models) + speedModFor(state, u);
}

function runOrder(state: GameState, u: AiUnitInstance, to: MoveTo): AiOrder {
  const objective = aim(state, u, to);
  const head = to === 'cover' ? `${headingText(state, objective)}, ending within 1" of terrain` : headingText(state, objective);
  return { type: 'run', unitId: u.id, title: `${u.label}: Run`, lines: [`RUN up to ${speedOf(state, u)}" toward ${head}. End more than 1" from every enemy model.`], heading: objective, headingText: head, batches: [], reports: [report('done', 'Ran')] };
}

function holdOrder(u: AiUnitInstance): AiOrder {
  return { type: 'hold', unitId: u.id, title: `${u.label}: Hold`, lines: ['HOLD: the Unit stays where it is and counts as activated.'], batches: [], reports: [report('done', 'Held')] };
}

/** When the card's attack or charge finds nothing and it says to hold, the unit does not run. */
function holdInstead(order: AiOrder): AiOrder {
  return {
    ...order,
    lines: order.lines.map((l) => (/^Otherwise: RUN/.test(l) ? 'Otherwise: it holds where it is.' : l)),
    reports: order.reports.map((r) => (r.id === 'noTarget' ? { ...r, label: 'No target, held' } : r)),
  };
}

function orderFor(state: GameState, u: AiUnitInstance, base: AiOrder, card: ActionCard, step: Exclude<CardStep, { k: 'ability' }> | null, rng: Rng): AiOrder {
  const profile = classify(unitById(u.defId));
  // A unit coming on from Reserves always enters and moves: the card sets how far and where it heads.
  if (base.type === 'deploy') {
    const to = step && (step.k === 'move' || step.k === 'run') ? step.to : 'objective';
    return deployOrder(state, aimed(u, aim(state, u, to === 'cover' ? 'objective' : to)));
  }
  // A card that is only an ability (a Burrow, a placement, a hide) is the whole activation: the unit stays put.
  if (!step) return holdOrder(u);
  switch (step.k) {
    case 'move':
      return moveOrder(state, aimed(u, aim(state, u, step.to)), profile);
    case 'run':
      return runOrder(state, u, step.to);
    case 'hold':
      return holdOrder(u);
    case 'attack': {
      const o = rangedOrder(state, u, rng, profile, false) ?? chargeOrder(state, u, rng, profile, false);
      return step.otherwise === 'hold' ? holdInstead(o) : o;
    }
    case 'charge': {
      const o = chargeOrder(state, u, rng, profile, !!step.orFire);
      return step.otherwise === 'hold' ? holdInstead(o) : o;
    }
  }
}

/**
 * The AI plays from its action decks, in every kind of game: the unit the AI picked chooses a card from its type's
 * pool to suit its situation, and the card decides what it does. Orders the engine keeps
 * for itself stand as they are: a Siege Tank changing stance, a unit breaking away or held in place, a unit engaged
 * in a fight.
 *
 * Only tabletop without a map shows the card as a card (its name as the title, its abilities first). Everywhere
 * else the order reads as it always has, and what the card adds follows it (see `withCardText`).
 */
export function cardOrder(state: GameState, base: AiOrder, rng: Rng): AiOrder {
  if (!usesDecks(state)) return base;
  if (state.phase !== 'movement' && state.phase !== 'assault') return base;
  const u = findUnit(state, base.unitId);
  if (base.type === 'special' || base.type === 'disengage' || base.held || u.objective.kind === 'lane' || (u.engaged && base.type !== 'deploy') || u.disengagedThisRound) return base;
  const card = drawFor(state, u, rng);
  // A Burrowed unit cannot attack or charge: with no card it can play, it holds.
  const lead = card ? primaryStep(card) : null;
  if (aiBurrowed(u) && (!card || lead?.k === 'attack' || lead?.k === 'charge')) {
    return { ...holdOrder(u), lines: ['BURROWED: it cannot attack or charge. It holds where it is and counts as activated.'] };
  }
  if (!card) return base;
  u.cardMods = modsOf(card, state.round);
  markOnceUsed(state, card);
  // The card's buffs (the unit's reactions, as the AI never reacts) last until the End of the Round.
  for (const b of card.buffs) if (!(u.buffs ?? []).some((x) => x.name === b.name)) u.buffs = [...(u.buffs ?? []), b];
  const order = burrowing(u, card, orderFor(state, u, base, card, primaryStep(card), rng));
  // With a map, the order reads as it always has; the card's own text follows it once the camera has had its say.
  if (!noMap(state)) return { ...order, card };
  const [abilities, extras] = cardText(card);
  return { ...order, card, lines: [...abilities, ...order.lines, ...extras], title: `${u.label}: ${card.name}` };
}

/**
 * What the order does to BURROWED: a Move or Run ends it (Tunneling Claws keeps it), then the card's Burrow ability
 * or a Rapid Burrowing boost burrows the unit, or brings a Burrowed one up.
 */
function burrowing(u: AiUnitInstance, card: ActionCard, order: AiOrder): AiOrder {
  const lines: string[] = [];
  if (aiBurrowed(u) && (order.type === 'move' || order.type === 'run') && !aiHas(u, 'Tunneling Claws')) {
    setAiBurrowed(u, false);
    lines.push('It surfaces to move. BURROWED ends.');
  }
  if (card.steps.some((s) => s.k === 'ability' && s.name === 'Burrow')) {
    const on = !aiBurrowed(u);
    setAiBurrowed(u, on);
    lines.push(on ? 'It is now BURROWED.' : 'It surfaces. BURROWED ends.');
  } else if (card.boost?.name === 'Rapid Burrowing' && !aiBurrowed(u)) {
    setAiBurrowed(u, true);
    lines.push('It is now BURROWED.');
  }
  return lines.length ? { ...order, lines: [...order.lines, ...lines] } : order;
}

/** What a card adds to its order in words: the abilities it plays, then its buffs and Faction boost. */
function cardText(card: ActionCard): [string[], string[]] {
  const abilities = card.steps
    .filter((s): s is Extract<CardStep, { k: 'ability' }> => s.k === 'ability')
    .map((a) => `${a.name.toUpperCase()} (free for the AI): ${a.text}${a.use ? ` AI: ${a.use}` : ''}`);
  const extras = [
    ...card.buffs.map((b) => `Until the End of the Round, ${b.name}: ${b.text}`),
    ...(card.boost ? [`Faction Boost (${card.boost.name}): ${card.boost.text}${card.boost.use ? ` AI: ${card.boost.use}` : ''}`] : []),
  ];
  return [abilities, extras];
}

/** A map game's card-driven order, finished: the card's abilities, buffs and boost follow its instructions. */
export function withCardText(state: GameState, order: AiOrder): AiOrder {
  if (!order.card || noMap(state)) return order;
  const [abilities, extras] = cardText(order.card);
  return { ...order, lines: [...order.lines, ...abilities, ...extras] };
}
