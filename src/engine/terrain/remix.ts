import type { TerrainLayout, TerrainPiece } from '../types/terrain';
import type { DeploymentLayout } from '../types/terrain';
import { RULEBOOK_MAPS, type RulebookMap } from '@data/terrainMaps';
import { Rng } from '../rng';
import { distToPiece, pieceBounds, pieceCorners, settleRamps } from './geometry';

/**
 * Random tables in the rulebook's own style. The printed maps are built from a few recurring groups — an L wall
 * chained to a straight one, a statue trailing a hedge of shrubs, a short wall capping a long one, lone scatter
 * in the open — and the standard ones are point-symmetric. A remix keeps all of that: it starts from one of the
 * printed maps, swaps each group for a group of exactly the same pieces from another map, nudges and turns
 * the groups a little, mirrors or turns the whole table, and restores the symmetry. The pieces used are
 * therefore always exactly one Lost Temple set per half (plus the ramps the template had), and nothing is ever
 * set where the printed maps would not put it: on a marker, off the table, or hard against another group.
 */

interface Group { pieces: TerrainPiece[]; cx: number; cy: number; kinds: string }

type Pt = { x: number; y: number };
const centre = (p: TerrainPiece): Pt => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 });
/** What a piece is on the table, as the rulebook names it (the two sides of an L are one piece). */
const kindOf = (p: TerrainPiece) => p.label.replace(/ \(L\) — (long|short) side$/, '').replace(/^Shrubs [AB]$/, 'Shrubs');

/** Points around a piece's outline, for spacing checks between turned pieces. */
function outline(p: TerrainPiece): Pt[] {
  const c = pieceCorners(p);
  const out: Pt[] = [];
  for (let i = 0; i < 4; i++) {
    const a = c[i]!, b = c[(i + 1) % 4]!;
    for (let k = 0; k < 6; k++) out.push({ x: a.x + ((b.x - a.x) * k) / 6, y: a.y + ((b.y - a.y) * k) / 6 });
  }
  return out;
}
/** The gap between two pieces' footprints (0 when they touch or overlap). */
function gap(a: TerrainPiece, b: TerrainPiece): number {
  let g = Infinity;
  for (const p of outline(a)) g = Math.min(g, distToPiece(p, b));
  for (const p of outline(b)) g = Math.min(g, distToPiece(p, a));
  return g;
}

/** A map's groups: pieces whose footprints touch (within half an inch) belong together. */
function groupsOf(pieces: TerrainPiece[]): Group[] {
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    if (gap(pieces[i]!, pieces[j]!) < 0.5) parent[find(i)] = find(j);
  }
  const by = new Map<number, TerrainPiece[]>();
  pieces.forEach((p, i) => by.set(find(i), [...(by.get(find(i)) ?? []), p]));
  return [...by.values()].map((ps) => {
    const cs = ps.map(centre);
    return { pieces: ps, cx: cs.reduce((s, c) => s + c.x, 0) / cs.length, cy: cs.reduce((s, c) => s + c.y, 0) / cs.length, kinds: ps.map(kindOf).sort().join('+') };
  });
}

/** Move a piece: turn it by `deg` about (ox, oy), then shift it by (dx, dy). */
function moved(p: TerrainPiece, ox: number, oy: number, deg: number, dx: number, dy: number): TerrainPiece {
  const c = centre(p);
  const a = (deg * Math.PI) / 180;
  const x = ox + (c.x - ox) * Math.cos(a) - (c.y - oy) * Math.sin(a) + dx;
  const y = oy + (c.x - ox) * Math.sin(a) + (c.y - oy) * Math.cos(a) + dy;
  const q: TerrainPiece = { ...p, x: x - p.w / 2, y: y - p.h / 2, rot: norm((p.rot ?? 0) + deg) };
  // A rectangle turned end for end has the same footprint; a ramp is drawn square, so keep it unturned.
  if (!q.rot || (p.catalogId.includes('ramp') && Math.abs(q.rot) === 180)) delete q.rot;
  if (p.accessPoints) q.accessPoints = p.accessPoints.map((ap) => ({ x: ox + (ap.x - ox) * Math.cos(a) - (ap.y - oy) * Math.sin(a) + dx, y: oy + (ap.x - ox) * Math.sin(a) + (ap.y - oy) * Math.cos(a) + dy }));
  return q;
}
const norm = (deg: number) => { const d = ((deg % 360) + 540) % 360 - 180; return Math.abs(d) < 0.05 ? 0 : Math.round(d * 10) / 10; };

