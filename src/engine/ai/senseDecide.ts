import type { AiOrder, GameState, OrderReportOption } from '../types/game';
import type { Pt } from '../sense/types';
import type { Rng } from '../rng';
import { unitById } from '@data/index';
import { findUnit } from '../director/selectors';
import { aiModels, destinationToward, engagedWith, leadingModel, nearestEnemyByPath, unitCentroid, visibleEnemies } from '../sense/query';
import { centroid } from '../sense/homography';
import { fmtPt } from '../sense/geometry2d';
import { pathOptionsFor } from '../sense/placement';
import { aiSegments, closestOnSegment, dist, segmentMidpoint } from '../terrain/geometry';
import { speedFor } from '../units/speed';
import { hasSense } from '../sense/query';
import { currentCard } from './orderDeck';
import { chargeRollText, speedModFor } from './decide';
import { playerUnitSupply } from '../sense/playerUnits';

function headingPoint(state: GameState, order: AiOrder, from: Pt): Pt | null {
  const h = order.heading;
  if (!h) return null;
  switch (h.kind) {
    case 'marker': {
      const m = state.markers.find((x) => x.id === h.markerId);
      return m ? { x: m.x, y: m.y } : null;
    }
    case 'point':
      return { x: h.x, y: h.y };
    case 'lane':
      return { x: h.toEdge === 'E' ? state.terrain.table.width : 0, y: from.y };
    case 'follow': {
      const b = state.army.units.find((u) => u.id === h.unitId);
      return b ? unitCentroid(state, b) : null;
    }
    case 'enemy': {
      const u = findUnit(state, order.unitId);
      const e = nearestEnemyByPath(state, u, true);
      return e ? centroid(e.models) : null;
    }
    case 'hold':
      return from;
  }
}

function withDice(order: AiOrder, models: number): AiOrder {
  const batches = order.batches.map((b) => {
    const roa = b.models ? b.dice / b.models : b.dice;
    const dice = Math.round(roa * models);
    return { ...b, models, dice, rolls: b.rolls?.slice(0, dice) };
  });
  return { ...order, batches };
}

/**
 * Rewrite a generic order into a definite one using sensed positions.
 * Falls back to the original order when the unit or its targets are not seen.
 */
