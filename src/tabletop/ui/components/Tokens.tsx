import { REWARDS, type RewardKind } from '@engine/missions/sideMarkers';
import { REWARD_TONE, TOKEN_ICONS, type TokenIcon } from '@data/tokenArt';
import { MISSION_STRUCTURES, MISSION_TRAINS } from '@data/missionObjects';

/**
 * Printable tokens for the co-op missions' side markers: one per reward, set beside its marker so the table can
 * see at a glance what taking it is worth, and one for each Structure and for a guard. Drawn as plain SVG so they
 * print crisp at any size and read in black and white.
 */

/** Squeeze a label into the chord of the circle it sits on when it would run past the rim. */
function fit(text: string, size: number, perChar: number, max: number): { textLength?: number; lengthAdjust?: 'spacingAndGlyphs' } {
  return text.length * size * perChar > max ? { textLength: max, lengthAdjust: 'spacingAndGlyphs' } : {};
}

/** One round token: the icon large in the middle, its name above it and what it does below. */
export function Token({ icon, name, line, tone, size = '1.6in' }: { icon: TokenIcon; name: string; line: string; tone: 'gold' | 'blue' | 'violet' | 'red' | 'grey'; size?: string }) {
  return (
    <svg className={`token token-${tone}`} viewBox="0 0 200 200" style={{ width: size, height: size }} role="img" aria-label={`${name}: ${line}`}>
      <circle cx="100" cy="100" r="96" className="token-rim" />
      <circle cx="100" cy="100" r="84" className="token-face" />
      <text x="100" y="62" textAnchor="middle" className="token-name" {...fit(name.toUpperCase(), 21, 0.66, 126)}>{name.toUpperCase()}</text>
      <g transform="translate(68 70) scale(0.64)" className="token-icon" dangerouslySetInnerHTML={{ __html: TOKEN_ICONS[icon] }} />
      <text x="100" y="148" textAnchor="middle" className="token-line" {...fit(line, 16, 0.55, 118)}>{line}</text>
    </svg>
  );
}

export function RewardToken({ kind, size }: { kind: RewardKind; size?: string }) {
  const r = REWARDS[kind];
  return <Token icon={kind} name={r.name} line={r.short} tone={REWARD_TONE[r.scope]} size={size} />;
}

/** Every token, twice (two players, two markers of the same kind), laid out to print on A4 or Letter. */
export function TokenSheet() {
  const rewards = Object.keys(REWARDS) as RewardKind[];
  return (
    <div className="token-sheet">
      {rewards.flatMap((k) => [0, 1].map((i) => <RewardToken key={`${k}${i}`} kind={k} />))}
      {MISSION_STRUCTURES.map((d) => <Token key={d.id} icon="structure" name={d.name} line={`HP ${d.stats.hp}${d.stats.shields ? `+${d.stats.shields}` : ''} · Armour ${d.stats.armour}+`} tone="grey" />)}
      {[0, 1].map((i) => <Token key={`g${i}`} icon="guard" name="Guard" line="Holds this marker" tone="red" />)}
      {[1, 2, 3].map((i) => <Token key={`t${i}`} icon="train" name={`Train ${i}`} line={`HP ${MISSION_TRAINS[0]!.stats.hp} · Armour ${MISSION_TRAINS[0]!.stats.armour}+`} tone="grey" />)}
    </div>
  );
}
