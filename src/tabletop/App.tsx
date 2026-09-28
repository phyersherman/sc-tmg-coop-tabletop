import { useEffect, useLayoutEffect, useState } from 'react';
import { useUi, type Screen } from '@tt/store/uiStore';
import { useGame } from '@tt/store/gameStore';
import { HomeScreen } from './ui/screens/HomeScreen';
import { SetupScreen } from './ui/screens/SetupScreen';
import { GameScreen } from './ui/screens/GameScreen';
import { DebriefScreen, RulebookScreen, SettingsScreen, TerrainLabScreen } from './ui/screens/OtherScreens';
import { CollectionScreen } from './ui/screens/CollectionScreen';
import { ArmiesScreen } from './ui/screens/ArmiesScreen';
import { TokensScreen } from './ui/screens/TokensScreen';
import { TutorialScreen } from './ui/screens/TutorialScreen';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { host, usesMap } from './host';

/**
 * The app: one shell and one set of screens before a battle, whether it runs on its own or inside the full
 * Co-op Command. The full app adds its battlefield for a game played with a map, its own screens, and its
 * stylesheet, which is on the page only while one of those is showing.
 */
export default function App() {
  const screen = useUi((s) => s.screen) as string;
  const go = useUi((s) => s.go) as (screen: string) => void;
  const game = useGame((s) => s.game);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sim = host.simulation;
  const mapGame = screen === 'game' && usesMap(game);
  const simScreen = !!sim && (mapGame || screen in sim.screens);
  useEffect(() => {
    // The enemy's race is part of the fog of war: only a battlefield that shows its Units takes its colours.
    document.documentElement.setAttribute('data-faction', game && mapGame && !game.config.options.hideAiRoster ? game.config.aiFaction : 'none');
  }, [game, mapGame]);
  // The host's stylesheet comes and goes with its screens, so its console never restyles the cards.
  useLayoutEffect(() => {
    const id = 'simulation-theme';
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (simScreen && sim) {
      if (!el) { el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
      if (el.textContent !== sim.css) el.textContent = sim.css;
    } else el?.remove();
  }, [simScreen, sim]);
  // A focused number box never changes under the mouse wheel: scrolling the page must not edit a count.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = e.target as HTMLElement | null;
      if (el instanceof HTMLInputElement && el.type === 'number' && document.activeElement === el) el.blur();
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
  const inGame = screen === 'game' && !!game;
  const fullBleed = inGame || screen === 'cutscene';
  const navBtn = (label: string, icon: string, active: boolean, onClick: () => void) => (
    <button key={label} type="button" className={`side-link ${active ? 'active' : ''}`} onClick={onClick}><span className="ico" aria-hidden="true">{icon}</span>{label}</button>
  );
  const Sim = sim?.screens[screen];
  return (
    <div className={`app ${inGame ? 'app-game app-hud' : ''} ${simScreen ? 'app-sim' : ''}`}>
      {sim?.Mount && <sim.Mount />}
      {!fullBleed && <aside className="sidebar no-print">
        <div className="brand" onClick={() => go('home')} role="button">
          Co-op Command<small>SC TMG · unofficial</small>
        </div>
        <nav className="side-nav">
          {navBtn('Home', '⌂', screen === 'home', () => go('home'))}
          {game && navBtn('Game', '⚔', screen === 'game' || screen === 'debrief', () => go(game.status === 'playing' ? 'game' : 'debrief'))}
          {sim?.nav.filter((n) => n.screen === 'campaign').map((n) => navBtn(n.label, n.icon, n.active.includes(screen), () => go(n.screen)))}
          {navBtn('Rulebook', '☰', screen === 'rulebook', () => go('rulebook'))}
          {navBtn('Collection', '▣', screen === 'collection', () => go('collection'))}
          {navBtn('Armies', '⚑', screen === 'armies', () => go('armies'))}
          {navBtn('Terrain', '▲', screen === 'terrain', () => go('terrain'))}
          {navBtn('Tokens', '◎', screen === 'tokens', () => go('tokens'))}
          {sim?.nav.filter((n) => n.screen !== 'campaign').map((n) => navBtn(n.label, n.icon, n.active.includes(screen), () => go(n.screen)))}
          {navBtn('Learn to play', '?', screen === 'tutorial', () => go('tutorial'))}
          {navBtn('Settings', '⚙', settingsOpen, () => setSettingsOpen((v) => !v))}
          {sim?.NavTail && <sim.NavTail />}
        </nav>
      </aside>}
      <main className="content">
        <ErrorBoundary onReset={() => go('home')}>
        {settingsOpen && <SettingsScreen />}
        {screen === 'home' && <HomeScreen />}
        {screen === 'setup' && <SetupScreen />}
        {screen === 'game' && (mapGame && sim ? <sim.GameScreen /> : <GameScreen />)}
        {screen === 'rulebook' && <RulebookScreen />}
        {screen === 'terrain' && <TerrainLabScreen />}
        {screen === 'debrief' && <DebriefScreen />}
        {screen === 'collection' && <CollectionScreen />}
        {screen === 'armies' && <ArmiesScreen />}
        {screen === 'tokens' && <TokensScreen />}
        {screen === 'tutorial' && <TutorialScreen />}
        {Sim && <Sim />}
        </ErrorBoundary>
      </main>
    </div>
  );
}

export type { Screen };