/** The whole table mirrored left–right, top–bottom, or turned (square tables only). */
function transformAll(pieces: TerrainPiece[], W: number, H: number, how: 'none' | 'flipX' | 'flipY' | 'turn90' | 'turn270'): TerrainPiece[] {
  return pieces.map((p) => {
    const c = centre(p);
    const r = p.rot ?? 0;
    let x = c.x, y = c.y, rot = r;
    if (how === 'flipX') { x = W - c.x; rot = -r; }
    else if (how === 'flipY') { y = H - c.y; rot = -r; }
    else if (how === 'turn90') { x = H - c.y; y = c.x; rot = r + 90; }
    else if (how === 'turn270') { x = c.y; y = W - c.x; rot = r - 90; }
    const q: TerrainPiece = { ...p, x: x - p.w / 2, y: y - p.h / 2, rot: norm(rot) };
    if (!q.rot) delete q.rot;
    if (p.accessPoints) q.accessPoints = p.accessPoints.map((ap) => (how === 'flipX' ? { x: W - ap.x, y: ap.y } : how === 'flipY' ? { x: ap.x, y: H - ap.y } : how === 'turn90' ? { x: H - ap.y, y: ap.x } : how === 'turn270' ? { x: ap.y, y: W - ap.x } : ap));
    return q;
  });
}

function fits(pieces: TerrainPiece[], groupOf: number[], W: number, H: number, deployment?: DeploymentLayout): boolean {
  for (const p of pieces) {
    const b = pieceBounds(p);
    if (b.x < 0.15 || b.y < 0.15 || b.x + b.w > W - 0.15 || b.y + b.h > H - 0.15) return false;
  }
  // Groups keep a passage between them, as the printed maps do.
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    if (groupOf[i] !== groupOf[j] && gap(pieces[i]!, pieces[j]!) < 1) return false;
  }
  // No wall on a mission marker.
  for (const m of deployment?.markers ?? []) {
    if (pieces.some((p) => p.size >= 2 && !p.grass && !p.catalogId.includes('ramp') && distToPiece(m, p) < 0.8)) return false;
  }
  return true;
}

