import { useState } from 'react';
import { TERRAIN_CATALOG, TERRAIN_SETS, setContents, type TerrainCatalogItem, type TerrainSetId } from '@data/terrainCatalog';
import type { TerrainSize } from '@engine/types/terrain';
import { useSettings, terrainInventory } from '@tt/store/settingsStore';
import { Btn, Stepper, Toggle } from './Basics';
import { refUrl, useRefArt, type RefArt } from './refArt';

const SIZE_HELP: Record<number, string> = {
  0: 'Size 0: scatter, no cover, walk through',
  1: 'Size 1: cover for infantry, walk through',
  2: 'Size 2: blocks sight and movement',
  3: 'Size 3: high ground with a ramp',
};

/** Downscale an image file to a small JPEG data URL for storage. */
export async function thumbnailFromFile(file: File, max = 160): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function TerrainThumb({ id, size = 40 }: { id: string; size?: number }) {
  const src = useSettings((s) => s.terrainImages[id]);
  if (!src) return null;
  return <img src={src} alt="" style={{ width: size, height: size, objectFit: 'cover', border: '1px solid var(--line-2)', verticalAlign: 'middle', marginRight: 6 }} />;
}

function PhotoButton({ id }: { id: string }) {
  const s = useSettings();
  const has = !!s.terrainImages[id];
  return (
    <span className="row" style={{ gap: 2 }}>
      <label className="btn btn-sm terrain-photo" title={has ? 'Change the photo of this piece' : 'Add a photo of this piece for the table setup legend'} style={{ cursor: 'pointer' }}>
        {has ? 'Change' : 'Photo'}
        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) thumbnailFromFile(f).then((d) => s.setTerrainImage(id, d)).catch(() => alert('Could not read that image.')); e.target.value = ''; }} />
      </label>
      {has && <Btn size="sm" variant="ghost" title="Remove the photo" onClick={() => s.setTerrainImage(id, null)}>×</Btn>}
    </span>
  );
}

/** One piece in the collection: name and footprint, its photo, and how many you own. One line, so the whole
 *  catalogue reads as a list and not a wall. */
function Row({ item, art }: { item: TerrainCatalogItem; art: RefArt | null }) {
  const s = useSettings();
  const owned = s.terrainOwned[item.id] ?? 0;
  // The rulebook's picture of the piece, so you know which one it is on your shelf. A piece of your own has none:
  // it keeps its photo instead.
  const pic = item.ref && art?.images[`${item.ref}--render`] ? refUrl(item.ref, 'render') : null;
  return (
    <div className={`terrain-row ${owned ? 'owned' : ''}`} title={item.grass ? 'Grass: blocks sight, not movement' : SIZE_HELP[item.size] ?? `Size ${item.size}`}>
      <span className="terrain-row-pic">{pic ? <img src={pic} alt="" loading="lazy" /> : item.id.startsWith('custom-') ? (s.terrainImages[item.id] ? <TerrainThumb id={item.id} size={44} /> : <PhotoButton id={item.id} />) : null}</span>
      <span className="terrain-row-name">
        <b>{item.label}</b>
        <span className="small muted">{item.w}×{item.h}" · {item.grass ? 'grass' : `Size ${item.size}`}</span>
        {item.id.startsWith('custom-') && s.terrainImages[item.id] && <PhotoButton id={item.id} />}
        {item.id.startsWith('custom-') && <Btn size="sm" variant="ghost" onClick={() => s.removeCustomTerrain(item.id)}>remove</Btn>}
      </span>
      <Stepper value={owned} onChange={(v) => s.setTerrainOwned(item.id, v)} max={30} />
    </div>
  );
}

