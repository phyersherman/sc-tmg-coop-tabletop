import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { create } from 'zustand';
import type { GameState } from '@engine/types/game';
import type { Command } from '@engine/director/reducer';
import { unitById } from '@data/index';
import { playerUnitDef } from '@engine/sense/playerUnits';
import { aiSupplyOnTable, poolNow } from '@engine/director/selectors';
import { playerPool, aiEvadeReason } from '@engine/player/rules';
import { modeById } from '@engine/missions/index';
import { DIFFICULTIES } from '@engine/difficulty';
import { aiDebuff } from '@engine/ai/decide';
import { useGame } from '@tt/store/gameStore';
import { useUi } from '@tt/store/uiStore';
import { EnemyBoard } from './EnemyBoard';
import { TableSetup } from '../hud/TableSetup';
import { CombatTray, Side } from '../hud/CombatTray';
import { autoSaves } from '../hud/combatPools';
import { DieFace, DieTumble } from '../components/DiceRoll';
import { phaseNote } from '../hud/PhaseTrack';
import { Stakes } from '../hud/Stakes';
import { Rewards } from '../hud/Rewards';
import { Btn, Stepper, Toggle } from '../components/Basics';
import { aiBurrowed, aiHas } from '@engine/ai/burrow';
import type { AiOrder } from '@engine/types/game';
import { primaryStep } from '@engine/ai/actionDecks';
import { stepText } from './ActionCardView';
import { StepIcon, type StepMark } from './StepIcon';

const PHASES = ['movement', 'assault', 'combat', 'scoring'] as const;

/**
 * The game is on your table and the app is the opponent across it. What happens now (the AI's order and its dice,
 * or your activation) takes the stage at the top of the screen, at a size the room reads; the enemy's Units are laid
 * out as cards below it. The operator's tools (damage entry, rewards) keep to the side panel. The table itself is
 * the map: the app only shows the layout again when asked.
 */
