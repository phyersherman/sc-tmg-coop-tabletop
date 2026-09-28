import { useMemo, useState } from 'react';
import { CARDS, DEPLOYMENTS, UNITS, unitById, unitsForFaction } from '@data/index';
import { MODES } from '@engine/missions/index';
import { DIFFICULTIES, aiBudget } from '@engine/difficulty';
import { MUTATORS, randomMutators } from '@engine/mutators/index';
import { buildAiArmy, instanceCost, validateArmy } from '@engine/army/builder';
import { Rng, hashSeed } from '@engine/rng';
import type { AiArmy } from '@engine/types/army';
import type { DifficultyId, GameConfig, Scale } from '@engine/types/game';
import type { Faction } from '@engine/types/units';
import { useSettings } from '@tt/store/settingsStore';
import { useGame } from '@tt/store/gameStore';
import { useUi } from '@tt/store/uiStore';
import { availableModels, modelLimit } from '@tt/store/collectionStore';
import { Btn, Panel, Stepper, Toggle } from '../components/Basics';
import { TableMap, TerrainLegend } from '../components/TableMap';
import { TerrainInventory } from '../components/TerrainInventory';
import { UnitBuilder, configCost } from '../components/UnitBuilder';
import { ArmyPicker, type ArmyValue } from '../components/ArmyPicker';
import { makeInstance } from '@engine/army/builder';
import { physicalModelId } from '@engine/army/collection';
import { mapsFor, piecesNeeded } from '@data/terrainMaps';
import { mapLayout, remixId } from '@engine/terrain/remix';

const STEPS = ['Mission', 'Battle', 'Your army', 'AI army', 'Table', 'Launch'];

