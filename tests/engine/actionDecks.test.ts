import { describe, expect, it } from 'vitest';
import { CARDS, UNITS } from '@data/index';
import { buildDeck, faceCard, type ActionCard } from '@engine/ai/actionDecks';
import { cardWeight } from '@engine/ai/cardChoice';
import { COOP_MODES } from '@engine/missions/coop';
import { makeConfig, playGame } from './helpers';
import { deploymentById, unitById } from '@data/index';
import { createGame } from '@engine/director/reducer';
import { mapLayout, remixId } from '@engine/terrain/remix';
import { makeInstance } from '@engine/army/builder';
import { cardOrder } from '@engine/ai/cardOrders';
import { aiBurrowed, setAiBurrowed } from '@engine/ai/burrow';
import { Rng } from '@engine/rng';
import type { AiOrder } from '@engine/types/game';

const fielded = UNITS.filter((u) => !u.summoned);
const allUpgrades = (id: string) => {
  const u = UNITS.find((x) => x.id === id)!;
  return [...u.weapons, ...u.abilities].filter((x) => x.upgradeCost).map((x) => x.id);
};

describe('action decks', () => {
  it('gives every unit type a Movement and an Assault deck', () => {
    for (const u of fielded) {
      for (const phase of ['movement', 'assault'] as const) {
        const deck = buildDeck(u, allUpgrades(u.id), phase);
        expect(deck.length, `${u.id} ${phase}`).toBeGreaterThanOrEqual(3);
        expect(new Set(deck.map((c) => c.id)).size, `${u.id} ${phase} ids`).toBe(deck.length);
      }
    }
  });

  it('puts every Active ability on a card and every Reaction on a buff, never as an action', () => {
    for (const u of fielded) {
      const cards: ActionCard[] = [...buildDeck(u, allUpgrades(u.id), 'movement'), ...buildDeck(u, allUpgrades(u.id), 'assault')];
      const used = new Set(cards.flatMap((c) => c.steps.flatMap((s) => (s.k === 'ability' ? [s.name] : []))));
      const buffs = new Set(cards.flatMap((c) => c.buffs.map((b) => b.name)));
      for (const a of u.abilities) {
        if (a.kind === 'Reaction') {
          expect(used.has(a.name), `${u.id} ${a.name} as action`).toBe(false);
          expect(buffs.has(a.name), `${u.id} ${a.name} as buff`).toBe(true);
        }
        const skipped = a.name === 'Mode Transformation' || /\bSUMMON\b/.test(a.text) || (a.kind === 'Active' && a.phase === 'Combat');
        if (a.kind === 'Active' && !skipped) expect(used.has(a.name), `${u.id} ${a.name}`).toBe(true);
      }
    }
  });

  it('leaves upgrade abilities out until the AI buys them', () => {
    const marine = UNITS.find((u) => u.id === 'marine')!;
    const named = (deck: ActionCard[]) => deck.flatMap((c) => c.steps.flatMap((s) => (s.k === 'ability' ? [s.name] : [])));
    expect(named(buildDeck(marine, [], 'movement'))).not.toContain('Combat Shield');
    const shield = marine.abilities.find((a) => a.name === 'Combat Shield')!;
    expect(named(buildDeck(marine, [shield.id], 'movement'))).toContain('Combat Shield');
  });

  it('puts a Faction card boost where its timing fits, and leaves out the ones the AI has no use for', () => {
    const zealot = UNITS.find((u) => u.id === 'zealot')!;
    const daelaam = CARDS.find((c) => c.id === 'daelaam')!;
    const move = buildDeck(zealot, [], 'movement', daelaam);
    const assault = buildDeck(zealot, [], 'assault', daelaam);
    // Mass Recall would pull its own units off the table: never on a card.
    expect(move.concat(assault).some((c) => c.boost?.name === 'Mass Recall')).toBe(false);
    // Dae'Uhl covers the unit after it attacks (or charges, for a Zealot).
    const withBoost = assault.filter((c) => c.boost);
    expect(withBoost.map((c) => c.boost!.name)).toEqual([daelaam.boosts[1]!.name]);
    expect(['attack', 'charge']).toContain(withBoost[0]!.steps.find((s) => s.k !== 'ability')!.k);
    // Wild Mutation rides a Zerg ground unit's move, used before it moves if it starts on creep.
    const ling = UNITS.find((u) => u.id === 'zergling')!;
    const swarm = CARDS.find((c) => c.id === 'kerrigan_s_swarm')!;
    const wild = buildDeck(ling, [], 'movement', swarm).find((c) => c.boost);
    expect(wild?.boost?.name).toBe('Wild Mutation');
    expect(wild!.steps[0]!.k).toBe('move');
  });

  it('plays co-op missions at the table from the decks, each unit choosing its own card', () => {
    const plays = [[COOP_MODES[0]!, 'Zerg'], [COOP_MODES[2]!, 'Terran'], [COOP_MODES[4]!, 'Protoss']] as const;
    for (const [mode, faction] of plays) {
      const cfg = makeConfig({ modeId: mode.id, aiFaction: faction, playMode: 'tabletop' });
      cfg.options = { ...cfg.options, actionDecks: true, noMap: true };
      let carded = 0;
      const r = playGame(cfg, {
        seed: 5,
        onOrder: (s, o) => {
          if (!o.card) return;
          carded++;
          const u = s.army.units.find((x) => x.id === o.unitId)!;
          // The card shown on the unit is the one it plays, and it is one it can play.
          expect(faceCard(s, u)?.id).toBe(o.card.id);
          expect(u.location === 'reserves' || cardWeight(s, u, o.card) > 0, o.card.name).toBe(true);
        },
      });
      expect(r.state.status, `${mode.id} ${faction}`).not.toBe('playing');
      expect(carded, `${mode.id} ${faction}`).toBeGreaterThan(0);
    }
  });
});

