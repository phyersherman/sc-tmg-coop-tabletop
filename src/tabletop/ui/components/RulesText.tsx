import { useState, type ReactNode } from 'react';
import GLOSSARY from '@data/glossary.json';

const G = GLOSSARY as Record<string, string>;
// Longest keywords first so "LONG RANGE" wins over "RANGE"; only CAPS keywords as written on the cards.
const KEYS = Object.keys(G).filter((k) => k.length >= 4).sort((a, b) => b.length - a.length);
const RE = new RegExp(`\\b(${KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');

/** A rules keyword: its official wording opens beside it on hover or tap (the app's own tip, so it works everywhere). */
function Keyword({ word }: { word: string }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const show = (e: React.MouseEvent) => setAt({ x: e.clientX, y: e.clientY });
  return (
    <span className="kw" onMouseEnter={show} onMouseMove={show} onMouseLeave={() => setAt(null)} onClick={(e) => { e.stopPropagation(); setAt(at ? null : { x: e.clientX, y: e.clientY }); }}>
      {word}
      {at && (
        <span className="kw-tip" style={{ left: Math.min(at.x + 14, window.innerWidth - 380), top: at.y + 18 > window.innerHeight - 200 ? undefined : at.y + 18, bottom: at.y + 18 > window.innerHeight - 200 ? window.innerHeight - at.y + 8 : undefined }}>
          <b>{word}</b>
          {G[word]!.replace(new RegExp(`^${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^:]*:\\s*`), '')}
        </span>
      )}
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
