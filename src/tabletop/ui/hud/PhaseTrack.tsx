import { useEffect, useRef, useState } from 'react';
import type { GameState, Phase } from '@engine/types/game';
import { currentCard } from '@engine/ai/orderDeck';
import { availableNow, poolNow } from '@engine/director/selectors';

const PHASES: { id: Phase; name: string; what: string }[] = [
  { id: 'movement', name: 'Movement', what: 'Deploy, move or hold each Unit.' },
  { id: 'assault', name: 'Assault', what: 'Shoot, charge or run.' },
  { id: 'combat', name: 'Combat', what: 'Engaged Units fight.' },
  { id: 'scoring', name: 'Scoring', what: 'Markers and destroyed Supply score.' },
];

/** What matters as a phase opens, in a line: who goes first, and on a new round the AI's order and pool. */
export function phaseNote(g: GameState): string {
  const p = PHASES.find((x) => x.id === g.phase) ?? PHASES[0]!;
  const first = g.firstPlayer === 'ai' ? 'AI first' : 'You first';
  if (p.id === 'movement') {
    const pool = poolNow(g), avail = availableNow(g);
    const card = currentCard(g.orderDeck);
    return `Round ${g.round} of ${g.finalRound} · ${first} · AI order: ${card.name}${pool === Infinity ? '' : ` · AI can deploy ${avail} of ${pool} Supply`}`;
  }
  if (p.id === 'scoring') return `${p.name} · ${p.what}`;
  return `${p.name} · ${first} · ${p.what}`;
}

/**
 * Where the round stands: four phase pips with a highlight that slides along as play moves on. When a phase
 * opens, a short note drops under it (who is first, and on a new round the AI's order) and fades on its own.
 */
export function PhaseTrack({ g, docked = false, announce = true }: { g: GameState; docked?: boolean; /** Drop the note under the track as a phase opens (when the announcements are skipped). */ announce?: boolean }) {
  const idx = Math.max(0, PHASES.findIndex((x) => x.id === g.phase));
  const key = `${g.round}:${g.phase}`;
  const [note, setNote] = useState<{ key: string; text: string } | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (g.round === 0) return;
    // Not on first showing (a resumed game): only when play moves on.
    if (first.current) { first.current = false; return; }
    if (!announce) return;
    setNote({ key, text: phaseNote(g) });
    const t = setTimeout(() => setNote(null), 3600);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`phase-track ${docked ? 'docked' : ''}`} title={phaseNote(g)}>
      <span className="phase-round">R{g.round}<small>/{g.finalRound}</small></span>
      <div className="phase-pips" style={{ ['--i' as string]: idx }}>
        <span className="phase-glide" aria-hidden />
        {PHASES.map((p, i) => <span key={p.id} className={`phase-pip ${i === idx ? 'on' : i < idx ? 'past' : ''}`}>{p.name}</span>)}
      </div>
      {note && <div key={note.key} className="phase-note">{note.text}</div>}
    </div>
  );
}
