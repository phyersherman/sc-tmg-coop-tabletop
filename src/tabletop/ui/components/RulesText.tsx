import { useState, type ReactNode } from 'react';
import GLOSSARY from '@data/glossary.json';

const G = GLOSSARY as Record<string, string>;
// Longest keywords first so "LONG RANGE" wins over "RANGE"; only CAPS keywords as written on the cards.
const KEYS = Object.keys(G).filter((k) => k.length >= 4).sort((a, b) => b.length - a.length);
const RE = new RegExp(`\\b(${KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');

/**
 * The tip itself. Glossary entries are the rulebook's full wording, so some are long: the tip opens on the side of
 * the pointer with more room, never taller than that room, and a long entry gets a wider box set in two columns.
 */
function Tip({ word, at }: { word: string; at: { x: number; y: number } }) {
  const text = G[word]!.replace(new RegExp(`^${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^:]*:\\s*`), '');
  const long = text.length > 700;
  const width = Math.min(long ? 640 : 360, window.innerWidth - 24);
  const below = window.innerHeight - at.y - 26;
  const above = at.y - 16;
  const down = below >= above || below >= 260;
  const room = Math.max(120, down ? below : above);
  return (
    <span
      className="kw-tip"
      style={{
        width, left: Math.max(8, Math.min(at.x + 14, window.innerWidth - width - 12)),
        top: down ? at.y + 18 : undefined, bottom: down ? undefined : window.innerHeight - at.y + 8,
        maxHeight: room, overflow: 'hidden', columnCount: long ? 2 : undefined, columnGap: long ? 16 : undefined,
        fontSize: text.length > 1500 ? 11.5 : undefined,
      }}
    >
      <b>{word}</b>
      {text}
    </span>
  );
}

/** A rules keyword: its official wording opens beside it on hover or tap (the app's own tip, so it works everywhere). */
function Keyword({ word }: { word: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const show = (e: React.MouseEvent) => setAt({ x: e.clientX, y: e.clientY });
  return (
    <span className="kw" onMouseEnter={show} onMouseMove={show} onMouseLeave={() => setAt(null)} onClick={(e) => { e.stopPropagation(); setAt(at ? null : { x: e.clientX, y: e.clientY }); }}>
      {word}
      {at && <Tip word={word} at={at} />}
    </span>
  );
}

/** Card or ability text with its rules keywords (HIDDEN, PIERCE, IMPACT…) underlined and explained on hover. */
export function RulesText({ text }: { text: string }) {
  if (!text) return null;
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    parts.push(<Keyword key={i} word={m[1]!} />);
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