export function TabletopLayout({ g, dispatch, now, overlays, pendingEvent }: {
  g: GameState;
  dispatch: (c: Command) => void;
  /** The one decision in front of you. */
  now: ReactNode;
  /** Table setup: a full-screen step. */
  overlays: ReactNode;
  pendingEvent: string | null;
}) {
  const ui = useUi();
  const undoLast = useGame((s) => s.undoLast);
  const undoLen = useGame((s) => s.undo.length);
  const [menu, setMenu] = useState(false);
  const [layout, setLayout] = useState(false);
  const last = useLastAiAction(g);
  useStageKeys(undoLast);

  const inspected = g.army.units.find((u) => u.id === ui.inspectId && u.location === 'table');
  const cfg = modeById(g.config.modeId);
  const inOrder = g.step.kind === 'AI_ORDER';
  return (
    <div className="tt-root tt-mode-aiOnly">
      <header className="tt-top">
        <div className="tt-menu-wrap">
          <button type="button" className="tt-btn" onClick={() => setMenu((v) => !v)} aria-expanded={menu}>Menu</button>
          {menu && (
            <div className="tt-menu" onMouseLeave={() => setMenu(false)}>
              <b>{cfg.name}</b>
              <span className="small muted">{DIFFICULTIES[g.config.difficulty].name}</span>
              <button type="button" onClick={() => ui.go('home')}>Home</button>
              <button type="button" onClick={() => ui.go('rulebook')}>Rulebook</button>
              <button type="button" onClick={() => { setLayout(true); setMenu(false); }}>Table layout</button>
            </div>
          )}
        </div>
        <button type="button" className="tt-btn" onClick={undoLast} disabled={undoLen === 0} title="Undo the last step (Ctrl+Z or Cmd+Z)">Undo</button>
        {/* The scoreboard: round, phase, score and Supply at a glance. */}
        <div className="tt-status" title={phaseNote(g)}>
          <span className="tt-round"><small>Round</small><b>{g.round}<i>/{g.finalRound}</i></b></span>
          <span className="tt-phase" aria-label={`${g.phase} phase`}>
            {PHASES.map((p) => <span key={p} className={p === g.phase ? 'on' : ''}>{p}</span>)}
          </span>
          <span className="tt-vp" aria-label={`Victory points: you ${g.vp.players}, AI ${g.vp.ai}`}><b className="blue">{g.vp.players}</b><i>:</i><b className="red">{g.vp.ai}</b><small>VP</small></span>
          {(g.config.players ?? 1) > 1
            ? Array.from({ length: g.config.players }, (_, i) => <SupplyMeter key={i} label={`P${i + 1}`} used={null} pool={playerPool(g, i)} side="blue" />)
            : <SupplyMeter label="You" used={null} pool={playerPool(g)} side="blue" />}
          <SupplyMeter label="AI" used={aiSupplyOnTable(g)} pool={poolNow(g)} side="red" />
        </div>
      </header>
      {/* The mission's objective, under the scoreboard: the whole table should know what it is playing for. */}
      <Stakes g={g} className="tt-stakes" />

      <div className="tt-map">
        {/* What happens now: the dice being rolled, then the order or the turn in front of you. What the AI did last
            stays in view until its next order, so a player still moving its models can read it. */}
        <section className="tt-stage" aria-label="Now">
          <p className="sr-only" aria-live="polite">{announce(g)}</p>
          {!inOrder && last && <LastAiAction last={last} />}
          <CombatTray g={g} dispatch={dispatch} pendingEvent={pendingEvent} className="inline tt-tray" />
          <div className="tt-now">{now ?? (pendingEvent ? <p className="tt-hint muted">Apply the result on the table, then Continue.</p> : null)}</div>
        </section>
        <EnemyBoard g={g} selected={inspected?.id ?? null} lastId={inOrder ? null : last?.unitId ?? null} onPick={(id) => ui.inspect(id === ui.inspectId ? null : id)} />
      </div>

      {/* The operator's side: what happened to an enemy Unit, and rewards waiting for a choice. With nothing to do
          there it is not drawn, and the stage and the enemy take the whole width. */}
      <aside className="tt-panel">
        {inspected && <EnemyCard g={g} unitId={inspected.id} dispatch={dispatch} onClose={() => ui.inspect(null)} />}
        <HitsBattle g={g} dispatch={dispatch} />
        {/* A side marker's reward waits here for its one choice (which unit, which player) until it is used or lost. */}
        <Rewards g={g} dispatch={dispatch} />
      </aside>

      {overlays}
      {layout && <TableSetup g={g} onDone={() => setLayout(false)} doneLabel="Close" />}
    </div>
  );
}

interface LastAction { key: string; unitId: string; label: string; mark: StepMark; head: string; line: string }

const ORDER_MARK: Partial<Record<AiOrder['type'], StepMark>> = { deploy: 'enter', move: 'move', run: 'run', hold: 'hold', ranged: 'attack', charge: 'charge', closeCombat: 'attack', disengage: 'run' };

/** What an AI order asked of the table, in a line: the card's lead step, or the order's own first line. */
function describe(g: GameState, order: AiOrder): LastAction {
  const u = g.army.units.find((x) => x.id === order.unitId);
  const label = u?.label ?? order.title;
  const lead = order.card ? primaryStep(order.card) : null;
  const line = order.card && lead && u ? stepText(g, order.card, order.type === 'deploy' ? { k: 'move', mod: 0, to: 'objective' } : lead, u).title : order.lines[0] ?? '';
  const mark: StepMark = order.type === 'deploy' ? 'enter' : lead ? lead.k : ORDER_MARK[order.type] ?? 'move';
  return { key: `${g.round}:${g.phase}:${order.unitId}:${g.log.length}`, unitId: order.unitId, label, mark, head: order.card?.name ?? order.title.replace(/^.*?:\s*/, ''), line };
}

/**
 * The AI order the table last carried out: remembered when it leaves the screen and shown until the next one, so
 * the players can finish moving its models without the order vanishing under the operator's click.
 */
