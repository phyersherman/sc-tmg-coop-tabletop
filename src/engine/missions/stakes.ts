/**
 * What each mission needs from the players right now, and why a battle ended as it did, in one sentence each.
 * Read-only: it looks at the counters the missions already keep (modeState) and the score, never changes them.
 */
import type { GameState } from '../types/game';

export type StakesTone = 'ok' | 'warn' | 'danger';
export interface Stakes { text: string; tone: StakesTone }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** VP lead that ends an official mission early. */
const OFFICIAL_LEAD: Record<string, number> = { frontlines: 10, 'hold-position': 10, 'gather-the-resources': 10, 'divide-and-conquer': 10, 'supply-drop': 12 };

function vpLine(g: GameState): Stakes {
  const { players: p, ai: a } = g.vp;
  const left = g.finalRound - g.round;
  const behind = a > p;
  const text = `Most VP after round ${g.finalRound} wins: you ${p}, AI ${a}.`;
  return { text, tone: behind && left <= 1 ? 'danger' : behind ? 'warn' : 'ok' };
}

/** The mission's win condition and where it stands now, for the top strip and the round review. */
export function missionStakes(g: GameState): Stakes {
  const s = (g.modeState ?? {}) as Record<string, number>;
  const players = g.config.players ?? 1;
  switch (g.config.modeId) {
    case 'temple-of-the-past': {
      const held = s.holds ?? 0;
      if ((s.aiStreak ?? 0) >= 1) return { text: 'The AI held the Temple last round: take Marker 5 back this round or you lose.', tone: 'danger' };
      return { text: `Hold the Temple (Marker 5) at 3 Scoring phases: ${held} of 3 so far.`, tone: 'ok' };
    }
    case 'oblivion-express': {
      const killed = s.killed ?? 0;
      const escaped = s.escaped ?? 0;
      if (escaped >= 1) return { text: `Trains: ${killed} of 2 destroyed. One has escaped: one more and you lose.`, tone: 'danger' };
      return { text: `Destroy 2 of the 3 trains before they leave: ${killed} of 2 so far.`, tone: 'ok' };
    }
    case 'void-thrashing': {
      const hp = s.baseHp ?? 3;
      const text = `Destroy all ${s.thrashers ?? 3} Thrashers: ${s.killed ?? 0} so far. Your base has ${hp} of 3 HP.`;
      return { text, tone: hp <= 1 ? 'danger' : hp < 3 ? 'warn' : 'ok' };
    }
    case 'rifts-to-korhal': {
      const closed = s.closed ?? 0;
      const left = g.finalRound - g.round + 1;
      return { text: `Close 4 rifts before round ${g.finalRound} ends: ${closed} of 4 closed.`, tone: 4 - closed > left ? 'danger' : 4 - closed === left ? 'warn' : 'ok' };
    }
    case 'lock-and-load': {
      const locked = g.markers.filter((m) => m.locked).length;
      return { text: `Lock all ${g.markers.length} markers, or 3 without trailing on VP at the end: ${locked} locked.`, tone: g.round >= g.finalRound - 1 && locked < 3 ? 'warn' : 'ok' };
    }
    case 'mist-opportunities': {
      const need = 6 + 2 * (players - 1);
      const got = s.terrazine ?? 0;
      const left = g.finalRound - g.round + 1;
      return { text: `Gather ${need} terrazine: ${got} of ${need} so far.`, tone: need - got > left * 2 ? 'danger' : need - got > left ? 'warn' : 'ok' };
    }
    case 'dead-of-night':
      return vpLine(g);
    default: {
      const lead = OFFICIAL_LEAD[g.config.modeId];
      if (!lead) return vpLine(g);
      const { players: p, ai: a } = g.vp;
      const gap = a - p;
      const text = `Lead by ${lead} VP to win at once, otherwise most VP after round ${g.finalRound}: you ${p}, AI ${a}.`;
      return { text, tone: gap >= lead - 3 ? 'danger' : gap > 0 ? 'warn' : 'ok' };
    }
  }
}

/** Why the battle ended: the line on the Victory / Defeat banner and at the top of the debrief. */
export function missionOutcome(g: GameState, result: 'won' | 'lost' | 'draw'): string {
  const s = (g.modeState ?? {}) as Record<string, number>;
  const { players: p, ai: a } = g.vp;
  const score = `Final score: you ${p}, AI ${a}.`;
  switch (g.config.modeId) {
    case 'temple-of-the-past':
      if (result === 'lost' && (s.aiStreak ?? 0) >= 2) return 'The AI held the Temple at two Scoring phases in a row.';
      if (result === 'won' && (s.holds ?? 0) >= 3) return 'You held the Temple at three Scoring phases.';
      return result === 'won' ? `You held the Temple ${plural(s.holds ?? 0, 'time')} and kept level on VP. ${score}` : `You held the Temple ${plural(s.holds ?? 0, 'time')}. Victory needed three, or two without trailing on VP. ${score}`;
    case 'oblivion-express':
      if (result === 'won') return `You destroyed ${plural(s.killed ?? 0, 'train')} before they could leave.`;
      if ((s.escaped ?? 0) >= 2) return 'Two trains escaped off the right edge.';
      return `Only ${plural(s.killed ?? 0, 'train')} destroyed by the end. Victory needed two.`;
    case 'void-thrashing':
      if (result === 'won') return `All ${s.thrashers ?? 3} Thrashers destroyed.`;
      if ((s.baseHp ?? 3) <= 0) return 'The Thrashers reached your base and brought it down.';
      return `The battle ended with ${plural((s.thrashers ?? 3) - (s.killed ?? 0), 'Thrasher')} still standing.`;
    case 'rifts-to-korhal':
      return result === 'won' ? 'You closed four rifts.' : `Only ${plural(s.closed ?? 0, 'rift')} closed by the end. Victory needed four.`;
    case 'lock-and-load': {
      const locked = g.markers.filter((m) => m.locked).length;
      return result === 'won' ? `You locked ${plural(locked, 'marker')}. ${score}` : `${plural(locked, 'marker')} locked by the end. Victory needed all of them, or three without trailing on VP. ${score}`;
    }
    case 'mist-opportunities': {
      const need = 6 + 2 * ((g.config.players ?? 1) - 1);
      return result === 'won' ? `You gathered ${need} terrazine.` : `You gathered ${s.terrazine ?? 0} of the ${need} terrazine needed.`;
    }
    default: {
      const lead = OFFICIAL_LEAD[g.config.modeId];
      if (lead && Math.abs(p - a) >= lead && g.round < g.finalRound) return `${p > a ? 'You' : 'The AI'} pulled ${Math.abs(p - a)} VP ahead: a ${lead} VP lead ends the battle. ${score}`;
      return result === 'draw' ? `Level on VP after round ${g.round}. ${score}` : `${result === 'won' ? 'You' : 'The AI'} had the most VP after round ${g.round}. ${score}`;
    }
  }
}
