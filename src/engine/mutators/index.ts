import type { GameState } from '../types/game';
import type { MutatorDef } from '../types/mission';
import type { Rng } from '../rng';

export const MUTATORS: MutatorDef[] = [
  { id: 'avenger', name: 'Avenger', cost: 2, text: 'Whenever an AI unit is destroyed, all AI attacks are at +1 to hit for the rest of the round.' },
  { id: 'barrier', name: 'Barrier', cost: 1, text: 'The first damage each AI unit takes each round is reduced by 2.' },
  { id: 'speedFreaks', name: 'Speed Freaks', cost: 1, text: 'AI units move 1" further.' },
  { id: 'longRange', name: 'Long Range', cost: 2, text: 'AI ranged weapons gain 2" of range.' },
  { id: 'justDie', name: 'Just Die!', cost: 2, text: 'Every destroyed AI unit returns to Reserves once more, whatever the difficulty.' },
  { id: 'voidReanimators', name: 'Void Reanimators', cost: 3, text: 'Destroyed AI units return to Reserves at the end of the same round at half strength.' },
  { id: 'aggressiveDeployment', name: 'Aggressive Deployment', cost: 2, text: 'AI units may deploy from either side edge, more than 10" from player models.' },
  { id: 'hardenedWill', name: 'Hardened Will', cost: 1, text: 'The first time each round the AI hero would be destroyed, it survives with 1 HP instead.' },
  { id: 'diffusion', name: 'Diffusion', cost: 1, text: 'Any single hit of more than 5 damage on an AI unit is halved (rounded up).' },
  { id: 'slimPickings', name: 'Slim Pickings', cost: 2, text: 'The players\' Supply Pool is 1 lower each round (apply it yourself).' },
  { id: 'outbreak', name: 'Outbreak', cost: 2, text: 'The AI Supply Pool escalates 1 faster each round.' },
];

export function hasMutator(state: GameState, id: string): boolean {
  return state.config.mutators.includes(id);
}

/** Pick a random mutator set whose costs sum to exactly `points` (2–3 mutators). */
export function randomMutators(points: number, rng: Rng): string[] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const pool = rng.shuffle(MUTATORS);
    const picked: MutatorDef[] = [];
    let sum = 0;
    for (const m of pool) {
      if (picked.length >= 3) break;
      if (sum + m.cost <= points) {
        picked.push(m);
        sum += m.cost;
      }
      if (sum === points && picked.length >= 2) return picked.map((m) => m.id);
    }
  }
  return MUTATORS.slice(0, 2).map((m) => m.id);
}