describe('choosing a card by situation', () => {
  const def = UNITS.find((u) => u.id === 'marine')!;
  const cfg = makeConfig({ modeId: 'frontlines', aiFaction: 'Terran', playMode: 'tabletop' });
  const base = () => {
    const dep = deploymentById(cfg.deploymentId);
    const s = createGame(cfg, dep, mapLayout(remixId(dep.scale, cfg.terrainSeed), dep));
    const u = makeInstance(def, 'large', 'Marines', 1);
    u.location = 'table';
    s.army.units = [u];
    return { s, u };
  };
  const by = (cards: ActionCard[], name: string) => cards.find((c) => c.name === name)!;

  it('holds its marker rather than advancing off it', () => {
    const { s, u } = base();
    s.phase = 'movement';
    u.objective = { kind: 'marker', markerId: 1 };
    u.atObjective = true;
    const deck = buildDeck(def, [], 'movement');
    expect(cardWeight(s, u, by(deck, 'Take the Ground'))).toBeLessThan(cardWeight(s, u, deck.find((c) => c.steps.some((x) => (x.k === 'move' || x.k === 'run') && x.to === 'cover'))!));
  });

  it('takes cover when badly hurt, and presses on when fresh', () => {
    const { s, u } = base();
    s.phase = 'movement';
    const deck = buildDeck(def, [], 'movement');
    const cover = deck.find((c) => c.steps.some((x) => (x.k === 'move' || x.k === 'run') && x.to === 'cover'))!;
    const close = by(deck, 'Close to Range');
    expect(cardWeight(s, u, close)).toBeGreaterThan(cardWeight(s, u, cover));
    u.models = 2;
    expect(cardWeight(s, u, cover)).toBeGreaterThan(cardWeight(s, u, close));
  });

  it('keeps Stimpack for a unit that can spare the hit points', () => {
    const { s, u } = base();
    s.phase = 'movement';
    const stim = buildDeck(def, [], 'movement').find((c) => c.steps.some((x) => x.k === 'ability' && /Stim/i.test(x.name)));
    if (!stim) return;
    const fresh = cardWeight(s, u, stim);
    u.models = 1;
    expect(cardWeight(s, u, stim)).toBeLessThan(fresh);
  });
});

describe('action-deck play at the table', () => {
  it('never pretends to know where the players stand: attacks ask the table instead of running', () => {
    const cfg = makeConfig({ modeId: 'frontlines', aiFaction: 'Zerg', playMode: 'tabletop' });
    cfg.options = { ...cfg.options, actionDecks: true, noMap: true };
    let asked = 0;
    playGame(cfg, {
      seed: 11,
      onOrder: (s, o) => {
        expect(s.sense?.calibrated ?? false).toBe(false);
        expect(o.lines.some((l) => l.startsWith('Camera:'))).toBe(false);
        if (o.type === 'ranged' || o.type === 'charge') {
          expect(o.noTarget ?? false).toBe(false);
          asked++;
        }
      },
    });
    expect(asked).toBeGreaterThan(0);
  });
});

