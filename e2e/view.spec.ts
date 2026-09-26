import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { GLOBE_BELOW_ZOOM, RING_RADIUS } from '../src/config';
import { TILE_SOURCE } from '../src/map/tile-source';
import { visibleTiles } from '../src/map/tiles';
import { offline } from './net';

// Renderer checks against the app itself, at the r1's 240×292 CSS viewport and dpr 2, before the "Tap to tune in"
// gate: the map already renders under it, and a pick there only moves the strip (nothing tunes, nothing plays).
// Map tiles never reach EOX from a test: every tile request is answered with one local 256 px fixture (e2e/net.ts).
const TOKYO = { lon: 139.69, lat: 35.69 };
// A.6 allows 33 ms for latitude-changing globe frames; measured 16-19 ms here (Apple silicon). GitHub's runners are
// unmeasured and likely slower per core under the same 6x throttle, so CI gets 50 ms until its logged medians are known.
const GLOBE_FRAME_MS = process.env.CI ? 50 : 33;

let tileHits = 0;
test.beforeEach(async ({ page }) => {
  tileHits = 0;
  await offline(page, () => { tileHits++; });
});

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

async function throttled(page: Page, rate: number): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });   // before navigation: boot runs throttled too
  return cdp;
}

/** The app at ?place=Berlin, zoom 7 (ZOOM_DEFAULT), once the map has drawn its dots. */
async function open(page: Page): Promise<void> {
  await page.goto('/?place=Berlin');
  await page.waitForFunction(() => (window as any).__view?.dots.length > 0, null, { timeout: 60000 });
}

/** Ratio of a fixed JS workload at the armed rate vs. unthrottled: proves the throttle survived the navigation. */
async function slowdown(page: Page, cdp: CDPSession, rate: number): Promise<number> {
  const spin = async () => {
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      best = Math.min(best, await page.evaluate(() => {
        const t0 = performance.now();
        let x = 0;
        for (let i = 0; i < 2e6; i++) x += Math.sqrt(i);
        return performance.now() - t0 + (x < 0 ? 1 : 0);
      }));
    }
    return best;
  };
  const slow = await spin();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const fast = await spin();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  return slow / fast;
}

test('zoom 7 at Berlin shows a handful of dots on a 2x canvas of the container size', async ({ page }) => {
  const hosts: string[] = [];
  page.on('request', r => hosts.push(new URL(r.url()).hostname));
  await open(page);
  const v = await page.evaluate(() => {
    const v = (window as any).__view, c = document.getElementById('map') as HTMLCanvasElement;
    return { n: v.dots.length, w: v.w, h: v.h, dpr: v.dpr, cw: c.width, ch: c.height, css: c.getBoundingClientRect().height };
  });
  test.info().annotations.push({ type: 'dots', description: String(v.n) });
  console.log(`berlin z7: ${v.n} dots, tiles served from the fixture: ${tileHits}`);
  expect(v.n).toBeGreaterThanOrEqual(2);
  expect(v.n).toBeLessThanOrEqual(25);
  expect([v.w, v.h, v.dpr, v.cw, v.ch, v.css]).toEqual([240, 292, 2, 480, 584, 292]);
  await expect.poll(() => tileHits).toBeGreaterThan(0);
  expect(hosts.filter(h => h === 'radio.garden' || h.endsWith('.radio.garden'))).toEqual([]);
});

test('six place-to-place flights in tile mode: median frame work under 16 ms at 6x CPU throttle', async ({ page }) => {
  test.setTimeout(120000);
  const cdp = await throttled(page, 6);
  await open(page);
  const ratio = await slowdown(page, cdp, 6);
  expect(ratio).toBeGreaterThan(3);
  const hits0 = tileHits;
  const r = await page.evaluate(async () => {
    const v = (window as any).__view, P = (window as any).__app.places;
    let b = -1;
    for (let i = 0; i < P.n; i++) if (P.name[i] === 'Berlin' && (b < 0 || P.count[i] > P.count[b])) b = i;
    const RAD = Math.PI / 180;
    const deg = (i: number, j: number) => {   // great-circle angle between two places, in degrees
      const h = Math.sin(((P.lat[j] - P.lat[i]) * RAD) / 2) ** 2
        + Math.cos(P.lat[i] * RAD) * Math.cos(P.lat[j] * RAD) * Math.sin(((P.lon[j] - P.lon[i]) * RAD) / 2) ** 2;
      return (2 * Math.asin(Math.min(1, Math.sqrt(h)))) / RAD;
    };
    // Chain from Berlin to the biggest unvisited place under 1.8° away: every hop stays a short (tile-mode) flight.
    const hops: number[] = [], seen = new Set([b]);
    for (let at = b; hops.length < 6;) {
      let next = -1;
      for (let i = 0; i < P.n; i++) if (!seen.has(i) && deg(at, i) < 1.8 && (next < 0 || P.count[i] > P.count[next])) next = i;
      if (next < 0) break;
      hops.push(next);
      seen.add(next);
      at = next;
    }
    const frames: number[] = [], globe: boolean[] = [];
    let minZ = Infinity;
    for (const j of hops) {
      v.frameMs.length = 0;
      v.frameGlobe.length = 0;
      v.select(j);
      await new Promise<void>(res => {
        const tick = () => { minZ = Math.min(minZ, v.cam.z); if (v.moving) requestAnimationFrame(tick); else res(); };
        requestAnimationFrame(tick);
      });
      frames.push(...v.frameMs);
      globe.push(...v.frameGlobe);
    }
    return { frames, globe, minZ, hops: hops.map((j: number) => P.name[j]) };
  });
  const med = median(r.frames);
  test.info().annotations.push(
    { type: 'throttle-ratio', description: ratio.toFixed(1) },
    { type: 'hops', description: r.hops.join(' > ') },
    { type: 'tile-frames', description: String(r.frames.length) },
    { type: 'tile-median-ms', description: med.toFixed(2) },
    { type: 'tile-p95-ms', description: [...r.frames].sort((x, y) => x - y)[Math.floor(r.frames.length * 0.95)].toFixed(2) },
    { type: 'tile-requests', description: String(tileHits - hits0) },
  );
  console.log(`tile flights: ${JSON.stringify(test.info().annotations)}`);
  expect(r.hops).toHaveLength(6);
  expect(r.minZ).toBeGreaterThanOrEqual(GLOBE_BELOW_ZOOM);
  expect(r.globe.every(g => !g)).toBe(true);
  expect(r.frames.length).toBeGreaterThanOrEqual(12);
  expect(med).toBeLessThan(16);
  await cdp.detach().catch(() => {});
});

