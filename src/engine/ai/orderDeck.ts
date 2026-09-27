import type { OrderCardState } from '../types/game';
import type { Rng } from '../rng';
import { ORDER_CARDS, type OrderCard } from '@data/orderDecks';

export function initDeck(cards: string[], rng: Rng): OrderCardState {
  return { draw: rng.shuffle(cards), discard: [], current: null, history: [] };
}

export function drawCard(deck: OrderCardState, rng: Rng): OrderCardState {
  let draw = deck.draw.slice();
  let discard = deck.discard.slice();
  if (deck.current) discard.push(deck.current);
  if (draw.length === 0) {
    draw = rng.shuffle(discard);
    discard = [];
  }
  const current = draw.shift() ?? null;
  const card = current ? ORDER_CARDS[current] : undefined;
  if (card?.reshuffle) {
    draw = rng.shuffle([...draw, ...discard]);
    discard = [];
  }
  return { draw, discard, current, history: [...deck.history, current ?? ''] };
}

export function currentCard(deck: OrderCardState): OrderCard {
  const c = deck.current ? ORDER_CARDS[deck.current] : undefined;
  return c ?? (ORDER_CARDS['advance'] as OrderCard);
}
