import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { create } from 'zustand';
import type { GameState } from '@engine/types/game';
import type { Command } from '@engine/director/reducer';
import type { Faction } from '@engine/types/units';
import { useUi } from '@tt/store/uiStore';
import { useGame } from '@tt/store/gameStore';
import { Stepper } from '../components/Basics';
import { DieFace, DieTumble } from '../components/DiceRoll';
import { buildPools, chargeAckId, commandFor, facesFromCount, planAttack, planCharge, resultItem, saveOptions, type CombatItem, type Pool, type PoolId } from './combatPools';
import { StepIcon } from '../tabletop/StepIcon';
import { factionPhoto, modelPhoto } from '@data/modelPhotos';

/** Whether the tray is open and what its main button does, so the command card can mirror it. */
/** The fight in words, for the turn line while the tray is open: who hits whom, and what it waits on now. */
export interface TrayHeadline { side: 'ai' | 'players'; tag: string; title: string }
export const useTray = create<{ open: boolean; label: string; canCancel: boolean; headline: TrayHeadline | null }>(() => ({ open: false, label: '', canCancel: false, headline: null }));
let trayHandler: ((k: 'primary' | 'cancel') => void) | null = null;
export const trayAction = (k: 'primary' | 'cancel') => trayHandler?.(k);

const d6 = () => 1 + Math.floor(Math.random() * 6);
const BEFORE_SEND: PoolId[] = ['attack', 'surge', 'charge', 'impact', 'armour', 'evade'];
/** How long a pool's dice take to land and be read before the next pool. */
const landMs = (p: Pool) => (p.faces?.length ? 900 + Math.min(p.faces.length, 24) * 35 : p.dice > 0 ? 700 : 250);
const lastEventId = (g: GameState) => (g.events?.length ? g.events[g.events.length - 1]!.id : 0);

/**
 * The Combat Tray: every attack and charge, yours or the AI's, plays out in one band above the console as a row of
 * dice pools. Dice land in a pool, the ones that made it move on to the next, and whoever owns a step rolls it
 * (or enters the count from the table). Results the AI waits on are acknowledged when the tray is continued.
 */
