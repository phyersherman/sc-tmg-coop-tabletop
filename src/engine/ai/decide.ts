import type { AiOrder, FocusRule, GameState, OrderReportOption } from '../types/game';
import type { AiObjective, AiUnitInstance } from '../types/army';
import type { MissionMode, MissionCtx } from '../types/mission';
import type { UnitDef } from '../types/units';
import { unitById } from '@data/index';
import { currentCard } from './orderDeck';
import { classify, preferredRange, type Profile } from './profiles';
import { availableWeapons, bestWeapon, diceInstruction, maxRange, rollInstruction, type DiceInstruction } from '../units/weapons';
import { currentSupply } from '../units/supply';
import { speedFor } from '../units/speed';
import { impactText } from '../units/keywords';
import { aiSegments, closestOnSegment, describeSegment, dist, segmentMidpoint } from '../terrain/geometry';
import { DIFFICULTIES } from '../difficulty';
import { hasMutator } from '../mutators/index';
import { onTable, reserves, aiSupplyOnTable, poolNow, heldInPlace, isStructure } from '../director/selectors';
import { playerModels, visibleEnemies } from '../sense/query';
import { passable } from '../sense/geometry2d';
import { playerSegments } from '../terrain/geometry';
import { hiddenFrom } from '../abilities/index';
import type { Rng } from '../rng';

const def = (u: AiUnitInstance): UnitDef => unitById(u.defId);

export function headingText(state: GameState, obj: AiObjective): string {
  switch (obj.kind) {
    case 'marker': {
      // The marker's number is on the table (and the battlefield can be seen from any side, so no corner is "top-left").
      return `Mission Marker ${obj.markerId}`;
    }
    case 'enemy':
      return 'the nearest enemy Unit';
    case 'follow': {
      const b = state.army.units.find((u) => u.id === obj.unitId);
      return b ? `${b.label}, staying within 4" of it` : 'the nearest friendly Unit';
    }
    case 'lane':
      return obj.toEdge === 'E' ? 'the right table edge' : 'the left table edge';
    case 'point':
      return obj.label;
    case 'hold':
      return 'its current position';
  }
}

export function focusText(rule: FocusRule): string {
  const tie = ' On a tie: fewest models, then least HP left, then lowest Supply, then the players choose.';
  switch (rule.primary) {
    case 'nearest':
      return 'the nearest enemy Unit by the shortest path.' + tie;
    case 'weakest':
      return 'the enemy Unit in range with the fewest models left.' + ' On a tie: the nearest.';
    case 'onMarker':
      return `an enemy Unit within 3" of Mission Marker ${rule.markerId ?? ''}, or the nearest enemy Unit if none is in range.` + tie;
    case 'highestSupply':
      return 'the enemy Unit in range with the highest Supply.' + ' On a tie: the nearest.';
    case 'lastAttacker':
      return 'the enemy Unit that last damaged it, or the nearest enemy Unit if that one is out of range.' + tie;
    case 'nearestToMarker':
      return 'the enemy Unit in range closest to a Mission Marker, or the nearest enemy Unit if none is in range.' + tie;
  }
}

function focusFor(state: GameState, unit: AiUnitInstance): FocusRule {
  const card = currentCard(state.orderDeck);
  // The unit's own action card names its focus first; the round's order card otherwise.
  const primary = cardMods(state, unit)?.focus ?? card.focus ?? 'nearest';
  const rule: FocusRule = { primary, tieBreak: ['fewestModels', 'lowestHp', 'lowestSupply', 'playerChoice'] };
  if (primary === 'onMarker' && unit.objective.kind === 'marker') rule.markerId = unit.objective.markerId;
  else if (primary === 'onMarker') rule.primary = 'nearest';
  return rule;
}

/** The action card a unit follows, while it is the one for this round and phase. */
function cardMods(state: GameState, unit?: AiUnitInstance): AiUnitInstance['cardMods'] {
  const m = unit?.cardMods;
  return m && m.round === state.round && m.phase === state.phase ? m : undefined;
}

function hitModFor(state: GameState, unit?: AiUnitInstance): number {
  const card = currentCard(state.orderDeck);
  let mod = (card.hitMod ?? 0) + (cardMods(state, unit)?.hit ?? 0) - aiDebuff(unit, 'hit');
  if (state.modeState['avengerActive']) mod += 1;
  return mod;
}

