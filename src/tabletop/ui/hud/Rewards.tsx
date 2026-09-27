import { useState } from 'react';
import type { GameState } from '@engine/types/game';
import type { Command } from '@engine/director/reducer';
import { REWARDS, rewardsReady, rewardTargets, type Reward } from '@engine/missions/sideMarkers';

/**
 * Side-marker rewards you can use this round, each with its one choice: which unit (Reinforce, Firepower) or
 * which player (a Requisition the holders were level on). Unused by the end of the round, a reward is gone, so
 * the card says so. Mission counters apply on their own and never wait here.
 */
export function Rewards({ g, dispatch, className = '' }: { g: GameState; dispatch: (c: Command) => void; className?: string }) {
  if (g.round === 0 || g.status !== 'playing') return null;
  const ready = rewardsReady(g).filter((r) => REWARDS[r.kind].scope !== 'mission');
  if (!ready.length) return null;
  return (
    <section className={`rewards ${className}`} aria-label="Rewards to use this round">
      {ready.map((r) => <RewardRow key={r.id} g={g} r={r} dispatch={dispatch} />)}
    </section>
  );
}

function RewardRow({ g, r, dispatch }: { g: GameState; r: Reward; dispatch: (c: Command) => void }) {
  const info = REWARDS[r.kind];
  const players = g.config.players ?? 1;
  const who = players < 2 ? '' : r.owner === null ? ' · you choose who' : ` · Player ${r.owner + 1}`;
  const targets = rewardTargets(g, r);
  const [pick, setPick] = useState('');
  const chosen = targets.some((t) => t.id === pick) ? pick : targets[0]?.id ?? '';
  return (
    <div className="reward">
      <div className="reward-head">
        <b>{info.name}</b>
        <span className="small muted">Marker {r.marker}{who}. Use it this round or lose it.</span>
      </div>
      <p className="small">{info.text[0]!.toUpperCase() + info.text.slice(1)}.</p>
      {info.scope === 'unit' && (targets.length ? (
        <div className="reward-use">
          <select value={chosen} onChange={(e) => setPick(e.target.value)} aria-label={`Unit for ${info.name}`}>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.name}{players > 1 ? ` (P${(t.owner ?? 0) + 1})` : ''}</option>)}
          </select>
          <button type="button" className="btn btn-sm primary" disabled={!chosen} onClick={() => dispatch({ t: 'useReward', rewardId: r.id, unitId: chosen })}>Use</button>
        </div>
      ) : (
        <p className="small muted">{r.kind === 'reinforce' ? 'No destroyed unit to bring back yet.' : 'None of your units in the battle has a ranged weapon.'}</p>
      ))}
      {info.scope === 'player' && (
        <div className="reward-use">
          {Array.from({ length: players }, (_, i) => (
            <button key={i} type="button" className="btn btn-sm primary" onClick={() => dispatch({ t: 'useReward', rewardId: r.id, owner: i })}>{players > 1 ? `Player ${i + 1}` : 'Take it'}</button>
          ))}
        </div>
      )}
    </div>
  );
}
