import type { GameState } from '@engine/types/game';
import type { AiUnitInstance } from '@engine/types/army';
import { unitById } from '@data/index';
import { aiDebuff, speedModFor } from '@engine/ai/decide';
import { faceCard } from '@engine/ai/actionDecks';
import { speedFor } from '@engine/units/speed';
import { currentSupply } from '@engine/units/supply';
import { ActionCardView } from './ActionCardView';
import { REWARDS, sideState } from '@engine/missions/sideMarkers';
import { StepIcon } from './StepIcon';
import { DieFace } from '../components/DiceRoll';
import { modelPhoto } from '@data/modelPhotos';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

const STAT_DEBUFFS = ['speed', 'hit', 'armour', 'evade'] as const;

/**
 * The enemy across the table: one card per AI unit that is on it, the way its miniatures stand in front of you.
 * Each shows the unit's numbers, what has happened to it, and the action card its type follows this phase.
 * Picking a card opens its damage entry. The Unit acting now is not here: its card is up on the stage (StagedUnit).
 */
export function EnemyBoard({ g, selected, lastId = null, stagedId = null, onPick, onEngaged, extra }: { g: GameState; selected: string | null; /** The Unit whose order the table carried out last: it stays lit, not dimmed. */ lastId?: string | null; /** The Unit acting now: its card is on the stage, not in the grid. */ stagedId?: string | null; onPick: (id: string) => void; /** Mark a Unit Engaged, or not, from its card. */ onEngaged?: (id: string, on: boolean) => void; /** What opens on a Unit's own card: its damage entry. */ extra?: (unitId: string) => ReactNode }) {
  const onTable = g.army.units.filter((u) => u.models > 0 && u.location === 'table' && u.id !== stagedId);
  const reserves = g.army.units.filter((u) => u.location === 'reserves' && u.models > 0 && u.id !== stagedId);
  // Every card as tall as the tallest one not opened for damage, kept so as photos load and orders come and go.
  const grid = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const fit = () => {
      el.style.setProperty('--eb-h', '0px');
      const tiles = [...el.querySelectorAll<HTMLElement>('.eb-tile:not(.selected)')];
      const h = Math.max(0, ...tiles.map((t) => t.offsetHeight));
      el.style.setProperty('--eb-h', `${h}px`);
    };
    fit();
    const ro = new ResizeObserver(() => fit());
    for (const t of el.querySelectorAll('.eb-tile')) for (const c of t.children) ro.observe(c);
    return () => ro.disconnect();
  });
  return (
    <section className="eb" aria-label="Enemy units">
      <div className="eb-head">
        <h2>Enemy</h2>
        {!g.config.options.hideAiRoster && reserves.length > 0 && <span className="eb-reserves">In Reserves: {reserves.map((u) => u.label).join(', ')}</span>}
        {onTable.length > 0 && <span className="eb-hint">Pick a Unit to enter damage, models lost and DEBUFFs.</span>}
      </div>
      {onTable.length === 0 && !stagedId && <p className="eb-empty">No enemy Units on the table yet. They arrive in the Movement phase.</p>}
      <div className="eb-grid" ref={grid}>
        {onTable.map((u) => <EnemyTile key={u.id} g={g} u={u} last={u.id === lastId} selected={u.id === selected} onPick={() => onPick(u.id)} onEngaged={onEngaged ? (on) => onEngaged(u.id, on) : undefined} extra={extra?.(u.id)} />)}
      </div>
    </section>
  );
}