function rangeModFor(state: GameState): number {
  return hasMutator(state, 'longRange') ? 2 : 0;
}

/** How much of a DEBUFF an AI unit is under for one characteristic. */
export function aiDebuff(u: { statDebuffs?: { stat: string; amount: number }[] } | undefined, stat: 'speed' | 'hit' | 'armour' | 'evade'): number {
  return (u?.statDebuffs ?? []).filter((d) => d.stat === stat).reduce((sum, d) => sum + d.amount, 0);
}

export function speedModFor(state: GameState, unit?: AiUnitInstance): number {
  return (hasMutator(state, 'speedFreaks') ? 1 : 0) + (cardMods(state, unit)?.speed ?? 0) - aiDebuff(unit, 'speed') - prisonHold(state, unit);
}

/** Void Prison and the like: a token on the battlefield that slows whatever stands near it. */
function prisonHold(state: GameState, unit?: AiUnitInstance): number {
  if (!unit) return 0;
  const pts = state.sense?.ai[unit.id] ?? (unit.est ? [unit.est] : []);
  if (!pts.length) return 0;
  const held = (state.tokens ?? []).some((t) => t.kind === 'indicator' && t.radius && pts.some((p) => Math.hypot(p.x - t.x, p.y - t.y) <= t.radius! + 0.05));
  return held ? 2 : 0;
}

function batchesFor(state: GameState, unit: AiUnitInstance, rng: Rng, phase: 'Assault' | 'Combat'): DiceInstruction[] {
  const d = def(unit);
  // A weapon that needs a Status is fired only while the unit holds it, and while it does, nothing else is.
  const ws = availableWeapons(d, unit.upgrades, phase).filter((w) => usableNow(unit, w) && (w.target !== 'Flying' || state.config.options.playerHasFlying));
  const best = bestWeapon(d, unit.upgrades, phase, (w) => usableNow(unit, w));
  const out: DiceInstruction[] = [];
  const mod = hitModFor(state, unit);
  const rmod = rangeModFor(state);
  const pick = phase === 'Combat' ? (best ? [best] : []) : ws.filter((w) => w === best || w.keywords.some((k) => k.k === 'SIDEARM'));
  for (const w of pick) {
    // An action card's extra attacks add to the main weapon only (a BUFF RoA on the weapon the ability names).
    const roa = w === best && phase === 'Assault' ? cardMods(state, unit)?.roa ?? 0 : 0;
    let instr = diceInstruction(roa ? { ...w, roa: w.roa + roa } : w, unit.models);
    if (mod) instr.hitMod = mod;
    if (rmod && w.range !== 'E') instr.rangeMod = rmod;
    instr = rollInstruction(rng, instr);
    out.push(instr);
  }
  return out;
}

export function report(id: OrderReportOption['id'], label: string): OrderReportOption {
  return { id, label } as OrderReportOption;
}

/** Units the AI could deploy right now: in Reserves, within its Supply, under the order card's cap and the mission's filters. */
export function deployable(state: GameState, mode: MissionMode, ctx: MissionCtx): AiUnitInstance[] {
  const card = currentCard(state.orderDeck);
  // An official mission is played as against a real opponent, who deploys until the Supply Pool is full; the order
  // card paces the AI's arrivals in the co-op missions only.
  const cardCap = mode.official || card.deployMax === 'all' ? 99 : card.deployMax;
  const cap = mode.deployCap?.(ctx) ?? cardCap;
  const deployedThisRound = state.army.units.filter((u) => u.deployedRound === state.round).length;
  if (deployedThisRound >= cap && state.round < state.finalRound) return [];
  const pool = poolNow(state);
  const available = pool - aiSupplyOnTable(state);
  let cands = reserves(state).filter((u) => !u.activated.movement && (u.special?.freeSupply || currentSupply(def(u), u.models) <= available));
  if (mode.deployFilter) cands = mode.deployFilter(ctx, cands);
  return cands;
}

