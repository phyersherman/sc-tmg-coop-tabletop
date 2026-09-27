import { RulesText } from './RulesText';
import { useState } from 'react';
import { unitById } from '@data/index';
import type { GameState } from '@engine/types/game';
import type { Command } from '@engine/director/reducer';
import type { AiUnitInstance } from '@engine/types/army';
import type { PlayerUnit } from '@engine/sense/types';
import type { UnitDef, WeaponProfile } from '@engine/types/units';
import { availableWeapons } from '@engine/units/weapons';
import { statusText } from '@engine/units/keywords';
import { abilityGap } from '@engine/player/rules';
import { currentSupply } from '@engine/units/supply';
import { speedFor } from '@engine/units/speed';
import { autoPay, cardDef, effectiveSpeed, pickForPay, playerResource, readyCards, unitAbilities, unitPos, UNIT_ABILITIES, type AbilitySpec, type UsableAbility } from '@engine/abilities/index';
import { playerUnitDef } from '@engine/sense/playerUnits';
import { useUi } from '@tt/store/uiStore';
import { Btn } from './Basics';

const kwText = (w: WeaponProfile) => w.keywords.map((k) => `${k.k}${k.tag ? ` ${k.tag}` : ''}${k.v !== undefined ? ` (${k.range ? `${k.range}" ` : ''}${k.v})` : ''}`).join(', ');

