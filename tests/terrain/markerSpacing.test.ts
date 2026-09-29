import { describe, expect, it } from 'vitest';
import { DEPLOYMENTS } from '@data/index';
import { createGame } from '@engine/director/reducer';
import { mapLayout, remixId } from '@engine/terrain/remix';
import { mapsFor } from '@data/terrainMaps';
import { makeConfig } from '../engine/helpers';

describe('Mission Markers moved off terrain', () => {
  // They aim for 6" apart; the Lost Temple's plateau can hold one closer than that, never on top of another.
  it('never land on another marker, on any deployment card and any printed map', () => {
    const close: string[] = [];
    for (const dep of DEPLOYMENTS) {
      for (const mapId of [...mapsFor(dep.scale).map((m) => m.id), remixId(dep.scale, 63352), remixId(dep.scale, 7919)]) {
        const g = createGame(makeConfig({ modeId: 'frontlines', deploymentId: dep.id, terrainMapId: mapId }), dep, mapLayout(mapId, dep));
        const ms = g.markers;
        for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
          if (Math.hypot(ms[i]!.x - ms[j]!.x, ms[i]!.y - ms[j]!.y) < 4) close.push(`${dep.id} ${mapId}: ${ms[i]!.id} and ${ms[j]!.id} ${Math.hypot(ms[i]!.x - ms[j]!.x, ms[i]!.y - ms[j]!.y).toFixed(1)}`);
        }
      }
    }
    expect(close).toEqual([]);
  });
});
