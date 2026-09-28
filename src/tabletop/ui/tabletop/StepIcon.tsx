/**
 * The marks on an action card and the tray's small controls, drawn as one set (24 × 24, 2px stroke, round joins)
 * so every one reads the same on any machine: a platform's emoji or a Unicode glyph never stands in for one.
 */
export type StepMark = 'move' | 'run' | 'hold' | 'attack' | 'charge' | 'ability' | 'buff' | 'boost' | 'enter' | 'next' | 'close' | 'replay';

const PATHS: Record<StepMark, string> = {
  move: 'M4 12h14M13 6l6 6-6 6',
  run: 'M5 6l6 6-6 6M12 6l6 6-6 6',
  hold: 'M6 6h12v12H6z',
  attack: 'M12 3v5M12 16v5M3 12h5M16 12h5M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
  charge: 'M13 3L5 13h6l-1 8 8-10h-6z',
  ability: 'M12 3l7 9-7 9-7-9z',
  buff: 'M12 5v14M5 12h14',
  boost: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z',
  enter: 'M12 3v11M7 9l5 5 5-5M4 20h16',
  next: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  replay: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
};

export function StepIcon({ mark, className }: { mark: StepMark; className?: string }) {
  return (
    <svg className={`step-icon ${className ?? ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[mark]} />
    </svg>
  );
}
