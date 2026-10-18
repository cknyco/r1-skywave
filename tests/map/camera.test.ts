import { describe, expect, it } from 'vitest';
import { atPlace, planFlight, sampleFlight } from '../../src/map/camera';

describe('flights', () => {
  it('short hops take 500 ms and do not zoom out', () => {
    const f = planFlight({ lon: 13.4, lat: 52.5, z: 7 }, { lon: 13.9, lat: 52.6, z: 7 }, 0);
    expect(f.dur).toBe(500);
    expect(sampleFlight(f, 250).cam.z).toBeCloseTo(7, 6);
  });

  it('long flights zoom out to a globe view mid-way and land exactly', () => {
    const f = planFlight({ lon: 13.4, lat: 52.5, z: 7 }, { lon: 139.7, lat: 35.7, z: 7 }, 1000);
    expect(f.dur).toBeGreaterThan(1500);
    expect(f.dur).toBeLessThanOrEqual(2600);
    expect(sampleFlight(f, 1000 + f.dur / 2).cam.z).toBeLessThan(4);
    const end = sampleFlight(f, 1000 + f.dur + 5);
    expect(end.done).toBe(true);
    expect(end.cam).toEqual({ lon: 139.7, lat: 35.7, z: 7 });
  });

  it('a glide is a short hop at any distance: 500 ms, no zoom dip', () => {
    // 2.9° is the 28 px catch plus a big dot's radius at zoom 4 on the equator: an ordinary flight of that length arcs out
    const from = { lon: 0, lat: 0, z: 4 }, to = { lon: 2.9, lat: 0, z: 4 };
    expect(planFlight(from, to, 0).dur).toBeGreaterThan(1200);
    expect(planFlight(from, to, 0).peakZ).toBeLessThan(4);
    const f = planFlight(from, to, 0, true);
    expect(f.dur).toBe(500);
    expect(f.peakZ).toBe(4);
    expect(sampleFlight(f, 250).cam.z).toBeCloseTo(4, 6);
  });
});

describe('atPlace', () => {
  it('is true only when the camera is on the place', () => {
    expect(atPlace({ lon: 13.4, lat: 52.5, z: 7 }, 13.4, 52.5)).toBe(true);
    expect(atPlace({ lon: 13.4, lat: 52.5, z: 7 }, 13.41, 52.5)).toBe(false);
    expect(atPlace({ lon: 13.4, lat: 52.5, z: 7 }, 13.4, 52.49)).toBe(false);
    expect(atPlace({ lon: 180, lat: 0, z: 3 }, -180, 0)).toBe(true);   // the same meridian
  });
});
