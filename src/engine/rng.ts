/** Deterministic seeded RNG (mulberry32) with an explicit counter so state can be replayed. */

export interface RngState {
  seed: number;
  counter: number;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns a float in [0,1) for the given seed/counter, deterministically. */
export function randomAt(seed: number, counter: number): number {
  // Mix counter into seed so consecutive counters give independent streams.
  const s = (seed ^ Math.imul(counter + 1, 0x9e3779b1)) >>> 0;
  return mulberry32(s)();
}

export class Rng {
  constructor(public state: RngState) {}

  static from(seed: number, counter = 0): Rng {
    return new Rng({ seed, counter });
  }

  next(): number {
    const v = randomAt(this.state.seed, this.state.counter);
    this.state = { seed: this.state.seed, counter: this.state.counter + 1 };
    return v;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  d6(): number {
    return this.int(1, 6);
  }

  d3(): number {
    return this.int(1, 3);
  }

  /** Roll `n` d6 and return results. */
  rollD6(n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(this.d6());
    return out;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick from empty array');
    return arr[this.int(0, arr.length - 1)] as T;
  }

  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const t = a[i] as T;
      a[i] = a[j] as T;
      a[j] = t;
    }
    return a;
  }
}

/** Hash a string to a 32-bit seed. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
