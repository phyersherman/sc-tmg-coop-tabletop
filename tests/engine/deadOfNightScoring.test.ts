import { describe, expect, it } from 'vitest';
import { deploymentById } from '@data/index';
import { createGame } from '@engine/director/reducer';
import { modeById } from '@engine/missions/index';
import type { MissionCtx } from '@engine/types/mission';
import type { GameState, ScoringAnswers } from '@engine/types/game';
import { makeConfig } from './helpers';

const dep = deploymentById('abandoned-camp');
const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };
const ctxOf = (s: GameState): MissionCtx => ({ state: s, log: () => undefined } as unknown as MissionCtx);

describe('Dead of Night: day scoring', () => {
  it('a marker with its guard or Structure still on it scores for neither side; cleared, it scores', () => {
    const mode = modeById('dead-of-night')!;
    const s = createGame(makeConfig({ modeId: 'dead-of-night', deploymentId: dep.id }), dep, flat);
    s.round = 1;
    const guarded = s.markers.filter((m) => m.side);
    expect(guarded.length).toBeGreaterThan(0);
    // The AI holds every marker, guarded or not.
    for (const m of s.markers) m.controlledBy = 'ai';
    const answers = { markers: Object.fromEntries(s.markers.map((m) => [m.id, 'ai'])), playerSupplyLost: 0, extra: {} } as unknown as ScoringAnswers;
    const before = s.vp.ai;
    mode.onScoring!(ctxOf(s), answers);
    const open = s.markers.filter((m) => !m.side).length;
    expect(s.vp.ai - before).toBe(open);
    // Another AI Unit comes onto a guarded marker: that marker scores for the AI.
    const withEscort = { ...answers, extra: { [`escort:${guarded[0]!.id}`]: true } } as ScoringAnswers;
    const mid = s.vp.ai;
    for (const m of s.markers) m.controlledBy = 'ai';
    mode.onScoring!(ctxOf(s), withEscort);
    expect(s.vp.ai - mid).toBe(open + 1);
    // Each marker still guarded is asked about by day.
    const prompts = mode.scoringPrompts!(ctxOf(s));
    expect(prompts.filter((p) => p.id.startsWith('escort:')).length).toBe(guarded.length);
    // The guard falls: that marker counts from then on.
    guarded[0]!.side = false;
    const again = s.vp.ai;
    for (const m of s.markers) m.controlledBy = 'ai';
    mode.onScoring!(ctxOf(s), answers);
    expect(s.vp.ai - again).toBe(open + 1);
  });
});
