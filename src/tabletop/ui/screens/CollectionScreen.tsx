import { useState } from 'react';
import type { Faction } from '@engine/types/units';
import { modelUnits, unitsFromModel } from '@engine/army/collection';
import { useCollection } from '@tt/store/collectionStore';
import { useSettings } from '@tt/store/settingsStore';
import { Btn, Panel, Toggle } from '../components/Basics';
import { TerrainInventory } from '../components/TerrainInventory';

const FACTIONS: Faction[] = ['Terran', 'Zerg', 'Protoss'];
type Tab = 'models' | 'terrain';

/**
 * What you actually own, counted in miniatures. Armies — yours and the AI's —
 * are only ever built from this, so the app never asks you to field something that is not on your shelf.
 * Variants share their model: Raynor's Raiders are Marines, Swarmlings are Zerglings.
 */
export function CollectionScreen() {
  const c = useCollection();
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('models');
  const all = modelUnits();
  const ownedCount = all.filter((u) => (c.models[u.id] ?? 0) > 0).length;

  return (
    <div>
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <h1>Collection</h1>
        <span className="muted small">{ownedCount} of {all.length} models</span>
      </div>
      <p className="muted">Type how many of each miniature you own, or use the button to add a squad's worth.
        Army building and the AI's force both draw from this list.</p>

      <div className="tabs">
        {(['models', 'terrain'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'models' && (
        <Panel title="Models">
          <div className="row" style={{ marginBottom: 8 }}>
            <Btn size="sm" onClick={c.ownEverything}>I own everything</Btn>
            <Btn size="sm" variant="ghost" onClick={c.clear}>Clear</Btn>
          </div>
          {FACTIONS.map((f) => (
            <div key={f} style={{ marginBottom: 14 }}>
              <h3 style={{ margin: '6px 0' }}>{f}</h3>
              <div className="col">
                {all.filter((u) => u.faction === f).map((u) => {
                  // Units built from this miniature, so it is clear one pool covers all of them.
                  const variants = unitsFromModel(u.id).filter((v) => v.id !== u.id);
                  const owned = c.models[u.id] ?? 0;
                  const squad = u.compositions[0]?.models ?? 1;
                  return (
                    <div key={u.id} className={`row between ${owned ? '' : 'muted'}`} style={{ borderBottom: '1px dashed var(--line)', padding: '6px 0' }}>
                      <span>
                        <b>{u.name}</b>
                        <span className="small muted"> {u.role} · {u.compositions.map((x) => `${x.models} for ${x.cost}`).join(' / ')}
                          {variants.length ? ` · also fields ${variants.map((v) => v.name.replace(/\s*\(.*\)$/, '')).join(', ')}` : ''}</span>
                      </span>
                      <span className="row" style={{ gap: 6 }}>
                        <input
                          type="number"
                          min={0}
                          max={99}
                          value={owned}
                          aria-label={`${u.name} models owned`}
                          onChange={(e) => c.setModels(u.id, Math.max(0, Math.min(99, Math.floor(Number(e.target.value) || 0))))}
                          style={{ width: 62, textAlign: 'right' }}
                        />
                        <Btn size="sm" variant="ghost" title={`Add a squad of ${squad}`} onClick={() => c.setModels(u.id, owned + squad)}>+{squad}</Btn>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="stack" style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <Toggle on={c.enforce.player} onChange={(v) => c.setEnforce({ player: v })}>Limit my army to models I own</Toggle>
            <Toggle on={c.enforce.ai} onChange={(v) => c.setEnforce({ ai: v })}>Limit the AI's army to models I own</Toggle>
            <span className="small muted">Turn these off to play with proxies.</span>
          </div>
        </Panel>
      )}

      {tab === 'terrain' && (
        <Panel title="Terrain">
          <TerrainInventory />
        </Panel>
      )}
    </div>
  );
}
