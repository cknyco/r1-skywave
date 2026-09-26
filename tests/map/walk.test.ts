import { describe, expect, it } from 'vitest';
import { distanceKm } from '../../src/geo/sphere';
import { buildWalk, stepWalk, xy2d } from '../../src/map/walk';

describe('walk', () => {
  it('matches the reference Hilbert order for n=2', () => {
    expect([xy2d(2, 0, 0), xy2d(2, 0, 1), xy2d(2, 1, 1), xy2d(2, 1, 0)]).toEqual([0, 1, 2, 3]);
  });

  it('steps mostly to nearby places', () => {
    const lon: number[] = [], lat: number[] = [];
    for (let i = 0; i < 400; i++) { lon.push(-10 + (i % 20) * 1.5); lat.push(35 + Math.floor(i / 20) * 1.2); }
    const walk = buildWalk(lon, lat);
    let near = 0;
    for (let k = 1; k < walk.order.length; k++) {
      const a = walk.order[k - 1], b = walk.order[k];
      if (distanceKm(lon[a], lat[a], lon[b], lat[b]) < 400) near++;
    }
    expect(near / (walk.order.length - 1)).toBeGreaterThan(0.9);
  });

  it('skips ineligible places, wraps around, and goes both ways', () => {
    const walk = buildWalk([0, 1, 2, 3], [0, 0, 0, 0]);
    const first = walk.order[0];
    const next = stepWalk(walk, first, 1, i => i !== walk.order[1]);
    expect(next).toBe(walk.order[2]);
    expect(stepWalk(walk, next, -1, () => true)).toBe(walk.order[1]);
    expect(stepWalk(walk, walk.order[3], 1, () => true)).toBe(first);
    expect(stepWalk(walk, first, 1, () => false)).toBe(-1);
  });
});