/** Pick the terrain pieces you own; the generator only places these. */
export function TerrainInventory() {
  const s = useSettings();
  const [name, setName] = useState('');
  const [size, setSize] = useState<TerrainSize>(2);
  const [grass, setGrass] = useState(false);
  const [w, setW] = useState(6);
  const [h, setH] = useState(4);
  const [count, setCount] = useState(1);
  const [adding, setAdding] = useState(false);
  const art = useRefArt();
  const inv = terrainInventory(s);
  const total = inv.reduce((a, i) => a + i.count, 0);
  const sig = inv.filter((i) => i.size >= 2 && !i.grass).reduce((a, i) => a + i.count, 0);
  const setsOwned = (setId: TerrainSetId) => {
    const c = setContents(setId);
    return Math.min(...Object.entries(c).map(([id, n]) => Math.floor((s.terrainOwned[id] ?? 0) / n)));
  };
  return (
    <div>
      <div className="row between">
        <Toggle on={s.useOwnTerrain} onChange={(v) => s.set({ useOwnTerrain: v })}>Only use terrain I own</Toggle>
        <span className="small muted">{s.useOwnTerrain ? `${total} pieces (${sig} blocking)` : 'Lost Temple set and Ramp, scaled to the table'}</span>
      </div>
      <div className="grid grid-2" style={{ marginTop: 10 }}>
        {TERRAIN_SETS.map((set) => (
          <div key={set.id} className="panel" style={{ marginBottom: 0, padding: 10 }}>
            <div className="row between">
              <b style={{ fontFamily: 'var(--font-head)' }}>{set.name}</b>
              <span className="row"><span className="tag">{setsOwned(set.id)} owned</span><Btn size="sm" variant="primary" onClick={() => s.addTerrainSet(set.id, 1)}>+ Add set</Btn><Btn size="sm" variant="ghost" onClick={() => s.addTerrainSet(set.id, -1)} disabled={setsOwned(set.id) === 0}>−</Btn></span>
            </div>
            <p className="small muted" style={{ margin: '6px 0 0' }}>{set.blurb}</p>
          </div>
        ))}
      </div>
      {s.useOwnTerrain && (
        <>
          {sig < 4 && <p className="tag warn" style={{ marginTop: 8 }}>Add at least 4 blocking (Size 2+) pieces for a balanced table.</p>}
          <div className="row between" style={{ marginTop: 12 }}>
            <p className="small muted" style={{ margin: 0 }}>Enter how many of each piece you own. Pictures are from the rulebook's terrain key.</p>
            <Btn size="sm" variant={adding ? '' : 'ghost'} onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : '+ A piece of your own'}</Btn>
          </div>
          <div className="terrain-rows">
            {[...TERRAIN_CATALOG, ...s.terrainCustom].map((i) => <Row key={i.id} item={i} art={art} />)}
          </div>
          {adding && <div className="panel" style={{ marginTop: 12 }}>
            <h3>Add a piece of your own</h3>
            <div className="row">
              <input placeholder="Name, e.g. Supply depot" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
              <select value={size} onChange={(e) => setSize(Number(e.target.value) as TerrainSize)}>
                <option value={0}>Size 0</option>
                <option value={1}>Size 1</option>
                <option value={2}>Size 2</option>
                <option value={3}>Size 3 (high ground)</option>
              </select>
              <Toggle on={grass} onChange={setGrass}>Grass</Toggle>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <label>Width "</label><input type="number" value={w} min={1} max={24} step={0.5} onChange={(e) => setW(Number(e.target.value) || 1)} />
              <label>Depth "</label><input type="number" value={h} min={1} max={24} step={0.5} onChange={(e) => setH(Number(e.target.value) || 1)} />
              <label>Count</label><Stepper value={count} onChange={setCount} min={1} max={30} />
              <Btn variant="primary" size="sm" disabled={!name.trim()} onClick={() => { s.addCustomTerrain({ label: name.trim(), size: grass ? 2 : size, grass, w, h }, count); setName(''); }}>Add</Btn>
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>To attach a picture, press Photo on the new row.</p>
          </div>}
        </>
      )}
    </div>
  );
}
