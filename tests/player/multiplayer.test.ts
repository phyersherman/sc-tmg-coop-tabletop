import { describe, expect, it } from 'vitest';
import { deploymentById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { cardBoosts, playerResource, readyCards } from '@engine/abilities/index';
import { makeConfig } from '../engine/helpers';
import type { GameState } from '@engine/types/game';

const dep = deploymentById('abandoned-camp');
const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };

function toPlayersTurn(s: GameState): GameState {
  for (let i = 0; i < 60 && s.step.kind !== 'PLAYERS_TURN'; i++) {
    if (s.step.kind === 'AI_ORDER') s = apply(s, { t: 'aiResolve' });
    else if (s.step.kind === 'AI_SAVES') s = apply(s, { t: 'enterSaves', saved: 0 });
    else s = apply(s, { t: 'continue' });
  }
  return s;
}

/** Two players at the table: Terran Marines for player 1, Zerg Zerglings for player 2, each with their own cards. */
function twoPlayerGame(): GameState {
  const cfg = makeConfig({ modeId: 'frontlines', aiFaction: 'Protoss', players: 2 });
  cfg.playerUnits = [
    { ...makePlayerUnit('m1', 'marine', 'small', [], 'Marines', 100), owner: 0 },
    { ...makePlayerUnit('z1', 'zergling', 'small', [], 'Zerglings', 101), owner: 1 },
  ];
  cfg.playerCards = [{ defId: 'terran_armed_forces', owner: 0 }, { defId: 'barracks', owner: 0 }, { defId: 'zerg_swarm', owner: 1 }];
  let s = createGame(cfg, dep, flat);
  s = toPlayersTurn(s);
  s = apply(s, { t: 'playerDeploy', unitId: 'm1', point: { x: 12, y: 3 } });
  s = toPlayersTurn(s);
  s.playerUnits.find((p) => p.id === 'm1')!.activated.movement = false;
  return s;
}

describe('several players, each with their own army', () => {
  it('gives every card to the player who brought it, and each player their own resource', () => {
    const s = twoPlayerGame();
    expect(s.playerCards!.map((c) => c.owner)).toEqual([0, 0, 1]);
    expect(playerResource(s, 0)).toBe('CP');
    expect(playerResource(s, 1)).toBe('BM');
    expect(readyCards(s, 0)).toHaveLength(2);
    expect(readyCards(s, 1)).toHaveLength(1);
  });

  it('pays a unit\'s ability only from its own player\'s cards', () => {
    let s = twoPlayerGame();
    // Player 2's card is the only one named: player 1's Marines cannot spend it.
    const zergCard = s.playerCards!.find((c) => c.owner === 1)!;
    const refused = apply(s, { t: 'useAbility', unitId: 'm1', name: 'Stimpack', payWith: [zergCard.id] });
    expect(refused.log[refused.log.length - 1]!.text).toMatch(/another player/);
    expect(refused.playerCards!.every((c) => !c.exhausted)).toBe(true);
    // Left to choose, the app pays with player 1's own cards and leaves player 2's alone.
    s = apply(s, { t: 'useAbility', unitId: 'm1', name: 'Stimpack' });
    expect(s.playerUnits.find((p) => p.id === 'm1')!.damageMarker).toBe(2);
    expect(s.playerCards!.filter((c) => c.exhausted).every((c) => c.owner === 0)).toBe(true);
    expect(s.playerCards!.find((c) => c.owner === 1)!.exhausted).toBe(false);
  });

  it('offers a card\'s boosts only to its own player\'s units', () => {
    const s = twoPlayerGame();
    const marines = s.playerUnits.find((p) => p.id === 'm1')!;
    const forZerg = cardBoosts(s, marines).filter((b) => b.card.owner === 1);
    expect(forZerg.length).toBeGreaterThan(0);
    expect(forZerg.every((b) => !b.ok && /Player 2/.test(b.reason ?? ''))).toBe(true);
    const refused = apply(s, { t: 'useBoost', cardId: s.playerCards!.find((c) => c.owner === 1)!.id, boost: 'Zerg Swarm', unitId: 'm1' });
    expect(refused.playerCards!.every((c) => !c.exhausted)).toBe(true);
  });

  it('treats a one-player game exactly as before: bare card ids, everything player 1\'s', () => {
    const cfg = makeConfig({ modeId: 'frontlines' });
    cfg.playerUnits = [makePlayerUnit('m1', 'marine', 'small', [], 'Marines', 100)];
    cfg.playerCards = ['terran_armed_forces', 'barracks'];
    const s = createGame(cfg, dep, flat);
    expect(s.playerCards!.map((c) => c.owner)).toEqual([0, 0]);
    expect(readyCards(s)).toHaveLength(2);
    expect(playerResource(s)).toBe('CP');
  });
});

describe('supply with two players', () => {
  it('gives each player the whole pool, and the AI both pools together', async () => {
    const { playerAvailable, playerPool } = await import('@engine/player/rules');
    const { supplyFor } = await import('@engine/difficulty');
    const cfg = makeConfig({ modeId: 'frontlines', aiFaction: 'Protoss', players: 2 });
    cfg.playerUnits = [
      { ...makePlayerUnit('m1', 'marine', 'small', [], 'Marines', 100), owner: 0 },
      { ...makePlayerUnit('m2', 'marine', 'small', [], 'Marines B', 102), owner: 0 },
      { ...makePlayerUnit('z1', 'zergling', 'small', [], 'Zerglings', 101), owner: 1 },
    ];
    let s = createGame(cfg, dep, flat);
    // The AI's pool is two players' worth.
    expect(s.supply.start).toBe(supplyFor('skirmish', 'normal', 1).start * 2);
    s = toPlayersTurn(s);
    const pool = playerPool(s);
    expect(playerAvailable(s, 0)).toBe(pool);
    expect(playerAvailable(s, 1)).toBe(pool);
    // Player 1 deploys: only player 1's pool is drawn on.
    s = apply(s, { t: 'playerDeploy', unitId: 'm1', point: { x: 12, y: 3 } });
    const used = s.playerUnits.find((p) => p.id === 'm1')!;
    expect(used.location).toBe('table');
    expect(playerAvailable(s, 0)).toBeLessThan(pool);
    expect(playerAvailable(s, 1)).toBe(pool);
  });
});
