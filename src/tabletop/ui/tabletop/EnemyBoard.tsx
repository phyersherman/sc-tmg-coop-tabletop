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

const STAT_DEBUFFS = ['speed', 'hit', 'armour', 'evade'] as const;

/**
 * The enemy across the table: one card per AI unit that is on it, the way its miniatures stand in front of you.
 * Each shows the unit's numbers, what has happened to it, and the action card its type follows this phase.
 * Picking a card opens its damage entry.
 */
export function EnemyBoard({ g, selected, lastId = null, onPick }: { g: GameState; selected: string | null; /** The Unit whose order the table carried out last: it stays lit, not dimmed. */ lastId?: string | null; onPick: (id: string) => void }) {
  const onTable = g.army.units.filter((u) => u.location === 'table' && u.models > 0);
  const reserves = g.army.units.filter((u) => u.location === 'reserves' && u.models > 0);
  const activeId = g.step.kind === 'AI_ORDER' ? g.step.order.unitId : null;
  return (
    <section className="eb" aria-label="Enemy units">
      <div className="eb-head">
        <h2>Enemy</h2>
        {!g.config.options.hideAiRoster && reserves.length > 0 && <span className="eb-reserves">In Reserves: {reserves.map((u) => u.label).join(', ')}</span>}
        {onTable.length > 0 && <span className="eb-hint">Pick a Unit to enter the damage it took.</span>}
      </div>
      {onTable.length === 0 && <p className="eb-empty">No enemy Units on the table yet. They arrive in the Movement phase.</p>}
      <div className="eb-grid">
        {onTable.map((u) => <EnemyTile key={u.id} g={g} u={u} active={u.id === activeId} last={u.id === lastId} selected={u.id === selected} onPick={() => onPick(u.id)} />)}
      </div>
    </section>
  );
}

function EnemyTile({ g, u, active, last, selected, onPick }: { g: GameState; u: AiUnitInstance; active: boolean; last: boolean; selected: boolean; onPick: () => void }) {
  const def = unitById(u.defId);
  const card = faceCard(g, u);
  const phase = g.phase === 'movement' || g.phase === 'assault' || g.phase === 'combat' ? g.phase : null;
  const done = phase ? u.activated[phase] : false;
  const debuffs = STAT_DEBUFFS.filter((s) => aiDebuff(u, s) > 0);
  const speed = def.stats.speed ? speedFor(def, u.models) + speedModFor(g, { ...u, cardMods: undefined }) : null;
  return (
    <article className={`eb-tile ${active ? 'active' : ''} ${last ? 'last' : ''} ${selected ? 'selected' : ''} ${done ? 'done' : ''}`}>
      {/* The top of the card opens its damage entry. A role, not a <button>: it holds a stat list and blocks. */}
      <div role="button" tabIndex={0} className="eb-tile-top" onClick={onPick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }} aria-pressed={selected} aria-label={`${u.label}: enter damage, models lost and DEBUFFs`} data-unit={u.id}>
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
          {u.engaged && <span className="eb-flag engaged">Engaged</span>}
          {(u.statuses ?? []).map((s) => <span key={s} className="eb-flag">{s}</span>)}
          {debuffs.map((s) => <span key={s} className="eb-flag debuff">DEBUFF {s} {aiDebuff(u, s)}</span>)}
          {(u.buffs ?? []).map((b) => <span key={b.name} className="eb-flag buff" title={b.text}><StepIcon mark="buff" className="inline" />{b.name}</span>)}
          {done && <span className="eb-flag muted">Activated</span>}
        </div>
      </div>
      {card ? <ActionCardView g={g} card={card} unit={u} /> : phase === 'combat' ? <p className="eb-nocard">{u.engaged ? 'Engaged: it fights.' : 'Not Engaged: no fight.'}</p> : <p className="eb-nocard eb-cardback">No card yet this phase</p>}
    </article>
  );
}
