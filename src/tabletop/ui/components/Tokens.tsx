import type { ReactNode } from 'react';
import { REWARDS, type RewardKind } from '@engine/missions/sideMarkers';
import { MISSION_STRUCTURES } from '@data/missionObjects';

/**
 * Printable tokens for the co-op missions' side markers: one per reward, set beside its marker so the table can
 * see at a glance what taking it is worth, and one for each Structure and for a guard. Drawn as plain SVG so they
 * print crisp at any size and read in black and white.
 */

/** Simple line icons, drawn in a 100 × 100 box. */
const ICONS: Record<RewardKind | 'structure' | 'guard', ReactNode> = {
  reinforce: <path d="M42 18h16v24h24v16H58v24H42V58H18V42h24z" />,
  requisition: <text x="50" y="66" textAnchor="middle" fontSize="46" fontWeight="800" fontFamily="system-ui, sans-serif">+2</text>,
  firepower: <g fill="none" strokeWidth="7"><circle cx="50" cy="50" r="24" /><path d="M50 14v20M50 66v20M14 50h20M66 50h20" /></g>,
  stall: <g><rect x="30" y="22" width="14" height="56" rx="3" /><rect x="56" y="22" width="14" height="56" rx="3" /></g>,
  nest: <path d="M50 12c6 16 24 24 24 44a24 24 0 0 1-48 0c0-10 6-16 10-20 0 8 4 12 8 12-2-14 2-26 6-36z" />,
  floodlights: <g><circle cx="50" cy="50" r="15" /><g strokeWidth="7" strokeLinecap="round"><path d="M50 14v10M50 76v10M14 50h10M76 50h10M25 25l7 7M68 68l7 7M25 75l7-7M68 32l7-7" /></g></g>,
  cradle: <path d="M28 16h44v8L54 50l18 26v8H28v-8l18-26-18-26z" />,
  shield: <path d="M50 12l32 12v22c0 22-14 36-32 42-18-6-32-20-32-42V24z" />,
  recon: <g><path d="M10 50c10-18 24-28 40-28s30 10 40 28c-10 18-24 28-40 28S20 68 10 50z" fill="none" strokeWidth="7" /><circle cx="50" cy="50" r="12" /></g>,
  anchor: <g fill="none" strokeWidth="7" strokeLinecap="round"><circle cx="50" cy="22" r="8" /><path d="M50 30v52M34 44h32M22 58c4 16 16 24 28 24s24-8 28-24" /></g>,
  vent: <g fill="none" strokeWidth="7" strokeLinecap="round"><path d="M30 80c-8-10 8-18 0-28s8-18 0-28M50 80c-8-10 8-18 0-28s8-18 0-28M70 80c-8-10 8-18 0-28s8-18 0-28" /></g>,
  structure: <path d="M50 14l32 18v36L50 86 18 68V32z" fill="none" strokeWidth="7" />,
  guard: <g fill="none" strokeWidth="7" strokeLinejoin="round"><path d="M50 12l32 12v22c0 22-14 36-32 42-18-6-32-20-32-42V24z" /><path d="M50 32v22M50 64v4" strokeLinecap="round" /></g>,
};

const TONE = { unit: 'gold', player: 'blue', mission: 'violet' } as const;

/** Squeeze a label into the chord of the circle it sits on when it would run past the rim. */
function fit(text: string, size: number, perChar: number, max: number): { textLength?: number; lengthAdjust?: 'spacingAndGlyphs' } {
  return text.length * size * perChar > max ? { textLength: max, lengthAdjust: 'spacingAndGlyphs' } : {};
}

/** One round token: the icon large in the middle, its name above it and what it does below. */
export function Token({ icon, name, line, tone, size = '1.6in' }: { icon: keyof typeof ICONS; name: string; line: string; tone: 'gold' | 'blue' | 'violet' | 'red' | 'grey'; size?: string }) {
  return (
    <svg className={`token token-${tone}`} viewBox="0 0 200 200" style={{ width: size, height: size }} role="img" aria-label={`${name}: ${line}`}>
      <circle cx="100" cy="100" r="96" className="token-rim" />
      <circle cx="100" cy="100" r="84" className="token-face" />
      <text x="100" y="62" textAnchor="middle" className="token-name" {...fit(name.toUpperCase(), 21, 0.66, 126)}>{name.toUpperCase()}</text>
      <g transform="translate(68 70) scale(0.64)" className="token-icon">{ICONS[icon]}</g>
      <text x="100" y="148" textAnchor="middle" className="token-line" {...fit(line, 16, 0.55, 118)}>{line}</text>
    </svg>
  );
}

export function RewardToken({ kind, size }: { kind: RewardKind; size?: string }) {
  const r = REWARDS[kind];
  return <Token icon={kind} name={r.name} line={r.short} tone={TONE[r.scope]} size={size} />;
}

/** Every token, twice (two players, two markers of the same kind), laid out to print on A4 or Letter. */
export function TokenSheet() {
  const rewards = Object.keys(REWARDS) as RewardKind[];
  return (
    <div className="token-sheet">
      {rewards.flatMap((k) => [0, 1].map((i) => <RewardToken key={`${k}${i}`} kind={k} />))}
      {MISSION_STRUCTURES.map((d) => <Token key={d.id} icon="structure" name={d.name} line={`HP ${d.stats.hp}${d.stats.shields ? `+${d.stats.shields}` : ''} · Armour ${d.stats.armour}+`} tone="grey" />)}
      {[0, 1].map((i) => <Token key={`g${i}`} icon="guard" name="Guard" line="Holds this marker" tone="red" />)}
    </div>
  );
}
