import { useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CARDS, unitById, unitsForFaction } from '@data/index';
import type { CardDef, Faction, UnitDef } from '@engine/types/units';
import type { PlayerUnit } from '@engine/sense/types';
import { toggleUpgrade } from '@engine/units/weapons';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { physicalModelId } from '@engine/army/collection';
import { SLOT_TYPES, addUnitProblem, armySlots, cardNeeds, isCreepCard, slotOf, slotsUsed, startingSupply, validatePlayerArmy, vespeneLimit, vespeneSpent } from '@engine/army/rules';
import { RESOURCE_OF } from '@engine/abilities/index';
import type { RecentArmy } from '@tt/store/settingsStore';
import { Btn, Stepper } from './Basics';
import { UnitSheet } from './UnitCard';
import { configCost, configLabel, type UnitConfig } from './UnitBuilder';
import { cardArt, modelPhoto } from '@data/modelPhotos';

/** The buildings each faction trains its units from, as the game's command card lays them out. */
/** A unit, card or building shown by its initials ("SIE" for a Siege Tank, "RF" for a two-word card). */
function Icon({ name, size = 40 }: { name: string; size?: number }) {
  // A Unit is shown by its painted model from the official card; a card or building by the card's own art.
  const photo = name.startsWith('u_') ? modelPhoto(name.slice(2)) : null;
  if (photo) return <span className="army-photo" style={{ width: size, height: size }}><img src={photo} alt="" loading="lazy" draggable={false} /></span>;
  const art = name.startsWith('c_') ? cardArt(name.slice(2)) : null;
  if (art) return <span className="army-art" style={{ width: size, height: size }}><img src={art} alt="" loading="lazy" draggable={false} /></span>;
  const words = name.replace(/^[a-z]_/, '').split(/[_\W]+/).filter(Boolean);
  const initials = (words.length > 1 ? words.map((w) => w[0]).join('') : words[0] ?? name).slice(0, 3).toUpperCase();
  return <span className="hud-icon-fallback" style={{ width: size, height: size }}>{initials}</span>;
}

const TRAINS: Record<Faction, { icon: string; name: string; units: string[] }[]> = {
  Terran: [
    { icon: 'c_barracks', name: 'Barracks', units: ['marine', 'raynor_s_raider__marine_', 'marauder', 'medic', 'jim_raynor'] },
    { icon: 'c_factory', name: 'Factory', units: ['goliath', 'siege_tank'] },
  ],
  Zerg: [
    { icon: 'c_spawning_pool', name: 'Spawning Pool', units: ['zergling', 'swarmling__zergling_', 'raptor__zergling_', 'kerrigan_swarm_raptor__zergling_'] },
    { icon: 'c_roach_warren', name: 'Roach Warren', units: ['roach', 'corpser__roach_', 'vile__roach_', 'ravager'] },
    { icon: 'c_hydralisk_den', name: 'Hydralisk Den', units: ['hydralisk'] },
    { icon: 'c_hatchery', name: 'Hatchery', units: ['queen', 'kerrigan'] },
  ],
  Protoss: [
    { icon: 'c_gateway', name: 'Gateway', units: ['zealot', 'praetor_guard__zealot_', 'adept', 'nerazim_watchers__adept_', 'stalker', 'sentry', 'artanis', 'zeratul'] },
    { icon: 'c_robotics_facility', name: 'Robotics Facility', units: ['immortal'] },
  ],
};

/** The building a unit's upgrades are researched at. */
function upgradeBuilding(def: UnitDef): { icon: string; name: string } {
  if (def.faction === 'Terran') return def.id === 'goliath' || def.id === 'siege_tank' ? { icon: 'c_armory', name: 'Armory' } : def.id === 'medic' ? { icon: 'c_academy', name: 'Academy' } : { icon: 'c_engineering_bay', name: 'Engineering Bay' };
  if (def.faction === 'Zerg') return def.id === 'ravager' ? { icon: 'c_roach_warren', name: 'Roach Warren' } : { icon: 'c_evolution_chamber', name: 'Evolution Chamber' };
  if (def.id === 'immortal') return { icon: 'c_warp_prism', name: 'Robotics Bay' };
  if (def.id === 'zeratul' || def.id === 'nerazim_watchers__adept_') return { icon: 'c_twilight_council', name: 'Templar Archives' };
  return ['stalker', 'sentry', 'artanis'].includes(def.id) ? { icon: 'b_cybernetics_core', name: 'Cybernetics Core' } : { icon: 'c_forge', name: 'Forge' };
}

