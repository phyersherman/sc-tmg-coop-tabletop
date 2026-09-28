/**
 * The artwork of the side-marker tokens, as plain SVG text: the printed tokens (tabletop edition) and the ones
 * drawn beside the markers on the simulation's battlefield are the same picture.
 */
import { REWARDS, type RewardKind } from '@engine/missions/sideMarkers';

export type TokenIcon = RewardKind | 'structure' | 'guard' | 'train';
export type TokenTone = 'gold' | 'blue' | 'violet' | 'red' | 'grey';

/** Simple line icons, drawn in a 100 × 100 box. */
export const TOKEN_ICONS: Record<TokenIcon, string> = {
  train: '<g><rect x="16" y="30" width="68" height="34" rx="6" /><circle cx="32" cy="72" r="8" /><circle cx="68" cy="72" r="8" /><rect x="10" y="82" width="80" height="5" /></g>',
  reinforce: '<path d="M42 18h16v24h24v16H58v24H42V58H18V42h24z" />',
  requisition: '<text x="50" y="66" text-anchor="middle" font-size="46" font-weight="800" font-family="system-ui, sans-serif">+2</text>',
  firepower: '<g fill="none" stroke-width="7"><circle cx="50" cy="50" r="24" /><path d="M50 14v20M50 66v20M14 50h20M66 50h20" /></g>',
  stall: '<g><rect x="30" y="22" width="14" height="56" rx="3" /><rect x="56" y="22" width="14" height="56" rx="3" /></g>',
  nest: '<path d="M50 12c6 16 24 24 24 44a24 24 0 0 1-48 0c0-10 6-16 10-20 0 8 4 12 8 12-2-14 2-26 6-36z" />',
  floodlights: '<g><circle cx="50" cy="50" r="15" /><g stroke-width="7" stroke-linecap="round"><path d="M50 14v10M50 76v10M14 50h10M76 50h10M25 25l7 7M68 68l7 7M25 75l7-7M68 32l7-7" /></g></g>',
  cradle: '<path d="M28 16h44v8L54 50l18 26v8H28v-8l18-26-18-26z" />',
  shield: '<path d="M50 12l32 12v22c0 22-14 36-32 42-18-6-32-20-32-42V24z" />',
  recon: '<g><path d="M10 50c10-18 24-28 40-28s30 10 40 28c-10 18-24 28-40 28S20 68 10 50z" fill="none" stroke-width="7" /><circle cx="50" cy="50" r="12" /></g>',
  anchor: '<g fill="none" stroke-width="7" stroke-linecap="round"><circle cx="50" cy="22" r="8" /><path d="M50 30v52M34 44h32M22 58c4 16 16 24 28 24s24-8 28-24" /></g>',
  vent: '<g fill="none" stroke-width="7" stroke-linecap="round"><path d="M30 80c-8-10 8-18 0-28s8-18 0-28M50 80c-8-10 8-18 0-28s8-18 0-28M70 80c-8-10 8-18 0-28s8-18 0-28" /></g>',
  structure: '<path d="M50 14l32 18v36L50 86 18 68V32z" fill="none" stroke-width="7" />',
  guard: '<g fill="none" stroke-width="7" stroke-linejoin="round"><path d="M50 12l32 12v22c0 22-14 36-32 42-18-6-32-20-32-42V24z" /><path d="M50 32v22M50 64v4" stroke-linecap="round" /></g>',
};

export const TONE_COLOUR: Record<TokenTone, string> = { gold: '#b45309', blue: '#1d4ed8', violet: '#6d28d9', red: '#b91c1c', grey: '#334155' };

/** A reward's tone: gold for one of your Units, blue for a player, violet for the mission. */
export const REWARD_TONE = { unit: 'gold', player: 'blue', mission: 'violet' } as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Squeeze a label into the chord of the circle it sits on when it would run past the rim. */
function fit(text: string, size: number, perChar: number, max: number): string {
  return text.length * size * perChar > max ? ` textLength="${max}" lengthAdjust="spacingAndGlyphs"` : '';
}

/** One round token as a standalone SVG: the icon large in the middle, its name above it and what it does below. */
export function tokenSvg(icon: TokenIcon, name: string, line: string, tone: TokenTone): string {
  const c = TONE_COLOUR[tone];
  const title = name.toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">`
    + `<circle cx="100" cy="100" r="96" fill="${c}"/><circle cx="100" cy="100" r="84" fill="#fff"/>`
    + `<text x="100" y="62" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="800" font-size="21" letter-spacing="0.84" fill="#0f172a"${fit(title, 21, 0.66, 126)}>${esc(title)}</text>`
    + `<g transform="translate(68 70) scale(0.64)" fill="${c}" stroke="${c}" color="${c}">${TOKEN_ICONS[icon]}</g>`
    + `<text x="100" y="148" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="600" font-size="16" fill="#0f172a"${fit(line, 16, 0.55, 118)}>${esc(line)}</text>`
    + `</svg>`;
}

/** A side marker's reward token as a standalone SVG. */
export const rewardTokenSvg = (kind: RewardKind): string => tokenSvg(kind, REWARDS[kind].name, REWARDS[kind].short, REWARD_TONE[REWARDS[kind].scope]);