function pickDeploy(state: GameState, cands: AiUnitInstance[]): AiUnitInstance {
  const forced = cands.find((u) => u.special?.forceDeploy);
  if (forced) return forced;
  const hero = cands.find((u) => def(u).role === 'Hero');
  if (hero && state.round >= 2) return hero;
  const nonHero = cands.filter((u) => def(u).role !== 'Hero');
  const list = nonHero.length ? nonHero : cands;
  return list
    .slice()
    .sort((a, b) => {
      const sa = currentSupply(def(a), a.models);
      const sb = currentSupply(def(b), b.models);
      if (sb !== sa) return sb - sa;
      if (state.round === 1) {
        const ra = classify(def(a)) === 'rangedLine' ? 0 : 1;
        const rb = classify(def(b)) === 'rangedLine' ? 0 : 1;
        if (ra !== rb) return ra - rb;
      }
      return a.respawns - b.respawns;
    })[0] as AiUnitInstance;
}

/** Inside the 6" strip along a player entry edge (their Zone of Influence). */
function inPlayerZoi(state: GameState, p: { x: number; y: number }): boolean {
  const t = state.deployment.table;
  return playerSegments(state.deployment).some((sg) => {
    const along = sg.edge === 'N' || sg.edge === 'S' ? p.x : p.y;
    if (along < sg.from - 0.01 || along > sg.to + 0.01) return false;
    return sg.edge === 'N' ? p.y <= 6 : sg.edge === 'S' ? p.y >= t.height - 6 : sg.edge === 'W' ? p.x <= 6 : p.x >= t.width - 6;
  });
}

/**
 * Where a unit that may be set down anywhere goes: the spot nearest where it is heading that is on open ground,
 * more than 6" from every player model the app knows of, out of the players' Zone of Influence, and clear of the
 * AI's own units. With no player positions known (tabletop without the camera) the 6" is the players' to keep.
 */
function dropPointFor(state: GameState, unit: AiUnitInstance, toward: { x: number; y: number }): { x: number; y: number } {
  const t = state.deployment.table;
  const yours = state.playerUnits.filter((p) => p.location === 'table' && !p.destroyed).flatMap((p) => playerModels(state, p));
  const own = state.army.units.filter((u) => u.location === 'table' && u.id !== unit.id).flatMap((u) => state.sense?.ai[u.id] ?? (u.est ? [u.est] : []));
  let best: { p: { x: number; y: number }; d: number } | null = null;
  for (let y = 1.5; y <= t.height - 1.5; y += 1) {
    for (let x = 1.5; x <= t.width - 1.5; x += 1) {
      const p = { x, y };
      if (inPlayerZoi(state, p) || !passable(p, state.terrain.pieces)) continue;
      if (yours.some((q) => dist(p, q) < 7)) continue;
      if (own.some((q) => dist(p, q) < 2.5)) continue;
      const d = dist(p, toward);
      if (!best || d < best.d) best = { p, d };
    }
  }
  return best?.p ?? { x: t.width / 2, y: t.height / 2 };
}

const fmtIn = (p: { x: number; y: number }) => `${p.x.toFixed(0)}" from the left, ${p.y.toFixed(0)}" from the top`;