function useLastAiAction(g: GameState): LastAction | null {
  const [last, setLast] = useState<LastAction | null>(null);
  const showing = useRef<LastAction | null>(null);
  const order = g.step.kind === 'AI_ORDER' ? g.step.order : null;
  useEffect(() => {
    if (order) showing.current = describe(g, order);
    else if (showing.current) { setLast(showing.current); showing.current = null; }
  }, [order]); // eslint-disable-line react-hooks/exhaustive-deps
  return last;
}

function LastAiAction({ last }: { last: LastAction }) {
  return (
    <div className="tt-last" key={last.key}>
      <span className="tt-last-mark"><StepIcon mark={last.mark} /></span>
      <p><b>Last: {last.label}</b><span className="tt-last-head">{last.head}</span><span className="tt-last-line">{last.line}</span></p>
    </div>
  );
}

/** One quiet sentence for a screen reader when the stage changes, instead of the whole card read out again. */
function announce(g: GameState): string {
  if (g.step.kind === 'AI_ORDER') {
    const o = g.step.order;
    const u = g.army.units.find((x) => x.id === o.unitId);
    return `AI turn. ${u?.label ?? ''}: ${o.card?.name ?? o.title}.`;
  }
  if (g.step.kind === 'PLAYERS_TURN') return `Your turn, ${g.phase} phase.`;
  if (g.step.kind === 'PHASE_START') return `${g.phase} phase.`;
  if (g.step.kind === 'ROUND_START') return `Round ${g.round}.`;
  return '';
}

/**
 * The operator's keys on the stage: Space presses the one action of the AI's order or a banner (the players' turn
 * and the dice tray keep their own keys), and Ctrl+Z or Cmd+Z undoes the last step.
 */
function useStageKeys(undoLast: () => void): void {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoLast(); return; }
      if (e.key !== ' ' || document.querySelector('.tt-stage .combat-tray')) return;
      const primary = document.querySelector<HTMLButtonElement>('.tt-now .tt-primary:not(:disabled)');
      if (!primary) return;
      e.preventDefault();
      primary.click();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [undoLast]);
}

/** Your activation on the table: do it there, then hand the turn to the AI. */
export function TabletopTurn({ g, dispatch }: { g: GameState; dispatch: (c: Command) => void }) {
  // The engine is waiting on your saves: the tray above rolls them step by step, and this is the way past if it
  // ever does not — the app rolls your Armour (and Evade) and the game goes on.
  if (g.step.kind === 'AI_SAVES') {
    const a = g.step.attack;
    return (
      <div className="tt-card tt-you">
        <h2>Your saves</h2>
        <p>{a.attacker.label} hit {a.defender.label} {a.hits} time{a.hits === 1 ? '' : 's'}. Roll your saves in the tray above.</p>
        <Btn size="sm" variant="ghost" onClick={() => dispatch(autoSaves(g, a))}>Roll my saves for me</Btn>
      </div>
    );
  }
  const what = g.phase === 'movement' ? 'Move or deploy one of your Units.' : g.phase === 'assault' ? 'Shoot, charge or run with one of your Units.' : g.phase === 'combat' ? 'Fight with one of your Engaged Units. Only its Fighting Rank and Supporting Rank roll.' : 'Score the round.';
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === ' ') { e.preventDefault(); dispatch({ t: 'playersDone' }); }
      else if (e.key.toUpperCase() === 'P') { e.preventDefault(); dispatch({ t: 'playersPass' }); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });
  const aiPassed = g.passed.ai;
  // The AI's pass this phase, shown as it happens (when your Done handed it a turn it had no use for).
  const last = g.log[g.log.length - 1];
  const justPassed = aiPassed && last?.side === 'ai' && last.text === 'The AI passes.' && last.phase === g.phase;
  return (
    <>
      {justPassed && (
        <div className="tt-card tt-pass" role="status">
          <h2>The AI passes</h2>
          <p className="small">It has nothing left to activate this phase. {g.nextFirstPlayer === 'ai' ? 'Passing first, it goes first next phase.' : ''}</p>
        </div>
      )}
      <div className="tt-card tt-you">
        <h2>{aiPassed ? 'Finish your activations' : 'Activate a Unit on the table'}</h2>
        <p>{what}</p>
        {aiPassed && <p className="small warn">The AI has passed. Activate your remaining Units one after another, then pass to end the phase.</p>}
        <div className="row">
          <Btn variant="primary" size="lg" onClick={() => dispatch({ t: 'playersDone' })}>{aiPassed ? 'Done: next Unit' : "Done: AI's turn"} <kbd>Space</kbd></Btn>
          <Btn variant={aiPassed ? 'primary' : undefined} onClick={() => dispatch({ t: 'playersPass' })}>{aiPassed ? 'Pass: end phase' : 'Pass'} <kbd>P</kbd></Btn>
        </div>
        {!aiPassed && <p className="small muted">Pass when you have nothing left to activate this phase.</p>}
      </div>
    </>
  );
}

