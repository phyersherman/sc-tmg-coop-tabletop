import type { TerrainPiece } from '../types/terrain';
import { distToPiece, pieceBounds, rampLane } from './geometry';

/**
 * Where a Mission Marker may stand: not on a wall, and not across two heights (on flat ground clear of high
 * ground, or up on its plateau). A card's spot that breaks this is moved to the nearest spot that does not.
 */

/** How far a Mission Marker keeps from any change of height: off a high-ground piece, or in from its plateau's edges. */
const MARKER_CLEAR = 2;

/**
 * Whether a marker at (x, y) sits on one height: on flat ground 2" clear of a high-ground piece, or on its plateau
 * 2" in from the edges and 2" from its ramp (the ramp is a transition with no height of its own). Returns the piece
 * it is too close to.
 */
function markerLevel(pt: { x: number; y: number }, highs: TerrainPiece[]): TerrainPiece | null {
  for (const p of highs) if (!markerOnPlateau(pt, p) && distToPiece(pt, p) < MARKER_CLEAR) return p;
  return null;
}

/** On the plateau of a Lost Temple Ramp with room all round: 2" in from its edges and 2" from its ramp. */
function markerOnPlateau(pt: { x: number; y: number }, p: TerrainPiece): boolean {
  const r = rampLane(p);
  const { u, v } = r.toLocal(pt);
  const inset = Math.min(r.hl - Math.abs(u), r.ht - Math.abs(v));
  if (inset < MARKER_CLEAR) return false;
  const inner = r.hl - r.len;
  const toLane = Math.hypot(Math.max(0, inner - u), Math.max(0, r.ht - r.w - v * r.side));
  return toLane >= MARKER_CLEAR;
}

export function clearMarkerSpot(m: { x: number; y: number }, pieces: TerrainPiece[]): { x: number; y: number; movedFrom?: { x: number; y: number; piece: string } } {
  const walls = pieces.filter((p) => p.size >= 2 && !p.grass && !p.catalogId.includes('ramp'));
  const highs = pieces.filter((p) => p.catalogId.includes('ramp'));
  // Moved only when it really sits on a wall, or across two heights; once moved, the whole 32mm token stays clear.
  const hit = walls.find((p) => distToPiece(m, p) < 0.3) ?? markerLevel(m, highs);
  if (!hit) return { x: m.x, y: m.y };
  const blocking = (x: number, y: number) => walls.find((p) => distToPiece({ x, y }, p) < 0.7) ?? markerLevel({ x, y }, highs);
  const movedFrom = { x: m.x, y: m.y, piece: hit.label.replace(/ \(L\) — (long|short) side$/, '') };
  // On high ground, the marker goes up onto the plateau: the nearest spot on it with room all round.
  if (highs.includes(hit)) {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    const b = pieceBounds(hit);
    for (let y = Math.ceil(b.y * 2) / 2; y <= b.y + b.h; y += 0.5)
      for (let x = Math.ceil(b.x * 2) / 2; x <= b.x + b.w; x += 0.5) {
        if (!markerOnPlateau({ x, y }, hit) || blocking(x, y)) continue;
        const d = Math.hypot(x - m.x, y - m.y);
        if (d < bd) { bd = d; best = { x, y }; }
      }
    if (best) return { ...best, movedFrom };
  }
  for (let r = 0.5; r <= 9; r += 0.5) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const x = Math.round((m.x + Math.cos(a) * r) * 2) / 2;
      const y = Math.round((m.y + Math.sin(a) * r) * 2) / 2;
      if (!blocking(x, y)) return { x, y, movedFrom };
    }
  }
  return { x: m.x, y: m.y };
}