function WeaponsTable({ weapons }: { weapons: WeaponProfile[] }) {
  if (!weapons.length) return null;
  return (
    <table className="stat-table">
      <thead><tr><th>Weapon</th><th>Rng</th><th>Tgt</th><th>RoA</th><th>Hit</th><th>DMG</th><th>Surge</th></tr></thead>
      <tbody>
        {weapons.map((w) => (
          <tr key={w.id}>
            <td><b>{w.name}</b>{w.keywords.length ? <div className="small muted">{kwText(w)}</div> : null}</td>
            <td>{w.range === 'E' ? 'E' : `${w.range}"`}</td>
            <td>{w.target}</td>
            <td>{w.roa}</td>
            <td>{w.hit}+</td>
            <td>{w.dmg}</td>
            <td>{w.surgeTypes.length ? `${w.surgeTypes.join('/')} ${w.surgeDie}` : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stats({ def, models, speed, supply }: { def: UnitDef; models: number; speed: number; supply: number }) {
  const s = def.stats;
  const cells: [string, string][] = [
    ['Speed', s.speed ? `${speed}"` : '—'],
    ['Armour', `${s.armour}+`],
    ['Evade', s.evade ? `${s.evade}+` : '—'],
    ['HP', String(s.hp)],
    ['Shields', s.shields ? String(s.shields) : '—'],
    ['Size', String(s.size)],
    ['Supply', String(supply)],
    ['Models', String(models)],
  ];
  return (
    <div className="stat-grid">
      {cells.map(([k, v]) => <div key={k}><span className="k">{k}</span><span className="v">{v}</span></div>)}
    </div>
  );
}

/** Use an ability: pick payment, option and target, then dispatch. */
function AbilityUse({ g, pu, item, dispatch, onClose }: { g: GameState; pu: PlayerUnit; item: UsableAbility; dispatch: (c: Command) => void; onClose: () => void }) {
  const ui = useUi();
  const spec = item.spec as AbilitySpec;
  const [option, setOption] = useState(0);
  const cost = spec.options ? spec.options[option]!.cost : item.cost;
  const auto = autoPay(g, cost) ?? [];
  const [pay, setPay] = useState<string[]>(auto.map((c) => c.id));
  const payTotal = pay.reduce((a, id) => a + (cardDef(g.playerCards?.find((c) => c.id === id)?.defId ?? '')?.resource ?? 0), 0);
  const from = unitPos(g, pu);
  const base = { t: 'useAbility' as const, unitId: pu.id, name: item.ability.name, payWith: cost > 0 ? pay : [], option: spec.options ? option : undefined };
  const go = (extra: Partial<Command & { t: 'useAbility' }>) => { dispatch({ ...base, ...extra } as Command); onClose(); };
  // In range as the rules measure it: base edge to base edge (abilityGap), the same check the engine will make.
  const within = (side: 'ai' | 'players', id: string) => { if (spec.range === undefined) return true; const d = abilityGap(g, pu, side, id); return d === null || d <= spec.range + 0.05; };
  const friendlies = g.playerUnits.filter((f) => f.location === 'table' && !f.destroyed && f.id !== pu.id && (!spec.friendlyFilter || spec.friendlyFilter(f)) && within('players', f.id));
  const enemies = g.army.units.filter((e) => e.location === 'table' && within('ai', e.id));
  return (
    <div className="roll-card">
      {spec.options && (
        <div className="stack">
          {spec.options.map((o, i) => <label key={i} className="row small"><input type="radio" checked={option === i} onChange={() => { setOption(i); setPay((autoPay(g, o.cost) ?? []).map((c) => c.id)); }} /> {o.label} ({o.cost} {playerResource(g)})</label>)}
        </div>
      )}
      {cost > 0 && (
        <div className="stack">
          <span className="small">Costs {cost} {playerResource(g)}: Exhaust Ready cards worth that much. They come back Ready at Cleanup.</span>
          <div className="row" style={{ gap: 4 }}>
            {readyCards(g).filter((c) => (cardDef(c.defId)?.resource ?? 0) > 0).map((c) => (
              <label key={c.id} className="row small card-chip"><input type="checkbox" checked={pay.includes(c.id)} onChange={() => setPay(pickForPay(g, pay, c.id, cost))} /> {cardDef(c.defId)?.name} ({cardDef(c.defId)?.resource})</label>
            ))}
          </div>
          {payTotal < cost && <span className="small danger-text">Picked cards give {payTotal}; the cost is {cost}.</span>}
        </div>
      )}
      {!spec.automated && <p className="small muted">The app records this; resolve it on the table.</p>}
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        {(spec.target === 'self' || spec.target === 'none') && <Btn variant="primary" disabled={payTotal < cost} onClick={() => go({})}>Use {item.ability.name}</Btn>}
        {spec.target === 'friendly' && friendlies.map((f) => <Btn key={f.id} variant="primary" disabled={payTotal < cost} onClick={() => go({ friendlyId: f.id })}>{f.name}</Btn>)}
        {spec.target === 'friendly' && !friendlies.length && <span className="small muted">No valid friendly unit{spec.range ? ` within ${spec.range}"` : ''}.</span>}
        {spec.target === 'enemy' && enemies.map((e) => <Btn key={e.id} variant="danger" disabled={payTotal < cost} onClick={() => go({ enemyId: e.id })}>{e.label}</Btn>)}
        {spec.target === 'enemy' && !enemies.length && <span className="small muted">No enemy unit{spec.range ? ` within ${spec.range}"` : ''}.</span>}
        {spec.target === 'point' && <Btn variant="primary" disabled={payTotal < cost} onClick={() => { ui.setPendingAbility({ kind: 'unit', unitId: pu.id, name: item.ability.name, target: 'point', range: spec.range, hint: spec.targetHint, payWith: cost > 0 ? pay : [], option: spec.options ? option : undefined }); onClose(); }}>Pick a spot on the map</Btn>}
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
      </div>
    </div>
  );
}

/** Everything about one of your units: stats, weapons, abilities you can use, effects and statuses. */
export function PlayerUnitCard({ g, pu, dispatch }: { g: GameState; pu: PlayerUnit; dispatch: (c: Command) => void }) {
  const def = playerUnitDef(pu);
  const [open, setOpen] = useState<string | null>(null);
  const abilities = unitAbilities(g, pu);
  const weapons = [...availableWeapons(def, pu.upgrades, 'Assault'), ...availableWeapons(def, pu.upgrades, 'Combat')];
  const upgradeNames = [...def.weapons, ...def.abilities].filter((x) => x.upgradeCost && pu.upgrades.includes(x.id)).map((x) => x.name);
  return (
    <div className="unit-sheet">
      <div className="row between">
        <div><b className="sheet-name">{pu.name}</b> <span className="small muted">{def.faction} · {def.role} · {def.tags.join(', ')}</span></div>
        <span className="small muted">{pu.models}/{pu.maxModels} models{pu.damageMarker ? ` · damage ${pu.damageMarker}` : ''}{pu.shieldsLeft ? ` · shields ${pu.shieldsLeft}` : ''}</span>
      </div>
      <Stats def={def} models={pu.models} speed={effectiveSpeed(pu)} supply={currentSupply(def, pu.models)} />
      {(pu.statuses?.length || pu.effects?.length || pu.bonusMove || pu.placeRange) ? (
        <div className="effects">
          {pu.statuses?.map((st) => <span key={st} className="tag" title={statusText(st)}>{st}</span>)}
          {pu.bonusMove ? <span className="tag blue">Free {pu.bonusMove}" move: click where it goes</span> : null}
          {pu.placeRange ? <span className="tag blue">PLACE {pu.placeRange}": click where it lands</span> : null}
          {pu.effects?.map((e) => <span key={e.id} className="tag" title={e.text}>{e.source}{e.until === 'firstWeapon' ? ' (next attack)' : e.until === 'charge' ? ' (next charge)' : ''}</span>)}
        </div>
      ) : null}
      <WeaponsTable weapons={weapons} />
      {upgradeNames.length > 0 && <p className="small"><span className="muted">Upgrades:</span> {upgradeNames.join(', ')}</p>}
      <div className="stack">
        {abilities.map((it) => (
          <div key={it.ability.id} className={`ability ${it.ability.kind.toLowerCase()}`}>
            <div className="row between">
              <div><b>{it.ability.name}</b> <span className="small muted">{it.ability.phase} · {it.ability.kind}{it.ability.cost ? ` · ${it.ability.cost.amount} ${it.ability.cost.resource}` : ''}{UNIT_ABILITIES[it.ability.name] && !UNIT_ABILITIES[it.ability.name]!.automated ? ' · reminder' : ''}</span></div>
              {it.ability.kind !== 'Passive' && it.spec && <Btn size="sm" variant={it.ok ? 'primary' : ''} disabled={!it.ok} title={it.reason} onClick={() => setOpen(open === it.ability.id ? null : it.ability.id)}>{it.ok ? 'Use' : it.reason}</Btn>}
            </div>
            <div className="small muted"><RulesText text={it.ability.text} /></div>
            {open === it.ability.id && it.ok && <AbilityUse g={g} pu={pu} item={it} dispatch={dispatch} onClose={() => setOpen(null)} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A unit's card as printed, with no game behind it: its stats for the models it has, the weapons its upgrades
 * leave it with, and every ability it carries. Used to look a unit up while building an army, and to print one.
 */
export function UnitSheet({ def, upgrades, models, title, meta, className = '' }: {
  def: UnitDef;
  upgrades: string[];
  models: number;
  /** Heading: the unit's name in the army, or the unit type. */
  title?: string;
  /** A line beside the heading (cost, models, whatever the caller counts). */
  meta?: string;
  className?: string;
}) {
  const weapons = [...availableWeapons(def, upgrades, 'Assault'), ...availableWeapons(def, upgrades, 'Combat')];
  const bought = [...def.weapons, ...def.abilities].filter((x) => x.upgradeCost && upgrades.includes(x.id)).map((x) => x.name);
  const abilities = def.abilities.filter((a) => !a.upgradeCost || upgrades.includes(a.id));
  return (
    <div className={`unit-sheet ${className}`}>
      <div className="row between">
        <div><b className="sheet-name">{title ?? def.name}</b> <span className="small muted">{def.faction} · {def.role} · {def.tags.join(', ')}</span></div>
        {meta && <span className="small muted">{meta}</span>}
      </div>
      <Stats def={def} models={models} speed={speedFor(def, models)} supply={currentSupply(def, models)} />
      <WeaponsTable weapons={weapons} />
      {bought.length > 0 && <p className="small"><span className="muted">Upgrades:</span> {bought.join(', ')}</p>}
      <div className="stack">
        {abilities.map((a) => (
          <div key={a.id} className={`ability ${a.kind.toLowerCase()}`}>
            <div><b>{a.name}</b> <span className="small muted">{a.phase} · {a.kind}{a.cost ? ` · ${a.cost.amount} ${a.cost.resource}` : ''}</span></div>
            <div className="small muted"><RulesText text={a.text} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Read-only card for an AI unit. */
export function AiUnitCard({ g, u }: { g: GameState; u: AiUnitInstance }) {
  const def = unitById(u.defId);
  const weapons = [...availableWeapons(def, u.upgrades, 'Assault'), ...availableWeapons(def, u.upgrades, 'Combat')];
  const upgradeNames = [...def.weapons, ...def.abilities].filter((x) => x.upgradeCost && u.upgrades.includes(x.id)).map((x) => x.name);
  return (
    <div className="unit-sheet ai">
      <div className="row between">
        <div><b className="sheet-name">{u.label}</b> <span className="small muted">{def.name} · {def.role} · {def.tags.join(', ')}</span></div>
        <span className="small muted">{u.models}/{u.maxModels} models{u.damageMarker ? ` · damage ${u.damageMarker}` : ''}{u.engaged ? ' · engaged' : ''}</span>
      </div>
      <Stats def={def} models={u.models} speed={speedFor(def, u.models)} supply={currentSupply(def, u.models)} />
      {u.debuffs?.length ? <div className="effects">{u.debuffs.map((d) => <span key={d.id} className="tag red" title={d.text}>{d.source}</span>)}</div> : null}
      <WeaponsTable weapons={weapons} />
      {upgradeNames.length > 0 && <p className="small"><span className="muted">Upgrades:</span> {upgradeNames.join(', ')}</p>}
      <div className="stack">
        {def.abilities.filter((a) => !a.upgradeCost || u.upgrades.includes(a.id)).map((a) => (
          <div key={a.id} className={`ability ${a.kind.toLowerCase()}`}>
            <div><b>{a.name}</b> <span className="small muted">{a.phase} · {a.kind}{a.cost ? ` · ${a.cost.amount} ${a.cost.resource}` : ''}</span></div>
            <div className="small muted"><RulesText text={a.text} /></div>
          </div>
        ))}
      </div>
      {g.phase !== 'scoring' && <p className="small muted" style={{ marginTop: 6 }}>{u.activated[g.phase] ? 'Has activated this phase.' : 'Has not activated this phase.'}</p>}
    </div>
  );
}