const STATS = [
  { stat: 'speed' as const, label: 'Speed', unit: '"' },
  { stat: 'hit' as const, label: 'Hit', unit: '+' },
  { stat: 'armour' as const, label: 'Armour', unit: '+' },
  { stat: 'evade' as const, label: 'Evade', unit: '+' },
];

/**
 * An AI unit picked on the map: what state it is in, and what happened to it on the table — hits (the app rolls
 * its saves) or damage straight in, models removed, DEBUFFs until the End of the Round.
 */
export function EnemyCard({ g, unitId, dispatch, onClose }: { g: GameState; unitId: string; dispatch: (c: Command) => void; onClose: () => void }) {
  const u = g.army.units.find((x) => x.id === unitId)!;
  const def = unitById(u.defId);
  const [entry, setEntry] = useState<'hits' | 'damage'>('hits');
  const [n, setN] = useState(1);
  const [per, setPer] = useState(1);
  /** ANTI-EVADE (X) on the weapon you fired, if any: it raises what the AI's Evade dice need. */
  const [anti, setAnti] = useState(0);
  /** The rarer entries (models, statuses, DEBUFFs): opened on demand, and open anyway while one is in effect. */
  const [more, setMore] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const armour = def.stats.armour + aiDebuff(u, 'armour');
  // Whether the AI rolls Evade against this attack: engaged and shot at, burrowed, or high ground over you.
  const selectedUnitId = useUi((st) => st.selectedUnitId);
  const evadeReason = aiEvadeReason(g, u, g.phase === 'combat' ? 'Combat' : 'Assault', g.playerUnits.find((p) => p.id === selectedUnitId));
  const evadeValue = def.stats.evade ? def.stats.evade + aiDebuff(u, 'evade') + anti : 0;
  const apply = () => {
    // Straight damage: the number you worked out at the table goes on as it is, no dice, no multiplier.
    if (entry === 'damage') {
      useBattle.setState({ b: { key: Date.now(), unitId: u.id, hits: n, per: 1, armour, rolls: null, evade: null, stage: 'rolling', outcome: null } });
      return;
    }
    const d6 = () => 1 + Math.floor(Math.random() * 6);
    const rolls = Array.from({ length: n }, d6);
    const evade = evadeReason && evadeValue ? { value: evadeValue, reason: evadeReason, rolls: Array.from({ length: n }, d6) } : null;
    useBattle.setState({ b: { key: Date.now(), unitId: u.id, hits: n, per, armour, rolls, evade, stage: 'rolling', outcome: null } });
  };
  const inEffect = u.engaged || aiBurrowed(u) || STATS.some((st) => aiDebuff(u, st.stat) > 0) || anti > 0;
  const open = more || inEffect;
  // Opened from a tile: focus moves in, Esc closes it and hands focus back to the tile, Enter applies.
  useEffect(() => {
    card.current?.querySelector<HTMLElement>('.tt-seg [aria-checked="true"]')?.focus();
  }, [unitId]);
  const close = () => {
    onClose();
    document.querySelector<HTMLElement>(`[data-unit="${unitId}"]`)?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); apply(); }
  };
  const shields = def.stats.shields ? `+${def.stats.shields}` : '';
  return (
    <div className="tt-card tt-enemy" ref={card} onKeyDown={onKey} role="group" aria-label={`Damage to ${u.label}`}>
      <div className="row between tt-card-head">
        <h2>{u.label}</h2>
        <button type="button" className="tt-close" onClick={close} aria-label="Close (Esc)">×</button>
      </div>
      <p className="small muted">{u.label.includes(def.name) ? '' : `${def.name} · `}{u.models}/{u.maxModels} models · HP {def.stats.hp}{shields} · Armour {def.stats.armour}+{def.stats.evade ? ` · Evade ${def.stats.evade}+` : ''}{u.damageMarker > 0 ? <> · damage marker <b>{u.damageMarker}</b></> : null}</p>

      <div className="tt-seg" role="radiogroup" aria-label="What to enter">
        <button type="button" role="radio" aria-checked={entry === 'hits'} className={entry === 'hits' ? 'active' : ''} onClick={() => setEntry('hits')}>Hits (AI saves)</button>
        <button type="button" role="radio" aria-checked={entry === 'damage'} className={entry === 'damage' ? 'active' : ''} onClick={() => setEntry('damage')}>Damage</button>
      </div>
      <div className="row">
        <label className="row small">{entry === 'hits' ? 'Hits' : 'Damage'} <Stepper value={n} onChange={setN} min={1} max={60} /></label>
        {entry === 'hits' && <label className="row small">× Damage <Stepper value={per} onChange={setPer} min={1} max={6} /></label>}
        <Btn variant="danger" onClick={apply} title="Apply (Enter)">Apply</Btn>
      </div>
      {entry === 'hits' && def.stats.evade ? (
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          {evadeReason ? <>The AI rolls Evade <b>{evadeValue}+</b> against hits that get past Armour ({evadeReason}).</> : <>No Evade roll. It is not Engaged, Burrowed or on high ground above the attacker.</>}
        </p>
      ) : null}
      {/* While something here is in effect (Engaged, Burrowed, a DEBUFF) it stays open, so it is never hidden. */}
      {!inEffect && <button type="button" className="tt-more" aria-expanded={open} onClick={() => setMore((v) => !v)}>{open ? 'Fewer options' : 'More: models, statuses, ANTI-EVADE, DEBUFFs'}</button>}
      {open && <>
      {entry === 'hits' && def.stats.evade ? <label className="row small">ANTI-EVADE on your weapon <Stepper value={anti} onChange={setAnti} min={0} max={3} /></label> : null}
      <div className="row" style={{ marginTop: 4 }}>
        <Btn size="sm" title="A model removed outright, without damage (a SUMMON gone, a model taken off by an ability)" onClick={() => dispatch({ t: 'setModels', unitId: u.id, models: Math.max(0, u.models - 1) })}>−1 model</Btn>
        {/* Medics and the like: damage comes back off the marker. */}
        {u.damageMarker > 0 && <Btn size="sm" variant="ok" title="Take 1 damage off its marker (a Medic, a heal)" onClick={() => dispatch({ t: 'heal', unitId: u.id, amount: 1 })}>Heal 1</Btn>}
        {/* The state, not the action: on while the unit is Engaged, and the map keeps it right when it knows where things stand. */}
        <Toggle on={u.engaged} onChange={(v) => dispatch({ t: 'setEngaged', unitId: u.id, engaged: v, enemySupply: u.engagedEnemySupply || 1 })}>Engaged</Toggle>
        {aiHas(u, 'Burrow') && <Toggle on={aiBurrowed(u)} onChange={(v) => dispatch({ t: 'setBurrowed', unitId: u.id, on: v })}>Burrowed</Toggle>}
      </div>

      <h3 className="tt-sub">DEBUFF until the End of the Round</h3>
      <div className="tt-debuffs">
        {STATS.map((s) => {
          const v = aiDebuff(u, s.stat);
          return (
            <label key={s.stat} className={v ? 'on' : ''}>
              {s.label} <Stepper value={v} onChange={(amount) => dispatch({ t: 'aiDebuff', unitId: u.id, stat: s.stat, amount })} min={0} max={6} />
            </label>
          );
        })}
      </div>
      </>}
    </div>
  );
}

