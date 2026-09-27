import { CARDS, unitById } from '@data/index';
import type { Faction, WeaponProfile } from '@engine/types/units';
import type { PlayerUnit } from '@engine/sense/types';
import { availableWeapons } from '@engine/units/weapons';
import { currentSupply } from '@engine/units/supply';
import { speedFor } from '@engine/units/speed';
import { playerUnitSupply } from '@engine/sense/playerUnits';
import { configCostOf } from '@engine/army/force';
import { RESOURCE_NAME, RESOURCE_OF } from '@engine/abilities/index';

const kw = (w: WeaponProfile) => w.keywords.map((k) => `${k.k}${k.tag ? ` ${k.tag}` : ''}${k.v !== undefined ? ` (${k.range ? `${k.range}" ` : ''}${k.v})` : ''}`).join(', ');

/**
 * An army written out to be read on paper: what it costs, what it fields, and every profile and ability you
 * need at the table, so a printed page stands in for the cards while you play.
 */
export function ArmySheet({ name, faction, scale, units, cards }: {
  name: string;
  faction: Faction;
  scale: 'skirmish' | 'standard' | 'grand';
  units: PlayerUnit[];
  cards: string[];
}) {
  const cost = units.reduce((n, u) => n + configCostOf(u), 0);
  const supply = units.reduce((n, u) => n + playerUnitSupply(u), 0);
  const defs = cards.map((id) => CARDS.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => !!c);
  const gas = defs.reduce((n, c) => n + c.cost, 0);
  const resource = RESOURCE_NAME[RESOURCE_OF[faction] ?? 'CP'];
  const pool = defs.reduce((n, c) => n + c.resource, 0);

  return (
    <div className="army-sheet">
      <div className="sheet-head">
        <h2>{name}</h2>
        <div className="small">
          {faction} · {scale} · {cost} minerals · {supply} Supply · {units.length} unit{units.length === 1 ? '' : 's'}
          {defs.length ? ` · ${defs.length} card${defs.length === 1 ? '' : 's'} (${gas} gas, ${pool} ${resource})` : ''}
        </div>
      </div>

      {units.map((u) => {
        const def = unitById(u.defId);
        const weapons = [...availableWeapons(def, u.upgrades, 'Assault'), ...availableWeapons(def, u.upgrades, 'Combat')];
        const bought = [...def.weapons, ...def.abilities].filter((x) => x.upgradeCost && u.upgrades.includes(x.id)).map((x) => x.name);
        const s = def.stats;
        return (
          <div key={u.id} className="sheet-unit">
            <h3>{u.name} <span className="small">— {u.models} × {def.name} · {configCostOf(u)} minerals · Supply {currentSupply(def, u.models)}</span></h3>
            <div className="small">
              Speed {s.speed ? `${speedFor(def, u.models)}"` : '—'} · Armour {s.armour}+ · Evade {s.evade ? `${s.evade}+` : '—'} · HP {s.hp}
              {s.shields ? ` · Shields ${s.shields}` : ''} · Size {s.size} · {def.tags.join(', ')}
            </div>
            {bought.length > 0 && <div className="small"><b>Upgrades:</b> {bought.join(', ')}</div>}
            {weapons.length > 0 && (
              <table>
                <thead><tr><th>Weapon</th><th>Rng</th><th>Tgt</th><th>RoA</th><th>Hit</th><th>Dmg</th><th>Surge</th></tr></thead>
                <tbody>
                  {weapons.map((w) => (
                    <tr key={w.id}>
                      <td>{w.name}{w.keywords.length ? <div className="small">{kw(w)}</div> : null}</td>
                      <td>{w.range === 'E' ? 'E' : `${w.range}"`}</td>
                      <td>{w.target}</td>
                      <td>{w.blast ? `BT+${w.roa}` : w.roa}</td>
                      <td>{w.hit}+</td>
                      <td>{w.dmg}</td>
                      <td>{w.surgeTypes.length ? `${w.surgeTypes.join('/')} ${w.surgeDie}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 16 }}>
              {def.abilities.filter((a) => !a.upgradeCost || u.upgrades.includes(a.id)).map((a) => (
                <li key={a.id}><b>{a.name}</b> ({a.phase} · {a.kind}{a.cost ? ` · ${a.cost.amount} ${a.cost.resource}` : ''}): {a.text}</li>
              ))}
            </ul>
          </div>
        );
      })}

      {defs.length > 0 && (
        <div className="sheet-unit">
          <h3>Cards</h3>
          <ul className="small sheet-cards" style={{ margin: 0, paddingLeft: 16 }}>
            {defs.map((c, i) => (
              <li key={`${c.id}-${i}`}>
                <b>{c.name}</b> ({c.isFactionCard ? 'Faction' : 'Tactical'} · {c.cost} gas · {c.resource} {resource})
                <ul style={{ margin: 0, paddingLeft: 14 }}>
                  {c.boosts.map((b) => <li key={b.name}><b>{b.name}:</b> {b.text}</li>)}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
