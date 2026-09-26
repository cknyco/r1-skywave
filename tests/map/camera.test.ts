import { describe, expect, it } from 'vitest';
import { planFlight, sampleFlight } from '../../src/map/camera';

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
});
