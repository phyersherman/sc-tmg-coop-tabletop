import { describe, expect, it } from 'vitest';
import { CARDS, UNITS } from '@data/index';
import { buildDeck, drawFor, faceCard, reshuffleDecks, type ActionCard } from '@engine/ai/actionDecks';
import { COOP_MODES } from '@engine/missions/coop';
import { makeConfig, playGame } from './helpers';

const fielded = UNITS.filter((u) => !u.summoned);
const allUpgrades = (id: string) => {
  const u = UNITS.find((x) => x.id === id)!;
  return [...u.weapons, ...u.abilities].filter((x) => x.upgradeCost).map((x) => x.id);
};

describe('action decks', () => {
  it('gives every unit type a Movement and an Assault deck with a reshuffle card', () => {
    for (const u of fielded) {
      for (const phase of ['movement', 'assault'] as const) {
        const deck = buildDeck(u, allUpgrades(u.id), phase);
        expect(deck.length, `${u.id} ${phase}`).toBeGreaterThanOrEqual(3);
        expect(deck.filter((c) => c.shuffle).length, `${u.id} ${phase}`).toBe(1);
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

  it('prints the Faction card boosts on the reshuffle cards', () => {
    const zealot = UNITS.find((u) => u.id === 'zealot')!;
    const faction = CARDS.find((c) => c.id === 'daelaam')!;
    const move = buildDeck(zealot, [], 'movement', faction).find((c) => c.shuffle)!;
    const assault = buildDeck(zealot, [], 'assault', faction).find((c) => c.shuffle)!;
    expect(move.boost?.name).toBe(faction.boosts[0]!.name);
    expect(assault.boost?.name).toBe(faction.boosts[1]!.name);
  });

  it('plays co-op missions at the table from the decks, one card per unit type and phase', () => {
    const plays = [[COOP_MODES[0]!, 'Zerg'], [COOP_MODES[2]!, 'Terran'], [COOP_MODES[4]!, 'Protoss']] as const;
    for (const [mode, faction] of plays) {
      {
        const cfg = makeConfig({ modeId: mode.id, aiFaction: faction, playMode: 'tabletop' });
        cfg.options = { ...cfg.options, actionDecks: true };
        const seen = new Map<string, string>();
        let carded = 0;
        const r = playGame(cfg, {
          seed: 5,
          onOrder: (s, o) => {
            if (!o.card) return;
            carded++;
            const u = s.army.units.find((x) => x.id === o.unitId)!;
            const key = `${s.round}:${s.phase}:${u.defId}`;
            // Every unit of a type follows the card its type drew this phase.
            if (seen.has(key)) expect(o.card.id).toBe(seen.get(key));
            seen.set(key, o.card.id);
            expect(faceCard(s, u.defId)?.id).toBe(o.card.id);
          },
        });
        expect(r.state.status, `${mode.id} ${faction}`).not.toBe('playing');
        expect(carded, `${mode.id} ${faction}`).toBeGreaterThan(0);
      }
    }
  });

  it('shuffles a deck back together after its reshuffle card', () => {
    const cfg = makeConfig({ modeId: 'frontlines', aiFaction: 'Zerg', playMode: 'tabletop' });
    cfg.options = { ...cfg.options, actionDecks: true };
    const r = playGame(cfg, { seed: 9 });
    for (const d of Object.values(r.state.aiDecks ?? {})) {
      expect(d.draw.length + d.discard.length + (d.face ? 1 : 0)).toBe(d.cards.length);
    }
    expect(typeof drawFor).toBe('function');
    expect(typeof reshuffleDecks).toBe('function');
  });
});

describe('action-deck play at the table', () => {
  it('never pretends to know where the players stand: attacks ask the table instead of running', () => {
    const cfg = makeConfig({ modeId: 'frontlines', aiFaction: 'Zerg', playMode: 'tabletop' });
    cfg.options = { ...cfg.options, actionDecks: true };
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
