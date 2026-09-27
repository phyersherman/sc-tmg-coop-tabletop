import type { DeploymentLayout, TerrainLayout } from '@engine/types/terrain';
import type { MarkerState } from '@engine/types/game';
import { rampLane, zoiRect } from '@engine/terrain/geometry';
import { TerrainThumb } from './TerrainInventory';
import { isLSide, KEY_COLOUR, refSlug, refUrl, useRefArt } from './refArt';

export interface MapOverlayPoint {
  x: number;
  y: number;
  label: string;
  kind?: 'rift' | 'base' | 'point';
}

const FACTION_COLOR: Record<string, string> = { Terran: '#4ea8de', Zerg: '#b06bd6', Protoss: '#e0b23c' };

export function TableMap({ deployment, terrain, markers, overlays = [], models, spriteTerrain = false, hideNumbers = false, beaconMarkers = false, hideOutlines = false, margin = 1, subtleEntry = false, aiFaction, playerFaction, refArt = false }: { deployment: DeploymentLayout; terrain?: TerrainLayout; markers?: MarkerState[]; overlays?: MapOverlayPoint[]; models?: { ai: { x: number; y: number }[]; players: { x: number; y: number }[] }; spriteTerrain?: boolean; /** Video game mode: no piece numbers (they are for matching the physical table). */ hideNumbers?: boolean; /** The battlefield draws markers as beacons; the map keeps only the control radius and lock. */ beaconMarkers?: boolean; /** Hide terrain footprint outlines. */ hideOutlines?: boolean; /** Ground drawn around the table, in inches (the battlefield matches its own margin). */ margin?: number; /** Entry zones as small corner brackets in faction colours instead of coloured bands. */ subtleEntry?: boolean; aiFaction?: string; playerFaction?: string; /** Draw each piece with the rulebook's own picture of it (table setup). */ refArt?: boolean }) {
  const aiColor = FACTION_COLOR[aiFaction ?? ''] ?? '#ef6a6a';
  const playerColor = FACTION_COLOR[playerFaction ?? ''] ?? '#60a5fa';
  const t = deployment.table;
  const art = useRefArt();
  const W = t.width;
  const H = t.height;
  const grid: number[] = [];
  for (let x = 6; x < W; x += 6) grid.push(x);
  const gridY: number[] = [];
  for (let y = 6; y < H; y += 6) gridY.push(y);
  const fill = (size: number, grass: boolean) => (grass ? 'rgba(74,222,128,0.25)' : size === 0 ? 'rgba(148,163,184,0.15)' : size === 1 ? 'rgba(148,163,184,0.35)' : size === 2 ? 'rgba(96,165,250,0.45)' : 'rgba(234,179,8,0.45)');
  const stroke = (size: number, grass: boolean) => (grass ? '#4ade80' : size >= 3 ? '#eab308' : size === 2 ? '#93c5fd' : '#94a3b8');
  const segLine = (seg: DeploymentLayout['entry']['red'][number]) => {
    switch (seg.edge) {
      case 'N': return { x1: seg.from, y1: 0, x2: seg.to, y2: 0 };
      case 'S': return { x1: seg.from, y1: H, x2: seg.to, y2: H };
      case 'W': return { x1: 0, y1: seg.from, x2: 0, y2: seg.to };
      case 'E': return { x1: W, y1: seg.from, x2: W, y2: seg.to };
    }
  };
  /**
   * The entry zone marked like the L-shaped markers in the starter boxes: one at each end of the zone's inner
   * limit, with the arms turning back along the zone.
   */
  const entryMarks = (seg: DeploymentLayout['entry']['red'][number], color: string) => {
    const z = zoiRect(seg, t);
    const arm = Math.min(2.4, z.w / 2.5, z.h / 2.5);
    // Only the inner limit of the zone is marked; the map edge already speaks for itself.
    const inner = seg.edge === 'N' ? z.y + z.h : seg.edge === 'S' ? z.y : null;
    const innerX = seg.edge === 'W' ? z.x + z.w : seg.edge === 'E' ? z.x : null;
    const sy = seg.edge === 'N' ? -1 : 1;
    const sx = seg.edge === 'W' ? -1 : 1;
    const corners: [number, number, number, number][] = inner !== null
      ? [[z.x, inner, 1, sy], [z.x + z.w, inner, -1, sy]]
      : [[innerX!, z.y, sx, 1], [innerX!, z.y + z.h, sx, -1]];
    return corners.map(([cx, cy, sx, sy], i) => (
      <path
        key={`${seg.edge}${seg.from}${i}`}
        d={`M ${cx + sx * arm} ${cy} L ${cx} ${cy} L ${cx} ${cy + sy * arm}`}
        fill="none"
        stroke={color}
        strokeWidth={0.28}
        strokeLinecap="square"
        opacity={0.8}
      />
    ));
  };
  const mk = markers ?? deployment.markers.map((m) => ({ ...m, affinity: m.id === 5 ? 'neutral' : m.id === 1 || m.id === 3 ? 'ai' : 'players', controlledBy: null, active: true }) as MarkerState);
  return (
    <div className="map-wrap" style={{ height: '100%' }}>
      <svg style={{ height: '100%' }} viewBox={`${-margin} ${-margin} ${W + 2 * margin} ${H + 2 * margin}`} xmlns="http://www.w3.org/2000/svg" fontFamily="var(--font-mono)">
        <rect x={0} y={0} width={W} height={H} fill={spriteTerrain ? 'none' : '#0e1a2e'} stroke={spriteTerrain ? 'rgba(0,0,0,0.6)' : '#2b4f7f'} strokeWidth={0.3} />
        {grid.map((x) => <line key={`gx${x}`} x1={x} y1={0} x2={x} y2={H} stroke={spriteTerrain ? "rgba(0,0,0,0.18)" : "#1e3a5f"} strokeWidth={0.08} />)}
        {gridY.map((y) => <line key={`gy${y}`} x1={0} y1={y} x2={W} y2={y} stroke={spriteTerrain ? "rgba(0,0,0,0.18)" : "#1e3a5f"} strokeWidth={0.08} />)}
        <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="#2b4f7f" strokeWidth={0.12} strokeDasharray="0.6 0.6" />
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="#2b4f7f" strokeWidth={0.12} strokeDasharray="0.6 0.6" />
        {!subtleEntry && deployment.entry.red.map((s, i) => { const z = zoiRect(s, t); return <rect key={`zr${i}`} x={z.x} y={z.y} width={z.w} height={z.h} fill="rgba(239,106,106,0.16)" />; })}
        {!subtleEntry && deployment.entry.blue.map((s, i) => { const z = zoiRect(s, t); return <rect key={`zb${i}`} x={z.x} y={z.y} width={z.w} height={z.h} fill="rgba(96,165,250,0.16)" />; })}
        {subtleEntry
          ? [...deployment.entry.red.map((s, i) => <g key={`mr${i}`}>{entryMarks(s, aiColor)}</g>), ...deployment.entry.blue.map((s, i) => <g key={`mb${i}`}>{entryMarks(s, playerColor)}</g>)]
          : [...deployment.entry.red.map((s, i) => { const l = segLine(s); return <line key={`er${i}`} {...l} stroke="#ef6a6a" strokeWidth={0.7} />; }),
             ...deployment.entry.blue.map((s, i) => { const l = segLine(s); return <line key={`eb${i}`} {...l} stroke="#60a5fa" strokeWidth={0.7} />; })]}
        {refArt && art && terrain?.pieces.map((p) => {
          // The rulebook's footprint of the piece, turned to where it lies. An L is placed side by side, so each
          // side gets its own arm of the picture (or its key colour, without one).
          const lSide = isLSide(p.label) ? (/short side$/.test(p.label) ? 'short' : 'long') : null;
          const base = refSlug(p.label);
          const slug = lSide ? `${base}-${lSide}` : base;
          const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
          const turn = p.rot ? `rotate(${p.rot} ${cx} ${cy})` : undefined;
          const size = art.images[`${slug}--footprint`];
          if (size && slug === 'lost-temple-ramp') {
            // The picture's ramp opens at its left end and runs along its bottom side. Lay it on the piece the way the
            // rules see it (rampLane): left end at the access end, bottom side on the ramp's side, so a ramp that lies
            // mirrored on the table is drawn mirrored too.
            const r = rampLane(p);
            const o = r.toTable(0, 0), ua = r.toTable(1, 0), na = r.toTable(0, 1);
            const X = { x: o.x - ua.x, y: o.y - ua.y };
            const Y = { x: r.side * (na.x - o.x), y: r.side * (na.y - o.y) };
            return <image key={`ref${p.n}`} href={refUrl(slug, 'footprint')} x={-r.hl} y={-r.ht} width={r.hl * 2} height={r.ht * 2} preserveAspectRatio="none" transform={`matrix(${X.x} ${X.y} ${Y.x} ${Y.y} ${o.x} ${o.y})`} />;
          }
          if (lSide && !size) return <rect key={`ref${p.n}`} x={p.x} y={p.y} width={p.w} height={p.h} transform={turn} fill={KEY_COLOUR[base] ?? '#94a3b8'} opacity={0.9} />;
          if (!size) return null;
          // A picture drawn across when the piece lies along: turn it a quarter to fit.
          const across = (size[1] > size[0]) !== (p.h > p.w);
          const w = across ? p.h : p.w, h = across ? p.w : p.h;
          return (
            <g key={`ref${p.n}`} transform={turn}>
              <image href={refUrl(slug, 'footprint')} x={cx - w / 2} y={cy - h / 2} width={w} height={h} preserveAspectRatio="none" transform={across ? `rotate(90 ${cx} ${cy})` : undefined} />
            </g>
          );
        })}
        {terrain?.pieces.map((p) => {
          // On the battlefield, pieces are drawn as what they are: no box round them (the ground layer keeps a
          // faint footprint for walls) and no number over them.
          const bare = spriteTerrain && (p.grass || p.size <= 1);
          const boxless = spriteTerrain;
          return (
          <g key={p.n}>
            {!hideOutlines && !bare && !boxless && <rect x={p.x} y={p.y} width={p.w} height={p.h} transform={p.rot ? `rotate(${p.rot} ${p.x + p.w / 2} ${p.y + p.h / 2})` : undefined} fill={spriteTerrain || (refArt && art) ? 'none' : fill(p.size, p.grass)} stroke={stroke(p.size, p.grass)} opacity={spriteTerrain ? 0.3 : 1} strokeWidth={p.size >= 2 && !p.grass ? 0.25 : 0.15} strokeDasharray={p.grass || p.size === 0 ? '0.5 0.4' : undefined} />}
            {!hideOutlines && !spriteTerrain && p.accessPoints?.map((a, i) => <polygon key={i} points={`${a.x - 0.8},${a.y + 0.8} ${a.x + 0.8},${a.y + 0.8} ${a.x},${a.y - 0.8}`} fill="#eab308" />)}
            {!hideNumbers && !spriteTerrain && <text x={p.x + p.w / 2} y={p.y + p.h / 2 + 0.6} fontSize={spriteTerrain ? 1.3 : 1.8} textAnchor="middle" fill="#e5ecf5" fontWeight={700} opacity={spriteTerrain ? 0.75 : 1} stroke={spriteTerrain ? 'rgba(0,0,0,0.8)' : undefined} strokeWidth={spriteTerrain ? 0.25 : undefined} paintOrder="stroke">{p.n}</text>}
          </g>
          );
        })}
        {models?.ai.map((p, i) => <circle key={`ma${i}`} cx={p.x} cy={p.y} r={0.6} fill="#ef6a6a" stroke="#fff" strokeWidth={0.1} />)}
        {models?.players.map((p, i) => <circle key={`mp${i}`} cx={p.x} cy={p.y} r={0.6} fill="#60a5fa" stroke="#fff" strokeWidth={0.1} />)}
        {overlays.map((o, i) => (
          <g key={`ov${i}`}>
            <polygon points={`${o.x},${o.y - 1.4} ${o.x + 1.4},${o.y} ${o.x},${o.y + 1.4} ${o.x - 1.4},${o.y}`} fill={o.kind === 'base' ? '#60a5fa' : '#a855f7'} stroke="#fff" strokeWidth={0.15} />
            <text x={o.x} y={o.y - 1.9} fontSize={1.3} textAnchor="middle" fill="#e5ecf5">{o.label}</text>
          </g>
        ))}
        {mk.map((m) => {
          const col = m.affinity === 'ai' ? '#ef6a6a' : m.affinity === 'players' ? '#60a5fa' : '#e5ecf5';
          const ring = m.controlledBy === 'ai' ? '#ef6a6a' : m.controlledBy === 'players' ? '#60a5fa' : 'none';
          return (
            <g key={m.id} opacity={m.active ? 1 : 0.35}>
              <circle cx={m.x} cy={m.y} r={m.contestIn ?? 3} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={0.1} strokeDasharray="0.4 0.4" />
              {!beaconMarkers && ring !== 'none' && <circle cx={m.x} cy={m.y} r={1.9} fill="none" stroke={ring} strokeWidth={0.5} />}
              {!beaconMarkers && <circle cx={m.x} cy={m.y} r={1.3} fill="#0a1322" stroke={col} strokeWidth={0.3} />}
              {!beaconMarkers && <text x={m.x} y={m.y + 0.6} fontSize={1.7} textAnchor="middle" fill={col} fontWeight={700}>{m.id}</text>}
              {m.locked && <text x={m.x + 1.6} y={m.y - 1.2} fontSize={1.2} fill="#eab308">🔒</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function TerrainLegend({ terrain }: { terrain: TerrainLayout }) {
  return (
    <div className="legend">
      {terrain.pieces.map((p) => (
        <div key={p.n}>
          <TerrainThumb id={p.catalogId} size={34} /><b>#{p.n}</b> {p.label} {p.rot ? <>centred at ({+(p.x + p.w / 2).toFixed(1)}", {+(p.y + p.h / 2).toFixed(1)}"), turned {p.rot}°</> : <>at ({p.x}", {p.y}") from the top-left</>}, footprint {p.w}×{p.h}"{p.accessPoints?.length ? ` — ramp at (${p.accessPoints[0]!.x}", ${p.accessPoints[0]!.y}")` : ''}
        </div>
      ))}
      {terrain.fireLanes.map((l, i) => (
        <div key={`l${i}`} className="muted">Fire lane {i + 1}: keep clear, {l.w === terrain.table.width ? `y ${l.y}"–${l.y + l.h}"` : `x ${l.x}"–${l.x + l.w}"`}.</div>
      ))}
      {terrain.violations.length > 0 && <div className="muted">Notes: {terrain.violations.join(' ')}</div>}
    </div>
  );
}
