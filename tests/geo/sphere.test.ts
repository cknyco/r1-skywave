import { describe, expect, it } from 'vitest';
import { angleBetween, distanceKm, fromVec, slerp, toVec, wrapLon } from '../../src/geo/sphere';

describe('sphere', () => {
  it('round-trips lon/lat through unit vectors', () => {
    const p = fromVec(toVec(13.4, 52.52));
    expect(p.lon).toBeCloseTo(13.4, 9);
    expect(p.lat).toBeCloseTo(52.52, 9);
  });

  it('wraps longitude into [-180, 180)', () => {
    expect(wrapLon(190)).toBeCloseTo(-170);
    expect(wrapLon(-190)).toBeCloseTo(170);
    expect(wrapLon(180)).toBeCloseTo(-180);
    expect(wrapLon(540)).toBeCloseTo(-180);
  });

  it('measures Berlin to Paris at about 878 km', () => {
    expect(distanceKm(13.405, 52.52, 2.3522, 48.8566)).toBeGreaterThan(870);
    expect(distanceKm(13.405, 52.52, 2.3522, 48.8566)).toBeLessThan(885);
  });

  it('slerp crosses the antimeridian the short way', () => {
    const a = toVec(170, 0), b = toVec(-170, 0);
    const mid = fromVec(slerp(a, b, 0.5));
    expect(Math.abs(mid.lon)).toBeCloseTo(180, 6);
    expect(angleBetween(a, b)).toBeCloseTo((20 * Math.PI) / 180, 9);
  });

  it('slerp returns the endpoints at t=0 and t=1', () => {
    const a = toVec(0, 10), b = toVec(40, -20);
    expect(fromVec(slerp(a, b, 0)).lat).toBeCloseTo(10, 9);
    expect(fromVec(slerp(a, b, 1)).lon).toBeCloseTo(40, 9);
  });
});
