import { describe, expect, it } from 'vitest';
import { autoPay, payValue, pickForPay, sparePayCard } from '@engine/abilities/index';
import type { GameState } from '@engine/types/game';

// Two Ready cards worth 1 and one worth 2, as the card bar sees them.
const state = { playerCards: [
  { id: 'a', defId: 'forge', exhausted: false },
  { id: 'b', defId: 'gate_chronoboosted', exhausted: false },
  { id: 'c', defId: 'daelaam', exhausted: false },
] } as unknown as GameState;

describe('paying with cards', () => {
  it('counts a card at its resource value', () => {
    expect(payValue(state, ['a', 'b'])).toBe(2);
  });
  it('picking a second card for a cost of one swaps rather than stacks', () => {
    const one = pickForPay(state, [], 'a', 1);
    expect(one).toEqual(['a']);
    expect(pickForPay(state, one, 'b', 1)).toEqual(['b']);
  });
  it('keeps both cards when the cost needs both', () => {
    expect(pickForPay(state, ['a'], 'b', 2)).toEqual(['a', 'b']);
  });
  it('spots a card the rest of the payment already covers', () => {
    expect(sparePayCard(state, ['a', 'b'], 1)?.id).toBe('a');
    expect(sparePayCard(state, ['a', 'b'], 2)).toBeNull();
  });
  it('auto-pay never exhausts more than the cost needs', () => {
    const picked = autoPay(state, 1) ?? [];
    expect(payValue(state, picked.map((c) => c.id))).toBe(1);
    expect(picked).toHaveLength(1);
  });
});