function EnemyTile({ g, u, last, selected, onPick, onEngaged, extra }: { g: GameState; u: AiUnitInstance; last: boolean; selected: boolean; onPick: () => void; onEngaged?: (on: boolean) => void; extra?: ReactNode }) {
  const card = faceCard(g, u);
  const phase = g.phase === 'movement' || g.phase === 'assault' || g.phase === 'combat' ? g.phase : null;
  const done = phase ? u.activated[phase] : false;
  const ref = useRef<HTMLElement>(null);
  useFlight(u.id, ref, 'tile');
  return (
    <article ref={ref} className={`eb-tile ${last ? 'last' : ''} ${selected ? 'selected' : ''} ${done ? 'done' : ''}`}>
      <UnitFace g={g} u={u} selected={selected} onPick={onPick} onEngaged={onEngaged} />
      {card ? <ActionCardView g={g} card={card} unit={u} /> : phase === 'combat' ? <p className="eb-nocard">{u.engaged ? 'Engaged: it fights.' : 'Not Engaged: no fight.'}</p> : <p className="eb-nocard eb-cardback">No card yet this phase</p>}
      {extra && <div className="eb-extra">{extra}</div>}
    </article>
  );
}

/**
 * The Unit acting now, its whole card up on the stage at the top of the table and across its width: the card's face,
 * then its order (the action card and what it asks), then the dice tray. One card, one place: nothing of the order
 * or its dice is drawn anywhere else. It flies up from its slot in the grid when it is activated, and back after.
 */
export function StagedUnit({ g, unitId, selected, onPick, onEngaged, extra, children }: { g: GameState; unitId: string; selected: boolean; onPick: () => void; onEngaged?: (on: boolean) => void; extra?: ReactNode; /** The order: CommandCard's order and tray. */ children: ReactNode }) {
  const u = g.army.units.find((x) => x.id === unitId);
  const ref = useRef<HTMLElement>(null);
  useFlight(unitId, ref, 'stage');
  if (!u) return null;
  return (
    <article ref={ref} className={`eb-tile tt-staged ${selected ? 'selected' : ''}`} aria-label={`${u.label} acts`}>
      <UnitFace g={g} u={u} selected={selected} onPick={onPick} onEngaged={onEngaged} wide />
      {children}
      {extra && <div className="eb-extra">{extra}</div>}
    </article>
  );
}

/** A Unit card's face: its painted model, name, models left, numbers, what is marked on it, and its quick switches. */
function UnitFace({ g, u, selected, onPick, onEngaged, wide = false }: { g: GameState; u: AiUnitInstance; selected: boolean; onPick: () => void; onEngaged?: (on: boolean) => void; wide?: boolean }) {
  const def = unitById(u.defId);
  const phase = g.phase === 'movement' || g.phase === 'assault' || g.phase === 'combat' ? g.phase : null;
  const done = phase ? u.activated[phase] : false;
  const debuffs = STAT_DEBUFFS.filter((s) => aiDebuff(u, s) > 0);
  const speed = def.stats.speed ? speedFor(def, u.models) + speedModFor(g, { ...u, cardMods: undefined }) : null;
  const src = modelPhoto(def.id);
  return (
    <div className={`eb-face-row ${wide ? 'wide' : ''}`}>
      {/* The top of the card opens its damage entry. A role, not a <button>: it holds a stat list and blocks. */}
      <div role="button" tabIndex={0} className="eb-tile-top" onClick={onPick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }} aria-pressed={selected} aria-label={`${u.label}: enter damage, models lost and DEBUFFs`} data-unit={u.id}>
        {/* The card's face: the painted model from its official unit card, or its race's die for a mission object. */}
        <div className={`eb-face ${src ? 'photo' : ''}`} aria-hidden="true">{src ? <img src={src} alt="" loading="lazy" draggable={false} /> : <DieFace faction={def.faction} value={6} />}</div>
        <div className="eb-name">
          <b>{u.label}</b>
          <span>{def.role} · {currentSupply(def, u.models)} Supply</span>
        </div>
        <div className="eb-models" aria-label={`${u.models} of ${u.maxModels} models`}>
          {Array.from({ length: u.maxModels }, (_, i) => <i key={i} className={i < u.models ? 'on' : ''} />)}
        </div>
        <dl className="eb-stats">
          {speed !== null && <div><dt>Speed</dt><dd>{speed}"</dd></div>}
          <div><dt>Armour</dt><dd>{def.stats.armour + aiDebuff(u, 'armour')}+</dd></div>
          {def.stats.evade ? <div><dt>Evade</dt><dd>{def.stats.evade + aiDebuff(u, 'evade')}+</dd></div> : null}
          <div><dt>HP</dt><dd>{def.stats.hp}{def.stats.shields ? `+${def.stats.shields}` : ''}</dd></div>
        </dl>
        <div className="eb-flags">
          {typeof u.special?.sideMarker === 'number' && (() => {
            const o = sideState(g).objects[u.special.sideMarker as number];
            return <span className="eb-flag side" title={o ? `Destroy it and hold the marker in a Scoring phase. Reward: ${REWARDS[o.reward].text}.` : undefined}>{o?.object === 'structure' ? 'Structure' : 'Guard'} · Marker {u.special.sideMarker as number}{o ? ` · ${REWARDS[o.reward].name}` : ''}</span>;
          })()}
          {u.damageMarker > 0 && <span className="eb-flag hurt">{u.damageMarker} damage</span>}
          {(u.statuses ?? []).map((s) => <span key={s} className="eb-flag">{s}</span>)}
          {debuffs.map((s) => <span key={s} className="eb-flag debuff">DEBUFF {s} {aiDebuff(u, s)}</span>)}
          {(u.buffs ?? []).map((b) => <span key={b.name} className="eb-flag buff" title={b.text}><StepIcon mark="buff" className="inline" />{b.name}</span>)}
          {done && <span className="eb-flag muted">Activated</span>}
        </div>
      </div>
      <div className="eb-quick">
        {onEngaged && <button type="button" role="switch" aria-checked={u.engaged} onClick={() => onEngaged(!u.engaged)} title={u.engaged ? 'Engaged. Click when it is no longer Engaged.' : 'Click when it is Engaged in close combat.'}><i aria-hidden="true" />Engaged</button>}
        {!selected && <button type="button" onClick={onPick}>Damage and DEBUFFs</button>}
      </div>
    </div>
  );
}