export function applySense(state: GameState, order: AiOrder, _rng: Rng): AiOrder {
  if (!hasSense(state)) return order;
  const unit = findUnit(state, order.unitId);
  const def = unitById(unit.defId);
  // With what its action card and the battle add (or take away).
  const speed = speedFor(def, unit.models) + speedModFor(state, unit);
  const card = currentCard(state.orderDeck);

  if (order.type === 'deploy' && order.dropAt) {
    return { ...order, lines: [...order.lines, `Camera: set the Leading Model down at ${fmtPt(order.dropAt)}.`] };
  }
  if (order.type === 'deploy') {
    const table = state.terrain.table;
    const target = headingPoint(state, order, { x: table.width / 2, y: table.height / 2 }) ?? { x: table.width / 2, y: table.height / 2 };
    const segs = aiSegments(state.deployment);
    const entries = segs.map((s) => closestOnSegment(s, table, target));
    const entry = entries.reduce((a, b) => (dist(a, target) <= dist(b, target) ? a : b), entries[0] ?? segmentMidpoint(segs[0]!, table));
    const d = destinationToward(state, entry, target, speed, pathOptionsFor(state, 'ai', unit.id));
    return { ...order, lines: [...order.lines, `Camera: enter at ${fmtPt(entry)} and move the Leading Model to about ${fmtPt(d.point)}.`] };
  }

  const mine = aiModels(state, unit);
  if (!mine) return { ...order, lines: [...order.lines, 'Camera: this Unit cannot be seen on the table. Resolve the order by hand.'] };
  const from = centroid(mine);

  if (order.type === 'move' || order.type === 'run' || order.type === 'disengage') {
    const target = headingPoint(state, order, from);
    if (!target) return order;
    const lead = leadingModel(mine, target);
    const d = destinationToward(state, lead, target, speed, pathOptionsFor(state, 'ai', unit.id), unit.defId);
    let stop = '';
    if (order.type === 'move' && order.batches.length === 0) {
      // Ranged units stop once an enemy is visible in range: check from the destination.
      const range = def.weapons.filter((w) => w.phase === 'Assault' && typeof w.range === 'number').reduce((a, w) => Math.max(a, w.range as number), 0);
      if (range > 0) {
        const vis = visibleEnemies(state, unit, range);
        if (vis.length) stop = ` ${vis[0]!.unit.name} is already in Line of Sight within ${range}", so it may stay where it is instead.`;
      }
    }
    const lines = [`Camera: move the Leading Model from ${fmtPt(lead)} to about ${fmtPt(d.point)}${d.remaining > 0 ? `, ${Math.round(d.remaining)}" short of the objective` : ', reaching the objective'}.${stop}`, ...order.lines.slice(1)];
    const reports = order.reports.slice();
    return { ...order, lines, reports };
  }

  if (order.type === 'ranged') {
    const main = order.batches[0];
    if (!main) return order;
    const range = (typeof main.range === 'number' ? main.range : 0) + (main.rangeMod ?? 0);
    const lr = main.longRange ? main.longRange + (main.rangeMod ?? 0) : 0;
    let vis = visibleEnemies(state, unit, range);
    let usingLong = false;
    if (!vis.length && lr > range) {
      vis = visibleEnemies(state, unit, lr);
      usingLong = vis.length > 0;
    }
    if (unit.engaged) vis = vis.filter((v) => engagedWith(state, unit).some((e) => e.id === v.unit.id));
    if (vis.length) {
      const focus = order.focus?.primary ?? 'nearest';
      const sorted = vis.slice().sort((a, b) => {
        if (focus === 'weakest' || focus === 'highestSupply') {
          const ka = focus === 'weakest' ? a.unit.models : -playerUnitSupply(a.unit);
          const kb = focus === 'weakest' ? b.unit.models : -playerUnitSupply(b.unit);
          if (ka !== kb) return ka - kb;
        }
        if (a.nearest !== b.nearest) return a.nearest - b.nearest;
        return a.unit.models - b.unit.models;
      });
      const t = sorted[0]!;
      const o = withDice(order, t.firing);
      if (usingLong) for (const b of o.batches) b.hitMod = (b.hitMod ?? 0) - 1;
      const lines = [
        `Camera: RANGED ATTACK ${t.unit.name}, nearest model ${Math.round(t.nearest)}" away${usingLong ? ', with LONG RANGE at -1 to hit' : ''}. ${t.firing} of ${unit.models} models have range and Line of Sight.`,
        ...(order.lines.filter((l) => l.startsWith('STIM'))),
      ];
      const reports: OrderReportOption[] = [...order.reports.filter((r) => r.id !== 'noTarget'), { id: 'noTarget', label: 'Could not fire' }];
      return { ...o, lines, reports };
    }
    const target = headingPoint(state, order, from);
    const lead = leadingModel(mine, target ?? from);
    const d = target ? destinationToward(state, lead, target, speed, pathOptionsFor(state, 'ai', unit.id), unit.defId) : { point: lead, remaining: 0 };
    return { ...order, batches: [], lines: [`Camera: no enemy Unit in Line of Sight within ${lr || range}". RUN the Leading Model from ${fmtPt(lead)} to about ${fmtPt(d.point)}.`], reports: [{ id: 'noTarget', label: 'Ran' }] };
  }

  if (order.type === 'charge') {
    // The charge's own reach: Speed with every bonus the order and its action card give it.
    const reach = order.charge ? order.charge.min - 1 : speed + (card.chargeBonus ?? 0);
    const threshold = card.chargeThreshold === 'likely' ? reach + 3 : reach + 6;
    const e = nearestEnemyByPath(state, unit, true);
    if (e && e.pathDist <= threshold) {
      const lines = [
        `Camera: CHARGE ${e.unit.name}, ${Math.round(e.pathDist)}" from the Leading Model along its path. ${chargeRollText(order.charge?.dice ?? '1d6', speed, reach - speed)} It reaches on a ${Math.max(1, Math.ceil(e.pathDist - 1 - reach))}+ if the path is clear.`,
        ...order.lines.filter((l) => l.startsWith('IMPACT')),
      ];
      return { ...order, lines, batches: order.batches.length ? withDice(order, unit.models).batches : [], reports: order.reports.filter((r) => r.id !== 'attacked' && r.id !== 'noTarget') };
    }
    // Brawler fallback: shoot if something is visible.
    if (order.batches.length) {
      const main = order.batches[0]!;
      const range = (typeof main.range === 'number' ? main.range : 0) + (main.rangeMod ?? 0);
      const vis = visibleEnemies(state, unit, range).sort((a, b) => a.nearest - b.nearest);
      if (vis.length) {
        const t = vis[0]!;
        return { ...withDice(order, t.firing), lines: [`Camera: no enemy in charge reach (nearest ${e ? Math.round(e.pathDist) : '?'}" by path). RANGED ATTACK ${t.unit.name} with ${t.firing} of ${unit.models} models.`], reports: [{ id: 'attacked', label: 'Attacked' }, { id: 'noTarget', label: 'Could not fire' }] };
      }
    }
    const target = e ? centroid(e.models) : headingPoint(state, order, from);
    const lead = leadingModel(mine, target ?? from);
    const d = target ? destinationToward(state, lead, target, speed, pathOptionsFor(state, 'ai', unit.id), unit.defId) : { point: lead, remaining: 0 };
    return { ...order, batches: [], impact: undefined, charge: undefined, lines: [`Camera: no enemy in charge reach (nearest ${e ? Math.round(e.pathDist) : '?'}" by path). RUN the Leading Model from ${fmtPt(lead)} to about ${fmtPt(d.point)}, ending more than 1" from every enemy model.`], reports: [{ id: 'noTarget', label: 'Ran' }] };
  }

  if (order.type === 'closeCombat') {
    const eng = engagedWith(state, unit);
    if (eng.length) {
      const t = eng.slice().sort((a, b) => a.models - b.models)[0]!;
      const inRank = mine.filter((m) => eng.some((pu) => (state.sense?.players[pu.id] ?? []).some((p) => dist(m, p) <= 1.05))).length;
      const supporting = mine.filter((m) => !eng.some((pu) => (state.sense?.players[pu.id] ?? []).some((p) => dist(m, p) <= 1.05)) && mine.some((o) => o !== m && dist(o, m) <= 1.3 && eng.some((pu) => (state.sense?.players[pu.id] ?? []).some((p) => dist(o, p) <= 1.05)))).length;
      const n = Math.min(unit.models, inRank + supporting);
      return { ...withDice(order, Math.max(1, n)), lines: [`Camera: Engaged with ${eng.map((e) => e.name).join(' and ')}. All dice go into ${t.name}. Before Close Ranks, ${inRank} models are in the Fighting Rank and ${supporting} in the Supporting Rank. Adjust after moving.`, order.lines[0]!] };
    }
  }
  return order;
}
