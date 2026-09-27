import type { GameState, MarkerState } from '../types/game';
import type { AiObjective, AiUnitInstance } from '../types/army';
import type { MissionMode, MissionCtx } from '../types/mission';
import { aiSegments, dist, segmentMidpoint, type Pt } from '../terrain/geometry';
import { currentCard } from './orderDeck';
import { classify } from './profiles';
import { unitById } from '@data/index';
import { currentSupply } from '../units/supply';
import { unitCentroid } from '../sense/query';

/** Best-guess position of a unit from what the player has confirmed. */
export function unitPoint(state: GameState, unit: AiUnitInstance): Pt {
  const sensed = unit.location === 'table' ? unitCentroid(state, unit) : null;
  if (sensed) return sensed;
  if (unit.est && unit.location === 'table') return unit.est;
  if (unit.lastMarker) {
    const m = state.markers.find((x) => x.id === unit.lastMarker);
    if (m) return { x: m.x, y: m.y };
  }
  const segs = aiSegments(state.deployment);
  const pts = segs.map((s) => segmentMidpoint(s, state.deployment.table));
  if (unit.objective.kind === 'marker') {
    const m = state.markers.find((x) => x.id === (unit.objective as { markerId: number }).markerId);
    if (m && pts.length) return pts.reduce((a, b) => (dist(a, m) <= dist(b, m) ? a : b));
  }
  const avg = pts.reduce((a, b) => ({ x: a.x + b.x, y: a.y + b.y }), { x: 0, y: 0 });
  return pts.length ? { x: avg.x / pts.length, y: avg.y / pts.length } : { x: 0, y: 0 };
}

export function markerScore(marker: MarkerState, from: Pt): number {
  const aff = marker.affinity === 'ai' ? 3 : marker.affinity === 'neutral' ? 2 : 1;
  const ctl = marker.controlledBy !== 'ai' ? 3 : 0;
  const act = marker.active ? 0 : -6;
  const lock = marker.locked ? -10 : 0;
  return aff + ctl + act + lock - dist(marker, from) / 6;
}

export function assignObjectives(state: GameState, mode: MissionMode, ctx: MissionCtx): void {
  const card = currentCard(state.orderDeck);
  const units = state.army.units.filter((u) => u.location !== 'destroyed' && u.location !== 'exited');
  const counts: Record<number, number> = {};
  const activeMarkers = state.markers.filter((m) => m.active);
  const cap = Math.max(1, Math.ceil(units.length / Math.max(1, activeMarkers.length)));
  const sorted = units
    .slice()
    .sort((a, b) => currentSupply(unitById(b.defId), b.models) - currentSupply(unitById(a.defId), a.models));
  const heavy = sorted.find((u) => u.location === 'table') ?? sorted[0];
  for (const u of sorted) {
    if (u.special?.fixedObjective) continue;
    const override = mode.objectiveFor?.(ctx, u);
    if (override) {
      u.objective = override;
      continue;
    }
    const def = unitById(u.defId);
    const profile = classify(def);
    if (profile === 'support' && heavy && heavy.id !== u.id) {
      u.objective = { kind: 'follow', unitId: heavy.id };
      continue;
    }
    if (card.advance === 'aggressive' && (profile === 'meleeRusher' || profile === 'brawler')) {
      u.objective = { kind: 'enemy' };
      continue;
    }
    const from = unitPoint(state, u);
    let best: MarkerState | undefined;
    let bestScore = -Infinity;
    for (const m of state.markers) {
      // A side marker's guard holds it; the rest of the force leaves it be.
      if (m.side) continue;
      const s = markerScore(m, from) - ((counts[m.id] ?? 0) >= cap ? 4 : 0);
      if (s > bestScore) {
        bestScore = s;
        best = m;
      }
    }
    if (best) {
      const prev: AiObjective = u.objective;
      if (!(prev.kind === 'marker' && prev.markerId === best.id)) u.atObjective = false;
      u.objective = { kind: 'marker', markerId: best.id };
      counts[best.id] = (counts[best.id] ?? 0) + 1;
    } else {
      u.objective = { kind: 'enemy' };
    }
  }
}
