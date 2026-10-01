import { describe, expect, it } from 'vitest';
import { unitById } from '@data/index';
import { apply } from '@engine/director/reducer';
import { chargeOrder, rangedOrder } from '@engine/ai/decide';
import { applySense } from '@engine/ai/senseDecide';
import { aiBurrowed, setAiBurrowed } from '@engine/ai/burrow';
import { combatRanks } from '@engine/sense/placement';
import { Rng } from '@engine/rng';
import { ai, battle, pu, up } from './helpers';
import type { AiOrder, GameState } from '@engine/types/game';

const aiTurn = (s: GameState, order: AiOrder): GameState => ({ ...s, step: { kind: 'AI_ORDER', order }, turn: 'ai' });

/** Let the AI take its turns until it is the players' again, collecting the titles of its orders. */
function aiOrders(s0: GameState): { s: GameState; titles: string[] } {
  let s = apply(s0, { t: 'playersPass' });
  const titles: string[] = [];
  for (let i = 0; i < 40 && s.status === 'playing' && s.phase === s0.phase; i++) {
    if (s.step.kind === 'AI_ORDER') { titles.push(s.step.order.title); s = apply(s, { t: 'aiResolve' }); }
    else if (s.step.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
    else break;
  }
  return { s, titles };
}

describe('the AI fires by the book', () => {
  it('LONG RANGE costs -1 to Hit once, for the models beyond the weapon\'s Range', () => {
    // A Goliath 14" from your Marines: beyond the Autocannon's 12", inside its LONG RANGE of 18".
    const s = battle([{ id: 'm', defId: 'marine', at: { x: 18, y: 6 } }], [{ id: 'go', defId: 'goliath', at: { x: 18, y: 23 } }]);
    const base = rangedOrder(s, ai(s, 'go'), Rng.from(3), 'rangedLine', false)!;
    // As the map reads it for the table: -1 on the batch. Resolved by the app: the same -1, never a second one.
    const read = applySense(s, base, Rng.from(3));
    expect(read.batches[0]!.hitMod ?? 0).toBe(-1);
    const after = apply(aiTurn(s, read), { t: 'aiResolve' });
    expect(after.step.kind).toBe('AI_SAVES');
    const a = after.pendingSaves!.attack;
    expect(a.weapon).toBe('Autocannon');
    expect(a.hitMod).toBe(0);
    expect(a.farDice).toBe(a.dice);
    const cannon = unitById('goliath').weapons.find((w) => w.name === 'Autocannon')!;
    expect(a.hits).toBe(a.rolls.filter((r) => r >= cannon.hit + 1).length);
  });

  it('an order card\'s +1 to Hit is for the AI playing blind: not with a map in play', () => {
    const marines = [{ id: 'am', defId: 'marine', at: { x: 18, y: 22 } }];
    const you = [{ id: 'm', defId: 'marine', at: { x: 18, y: 12 } }];
    const mapped = battle(you, marines, { config: { aiFaction: 'Terran' } });
    mapped.orderDeck.current = 'stim';
    expect(rangedOrder(mapped, ai(mapped, 'am'), Rng.from(1), 'rangedLine', false)!.batches[0]!.hitMod ?? 0).toBe(0);
    const blind = battle(you, marines, { config: { aiFaction: 'Terran', playMode: 'tabletop', options: { appRollsAiDice: true, assistedSaves: false, playerHasFlying: false, noMap: true } } });
    blind.orderDeck.current = 'stim';
    expect(rangedOrder(blind, ai(blind, 'am'), Rng.from(1), 'rangedLine', false)!.batches[0]!.hitMod).toBe(1);
  });

  it('an AI Siege Tank enters SIEGE MODE only if it bought Mode Transformation', () => {
    const you = [{ id: 'm', defId: 'marine', at: { x: 18, y: 12 } }, { id: 'x', defId: 'medic' }];
    const plain = battle(you, [{ id: 't', defId: 'siege_tank', at: { x: 18, y: 27 } }], { phase: 'movement', config: { aiFaction: 'Terran' } });
    expect(aiOrders(plain).titles.some((t) => /SIEGE MODE/i.test(t))).toBe(false);
    const bought = battle(you, [{ id: 't', defId: 'siege_tank', at: { x: 18, y: 27 }, upgrades: [up('siege_tank', 'Mode Transformation')] }], { phase: 'movement', config: { aiFaction: 'Terran' } });
    expect(aiOrders(bought).titles.some((t) => /Deploy SIEGE MODE/i.test(t))).toBe(true);
  });
});

describe('the AI charges by the book', () => {
  it('rolls the dice its order states and makes IMPACT only with the models in the Ranks', () => {
    const s = battle([{ id: 'jr', defId: 'jim_raynor', at: { x: 18, y: 10 } }], [{ id: 'z', defId: 'zergling', composition: 'large', at: { x: 17, y: 13 } }], { phase: 'assault' });
    const order = chargeOrder(s, ai(s, 'z'), Rng.from(2), 'meleeRusher', false);
    order.charge = { ...order.charge!, dice: '2d6high' };
    const after = apply(aiTurn(s, order), { t: 'aiResolve' });
    expect(after.lastCharge?.success).toBe(true);
    expect(after.lastCharge?.rolls.length).toBe(2);
    const impact = after.pendingSaves?.attack ?? after.lastAttack;
    expect(impact?.phase).toBe('Impact');
    const ranks = combatRanks(after, 'ai', 'z', ['jr']).total;
    expect(ranks).toBeLessThan(18);
    expect(impact!.models).toBe(ranks);
    expect(impact!.dice).toBe(ranks * unitById('zergling').impact!.dice);
  });

  it('a Burrowed unit that fights has closed ranks: it is no longer BURROWED', () => {
    const s = battle([{ id: 'm', defId: 'marine', at: { x: 18, y: 10 } }], [{ id: 'r', defId: 'roach', at: { x: 18, y: 12.6 } }], { phase: 'combat' });
    setAiBurrowed(ai(s, 'r'), true);
    expect(ai(s, 'r').engaged).toBe(true);
    const claws = unitById('roach').weapons.find((w) => w.phase === 'Combat')!;
    const order: AiOrder = {
      type: 'closeCombat', unitId: 'r', title: 'Close Combat', lines: ['Fight.'],
      batches: [{ weaponId: claws.id, weapon: claws.name, models: 3, dice: 6, hit: claws.hit, dmg: claws.dmg, range: 'E', target: claws.target, keywordsText: [], rolls: [1, 1, 1, 1, 1, 1] }],
      reports: [{ id: 'done', label: 'Resolved' }],
    };
    let after = apply(aiTurn(s, order), { t: 'aiResolve' });
    if (after.step.kind === 'AI_SAVES') after = apply(after, { t: 'enterSaves', saved: 0 });
    expect(aiBurrowed(ai(after, 'r'))).toBe(false);
  });
});

describe('casualties of an Engaged unit (Part 8.7.5)', () => {
  it('come first from the models not Within Engagement Range', () => {
    // Six Marines in two rows; the Zerglings touch only the row nearer to them.
    const s = battle([{ id: 'm', defId: 'marine', at: { x: 18, y: 10 } }], [{ id: 'z', defId: 'zergling', at: { x: 18, y: 12.4 } }], { phase: 'combat' });
    expect(pu(s, 'm').engaged).toBe(true);
    const claws = unitById('zergling').weapons.find((w) => w.phase === 'Combat' && !w.upgradeCost)!;
    const order: AiOrder = {
      type: 'closeCombat', unitId: 'z', title: 'Close Combat', lines: ['Fight.'],
      batches: [{ weaponId: claws.id, weapon: claws.name, models: 2, dice: 4, hit: claws.hit, dmg: claws.dmg, range: 'E', target: claws.target, keywordsText: [], rolls: [6, 6, 6, 6] }],
      reports: [{ id: 'done', label: 'Resolved' }],
    };
    const far = (st: GameState) => (st.sense!.players['m'] ?? []).filter((p) => p.y < 10.6).length;
    const near = (st: GameState) => (st.sense!.players['m'] ?? []).filter((p) => p.y >= 10.6).length;
    const farBefore = far(s), nearBefore = near(s);
    let after = apply(aiTurn(s, order), { t: 'aiResolve' });
    expect(after.step.kind).toBe('AI_SAVES');
    // Keep it to two casualties at most: save all but four hits.
    const hits = after.pendingSaves!.attack.hits;
    after = apply(after, { t: 'enterSaves', saved: Math.max(0, hits - 4) });
    const lost = 6 - pu(after, 'm').models;
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThanOrEqual(farBefore);
    // Every casualty came off the row out of the fight; the row in it is whole.
    expect(far(after)).toBe(farBefore - lost);
    expect(near(after)).toBe(nearBefore);
  });
});
