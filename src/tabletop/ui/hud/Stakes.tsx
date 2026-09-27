import type { GameState } from '@engine/types/game';
import { missionStakes } from '@engine/missions/stakes';

/**
 * What the mission needs from you right now, in one line: the thing a StarCraft co-op objective tracker would
 * say. It turns amber when you are falling behind and red when the next Scoring phase can lose the battle.
 */
export function Stakes({ g, className = '' }: { g: GameState; className?: string }) {
  if (g.round === 0 || g.status !== 'playing') return null;
  const s = missionStakes(g);
  return (
    <div className={`stakes tone-${s.tone} ${className}`} role="status" aria-live="polite">
      <span className="stakes-mark" aria-hidden="true" />
      <span>{s.text}</span>
    </div>
  );
}
