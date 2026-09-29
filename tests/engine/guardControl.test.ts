import { describe, expect, it } from 'vitest';
import { markerHolder } from '@engine/sense/query';

describe('a side-marker guard and marker control', () => {
  it('adds no Supply: guard + 1 AI Supply against 1 of yours is contested', () => {
    expect(markerHolder(1, 1, true)).toBe('contested');
  });
  it('guard + 1 AI Supply against 2 of yours: you control it', () => {
    expect(markerHolder(1, 2, true)).toBe('players');
  });
  it('a guard alone against your Units keeps it contested; alone with nobody near, it holds nothing', () => {
    expect(markerHolder(0, 3, true)).toBe('contested');
    expect(markerHolder(0, 0, true)).toBe('none');
  });
  it('other AI Units still control it by their own Supply', () => {
    expect(markerHolder(2, 1, true)).toBe('ai');
  });
  it('without a guard, the usual Supply comparison', () => {
    expect(markerHolder(0, 1)).toBe('players');
    expect(markerHolder(1, 1)).toBe('contested');
  });
});