/** Hits entered on an AI unit, played out like game mode's Combat Tray: your hits, its Armour dice, the damage. */
interface HitsRoll {
  key: number;
  unitId: string;
  hits: number;
  per: number;
  armour: number;
  /** The AI's Armour dice; null when you entered damage after saves. */
  rolls: number[] | null;
  /** The AI's Evade roll, when it gets one: value to beat (ANTI-EVADE included), why, and dice for every hit
   *  (only as many as get past the Armour are used). */
  evade: { value: number; reason: string; rolls: number[] } | null;
  stage: 'rolling' | 'done';
  outcome: { damage: number; removed: number; destroyed: boolean } | null;
}
const useBattle = create<{ b: HitsRoll | null }>(() => ({ b: null }));

function HitsBattle({ g, dispatch }: { g: GameState; dispatch: (c: Command) => void }) {
  const b = useBattle((s) => s.b);
  // Once the dice have landed, the damage goes in.
  useEffect(() => {
    if (!b || b.stage !== 'rolling') return;
    const wait = b.rolls ? 900 + Math.min(b.rolls.length, 24) * 35 : 250;
    const t = window.setTimeout(() => {
      const before = useGame.getState().game?.army.units.find((x) => x.id === b.unitId);
      const saved = b.rolls ? b.rolls.filter((r) => r >= b.armour).length : 0;
      // Evade Roll on what gets past the Armour (Part 8.7.4): each die at or over the Evade value is discarded.
      const evaded = b.evade ? b.evade.rolls.slice(0, b.hits - saved).filter((r) => r >= b.evade!.value).length : 0;
      const damage = (b.hits - saved - evaded) * b.per;
      if (damage > 0) dispatch({ t: 'damage', unitId: b.unitId, dmg: damage });
      const after = useGame.getState().game?.army.units.find((x) => x.id === b.unitId);
      const removed = Math.max(0, (before?.models ?? 0) - (after?.models ?? 0));
      const destroyed = !!before && (after?.models ?? 0) === 0;
      useBattle.setState({ b: { ...b, stage: 'done', outcome: { damage, removed, destroyed } } });
    }, wait);
    return () => window.clearTimeout(t);
  }, [b, dispatch]);
  useEffect(() => {
    if (!b || b.stage !== 'done') return;
    const on = (e: KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); useBattle.setState({ b: null }); } };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [b]);
  if (!b) return null;
  const u = g.army.units.find((x) => x.id === b.unitId);
  if (!u) return null;
  // Each enemy unit rolls its own race's dice: a mixed army is not one faction.
  const aiFaction = unitById(u.defId).faction;
  const you = g.playerUnits[0] ? playerUnitDef(g.playerUnits[0]).faction : aiFaction === 'Zerg' ? 'Terran' : 'Zerg';
  const settled = b.stage === 'done';
  const saved = b.rolls ? b.rolls.filter((r) => r >= b.armour).length : 0;
  const evadeDice = b.evade ? b.evade.rolls.slice(0, Math.max(0, b.hits - saved)) : [];
  const evaded = b.evade ? evadeDice.filter((r) => r >= b.evade!.value).length : 0;
  const o = b.outcome;
  return (
    <div className="combat-tray side-players inline tt-battle" role="region" aria-label="Hits on the AI">
      <Side name="Your attack" role="YOU" faction={you} />
      <div className="ct-pools">
        <div className="ct-step">
          <div className="ct-pool done owner-you pool-attack">
            <div className="ct-pool-head"><b>Hits</b><span>from the table</span></div>
            <div className="ct-count">{b.hits}{b.per > 1 ? ` × ${b.per} dmg` : ''}</div>
          </div>
        </div>
        {b.rolls && (
          <div className="ct-step">
            <span className="ct-arrow">▸</span>
            <div className={`ct-pool ${settled ? 'done' : 'active'} owner-ai pool-armour`}>
              <div className="ct-pool-head"><b>Armour</b><span>{b.rolls.length} {b.rolls.length === 1 ? 'die' : 'dice'} · {b.armour}+</span></div>
              <div className={`ct-dice ${b.rolls.length > 14 ? 'many' : ''}`}>
                {b.rolls.map((f, i) => (
                  <span key={`${b.key}-${i}`} className={`ct-die ${f >= b.armour ? 'ok' : 'no'} ${f === 6 ? 'six' : ''} ${settled ? 'settled' : ''}`} style={{ '--d': `${(i * 37) % 420}ms` } as CSSProperties}>
                    <DieTumble className="t" faction={aiFaction} i={i} />
                    <DieFace className="f" faction={aiFaction} value={f} />
                  </span>
                ))}
              </div>
              {settled && <div className="ct-result">{saved} saved</div>}
            </div>
          </div>
        )}
        {b.evade && evadeDice.length > 0 && (
          <div className="ct-step">
            <span className="ct-arrow">▸</span>
            <div className={`ct-pool ${settled ? 'done' : 'active'} owner-ai pool-evade`}>
              <div className="ct-pool-head"><b>Evade</b><span>{evadeDice.length} {evadeDice.length === 1 ? 'die' : 'dice'} · {b.evade.value}+ · {b.evade.reason}</span></div>
              <div className={`ct-dice ${evadeDice.length > 14 ? 'many' : ''}`}>
                {evadeDice.map((f, i) => (
                  <span key={`${b.key}-e${i}`} className={`ct-die ${f >= b.evade!.value ? 'ok' : 'no'} ${f === 6 ? 'six' : ''} ${settled ? 'settled' : ''}`} style={{ '--d': `${(i * 37 + 200) % 420}ms` } as CSSProperties}>
                    <DieTumble className="t" faction={aiFaction} i={i} />
                    <DieFace className="f" faction={aiFaction} value={f} />
                  </span>
                ))}
              </div>
              {settled && <div className="ct-result">{evaded} evaded</div>}
            </div>
          </div>
        )}
        <div className="ct-step">
          <span className="ct-arrow">▸</span>
          <div className={`ct-pool ${o ? 'active' : 'hidden'} pool-damage`}>
            <div className="ct-pool-head"><b>Damage</b></div>
            {o ? (
              <div className={`ct-damage tone-${o.destroyed || o.removed ? 'kill' : o.damage ? 'hurt' : 'safe'}`}>
                <span className="ct-big">{o.damage}</span>
                <span>{o.destroyed ? 'DESTROYED' : o.removed ? `${o.removed} model${o.removed === 1 ? '' : 's'} removed` : o.damage ? 'damage' : 'no damage'}</span>
              </div>
            ) : <div className="ct-count muted">…</div>}
          </div>
        </div>
      </div>
      <Side name={u.label} role="AI" faction={aiFaction} right />
      <div className="ct-command">
        {settled ? (
          <>
            <span className="ct-command-head">Resolved</span>
            <button type="button" className="ct-btn primary big" onClick={() => useBattle.setState({ b: null })}>Continue <kbd>␣</kbd></button>
          </>
        ) : <span className="ct-command-head muted">Rolling saves…</span>}
      </div>
    </div>
  );
}

/** Supply on the table against this round's pool, as a small bar. `used` null: not tracked (your side). */
function SupplyMeter({ label, used, pool, side }: { label: string; used: number | null; pool: number; side: 'red' | 'blue' }) {
  const inf = pool === Infinity;
  const title = used === null ? `${label}: ${inf ? 'unlimited' : pool} Supply this round. Your models are tracked on the table only.` : `${label}: ${used} Supply on the table of ${inf ? 'unlimited' : pool} this round${inf ? '' : `, ${Math.max(0, pool - used)} free`}`;
  return (
    <span className={`tt-supply ${side}`} title={title}>
      {label} <b>{used === null ? '' : `${used}/`}{inf ? '∞' : pool}</b>
      {used !== null && !inf && <span className="tt-supply-bar"><span style={{ width: `${Math.min(100, (100 * used) / Math.max(1, pool))}%` }} /></span>}
      <span className="small muted">Supply</span>
    </span>
  );
}