function upgradeOptions(def: UnitDef) {
  return [
    ...def.weapons.filter((w) => w.upgradeCost).map((w) => {
      const rivals = w.replaces ? def.weapons.filter((o) => o !== w && o.upgradeCost && o.replaces?.toLowerCase() === w.replaces!.toLowerCase()).map((o) => o.name) : [];
      return { id: w.id, name: w.name, cost: w.upgradeCost!, note: w.replaces ? `Replaces ${w.replaces}.${rivals.length ? ` Take one of ${[w.name, ...rivals].join(' / ')}.` : ''}` : w.keywords.some((k) => k.k === 'SPECIALIST') ? 'One model carries it.' : '', text: w.text };
    }),
    ...def.abilities.filter((a) => a.upgradeCost).map((a) => ({ id: a.id, name: a.name, cost: a.upgradeCost!, note: `${a.kind} ability.`, text: a.text })),
  ];
}

const SLOTS = SLOT_TYPES;

interface Tip { title: string; meta?: string; body: ReactNode; x: number; y: number }

/** An army being built: its units, its cards, and (optionally) the name it is saved under. */
export interface ArmyValue { units: PlayerUnit[]; cards: string[]; name?: string }

/**
 * Build an army the way the game trains units: pick a unit from the building that makes it, choose its size and
 * upgrades (from the building that researches them), and add it; Faction and Tactical cards are the buildings
 * they are named after. Hovering anything says what it does. Armies fielded before, of this game type and within
 * the budget, can be brought back with one click but never come back on their own.
 */
/** What a weapon does, in a line: range · RoA×Hit+ · Damage, and its keywords. */
const weaponLine = (w: UnitDef['weapons'][number]) => `${w.range === 'E' ? 'E' : `${w.range}"`} · ${w.roa}×${w.hit}+ · D${w.dmg}${w.keywords.length ? ` · ${w.keywords.map((k) => k.k).join(', ')}` : ''}`;

/** The unit's weapons and the upgrades on offer, for the tip that opens when you point at it in the builder. */
function UnitTipKit({ def }: { def: UnitDef }) {
  const base = def.weapons.filter((w) => !w.upgradeCost);
  const upgrades = [
    ...def.weapons.filter((w) => w.upgradeCost).map((w) => ({ id: w.id, name: w.name, cost: w.upgradeCost!, what: weaponLine(w) })),
    ...def.abilities.filter((a) => a.upgradeCost).map((a) => ({ id: a.id, name: a.name, cost: a.upgradeCost!, what: `${a.kind}${a.phase !== 'Any' ? ` · ${a.phase}` : ''}` })),
  ];
  const price = (c: { small: number; large: number }) => (c.small === c.large || !c.large ? `${c.small}` : `${c.small} / ${c.large}`);
  return (
    <>
      {base.length > 0 && (
        <div className="tip-list">
          <b>Weapons</b>
          {base.map((w) => <div key={w.id}><span>{w.name}</span><i>{weaponLine(w)}</i></div>)}
        </div>
      )}
      {upgrades.length > 0 && (
        <div className="tip-list">
          <b>Upgrades</b>
          {upgrades.map((u) => <div key={u.id}><span>{u.name} <em>{price(u.cost)}</em></span><i>{u.what}</i></div>)}
        </div>
      )}
    </>
  );
}

