import { useMemo, useState } from 'react';
import type { Faction } from '@engine/types/units';
import type { Scale } from '@engine/types/game';
import { unitById } from '@data/index';
import { playerUnitSupply } from '@engine/sense/playerUnits';
import { configCostOf } from '@engine/army/force';
import { ownedModels, physicalModelId } from '@engine/army/collection';
import { validatePlayerArmy } from '@engine/army/rules';
import { useCollection } from '@tt/store/collectionStore';
import { useSettings, type RecentArmy } from '@tt/store/settingsStore';
import { useUi } from '@tt/store/uiStore';
import { ArmyPicker, type ArmyValue } from '../components/ArmyPicker';
import { ArmySheet } from '../components/ArmySheet';
import { Btn, Panel, Toggle } from '../components/Basics';

const FACTIONS: Faction[] = ['Terran', 'Zerg', 'Protoss'];
const SCALES: Scale[] = ['skirmish', 'standard', 'grand'];
/** What a game of each size gives you to spend, and what it is played on. */
const SCALE_NOTE: Record<Scale, { budget: number; note: string }> = {
  skirmish: { budget: 1000, note: 'up to 1,000 minerals on 36"×36"' },
  standard: { budget: 2000, note: 'up to 2,000 minerals on 36"×54"' },
  grand: { budget: 3000, note: '2,001+ minerals on 36"×72"' },
};

const cost = (a: { units: RecentArmy['units'] }) => a.units.reduce((n, u) => n + configCostOf(u), 0);
const supply = (a: { units: RecentArmy['units'] }) => a.units.reduce((n, u) => n + playerUnitSupply(u), 0);

/** Miniatures an army asks for beyond the ones in the Collection, counted per model. */
function missingModels(units: RecentArmy['units'], owned: Record<string, number>): { name: string; short: number }[] {
  const need: Record<string, number> = {};
  for (const u of units) need[physicalModelId(u.defId)] = (need[physicalModelId(u.defId)] ?? 0) + u.maxModels;
  return Object.entries(need)
    .map(([id, n]) => ({ name: unitById(id).name, short: n - (owned[id] ?? 0) }))
    .filter((x) => x.short > 0);
}

/** A line of a saved army: what it is made of, in the order the list shows it. */
function summary(a: RecentArmy): string {
  return a.units.map((u) => `${u.models}× ${unitById(u.defId).name}`).join(', ');
}

/**
 * The army builder, on its own. Build a force against your Collection whenever you like, name it, keep it, and
 * pick it up again when a battle starts: the setup wizard offers everything saved here, and anything you take
 * into a battle lands back in this list. Nothing here starts a game.
 */
