import type { AiOrder, GameState } from '../types/game';
import type { AiObjective, AiUnitInstance } from '../types/army';
import { unitById } from '@data/index';
import { classify } from './profiles';
import { chargeOrder, deployOrder, headingText, moveOrder, rangedOrder, report, speedModFor } from './decide';
import { drawFor, markOnceUsed, modsOf, primaryStep, type ActionCard, type CardStep, type MoveTo } from './actionDecks';
import { findUnit, onTable } from '../director/selectors';
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
  return { type: 'run', unitId: u.id, title: `${u.label}: Run`, lines: [`RUN up to ${speedOf(state, u)}" toward ${head}. End more than 1" from all enemy models.`], heading: objective, headingText: head, batches: [], reports: [report('done', 'Ran')] };
}

function holdOrder(u: AiUnitInstance): AiOrder {
  return { type: 'hold', unitId: u.id, title: `${u.label}: Hold`, lines: ['HOLD: the unit stays where it is. It counts as activated.'], batches: [], reports: [report('done', 'Held')] };
}

/** When the card's attack or charge finds nothing and it says to hold, the unit does not run. */
function holdInstead(order: AiOrder): AiOrder {
  return {
    ...order,
    lines: order.lines.map((l) => (/^Otherwise: RUN/.test(l) ? 'Otherwise: the unit holds where it is.' : l)),
    reports: order.reports.map((r) => (r.id === 'noTarget' ? { ...r, label: 'No target — held' } : r)),
  };
}

function orderFor(state: GameState, u: AiUnitInstance, base: AiOrder, card: ActionCard, step: Exclude<CardStep, { k: 'ability' }> | null, rng: Rng): AiOrder {
  const profile = classify(unitById(u.defId));
  // A unit coming on from Reserves always enters and moves: the card sets how far and where it heads.
  if (base.type === 'deploy') {
    const to = step && (step.k === 'move' || step.k === 'run') ? step.to : 'objective';
    return deployOrder(state, aimed(u, aim(state, u, to === 'cover' ? 'objective' : to)));
  }
  if (!step) return base;
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
 * The AI plays from its action decks: the unit the AI picked draws its type's card (or follows the one its type
 * already drew this phase), and the card decides what it does. Orders the engine keeps for itself stand as they
 * are: a Siege Tank changing stance, a unit breaking away or held in place, a unit engaged in a fight.
 */
export function cardOrder(state: GameState, base: AiOrder, rng: Rng): AiOrder {
  if (!state.config.options.actionDecks) return base;
  if (state.phase !== 'movement' && state.phase !== 'assault') return base;
  const u = findUnit(state, base.unitId);
  if (base.type === 'special' || base.type === 'disengage' || base.held || u.objective.kind === 'lane' || (u.engaged && base.type !== 'deploy') || u.disengagedThisRound) return base;
  const card = drawFor(state, u, rng);
  if (!card) return base;
  u.cardMods = modsOf(card, state.round);
  markOnceUsed(state, card);
  // The card's buffs (the unit's reactions, as the AI never reacts) last until the End of the Round.
  for (const b of card.buffs) if (!(u.buffs ?? []).some((x) => x.name === b.name)) u.buffs = [...(u.buffs ?? []), b];
  const order = orderFor(state, u, base, card, primaryStep(card), rng);
  const abilities = card.steps.filter((s): s is Extract<CardStep, { k: 'ability' }> => s.k === 'ability');
  const lines = [
    ...abilities.map((a) => `${a.name.toUpperCase()} (free for the AI): ${a.text}${a.use ? ` AI: ${a.use}` : ''}`),
    ...order.lines,
    ...card.buffs.map((b) => `Until the End of the Round: ${b.name} — ${b.text}`),
    ...(card.boost ? [`Faction boost — ${card.boost.name}: ${card.boost.text}${card.boost.use ? ` AI: ${card.boost.use}` : ''}`] : []),
  ];
  return { ...order, card, lines, title: `${u.label}: ${card.name}` };
}
