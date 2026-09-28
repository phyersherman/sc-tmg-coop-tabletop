import { useMemo, useState } from 'react';
import { DEPLOYMENTS, unitById } from '@data/index';
import { RULEBOOK } from '@tt/data/rulebook';
import { mapLayout, remixId } from '@engine/terrain/remix';
import { mapsFor } from '@data/terrainMaps';
import { modeById } from '@engine/missions/index';
import { DIFFICULTIES } from '@engine/difficulty';
import { useGame } from '@tt/store/gameStore';
import { useSettings } from '@tt/store/settingsStore';
import { TerrainInventory } from '../components/TerrainInventory';
import { VpRace, battleTally, useRematch } from './battleEnd';
import { missionOutcome } from '@engine/missions/stakes';
import { useUi } from '@tt/store/uiStore';
import { Btn, Panel, Toggle } from '../components/Basics';
import { TableMap, TerrainLegend } from '../components/TableMap';

/** Rulebook text: **game terms** in bold. */
function Prose({ text }: { text: string }) {
  return <>{text.split(/\*\*(.+?)\*\*/g).map((t, i) => (i % 2 ? <b key={i}>{t}</b> : t))}</>;
}

export function RulebookScreen() {
  return (
    <div className="rulebook">
      <h1>AI Rulebook</h1>
      <p className="muted">How the AI moves, chooses its targets and fights on your table.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        {RULEBOOK.map((s) => <a key={s.id} href={`#${s.id}`} className="tag">{s.title}</a>)}
      </div>
      {RULEBOOK.map((s) => (
        <section key={s.id} id={s.id}>
          <h2>{s.title}</h2>
          {s.summary && <p className="rule-summary"><i>{s.summary}</i></p>}
          {s.paragraphs.map((p, i) => <p key={i}><Prose text={p} /></p>)}
          {s.bullets && <ul>{s.bullets.map((b, i) => <li key={i}><Prose text={b} /></li>)}</ul>}
          {s.note && <aside className="rule-note"><b>{s.note.label}:</b> <Prose text={s.note.text} /></aside>}
        </section>
      ))}
    </div>
  );
}

export function TerrainLabScreen() {
  const [deploymentId, setDeploymentId] = useState(DEPLOYMENTS[0]!.id);
  const [seed, setSeed] = useState(42);
  // A rulebook map, or 'remix' for one built the way they are.
  const [mapId, setMapId] = useState('remix');
  // The table as the setup step shows it: each piece drawn with the rulebook's own picture.
  const [pictures, setPictures] = useState(false);
  const deployment = DEPLOYMENTS.find((d) => d.id === deploymentId)!;
  const scale = deployment.scale === 'grand' ? 'standard' : deployment.scale;
  const maps = mapsFor(deployment.scale);
  const id = mapId === 'remix' || !maps.some((m) => m.id === mapId) ? remixId(scale, seed) : mapId;
  const terrain = useMemo(() => mapLayout(id, deployment), [id, deployment]);
  return (
    <div className="grid grid-2 terrain-lab">
      <Panel title="Terrain Lab">
        <div className="col">
          <select value={deploymentId} onChange={(e) => setDeploymentId(e.target.value)}>
            {DEPLOYMENTS.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.scale}, {d.table.width}×{d.table.height}")</option>)}
          </select>
          <select value={mapId} onChange={(e) => setMapId(e.target.value)}>
            <option value="remix">Remixed from the rulebook maps</option>
            {maps.map((m) => <option key={m.id} value={m.id}>{m.name} (page {m.page})</option>)}
          </select>
          {mapId === 'remix' && <div className="row"><label>Seed</label><input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} /><Btn onClick={() => setSeed(Math.floor(Math.random() * 100000))}>Reroll</Btn></div>}
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>{terrain.name}{terrain.page ? `, core rulebook page ${terrain.page}` : ''}. Numbers on the map match the list.</p>
        <TerrainLegend terrain={terrain} />
      </Panel>
      <Panel title={deployment.name}>
        <Toggle on={pictures} onChange={setPictures}>Rulebook pictures, as in table setup</Toggle>
        <TableMap deployment={deployment} terrain={terrain} refArt={pictures} />
      </Panel>
      <Panel title="Your terrain collection" className="span-all"><TerrainInventory /></Panel>
    </div>
  );
}