export function CombatTray({ g, dispatch, pendingEvent, style, className = '' }: { g: GameState; dispatch: (c: Command) => void; pendingEvent: string | null; style?: CSSProperties; className?: string }) {
  const ui = useUi();
  const items = useRef<CombatItem[]>([]);
  const seen = useRef(lastEventId(g));
  const thrown = useRef(new Set<string>());
  const [, bump] = useState(0);
  const refresh = () => bump((n) => n + 1);
  const [pos, setPos] = useState<{ key: string; i: number }>({ key: '', i: 0 });
  const [entering, setEntering] = useState<{ key: string; pool: PoolId; a: number; b: number; field?: 'a' | 'b' } | null>(null);
  /** Digits typed so far, so "1" then "2" quickly makes 12. */
  const typed = useRef<{ text: string; at: number; field: 'a' | 'b' } | null>(null);

  // Results from the rules engine: attach to the combat they finish, or queue a new one (AI attacks and charges).
  useEffect(() => {
    const last = lastEventId(g);
    if (last < seen.current) {
      // Undo: forget results that no longer happened.
      seen.current = last;
      items.current = items.current.filter((i) => i.plan && !i.sent);
      refresh();
      return;
    }
    const fresh = (g.events ?? []).filter((e) => e.id > seen.current);
    seen.current = last;
    if (!fresh.length) return;
    for (const ev of fresh) {
      if (ev.kind === 'charge') {
        const mine = items.current.find((i) => i.plan?.kind === 'charge' && i.sent && !i.charge && i.attackerId === ev.unitId);
        if (mine) mine.charge = ev;
        else if (ev.side === 'ai') items.current.push(resultItem(g, { charge: ev }));
      } else if (ev.kind === 'attack') {
        const a = ev.attack;
        const saves = items.current.find((i) => i.pending?.id === a.id);
        const mine = items.current.find((i) => i.plan?.kind === 'attack' && i.sent && !i.attack && i.attackerId === a.attacker.unitId);
        const charge = a.phase === 'Impact' ? items.current.find((i) => i.charge && !i.attack && !i.pending && i.attackerId === a.attacker.unitId) : undefined;
        const into = saves ?? mine ?? charge;
        if (into) {
          into.attack = a;
          if (!into.ackIds.includes(a.id)) into.ackIds.push(a.id);
        } else if (a.attacker.side === 'ai') items.current.push(resultItem(g, { attack: a }));
      }
    }
    refresh();
  }, [g.events]); // eslint-disable-line react-hooks/exhaustive-deps

  // An AI attack waiting for your saves.
  const pendingId = g.pendingSaves?.attack.id;
  useEffect(() => {
    const ps = g.pendingSaves?.attack;
    // An attack the engine is no longer waiting on, whose result never reached the tray, can never be finished:
    // it would sit at the head of the queue with nothing to roll and block every combat behind it.
    const before = items.current.length;
    items.current = items.current.filter((i) => !i.pending || !!i.attack || i.pending.id === ps?.id);
    const dropped = items.current.length !== before;
    if (!ps) {
      if (dropped) refresh();
      return;
    }
    if (items.current.some((i) => i.pending?.id === ps.id || i.attack?.id === ps.id)) {
      if (dropped) refresh();
      return;
    }
    const charge = ps.phase === 'Impact' ? items.current.find((i) => i.charge && !i.attack && !i.pending && i.attackerId === ps.attacker.unitId) : undefined;
    if (charge) {
      charge.pending = ps;
      charge.ackIds.push(ps.id);
    } else items.current.push(resultItem(g, { pending: ps }));
    refresh();
  }, [pendingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Your picked attack or charge opens the tray; cancelling it (before rolling) closes it.
  const pa = ui.pendingAttack;
  const pc = ui.pendingCharge;
  useEffect(() => {
    let changed = false;
    items.current = items.current.filter((i) => {
      if (!i.plan || i.sent) return true;
      const p = i.plan;
      const still = p.kind === 'attack' ? pa && pa.unitId === p.unitId && pa.targetId === p.targetId && pa.weaponId === p.weaponId : pc && pc.unitId === p.unitId && pc.targetId === p.targetId;
      if (!still) changed = true;
      return !!still;
    });
    const has = (unitId: string, kind: string) => items.current.some((i) => i.plan?.kind === kind && !i.sent && i.plan.unitId === unitId);
    const add = pa && !has(pa.unitId, 'attack') ? planAttack(g, pa) : pc && !has(pc.unitId, 'charge') ? planCharge(g, pc) : null;
    if (add) { items.current.push(add); changed = true; }
    else if ((pa || pc) && !items.current.some((i) => i.plan && !i.sent)) {
      // Not a legal attack or charge any more.
      ui.setPendingAttack(null);
      ui.setPendingCharge(null);
    }
    if (changed) refresh();
  }, [pa, pc]); // eslint-disable-line react-hooks/exhaustive-deps

  // A result the AI is waiting on but the tray never saw (e.g. the game was reloaded): show it settled, so it can
  // be continued past — whatever step the game is at. Without it the screen says "Waiting…" with nothing to press.
  useEffect(() => {
    if (!pendingEvent || items.current.some((i) => i.ackIds.includes(pendingEvent))) return;
    const la = g.lastAttack;
    const lc = g.lastCharge;
    if (la && la.id === pendingEvent) items.current.push({ ...resultItem(g, { attack: la }), settled: true });
    else if (lc && chargeAckId({ ...lc, round: lc.round ?? g.round }) === pendingEvent) items.current.push({ ...resultItem(g, { charge: { ...lc, id: 0, round: lc.round ?? g.round, kind: 'charge' } }), settled: true });
    else return;
    refresh();
  }, [pendingEvent, g.step.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whatever became of the item (closed, dropped), while the engine waits on your saves there is one for them:
  // without it the game would sit at the saves step with nothing on screen to finish it.
  if (g.pendingSaves && !items.current.some((i) => i.pending?.id === g.pendingSaves!.attack.id || i.attack?.id === g.pendingSaves!.attack.id)) {
    items.current.push(resultItem(g, { pending: g.pendingSaves.attack }));
  }
  const cur = items.current[0] ?? null;
  const pools = cur ? buildPools(g, cur) : [];
  // Pools can shrink as dice land (an Evade step that turns out not to be needed): the cursor never points past
  // the last one, or every button would vanish with nothing left to press.
  const cursor = cur ? Math.min(Math.max(0, pools.length - 1), pos.key === cur.key ? pos.i : cur.settled ? pools.length - 1 : 0) : 0;
  const pool = pools[cursor];
  const lastIdx = pools.length - 1;
  const done = !!cur && cursor >= lastIdx && !!pool && pool.faces !== null && !(cur.plan && !cur.sent) && !(cur.pending && !cur.attack);
  const awaitingYou = !!pool && pool.faces === null && pool.owner === 'you' && (!cur?.sent || pool.id === 'armour' || pool.id === 'evade');
  // The other side's Armour or Evade, not rolled yet: a step of its own (you press to roll it; video mode rolls it after a pause).
  const awaitingOther = !!cur && !!pool && pool.faces === null && pool.owner === 'ai' && (pool.id === 'armour' || pool.id === 'evade') && !cur.attack && ((!!cur.plan && !cur.sent) || !!cur.pending);
  // After dice land, the result stays readable before the next step.
  const hold = 900;
  const sig = pools.map((p) => (p.faces === null ? 'n' : p.faces.length)).join(',');
  const setCursor = (i: number) => cur && setPos({ key: cur.key, i });

  // Dice land in the current pool, then move on to the next one.
  useEffect(() => {
    if (!cur || !pool || pool.faces === null) return;
    const id = `${cur.key}:${pool.id}`;
    if (pool.faces.length && !cur.settled && !thrown.current.has(id)) thrown.current.add(id);
    if (cursor >= lastIdx) return;
    const t = setTimeout(() => setCursor(cursor + 1), landMs(pool) + (pool.faces.length || pool.dice > 0 ? hold : 0));
    return () => clearTimeout(t);
  }, [cur?.key, cursor, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Once your dice have landed, the rules engine resolves the rest.
  useEffect(() => {
    if (!cur) return;
    const cmd = commandFor(g, cur);
    if (!cmd) return;
    const lastMine = pools.reduce((m, p, i) => (BEFORE_SEND.includes(p.id) && p.faces !== null ? i : m), -1);
    if (cursor < lastMine) return;
    const send = () => {
      if (cur.sent || items.current[0] !== cur) return;
      const before = useGame.getState().game?.eventSeq;
      cur.sent = true;
      dispatch(cmd);
      if (cmd.t === 'playerAttack') ui.setPendingAttack(null);
      if (cmd.t === 'playerCharge') ui.setPendingCharge(null);
      // Refused (the toast says why): drop it.
      if (useGame.getState().game?.eventSeq === before) items.current = items.current.filter((i) => i !== cur);
      refresh();
    };
    // Send as the sequence moves on from the last dice (the damage step), or once they land when nothing follows.
    if (cursor > lastMine) { send(); return; }
    if (lastMine < lastIdx && pools[lastMine + 1]!.id === 'damage') return;
    const t = setTimeout(send, landMs(pools[lastMine]!));
    return () => clearTimeout(t);
  }, [cur?.key, cursor, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const roll = (p: Pool) => {
    if (!cur) return;
    const faces = p.id === 'surge' ? [1 + Math.floor(Math.random() * (p.maxValue ?? 3))] : Array.from({ length: p.dice }, d6);
    setInput(p, faces);
  };
  const setInput = (p: Pool, faces: number[]) => {
    if (!cur) return;
    const inp = cur.input;
    if (p.id === 'surge') inp.surge = faces[0] ?? 0;
    else if (p.id === 'attack' || p.id === 'charge' || p.id === 'impact' || p.id === 'armour' || p.id === 'evade') inp[p.id] = faces;
    setEntering(null);
    refresh();
  };
  const close = () => {
    if (!cur) return;
    items.current = items.current.slice(1);
    for (const id of cur.ackIds) { ui.ack(id); ui.dismiss(id); }
    setEntering(null);
    refresh();
  };
  const cancel = () => {
    if (!cur?.plan || cur.sent || cur.input.attack || cur.input.charge) return;
    if (cur.plan.kind === 'attack') ui.setPendingAttack(null);
    else ui.setPendingCharge(null);
  };
  const enter = entering && cur && entering.key === cur.key && pool && entering.pool === pool.id ? entering : null;
  const applyEntry = () => {
    if (!enter || !pool) return;
    if (pool.entry === 'value') setInput(pool, [enter.a]);
    else setInput(pool, facesFromCount(pool.dice, enter.a, Math.min(enter.a, enter.b), pool.need ?? 4));
  };
  const openEntry = () => pool && cur && setEntering({ key: cur.key, pool: pool.id, a: pool.entry === 'value' ? 1 : 0, b: 0 });
  const primary = () => {
    if (enter) applyEntry();
    else if ((awaitingYou || awaitingOther) && pool) roll(pool);
    else if (done) close();
  };
  const otherLabel = pool ? `Roll ${pool.roller === 'defender' ? cur?.meta.defender : cur?.meta.attacker} ${pool.id === 'armour' ? 'saves' : 'evade'}` : '';
  const primaryLabel = enter ? 'Apply' : awaitingYou && pool ? `Roll ${pool.label.toLowerCase()}` : awaitingOther ? otherLabel : done ? 'Continue' : '';

  // Nothing left to roll, nothing to send and nowhere for the cursor to go: the result this combat is waiting on
  // is never coming (an attack resolved while the tray was elsewhere, a save the engine has moved past). Rather
  // than sit there blocking every combat behind it, it closes itself.
  useEffect(() => {
    if (!cur || done || awaitingYou || awaitingOther || enter) return;
    if (cur.plan && !cur.sent && !cur.input.attack && !cur.input.charge) return; // still yours to roll or cancel
    if (commandFor(g, cur)) return; // a command is on its way
    // Your saves the engine is still waiting on are never closed away: if the cursor has wandered off the step
    // that needs dice, it goes back to it.
    if (cur.pending && !cur.attack && g.pendingSaves?.attack.id === cur.pending.id) {
      const open = pools.findIndex((p) => p.faces === null && p.id !== 'damage');
      if (open >= 0 && open !== cursor) setCursor(open);
      return;
    }
    // Parked on a step whose dice nobody will roll, or sent with a result that never came: either way this
    // combat cannot finish, so it is closed instead of holding up the ones behind it.
    const parked = !!pool && pool.faces === null;
    const orphaned = !!cur.sent && !cur.attack && !cur.charge;
    if (!parked && !orphaned && cursor < lastIdx) return;
    const t = setTimeout(() => { if (items.current[0] === cur) close(); }, 4000);
    return () => clearTimeout(t);
  }, [cur?.key, cursor, sig, done, awaitingYou, awaitingOther, !!enter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keys: Space rolls / applies / continues, E enters a table roll, Esc backs out.
  trayHandler = (k) => (k === 'primary' ? primary() : enter ? setEntering(null) : cancel());
  useEffect(() => {
    if (!cur) return;
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === ' ' || (e.key === 'Enter' && enter)) { e.preventDefault(); trayAction('primary'); }
      else if (e.key.toUpperCase() === 'E' && awaitingYou && !enter) { e.preventDefault(); openEntry(); }
      else if (/^[0-9]$/.test(e.key) && pool && cur && (enter || awaitingYou)) {
        // Type what the table rolled: the entry opens on the first digit.
        e.preventDefault();
        const field = enter?.field ?? 'a';
        const now = Date.now();
        const t = typed.current;
        const text = (t && t.field === field && now - t.at < 900 ? t.text : '') + e.key;
        typed.current = { text, at: now, field };
        const base = enter ?? { key: cur.key, pool: pool.id, a: pool.entry === 'value' ? 1 : 0, b: 0 };
        const max = field === 'b' ? base.a : pool.entry === 'value' ? (pool.maxValue ?? 6) : pool.dice;
        const v = Math.min(max, Number(text));
        setEntering(field === 'b' ? { ...base, b: v, field } : { ...base, a: v, b: Math.min(base.b, v), field });
      }
      else if (e.key === 'Backspace' && enter) {
        e.preventDefault();
        typed.current = null;
        setEntering(enter.field === 'b' ? { ...enter, b: 0 } : { ...enter, a: pool?.entry === 'value' ? 1 : 0, b: 0 });
      }
      else if (e.key === 'Tab' && enter && pool?.sixes) { e.preventDefault(); typed.current = null; setEntering({ ...enter, field: enter.field === 'b' ? 'a' : 'b' }); }
      else if (e.key === 'Escape') { e.preventDefault(); trayAction('cancel'); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });
  const canCancel = !!cur?.plan && !cur.sent && !cur.input.attack && !cur.input.charge;
  const headline: TrayHeadline | null = (() => {
    if (!cur) return null;
    const m = cur.meta;
    const charge = !!cur.charge || cur.plan?.kind === 'charge';
    const ai = cur.side === 'ai';
    const who = ai ? `${m.attacker} ${charge ? 'charged' : 'attacked'} your ${m.defender}` : `Your ${m.attacker} ${charge ? 'charged' : 'attacked'} ${m.defender}`;
    const a = cur.attack;
    const result = a ? (a.destroyed ? `${m.defender} destroyed` : a.damage > 0 ? `${a.damage} damage${a.removed ? `, ${a.removed} model${a.removed === 1 ? '' : 's'} lost` : ''}` : a.hits > 0 ? 'every hit saved' : 'no hits') : cur.charge && !cur.charge.success ? 'the charge fell short' : '';
    const now = awaitingYou && pool && (pool.id === 'armour' || pool.id === 'evade') ? `roll your ${pool.id === 'armour' ? 'Armour' : 'Evade'}` : done && result ? result : '';
    return { side: cur.side, tag: `${ai ? 'AI' : 'Your'} ${charge ? 'charge' : 'attack'}`, title: now ? `${who}: ${now}.` : `${who}.` };
  })();
  useEffect(() => {
    const s = useTray.getState();
    if (s.open !== !!cur || s.label !== primaryLabel || s.canCancel !== canCancel || s.headline?.title !== headline?.title) useTray.setState({ open: !!cur, label: primaryLabel, canCancel, headline });
  });
  useEffect(() => () => { useTray.setState({ open: false, label: '', canCancel: false, headline: null }); trayHandler = null; }, []);

  if (!cur) return null;
  const saveOpts = cur.pending && !cur.attack && pool?.id === 'armour' && pool.faces === null ? saveOptions(g, cur.pending) : null;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className={`combat-tray side-${cur.side} ${className}`} style={style} role="region" aria-label="Combat">
      <Side name={cur.meta.attacker} role={cur.side === 'ai' ? 'AI' : 'YOU'} faction={cur.meta.attackerFaction} talkKey={cur.key} weapon={cur.meta.weapon} defId={defOf(g, cur.side === 'ai' ? 'ai' : 'players', cur.attackerId)} />
      <div className="ct-pools">
        {pools.map((p, i) => {
          const state = i < cursor ? 'done' : i === cursor ? (p.faces === null ? 'waiting' : 'active') : 'hidden';
          const faction = p.roller === 'attacker' ? cur.meta.attackerFaction : cur.meta.defenderFaction;
          return (
            <div key={p.id} className="ct-step">
              {i > 0 && <span className={`ct-arrow ${state === 'hidden' ? 'dim' : ''}`}><StepIcon mark="next" /></span>}
              <div className={`ct-pool ${state} owner-${p.owner} pool-${p.id}`}>
                <div className="ct-pool-head">
                  <b>{p.label}</b>
                  <span>{p.id === 'damage' || (p.faces === null && p.dice === 0) ? '' : p.id === 'charge' ? (p.dice === 2 ? '2D6' : 'D6') : p.id === 'surge' ? '' : `${p.dice} ${p.dice === 1 ? 'die' : 'dice'}`}{p.need !== null && p.dice > 0 ? ` · ${p.need}+` : ''}</span>
                </div>
                {state !== 'hidden' && <PoolBody pool={p} faction={faction} settled={state === 'done' || !!cur.settled} />}
                {p.note && state !== 'hidden' && <div className="ct-note">{p.note}</div>}
                {i === cursor && saveOpts && (saveOpts.boosts.length > 0 || saveOpts.reactions.length > 0) && (
                  <div className="ct-chips">
                    {saveOpts.boosts.map((b) => <button key={b.cardId} type="button" className={`ct-chip ${cur.input.boosts.includes(b.cardId) ? 'on' : ''}`} title={`${b.card}: ${b.text}`} onClick={() => { cur.input.boosts = toggle(cur.input.boosts, b.cardId); refresh(); }}>{b.name}</button>)}
                    {saveOpts.reactions.map((r) => <button key={r.key} type="button" className={`ct-chip ${cur.input.reactions.includes(r.key) ? 'on' : ''}`} title={`${r.unit}: reduce damage by ${r.reduce}${r.cost ? `, costs ${r.cost}` : ''}`} onClick={() => { cur.input.reactions = toggle(cur.input.reactions, r.key); refresh(); }}>{r.name}</button>)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <Side name={cur.meta.defender} role={cur.side === 'ai' ? 'YOU' : 'AI'} faction={cur.meta.defenderFaction} talkKey="" right defId={defOf(g, cur.side === 'ai' ? 'players' : 'ai', cur.defenderId)} />
      <div className="ct-command">
        {enter && pool ? (
          <div className="ct-entry">
            <span className="ct-command-head">{pool.label} from the table</span>
            {pool.entry === 'value' ? (
              <label>{pool.id === 'charge' && pool.dice === 2 ? 'Highest die' : 'Rolled'} <Stepper value={enter.a} onChange={(v) => setEntering({ ...enter, a: v })} min={1} max={pool.maxValue ?? 6} /></label>
            ) : (
              <>
                <label className={enter.field !== 'b' ? 'typing' : ''}>Made {pool.need}+ <Stepper value={enter.a} onChange={(v) => setEntering({ ...enter, a: v, b: Math.min(enter.b, v) })} min={0} max={pool.dice} /></label>
                {pool.sixes && <label className={enter.field === 'b' ? 'typing' : ''}>…of them 6s <Stepper value={enter.b} onChange={(v) => setEntering({ ...enter, b: v })} min={0} max={enter.a} /></label>}
                <span className="small muted">Type the number{pool.sixes ? ', Tab for 6s' : ''}</span>
              </>
            )}
            <button type="button" className="ct-btn primary" onClick={applyEntry}>Apply <kbd>␣</kbd></button>
            <button type="button" className="ct-btn ghost" onClick={() => setEntering(null)}>Back <kbd>Esc</kbd></button>
          </div>
        ) : awaitingYou && pool ? (
          <>
            <span className="ct-command-head">Your {pool.label.toLowerCase()} roll</span>
            <button type="button" className="ct-btn primary big" onClick={() => roll(pool)}>Roll <kbd>␣</kbd></button>
            {<button type="button" className="ct-btn" onClick={openEntry} title="Enter what you rolled on the table">From table <kbd>E</kbd></button>}
            {canCancel && <button type="button" className="ct-btn ghost" onClick={cancel}>Cancel <kbd>Esc</kbd></button>}
          </>
        ) : awaitingOther && pool ? (
          <>
            <span className="ct-command-head">{pool.roller === 'defender' ? cur.meta.defender : cur.meta.attacker} {pool.id === 'armour' ? `save on ${pool.need}+` : `evade on ${pool.need}+`}</span>
            <button type="button" className="ct-btn primary big" onClick={() => roll(pool)}>{pool.id === 'armour' ? 'Roll saves' : 'Roll evade'} <kbd>␣</kbd></button>
          </>
        ) : done ? (
          <>
            <span className="ct-command-head">{cur.side === 'ai' ? 'AI attack resolved' : 'Resolved'}</span>
            <button type="button" className="ct-btn primary big" onClick={close}>Continue <kbd>␣</kbd></button>
          </>
        ) : <span className="ct-command-head muted">Rolling…</span>}
      </div>
    </div>
  );
}

/**
 * One side of a roll: the painted model of the Unit (from its official card), or, for your side when the Unit is
 * not named, your army's hero; the race's die only when there is neither.
 */
/** The unit definition behind a side's unit id, when the app knows the Unit. */
const defOf = (g: GameState, side: 'ai' | 'players', id: string): string | null =>
  (side === 'ai' ? g.army.units.find((u) => u.id === id)?.defId : g.playerUnits.find((p) => p.id === id)?.defId) ?? null;

export function Side({ name, role, faction, weapon, defId = null, right = false }: { name: string; role: string; faction: Faction; talkKey?: string; weapon?: string; /** The Unit whose model stands for this side. */ defId?: string | null; right?: boolean }) {
  const photo = (defId ? modelPhoto(defId) : null) ?? (role === 'YOU' ? factionPhoto(faction) : null);
  return (
    <div className={`ct-side ${right ? 'right' : ''} ${role === 'AI' ? 'ai' : 'you'}`}>
      {photo
        ? <div className="ct-portrait ct-photo" aria-hidden="true"><img src={photo} alt="" draggable={false} /></div>
        : <div className="ct-portrait ct-emblem" aria-hidden="true"><DieFace faction={faction} value={6} /></div>}
      <div className="ct-side-name">
        <span className="ct-role">{role}</span>
        <b>{name}</b>
        {weapon && !right && <span className="ct-weapon">{weapon}</span>}
      </div>
    </div>
  );
}

function PoolBody({ pool: p, faction, settled }: { pool: Pool; faction: Faction; settled: boolean }) {
  if (p.id === 'damage') {
    if (!p.outcome) return <div className="ct-count muted">…</div>;
    const o = p.outcome;
    return (
      <div className={`ct-damage tone-${o.tone}`}>
        <span className="ct-big">{o.damage}</span>
        <span>{o.destroyed ? 'DESTROYED' : o.removed ? `${o.removed} model${o.removed === 1 ? '' : 's'} removed` : o.damage ? 'damage' : 'no damage'}</span>
      </div>
    );
  }
  if (p.faces === null) return <div className="ct-dice empty">{p.owner === 'you' ? 'Your roll' : p.dice > 0 ? 'Their roll' : '…'}</div>;
  const highest = p.id === 'charge' && p.faces.length > 1 ? Math.max(...p.faces) : null;
  const result = p.id === 'charge' ? (p.bar ? null : '') : p.id === 'surge' ? (p.faces.length ? `rolled ${p.faces[0]}` : '') : p.successes === null ? '' : p.id === 'attack' || p.id === 'impact' ? `${p.successes} hit${p.successes === 1 ? '' : 's'}` : p.id === 'armour' ? `${p.successes} saved` : `${p.successes} evaded`;
  return (
    <>
      {p.faces.length > 0 ? (
        <div className={`ct-dice ${p.faces.length > 14 ? 'many' : ''}`}>
          {p.faces.map((f, i) => {
            const ok = p.need === null ? (highest === null || f === highest ? 'plain' : 'no') : f >= p.need ? 'ok' : 'no';
            const gold = p.need !== null && f === 6 ? 'six' : '';
            return (
              <span key={i} className={`ct-die ${ok} ${gold} ${settled ? 'settled' : ''}`} style={{ '--d': `${(i * 37) % 420}ms` } as CSSProperties}>
                <DieTumble className="t" faction={faction} i={i} />
                <DieFace className="f" faction={faction} value={f} />
              </span>
            );
          })}
        </div>
      ) : p.dice > 0 && p.successes !== null ? <div className="ct-count">from the table</div> : null}
      {result && <div className="ct-result">{result}</div>}
      {p.bar && (
        <div className={`ct-bar ${p.bar.reach >= p.bar.needed ? 'ok' : 'short'}`}>
          <div className="ct-bar-fill" style={{ width: `${Math.min(100, (p.bar.reach / Math.max(p.bar.reach, p.bar.needed, 1)) * 100)}%` }} />
          <div className="ct-bar-mark" style={{ left: `${Math.min(100, (p.bar.needed / Math.max(p.bar.reach, p.bar.needed, 1)) * 100)}%` }} />
          <span className="ct-bar-text">{p.bar.reach}" of {p.bar.needed.toFixed(1)}" · {p.bar.reach >= p.bar.needed ? 'connects' : 'falls short'}</span>
        </div>
      )}
    </>
  );
}
