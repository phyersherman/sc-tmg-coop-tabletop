import type { GameState } from '@engine/types/game';
import { missionOutcome } from '@engine/missions/stakes';
import { useGame } from '@tt/store/gameStore';
import { useUi } from '@tt/store/uiStore';
import { Btn } from '../components/Basics';

/** What fell on each side: models removed by attacks (not only whole units), over the whole battle. */
export function battleTally(g: GameState): { aiModels: number; yourModels: number; aiUnits: number; yourUnits: number } {
  // Earlier rounds are summed when each round ends; this round's attacks are still in the log.
  let aiModels = g.removedBefore?.ai ?? 0;
  let yourModels = g.removedBefore?.players ?? 0;
  for (const a of g.attackLog) {
    if (a.attacker.side === 'players') aiModels += a.removed;
    else yourModels += a.removed;
  }
  return {
    aiModels,
    yourModels,
    aiUnits: g.army.units.filter((u) => u.location === 'destroyed').length,
    yourUnits: g.playerUnits.filter((p) => p.destroyed && !p.summoned).length,
  };
}

/** The same battle again: mission, table, armies and difficulty kept; a fresh seed for the dice and the AI's draws. */
export function useRematch(): (g: GameState) => void {
  const start = useGame((s) => s.start);
  const go = useUi((s) => s.go);
  const setBriefingSeen = useUi((s) => s.setBriefingSeen);
  return (g) => {
    start({ ...g.config, seed: Math.floor(Math.random() * 2 ** 31) });
    setBriefingSeen(false);
    go('game');
  };
}

/** Victory points round by round, you in blue and the AI in red. A single round is just the score. */
export function VpRace({ g, width = 220, height = 60 }: { g: GameState; width?: number; height?: number }) {
  const h = g.vpHistory ?? [];
  if (h.length < 1) return null;
  const last = h[h.length - 1]!;
  const score = <span className="small"><b className="blue">{last.players}</b> : <b className="red">{last.ai}</b> VP after round {last.round}</span>;
  if (h.length < 2) return <div className="vp-race">{score}</div>;
  const W = width;
  const H = height;
  const max = Math.max(4, ...h.map((x) => Math.max(x.players, x.ai)));
  const rounds = Math.max(g.finalRound, h.length);
  const px = (r: number) => 10 + ((r - 1) / Math.max(1, rounds - 1)) * (W - 20);
  const py = (v: number) => H - 8 - (v / max) * (H - 16);
  const line = (key: 'players' | 'ai') => h.map((x, i) => `${i ? 'L' : 'M'}${px(x.round)},${py(x[key])}`).join(' ');
  return (
    <div className="vp-race">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Victory points: you ${last.players}, AI ${last.ai}`}>
        <line x1={10} x2={W - 10} y1={H - 8} y2={H - 8} style={{ stroke: 'var(--line-2)' }} />
        <path d={line('players')} fill="none" strokeWidth={2} style={{ stroke: 'var(--blue-side)' }} />
        <path d={line('ai')} fill="none" strokeWidth={2} style={{ stroke: 'var(--red-side)' }} />
        {h.map((x) => <circle key={`p${x.round}`} cx={px(x.round)} cy={py(x.players)} r={2.5} style={{ fill: 'var(--blue-side)' }} />)}
        {h.map((x) => <circle key={`a${x.round}`} cx={px(x.round)} cy={py(x.ai)} r={2.5} style={{ fill: 'var(--red-side)' }} />)}
      </svg>
      {score}
    </div>
  );
}

/**
 * The end of the battle: who won in the winner's colour, why in one sentence, what fell on
 * each side, and the way to play it again. The debrief holds the rest.
 */
export function EndCard({ g, result }: { g: GameState; result: 'won' | 'lost' | 'draw' }) {
  const go = useUi((s) => s.go);
  const rematch = useRematch();
  const t = battleTally(g);
  return (
    <div className={`banner end-card end-${result}`} role="status">
      <h2 className="end-word">{result === 'won' ? 'Victory' : result === 'lost' ? 'Defeat' : 'Draw'}</h2>
      <p className="end-why">{missionOutcome(g, result)}</p>
      <dl className="end-tally">
        <div><dt>VP</dt><dd><b className="blue">{g.vp.players}</b> : <b className="red">{g.vp.ai}</b></dd></div>
        <div><dt>AI models removed</dt><dd>{t.aiModels}</dd></div>
        <div><dt>Your models lost</dt><dd>{t.yourModels}</dd></div>
        <div><dt>Rounds</dt><dd>{g.round} of {g.finalRound}</dd></div>
      </dl>
      <VpRace g={g} width={420} height={96} />
      <div className="row banner-actions">
        <Btn variant="primary" onClick={() => rematch(g)}>Same setup again</Btn>
        <Btn onClick={() => go('debrief')}>Debrief</Btn>
      </div>
    </div>
  );
}