export function SettingsScreen() {
  const s = useSettings();
  const exportSave = useGame((g) => g.exportSave);
  const importSave = useGame((g) => g.importSave);
  const game = useGame((g) => g.game);
  return (
    <Panel title="Settings">
      <div className="col">
        <Toggle on={s.appRollsAiDice} onChange={(v) => s.set({ appRollsAiDice: v })}>App rolls the AI's dice</Toggle>
        <p className="small muted">Off: orders only show dice counts and target numbers so you can roll physical dice.</p>
        <Toggle on={s.confirmPass !== false} onChange={(v) => s.set({ confirmPass: v })}>Remind me before passing while units can still act</Toggle>
        <Toggle on={!s.skipPhaseBanners} onChange={(v) => s.set({ skipPhaseBanners: !v })}>Announce each round and phase (off: the phase track at the top shows the change)</Toggle>
        <div className="row">
          <Btn disabled={!game} onClick={() => { const blob = new Blob([exportSave()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sctmg-coop-save.json'; a.click(); }}>Export save</Btn>
          <label className="btn" style={{ cursor: 'pointer' }}>
            Import save
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; f.text().then((t) => { if (!importSave(t)) alert('That file is not a valid save.'); }); }} />
          </label>
        </div>
      </div>
    </Panel>
  );
}

export function DebriefScreen() {
  const g = useGame((s) => s.game);
  const go = useUi((s) => s.go);
  const rematch = useRematch();
  if (!g) return <Panel title="No game"><Btn onClick={() => go('home')}>Home</Btn></Panel>;
  const mode = modeById(g.config.modeId);
  const tally = battleTally(g);
  const killed = g.attackLog.filter((a) => a.destroyed && a.attacker.side === 'players').map((a) => a.defender.label);
  const lost = g.playerUnits.filter((p) => p.destroyed).map((p) => p.name);
  const share = btoa(JSON.stringify({ modeId: g.config.modeId, difficulty: g.config.difficulty, players: g.config.players, playerMinerals: g.config.playerMinerals, scale: g.config.scale, aiFaction: g.config.aiFaction, mutators: g.config.mutators, deploymentId: g.config.deploymentId, terrainSeed: g.config.terrainSeed, seed: g.config.seed }));
  return (
    <div>
      <Panel accent className={`debrief debrief-${g.status}`}>
        <h1 className="debrief-result">{g.status === 'won' ? 'Victory' : g.status === 'lost' ? 'Defeat' : g.status === 'draw' ? 'Draw' : 'In progress'}</h1>
        {g.status !== 'playing' && <p className="debrief-outcome">{missionOutcome(g, g.status)}</p>}
        <p><b>{mode.name}</b> · {DIFFICULTIES[g.config.difficulty].name} · {g.config.players} player(s) · AI {[...new Set(g.army.units.map((u) => unitById(u.defId).faction))].join(', ')}</p>
        <div className="hud">
          <div className="stat"><div className="k">Players VP</div><div className="v" style={{ color: 'var(--blue-side)' }}>{g.vp.players}</div></div>
          <div className="stat"><div className="k">AI VP</div><div className="v" style={{ color: 'var(--red-side)' }}>{g.vp.ai}</div></div>
          <div className="stat"><div className="k">Rounds</div><div className="v">{g.round}</div></div>
          <div className="stat"><div className="k">AI models removed</div><div className="v">{tally.aiModels}</div></div>
          <div className="stat"><div className="k">Your models lost</div><div className="v">{tally.yourModels}</div></div>
          <div className="stat"><div className="k">AI units destroyed</div><div className="v">{tally.aiUnits}</div></div>
          <div className="stat"><div className="k">AI returns</div><div className="v">{g.army.units.reduce((a, u) => a + u.respawns, 0)}</div></div>
        </div>
        {/* The battle in brief: how the score went round by round, and what fell on each side. */}
        <div className="debrief-story">
          <VpRace g={g} width={440} height={110} />
          {killed.length > 0 && <p className="small"><b>You destroyed:</b> {killed.join(', ')}</p>}
          {lost.length > 0 && <p className="small"><b>You lost:</b> {lost.join(', ')}</p>}
        </div>
        <details className="debrief-code">
          <summary className="small muted">Scenario code, to share this setup</summary>
          <code className="small">{share}</code>
        </details>
        <div className="row"><Btn variant="primary" onClick={() => rematch(g)}>Same setup again</Btn><Btn onClick={() => go('setup')}>New battle</Btn><Btn variant="ghost" onClick={() => go('home')}>Home</Btn></div>
      </Panel>
      <Panel title="Log">
        <div className="log">{g.log.map((e, i) => <div key={i} className={e.side}>R{e.round} {e.phase} · {e.text}</div>)}</div>
      </Panel>
    </div>
  );
}
