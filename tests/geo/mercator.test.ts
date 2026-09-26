import { describe, expect, it } from 'vitest';
import { project, screenOf, unproject, worldSize } from '../../src/geo/mercator';

describe('mercator', () => {
  it('puts (0,0) at the centre of the world square', () => {
    expect(project(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(worldSize(3)).toBe(2048);
  });

  it('round-trips', () => {
    const p = project(13.4, 52.52, 7);
    const q = unproject(p.x, p.y, 7);
    expect(q.lon).toBeCloseTo(13.4, 9);
    expect(q.lat).toBeCloseTo(52.52, 9);
  });

  it('places the camera centre at the screen centre and wraps the antimeridian', () => {
    const cam = { lon: 179.9, lat: 0, z: 6 };
    expect(screenOf(179.9, 0, cam, 240, 282)).toEqual({ x: 120, y: 141 });
    const east = screenOf(-179.9, 0, cam, 240, 282);
    expect(east.x).toBeGreaterThan(120);
    expect(east.x).toBeLessThan(140);
  });
});
