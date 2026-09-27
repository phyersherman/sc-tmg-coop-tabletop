import { describe, expect, it } from 'vitest';
import { allocateSlotTags, assignGameTags, collectionSlots } from '@engine/sense/tags';

describe('camera tags from the collection', () => {
  it('gives one tag per unit the collection can field: 18 Marines are three units of 6', () => {
    const slots = collectionSlots({ marine: 18, kerrigan: 1, zealot: 7 });
    expect(slots.filter((s) => s.modelId === 'marine').map((s) => s.label)).toEqual(['Marine 1', 'Marine 2', 'Marine 3']);
    expect(slots.filter((s) => s.modelId === 'kerrigan').length).toBe(1);
    expect(slots.filter((s) => s.modelId === 'zealot').length).toBe(2); // 7 Zealots: two units of 3
  });

  it('keeps every tag for good: more miniatures add tags, none is renumbered', () => {
    const first = allocateSlotTags(collectionSlots({ marine: 12 }), {}, 250);
    const more = allocateSlotTags(collectionSlots({ marine: 18, zergling: 12 }), first, 250);
    expect(more['marine#1']).toBe(first['marine#1']);
    expect(more['marine#2']).toBe(first['marine#2']);
    expect(new Set(Object.values(more)).size).toBe(Object.keys(more).length);
    expect(Math.min(...Object.values(more))).toBeGreaterThanOrEqual(10); // 0-3 are the corners
  });

  it('puts each game unit on its miniature\'s next slot, whatever its variant or upgrades', () => {
    const tags = allocateSlotTags(collectionSlots({ marine: 18 }), {}, 250);
    const players: { id: string; defId: string; name: string; tagId?: number }[] = [{ id: 'p1', defId: 'marine', name: 'Marines' }, { id: 'p2', defId: 'raynor_s_raider__marine_', name: 'Raiders' }];
    const ai: { id: string; defId: string; label: string; tagId?: number }[] = [{ id: 'a1', defId: 'marine', label: 'Marines A' }, { id: 'a2', defId: 'marine', label: 'Marines B' }];
    const out = assignGameTags(ai, players, tags);
    expect(out.players.map((p) => p.tagId)).toEqual([tags['marine#1'], tags['marine#2']]);
    expect(out.ai[0]!.tagId).toBe(tags['marine#3']);
    // A fourth Marine unit is more than the collection holds.
    expect(out.ai[1]!.tagId).toBeUndefined();
    expect(out.untagged).toEqual(['Marines B']);
  });
});
