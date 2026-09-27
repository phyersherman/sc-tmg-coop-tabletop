import { RulesText } from './RulesText';
import { useState } from 'react';
import type { GameState } from '@engine/types/game';
import type { Command } from '@engine/director/reducer';
import { RESOURCE_NAME, cardBoosts, playerResource, readyCards, cardDef, type UsableBoost } from '@engine/abilities/index';
import { useUi } from '@tt/store/uiStore';
import { Btn } from './Basics';

/** Your Faction and Tactical cards: Ready/Exhausted state, resources, and boosts you can use now. */
export function CardsPanel({ g, dispatch }: { g: GameState; dispatch: (c: Command) => void }) {
  const ui = useUi();
  const active = g.playerUnits.find((p) => p.id === ui.selectedUnitId) ?? null;
  const [open, setOpen] = useState<string | null>(null);
  const cards = g.playerCards ?? [];
  const res = playerResource(g);
  const boosts = cardBoosts(g, active);
  const available = readyCards(g).reduce((a, c) => a + (cardDef(c.defId)?.resource ?? 0), 0);
  if (!cards.length) return <p className="muted small">No cards in this army. Add a Faction card and Tactical cards in setup (Your army).</p>;
  const use = (b: UsableBoost) => {
    const spec = b.spec!;
    const key = `${b.card.id}:${b.boost.name}`;
    if (spec.target === 'point' || spec.target === 'friendly' || spec.target === 'enemy') {
      ui.setPendingAbility({ kind: 'card', cardId: b.card.id, name: b.boost.name, unitId: active?.id, target: spec.target, hint: spec.targetHint });
      setOpen(null);
      return;
    }
    dispatch({ t: 'useBoost', cardId: b.card.id, boost: b.boost.name, unitId: active?.id });
    setOpen(open === key ? null : null);
  };
  return (
    <div className="stack">
      <p className="small"><b>{available}</b> {RESOURCE_NAME[res]} available from Ready cards. {active ? <>Active unit: <b>{active.name}</b>.</> : <span className="muted">Select a unit to use boosts on it.</span>}</p>
      {cards.map((c) => {
        const def = cardDef(c.defId);
        if (!def) return null;
        return (
          <div key={c.id} className={`card-row ${c.exhausted ? 'exhausted' : ''}`}>
            <div className="row between">
              <b>{def.name}</b>
              <span className="small muted">{def.isFactionCard ? 'Faction card' : 'Tactical card'} · {def.resource} {res} · <b>{c.exhausted ? 'Exhausted' : 'Ready'}</b></span>
            </div>
            {boosts.filter((b) => b.card.id === c.id).map((b) => (
              <div key={b.boost.name} className="ability">
                <div className="row between">
                  <div><b>{b.boost.name}</b>{b.spec && !b.spec.automated ? <span className="small muted"> · reminder</span> : null}</div>
                  {b.spec && <Btn size="sm" variant={b.ok ? 'primary' : ''} disabled={!b.ok} title={b.reason} onClick={() => use(b)}>{b.ok ? (b.spec.target === 'point' ? 'Pick spot' : 'Use') : b.reason}</Btn>}
                </div>
                <div className="small muted"><RulesText text={b.boost.text} /></div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
