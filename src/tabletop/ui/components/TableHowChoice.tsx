import type { TableHow } from '@tt/host';

const HOW: { id: TableHow; name: string; blurb: string }[] = [
  { id: 'aiOnly', name: 'Tabletop, AI only', blurb: 'No map. The enemy plays from action cards read off the screen.' },
  { id: 'map', name: 'Tabletop, map', blurb: 'Copy your Units onto the map where they stand. The AI reacts to their exact positions.' },
  { id: 'camera', name: 'Tabletop, camera', blurb: 'An overhead camera reads a tag on each Unit. The AI sees the whole table.' },
  { id: 'simulation', name: 'Simulation', blurb: 'The whole battle is played on screen. No table needed.' },
];

/** How the app follows the table, picked before a battle starts: it cannot change once it has begun. */
export function TableHowChoice({ value, onChange }: { value: TableHow; onChange: (h: TableHow) => void }) {
  return (
    <div className="play-mode-choice table-how" role="radiogroup" aria-label="How you play">
      {HOW.map((h) => (
        <button key={h.id} type="button" role="radio" aria-checked={value === h.id} className={value === h.id ? 'active' : ''} onClick={() => onChange(h.id)}>
          <b>{h.name}</b>
          <span className="small muted">{h.blurb}</span>
        </button>
      ))}
    </div>
  );
}
