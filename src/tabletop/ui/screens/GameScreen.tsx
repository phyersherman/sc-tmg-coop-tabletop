import { useEffect, useState, type ReactNode } from 'react';
import { TableSetup } from '../hud/TableSetup';
import { TabletopLayout, TabletopTurn } from '../tabletop/TabletopLayout';
import { ActionCardView } from '../tabletop/ActionCardView';
import { useGame } from '@tt/store/gameStore';
import { useUi, type UiState } from '@tt/store/uiStore';
import { useSettings } from '@tt/store/settingsStore';
import { modeById } from '@engine/missions/index';
import { DIFFICULTIES } from '@engine/difficulty';
import { currentCard } from '@engine/ai/orderDeck';
import { aiOrderKey, availableNow, onTable, poolNow } from '@engine/director/selectors';
import { chargeRollText, focusText, targetText } from '@engine/ai/decide';
import { tenacityOffer } from '@engine/abilities/index';
import type { AiOrder, GameState, MarkerControl, ScoringAnswers, ScoringPrompt, Step } from '@engine/types/game';
import type { Command } from '@engine/director/reducer';
import { Btn, Lines, Panel, Stepper, Toggle } from '../components/Basics';
import { DiceBlock } from '../components/DiceBlock';
import { Roster } from '../components/Roster';
import { unitById } from '@data/index';
import { MUTATORS } from '@engine/mutators/index';
import { hasSense, suggestedMarkerControl } from '@engine/sense/query';
import { playerUnitSupply } from '@engine/sense/playerUnits';
import { damageHelpers } from '@engine/player/rules';
import { PlayerDice } from '../components/PlayerDice';
import { CombatTray, useTray } from '../hud/CombatTray';
import { AttackFeed } from '../components/AttackFeed';
import { PhaseTrack } from '../hud/PhaseTrack';
import { Stakes } from '../hud/Stakes';
import { EndCard, VpRace } from './battleEnd';
import { passWithReminder } from '../hud/usePass';
import { PlayerUnitCard, AiUnitCard } from '../components/UnitCard';
import { AbilityDraftCard, PendingAbilityCard } from '../components/ActionCards';
import { CardsPanel } from '../components/CardsPanel';
import { pendingEndOfRound } from '@engine/abilities/index';
import { actableUnits, playerAvailable, playerCanAct } from '@engine/player/rules';
import { unitsWithActions } from '@engine/player/actions';

import { unitById as defOf } from '@data/index';
import { ChargeRoll } from '../components/DiceRoll';

const VERB: Record<AiOrder['type'], string> = { deploy: 'Deploy', move: 'Advance', run: 'Run', disengage: 'Fall back', ranged: 'Open fire', charge: 'Charge', closeCombat: 'Melee', hold: 'Hold', pass: 'Pass', special: 'Special' };

/**
 * Before a fight's dice: how many of the unit's models strike. By the rulebook (Part 8, Close Combat, Declare
 * Attackers) that is the Fighting Rank, every model within 1" of an enemy model, and the Supporting Rank, every
 * model in base-to-base contact with a model of its own unit that is in the Fighting Rank. IMPACT counts the same models.
 */
function FightersAsk({ max, impact, onRoll }: { max: number; impact: boolean; onRoll: (n: number) => void }) {
  const [n, setN] = useState(max);
  return (
    <div className="stack fighters-ask">
      <p className="ask">How many of its models {impact ? 'roll IMPACT' : 'fight'}?</p>
      <p className="small">Count the <b>Fighting Rank</b>, every model within 1" of an enemy model, and the <b>Supporting Rank</b>, every model touching a Fighting Rank model of its own Unit. The rest do not roll.</p>
      <div className="row">
        <Stepper value={n} onChange={setN} min={1} max={max} />
        <Btn variant="primary" size="lg" onClick={() => onRoll(n)}>Roll for {n} model{n === 1 ? '' : 's'}</Btn>
      </div>
    </div>
  );
}

