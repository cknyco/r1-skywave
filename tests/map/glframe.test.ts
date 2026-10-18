import { describe, expect, it } from 'vitest';
import type { Places } from '../../src/data/store';
import { flatness, globeRadius, screenOf, worldSize } from '../../src/geo/mercator';
import { wrapLon } from '../../src/geo/sphere';
import { glFrame, lightViewport, projectGl, unprojectGl } from '../../src/map/gl/frame';
import { Globe } from '../../src/map/globe';

const tex = new Uint32Array(8 * 4).fill(0xff804020);

const places = (pts: [number, number][]): Places => ({
  v: 't', n: pts.length,
  lon: Float32Array.from(pts.map(p => p[0])), lat: Float32Array.from(pts.map(p => p[1])),
  count: Uint16Array.from(pts.map(() => 3)), name: pts.map((_, i) => `p${i}`), cc: pts.map(() => 'DE'), tz: pts.map(() => ''),
});

describe('the WebGL globe frame', () => {
  it('globeRadius: Mercator scale from zoom 4, eased to 75 % at the lowest zooms, latitude clamped at cos .2', () => {
    expect(globeRadius(4, 0)).toBeCloseTo(worldSize(4) / (2 * Math.PI), 9);
    expect(globeRadius(5, 60)).toBeCloseTo(worldSize(5) / Math.PI, 9);
    expect(globeRadius(1.5, 0)).toBeCloseTo(0.75 * worldSize(1.5) / (2 * Math.PI), 9);
    expect(globeRadius(2, 0)).toBeCloseTo((0.75 + 0.25 * 0.104) * worldSize(2) / (2 * Math.PI), 9);
    expect(globeRadius(2, 85)).toBeCloseTo(globeRadius(2, 0) / 0.2, 9);
  });

  it('projectGl places points exactly where the Canvas 2D globe does and hides the far side', () => {
    const g = new Globe(tex, 8, 4, 240, 292); g.setZoom(2, 50);
    const f = { ...glFrame({ lon: 10, lat: 50, z: 2 }, 240, 292), R: g.R };   // lat 50 is a quarter-degree step: no quantisation
    const P = places([[10, 50], [20, 45], [-5, 60], [40, 30], [10, 20]]);
    for (const d of g.project(P, () => true, 10, 50)) {
      const p = projectGl(f, P.lon[d.i], P.lat[d.i])!;
      expect(Math.hypot(p.x - d.x, p.y - d.y)).toBeLessThan(0.01);
      expect(p.z).toBeCloseTo(d.z!, 6);
    }
    expect(projectGl(f, -170, -50)).toBeNull();
  });

  it('unprojectGl inverts projectGl on the visible side and is null in space', () => {
    const f = glFrame({ lon: 170, lat: -30, z: 2.5 }, 240, 292);
    for (const [lon, lat] of [[170, -30], [-175, -20], [150, -60], [175, 10]]) {
      const p = projectGl(f, lon, lat)!, q = unprojectGl(f, p.x, p.y)!;
      expect(wrapLon(q.lon - lon)).toBeCloseTo(0, 6); expect(q.lat).toBeCloseTo(lat, 6);
    }
    expect(unprojectGl(glFrame({ lon: 0, lat: 0, z: 1.4 }, 240, 292), 2, 2)).toBeNull();
  });

  it('flatness runs from 0 at zoom 3.5 to 1 at zoom 4', () => {
    expect(flatness(3.4)).toBe(0); expect(flatness(3.75)).toBeCloseTo(0.5, 9); expect(flatness(4)).toBe(1);
  });

  it('at zoom 3.999 both globes are Web Mercator: the tiles\' screenOf, top edge included', () => {
    const cam = { lon: -30, lat: 50, z: 3.999 }, f = glFrame(cam, 240, 292), g = new Globe(tex, 8, 4, 240, 292);
    const pts: [number, number][] = [[-30, 50], [-35, 55], [-25, 45], [-40, 57.5], [-21, 43]];   // all in view, [-40, 57.5] near the top edge
    g.setZoom(cam.z, cam.lat);
    const d = g.project(places(pts), () => true, cam.lon, cam.lat);
    pts.forEach(([lon, lat], i) => {
      const p = projectGl(f, lon, lat)!, q = screenOf(lon, lat, cam, 240, 292), c = d.find(e => e.i === i)!;
      expect(p.x).toBeCloseTo(q.x, 2); expect(p.y).toBeCloseTo(q.y, 2);
      expect(c.x).toBeCloseTo(q.x, 2); expect(c.y).toBeCloseTo(q.y, 2);
    });
    expect(screenOf(-40, 57.5, cam, 240, 292).y).toBeLessThan(20);
  });

  it('halfway through the flattening the Canvas 2D globe projects as projectGl (z 3.75, lat 50.1, off the ¼° step)', () => {
    const cam = { lon: -28.3, lat: 50.1, z: 3.75 }, g = new Globe(tex, 8, 4, 240, 292);
    g.setZoom(cam.z, cam.lat);
    const f = { ...glFrame(cam, 240, 292), R: g.R };
    const P = places([[-28.3, 50.1], [-35, 55], [-25, 45], [-38, 57], [-20, 44], [-32.5, 47.5]]);
    const d = g.project(P, () => true, cam.lon, cam.lat);
    expect(d.length).toBe(6);
    for (const e of d) {
      const p = projectGl(f, P.lon[e.i], P.lat[e.i])!;
      expect(Math.hypot(p.x - e.x, p.y - e.y)).toBeLessThan(0.01);
      expect(p.z).toBeCloseTo(e.z!, 6);
    }
  });

  it('unprojectGl inverts projectGl exactly at flat 0 and 1, within 2 px in between', () => {
    // flat 0 at z 3.2 and 1 at z 4: exact; z 3.999 is flat 1 − 1.2e-5, which leaves about 1e-6° (0.001 px)
    for (const [z, tol] of [[3.2, 1e-6], [4, 1e-6], [3.999, 1e-5], [3.75, -1]]) {
      const cam = { lon: -28.3, lat: 50.1, z }, f = glFrame(cam, 240, 292);
      for (const [lon, lat] of [[-28.3, 50.1], [-35, 55], [-25, 45], [-38, 56.5], [-20, 44]]) {
        const p = projectGl(f, lon, lat)!, q = unprojectGl(f, p.x, p.y)!;
        if (tol > 0) {
          expect(Math.abs(wrapLon(q.lon - lon)), `z ${z}`).toBeLessThan(tol); expect(Math.abs(q.lat - lat), `z ${z}`).toBeLessThan(tol);
        } else {
          const r = projectGl(f, q.lon, q.lat)!;
          expect(Math.hypot(r.x - p.x, r.y - p.y), `z ${z}: ${lon}, ${lat}`).toBeLessThan(2);
        }
      }
    }
  });

  it('lightViewport widens the viewport by half the largest point on every side', () => {
    expect(lightViewport(480, 584, 64)).toEqual([-32, -32, 544, 648]);
    expect(lightViewport(480, 584, 63)).toEqual([-32, -32, 544, 648]);
  });
});