export function ArmiesScreen() {
  const settings = useSettings();
  const go = useUi((s) => s.go);
  const armies = settings.recentArmies;
  const [editing, setEditing] = useState<{ id: string | null; faction: Faction; scale: Scale; budget: number; value: ArmyValue } | null>(null);
  /** Build from the shelf, or from the whole game: a list you cannot field yet is still worth writing down. */
  const [fromCollection, setFromCollection] = useState(true);
  /** The army written out for paper, ready to print. */
  const [printing, setPrinting] = useState<{ name: string; faction: Faction; scale: Scale; units: RecentArmy['units']; cards: string[] } | null>(null);
  const collection = useCollection();
  const owned = useMemo(() => ownedModels(collection), [collection]);

  const startNew = (faction: Faction, scale: Scale) =>
    setEditing({ id: null, faction, scale, budget: SCALE_NOTE[scale].budget, value: { units: [], cards: [], name: '' } });

  const edit = (a: RecentArmy) =>
    setEditing({ id: a.id, faction: a.faction, scale: a.scale, budget: Math.max(SCALE_NOTE[a.scale].budget, cost(a)), value: { units: a.units, cards: a.cards, name: a.name } });

  const duplicate = (a: RecentArmy) =>
    setEditing({ id: null, faction: a.faction, scale: a.scale, budget: Math.max(SCALE_NOTE[a.scale].budget, cost(a)), value: { units: a.units, cards: a.cards, name: `${a.name} copy` } });

  const save = () => {
    if (!editing || !editing.value.units.length) return;
    // Only an army that may be fielded is saved (Part 9.1): within its Mineral and Vespene limits, its Army Slots and its Faction card's tags.
    if (validatePlayerArmy({ cards: editing.value.cards, units: editing.value.units, minerals: editing.budget }).length) return;
    // Saving under a new name leaves the old army alone; saving the one you opened replaces it.
    const saved = settings.pushRecentArmy({ name: editing.value.name ?? '', faction: editing.faction, scale: editing.scale, cost: cost(editing.value), units: editing.value.units, cards: editing.value.cards });
    const old = editing.id ? armies.find((a) => a.id === editing.id) : undefined;
    if (old && old.name !== saved) settings.removeRecentArmy(old.id);
    setEditing(null);
  };

  if (printing) {
    return (
      <div>
        <div className="row between no-print" style={{ alignItems: 'baseline' }}>
          <h1>Army page</h1>
          <div className="row" style={{ gap: 8 }}>
            <Btn variant="primary" onClick={() => window.print()}>Print</Btn>
            <Btn variant="ghost" onClick={() => setPrinting(null)}>Close</Btn>
          </div>
        </div>
        <p className="muted no-print">Only the page below is printed.</p>
        <ArmySheet name={printing.name} faction={printing.faction} scale={printing.scale} units={printing.units} cards={printing.cards} />
      </div>
    );
  }

  if (editing) {
    const spent = cost(editing.value);
    const problems = editing.value.units.length ? validatePlayerArmy({ cards: editing.value.cards, units: editing.value.units, minerals: editing.budget }) : [];
    return (
      <div>
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <h1>{editing.id ? 'Edit army' : 'New army'}</h1>
          <span className="muted small">{spent} / {editing.budget} minerals · {supply(editing.value)} Supply</span>
        </div>
        <p className="muted">Select a Faction card, add the Tactical cards that give the Army Slots you need, then pick Units from the buildings that train them and choose the size and upgrades of each. Saved armies can be picked when setting up a battle.</p>

        <Panel title="Size of game" tag={SCALE_NOTE[editing.scale].note}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {SCALES.map((s) => (
              <Btn key={s} variant={editing.scale === s ? 'primary' : ''} onClick={() => setEditing({ ...editing, scale: s, budget: SCALE_NOTE[s].budget })}>{s}</Btn>
            ))}
            <label className="row small" style={{ gap: 6, marginLeft: 'auto' }}>
              Minerals
              <input type="number" value={editing.budget} step={50} min={200} style={{ width: 110 }} onChange={(e) => setEditing({ ...editing, budget: Number(e.target.value) || 0 })} />
            </label>
          </div>
          <div className="row" style={{ gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Toggle on={fromCollection} onChange={setFromCollection}>Only models I own</Toggle>
            <span className="small muted">
              {fromCollection
                ? 'Units you have no miniatures left for cannot be added. Turn this off to plan with any Unit.'
                : 'Any Unit can be added. A battle still needs the miniatures, so this army may not be fieldable yet.'}
            </span>
          </div>
          {!fromCollection && !!editing.value.units.length && (() => {
            const short = missingModels(editing.value.units, owned);
            return short.length ? <p className="small danger-text" style={{ margin: '8px 0 0' }}>Beyond your Collection: {short.map((x) => `${x.short}× ${x.name}`).join(', ')}.</p> : null;
          })()}
        </Panel>

        <ArmyPicker
          faction={editing.faction}
          onFaction={(f) => setEditing({ ...editing, faction: f, value: { units: [], cards: [], name: editing.value.name } })}
          budget={editing.budget}
          scale={editing.scale}
          owned={fromCollection ? owned : undefined}
          value={editing.value}
          onChange={(value) => setEditing({ ...editing, value })}
          named
        />

        <div className="row" style={{ gap: 8, marginTop: 12 }}>
          <Btn variant="primary" size="lg" disabled={!editing.value.units.length || problems.length > 0} title={problems[0]?.text} onClick={save}>Save army</Btn>
          <Btn variant="ghost" onClick={() => setEditing(null)}>Cancel</Btn>
          <Btn disabled={!editing.value.units.length} onClick={() => setPrinting({ name: editing.value.name?.trim() || `${editing.faction} army`, faction: editing.faction, scale: editing.scale, units: editing.value.units, cards: editing.value.cards })}>Print this army</Btn>
          {problems[0] && <span className="small danger-text">{problems[0].text}</span>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <h1>Armies</h1>
        <span className="muted small">{armies.length} saved</span>
      </div>
      <p className="muted">Saved armies can be picked when setting up a battle. Any army taken into a battle is saved here too.</p>

      <Panel title="New army" tag="pick a faction and a size">
        <div className="stack" style={{ gap: 10 }}>
          {FACTIONS.map((f) => (
            <div key={f} className="row" style={{ gap: 8, alignItems: 'center' }}>
              <b style={{ fontFamily: 'var(--font-head)', minWidth: 90 }}>{f}</b>
              {SCALES.map((s) => (
                <Btn key={s} size="sm" onClick={() => startNew(f, s)}>{s}</Btn>
              ))}
            </div>
          ))}
          <p className="small muted" style={{ margin: 0 }}>Skirmish: {SCALE_NOTE.skirmish.note}. Standard: {SCALE_NOTE.standard.note}. Grand: {SCALE_NOTE.grand.note}. Any mineral limit can be set while building.</p>
        </div>
      </Panel>

      <Panel title="Saved armies">
        {!armies.length && <p className="small muted">No saved armies yet. Build one above, or take an army into a battle.</p>}
        <div className="stack" style={{ gap: 8 }}>
          {armies.map((a) => (
            <div key={a.id} className="list-row">
              <div className="title">
                <b>{a.name}</b>
                <span className="small muted">{a.faction} · {a.scale} · {cost(a)} minerals · {supply(a)} Supply · {a.units.length} unit{a.units.length === 1 ? '' : 's'}{a.cards.length ? ` · ${a.cards.length} card${a.cards.length === 1 ? '' : 's'}` : ''}</span>
              </div>
              <div className="small muted">{summary(a)}</div>
              {(() => {
                const short = missingModels(a.units, owned);
                return short.length ? <div className="small danger-text">Needs {short.map((x) => `${x.short}× ${x.name}`).join(', ')} beyond your Collection.</div> : null;
              })()}
              {(() => {
                // An army saved before it was checked: it opens for editing, and cannot go into battle as it is.
                const wrong = validatePlayerArmy({ cards: a.cards, units: a.units, minerals: Math.max(SCALE_NOTE[a.scale].budget, cost(a)) })[0];
                return wrong ? <div className="small danger-text">{wrong.text}</div> : null;
              })()}
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <Btn size="sm" variant="primary" onClick={() => edit(a)}>Edit</Btn>
                <Btn size="sm" onClick={() => duplicate(a)}>Duplicate</Btn>
                <Btn size="sm" onClick={() => setPrinting({ name: a.name, faction: a.faction, scale: a.scale, units: a.units, cards: a.cards })}>Print</Btn>
                <Btn size="sm" variant="ghost" onClick={() => go('setup')}>Use in a battle</Btn>
                <Btn size="sm" variant="danger" onClick={() => settings.removeRecentArmy(a.id)}>Delete</Btn>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