export function deployOrder(state: GameState, unit: AiUnitInstance): AiOrder {
  const d = def(unit);
  const card = currentCard(state.orderDeck);
  const table = state.deployment.table;
  const segs = aiSegments(state.deployment);
  const target = unit.objective.kind === 'marker' ? state.markers.find((m) => m.id === (unit.objective as { markerId: number }).markerId) : undefined;
  const tp = target ? { x: target.x, y: target.y } : { x: table.width / 2, y: table.height / 2 };
  const scored = segs.map((s) => ({ s, d: dist(closestOnSegment(s, table, tp), tp) })).sort((a, b) => a.d - b.d);
  const seg = (card.deployBias === 'flank' && scored.length > 1 ? scored[scored.length - 1] : scored[0])?.s ?? segs[0]!;
  const speed = speedFor(d, unit.models) + speedModFor(state, unit);
  const supply = currentSupply(d, unit.models);
  const lines: string[] = [];
  if (unit.objective.kind === 'lane') {
    const from = unit.objective.toEdge === 'E' ? 'left' : 'right';
    lines.push(`Enter from the ${from} table edge, ${table.height / 2}" from the top. Move the Leading Model up to ${speed}" straight toward the far edge, then set the rest in Coherency.`);
    lines.push(`It follows the lane and ignores Mission Markers. Supply: ${supply}. Models: ${unit.models}.`);
    return { type: 'deploy', unitId: unit.id, title: `Deploy ${unit.label}`, lines, heading: unit.objective, headingText: headingText(state, unit.objective), batches: [], reports: [report('done', 'Deployed')] };
  }
  const hasAmbush = d.abilities.some((a) => /Burrow Ambush/i.test(a.name) && (!a.upgradeCost || unit.upgrades.includes(a.id)));
  // A collection too small for the players' armies: the AI is not held to its entry edge.
  const dropAt = state.config.options.aiDropsAnywhere ? dropPointFor(state, unit, tp) : undefined;
  if (dropAt) {
    lines.push(`Set the whole unit down anywhere on the table, outside the players' Zone of Influence and with every model more than 6" from every player model. Place the Leading Model at about ${fmtIn(dropAt)} and the rest in Coherency within 3".`);
    lines.push('The AI is short of models for this battle. Its Units arrive where they are needed, not at its Entry Edge.');
  } else if (card.deployBias === 'ambush' && hasAmbush) {
    lines.push(`BURROW AMBUSH: set the Unit up anywhere within 18" of the AI's Entry Edge, outside the players' Zone of Influence and with no model within 10" of a player model.`);
    lines.push('It takes no other action this phase.');
  } else if (hasMutator(state, 'aggressiveDeployment') || (card.id === 'warpIn' && !state.modeState['warpInUsed'])) {
    lines.push(`Enter from ${describeSegment(seg, table)}, or from either side edge that is not a player's Entry Edge. End more than 10" from every player model.`);
    lines.push(`Move the Leading Model up to ${speed}" onto the table, then set the rest of the Unit in Coherency within 3".`);
  } else {
    lines.push(`Enter from ${describeSegment(seg, table)}. Move the Leading Model up to ${speed}" onto the table, then set the rest of the Unit in Coherency within 3".`);
  }
  lines.push(`Head toward ${headingText(state, unit.objective)}. The Unit may not end in the players' Zone of Influence, the 6" strip along their Entry Edge.`);
  lines.push(`Supply: ${supply}. Models: ${unit.models}${unit.damageMarker ? `. Damage marker: ${unit.damageMarker}` : ''}.`);
  return {
    type: 'deploy',
    unitId: unit.id,
    title: `Deploy ${unit.label}`,
    lines,
    heading: unit.objective,
    headingText: headingText(state, unit.objective),
    batches: [],
    reports: [report('done', 'Deployed')],
    dropAt,
  };
}

/** Whether the unit may fire this weapon as it stands: a Status weapon needs the Status, and shuts out the rest. */
export function usableNow(u: AiUnitInstance, w: { requiresStatus?: string }): boolean {
  const held = (u.statuses ?? []).map((x) => x.toUpperCase());
  return w.requiresStatus ? held.includes(w.requiresStatus.toUpperCase()) : !held.includes('SIEGE MODE');
}

/** A weapon the unit only gets to fire while it holds a Status (a Siege Tank's Shock Cannon). */
const statusWeapon = (u: AiUnitInstance) => availableWeapons(def(u), u.upgrades, 'Assault').find((w) => w.requiresStatus);
const hasStatus = (u: AiUnitInstance, status: string) => (u.statuses ?? []).some((x) => x.toUpperCase() === status.toUpperCase());

/** A dug-in unit stays where it is: SIEGE MODE forbids Move, Run, Disengage, Charge and Close Ranks. */
export function planted(u: AiUnitInstance): boolean {
  return (u.statuses ?? []).includes('Siege Mode');
}

/**
 * Whether the unit wants to change stance this Movement phase. A Siege Tank digs in when there is something to
 * shell inside the big gun's range and nothing in its face, and packs up when the shelling is over: nothing left
 * in range, or an enemy on top of it that Point Blank stops it firing at.
 */
function stanceChange(state: GameState, u: AiUnitInstance): 'siege' | 'unsiege' | null {
  const w = statusWeapon(u);
  if (!w || u.activated.movement) return null;
  const range = maxRange(w) + rangeModFor(state);
  const inRange = visibleEnemies(state, u, range).filter((v) => !hiddenFrom(v.unit, v.nearest));
  const sieged = hasStatus(u, w.requiresStatus!);
  const pinned = u.engaged && def(u).abilities.some((a) => a.name === 'Point Blank');
  if (!sieged) {
    // Not worth digging in on top of the enemy, or with nothing to shoot.
    return inRange.length && !pinned && !u.engaged ? 'siege' : null;
  }
  return !inRange.length || pinned ? 'unsiege' : null;
}

