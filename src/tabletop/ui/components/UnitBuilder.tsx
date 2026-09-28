import { useMemo, useState } from 'react';
import { configCostOf } from '@engine/army/force';
import { unitsForFaction, unitById } from '@data/index';
import type { Faction, UnitDef } from '@engine/types/units';
import { Btn, Stepper, Toggle } from './Basics';

export interface UnitConfig {
  defId: string;
  composition: 'small' | 'large';
  upgrades: string[];
  name: string;
}

export function configCost(cfg: UnitConfig): number {
  return configCostOf(cfg);
}

export function configLabel(cfg: UnitConfig): string {
  const def = unitById(cfg.defId);
  const comp = def.compositions.find((c) => c.label === cfg.composition) ?? def.compositions[0];
  const ups = cfg.upgrades.map((id) => def.weapons.find((w) => w.id === id)?.name ?? def.abilities.find((a) => a.id === id)?.name).filter(Boolean);
  return `${def.name} ×${comp?.models ?? 1}${ups.length ? ` (${ups.join(', ')})` : ''}`;
}

function upgradeOptions(def: UnitDef) {
  return [
    ...def.weapons.filter((w) => w.upgradeCost).map((w) => ({ id: w.id, name: w.name, cost: w.upgradeCost!, note: w.replaces ? `replaces ${w.replaces}` : w.keywords.some((k) => k.k === 'SPECIALIST') ? 'one model' : '' })),
    ...def.abilities.filter((a) => a.upgradeCost).map((a) => ({ id: a.id, name: a.name, cost: a.upgradeCost!, note: a.kind })),
  ];
}

/** Build a unit the same way as the official army builder: type, composition, upgrades. */
export function UnitBuilder({ faction, onAdd, lockFaction, owned, used, allowSummoned }: {
  faction: Faction;
  onAdd: (cfg: UnitConfig, count: number) => void;
  lockFaction?: boolean;
  /** Offer summoned units too (Point Defence Drone, Omega Worm, Pylon, Roachling): for putting one on the table
   *  that a card or ability brought in, never for an army list, which they are not part of. */
  allowSummoned?: boolean;
  /** Models available per unit (from the Collection); omit to allow anything. */
  owned?: Record<string, number>;
  /** Models already committed to the army being built, per unit. */
  used?: Record<string, number>;
}) {
  const [fac, setFac] = useState<Faction>(faction);
  const units = useMemo(() => unitsForFaction(fac).filter((u) => (allowSummoned || !u.summoned) && (!owned || (owned[u.id] ?? 0) > 0)), [fac, owned, allowSummoned]);
  const [defId, setDefId] = useState(units[0]?.id ?? '');
  const def = units.find((u) => u.id === defId) ?? units[0];
  const [composition, setComposition] = useState<'small' | 'large'>('small');
  const [upgrades, setUpgrades] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [count, setCount] = useState(1);
  if (!def) return <p className="small muted">No {fac} models in your Collection yet — add them on the Collection screen.</p>;
  const comp = def.compositions.find((c) => c.label === composition) ?? def.compositions[0];
  // How many more copies of this unit your models can field.
  const left = owned ? Math.max(0, (owned[def.id] ?? 0) - (used?.[def.id] ?? 0)) : Infinity;
  const maxCopies = comp && left !== Infinity ? Math.max(0, Math.floor(left / comp.models)) : 6;
  const cfg: UnitConfig = { defId: def.id, composition: comp?.label ?? 'small', upgrades, name: name.trim() || def.name };
  const cost = configCost(cfg);
  const supply = comp?.supply ?? 0;
  return (
    <div className="stack">
      {!lockFaction && (
        <div className="row">
          {(['Terran', 'Zerg', 'Protoss'] as Faction[]).map((f) => <Btn key={f} size="sm" variant={fac === f ? 'primary' : ''} onClick={() => { setFac(f); const first = unitsForFaction(f).filter((u) => allowSummoned || !u.summoned)[0]; setDefId(first?.id ?? ''); setUpgrades([]); setComposition('small'); }}>{f}</Btn>)}
        </div>
      )}
      <div className="row">
        <select value={def.id} onChange={(e) => { setDefId(e.target.value); setUpgrades([]); setComposition('small'); }} style={{ flex: 1, minWidth: 180 }}>
          {units.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}{u.unique ? ' · unique' : ''}</option>)}
        </select>
        {def.compositions.map((c) => <Btn key={c.label} size="sm" variant={comp?.label === c.label ? 'primary' : ''} onClick={() => setComposition(c.label)}>{c.models} model{c.models > 1 ? 's' : ''} · {c.cost}</Btn>)}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {upgradeOptions(def).map((o) => (
          <Toggle key={o.id} on={upgrades.includes(o.id)} onChange={(v) => setUpgrades(v ? [...upgrades, o.id] : upgrades.filter((x) => x !== o.id))}>
            {o.name} +{composition === 'large' ? o.cost.large : o.cost.small}{o.note ? <span className="muted" style={{ textTransform: 'none', letterSpacing: 0 }}> · {o.note}</span> : null}
          </Toggle>
        ))}
        {upgradeOptions(def).length === 0 && <span className="small muted">No upgrades for this Unit.</span>}
      </div>
      <div className="row">
        <input placeholder={`Name (optional), e.g. ${def.name} A`} value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        <label>Copies</label><Stepper value={count} onChange={setCount} min={1} max={Math.max(1, Math.min(6, maxCopies))} />
        <span className="tag accent">{cost} minerals · Supply {supply}</span>
        <Btn variant="primary" disabled={maxCopies < 1} title={maxCopies < 1 ? `You do not own enough ${def.name} models` : undefined} onClick={() => onAdd(cfg, count)}>Add</Btn>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Speed {def.stats.speed ? def.stats.speed.join('/') : '–'} · Armour {def.stats.armour}+ · HP {def.stats.hp}{def.stats.shields ? ` +${def.stats.shields} shields` : ''} · {def.tags.join(', ')}</p>
    </div>
  );
}