export function SetupScreen() {
  const settings = useSettings();
  const start = useGame((s) => s.start);
  const go = useUi((s) => s.go);
  const setBriefingSeen = useUi((s) => s.setBriefingSeen);
  const [step, setStep] = useState(0);
  // A new battle starts from the mission you last played.
  const lastMode = useGame((s) => s.game?.config.modeId);
  const [modeId, setModeId] = useState(() => (lastMode && MODES.some((m) => m.id === lastMode) ? lastMode : 'frontlines'));
  const [scale, setScale] = useState<Scale>('skirmish');
  const [players, setPlayers] = useState<1 | 2>(1);
  const [minerals, setMinerals] = useState(1000);
  const [difficulty, setDifficulty] = useState<DifficultyId>('normal');
  const [mutators, setMutators] = useState<string[]>([]);
  const [playerHasFlying, setPlayerHasFlying] = useState(false);
  const [faction, setFaction] = useState<Faction>('Zerg');
  const [army, setArmy] = useState<AiArmy | null>(null);
  const [armySeed, setArmySeed] = useState(1);
  /** Tabletop with too few models for the players' armies: the AI drops anywhere and brings its dead back. */
  const [dropAnywhere, setDropAnywhere] = useState(true);
  const [deploymentId, setDeploymentId] = useState('abandoned-camp');
  const [terrainSeed, setTerrainSeed] = useState(() => Math.floor(Math.random() * 100000));
  // The table is one of the rulebook's pre-made maps (Part 9.3): picked, or rolled.
  const [mapChoice, setMapChoice] = useState<string | null>(null);

  const mode = MODES.find((m) => m.id === modeId)!;
  // Minerals are what each player brings; the AI is built to face all of them together.
  const budget = aiBudget(minerals * players, difficulty);
  const diff = DIFFICULTIES[difficulty];
  const deployments = DEPLOYMENTS.filter((d) => (scale === 'grand' ? d.scale === 'standard' : d.scale === scale));
  const deployment = DEPLOYMENTS.find((d) => d.id === deploymentId) ?? deployments[0]!;
  // A printed map when you pick one; otherwise a random table in the same style.
  const mapId = mapsFor(deployment.scale).some((m) => m.id === mapChoice) ? mapChoice! : remixId(deployment.scale, terrainSeed);
  const terrain = useMemo(() => mapLayout(mapId, deployment), [mapId, deployment]);
  const map = { name: terrain.name, page: terrain.page, pieces: terrain.pieces };
  const issues = army ? validateArmy(army, UNITS, CARDS) : [];
  // What the collection could not field, in minerals: with a real shortfall the AI is offered another way in.
  const shortfall = army ? Math.max(0, budget - army.spent) : 0;
  const outmatched = !!modelLimit('ai') && shortfall >= Math.max(100, budget * 0.1);
  const mutatorPoints = mutators.reduce((a, id) => a + (MUTATORS.find((m) => m.id === id)?.cost ?? 0), 0);

  const setScaleAnd = (s: Scale) => {
    setScale(s);
    setMinerals(s === 'skirmish' ? 1000 : s === 'standard' ? 2000 : 3000);
    const d = DEPLOYMENTS.find((x) => x.scale === (s === 'grand' ? 'standard' : s));
    if (d) setDeploymentId(d.id);
  };

  const generate = (seed = armySeed, f: Faction = faction) => {
    // Built against the players' armies (upgrades that counter them) from the models they are not fielding.
    const theirs = inPlay.flatMap((p) => p.value.units);
    const opponents = theirs.map((u) => ({ defId: u.defId, models: u.maxModels }));
    const reserved: Record<string, number> = {};
    for (const u of theirs) reserved[u.defId] = (reserved[u.defId] ?? 0) + u.maxModels;
    const a = buildAiArmy({ faction: f, factions: ['Terran', 'Zerg', 'Protoss'], budget, ownership: availableModels('ai'), heroAllowed: diff.heroAllowed, seed, units: UNITS, cards: CARDS, opponents, reserved });
    setArmy(a);
  };
  // Coming to the AI's army: a hidden army is built at once, from any race's unused models.
  const toAiStep = () => {
    const s = armySeed + 1;
    setArmySeed(s);
    generate(s);
  };
  const addAiUnit = (cfg: { defId: string; composition: 'small' | 'large'; upgrades: string[]; name: string }, count: number) => {
    const base: AiArmy = army ?? { faction, factionCardId: '', budget, spent: 0, units: [] };
    const units = base.units.slice();
    for (let i = 0; i < count; i++) {
      const def = unitById(cfg.defId);
      const idx = units.filter((u) => u.defId === cfg.defId).length + 1;
      const inst = makeInstance(def, cfg.composition, count > 1 || idx > 1 ? `${cfg.name} ${String.fromCharCode(64 + idx)}` : cfg.name, idx);
      inst.upgrades = cfg.upgrades.slice();
      units.push(inst);
    }
    const spent = units.reduce((a, u) => a + instanceCost(unitById(u.defId), u), 0);
    setArmy({ ...base, units, spent });
  };
  // One army per player, each with its own faction and its own cards. They start empty for every battle (the
  // ones fielded before are offered back, never preloaded).
  // Each player keeps an army per race: switching race puts the other race's army aside, not in the bin, and
  // switching back brings it out again.
  const [forces, setForces] = useState<{ faction: Faction; byRace: Partial<Record<Faction, ArmyValue>> }[]>(() =>
    [0, 1].map(() => ({ faction: faction === 'Zerg' ? ('Terran' as Faction) : ('Zerg' as Faction), byRace: {} })));
  /** Which player's army is being built (0-based); never past the number of players. */
  const [picked, setWhose] = useState(0);
  const whose = Math.min(picked, players - 1);
  const armyOf = (f: { faction: Faction; byRace: Partial<Record<Faction, ArmyValue>> }): ArmyValue => f.byRace[f.faction] ?? { units: [], cards: [] };
  const inPlay = forces.slice(0, players).map((f) => ({ faction: f.faction, value: armyOf(f) }));
  // Unit types the AI could still field once the players' own models are taken off the shelf.
  const taken: Record<string, number> = {};
  for (const f of inPlay) for (const u of f.value.units) taken[physicalModelId(u.defId)] = (taken[physicalModelId(u.defId)] ?? 0) + u.maxModels;
  const unusedCount = UNITS.filter((u) => !u.summoned && (availableModels('ai')[u.id] ?? 0) - (taken[physicalModelId(u.id)] ?? 0) > 0).length;
  const me = inPlay[whose]!;
  // Functional updates: a race change and an army change can land in the same tick, and each must see the other.
  const setMine = (value: ArmyValue) => setForces((cur) => cur.map((f, i) => (i === whose ? { ...f, byRace: { ...f.byRace, [f.faction]: value } } : f)));
  const setMyFaction = (f: Faction) => setForces((cur) => cur.map((x, i) => (i === whose ? { ...x, faction: f } : x)));
  const costOf = (v: ArmyValue) => v.units.reduce((a, u) => a + configCost(u), 0);
  const myCost = costOf(me.value);
  const removeUnit = (id: string) => {
    if (!army) return;
    const units = army.units.filter((u) => u.id !== id);
    const spent = units.reduce((a, u) => a + instanceCost(unitById(u.defId), u), 0);
    setArmy({ ...army, units, spent });
  };

  const launch = () => {
    if (!army) return;
    const config: GameConfig = {
      playMode: 'tabletop',
      modeId, difficulty, players, playerMinerals: minerals, scale, aiFaction: army.faction,
      mutators: difficulty === 'brutalPlus' ? mutators : [],
      deploymentId: deployment.id, terrainSeed, terrainMapId: mapId, seed: hashSeed(`${Date.now()}-${armySeed}`), army,
      options: { actionDecks: true, noMap: true, hideAiRoster: true, appRollsAiDice: settings.appRollsAiDice, assistedSaves: settings.assistedSaves, playerHasFlying, manualSaves: true, aiDropsAnywhere: outmatched && dropAnywhere },
      playerUnits: inPlay.flatMap((f, i) => f.value.units.map((u) => ({ ...u, owner: i, models: u.maxModels, damageMarker: 0, shieldsLeft: unitById(u.defId).stats.shields ?? 0, destroyed: false }))),
      playerCards: inPlay.flatMap((f, i) => f.value.cards.map((defId) => ({ defId, owner: i }))),
    };
    // Every army you start a battle with is saved, with its cards: under the name you gave it, or a generic one.
    for (const f of inPlay) {
      if (f.value.units.length) settings.pushRecentArmy({ name: f.value.name ?? '', faction: f.faction, scale, cost: costOf(f.value), units: f.value.units, cards: f.value.cards });
    }
    settings.setMyArmy(inPlay[0]!.value.units);
    start(config);
    setBriefingSeen(false);
    go('game');
  };

  const canNext = step !== 3 || (army && issues.every((i) => i.level !== 'error'));

  // The battle plan so far, one line per step: what was decided reads back as the wizard goes on.
  const planValue = (i: number): string => {
    if (i > step) return '';
    switch (i) {
      case 0: return mode.name;
      case 1: return `${scale} · ${diff.name}${players > 1 ? ` · ${players} players` : ''} · ${minerals} minerals`;
      case 3: return army ? `hidden · ${army.spent} minerals` : 'not built';
      case 2: return inPlay.map((f, k) => `${players > 1 ? `P${k + 1} ` : ''}${f.faction} ${costOf(f.value)}`).join(' · ');
      case 4: return `${deployment.name} · ${map.name}`;
      case 5: return army ? 'everything set' : 'AI army not built';
      default: return '';
    }
  };
  return (
    <div className="setup">
      <ol className="plan-rail" aria-label="Battle plan">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <button type="button" disabled={i > step} aria-current={i === step ? 'step' : undefined} onClick={() => i < step && setStep(i)}>
              <span className="plan-step">{s}</span>
              <span className="plan-value">{planValue(i) || (i === step ? 'deciding…' : '')}</span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div>
          <h2>Choose a mission</h2>
          <h3>Co-op missions</h3>
          <div className="grid grid-3">
            {MODES.filter((m) => !m.official).map((m) => (
              <div key={m.id} className={`panel mode-card ${m.id === modeId ? 'selected' : ''}`} onClick={() => setModeId(m.id)}>
                <div className="panel-title"><h3>{m.name}</h3><span className="tag">{m.rounds} rounds</span></div>
                <p className="small">{m.blurb}</p>
              </div>
            ))}
          </div>
          <h3>Official mission cards, versus the AI</h3>
          <div className="grid grid-3">
            {MODES.filter((m) => m.official).map((m) => (
              <div key={m.id} className={`panel mode-card ${m.id === modeId ? 'selected' : ''}`} onClick={() => setModeId(m.id)}>
                <div className="panel-title"><h3>{m.name}</h3><span className="tag">{m.rounds} rounds</span></div>
                <p className="small">{m.blurb}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="grid grid-2">
          <Panel title="Scale">
            <div className="row">
              {(['skirmish', 'standard', 'grand'] as Scale[]).map((s) => (
                <Btn key={s} variant={scale === s ? 'primary' : ''} onClick={() => setScaleAnd(s)}>{s}</Btn>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 8 }}>Skirmish: up to 1,000 minerals on 36"×36". Standard: up to 2,000 on 36"×54". Grand: 2,001+ on 36"×72" (uses standard layouts).</p>
            <div className="row" style={{ marginTop: 10 }}>
              <label>Players</label>
              <Stepper value={players} onChange={(v) => setPlayers(Math.max(1, Math.min(2, v)) as 1 | 2)} min={1} max={2} />
              <label>Minerals per player</label>
              <input type="number" value={minerals} step={50} min={200} onChange={(e) => setMinerals(Number(e.target.value) || 0)} />
            </div>
            {players > 1 && <p className="small muted" style={{ marginTop: 6 }}>Each player builds their own army of {minerals} minerals, with their own cards. The AI is built to face all {players} of you: {minerals * players} minerals before difficulty.</p>}
            <div className="row" style={{ marginTop: 10 }}>
              <Toggle on={playerHasFlying} onChange={setPlayerHasFlying}>Players field Flying units</Toggle>
            </div>
          </Panel>
          <Panel title="Difficulty" tag={`AI budget ${budget}`}>
            <div className="col">
              {(Object.values(DIFFICULTIES)).map((d) => (
                <div key={d.id} className={`panel mode-card ${difficulty === d.id ? 'selected' : ''}`} style={{ marginBottom: 0, padding: 10 }} onClick={() => { setDifficulty(d.id); if (d.id === 'brutalPlus' && mutators.length === 0) setMutators(randomMutators(d.mutatorPoints, Rng.from(Date.now() % 100000))); }}>
                  <b style={{ fontFamily: 'var(--font-head)' }}>{d.name}</b> <span className="small muted">×{d.budgetMult} minerals · {d.blurb}</span>
                </div>
              ))}
            </div>
            {difficulty === 'brutalPlus' && (
              <div style={{ marginTop: 12 }}>
                <div className="row between"><label>Mutators ({mutatorPoints}/{diff.mutatorPoints} points)</label><Btn size="sm" onClick={() => setMutators(randomMutators(diff.mutatorPoints, Rng.from(Date.now() % 100000)))}>Random</Btn></div>
                <div className="col" style={{ marginTop: 6 }}>
                  {MUTATORS.map((m) => (
                    <Toggle key={m.id} on={mutators.includes(m.id)} onChange={(v) => setMutators(v ? [...mutators, m.id] : mutators.filter((x) => x !== m.id))}>
                      {m.name} ({m.cost}) <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}>— {m.text}</span>
                    </Toggle>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </div>
      )}

      {step === 2 && (
        <Panel title={players > 1 ? `Player ${whose + 1}'s army` : 'Your army'} tag={`${myCost} / ${minerals} minerals`}>
          {players > 1 && (
            <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {inPlay.map((f, i) => (
                <Btn key={i} variant={whose === i ? 'primary' : ''} onClick={() => setWhose(i)}>
                  Player {i + 1}<span className="small muted"> · {f.faction} · {costOf(f.value)}/{minerals}</span>
                </Btn>
              ))}
            </div>
          )}
          <p className="small muted">Train units from the buildings that make them, choose their upgrades, and pick your cards. {players > 1 ? 'Each player picks their own faction and cards, and spends only their own Command Points, Biomass or Psionic Energy in the battle.' : ''} The army starts empty every battle; the ones you have fielded before are at the bottom right, to bring back if you want them.</p>
          <ArmyPicker key={whose} faction={me.faction} onFaction={setMyFaction} budget={minerals} scale={scale} owned={modelLimit('player')} value={me.value} onChange={setMine} recent={settings.recentArmies} onForget={settings.removeRecentArmy} named />
          <p className="small muted" style={{ marginTop: 10 }}>You can also skip this: the AI then plays with no list of your units, and you tell it what it sees at the table.</p>
        </Panel>
      )}

      {step === 3 && (
        <Panel title="The enemy" accent tag={army ? 'Ready · hidden' : 'Not built'}>
          <p>The AI builds its army in secret: {budget} minerals ({diff.name}) from the models in your Collection that the players are not fielding, of any race. You meet its units as they arrive on the table; until then only their number of minerals is known.</p>
          <p className="small muted">{unusedCount} unit type{unusedCount === 1 ? '' : 's'} left for the AI to draw on after your armies.</p>
          {army && issues.some((i) => i.level === 'error') && <p className="tag danger">Not enough unused models for an AI army. Add models to your Collection, or field fewer yourselves.</p>}
          {outmatched && (
            <div style={{ marginTop: 10 }}>
              <Toggle on={dropAnywhere} onChange={setDropAnywhere}>The AI makes up the shortfall</Toggle>
              <p className="small muted" style={{ margin: '4px 0 0' }}>Your collection fields {army!.spent} of the {budget} minerals the AI should have against {players > 1 ? `${players} players` : 'you'}. With this on, the {shortfall} it is short come back as destroyed units return with the models they free, and its units may be set down anywhere on the table more than 6" from yours — from the opening deployment on.</p>
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <Btn onClick={() => { const s = armySeed + 1; setArmySeed(s); generate(s); }}>Build a different army</Btn>
            <Btn size="sm" variant="ghost" onClick={() => go('collection')}>Edit collection</Btn>
          </div>
        </Panel>
      )}

      {step === 4 && (
        <div className="grid grid-2">
          <Panel title="Deployment card">
            <div className="col">
              {deployments.map((d) => (
                <Btn key={d.id} variant={deployment.id === d.id ? 'primary' : ''} onClick={() => setDeploymentId(d.id)}>{d.name} · {d.table.width}×{d.table.height}"</Btn>
              ))}
            </div>
          </Panel>
          <Panel title="Terrain map" tag={map.page ? `rulebook p. ${map.page}` : 'random'}>
            <p className="small muted">A random table built the way the rulebook's maps are, or one of the printed maps from the back of the core rulebook.</p>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Btn size="sm" variant={!mapChoice ? 'primary' : ''} onClick={() => { setMapChoice(null); setTerrainSeed(Math.floor(Math.random() * 100000)); }}>{mapChoice ? 'Random table' : 'Reroll'}</Btn>
              {mapsFor(deployment.scale).map((m) => (
                <Btn key={m.id} size="sm" variant={m.id === mapChoice ? 'primary' : ''} onClick={() => setMapChoice(m.id)}>{m.name}{m.ramps ? ` · ${m.ramps} ramp${m.ramps > 1 ? 's' : ''}` : ''}</Btn>
              ))}
            </div>
            <p className="small muted">{map.name}.</p>
            <p className="small">Needs: {piecesNeeded(map).map((p) => `${p.count}× ${p.label}`).join(', ')}.</p>
          </Panel>
          <Panel title="Table preview">
            <TableMap deployment={deployment} terrain={terrain} aiFaction={faction} />
          </Panel>
          <Panel title="Your terrain collection" className="span-all">
            <TerrainInventory />
          </Panel>
        </div>
      )}

      {step === 5 && (
        <Panel title="Ready to launch" accent>
          <p><b>{mode.name}</b> — {mode.blurb}</p>
          <p>{diff.name}, {players} player{players > 1 ? 's' : ''}{players > 1 ? ` (${inPlay.map((f, i) => `P${i + 1} ${f.faction} ${costOf(f.value)}`).join(', ')})` : ''}, {minerals} minerals each vs a hidden AI army of {army?.spent} minerals. {deployment.name}, {map.name}{map.page ? ` (rulebook p. ${map.page})` : ''}.</p>
          {difficulty === 'brutalPlus' && <p>Mutators: {mutators.map((id) => MUTATORS.find((m) => m.id === id)?.name).join(', ')}</p>}
          {outmatched && dropAnywhere && <p>The AI is {shortfall} minerals short of models: destroyed units return to make it up, and its units may be set down anywhere more than 6" from yours.</p>}
          {<p className="small muted">Dice: {settings.appRollsAiDice ? 'the app rolls AI dice' : 'you roll AI dice'} (change in Settings).</p>}
          <Btn variant="primary" size="lg" onClick={launch} disabled={!army}>Start the battle</Btn>
        </Panel>
      )}

      <div className="row between" style={{ marginTop: 16 }}>
        <Btn variant="ghost" onClick={() => (step === 0 ? go('home') : setStep(step - 1))}>{step === 0 ? 'Cancel' : 'Back'}</Btn>
        {step < 5 && <Btn variant="primary" onClick={() => { if (step === 2) toAiStep(); setStep(step + 1); }} disabled={!canNext}>Next</Btn>}
      </div>
    </div>
  );
}