function CommandCard({ order, g, dispatch }: { order: AiOrder; g: GameState; dispatch: (c: Command) => void }) {
  const showRolls = useSettings((s) => s.appRollsAiDice);
  const [enemySupply, setEnemySupply] = useState(1);
  const [details, setDetails] = useState(false);
  const [stage, setStage] = useState<'ask' | 'roll'>('ask');
  const [rollWhat, setRollWhat] = useState<'batches' | 'impact'>('batches');
  /** A fight: how many of its models strike (Fighting and Supporting ranks), as the table counts them. */
  const [fighters, setFighters] = useState<number | null>(null);
  const [askFighters, setAskFighters] = useState(false);
  const u = g.army.units.find((x) => x.id === order.unitId)!;
  const def = unitById(u.defId);
  const camLine = order.lines.find((l) => l.startsWith('Camera:'));
  const sub = camLine ? camLine.replace(/^Camera:\s*/, '') : order.headingText ? `toward ${order.headingText}` : order.lines[0] ?? '';
  const hasDice = order.batches.length > 0 || !!order.impact;
  const needsAsk = hasDice && stage === 'ask';
  const report = (id: string) => dispatch({ t: 'orderReport', report: id, enemySupply });
  const hasReport = (id: string) => order.reports.some((r) => r.id === id);
  const main = order.batches[0];
  const range = main ? (typeof main.range === 'number' ? main.range + (main.rangeMod ?? 0) : 0) : 0;
  return (
    <Panel className="cmd cmd-ai">
      <div className="cmd-head">
        <h2 style={{ margin: 0 }}>{u.label}{order.card ? '' : `: ${VERB[order.type]}`}</h2>
      </div>
      {order.card
        ? <ActionCardView g={g} card={order.card} unit={u} full reminders={details} entry={order.type === 'deploy' ? order.lines.find((l) => /^(Enter from|Set the whole unit down|BURROW AMBUSH|Camera: enter)/.test(l)) : undefined} />
        : <>
            <p className="cmd-sub">{sub}</p>
            <p className="small muted" style={{ margin: '0 0 8px' }}>{def.name} · {u.models} models{order.focus ? ` · target: ${focusText(order.focus)}` : ''}</p>
          </>}

      {needsAsk && order.type === 'ranged' && (
        <div className="stack">
          <p className="ask">{camLine ? 'Roll the attack.' : `Fire at ${targetText(order.focus)} in Line of Sight within ${range}" of any of its models. Otherwise, do not fire.`}</p>
          {!camLine && main?.longRange ? <p className="ask">{`LONG RANGE: if no enemy Unit is that close, fire at one within ${main.longRange + (main.rangeMod ?? 0)}" instead, at -1 to hit.`}</p> : null}
          <div className="row">
            <Btn variant="primary" size="lg" className="tt-primary" onClick={() => { setRollWhat('batches'); setStage('roll'); }}>{camLine ? 'Roll' : 'Open fire'}</Btn>
            {hasReport('noTarget') && <Btn size="lg" onClick={() => report('noTarget')}>{order.reports.find((r) => r.id === 'noTarget')?.label ?? 'No target'}</Btn>}
          </div>
        </div>
      )}
      {needsAsk && !askFighters && order.type === 'charge' && (
        <div className="stack">
          <p className="ask">{camLine ? 'Roll the AI\'s charge distance on the table.' : `Charge ${targetText(order.focus, true)} within ${order.charge?.max ?? '?'}" of the Leading Model. Otherwise, do not charge.`}</p>
          {/* The charge die goes the way the attack dice go: rolled by the app when it rolls the AI's dice, by the table
              otherwise. */}
          {!camLine && order.charge && (showRolls
            ? <ChargeRoll key={order.unitId} faction={def.faction} dice={order.charge.dice} speed={order.charge.speed} bonus={order.charge.min - 1 - order.charge.speed} />
            : <p className="ask">Roll the AI's charge on the table. {chargeRollText(order.charge.dice, order.charge.speed, order.charge.min - 1 - order.charge.speed)}</p>)}
          <div className="row">
            {order.impact ? <Btn variant="primary" size="lg" className="tt-primary" onClick={() => { setRollWhat('impact'); setAskFighters(true); }}>Charge made, roll IMPACT</Btn> : <Btn variant="primary" size="lg" className="tt-primary" onClick={() => report('charged')}>Charge made</Btn>}
            {hasReport('chargeFailed') && <Btn size="lg" onClick={() => report('chargeFailed')}>Charge failed</Btn>}
            {hasReport('attacked') && order.batches.length > 0 && <Btn size="lg" onClick={() => { setRollWhat('batches'); setStage('roll'); }}>No charge, fire instead</Btn>}
            {hasReport('noTarget') && <Btn size="lg" onClick={() => report('noTarget')}>No target, it ran</Btn>}
          </div>
        </div>
      )}
      {needsAsk && askFighters && (
        <FightersAsk max={u.models} impact={rollWhat === 'impact'} onRoll={(n) => { setFighters(n); setAskFighters(false); setStage('roll'); }} />
      )}
      {needsAsk && !askFighters && order.type === 'closeCombat' && (
        <div className="stack">
          <p className="ask">Close Ranks. Move its Leading Model up to 3" toward the enemy Unit it is Engaged with, then close the rest in around it.</p>
          <div className="row"><Btn variant="primary" size="lg" className="tt-primary" onClick={() => { setRollWhat('batches'); setAskFighters(true); }}>Ranks closed</Btn></div>
        </div>
      )}
      {needsAsk && order.type !== 'ranged' && order.type !== 'charge' && order.type !== 'closeCombat' && (
        <div className="row"><Btn variant="primary" size="lg" className="tt-primary" onClick={() => setStage('roll')}>Roll</Btn></div>
      )}

      {stage === 'roll' && rollWhat === 'batches' && order.batches.map((b, i) => <DiceBlock key={i} batch={b} showRolls={showRolls} faction={def.faction} models={order.type === 'closeCombat' ? fighters ?? undefined : undefined} />)}
      {stage === 'roll' && rollWhat === 'impact' && order.impact && <DiceBlock batch={order.impact} showRolls={showRolls} title="IMPACT" faction={def.faction} models={fighters ?? undefined} />}


      {(!hasDice || stage === 'roll') && (
        <div className="row">
          {stage === 'roll' && rollWhat === 'impact' && (
            <>
              <span className="row small"><span className="muted">Enemy Supply Engaged</span><Stepper value={enemySupply} onChange={setEnemySupply} min={0} max={12} /></span>
              <Btn size="lg" variant="primary" className="tt-primary" onClick={() => report('charged')}>Charge resolved</Btn>
            </>
          )}
          {stage === 'roll' && rollWhat === 'batches' && order.type === 'ranged' && <Btn size="lg" variant="primary" className="tt-primary" onClick={() => report('attacked')}>Attack resolved</Btn>}
          {stage === 'roll' && rollWhat === 'batches' && order.type === 'charge' && <Btn size="lg" variant="primary" className="tt-primary" onClick={() => report('attacked')}>Attack resolved</Btn>}
          {stage === 'roll' && rollWhat === 'batches' && order.type === 'closeCombat' && <Btn size="lg" variant="primary" className="tt-primary" onClick={() => report('done')}>Combat resolved</Btn>}
          {!hasDice && order.reports.map((r) => <Btn key={r.id} size="lg" variant={r.id === 'done' || r.id === 'reached' || r.id === 'charged' ? 'primary' : ''} className={r.id === 'done' || r.id === 'reached' || r.id === 'charged' ? 'tt-primary' : ''} onClick={() => report(r.id)}>{r.label}</Btn>)}
          {stage === 'roll' && <Btn size="sm" variant="ghost" onClick={() => setStage('ask')}>Back</Btn>}
        </div>
      )}
      {/* The rules behind the order, for the operator: after the one action, never between the steps and it. */}
      <div className="row cmd-more">
        <Btn size="sm" variant="ghost" onClick={() => setDetails((v) => !v)}>{details ? 'Hide the full rules' : 'Full rules for this order'}</Btn>
      </div>
      {details && (
        <ol className="order-lines">
          {order.lines.map((l, i) => <li key={i} className={l.startsWith('Otherwise') ? 'otherwise' : ''}>{l}</li>)}
        </ol>
      )}
    </Panel>
  );
}

function QuickDamage({ g, dispatch }: { g: GameState; dispatch: (c: Command) => void }) {
  const [target, setTarget] = useState<{ side: 'ai' | 'players'; id: string } | null>(null);
  const [dmg, setDmg] = useState(2);
  const ai = onTable(g);
  const mine = g.playerUnits.filter((p) => !p.destroyed);
  return (
    <div className="quick">
      <div className="row" style={{ gap: 6 }}>
        <span className="small muted">Report damage to:</span>
        {ai.map((u) => <Btn key={u.id} size="sm" variant={target?.id === u.id ? 'danger' : ''} onClick={() => setTarget({ side: 'ai', id: u.id })}>{u.label} <span className="muted">{u.models}</span></Btn>)}
        {mine.map((p) => <Btn key={p.id} size="sm" variant={target?.id === p.id ? 'primary' : ''} onClick={() => setTarget({ side: 'players', id: p.id })}>{p.name} <span className="muted">{p.models}</span></Btn>)}
      </div>
      {target && (
        <div className="row" style={{ marginTop: 8 }}>
          <Stepper value={dmg} onChange={setDmg} min={1} max={60} />
          <Btn variant={target.side === 'ai' ? 'danger' : 'primary'} onClick={() => { dispatch(target.side === 'ai' ? { t: 'damage', unitId: target.id, dmg } : { t: 'playerDamage', unitId: target.id, dmg }); setTarget(null); }}>Apply {dmg} damage</Btn>
          {target.side === 'ai' && <Btn size="sm" onClick={() => { dispatch({ t: 'setModels', unitId: target.id, models: (ai.find((u) => u.id === target.id)?.models ?? 1) - 1 }); setTarget(null); }}>−1 model</Btn>}
          {target.side === 'players' && <Btn size="sm" variant="ghost" onClick={() => { dispatch({ t: 'setPlayerDestroyed', unitId: target.id, destroyed: true }); setTarget(null); }}>Destroyed</Btn>}
        </div>
      )}
    </div>
  );
}

/**
 * A step that needs you: over the battlefield as the same framed pop-up as the round and end-of-round banners
 * (`popup`), or as a panel in the side column.
 */
function StepFrame({ title, popup, actions, children }: { title: string; popup?: boolean; actions: ReactNode; children: ReactNode }) {
  if (popup) {
    return (
      <div className="banner">
        <h2>{title}</h2>
        <div className="banner-body">{children}</div>
        <div className="row banner-actions">{actions}</div>
      </div>
    );
  }
  return <Panel title={title} accent>{children}<div style={{ marginTop: 12 }}>{actions}</div></Panel>;
}

/**
 * Damage suffered outside an attack (Stimpack's own NON-LETHAL DAMAGE): the Medics and Queens near enough to
 * reduce it get their Reaction offered, exactly as they would against an enemy's shot.
 */
function DamageReactionCard({ g, dispatch, popup }: { g: GameState; dispatch: (c: Command) => void; popup?: boolean }) {
  const pr = g.pendingReaction!;
  const pu = g.playerUnits.find((p) => p.id === pr.unitId);
  const opts = pu ? damageHelpers(g, pu) : [];
  return (
    <StepFrame
      title={`${pu?.name ?? 'Your unit'} suffers ${pr.amount} damage`}
      popup={popup}
      actions={<Btn variant="ghost" onClick={() => dispatch({ t: 'damageReaction' })}>Take the damage</Btn>}
    >
      <p className="small">{pr.source} deals {pr.amount} damage to {pu?.name ?? 'the unit'}. A Reaction within 4" can reduce it before it is allocated.</p>
      <div className="stack" style={{ gap: 6 }}>
        {opts.map((o) => (
          <Btn key={o.key} variant="primary" onClick={() => dispatch({ t: 'damageReaction', key: o.key })}>
            {o.name} — {o.unit} · reduces {Math.min(o.reduce, pr.amount)}{o.cost ? ` · ${o.cost}` : ''}
          </Btn>
        ))}
        {!opts.length && <p className="small muted">Nothing is in range any more.</p>}
      </div>
    </StepFrame>
  );
}

function Checklist({ g, dispatch, popup }: { g: GameState; dispatch: (c: Command) => void; popup?: boolean }) {
  const units = onTable(g);
  return (
    <StepFrame title="Combat: who is Engaged?" popup={popup} actions={<Btn variant="primary" size="lg" onClick={() => dispatch({ t: 'checklistDone' })}>Fight</Btn>}>
      <p className="small">Mark each AI Unit with a model within 1" of one of yours, and set the total Supply it is fighting.</p>
      {units.map((u) => (
        <div key={u.id} className="row" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
          <b style={{ minWidth: 140 }}>{u.label}</b>
          <Toggle on={u.engaged} onChange={(v) => dispatch({ t: 'setEngaged', unitId: u.id, engaged: v, enemySupply: u.engagedEnemySupply || 1 })}>Engaged</Toggle>
          {u.engaged && <Stepper value={u.engagedEnemySupply} onChange={(v) => dispatch({ t: 'setEngaged', unitId: u.id, engaged: true, enemySupply: v })} min={0} max={12} />}
        </div>
      ))}
      {units.length === 0 && <p className="muted">No AI Units on the table.</p>}
    </StepFrame>
  );
}

function Scoring({ g, prompts, dispatch, popup }: { g: GameState; prompts: ScoringPrompt[]; dispatch: (c: Command) => void; popup?: boolean }) {
  const [markers, setMarkers] = useState<Record<number, MarkerControl>>(() => (hasSense(g) ? suggestedMarkerControl(g) : (Object.fromEntries(g.markers.map((m) => [m.id, 'none'])) as Record<number, MarkerControl>)));
  const [nums, setNums] = useState<Record<string, number>>(() => Object.fromEntries(prompts.filter((p) => p.kind === 'number').map((p) => [p.id, p.id === 'playerSupplyLost' && g.playerUnits.length ? (g.playerSupplyLostThisRound ?? 0) : Number(p.defaultValue ?? 0)])));
  const [bools, setBools] = useState<Record<string, boolean>>(() => Object.fromEntries(prompts.filter((p) => p.kind === 'yesno').map((p) => [p.id, Boolean(p.defaultValue ?? false)])));
  const lostSuggested = g.playerUnits.length ? undefined : null;
  const submit = () => {
    const extra: ScoringAnswers['extra'] = { ...nums, ...bools };
    dispatch({ t: 'scoring', answers: { markers, playerSupplyLost: nums['playerSupplyLost'] ?? 0, extra } });
  };
  return (
    <StepFrame title="Scoring and Cleanup" popup={popup} actions={<Btn variant="primary" size="lg" onClick={submit}>Score the round</Btn>}>
      {prompts.map((p) => {
        if (p.kind === 'markers')
          return (
            <div key={p.id} style={{ marginBottom: 12 }}>
              <p className="small">{p.text}</p>
              {g.markers.filter((m) => m.active).map((m) => (
                <div key={m.id} className="row" style={{ padding: '4px 0' }}>
                  <b style={{ minWidth: 110 }}>Marker {m.id} <span className="small muted">({m.controlledBy ?? 'neutral'}{m.locked ? ', locked' : ''})</span></b>
                  {(['players', 'ai', 'contested', 'none'] as MarkerControl[]).map((c) => (
                    <Btn key={c} size="sm" variant={markers[m.id] === c ? 'primary' : ''} onClick={() => setMarkers({ ...markers, [m.id]: c })}>{c === 'none' ? 'nobody' : c === 'players' ? 'you' : c}</Btn>
                  ))}
                </div>
              ))}
            </div>
          );
        if (p.kind === 'number')
          return (
            <div key={p.id} className="row" style={{ marginBottom: 10 }}>
              <span className="small" style={{ flex: 1, minWidth: 200 }}>{p.text}{p.id === 'playerSupplyLost' && lostSuggested === undefined ? ' (from the damage your Units took this round)' : ''}</span>
              <Stepper value={nums[p.id] ?? 0} onChange={(v) => setNums({ ...nums, [p.id]: v })} min={p.min ?? 0} max={p.max ?? 99} />
            </div>
          );
        return (
          <div key={p.id} className="row" style={{ marginBottom: 10 }}>
            <span className="small" style={{ flex: 1, minWidth: 200 }}>{p.text}</span>
            <Toggle on={bools[p.id] ?? false} onChange={(v) => setBools({ ...bools, [p.id]: v })}>{bools[p.id] ? 'Yes' : 'No'}</Toggle>
          </div>
        );
      })}
      <p className="small muted">AI Supply destroyed this round: {g.aiSupplyLostThisRound}.{hasSense(g) ? ' Marker control is filled in from the camera.' : ''}{g.playerUnits.length ? ` Your Supply on the table now: ${g.playerUnits.reduce((a, u) => a + playerUnitSupply(u), 0)}.` : ''}</p>
    </StepFrame>
  );
}

/** Banner shown over the map for informational steps; continues automatically after a countdown. */
const CHANGEABLE = new Set(['playerMove', 'playerDeploy', 'playerHold', 'playersPass', 'playerBonusMove', 'playerPlace', 'endActivation']);

/** Turn change: confirm (or take back) your action before the AI moves. Waits for units to finish walking. */
/** "Marines moved", "You passed"…: your last action, for the confirm step before the AI acts. */
function gateWhat(g: GameState, cmd: Command | undefined): string {
  const unitName = cmd && 'unitId' in cmd ? g.playerUnits.find((p) => p.id === (cmd as { unitId: string }).unitId)?.name : undefined;
  return !cmd ? '' : cmd.t === 'playerMove' ? `${unitName} moved` : cmd.t === 'playerDeploy' ? `${unitName} deployed` : cmd.t === 'playerHold' ? `${unitName} holds` : cmd.t === 'playersPass' ? 'You passed' : cmd.t === 'playerAttack' ? `${unitName} attacked` : cmd.t === 'playerCharge' ? `${unitName} charged` : cmd.t === 'playerPlace' ? `${unitName} was placed` : cmd.t === 'playerBonusMove' ? `${unitName} made a free move` : cmd.t === 'endActivation' ? 'Your unit finished its activation' : '';
}


/**
 * Tabletop: the AI's order is shown at once after your action, so the way to change your mind is here, under
 * the order, for as long as the AI has not acted on it.
 */
function TakeBack({ g }: { g: GameState }) {
  const last = useGame((s) => s.lastCommand);
  const undoLen = useGame((s) => s.undo.length);
  const undoLast = useGame((s) => s.undoLast);
  const revealOrder = useUi((s) => s.revealOrder);
  const cmd = last?.cmd;
  if (!cmd || !CHANGEABLE.has(cmd.t) || undoLen === 0) return null;
  return (
    <p className="tt-takeback">
      <span className="muted">{gateWhat(g, cmd)}.</span>{' '}
      <button type="button" className="tt-link" onClick={() => { revealOrder(null); undoLast(); }}>Take it back</button>
    </p>
  );
}

/** One line for an attack: who hit whom, and what it cost. */
function attackLine(g: GameState, a: GameState['attackLog'][number]): string {
  const dmg = a.pendingSaves ? 'saves pending' : a.destroyed ? 'destroyed' : a.removed ? `${a.removed} model${a.removed === 1 ? '' : 's'} removed` : a.damage ? `${a.damage} damage` : 'no damage';
  return `${a.attacker.label} → ${a.defender.label} (${a.weapon}): ${a.hits} hit${a.hits === 1 ? '' : 's'}, ${a.saved} saved — ${dmg}`;
}

/** End of round: what happened, so you can check it against the table before moving on. */
/** Victory points after each round, both sides, as a small line chart. */
export { VpRace } from './battleEnd';

function RoundReview({ g }: { g: GameState }) {
  const attacks = g.attackLog.filter((a) => !a.pendingSaves || a.hits > 0);
  const destroyed = attacks.filter((a) => a.destroyed);
  const events = g.log.filter((e) => e.round === g.round && e.side !== 'system' && /charge|deploy|destroyed|arriv|warp|disengag/i.test(e.text)).slice(-6);
  if (!attacks.length && !events.length) return <div className="round-review"><Stakes g={g} /><VpRace g={g} /><p className="small muted round-review-empty">No attacks this round.</p></div>;
  return (
    <div className="round-review">
      {/* Where the mission stands after this Scoring phase: red when the next one can lose the battle. */}
      <Stakes g={g} />
      <VpRace g={g} />
      {destroyed.length > 0 && <p className="small"><b>Destroyed:</b> {destroyed.map((a) => a.defender.label).join(', ')}</p>}
      {attacks.length > 0 && (
        <>
          <h4>Attacks</h4>
          <ul>{attacks.map((a) => <li key={a.id} className={a.attacker.side === 'ai' ? 'ai' : 'you'}>{attackLine(g, a)}</li>)}</ul>
        </>
      )}
      {events.length > 0 && (
        <>
          <h4>Other events</h4>
          <ul>{events.map((e, i) => <li key={i} className={e.side === 'ai' ? 'ai' : 'you'}>{e.text}</li>)}</ul>
        </>
      )}
    </div>
  );
}

/** End of the Round abilities waiting for a choice: move Adepts to their Shade, deploy at a drop point. */
function EndOfRoundChoices({ g, dispatch }: { g: GameState; dispatch: (c: Command) => void }) {
  const pending = pendingEndOfRound(g);
  if (!pending.length) return null;
  return (
    <div className="eor-choices">
      <h4>End of the Round abilities</h4>
      {pending.map((p) => (
        <div key={p.token.id} className="eor-choice">
          {p.kind === 'shade' ? (
            <>
              <span><b>Psionic Transfer:</b> move {p.owner!.name} to their Shade?</span>
              <div className="row" style={{ gap: 6 }}>
                <Btn size="sm" variant="primary" onClick={() => dispatch({ t: 'endOfRoundEffect', tokenId: p.token.id, accept: true })}>Shift to Shade</Btn>
                <Btn size="sm" variant="ghost" onClick={() => dispatch({ t: 'endOfRoundEffect', tokenId: p.token.id, accept: false })}>Stay</Btn>
              </div>
            </>
          ) : (
            <>
              <span><b>{p.token.label}:</b> deploy a Ground Unit from Reserves at the drop point?{p.candidates.every((c) => playerUnitSupply(c) > playerAvailable(g, c.owner ?? 0)) && ` None fits. Only ${playerAvailable(g, p.candidates[0]!.owner ?? 0)} Supply is free, and the pool grows only when the next round starts.`}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {p.candidates.map((c) => { const need = playerUnitSupply(c); const avail = playerAvailable(g, c.owner ?? 0); const fits = need <= avail; return <Btn key={c.id} size="sm" variant="primary" disabled={!fits} title={fits ? `${need} Supply` : `Needs ${need} Supply, ${avail} available`} onClick={() => dispatch({ t: 'endOfRoundEffect', tokenId: p.token.id, accept: true, unitId: c.id })}>Deploy {c.name} ({need}){fits ? '' : ' · not enough Supply'}</Btn>; })}
                <Btn size="sm" variant="ghost" onClick={() => dispatch({ t: 'endOfRoundEffect', tokenId: p.token.id, accept: false })}>Skip</Btn>
              </div>
            </>
          )}
        </div>
      ))}
      <p className="small muted" style={{ margin: '4px 0 0' }}>Continue without choosing to skip these.</p>
    </div>
  );
}

function Banner({ step, g, dispatch }: { step: Extract<Step, { kind: 'ROUND_START' | 'PHASE_START' | 'ROUND_END' | 'GAME_OVER' }>; g: GameState; dispatch: (c: Command) => void }) {
  const go = useUi((s) => s.go);
  const tenacity = tenacityOffer(g);
  // The end of the battle has its own card: the outcome first, then what fell, then the way to play it again.
  if (step.kind === 'GAME_OVER') return <EndCard g={g} result={step.result} />;
  const title = step.kind === 'ROUND_START' ? `Round ${g.round}` : step.kind === 'PHASE_START' ? `${g.phase} phase` : `End of Round ${g.round}: Scoring and Cleanup`;
  return (
    <div className={`banner ${step.kind === 'PHASE_START' ? 'banner-phase' : ''}`}>
      <h2>{title}</h2>
      <div className="banner-body">
        {step.kind === 'ROUND_END' && <EndOfRoundChoices g={g} dispatch={dispatch} />}
        <div className="banner-lines"><Lines lines={step.lines} /></div>
        {tenacity && (
          <div className="banner-offer">
            <b>Terran Tenacity</b>
            <span>The AI has the First Player Marker. Once per game, the players may claim it now and go first this phase. No one can take it back until the phase ends. This exhausts your Faction card.</span>
            <div className="row">
              <Btn variant="primary" onClick={() => { dispatch({ t: 'useBoost', cardId: tenacity.id, boost: 'Terran Tenacity' }); dispatch({ t: 'continue' }); }}>Claim the marker</Btn>
              <Btn variant="ghost" onClick={() => dispatch({ t: 'continue' })}>Not now</Btn>
            </div>
          </div>
        )}
        {step.kind === 'ROUND_END' && <RoundReview g={g} />}
      </div>
      <div className="row banner-actions">
        {!tenacity && <Btn variant="primary" size="lg" className="tt-primary" onClick={() => dispatch({ t: 'continue' })}>Continue <kbd>Space</kbd></Btn>}
        {step.kind === 'ROUND_END' && <span className="small muted">Continue when the table is ready.</span>}
        {(step.kind === 'ROUND_START' || step.kind === 'PHASE_START') && (
          <Btn size="sm" variant="ghost" className="banner-skip" title="Stop announcing rounds and phases. The phase track at the top still shows each change. Turn them back on in Settings." onClick={() => { useSettings.getState().set({ skipPhaseBanners: true }); dispatch({ t: 'continue' }); }}>Skip these from now on</Btn>
        )}
      </div>
    </div>
  );
}

export function GameScreen() {
  const g = useGame((s) => s.game);
  const dispatch = useGame((s) => s.dispatch);
  const { go, briefingSeen, setBriefingSeen, tableSet, setTableSet } = useUi();
  const ui = useUi();
  const acked = useUi((s) => s.acked);
  const ack = useUi((s) => s.ack);
  const revealed = useUi((s) => s.revealed);
  const dismissed = useUi((s) => s.dismissed);
  const dismiss = useUi((s) => s.dismiss);
  const showToast = useUi((s) => s.showToast);
  const selectedUnitId = useUi((s) => s.selectedUnitId);
  // Skipped announcements go by at once; the phase track shows the change instead.
  const skipBanners = useSettings((s) => s.skipPhaseBanners);
  const announceKey = g ? `${g.round}:${g.phase}:${g.step.kind}` : '';
  useEffect(() => {
    if (!g || !skipBanners) return;
    if (g.step.kind !== 'ROUND_START' && g.step.kind !== 'PHASE_START') return;
    // Terran Tenacity is on offer: the phase waits for your answer.
    if (tenacityOffer(g)) return;
    // Round 1 opens with the table setup and the briefing: those still wait for you.
    if (g.round === 1 && g.step.kind === 'ROUND_START' && !briefingSeen) return;
    const t = setTimeout(() => dispatch({ t: 'continue' }), 150);
    return () => clearTimeout(t);
  }, [announceKey, skipBanners, briefingSeen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Say when the Combat phase was skipped.
  const phaseKeyId = g ? `${g.round}:${g.phase}` : '';
  useEffect(() => {
    if (!g || g.round === 0) return;
    if (g.phase === 'scoring' && g.log.some((e) => e.round === g.round && e.text.includes('Combat phase is skipped'))) showToast('Combat skipped: no Units were Engaged.', 'info');
  }, [phaseKeyId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The latest AI attack or charge you have not acknowledged: the next AI action waits for your Continue.
  const la = g?.lastAttack && g.attackLog.some((a) => a.id === g.lastAttack!.id) ? g.lastAttack : null;
  const aiAttackPending = la && la.attacker.side === 'ai' && !acked[la.id] && !dismissed[la.id] ? la.id : null;
  // Keyed by the round the charge was rolled in: a charge you have already seen must not come back as news at
  // the start of the next round.
  const chargeKey = g?.lastCharge && g.lastCharge.side === 'ai' ? `charge:${g.lastCharge.round ?? g.round}:${g.lastCharge.unitId}:${g.lastCharge.reach}:${g.lastCharge.targetId}` : null;
  const aiChargePending = chargeKey && !acked[chargeKey] && !dismissed[chargeKey] ? chargeKey : null;
  const pendingEvent = aiAttackPending ?? aiChargePending;
  // Turn change: a new AI action stays hidden until it is revealed.
  const revealedOrder = useUi((s) => s.revealedOrder);
  const revealOrder = useUi((s) => s.revealOrder);
  const orderKey = g ? aiOrderKey(g) : null;
  const aiGated = !!orderKey && revealedOrder !== orderKey;
  // A unit that is still active after its action stays selected so its abilities are on the command card.
  const activeUnitId = g?.activeUnitId ?? null;
  useEffect(() => {
    if (activeUnitId && ui.selectedUnitId !== activeUnitId) ui.select(activeUnitId);
  }, [activeUnitId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The AI's order is the card: nothing stands in front of it once the last result has been continued past.
  // Your own action can still be taken back from the card.
  useEffect(() => {
    if (!aiGated || pendingEvent) return;
    const t = setTimeout(() => revealOrder(orderKey), 120);
    return () => clearTimeout(t);
  }, [aiGated, pendingEvent, orderKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Picking one of your units puts away a finished attack report so the unit's actions are in view.
  useEffect(() => {
    const a = g?.lastAttack;
    // Only while it is your turn; during the AI's turn the report is what the AI is waiting on.
    if (!selectedUnitId || !a || g?.step.kind !== 'PLAYERS_TURN' || a.attacker.side === 'ai' && !revealed[a.id]) return;
    if (!dismissed[a.id]) {
      ack(a.id);
      dismiss(a.id);
    }
  }, [selectedUnitId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!g) return <Panel title="No game"><Btn onClick={() => go('home')}>Home</Btn></Panel>;
  const mode = modeById(g.config.modeId);
  const step = g.step;
  // Round 1 opens at the table: set it up first (Part 9.3), then the briefing.
  const showSetup = !tableSet && !briefingSeen && g.round === 1 && step.kind === 'ROUND_START';
  const showBriefing = !showSetup && !briefingSeen && g.round === 1 && step.kind === 'ROUND_START';
  const bannerStep = !showBriefing && !showSetup && ((!skipBanners && (step.kind === 'ROUND_START' || step.kind === 'PHASE_START')) || (step.kind === 'PHASE_START' && !!tenacityOffer(g)) || step.kind === 'ROUND_END' || step.kind === 'GAME_OVER') ? step : null;
  const setup = showSetup ? <TableSetup g={g} onDone={() => setTableSet(true)} /> : null;
  const briefing = showBriefing ? (
    <Panel title="Briefing" accent>
      <Lines lines={mode.briefing(g)} />
      <Btn variant="primary" size="lg" onClick={() => setBriefingSeen(true)}>Begin Round 1</Btn>
    </Panel>
  ) : null;
  // The table map and one card for what happens now.
  const now = g.pendingReaction ? <DamageReactionCard g={g} dispatch={dispatch} />
    : briefing ? briefing
    : bannerStep ? <Banner step={bannerStep} g={g} dispatch={dispatch} />
    : step.kind === 'AI_ORDER' && aiGated ? (pendingEvent ? null : <div className="tt-card tt-wait"><h2>AI turn</h2><p>Reading the table<span className="tt-dots" aria-hidden="true" /></p></div>)
    : step.kind === 'AI_ORDER' ? <>
        <CommandCard key={g.log.length} order={step.order} g={g} dispatch={dispatch} />
        <TakeBack g={g} />
      </>
    : step.kind === 'COMBAT_CHECKLIST' ? <Checklist g={g} dispatch={dispatch} />
    : step.kind === 'SCORING_FORM' ? <Scoring key={g.round} g={g} prompts={step.prompts} dispatch={dispatch} />
    : step.kind === 'PLAYERS_TURN' && !pendingEvent ? <TabletopTurn g={g} dispatch={dispatch} />
    // Your saves: the tray rolls them, and the card under it is the way past if the tray ever does not.
    : step.kind === 'AI_SAVES' ? <TabletopTurn g={g} dispatch={dispatch} />
    : null;
  return <TabletopLayout g={g} dispatch={dispatch} now={now} overlays={setup} pendingEvent={pendingEvent} />;
}
