import type { MissionMode } from '../types/mission';
import { OFFICIAL_MODES } from './official';
import { COOP_MODES } from './coop';

/** The skirmish modes offered in the setup wizard. Campaign missions are built on demand (`camp:<id>`). */
export const MODES: MissionMode[] = [...COOP_MODES, ...OFFICIAL_MODES];

/** Modes built lazily by id prefix, so hundreds of campaign missions never sit in `MODES`. */
const builders: { prefix: string; build(id: string): MissionMode }[] = [];
const built = new Map<string, MissionMode>();

/** Register a family of modes resolved by id prefix (used by the campaign). */
export function registerModes(prefix: string, build: (id: string) => MissionMode): void {
  if (!builders.some((b) => b.prefix === prefix)) builders.push({ prefix, build });
}

export function modeById(id: string): MissionMode {
  const m = MODES.find((x) => x.id === id);
  if (m) return m;
  const cached = built.get(id);
  if (cached) return cached;
  const b = builders.find((x) => id.startsWith(x.prefix));
  if (b) {
    const made = b.build(id);
    built.set(id, made);
    return made;
  }
  throw new Error(`Unknown mode ${id}`);
}