/*
 * The card's flight between its slot in the grid and the stage. Each side notes where the card stands every time it
 * is drawn; when the card leaves one place for the other, the new one starts drawn where the old one was (same frame,
 * before paint) and glides home. The card itself is only ever rendered in one place.
 */
interface Spot { rect: DOMRect; scroll: number; at: number }
const spots = { tile: new Map<string, Spot>(), stage: new Map<string, Spot>() };
const scroller = () => document.querySelector<HTMLElement>('.tt-map');

function useFlight(id: string, ref: React.RefObject<HTMLElement>, side: 'tile' | 'stage'): void {
  // Arriving: from the other side's last spot.
  useLayoutEffect(() => {
    const el = ref.current;
    const box = scroller();
    if (!el || !box) return;
    const other = side === 'stage' ? spots.tile : spots.stage;
    const from = other.get(id);
    other.delete(id);
    const before = box.scrollTop;
    // The stage is the top of the table: bring it into view at once, so the flight is the only movement.
    if (side === 'stage') box.scrollTop = 0;
    // Only a card that left the other place in this same change flies: never from a slot it left long ago.
    if (!from || !(performance.now() - from.at < 1500)) return;
    // Where the operator last saw it on screen, before the table scrolled up to the stage.
    const fromTop = from.rect.top + from.scroll - before;
    const to = el.getBoundingClientRect();
    const s = from.rect.width / to.width;
    const dx = from.rect.left - to.left;
    const dy = fromTop - to.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.01) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const shown = Math.min(100, (100 * from.rect.height) / s / Math.max(1, to.height));
    el.animate(
      [
        { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${s})`, clipPath: `inset(0 0 ${100 - shown}% 0)` },
        { transformOrigin: 'top left', transform: 'none', clipPath: 'inset(0 0 0% 0)' },
      ],
      { duration: 460, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Where it stands, noted after every draw; the time it left, noted as it goes.
  useLayoutEffect(() => {
    const el = ref.current;
    const box = scroller();
    if (el && box) spots[side].set(id, { rect: el.getBoundingClientRect(), scroll: box.scrollTop, at: Infinity });
  });
  useLayoutEffect(() => () => { const s = spots[side].get(id); if (s) s.at = performance.now(); }, [id, side]);
}
