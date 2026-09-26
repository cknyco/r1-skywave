import { describe, expect, it } from 'vitest';
import { clusterScreen, minCountForZoom } from '../../src/map/lod';

describe('lod', () => {
  it('merges dots closer than the cell size into the biggest one', () => {
    const out = clusterScreen([
      { i: 1, x: 100, y: 100, count: 3 },
      { i: 2, x: 110, y: 104, count: 40 },
      { i: 3, x: 200, y: 200, count: 1 },
    ], 24);
    expect(out).toEqual([{ i: 2, x: 110, y: 104, count: 43 }, { i: 3, x: 200, y: 200, count: 1 }]);
  });

  it('hides small places when zoomed out', () => {
    expect(minCountForZoom(2)).toBeGreaterThan(minCountForZoom(7));
    expect(minCountForZoom(7)).toBe(1);
  });
});
