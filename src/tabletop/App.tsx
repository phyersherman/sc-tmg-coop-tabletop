import { useEffect } from 'react';
import { useUi } from '@tt/store/uiStore';
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
import { host } from './host';
import { useState } from 'react';

export default function App() {
  const screen = useUi((s) => s.screen);
  const go = useUi((s) => s.go);
  const game = useGame((s) => s.game);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    // The enemy's race is part of the fog of war: the game screen never takes its colours.
    document.documentElement.setAttribute('data-faction', 'none');
  }, [game, screen]);
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
  const navBtn = (label: string, icon: string, active: boolean, onClick: () => void) => (
    <button type="button" className={`side-link ${active ? 'active' : ''}`} onClick={onClick}><span className="ico" aria-hidden="true">{icon}</span>{label}</button>
  );
  return (
    <div className={`app ${inGame ? 'app-game app-hud' : ''}`}>
      {!inGame && <aside className="sidebar no-print">
        <div className="brand" onClick={() => go('home')} role="button">
          Co-op Command<small>SC TMG · unofficial</small>
        </div>
        <nav className="side-nav">
          {navBtn('Home', '⌂', screen === 'home', () => go('home'))}
          {game && navBtn('Game', '⚔', screen === 'game' || screen === 'debrief', () => go(game.status === 'playing' ? 'game' : 'debrief'))}
          {navBtn('Rulebook', '☰', screen === 'rulebook', () => go('rulebook'))}
          {navBtn('Collection', '▣', screen === 'collection', () => go('collection'))}
          {navBtn('Armies', '⚑', screen === 'armies', () => go('armies'))}
          {navBtn('Terrain', '▲', screen === 'terrain', () => go('terrain'))}
          {navBtn('Tokens', '◎', screen === 'tokens', () => go('tokens'))}
          {navBtn('Learn to play', '?', screen === 'tutorial', () => go('tutorial'))}
          {navBtn('Settings', '⚙', settingsOpen, () => setSettingsOpen((v) => !v))}
          {host.toFullApp && navBtn('Simulation version', '⇄', false, host.toFullApp)}
        </nav>
      </aside>}
      <main className="content">
        <ErrorBoundary onReset={() => go('home')}>
        {settingsOpen && <SettingsScreen />}
        {screen === 'home' && <HomeScreen />}
        {screen === 'setup' && <SetupScreen />}
        {screen === 'game' && <GameScreen />}
        {screen === 'rulebook' && <RulebookScreen />}
        {screen === 'terrain' && <TerrainLabScreen />}
        {screen === 'debrief' && <DebriefScreen />}
        {screen === 'collection' && <CollectionScreen />}
        {screen === 'armies' && <ArmiesScreen />}
        {screen === 'tokens' && <TokensScreen />}
        {screen === 'tutorial' && <TutorialScreen />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
