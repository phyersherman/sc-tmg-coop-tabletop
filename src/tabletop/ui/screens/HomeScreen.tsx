import { useGame } from '@tt/store/gameStore';
import { useUi } from '@tt/store/uiStore';
import { Btn } from '../components/Basics';
import { modeById } from '@engine/missions/index';
import { DIFFICULTIES } from '@engine/difficulty';

/** What to do before a battle, in the order a game night needs it. */
const PREP: { screen: 'collection' | 'armies' | 'terrain' | 'rulebook' | 'tokens' | 'tutorial'; name: string; what: string }[] = [
  { screen: 'tutorial', name: 'Learn to play', what: 'How a battle runs, from setup to the last Scoring phase.' },
  { screen: 'collection', name: 'Collection', what: 'The miniatures you own. The enemy is built from these.' },
  { screen: 'armies', name: 'Armies', what: 'Your forces, saved for game night, with a sheet to print.' },
  { screen: 'terrain', name: 'Terrain Lab', what: 'A fair terrain layout for any deployment card.' },
  { screen: 'tokens', name: 'Side-marker tokens', what: 'Tokens to print for the guards, Structures and rewards on side markers.' },
  { screen: 'rulebook', name: 'AI Rulebook', what: 'How the enemy moves, picks its targets and fights.' },
];

/**
 * The command deck: the battle you are in the middle of, or the next one to set up, at the top; what to
 * prepare before a game night beneath it. One decision at a time, like the table.
 */
export function HomeScreen() {
  const game = useGame((s) => s.game);
  const savedAt = useGame((s) => s.savedAt);
  const abandon = useGame((s) => s.abandon);
  const go = useUi((s) => s.go);
  const playing = game?.status === 'playing';
  return (
    <div className="home">
      <section className="home-deck">
        <div className="home-deck-art" aria-hidden="true" />
        <div className="home-deck-body">
          <h1 className="hero-title home-title">Co-op Command</h1>
          <p className="home-lede">A fan-developed companion app for StarCraft TMG. New missions inspired by SC2 co-op, for you alone or you and a friend, against enemy forces the app pilots without needing to know where the Units stand.</p>
          {game && (
            <div className="home-saved">
              <div className="home-saved-facts">
                <span className={`tag ${playing ? 'accent' : ''}`}>{playing ? 'In progress' : game.status}</span>
                <b>{modeById(game.config.modeId).name}</b>
                <span>{DIFFICULTIES[game.config.difficulty].name} · round {game.round} of {game.finalRound}</span>
                {savedAt && <span className="small muted">Saved {new Date(savedAt).toLocaleString()}</span>}
              </div>
              <div className="row">
                <Btn variant="primary" size="lg" onClick={() => go(playing ? 'game' : 'debrief')}>{playing ? 'Resume the battle' : 'Debrief'}</Btn>
                <Btn variant="danger" onClick={() => { if (confirm('Abandon the saved game?')) abandon(); }}>Abandon</Btn>
              </div>
            </div>
          )}
          <div className="row home-actions">
            <Btn variant={game ? '' : 'primary'} size="lg" onClick={() => go('setup')}>Set up a battle</Btn>
            <Btn variant="ghost" size="lg" onClick={() => go('tutorial')}>Learn to play</Btn>
          </div>
          <p className="home-note small muted">A battle is one mission against an enemy built from your own collection. Play a co-op mission or one of the official mission cards, alone or with a friend.</p>
        </div>
      </section>

      <section className="home-prep">
        <h2>Before the battle</h2>
        <ul className="home-list">
          {PREP.map((p) => (
            <li key={p.screen}>
              <button type="button" onClick={() => go(p.screen)}>
                <b>{p.name}</b>
                <span>{p.what}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p className="small muted home-legal">Unofficial fan project, not affiliated with or endorsed by Blizzard Entertainment or Archon Studio. StarCraft is a trademark of Blizzard Entertainment; StarCraft: Tabletop Miniatures Game is by Archon Studio. Cards and rules: starcraft-tmg.com/downloads.</p>
    </div>
  );
}
