import { useEffect, useState } from 'react';

/**
 * The rulebook's own pictures of each Lost Temple piece (public/terrain-ref, cut from the core rulebook's terrain
 * key): a top-down footprint and a photo of the painted model, so the table setup shows the
 * piece you actually pick up. Absent, the map falls back to plain footprints.
 */
export interface RefArt { images: Record<string, [number, number]> }
let loading: Promise<RefArt | null> | null = null;
export function useRefArt(): RefArt | null {
  const [art, setArt] = useState<RefArt | null>(null);
  useEffect(() => {
    let on = true;
    void (loading ??= fetch(`${import.meta.env.BASE_URL}terrain-ref/manifest.json`).then((r) => (r.ok ? (r.json() as Promise<RefArt>) : null)).catch(() => null)).then((a) => { if (on) setArt(a); });
    return () => { on = false; };
  }, []);
  return art;
}

/** "Wall Set 4 (L) — long side" → "wall-set-4": the rulebook name as a file name. */
export const refSlug = (label: string) => label.replace(/ \(L\) — (long|short) side$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
export const isLSide = (label: string) => / \(L\) — /.test(label);
export const refUrl = (slug: string, kind: 'footprint' | 'render') => `${import.meta.env.BASE_URL}terrain-ref/${slug}--${kind}.png`;

/** The colour each piece has in the rulebook's terrain key, for the pieces drawn in two parts (the L walls). */
export const KEY_COLOUR: Record<string, string> = {
  'wall-set-1': '#f0a753', 'wall-set-2': '#c9a58a', 'wall-set-3': '#2e8a5c', 'wall-set-4': '#3f8f93',
  'wall-set-5': '#9aa82a', 'wall-set-6': '#7a2f37',
};