function stanceOrder(state: GameState, unit: AiUnitInstance, to: 'siege' | 'unsiege'): AiOrder {
  const w = statusWeapon(unit)!;
  const status = w.requiresStatus!;
  const lines = to === 'siege'
    ? [
        `${unit.label} stays where it is and enters ${status}.`,
        `In ${status} it cannot move, counts as Size 3 and fires only its ${w.name} (Range ${typeof w.range === 'number' ? `${w.range}"` : 'E'}).`,
        'Change the model to its sieged pose.',
      ]
    : [
        `${unit.label} leaves ${status}. From now on it moves and fires as normal.`,
        'Change the model back to its mobile pose. It does not move this phase.',
      ];
  return {
    type: 'special',
    unitId: unit.id,
    title: `${unit.label}: ${to === 'siege' ? `Deploy ${status}` : `Leave ${status}`}`,
    lines,
    batches: [],
    reports: [report('done', to === 'siege' ? 'Sieged up' : 'Packed up')],
  };
}

export function moveOrder(state: GameState, unit: AiUnitInstance, profile: Profile): AiOrder {
  const d = def(unit);
  const speed = speedFor(d, unit.models) + speedModFor(state, unit);
  const lines: string[] = [];
  const head = headingText(state, unit.objective);
  lines.push(`Move up to ${speed}" toward ${head} by the shortest path, through Size 0–1 terrain and around Size 2+. End more than 1" from every enemy model.`);
  if (profile === 'rangedLine') {
    const r = preferredRange(d, unit.upgrades) + rangeModFor(state);
    lines.push(`Stop as soon as a model has an enemy Unit within ${r}" and in Line of Sight. End within 1" of terrain for cover where possible.`);
  } else if (profile === 'support') {
    lines.push(unit.objective.kind === 'follow' ? 'Keep behind that Unit, on the side away from the enemy.' : 'Stay within 4" of the Unit it follows, on the side away from the enemy.');
  } else {
    lines.push('Keep the Unit together and behind cover where possible, ready to charge next phase.');
  }
  const reports: OrderReportOption[] = [];
  if (unit.objective.kind === 'marker') {
    lines.push('If the Unit ends within 3" of the Mission Marker, tap "Reached the marker".');
    reports.push(report('reached', 'Reached the marker'));
  }
  if (unit.objective.kind === 'lane') {
    lines.length = 0;
    lines.push(`Move up to ${speed}" straight toward ${head} by the shortest path. If any model reaches the edge, the Unit leaves the table. Tap "Exited the table".`);
    reports.push(report('exited', 'Exited the table'));
  }
  reports.push(report('done', 'Moved'));
  return { type: 'move', unitId: unit.id, title: `${unit.label}: Move`, lines, heading: unit.objective, headingText: head, batches: [], reports };
}

function disengageOrder(state: GameState, unit: AiUnitInstance): AiOrder {
  const d = def(unit);
  const speed = speedFor(d, unit.models) + speedModFor(state, unit);
  const s = currentSupply(d, unit.models);
  const lines = [
    `DISENGAGE: move up to ${speed}" toward ${headingText(state, unit.objective)}. Every model must end more than 1" from every enemy model.`,
    'Remove any model that cannot get clear. If the Leading Model cannot get clear, the Unit stays where it is and the Leading Model is removed.',
    s > unit.engagedEnemySupply
      ? `Its Supply (${s}) is higher than the Engaged enemy's (${unit.engagedEnemySupply}), so it may still shoot or charge this round.`
      : 'It may not shoot or charge for the rest of this round.',
  ];
  return { type: 'disengage', unitId: unit.id, title: `${unit.label}: Disengage`, lines, heading: unit.objective, batches: [], reports: [report('done', 'Disengaged')] };
}

function runLines(state: GameState, unit: AiUnitInstance, profile: Profile): string {
  const d = def(unit);
  const speed = speedFor(d, unit.models) + speedModFor(state, unit);
  const head = profile === 'meleeRusher' || unit.objective.kind === 'enemy' ? 'the nearest enemy Unit, ending more than 1" away' : headingText(state, unit.objective);
  return `Otherwise: RUN up to ${speed}" toward ${head}.`;
}

