import type { GameState } from '@engine/types/game';
import type { AiUnitInstance } from '@engine/types/army';
import { unitById } from '@data/index';
import { REMINDERS, remindersFor, usedOnce, type ActionCard, type CardStep, type Focus, type MoveTo } from '@engine/ai/actionDecks';
import { headingText, speedModFor } from '@engine/ai/decide';
import { bestWeapon } from '@engine/units/weapons';
import { speedFor } from '@engine/units/speed';
import { StepIcon } from './StepIcon';

const FOCUS: Record<Focus, string> = {
  nearest: 'the nearest enemy',
  weakest: 'the weakest enemy in range',
  highestSupply: 'the biggest enemy in range',
  onMarker: 'an enemy on its marker',
  lastAttacker: 'whoever hit it last',
  nearestToMarker: 'the enemy nearest a marker',
};

function whereTo(g: GameState, u: AiUnitInstance | undefined, to: MoveTo): string {
  switch (to) {
    case 'focus': return 'the nearest enemy';
    case 'friend': return 'the nearest friendly Unit';
    case 'cover': return 'the nearest cover';
    case 'marker': return 'the nearest marker it does not hold';
    case 'objective': return u ? headingText(g, u.objective) : 'its objective';
  }
}


/** One line of a card, in the words a player reads it out at the table. */
export function stepText(g: GameState, card: ActionCard, s: CardStep, u?: AiUnitInstance): { title: string; detail?: string } {
  const def = unitById(card.defId);
  const speed = u ? speedFor(def, u.models) + speedModFor(g, { ...u, cardMods: undefined }) : def.stats.speed?.[0] ?? 0;
  const inches = (mod: number) => `${Math.max(0, speed + mod)}"`;
  switch (s.k) {
    case 'move': return { title: `Move ${inches(s.mod)} toward ${whereTo(g, u, s.to)}` };
    case 'run': return { title: `Run ${inches(s.mod)} toward ${whereTo(g, u, s.to)}` };
    case 'hold': return { title: 'Hold position' };
    case 'attack': {
      const w = bestWeapon(def, u?.upgrades ?? [], 'Assault');
      const extra = [s.hit ? `+${s.hit} to hit` : '', s.roa ? `+${s.roa} RoA` : ''].filter(Boolean).join(', ');
      return { title: `Fire${w ? ` ${w.name}` : ''} at ${FOCUS[s.focus ?? 'nearest']}${extra ? ` (${extra})` : ''}`, detail: `Nothing in range: ${s.otherwise === 'run' ? 'run toward its objective' : 'hold'}.` };
    }
    case 'charge': {
      const extra = [s.twoDice ? 'roll 2D6, keep the higher' : '', s.bonus ? `+${s.bonus}"` : ''].filter(Boolean).join(', ');
      return { title: `Charge ${FOCUS[s.focus ?? 'nearest']}${extra ? ` (${extra})` : ''}`, detail: `${s.orFire ? 'Out of reach: fire instead. ' : ''}Nothing to charge: ${s.otherwise === 'run' ? 'run toward its objective' : 'hold'}.` };
    }
    case 'ability': return { title: s.name, detail: `${s.text}${s.use ? ` AI: ${s.use}` : ''}` };
  }
}

/**
 * An AI action card, as it lies on the table: its name, what the unit does, top to bottom, and the buffs and boost
 * it brings. `full` adds the ability texts and the rule reminders for resolving it.
 */
export function ActionCardView({ g, card, unit, full = false, entry }: { g: GameState; card: ActionCard; unit?: AiUnitInstance; full?: boolean; /** Arriving from Reserves: where it comes on, before the card's move. */ entry?: string }) {
  return (
    <div className={`ac ${full ? 'ac-full' : 'ac-mini'} ac-${card.phase}`} role="group" aria-label={`Action card: ${card.name}`}>
      <div className="ac-head">
        <span className="ac-phase">{card.phase === 'movement' ? 'Movement' : 'Assault'}</span>
        <b className="ac-name">{card.name}</b>
      </div>
      <ol className="ac-steps">
        {entry && (
          <li className="ac-step ac-enter">
            <span className="ac-icon"><StepIcon mark="enter" /></span>
            <span><b>Arrives from Reserves</b><span className="ac-detail">{entry}</span></span>
          </li>
        )}
        {card.steps.map((raw, i) => {
          // A unit arriving from Reserves always moves on (cardOrders): a Hold, or a move into cover, takes it
          // toward its objective instead.
          const s: CardStep = entry && (raw.k === 'hold' || ((raw.k === 'move' || raw.k === 'run') && raw.to === 'cover')) ? { k: 'move', mod: raw.k === 'hold' ? 0 : raw.mod, to: 'objective' } : raw;
          const t = stepText(g, card, s, unit);
          const once = s.k === 'ability' && /Once per Game/i.test(s.text) && usedOnce(g, card.defId, s.name);
          return (
            <li key={i} className={`ac-step ac-${s.k} ${once ? 'used' : ''}`}>
              <span className="ac-icon"><StepIcon mark={s.k} /></span>
              <span><b>{t.title}</b>{full && t.detail && <span className="ac-detail">{t.detail}</span>}</span>
            </li>
          );
        })}
      </ol>
      {card.buffs.length > 0 && (
        <div className="ac-buffs">
          {card.buffs.map((b) => <p key={b.name}><b><StepIcon mark="buff" className="inline" />{b.name}</b>{full ? `: ${b.text}` : ''}</p>)}
        </div>
      )}
      {card.boost && <p className="ac-boost"><b><StepIcon mark="boost" className="inline" />{card.boost.name}</b>{full ? `: ${card.boost.text}` : ''}{full && card.boost.use && <span className="ac-use">AI uses it on {card.boost.use}</span>}</p>}
      {full && (
        <ul className="ac-reminders">
          {remindersFor(card).map((k) => <li key={k}>{REMINDERS[k]}</li>)}
        </ul>
      )}
    </div>
  );
}