/** A random table in the rulebook's style for this table size. The same seed always gives the same table. */
export function remixMap(scale: 'skirmish' | 'standard' | 'grand', seed: number, deployment?: DeploymentLayout): TerrainLayout & { template: RulebookMap } {
  const s = scale === 'grand' ? 'standard' : scale;
  const templates = RULEBOOK_MAPS.filter((m) => m.scale === s);
  const rng = Rng.from(seed);
  const template = rng.pick(templates);
  const W = template.table.width;
  const H = template.table.height;
  const symmetric = s === 'standard';
  // Every group of every map of this size, to swap in for a group of the same pieces.
  const pool = templates.flatMap((m) => groupsOf(m.pieces));

  for (let attempt = 0; attempt < 60; attempt++) {
    const groups = groupsOf(template.pieces);
    // With point symmetry, work on one of each mirrored pair and rebuild the other at the end.
    const cx = W / 2, cy = H / 2;
    const own = symmetric ? groups.filter((g) => g.cx < cx - 0.01 || (Math.abs(g.cx - cx) < 0.01 && g.cy <= cy)) : groups;
    // Later attempts vary less; the last is the printed map itself, only pulled onto the table.
    const loose = attempt < 40 ? 1 : attempt < 59 ? 0.5 : 0;
    const out: TerrainPiece[] = [];
    const groupOf: number[] = [];
    /** Pieces of a group on the table's centre: it is its own mirror image, so it is not mirrored again. */
    const central: boolean[] = [];
    own.forEach((g, gi) => {
      // Sometimes a group of exactly the same pieces from another printed map takes its place.
      const onCentre = symmetric && Math.hypot(g.cx - cx, g.cy - cy) < 2;
      const alike = onCentre ? [] : pool.filter((p) => p.kinds === g.kinds && p !== g);
      const src = loose && alike.length && rng.next() < 0.5 ? rng.pick(alike) : g;
      // A ramp sits square to the table, as it does on every printed map: it is only ever turned end for end.
      const ramp = src.pieces.some((p) => p.catalogId.includes('ramp'));
      const flip = src !== g && rng.next() < 0.3 ? 180 : 0;
      const turn = onCentre || !loose ? 0 : ramp ? flip : (rng.next() - 0.5) * 40 * loose + flip;
      const nudge = ramp ? 1.5 : 4;
      const dx = onCentre ? 0 : (g.cx - src.cx) + (rng.next() - 0.5) * nudge * loose;
      const dy = onCentre ? 0 : (g.cy - src.cy) + (rng.next() - 0.5) * nudge * loose;
      let placed = src.pieces.map((p) => moved(p, src.cx, src.cy, turn, dx, dy));
      // A group that strays over the edge is pulled back onto the table, whole.
      const bs = placed.map(pieceBounds);
      const pushX = Math.max(0, 0.2 - Math.min(...bs.map((b) => b.x))) - Math.max(0, Math.max(...bs.map((b) => b.x + b.w)) - (W - 0.2));
      const pushY = Math.max(0, 0.2 - Math.min(...bs.map((b) => b.y))) - Math.max(0, Math.max(...bs.map((b) => b.y + b.h)) - (H - 0.2));
      if (!onCentre && (pushX || pushY)) placed = placed.map((p) => moved(p, 0, 0, 0, pushX, pushY));
      for (const p of placed) { out.push(p); groupOf.push(gi); central.push(onCentre); }
    });
    let pieces = out;
    let owner = groupOf;
    if (symmetric) {
      const mirrored = pieces.map((p, i) => ({ p, i })).filter(({ i }) => !central[i]);
      const twin = mirrored.map(({ p }) => moved(p, cx, cy, 180, 0, 0));
      const twinOwner = mirrored.map(({ i }) => owner[i]! + 1000);
      pieces = [...pieces, ...twin];
      owner = [...owner, ...twinOwner];
    }
    // The whole table mirrored, or on a square table turned.
    const hows = s === 'skirmish' ? (['none', 'flipX', 'flipY', 'turn90', 'turn270'] as const) : (['none', 'flipX', 'flipY'] as const);
    pieces = transformAll(pieces, W, H, rng.pick([...hows]));
    if (loose && !fits(pieces, owner, W, H, deployment)) continue;
    pieces.forEach((p, i) => { p.n = i + 1; });
    return { seed, table: { width: W, height: H }, pieces, fireLanes: [], violations: [], template };
  }
  // Nothing fitted: the printed map itself.
  return { seed, table: { width: W, height: H }, pieces: template.pieces.map((p) => ({ ...p })), fireLanes: [], violations: [], template };
}

/** A remixed table's id, stored on the game so it can be rebuilt exactly: `remix:<size>:<seed>`. */
export const remixId = (scale: 'skirmish' | 'standard' | 'grand', seed: number) => `remix:${scale === 'grand' ? 'standard' : scale}:${seed}`;

/** The terrain for a map id: a printed rulebook map, or a remix of them. */
export function mapLayout(id: string, deployment?: DeploymentLayout): TerrainLayout & { name: string; page?: number; template?: RulebookMap } {
  const m = /^remix:(skirmish|standard):(-?\d+)$/.exec(id);
  if (m) {
    const t = remixMap(m[1] as 'skirmish' | 'standard', Number(m[2]), deployment);
    settleRamps(t.pieces, t.table);
    return { ...t, name: `Random table in the style of ${t.template.name}` };
  }
  const printed = RULEBOOK_MAPS.find((x) => x.id === id);
  if (!printed) throw new Error(`Unknown map ${id}`);
  const pieces = printed.pieces.map((p) => ({ ...p, accessPoints: p.accessPoints?.map((a) => ({ ...a })) }));
  settleRamps(pieces, printed.table);
  return { seed: 0, table: { ...printed.table }, pieces, fireLanes: [], violations: [], name: printed.name, page: printed.page, template: printed };
}
