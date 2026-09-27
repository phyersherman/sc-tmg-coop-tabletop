import { describe, expect, it } from 'vitest';
import { CARDS, UNITS, deploymentById } from '@data/index';
import { apply, createGame } from '@engine/director/reducer';
import { makePlayerUnit } from '@engine/sense/playerUnits';
import { buildAiArmy } from '@engine/army/builder';
import { makeConfig } from './helpers';
import type { GameState } from '@engine/types/game';

const dep = deploymentById('abandoned-camp');
const flat = { seed: 1, table: dep.table, pieces: [], fireLanes: [], violations: [] };

describe('the AI\'s sidearms', () => {
  it('fire only at a target within their own range, whatever the main weapon reaches', () => {
    // A lone AI Goliath: Autocannon 12" (long 18"), Underbelly Machine Gun 8", Hellfire 16", Haywire 12".
    const army = buildAiArmy({ faction: 'Terran', budget: 250, ownership: { goliath: 1 }, heroAllowed: false, seed: 1, units: UNITS, cards: CARDS });
    expect(army.units.map((u) => u.defId)).toEqual(['goliath']);
    const cfg = makeConfig({ modeId: 'frontlines', playMode: 'video', aiFaction: 'Terran', army });
    cfg.playerUnits = [makePlayerUnit('m1', 'marine', 'large', [], 'Marines', 100)];
    let s: GameState = createGame(cfg, dep, flat);
    let fired: string[] = [];
    const seen: string[] = [];
    let placed = false;
    for (let i = 0; i < 120 && !fired.length; i++) {
      const goliath = s.army.units[0]!;
      if (s.phase === 'assault' && goliath.location === 'table' && !placed) {
        // Before the AI gives its Assault order: the Marines 12" north of the Goliath (about 10" base to base) (which came on from the south
        // edge), in the Autocannon's reach and out of the machine gun's.
        const gp = s.sense!.ai[goliath.id]![0]!;
        s.sense!.players['m1'] = s.sense!.players['m1']!.map((p, k) => ({ ...p, x: gp.x + (k % 3) * 0.8, y: gp.y - 12 - Math.floor(k / 3) * 0.8 }));
        placed = true;
      }
      if (s.step.kind === 'PLAYERS_TURN') {
        const m = s.playerUnits[0]!;
        s = s.phase === 'movement' && m.location === 'reserves' ? apply(s, { t: 'playerDeploy', unitId: 'm1', point: { x: 18, y: 4 } }) : apply(s, { t: 'playersPass' });
        continue;
      }
      if (s.step.kind === 'AI_ORDER') {
        seen.push(`${s.round}:${s.phase}:${s.step.order.type}:${goliath.location}`);
        if (s.phase === 'assault' && s.step.order.type === 'ranged' && goliath.location === 'table') {
          const n = s.attackLog.length;
          s = apply(s, { t: 'aiResolve' });
          for (let k = 0; k < 8 && s.step.kind === 'AI_SAVES'; k++) s = apply(s, { t: 'enterSaves', saved: 0 });
          fired = s.attackLog.slice(n).map((a) => a.weapon);
          break;
        }
        s = apply(s, { t: 'aiResolve' });
        continue;
      }
      if (s.step.kind === 'AI_SAVES') { s = apply(s, { t: 'enterSaves', saved: 0 }); continue; }
      s = apply(s, { t: 'continue' });
    }
    expect(fired, seen.join(' ')).toContain('Autocannon');
    expect(fired).not.toContain('Underbelly Machine Gun');
    expect(s.log.some((e) => /Underbelly Machine Gun is out of range/.test(e.text))).toBe(true);
  });
});