export function ArmyPicker({ faction, onFaction, lockFaction, budget, scale, owned, value, onChange, recent, onForget, named, anyScale }: {
  faction: Faction;
  onFaction?: (f: Faction) => void;
  lockFaction?: boolean;
  /** Minerals the army may cost. */
  budget: number;
  scale: 'skirmish' | 'standard' | 'grand';
  /** Models available per unit (from the Collection); omit to allow anything. */
  owned?: Record<string, number>;
  value: ArmyValue;
  onChange: (v: ArmyValue) => void;
  /** Saved armies to offer (the picker shows the ones that fit this game). */
  recent?: RecentArmy[];
  onForget?: (id: string) => void;
  /** Ask for the army's name: it is saved under it (with its cards) when it is taken into a battle. */
  named?: boolean;
  /** Offer saved armies of any game type that fit the budget. */
  anyScale?: boolean;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [composition, setComposition] = useState<'small' | 'large'>('small');
  const [upgrades, setUpgrades] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [count, setCount] = useState(1);
  /** The unit whose card is being read: its own card, as printed, with the upgrades it is carrying. */
  const [card, setCard] = useState<{ defId: string; upgrades: string[]; models: number; title: string; meta?: string } | null>(null);

  const units = value.units;
  const spent = units.reduce((a, u) => a + configCost(u), 0);
  const gas = vespeneLimit(budget);
  const cardDefs = value.cards.map((id) => CARDS.find((c) => c.id === id)).filter((c): c is CardDef => !!c);
  const factionCard = cardDefs.find((c) => c.isFactionCard);
  const gasSpent = vespeneSpent(cardDefs);
  const tags = new Set<string>([faction, ...(factionCard?.factionTags ?? [])]);
  const factionCards = CARDS.filter((c) => c.isFactionCard && (c.faction === faction || tags.has(c.faction)));
  const tacticalCards = CARDS.filter((c) => !c.isFactionCard && (c.faction === faction || tags.has(c.faction)));
  const resource = RESOURCE_OF[faction] ?? 'CP';
  // Army Building (Part 9.1): the Army Slots the cards give against the starting Supply of the Units, and
  // everything that stops this army being fielded as it stands.
  const slots = armySlots(cardDefs);
  const usedSlots = slotsUsed(units);
  const army = { factionCard, cards: cardDefs, units };
  /** The Army Slots a Unit of the army occupies: "2 Core". */
  const slotLabel = (u: PlayerUnit) => { const d = unitById(u.defId); const n = startingSupply(d, u.composition); return slotOf(d) ? `${n} ${d.role} Army Slot${n === 1 ? '' : 's'}` : 'no Army Slot'; };
  const problems = units.length || value.cards.length ? validatePlayerArmy({ cards: value.cards, units, minerals: budget }) : [];

  // Models of each miniature already in the army (a Raider is a Marine).
  const usedModels = useMemo(() => units.reduce<Record<string, number>>((a, u) => ({ ...a, [physicalModelId(u.defId)]: (a[physicalModelId(u.defId)] ?? 0) + u.maxModels }), {}), [units]);
  const leftFor = (def: UnitDef) => (owned ? Math.max(0, (owned[def.id] ?? 0) - (usedModels[physicalModelId(def.id)] ?? 0)) : Infinity);

  const buildings = useMemo(() => {
    const all = unitsForFaction(faction).filter((u) => !u.summoned);
    const listed = new Set(TRAINS[faction].flatMap((b) => b.units));
    const groups = TRAINS[faction].map((b) => ({ ...b, defs: b.units.map((id) => all.find((u) => u.id === id)).filter((u): u is UnitDef => !!u) }));
    const rest = all.filter((u) => !listed.has(u.id));
    if (rest.length) groups[groups.length - 1]!.defs.push(...rest);
    return groups;
  }, [faction]);

  // A tip closes a moment after the pointer leaves, unless it goes onto the tip (to read a keyword there).
  const tipOff = useRef(0);
  const closeTipSoon = () => { window.clearTimeout(tipOff.current); tipOff.current = window.setTimeout(() => setTip(null), 260); };
  const keepTip = () => window.clearTimeout(tipOff.current);
  const hover = (t: Omit<Tip, 'x' | 'y'>) => ({
    onMouseEnter: (e: React.MouseEvent) => { keepTip(); setTip({ ...t, x: e.clientX, y: e.clientY }); },
    onMouseMove: (e: React.MouseEvent) => setTip((cur) => (cur && cur.title === t.title ? { ...cur, x: e.clientX, y: e.clientY } : cur)),
    onMouseLeave: closeTipSoon,
  });

  const def = sel ? unitById(sel) : null;
  const comp = def ? def.compositions.find((c) => c.label === composition) ?? def.compositions[0] : undefined;
  const cfg: UnitConfig | null = def ? { defId: def.id, composition: comp?.label ?? 'small', upgrades, name: name.trim() || def.name } : null;
  const cost = cfg ? configCost(cfg) : 0;
  const maxCopies = def && comp ? (leftFor(def) === Infinity ? 6 : Math.floor(leftFor(def) / comp.models)) : 0;
  /** Why the Unit on the bench cannot join the army: no Faction card, a Faction Tag, a Unique Unit, no free Army Slot. */
  const addWhy = def && comp ? addUnitProblem(def, comp.label, army, count) : null;
  const pick = (d: UnitDef) => { setSel(d.id); setComposition('small'); setUpgrades([]); setName(''); setCount(1); };
  const add = () => {
    if (!cfg || !def || addWhy) return;
    const next = units.slice();
    for (let i = 0; i < count; i++) {
      const idx = next.filter((u) => u.defId === cfg.defId).length + 1;
      next.push(makePlayerUnit(`pu-${Date.now().toString(36)}-${i}`, cfg.defId, cfg.composition, cfg.upgrades, count > 1 || idx > 1 ? `${cfg.name} ${String.fromCharCode(64 + idx)}` : cfg.name));
    }
    onChange({ ...value, units: next });
  };
  const setFactionCard = (id: string) => onChange({ ...value, cards: [id, ...value.cards.filter((c) => !CARDS.find((d) => d.id === c)?.isFactionCard)] });
  // A click takes another copy of a card; a right-click puts one copy back. An army has one Creep card: a click on
  // another swaps it in, a click on the one it has puts it back. (Only one Faction card is ever in the army.)
  const otherCreep = (c: CardDef) => cardDefs.filter((x) => isCreepCard(x) && x.id !== c.id);
  /** Vespene Gas spent once this card is taken (a Creep card takes the place of the one in the army). */
  const gasWith = (c: CardDef) => gasSpent + c.cost - (isCreepCard(c) ? vespeneSpent(otherCreep(c)) : 0);
  const addTactical = (c: CardDef) => {
    if (cardNeeds(c, factionCard)) return;
    if (isCreepCard(c)) {
      if (value.cards.includes(c.id)) return removeTactical(c);
      if (gasWith(c) > gas) return;
      const others = new Set(otherCreep(c).map((x) => x.id));
      return onChange({ ...value, cards: [...value.cards.filter((id) => !others.has(id)), c.id] });
    }
    if (gasWith(c) > gas) return;
    onChange({ ...value, cards: [...value.cards, c.id] });
  };
  const removeTactical = (c: CardDef) => {
    const i = value.cards.lastIndexOf(c.id);
    if (i >= 0) onChange({ ...value, cards: value.cards.filter((_, k) => k !== i) });
  };
  const useRecent = (r: RecentArmy) => {
    onFaction?.(r.faction);
    const stamp = Date.now().toString(36);
    onChange({ units: r.units.map((u, i) => ({ ...u, id: `pu-${stamp}-${i}`, tagId: undefined })), cards: r.cards.slice(), name: r.name });
  };
  const fits = (recent ?? []).filter((r) => (anyScale || r.scale === scale) && r.cost <= budget && (!lockFaction || r.faction === faction));
  const scaleName = scale === 'skirmish' ? 'Skirmish' : scale === 'standard' ? 'Standard' : 'Grand';
  const cardBody = (c: CardDef) => (
    <>
      {c.boosts.map((b) => <div key={b.name}><b style={{ display: 'inline', font: 'inherit', color: 'inherit' }}>{b.name}:</b> {b.text}</div>)}
    </>
  );

  return (
    <div className="army-picker">
      {card && createPortal(
        // The unit's card, over the builder: click anywhere off it to put it down. Drawn on the page itself, so
        // neither a panel's cut corner nor the shell's zoom can crop or stretch it.
        <div className="card-modal" role="dialog" onClick={() => setCard(null)}>
          <div className="card-modal-body" onClick={(e) => e.stopPropagation()}>
            <UnitSheet def={unitById(card.defId)} upgrades={card.upgrades} models={card.models} title={card.title} meta={card.meta} />
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><Btn size="sm" onClick={() => setCard(null)}>Close</Btn></div>
          </div>
        </div>,
        document.body,
      )}
      {tip && createPortal(
        // Straight onto the page: a panel's cut corner is a clip-path, and that clips anything inside it,
        // fixed or not, so a tip near the panel's edge would lose half its text.
        <div className="hud-tip army-tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 360), top: Math.min(tip.y + 14, window.innerHeight - 200) }} onMouseEnter={keepTip} onMouseLeave={closeTipSoon}>
          <b>{tip.title}</b>
          {tip.meta && <div className="hud-tip-meta">{tip.meta}</div>}
          <div className="hud-tip-body">{tip.body}</div>
        </div>,
        document.body,
      )}
      {!lockFaction && (
        <div className="row" style={{ marginBottom: 10 }}>
          {(['Terran', 'Zerg', 'Protoss'] as Faction[]).map((f) => (
            <Btn key={f} size="sm" variant={faction === f ? 'primary' : ''} onClick={() => { if (f === faction) return; onFaction?.(f); setSel(null); }}>{f}</Btn>
          ))}
          <span className="small muted">Each race keeps its own army.</span>
        </div>
      )}

      <div className="grid grid-2">
        <div className="stack">
          <h3>Train Units</h3>
          {!factionCard && <p className="small muted" style={{ margin: 0 }}>Select a Faction card first. It gives the army its starting Army Slots and decides which Units and Tactical cards may be included.</p>}
          <div className="army-buildings">
            {buildings.map((b) => (
              <div key={b.name} className="army-building">
                <div className="army-building-head"><Icon name={b.icon} size={48} />{b.name}</div>
                <div className="cmd-grid">
                  {b.defs.map((d) => {
                    const left = leftFor(d);
                    const owns = left === Infinity || left >= Math.min(...d.compositions.map((c) => c.models));
                    // Addable when any of its Composition Options is: the smallest may fit the free Army Slots.
                    const whys = d.compositions.map((c) => addUnitProblem(d, c.label, army));
                    const why = whys.every(Boolean) ? whys[0]! : null;
                    const canBuild = owns && !why;
                    return (
                      <button key={d.id} type="button" className={`cmd-btn ${sel === d.id ? 'on' : ''}`} aria-disabled={!canBuild} onClick={() => canBuild && pick(d)}
                        {...hover({ title: d.name, meta: `${d.role}${d.unique ? ' · unique' : ''} · ${d.compositions.map((c) => `${c.models} for ${c.cost}, Supply ${c.supply}`).join(' / ')}`, body: <>Speed {d.stats.speed ? d.stats.speed.join('/') : '–'}" · Armour {d.stats.armour}+{d.stats.evade ? ` · Evade ${d.stats.evade}+` : ''} · HP {d.stats.hp}{d.stats.shields ? ` +${d.stats.shields} shields` : ''}<br />{d.tags.join(', ')}{why ? <><br />{why}</> : !owns ? <><br />You do not own enough {d.name} models.</> : left !== Infinity ? <><br />{left} model{left === 1 ? '' : 's'} left in your Collection.</> : null}<UnitTipKit def={d} /></> })}>
                        <Icon name={`u_${d.id}`} size={44} />
                        <span className="cmd-cost">{Math.min(...d.compositions.map((c) => c.cost))}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {def && comp && cfg && (
            <div className="army-train">
              <div className="row between">
                <h3>{def.name}</h3>
                <span className="tag accent">{cost} minerals · Supply {comp.supply}</span>
              </div>
              <div className="row" style={{ gap: 6, marginBottom: 6 }}>
                {def.compositions.map((c) => <Btn key={c.label} size="sm" variant={comp.label === c.label ? 'primary' : ''} onClick={() => setComposition(c.label)}>{c.models} model{c.models > 1 ? 's' : ''} · {c.cost}</Btn>)}
              </div>
              <div className="army-upgrades">
                {upgradeOptions(def).map((o) => {
                  const ub = upgradeBuilding(def);
                  const price = composition === 'large' ? o.cost.large : o.cost.small;
                  return (
                    <span key={o.id} role="checkbox" aria-checked={upgrades.includes(o.id)} className={`army-upgrade ${upgrades.includes(o.id) ? 'on' : ''}`} onClick={() => setUpgrades(toggleUpgrade(def, upgrades, o.id))}
                      {...hover({ title: o.name, meta: `+${price} minerals · researched at the ${ub.name}`, body: <>{o.text || ''}{o.note ? <><br />{o.note}</> : null}</> })}>
                      <Icon name={ub.icon} size={28} />{o.name} <span className="muted">+{price}</span>
                    </span>
                  );
                })}
                {upgradeOptions(def).length === 0 && <span className="small muted">No upgrades for this Unit.</span>}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <input placeholder={`Name (optional), e.g. ${def.name} A`} value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 140 }} />
                <label>Copies</label><Stepper value={count} onChange={setCount} min={1} max={Math.max(1, Math.min(6, maxCopies))} />
                <Btn variant="primary" disabled={maxCopies < 1 || spent + cost * count > budget || !!addWhy} title={addWhy ?? (maxCopies < 1 ? `You do not own enough ${def.name} models` : spent + cost * count > budget ? 'Over the Mineral limit' : undefined)} onClick={add}>Add</Btn>
                <Btn size="sm" variant="ghost" onClick={() => setCard({ defId: def.id, upgrades, models: comp.models, title: def.name, meta: `${cost} minerals · Supply ${comp.supply}` })}>Card</Btn>
              </div>
              {addWhy && <p className="small danger-text" style={{ margin: '6px 0 0' }}>{addWhy}</p>}
            </div>
          )}

          <h3>Cards</h3>
          <p className="small muted" style={{ margin: 0 }}>The Faction card and Tactical cards give Army Slots and {resource}. Each Unit occupies Army Slots of its type equal to its starting Supply. <span className={gasSpent > gas ? 'danger-text' : ''}>Vespene Gas {gasSpent} / {gas}</span>{SLOTS.filter((s) => slots[s] || usedSlots[s]).map((s) => <span key={s} className={usedSlots[s] > slots[s] ? 'danger-text' : ''}> · {s} {usedSlots[s]}/{slots[s]}</span>)}</p>
          <div className="cmd-grid">
            {factionCards.map((c) => (
              <button key={c.id} type="button" className={`cmd-btn card-btn ${factionCard?.id === c.id ? 'on' : ''}`} onClick={() => setFactionCard(c.id)}
                {...hover({ title: c.name, meta: `Faction card · ${c.resource} ${resource} · slots ${SLOTS.filter((s) => c.slots[s]).map((s) => `${c.slots[s]} ${s}`).join(', ') || 'none'}`, body: cardBody(c) })}>
                <Icon name={`c_${c.id}`} size={52} />
              </button>
            ))}
            {tacticalCards.map((c) => {
              const n = value.cards.filter((id) => id === c.id).length;
              const creep = isCreepCard(c);
              // Faction Tags (9.1.2): a card the Faction card does not allow is not on offer; one already in the army can only be put back.
              const needs = cardNeeds(c, factionCard);
              const noGas = gasWith(c) > gas;
              const off = !n && (!!needs || noGas);
              return (
                <button key={c.id} type="button" className={`cmd-btn card-btn ${n ? 'on' : ''}`} aria-disabled={off} onClick={() => (needs ? removeTactical(c) : !off && addTactical(c))} onContextMenu={(e) => { e.preventDefault(); removeTactical(c); }}
                  {...hover({ title: c.name, meta: `${creep ? 'Creep card' : 'Tactical card'} · ${c.cost} gas · ${c.resource} ${resource} · slots ${SLOTS.filter((s) => c.slots[s]).map((s) => `${c.slots[s]} ${s}`).join(', ') || 'none'}${creep ? ' · one per army' : ''}`, body: <>{cardBody(c)}{needs ? <><br />{needs}{n ? ' Click to remove.' : ''}</> : n ? <><br />{creep ? 'In your army. Click to remove.' : noGas ? `${n} in your army. Not enough Vespene Gas for another. Right-click to remove one.` : `${n} in your army. Click to add another, right-click to remove one.`}</> : noGas ? <><br />Not enough Vespene Gas.</> : creep && otherCreep(c).length ? <><br />Takes the place of {otherCreep(c)[0]!.name}.</> : null}</> })}>
                  <Icon name={`c_${c.id}`} size={52} />
                  <span className="cmd-cost">{c.cost}</span>
                  {n > 0 && <span className="cmd-count">{n === 1 ? '✓' : `×${n}`}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="stack">
          <div className="row between">
            <h3>Your army</h3>
            <span className={`tag ${spent > budget ? 'danger' : 'accent'}`}>{spent} / {budget} minerals</span>
          </div>
          {problems.length > 0 && (
            <ul className="small danger-text" style={{ margin: 0, paddingLeft: 18 }}>
              {problems.map((p) => <li key={p.text}>{p.text}</li>)}
            </ul>
          )}
          {units.length === 0 && <p className="muted">No Units yet. Train them from the buildings on the left.</p>}
          {units.map((u) => (
            <div key={u.id} className="army-unit-row">
              <Icon name={`u_${u.defId}`} size={36} />
              <span><b>{u.name}</b><br /><span className="small muted">{configLabel(u)} · {slotLabel(u)}</span></span>
              <span className="small">{configCost(u)}</span>
              <Btn size="sm" variant="ghost" onClick={() => setCard({ defId: u.defId, upgrades: u.upgrades, models: u.models, title: u.name, meta: `${configCost(u)} minerals · ${u.models} model${u.models === 1 ? '' : 's'}` })}>card</Btn>
              <Btn size="sm" variant="ghost" onClick={() => onChange({ ...value, units: units.filter((x) => x.id !== u.id) })}>remove</Btn>
            </div>
          ))}
          {units.length > 0 && <Btn size="sm" variant="ghost" onClick={() => onChange({ units: [], cards: [], name: '' })}>Clear the army</Btn>}
          {named && (
            <label className="stack" style={{ marginTop: 8, gap: 4 }}>
              <span className="small muted">Army name (optional). The army and its cards are saved under this name when it goes into battle. Unnamed, it is saved as “{faction} army 2” or similar.</span>
              <input placeholder={faction === 'Zerg' ? 'e.g. Kerrigan\'s Brood' : faction === 'Protoss' ? 'e.g. Templar Vanguard' : 'e.g. Raynor\'s Raiders'} value={value.name ?? ''} onChange={(e) => onChange({ ...value, name: e.target.value })} />
            </label>
          )}

          {recent && (
            <>
              <h3 style={{ marginTop: 14 }}>Saved armies{anyScale ? '' : ` · ${scaleName}`}</h3>
              {fits.length === 0 && <p className="small muted">None saved {anyScale ? '' : `for a ${scaleName.toLowerCase()} game `}within {budget} minerals{lockFaction ? ` for ${faction}` : ''} yet. Armies taken into battle are saved here with their cards.</p>}
              <div className="army-recent">
                {fits.map((r) => (
                  <div key={r.id} className="army-recent-row">
                    <span>
                      <b>{r.name}</b> <span className="small muted">· {r.faction} · {r.cost} minerals · {r.units.length} unit{r.units.length === 1 ? '' : 's'} · {r.cards.length} card{r.cards.length === 1 ? '' : 's'}</span>
                      <span className="cmd-grid" style={{ marginTop: 4 }}>{r.units.map((u) => <span key={u.id} className="cmd-btn"><Icon name={`u_${u.defId}`} size={24} /></span>)}</span>
                    </span>
                    <span className="row">
                      <Btn size="sm" title={`Bring back ${r.name}: its units and its ${r.cards.length} card${r.cards.length === 1 ? '' : 's'}`} onClick={() => useRecent(r)}>Use</Btn>
                      {onForget && <Btn size="sm" variant="ghost" onClick={() => onForget(r.id)}>forget</Btn>}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
