import { useState } from 'react';
import type { GameState } from '@engine/types/game';
import type { AiUnitInstance } from '@engine/types/army';
import type { Command } from '@engine/director/reducer';
import { unitById } from '@data/index';
import { currentSupply } from '@engine/units/supply';
import { visibleAiUnits } from '@engine/director/selectors';
import { headingText } from '@engine/ai/decide';
import { Btn, Stepper, Toggle } from './Basics';
import { playerUnitSupply } from '@engine/sense/playerUnits';
import { configLabel } from './UnitBuilder';
import type { PlayerUnit } from '@engine/sense/types';

function UnitRow({ u, state, dispatch, referee }: { u: AiUnitInstance; state: GameState; dispatch: (c: Command) => void; referee: boolean }) {
  const def = unitById(u.defId);
  const [dmg, setDmg] = useState(1);
  const [queen, setQueen] = useState(false);
  const [enemySupply, setEnemySupply] = useState(u.engagedEnemySupply || 1);
  const supply = currentSupply(def, u.models);
  const hasQueen = state.army.units.some((x) => x.defId === 'queen' && x.location === 'table');
  return (
    <div className={`unit-card ${u.location}`}>
      <div className="title">
        <b>{u.label}</b>
        <span className="muted small">{def.name} · {def.role}</span>
        <span className={`tag ${u.location === 'table' ? 'ok' : u.location === 'destroyed' ? 'danger' : ''}`}>{u.location}</span>
        <span className="tag">Supply {supply}</span>
        {u.respawns > 0 && <span className="tag warn">returned ×{u.respawns}</span>}
      </div>
      <div className="pips" title={`${u.models} of ${u.maxModels} models`}>
        {Array.from({ length: u.maxModels }, (_, i) => <span key={i} className={`pip ${i < u.models ? '' : 'off'}`} />)}
      </div>
      <div className="row small muted">
        <span>{u.models}/{u.maxModels} models · HP {def.stats.hp}{u.shieldsLeft ? ` +${u.shieldsLeft} shield` : ''} · Armour {def.stats.armour}+{def.stats.evade ? ` · Evade ${def.stats.evade}+` : ''} · damage marker {u.damageMarker}</span>
      </div>
      {u.location === 'table' && (
        <>
          <div className="row small" style={{ marginTop: 6 }}>
            <span className="muted">Heading:</span> <span>{headingText(state, u.objective)}</span>
          </div>
          {referee && <>
          <div className="row" style={{ marginTop: 8 }}>
            <span className="muted small">Damage taken</span>
            <Stepper value={dmg} onChange={setDmg} min={1} max={60} />
            {hasQueen && def.tags.includes('Biological') && <Toggle on={queen} onChange={setQueen}>Queen within 4" (−2)</Toggle>}
            <Btn variant="danger" size="sm" onClick={() => dispatch({ t: 'damage', unitId: u.id, dmg, queen })}>Apply</Btn>
            <Btn size="sm" onClick={() => dispatch({ t: 'setModels', unitId: u.id, models: u.models - 1 })}>−1 model</Btn>
            {u.damageMarker > 0 && <Btn size="sm" variant="ok" onClick={() => dispatch({ t: 'heal', unitId: u.id, amount: 1 })}>Heal 1</Btn>}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <Toggle on={u.engaged} onChange={(v) => dispatch({ t: 'setEngaged', unitId: u.id, engaged: v, enemySupply })}>Engaged</Toggle>
            {u.engaged && (
              <span className="row small"><span className="muted">enemy Supply</span><Stepper value={enemySupply} onChange={(v) => { setEnemySupply(v); dispatch({ t: 'setEngaged', unitId: u.id, engaged: true, enemySupply: v }); }} min={0} max={12} /></span>
            )}
            {u.objective.kind === 'marker' && <Toggle on={u.atObjective} onChange={(v) => dispatch({ t: 'setAtObjective', unitId: u.id, at: v })}>On marker {u.objective.markerId}</Toggle>}
          </div>
          </>}
        </>
      )}
      {u.upgrades.length > 0 && (
        <div className="small muted" style={{ marginTop: 6 }}>
          Upgrades: {u.upgrades.map((id) => def.weapons.find((w) => w.id === id)?.name ?? def.abilities.find((a) => a.id === id)?.name ?? id).join(', ')}
        </div>
      )}
    </div>
  );
}

function PlayerRow({ pu, dispatch, several, referee }: { pu: PlayerUnit; dispatch: (c: Command) => void; /** More than one player at the table: say whose the unit is. */ several: boolean; referee: boolean }) {
  const [dmg, setDmg] = useState(1);
  const def = unitById(pu.defId);
  return (
    <div className={`unit-card ${pu.destroyed ? 'destroyed' : 'table'}`} style={{ borderLeftColor: pu.destroyed ? undefined : 'var(--blue-side)' }}>
      <div className="title">
        <b>{pu.name}</b>{several && <span className="tag owner-tag" title={`Player ${(pu.owner ?? 0) + 1}'s unit`}>P{(pu.owner ?? 0) + 1}</span>}
        <span className="muted small">{configLabel(pu)}</span>
        <span className="tag blue">Supply {playerUnitSupply(pu)}</span>
        {pu.tagId !== undefined && <span className="tag">tag #{pu.tagId}</span>}
      </div>
      <div className="pips">{Array.from({ length: pu.maxModels }, (_, i) => <span key={i} className={`pip ${i < pu.models ? '' : 'off'}`} style={{ background: i < pu.models ? 'var(--blue-side)' : undefined }} />)}</div>
      <div className="row small muted"><span>{pu.models}/{pu.maxModels} models · HP {def.stats.hp}{pu.shieldsLeft ? ` +${pu.shieldsLeft} shield` : ''} · damage marker {pu.damageMarker}</span></div>
      {referee && !pu.destroyed && (
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted small">Damage taken</span>
          <Stepper value={dmg} onChange={setDmg} min={1} max={60} />
          <Btn variant="danger" size="sm" onClick={() => dispatch({ t: 'playerDamage', unitId: pu.id, dmg })}>Apply</Btn>
          <Btn size="sm" onClick={() => dispatch({ t: 'setPlayerModels', unitId: pu.id, models: pu.models - 1 })}>−1 model</Btn>
          <Btn size="sm" variant="ghost" onClick={() => dispatch({ t: 'setPlayerDestroyed', unitId: pu.id, destroyed: true })}>Destroyed</Btn>
        </div>
      )}
      {referee && pu.destroyed && <div className="row" style={{ marginTop: 6 }}><Btn size="sm" variant="ghost" onClick={() => dispatch({ t: 'setPlayerDestroyed', unitId: pu.id, destroyed: false })}>Undo destroyed</Btn></div>}
    </div>
  );
}

/** `referee`: the tabletop's hand controls (damage taken, models lost, engaged). The simulation keeps the score itself, so there it only reads. */
export function Roster({ state, dispatch, referee = true }: { state: GameState; dispatch: (c: Command) => void; referee?: boolean }) {
  const order = { table: 0, reserves: 1, destroyed: 2, exited: 3 } as const;
  const units = visibleAiUnits(state).slice().sort((a, b) => order[a.location] - order[b.location]);
  const hidden = state.army.units.length - units.length;
  return (
    <div>
      <h3>AI units</h3>
      {hidden > 0 && <p className="small muted">The rest of the enemy force has not shown itself yet.</p>}
      {units.map((u) => (
        <UnitRow key={u.id} u={u} state={state} dispatch={dispatch} referee={referee} />
      ))}
      {state.playerUnits.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>Your units</h3>
          {state.playerUnits.map((pu) => <PlayerRow several={(state.config.players ?? 1) > 1} key={pu.id} pu={pu} dispatch={dispatch} referee={referee} />)}
        </>
      )}
    </div>
  );
}