export function rangedOrder(state: GameState, unit: AiUnitInstance, rng: Rng, profile: Profile, engagedOnly: boolean): AiOrder | null {
  const batches = batchesFor(state, unit, rng, 'Assault');
  if (batches.length === 0) return null;
  const main = batches[0]!;
  const r = (typeof main.range === 'number' ? main.range : 0) + (main.rangeMod ?? 0);
  const lr = main.longRange ? main.longRange + (main.rangeMod ?? 0) : undefined;
  const focus = focusFor(state, unit);
  const lines: string[] = [];
  if (engagedOnly) {
    lines.push('The Unit is Engaged. It fires at the Unit it is Engaged with, which may make Evade rolls.');
  } else {
    lines.push(`RANGED ATTACK an enemy Unit in Line of Sight within ${r}" of at least one model${lr ? `, or within ${lr}" with LONG RANGE at -1 to hit` : ''}. Target ${focusText(focus)}`);
    lines.push('Only models with range and Line of Sight fire. Lower the model count below if fewer can.');
    if (batches.length > 1) lines.push(`SIDEARM weapons (${batches.slice(1).map((b) => `${b.weapon} ${typeof b.range === 'number' ? `${b.range}"` : 'engaged'}`).join(', ')}) fire at the same target if it is within their own range.`);
  }
  if (currentCard(state.orderDeck).id === 'stim' && def(unit).tags.includes('Biological')) lines.push('STIM: the Unit takes 1 damage before it fires. Enter it in the roster.');
  if (!engagedOnly) lines.push(runLines(state, unit, profile));
  const reports: OrderReportOption[] = [report('attacked', 'Attacked'), report('noTarget', engagedOnly ? 'Could not fire' : 'No target, ran')];
  return { type: 'ranged', unitId: unit.id, title: `${unit.label}: Ranged Attack`, lines, focus, heading: unit.objective, headingText: headingText(state, unit.objective), batches, reports };
}

/**
 * How far an AI charge goes, in the words the players read it: they roll for the AI on the table. `speed` is the
 * unit's Speed; `bonus` what its cards add.
 */
export function chargeRollText(dice: '1d6' | '2d6high', speed: number, bonus = 0): string {
  const roll = dice === '2d6high' ? 'roll 2D6 for the AI and keep the higher' : 'roll a D6 for the AI';
  return `Charge distance: ${roll}, then add its Speed of ${speed}${bonus ? ` and ${bonus} from its card` : ''}.`;
}

export function chargeOrder(state: GameState, unit: AiUnitInstance, rng: Rng, profile: Profile, alsoRanged: boolean): AiOrder {
  const d = def(unit);
  const card = currentCard(state.orderDeck);
  const speed = speedFor(d, unit.models) + speedModFor(state, unit);
  const diff = DIFFICULTIES[state.config.difficulty];
  const cm = cardMods(state, unit);
  const bonus = (card.chargeBonus ?? 0) + (cm?.chargeBonus ?? 0);
  const dice = cm?.twoDiceCharge ? '2d6high' : diff.chargeDice;
  const threshold = card.chargeThreshold === 'likely' ? speed + 3 + bonus : speed + 6 + bonus;
  const focus = focusFor(state, unit);
  const lines: string[] = [];
  lines.push(`CHARGE an enemy Ground Unit within ${threshold}" of the Leading Model, measured along its path. Target ${focusText(focus)}`);
  lines.push(`${chargeRollText(dice, speed, bonus)} The charge succeeds if the Leading Model can end within 1" of the target. Set the models base-to-base, then the rest in Coherency.`);
  const batches: DiceInstruction[] = [];
  let impact: DiceInstruction | undefined;
  if (d.impact) {
    lines.push(impactText(d.impact.dice, d.impact.hit, unit.models));
    const w = { id: 'impact', name: 'IMPACT', phase: 'Combat' as const, range: 'E' as const, target: 'Ground' as const, roa: d.impact.dice, hit: d.impact.hit, dmg: 1, surgeTypes: [], keywords: [], text: '' };
    let instr = diceInstruction(w, unit.models);
    const mod = hitModFor(state, unit) + (state.modeState['impactBonus'] ? 1 : 0);
    if (mod) instr.hitMod = mod;
    instr = rollInstruction(rng, instr);
    impact = instr;
  }
  if (alsoRanged) {
    const rb = batchesFor(state, unit, rng, 'Assault');
    if (rb.length) {
      const main = rb[0]!;
      const r = (typeof main.range === 'number' ? main.range : 0) + (main.rangeMod ?? 0);
      lines.push(`If it cannot charge, it makes a RANGED ATTACK instead against an enemy Unit in Line of Sight within ${r}", chosen the same way.`);
      batches.push(...rb);
    }
  }
  lines.push(runLines(state, unit, profile));
  const reports: OrderReportOption[] = [report('charged', 'Charge succeeded'), report('chargeFailed', 'Charge failed')];
  if (alsoRanged && batches.length) reports.push(report('attacked', 'Fired instead'));
  reports.push(report('noTarget', 'No target, ran'));
  const order: AiOrder = { type: 'charge', unitId: unit.id, title: `${unit.label}: Charge`, lines, focus, heading: unit.objective, headingText: headingText(state, unit.objective), batches, charge: { speed, min: speed + 1 + bonus, max: speed + 6 + bonus, dice }, reports };
  if (impact) order.impact = impact;
  return order;
}

export function supportAssault(state: GameState, unit: AiUnitInstance): AiOrder {
  const d = def(unit);
  const speed = speedFor(d, unit.models) + speedModFor(state, unit);
  const head = headingText(state, unit.objective);
  const lines = [
    unit.objective.kind === 'follow' ? `RUN up to ${speed}" toward ${head}.` : `RUN up to ${speed}" to within 4" of ${head}.`,
    'Keep out of enemy charge range where possible.',
  ];
  if (d.id === 'medic') lines.push('At the start of the next round, every damaged Biological AI Unit within 4" of the Medics heals 1 damage per Medic model. Enter it in the roster.');
  if (d.id === 'sentry') lines.push('Guardian Shield: ranged attacks against AI Units within 4" of the Sentries roll 1 fewer die.');
  return { type: 'run', unitId: unit.id, title: `${unit.label}: Support`, lines, heading: unit.objective, batches: [], reports: [report('done', 'Done')] };
}

function combatOrder(state: GameState, unit: AiUnitInstance, rng: Rng): AiOrder {
  const batches = batchesFor(state, unit, rng, 'Combat');
  const focus = focusFor(state, unit);
  const lines = [
    'CLOSE RANKS: move the Leading Model up to 3" toward the enemy it is Engaged with. Set the others in Coherency, as many as possible base-to-base with enemy models. Models already in base contact stay put.',
    'Attack with every model in the Fighting Rank (within 1" of an enemy) and the Supporting Rank (touching a friendly model in the Fighting Rank). Lower the model count below if fewer qualify.',
    'If Engaged with more than one enemy Unit, all dice go to ' + focusText({ ...focus, primary: focus.primary === 'onMarker' ? 'nearest' : focus.primary }),
    'If either Unit is wiped out, update the Engaged toggle.',
  ];
  return { type: 'closeCombat', unitId: unit.id, title: `${unit.label}: Close Combat`, lines, focus, batches, reports: [report('done', 'Resolved')] };
}

/** Decide the AI's next activation for the current phase, or null to pass. */
export function decideAi(state: GameState, mode: MissionMode, ctx: MissionCtx, rng: Rng): AiOrder | null {
  const card = currentCard(state.orderDeck);
  // A Structure is never activated: it stands there and takes what comes.
  const table = onTable(state).filter((u) => !isStructure(u));
  if (state.phase === 'movement') {
    const cands = deployable(state, mode, ctx);
    if (cands.length) return deployOrder(state, pickDeploy(state, cands));
    // Engaged shooters/support that can break away.
    for (const u of table) {
      if (u.activated.movement || !u.engaged || heldInPlace(state, u) || planted(u)) continue;
      const p = classify(def(u));
      if ((p === 'rangedLine' || p === 'support') && currentSupply(def(u), u.models) > u.engagedEnemySupply) return disengageOrder(state, u);
    }
    // Stance first: a gun that has to be set up is set up before the rest of the force walks on.
    for (const u of table) {
      const to = stanceChange(state, u);
      if (to) return stanceOrder(state, u, to);
    }
    // Units that still want to move.
    const movers = table
      .filter((u) => !u.activated.movement && !u.engaged && !heldInPlace(state, u) && !planted(u))
      .filter((u) => {
        const p = classify(def(u));
        if (u.objective.kind === 'enemy' || u.objective.kind === 'lane' || u.objective.kind === 'point') return true;
        if (u.objective.kind === 'follow') return true;
        if (u.atObjective && card.advance !== 'aggressive') return false;
        if (u.atObjective && p === 'rangedLine') return false;
        return true;
      })
      .sort((a, b) => (a.deployedRound ?? 0) - (b.deployedRound ?? 0));
    const mover = movers[0];
    if (mover) return moveOrder(state, mover, classify(def(mover)));
    return null;
  }
  if (state.phase === 'assault') {
    const cands = table.filter((u) => !u.activated.assault);
    const order: Profile[] = ['rangedLine', 'brawler', 'meleeRusher', 'support'];
    for (const p of order) {
      for (const u of cands) {
        const d = def(u);
        if (classify(d) !== p) continue;
        if (u.objective.kind === 'lane' && !u.engaged && !planted(u)) {
          // Stalled on the line (a side marker's reward): it does not run this round.
          if (heldInPlace(state, u)) continue;
          const speed = speedFor(d, u.models) + speedModFor(state, u);
          return { type: 'run', unitId: u.id, title: `${u.label}: Run`, lines: [`RUN up to ${speed}" straight toward ${headingText(state, u.objective)}. If any model reaches the edge, the Unit leaves the table. Tap "Exited the table".`], heading: u.objective, batches: [], reports: [report('exited', 'Exited the table'), report('done', 'Ran')] };
        }
        if (u.engaged) {
          if (p === 'rangedLine' && !u.disengagedThisRound) {
            const o = rangedOrder(state, u, rng, p, true);
            if (o) return o;
          }
          continue;
        }
        if (u.disengagedThisRound) {
          const speed = speedFor(d, u.models) + speedModFor(state, u);
          return { type: 'run', unitId: u.id, title: `${u.label}: Run`, lines: [`It Disengaged this round and cannot attack. RUN up to ${speed}" toward ${headingText(state, u.objective)}.`], heading: u.objective, batches: [], reports: [report('done', 'Ran')] };
        }
        if (planted(u)) {
          // Dug in: it shells what it can see and never runs or charges.
          const o = rangedOrder(state, u, rng, 'rangedLine', false);
          if (o) return { ...o, held: true };
          continue;
        }
        if (heldInPlace(state, u)) {
          // Holding its ground: it never runs. A fighter charges an enemy that comes within its Speed + 4" (a sure
          // charge: any roll of 1-4 makes it); otherwise it fires if anything is in range, or waits.
          if (p === 'meleeRusher' || p === 'brawler') return { ...chargeOrder(state, u, rng, p, p === 'brawler'), held: true };
          const o = rangedOrder(state, u, rng, p, false);
          if (o) return { ...o, held: true };
          continue;
        }
        if (p === 'rangedLine') {
          const o = rangedOrder(state, u, rng, p, false);
          if (o) return o;
        } else if (p === 'meleeRusher') {
          return chargeOrder(state, u, rng, p, false);
        } else if (p === 'brawler') {
          return chargeOrder(state, u, rng, p, true);
        } else {
          const ws = availableWeapons(d, u.upgrades, 'Assault').filter((w) => w.target !== 'Flying');
          if (ws.length && card.advance === 'aggressive') {
            const o = rangedOrder(state, u, rng, p, false);
            if (o) return o;
          }
          return supportAssault(state, u);
        }
      }
    }
    return null;
  }
  if (state.phase === 'combat') {
    const cands = table
      .filter((u) => u.engaged && !u.activated.combat)
      .sort((a, b) => {
        const ea = bestWeapon(def(a), a.upgrades, 'Combat');
        const eb = bestWeapon(def(b), b.upgrades, 'Combat');
        return (eb ? eb.roa * b.models : 0) - (ea ? ea.roa * a.models : 0);
      });
    const u = cands[0];
    if (u) return combatOrder(state, u, rng);
    return null;
  }
  return null;
}

/** Whether the AI should pass early in the Movement phase (nothing useful left). */
export function shouldPassEarly(state: GameState): boolean {
  const card = currentCard(state.orderDeck);
  return !!card.passEarly && DIFFICULTIES[state.config.difficulty].passEarly;
}

