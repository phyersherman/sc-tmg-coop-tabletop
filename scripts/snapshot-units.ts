/**
 * Converts raw/factions_cache_data.json (official beta app snapshot) into
 * src/data/units.json and src/data/cards.json (typed facts, no art).
 *
 * Run: npm run snapshot
 */
import { readFileSync, writeFileSync } from 'node:fs';

type Raw = Record<string, any>;

const raw: Raw[] = JSON.parse(readFileSync('raw/factions_cache_data.json', 'utf8'));

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function parseTN(v: string): number | undefined {
  const m = /^(\d+)\+?$/.exec(String(v).trim());
  return m ? Number(m[1]) : undefined;
}

function parseSpeed(v: string): [number, number] | null {
  const s = String(v).trim();
  if (s === '-' || s === '') return null;
  const parts = s.split('/').map((x) => Number(x));
  const a = parts[0] ?? 0;
  const b = parts[1] ?? a;
  return [a, b];
}

function parseRange(s: string): { min: number; max: number } | null {
  const t = s.trim();
  if (t === '-' || t === '') return null;
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(t);
  if (!m) return null;
  return { min: Number(m[1]), max: Number(m[2]) };
}

function parseKeywords(line: string) {
  const out: any[] = [];
  const parts = line
    .split(/,\s*(?![^(]*\))/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const p of parts) {
    // BURST FIRE 8" (3)
    let m = /^([A-Z][A-Z \-]+?)\s+(\d+)"\s*\((\d+)\)$/.exec(p);
    if (m) {
      out.push({ k: m[1].trim(), range: Number(m[2]), v: Number(m[3]) });
      continue;
    }
    // PIERCE Armoured (3)
    m = /^([A-Z][A-Z \-]+?)\s+(Light|Armoured)\s*\((\d+)\)$/.exec(p);
    if (m) {
      out.push({ k: m[1].trim(), tag: m[2], v: Number(m[3]) });
      continue;
    }
    // LONG RANGE (18") / ANTI-EVADE (1) / LOCKED IN (6)
    m = /^([A-Z][A-Z \-]+?)\s*\((\d+)"?\)$/.exec(p);
    if (m) {
      out.push({ k: m[1].trim(), v: Number(m[2]) });
      continue;
    }
    out.push({ k: p.toUpperCase() });
  }
  return out;
}

function parseWeapon(u: Raw, up: Raw, idx: number) {
  const desc: string = up.description;
  const lines = desc.split('\n').map((l) => l.trim()).filter(Boolean);
  const first = lines[0] ?? '';
  const stat: Record<string, string> = {};
  for (const seg of first.split('|')) {
    const m = /^\s*([A-Za-z]+):\s*(.+?)\s*$/.exec(seg);
    if (m) stat[m[1].toUpperCase()] = m[2];
  }
  const surgeLine = lines.find((l) => l.startsWith('SURGE:')) ?? 'SURGE: -';
  const surgeBody = surgeLine.replace('SURGE:', '').trim();
  let surgeTypes: string[] = [];
  let surgeDie: string | undefined;
  if (surgeBody !== '-') {
    // BT is the Blast Template: the Surge pool is as many dice as the template covers.
    const m = /^(.+?)\s*\((D3\+1|D3|D6|BT)\)\s*(.*)$/.exec(surgeBody);
    if (m) {
      surgeTypes = m[1].split(',').map((x) => x.trim());
      surgeDie = m[2];
      if (m[3]) lines.push(m[3]);
    }
  }
  // A weapon usable only while the unit has a Status ("SIEGE MODE Status") states a requirement, not a keyword.
  const statusLine = lines.find((l) => /\bStatus$/.test(l) && l !== first);
  const requiresStatus = statusLine ? statusLine.replace(/\s*Status$/, '').trim() : undefined;
  const kwLines = lines.filter((l) => l !== first && l !== statusLine && !l.startsWith('SURGE:'));
  const keywords = parseKeywords(kwLines.join(', '));
  // RoA "BT+4": the Blast Template's dice, plus a fixed number.
  const roaRaw = String(stat['ROA'] ?? '1').trim();
  const btM = /^BT\s*(?:\+\s*(\d+))?$/i.exec(roaRaw);
  const rangeRaw = stat['RANGE'] ?? 'E';
  const range = rangeRaw === 'E' ? 'E' : Number(rangeRaw);
  const w: any = {
    id: `${u.id}:${slug(up.name)}:${idx}`,
    name: up.name,
    phase: up.phase.startsWith('Combat') ? 'Combat' : 'Assault',
    range,
    target: stat['TARGET'] ?? 'Ground',
    roa: btM ? Number(btM[1] ?? 0) : Number(roaRaw),
    hit: parseTN(stat['HIT'] ?? '4+') ?? 4,
    dmg: Number(stat['DMG'] ?? 1),
    surgeTypes,
    keywords,
    text: desc,
  };
  if (btM) w.blast = true;
  if (requiresStatus) w.requiresStatus = requiresStatus;
  if (surgeDie) w.surgeDie = surgeDie;
  if (up.costS > 0 || up.costL > 0) w.upgradeCost = { small: up.costS, large: up.costL };
  if (up.linkedTo && up.linkedTo !== '-' && up.linkedTo !== '') w.replaces = up.linkedTo;
  return w;
}

function parseAbility(u: Raw, up: Raw, idx: number) {
  const act: string = up.activation ?? '';
  const kindM = /<(Passive|Active|Reaction)>/.exec(act);
  const kind = kindM ? kindM[1] : 'Passive';
  const costM = /\((X|\d+)\s+(Command Point|Biomass|Psionic Energy)\)/.exec(act);
  const phaseRaw: string = up.phase ?? 'Any Phase';
  const phase = phaseRaw.startsWith('Movement')
    ? 'Movement'
    : phaseRaw.startsWith('Assault')
      ? 'Assault'
      : phaseRaw.startsWith('Combat')
        ? 'Combat'
        : 'Any';
  const a: any = {
    id: `${u.id}:${slug(up.name)}:${idx}`,
    name: up.name,
    phase,
    kind,
    text: up.description,
  };
  if (costM) {
    const res = costM[2] === 'Command Point' ? 'CP' : costM[2] === 'Biomass' ? 'BM' : 'PE';
    a.cost = { resource: res, amount: costM[1] === 'X' ? 'X' : Number(costM[1]) };
  }
  if (up.costS > 0 || up.costL > 0) a.upgradeCost = { small: up.costS, large: up.costL };
  return a;
}

const units: any[] = [];
const cards: any[] = [];

for (const x of raw) {
  if (x.type === 'unit') {
    const tags = String(x.tags)
      .split(',')
      .map((t: string) => t.trim())
      .filter(Boolean);
    const compositions: any[] = [];
    if (x.small?.models > 0) compositions.push({ label: 'small', ...x.small });
    if (x.large?.models > 0) compositions.push({ label: 'large', ...x.large });
    const squadProfile = (x.squadProfile as Raw[])
      .map((t) => ({ r: parseRange(t.modelCount), supply: Number(t.supply) }))
      .filter((t) => t.r)
      .map((t) => ({ min: t.r!.min, max: t.r!.max, supply: t.supply }))
      .sort((a, b) => a.min - b.min);
    const weapons: any[] = [];
    const abilities: any[] = [];
    let impact: any;
    (x.upgrades as Raw[]).forEach((up, i) => {
      if (/^RANGE:/.test(String(up.description).trim())) weapons.push(parseWeapon(x, up, i));
      else {
        const ab = parseAbility(x, up, i);
        abilities.push(ab);
        const im = /IMPACT \((\d+)\)\s*(\d)\+/.exec(up.description);
        if (im && /Devastating Charge/i.test(up.name)) impact = { dice: Number(im[1]), hit: Number(im[2]) };
      }
    });
    const stats: any = {
      speed: parseSpeed(x.stats.speed),
      armour: parseTN(x.stats.armor) ?? 7,
      hp: Number(x.stats.hp),
      size: x.stats.size === '-' ? 0 : Number(x.stats.size),
    };
    const ev = parseTN(x.stats.evade);
    if (ev) stats.evade = ev;
    if (x.stats.shield !== '-' && x.stats.shield !== '') stats.shields = Number(x.stats.shield);
    if (x.combatRange && x.combatRange !== '-') stats.combatRange = Number(x.combatRange);
    const maxCost = Math.max(0, ...compositions.map((c) => c.cost));
    const u: any = {
      id: x.id,
      name: x.name,
      faction: x.faction,
      role: x.unitType,
      tags,
      unique: tags.includes('Unique'),
      summoned: maxCost === 0,
      stats,
      compositions,
      squadProfile,
      weapons,
      abilities,
    };
    if (x.keywords) u.subFaction = x.keywords;
    if (impact) u.impact = impact;
    units.push(u);
  } else {
    const slots: any = {};
    for (const [k, v] of Object.entries(x.slots ?? {})) if ((v as number) > 0) slots[k] = v;
    cards.push({
      id: x.id,
      name: x.name,
      faction: x.faction,
      isFactionCard: !!x.isFactionCard,
      unique: !!x.isUnique,
      cost: Number(x.cost ?? 0),
      resource: Number(x.resource ?? 0),
      slots,
      factionTags: Array.isArray(x.factionTags) ? x.factionTags : [],
      boosts: (x.boosts ?? []).map((b: Raw) => ({
        name: b.name,
        text: String(b.description).replace(/^.*?:\s*/, ''),
      })),
    });
  }
}

units.sort((a, b) => a.faction.localeCompare(b.faction) || a.name.localeCompare(b.name));
cards.sort((a, b) => String(a.faction).localeCompare(String(b.faction)) || a.name.localeCompare(b.name));

// Validation
const errors: string[] = [];
for (const u of units) {
  if (!u.summoned && u.compositions.length === 0) errors.push(`${u.name}: no compositions`);
  if (u.squadProfile.length === 0) errors.push(`${u.name}: no squad profile`);
  for (const w of u.weapons) if (w.phase === 'Combat' && w.range !== 'E') errors.push(`${u.name}/${w.name}: combat weapon with range`);
  const maxModels = Math.max(1, ...u.compositions.map((c: any) => c.models));
  const covered = new Set<number>();
  for (const t of u.squadProfile) for (let m = t.min; m <= t.max; m++) covered.add(m);
  for (let m = 1; m <= maxModels; m++) if (!covered.has(m)) errors.push(`${u.name}: squad profile does not cover ${m} models`);
}
// Jim Raynor carries one rifle: the C-14 is chosen when the army is built, for nothing, in place of the Commando Rifle.
for (const u of units as any[]) if (u.id === 'jim_raynor') for (const w of u.weapons) if (w.name === 'C-14 rifle') { w.upgradeCost = { small: 0, large: 0 }; w.replaces = 'Commando Rifle'; }

if (errors.length) {
  console.error('VALIDATION ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}

const meta = {
  version: '2026-09-16',
  takenAt: '2026-09-16',
  source: 'https://sc.starcraft-tmg.com (Command Center beta v1.4, guest access)',
};
writeFileSync('src/data/units.json', JSON.stringify({ ...meta, units }, null, 2) + '\n');
writeFileSync('src/data/cards.json', JSON.stringify({ ...meta, cards }, null, 2) + '\n');
console.log(`wrote ${units.length} units, ${cards.length} cards`);