describe('action decks beyond the tabletop edition', () => {
  it('decides the AI from the decks in a simulation and a map game, with orders that read as orders', () => {
    for (const playMode of ['video', 'tabletop'] as const) {
      // No option set: every game plays from the decks unless it opts out.
      const cfg = makeConfig({ modeId: 'frontlines', aiFaction: 'Zerg', playMode });
      let carded = 0;
      const r = playGame(cfg, {
        seed: 7,
        onOrder: (_s, o) => {
          if (!o.card) return;
          carded++;
          // The card decides; it is not shown as a card: no card name as the title, the order's own line first.
          expect(o.title.includes(o.card.name), `${playMode}: ${o.title}`).toBe(false);
          expect(o.lines[0] ?? '').not.toMatch(/\(free for the AI\)/);
        },
      });
      expect(r.state.status, playMode).not.toBe('playing');
      expect(carded, playMode).toBeGreaterThan(0);
    }
  });

  it('can be switched off for a game', () => {
    const cfg = makeConfig({ modeId: 'frontlines', aiFaction: 'Zerg', playMode: 'video' });
    cfg.options = { ...cfg.options, actionDecks: false };
    let carded = 0;
    playGame(cfg, { seed: 7, onOrder: (_s, o) => { if (o.card) carded++; } });
    expect(carded).toBe(0);
  });
});

describe('BURROWED AI units', () => {
  // A Roach on the table in an otherwise ordinary game, with a stand-in order the engine would have issued.
  function roachGame(upgrades: string[] = []) {
    const cfg = makeConfig({ modeId: 'frontlines', aiFaction: 'Zerg', playMode: 'tabletop' });
    cfg.options = { ...cfg.options, actionDecks: true, noMap: true };
    const dep = deploymentById(cfg.deploymentId);
    const s = createGame(cfg, dep, mapLayout(remixId(dep.scale, cfg.terrainSeed), dep));
    const roach = makeInstance(unitById('roach'), 'small', 'Roaches', 1);
    roach.upgrades = upgrades;
    roach.location = 'table';
    s.army.units = [roach];
    return { s, roach };
  }
  const stand = (id: string): AiOrder => ({ type: 'ranged', unitId: id, title: 'x', lines: ['x'], batches: [], reports: [] });

  it('never attacks or charges while Burrowed, whatever its type drew', () => {
    const { s, roach } = roachGame();
    setAiBurrowed(roach, true);
    s.phase = 'assault';
    const rng = Rng.from(3);
    for (let round = 1; round <= 20; round++) {
      s.round = round;
      setAiBurrowed(roach, true);
      const o = cardOrder(s, stand(roach.id), rng);
      expect(['ranged', 'charge'], `round ${round}: ${o.title}`).not.toContain(o.type);
    }
  });

  it('burrows and surfaces with its Burrow card, and a Move brings it up unless it has Tunneling Claws', () => {
    const def = unitById('roach');
    const claws = def.abilities.find((a) => a.name === 'Tunneling Claws')!;
    for (const withClaws of [false, true]) {
      const { s, roach } = roachGame(withClaws && claws.upgradeCost ? [claws.id] : []);
      s.phase = 'movement';
      const rng = Rng.from(5);
      let burrowCards = 0;
      for (let round = 1; round <= 30; round++) {
        s.round = round;
        const before = aiBurrowed(roach);
        const o = cardOrder(s, { ...stand(roach.id), type: 'move' }, rng);
        if (o.card?.steps.some((x) => x.k === 'ability' && x.name === 'Burrow')) {
          burrowCards++;
          expect(aiBurrowed(roach)).toBe(!before);
        } else if (before && o.type === 'move') {
          expect(aiBurrowed(roach), `claws ${withClaws}`).toBe(withClaws);
        }
      }
      expect(burrowCards).toBeGreaterThan(0);
    }
  });
});

describe('shooters shoot', () => {
  it('gives a unit whose gun out-hits its close combat no charge cards', () => {
    for (const id of ['adept', 'roach', 'vile__roach_', 'queen', 'ravager', 'marine', 'stalker']) {
      const def = UNITS.find((u) => u.id === id)!;
      const charges = buildDeck(def, [], 'assault').filter((c) => c.steps.find((s) => s.k !== 'ability')?.k === 'charge');
      expect(charges.map((c) => c.name), id).toEqual([]);
    }
  });

  it('still charges with units that hit harder up close', () => {
    for (const id of ['zealot', 'zergling', 'kerrigan']) {
      const def = UNITS.find((u) => u.id === id)!;
      expect(buildDeck(def, [], 'assault').some((c) => c.steps.some((s) => s.k === 'charge')), id).toBe(true);
    }
  });
});