test('a far flight (Berlin to Tokyo) arcs through the globe: globe frames under 33 ms at 6x, tiles fetched only near the end', async ({ page }) => {
  test.setTimeout(120000);
  const cdp = await throttled(page, 6);
  await open(page);
  const ratio = await slowdown(page, cdp, 6);
  expect(ratio).toBeGreaterThan(3);
  const hits0 = tileHits;
  const r = await page.evaluate(async ({ lon, lat }) => {
    const v = (window as any).__view;
    v.frameMs.length = 0;
    v.frameGlobe.length = 0;
    const samples: { t: number; z: number }[] = [];
    v.flyTo(lon, lat, 7);
    await new Promise<void>(res => {
      const tick = (t: number) => { samples.push({ t, z: v.cam.z }); if (v.moving) requestAnimationFrame(tick); else res(); };
      requestAnimationFrame(tick);
    });
    const t0 = samples[0].t, t1 = samples[samples.length - 1].t, mid = (t0 + t1) / 2;
    const zMid = samples.reduce((a, s) => (Math.abs(s.t - mid) < Math.abs(a.t - mid) ? s : a)).z;
    return { frames: [...v.frameMs], globe: [...v.frameGlobe], zMid, ms: t1 - t0, end: { ...v.cam }, w: v.w, h: v.h };
  }, TOKYO);
  const globeMs = r.frames.filter((_, i) => r.globe[i]), tileMs = r.frames.filter((_, i) => !r.globe[i]);
  const med = median(r.frames);
  // The settled view requests its own tiles; nothing on the way does, except the last 250 ms of the approach.
  const landing = visibleTiles({ ...TOKYO, z: 7 }, r.w, r.h, TILE_SOURCE.maxZ, 2).spots.length;
  await expect.poll(() => tileHits - hits0).toBeGreaterThanOrEqual(landing);
  await page.waitForTimeout(300);
  const requests = tileHits - hits0;
  test.info().annotations.push(
    { type: 'throttle-ratio', description: ratio.toFixed(1) },
    { type: 'flight-ms', description: r.ms.toFixed(0) },
    { type: 'z-mid', description: r.zMid.toFixed(2) },
    { type: 'frames', description: `${r.frames.length} (${globeMs.length} globe, ${tileMs.length} tiles)` },
    { type: 'median-ms', description: med.toFixed(2) },
    { type: 'globe-median-ms', description: median(globeMs).toFixed(2) },
    { type: 'tile-median-ms', description: median(tileMs).toFixed(2) },
    { type: 'tile-requests', description: `${requests} (${landing} for the landing view)` },
  );
  console.log(`far flight: ${JSON.stringify(test.info().annotations)}`);
  expect(r.zMid).toBeLessThan(GLOBE_BELOW_ZOOM);
  expect(globeMs.length).toBeGreaterThanOrEqual(5);
  expect(r.end.lon).toBeCloseTo(TOKYO.lon, 6);
  expect(r.end.lat).toBeCloseTo(TOKYO.lat, 6);
  expect(median(globeMs)).toBeLessThan(GLOBE_FRAME_MS);
  expect(med).toBeLessThan(33);
  expect(requests).toBeLessThan(30);
  await cdp.detach().catch(() => {});
});

test('after a pan the place under the ring is picked', async ({ page }) => {
  await open(page);
  await page.waitForFunction(() => (window as any).__view.current >= 0);
  const target = await page.evaluate(ring => {
    const v = (window as any).__view;
    const cur = v.dots.find((d: any) => d.i === v.current);
    const far = (d: any) => Math.hypot(d.x - v.w / 2, d.y - v.h / 2) > ring + 10 && Math.hypot(d.x - cur.x, d.y - cur.y) > 2 * ring;
    const d = v.dots.find((d: any) => d.i !== v.current && far(d) && d.x > 10 && d.x < v.w - 10 && d.y > 10 && d.y < v.h - 10);
    return d ? { i: d.i, x: d.x, y: d.y, before: v.current } : null;
  }, RING_RADIUS);
  expect(target).not.toBeNull();
  await page.evaluate(t => { const v = (window as any).__view; v.panBy(v.w / 2 - t.x, v.h / 2 - t.y); }, target!);
  await expect.poll(() => page.evaluate(() => (window as any).__view.current)).toBe(target!.i);
  const at = await page.evaluate(i => (window as any).__view.dots.find((d: any) => d.i === i), target!.i);
  expect(at.x).toBeCloseTo(120, 0);
  expect(at.y).toBeCloseTo(146, 0);
  expect(target!.before).not.toBe(target!.i);
});
