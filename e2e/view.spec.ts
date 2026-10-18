import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { CATCH_RADIUS, GLOBE_BELOW_ZOOM, RING_RADIUS } from '../src/config';
import { TILE_SOURCE } from '../src/map/tile-source';
import { visibleTiles } from '../src/map/tiles';
import { fakeStreams, offline } from './net';
import { look, onePlace } from './pixels';
import { tuneIn } from './ui';

// Renderer checks against the app itself, at the r1's 240×292 CSS viewport and dpr 2, mostly before the "Tap to tune in"
// gate: the map already renders under it, and a pick there only moves the strip (nothing tunes, nothing plays). The two
// finger tests go through the gate, since the drag is bound only then.
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

const settled = (page: Page) => page.waitForFunction(() => !(window as any).__view.moving);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };

async function throttled(page: Page, rate: number): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });   // before navigation: boot runs throttled too
  return cdp;
}

/** The app at `query` (?place=Berlin), zoom 7 (ZOOM_DEFAULT), once the map has drawn its dots. */
async function open(page: Page, query = '?place=Berlin'): Promise<void> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => (window as any).__view?.dots.length > 0, null, { timeout: 60000 });
}

/**
 * A dot other than current, at least 2·CATCH_RADIUS + 20 px from the centre (so the current place ends far outside the
 * catch), no other dot within CATCH_RADIUS + 25 px of it (so it stays the only catchable dot 20 px off-centre), 10 px
 * inside the edges; and the whole-pixel pan (dx, dy) that leaves it (16, 12) px, 20 px, off the centre. A finger that
 * starts at the centre and pans by (dx, dy) ends inside the screen.
 */
async function offCentre(page: Page): Promise<{ i: number; dx: number; dy: number }> {
  const t = await page.evaluate(c => {
    const v = (window as any).__view, cx = v.w / 2, cy = v.h / 2;
    const d = v.dots.find((d: any) => d.i !== v.current && Math.hypot(d.x - cx, d.y - cy) >= 2 * c + 20
      && v.dots.every((o: any) => o === d || Math.hypot(o.x - d.x, o.y - d.y) > c + 25)
      && d.x > 10 && d.x < v.w - 10 && d.y > 10 && d.y < v.h - 10
      && 2 * cx - d.x + 16 > 0 && 2 * cx - d.x + 16 < v.w && 2 * cy - d.y + 12 > 0 && 2 * cy - d.y + 12 < v.h);
    return d ? { i: d.i, dx: Math.round(cx - d.x) + 16, dy: Math.round(cy - d.y) + 12 } : null;
  }, CATCH_RADIUS);
  expect(t).not.toBeNull();
  return t!;
}

/** How far place i's dot is from the ring's centre (120, 146), as the last frame drew it. */
const offset = (page: Page, i: number) => page.evaluate(i => {
  const d = (window as any).__view.dots.find((d: any) => d.i === i);
  return Math.hypot(d.x - 120, d.y - 146);
}, i);

/**
 * Place i's dot once the next animation frame has been drawn. Read a frame later: Chrome dispatches a pointermove at the
 * start of a frame, so a redraw it asks for (wake) runs in that frame after a callback registered before the move.
 */
const dotAfterFrame = (page: Page, i: number) => page.evaluate(i => new Promise<{ x: number; y: number }>(res => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const d = (window as any).__view.dots.find((d: any) => d.i === i);
    res({ x: d.x, y: d.y });
  }));
}), i);

/** Waits until the view has drawn n more frames. */
const frames = (page: Page, n: number) => page.evaluate(n => new Promise<void>(res => {
  const v = (window as any).__view, f = v.onFrame;
  v.onFrame = (g: boolean) => { f(g); if (--n === 0) { v.onFrame = f; res(); } };
  v.wake();
}), n);

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
  await open(page, '?place=Berlin&globe=2d');   // the Canvas 2D globe: the fallback, the r1's worst case
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

// Every place in view is a light (Task 3): the densest views are Central Europe in the tile view at zoom 4, on the
// Canvas 2D globe from FLAT_FROM, where its faint lights are no longer merged, and on the Canvas 2D globe at z 1.6, where
// they merge per LIGHT_MERGE cell (1 px, the user's call) but the most places are in view (about 1,500 sprites; about 13 ms
// at 6x on Apple silicon). A drag holds the map (P9): no glide starts between two frames, as with a finger. A failing bound is
// never tuned: report the medians. With 1 px cells the plan's merge extension barely helps (it saves about 7 % of the
// sprites; P12's remedy): the lever is a larger merge cell, at a look cost (2 px draws a dot lattice over dense Europe, 12 px
// leaves it at 16 % of look A), a user call.
for (const [name, query, z, limit] of [
  ['tiles', '', 4, process.env.CI ? 25 : 16],              // zoom 4: the densest tile view, every faint light on its own
  ['Canvas 2D globe', '&globe=2d', 3.6, GLOBE_FRAME_MS],   // above FLAT_FROM: unmerged on the fallback too
  ['Canvas 2D globe', '&globe=2d', 1.6, GLOBE_FRAME_MS],   // below FLAT_FROM: merged per 1 px, the most places in view
] as const) {
  test(`over Central Europe the ${name} at z ${z} pans with every place lit: median frame under ${limit} ms at 6x`, async ({ page }) => {
    test.setTimeout(120000);
    const cdp = await throttled(page, 6);
    await page.goto(`/?place=Berlin${query}`);
    await page.waitForFunction(() => (window as any).__view?.dots.length > 0, null, { timeout: 60000 });
    const ratio = await slowdown(page, cdp, 6);
    expect(ratio).toBeGreaterThan(3);
    const r = await page.evaluate(async z => {
      const v = (window as any).__view;
      const frame = () => new Promise(res => requestAnimationFrame(res));
      v.flight = null;
      v.cam = { lon: 10, lat: 50, z };
      v.hold(true);
      v.wake();
      await frame();
      await frame();
      v.frameMs.length = 0;
      v.frameGlobe.length = 0;
      for (let k = 0; k < 40; k++) {
        await frame();
        v.panBy(3, 1);
      }
      await frame();
      v.hold(false);
      return { frames: [...v.frameMs] as number[], globe: [...v.frameGlobe] as boolean[], lights: (v.lights?.n ?? 0) as number };
    }, z);
    const med = median(r.frames);
    test.info().annotations.push(
      { type: 'throttle-ratio', description: ratio.toFixed(1) },
      { type: 'frames', description: String(r.frames.length) },
      { type: 'lights', description: String(r.lights) },
      { type: 'median-ms', description: med.toFixed(2) },
      { type: 'p95-ms', description: [...r.frames].sort((a, b) => a - b)[Math.floor(r.frames.length * 0.95)].toFixed(2) },
    );
    console.log(`Central Europe, ${name} at z ${z}: ${JSON.stringify(test.info().annotations)}`);
    expect(r.frames.length).toBeGreaterThanOrEqual(35);
    expect(r.globe.every(g => g === (name !== 'tiles'))).toBe(true);
    expect(med).toBeLessThan(limit);
    await cdp.detach().catch(() => {});
  });
}

// Below zoom 4 the globe is eased smaller than the Mercator scale (globeEase), so a drag of 40 px must turn it further:
// without that it would move the place about 36 px. At R ≈ 297 px on the equator the sphere's own curvature costs
// 0.15 px and nothing drifts vertically; 40 px keeps the place outside the catch, so no glide starts.
test('on the eased globe a drag stays under the finger', async ({ page }) => {
  await onePlace(page, 10, 0);
  await page.goto('/?globe=2d');
  await page.waitForFunction(() => (window as any).__view?.current === 0);
  await look(page, { lon: 10, lat: 0, z: 3 });
  await page.evaluate(() => (window as any).__view.panBy(40, 0));
  const d = await dotAfterFrame(page, 0);
  expect(Math.abs(d.x - 160)).toBeLessThan(0.5);
  expect(Math.abs(d.y - 146)).toBeLessThan(0.5);
});

// Deferred T2-M2 (final review): a finger put down on the map ends a glide or a zoom at once, but not the flight of a
// wheel or voice selection (select), which ends only on the first move of that finger.
test('a finger put down during a selection\'s flight does not end it: the flight lands on the place', async ({ page }) => {
  await open(page);
  await settled(page);
  const r = await page.evaluate(async () => {
    const v = (window as any).__view, frame = () => new Promise(res => requestAnimationFrame(res));
    let i = 0;   // a place at least 20° away, so the flight takes a while
    while (i < v.places.n && Math.abs(v.places.lon[i] - v.cam.lon) < 20) i++;
    v.select(i);
    await frame();
    await frame();
    v.hold(true);   // the finger touches the map mid-flight and stays still
    const moving = v.moving;
    while (v.moving) await frame();
    v.hold(false);
    return { moving, cam: { ...v.cam }, lon: v.places.lon[i], lat: v.places.lat[i], current: v.current, i };
  });
  expect(r.moving).toBe(true);
  expect(r.cam.lon).toBeCloseTo(r.lon, 4);
  expect(r.cam.lat).toBeCloseTo(r.lat, 4);
  expect(r.current).toBe(r.i);
});

test('the ring is 10 px; a dot left 20 px off-centre is caught when the map rests and glides into the ring', async ({ page }) => {
  await open(page);
  await settled(page);
  const ring = await page.locator('#ring').boundingBox();
  expect(ring).toEqual({ x: 110, y: 136, width: 2 * RING_RADIUS, height: 2 * RING_RADIUS });
  const t = await offCentre(page);
  await page.evaluate(t => (window as any).__view.panBy(t.dx, t.dy), t);
  await expect.poll(() => page.evaluate(() => (window as any).__view.current)).toBe(t.i);
  await settled(page);
  expect(await offset(page, t.i)).toBeLessThan(0.5);
});

// The drag is bound only in start(), so these two go through the gate (streams faked: nothing plays) and drag with the
// mouse: pointerdown on the map holds it, pointerup lets it go.
test('a finger held still on the map never glides; letting go does', async ({ page }) => {
  await fakeStreams(page);
  await tuneIn(page);
  await page.waitForFunction(() => (window as any).__view?.dots.length > 0);
  await settled(page);
  const t = await offCentre(page);
  await page.mouse.move(120, 146);
  await page.mouse.down();
  await page.mouse.move(120 + t.dx, 146 + t.dy);
  await page.waitForTimeout(900);
  const held = await page.evaluate(() => { const v = (window as any).__view; return { moving: v.moving, current: v.current }; });
  expect(held.moving).toBe(false);
  expect(Math.abs(await offset(page, t.i) - 20)).toBeLessThanOrEqual(1);
  expect(held.current).toBe(t.i);   // the pick still follows the finger (and the strip with it)
  await page.mouse.up();
  await expect.poll(() => offset(page, t.i)).toBeLessThan(0.5);
});

test('a drag that starts during the glide takes over at once', async ({ page }) => {
  await fakeStreams(page);
  await tuneIn(page);
  await page.waitForFunction(() => (window as any).__view?.dots.length > 0);
  await settled(page);
  const t = await offCentre(page);
  await page.evaluate(t => (window as any).__view.panBy(t.dx, t.dy), t);
  await page.waitForFunction(() => (window as any).__view.moving);   // the glide runs
  await page.mouse.move(120, 146);
  await page.mouse.down();
  expect(await page.evaluate(() => (window as any).__view.moving)).toBe(false);
  const before = await dotAfterFrame(page, t.i);
  expect(Math.hypot(before.x - 120, before.y - 146)).toBeGreaterThan(1);   // the glide was cut short, not over
  await page.mouse.move(150, 146, { steps: 1 });
  const after = await dotAfterFrame(page, t.i);
  expect(Math.abs(Math.hypot(after.x - before.x, after.y - before.y) - 30)).toBeLessThanOrEqual(1);
});

test('a tap on the map stops the glide; letting go glides on into the ring', async ({ page }) => {
  await fakeStreams(page);
  await tuneIn(page);
  await page.waitForFunction(() => (window as any).__view?.dots.length > 0);
  await settled(page);
  const t = await offCentre(page);
  await page.evaluate(t => (window as any).__view.panBy(t.dx, t.dy), t);
  await page.waitForFunction(() => (window as any).__view.moving);   // the glide runs
  await page.mouse.move(120, 146);
  await page.mouse.down();
  expect(await page.evaluate(() => (window as any).__view.moving)).toBe(false);
  expect(await offset(page, t.i)).toBeGreaterThan(1);   // cut short
  await page.mouse.up();
  await expect.poll(() => offset(page, t.i)).toBeLessThan(0.5);
});

// At zoom 3 around latitude 30 a 20 px catch is about 3° of the globe, beyond planFlight's 2° short hop: a plain flyTo
// would take 1.2 s there (and at zoom ~4 near the equator dip below the tile/globe hand-over and back).
test('a glide is one short 500 ms flight at any zoom, on the globe at zoom 3 too', async ({ page }) => {
  await open(page);
  await settled(page);
  await page.evaluate(() => { (window as any).__view.cam = { lon: 31.2, lat: 30, z: 3 }; });   // Cairo; Berlin's selection is still sticky: no pick
  await frames(page, 1);
  const t = await offCentre(page);
  await page.evaluate(t => (window as any).__view.panBy(t.dx, t.dy), t);
  await page.waitForFunction(() => (window as any).__view.moving);   // the glide runs
  const glide = await page.evaluate(() => {
    const v = (window as any).__view, f = v.flight, RAD = Math.PI / 180;
    const hop = Math.acos(Math.min(1, Math.sin(f.from.lat * RAD) * Math.sin(f.to.lat * RAD)
      + Math.cos(f.from.lat * RAD) * Math.cos(f.to.lat * RAD) * Math.cos((f.to.lon - f.from.lon) * RAD))) / RAD;
    return { current: v.current, long: hop > 2, dur: f.dur, peakZ: f.peakZ, z: v.cam.z };
  });
  expect(glide).toEqual({ current: t.i, long: true, dur: 500, peakZ: 3, z: 3 });
});

// C1: the map draws the current place alone, so at two places a few px apart (Amsterdam and Hilversum at zoom 4,
// Mannheim and Ludwigshafen at zoom 5) the other one absorbs their neighbours and wins the pick; were every rest to
// glide, the map would fly back and forth between them for ever. The pick on landing may still move the strip to the
// other one (the pick's own rule), but nothing flies again and the strip then stays.
test('two places a few px apart: the map rests after one glide', async ({ page }) => {
  await open(page);
  await settled(page);
  for (const [name, z] of [['Amsterdam', 4], ['Mannheim', 5]] as const) {
    await page.evaluate(([name, z]) => {
      const v = (window as any).__view, p = v.places, i = p.name.indexOf(name);
      v.cam = { lon: p.lon[i], lat: p.lat[i], z };
      v.panBy(3, 2);   // ends the sticky selection: from here the map picks and glides by itself
    }, [name, z] as const);
    await frames(page, 2);
    await page.waitForFunction(() => !(window as any).__view.moving, null, { timeout: 1500 });
    const rest = await page.evaluate(() => new Promise<{ flew: boolean; changed: boolean }>(res => {
      const v = (window as any).__view, f = v.onFrame, at = v.current;
      let flew = false;
      v.onFrame = (g: boolean) => { f(g); flew ||= v.moving; };
      setTimeout(() => { v.onFrame = f; res({ flew: flew || v.moving, changed: v.current !== at }); }, 1000);
    }));
    expect(rest, name).toEqual({ flew: false, changed: false });   // for a second no frame is drawn mid-flight, the strip stays
  }
});

// The finding's user path: near Mannheim at zoom 7 the map glides onto Ludwigshafen; zoomed out to 5 there, Mannheim
// absorbs their neighbours and is caught. A zoom ends the one-glide rest, so Mannheim glides into the ring.
test('after a glide, a zoom lets the place it catches glide in', async ({ page }) => {
  await open(page);
  await settled(page);
  const on = (name: string) => page.evaluate(name => {
    const v = (window as any).__view, p = v.places, i = p.name.indexOf(name);
    return Math.abs(v.cam.lon - p.lon[i]) < 1e-6 && Math.abs(v.cam.lat - p.lat[i]) < 1e-6;
  }, name);
  await page.evaluate(() => {
    const v = (window as any).__view, p = v.places, i = p.name.indexOf('Mannheim');
    v.cam = { lon: p.lon[i] + 0.01, lat: p.lat[i], z: 7 };
    v.panBy(3, 2);
  });
  await frames(page, 2);
  await settled(page);
  expect(await on('Ludwigshafen am Rhein')).toBe(true);
  await page.evaluate(() => (window as any).__view.zoomBy(-2));
  await expect.poll(() => on('Mannheim'), { timeout: 3000 }).toBe(true);
  await settled(page);
  expect(await page.evaluate(() => (window as any).__view.cam.z)).toBe(5);
});

// Ruling 46: a tile that has not loaded shows the globe's imagery (reprojected), never the black ground.
test('with every tile failing, the tile view still shows the imagery under the dots (never black)', async ({ page }) => {
  await page.route('https://tiles.maps.eox.at/**', r => r.abort());   // overrides the fixture route of beforeEach
  await open(page);
  await settled(page);
  // Mean brightness of the canvas with the base, then with it switched off: the base must lift it clearly.
  const mean = () => page.evaluate(() => new Promise<number>(res => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const c = document.getElementById('map') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      res(s / (d.length / 4));
    }));
  }));
  const withBase = await mean();
  await page.evaluate(() => { const v = (window as any).__view; v.tiles.base = null; v.wake(); });
  const without = await mean();
  console.log(`tiles failing: mean rgb sum ${withBase.toFixed(1)} with the base, ${without.toFixed(1)} without`);
  expect(withBase).toBeGreaterThan(without + 15);
});

test('a flight requests its landing tiles when it starts, not only near its end (Ruling 46)', async ({ page }) => {
  await page.addInitScript(() => {   // every tile URL the page sets, in order
    const w = window as any;
    w.__tileSrcs = [];
    const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      get(this: HTMLImageElement) { return d.get!.call(this); },
      set(this: HTMLImageElement, v: string) { if (v.includes('tiles.maps.eox.at')) w.__tileSrcs.push(v); d.set!.call(this, v); },
    });
  });
  await open(page);
  await settled(page);
  const r = await page.evaluate(({ lon, lat }) => {
    const w = window as any, v = w.__view;
    const before = w.__tileSrcs.length;
    v.flyTo(lon, lat, 7);
    return { sync: w.__tileSrcs.slice(before) as string[], w: v.w, h: v.h };   // set within flyTo itself
  }, TOKYO);
  const want = visibleTiles({ ...TOKYO, z: 7 }, r.w, r.h, TILE_SOURCE.maxZ, 2);
  expect(want.spots.length).toBeLessThanOrEqual(16);
  expect(r.sync.sort()).toEqual(want.spots.map(t => TILE_SOURCE.url(want.z, t.x, t.y)).sort());
});

test('M3 minor: the map follows a late change of the WebView size', async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 282 });
  await open(page);
  const size = () => page.evaluate(() => {
    const v = (window as any).__view, c = document.getElementById('map') as HTMLCanvasElement;
    return [v.w, v.h, c.width, c.height, document.getElementById('app')!.clientHeight];
  });
  expect(await size()).toEqual([240, 282, 480, 564, 282]);
  await page.setViewportSize({ width: 240, height: 292 });
  await expect.poll(size).toEqual([240, 292, 480, 584, 292]);
  const ring = await page.evaluate(() => {
    const r = document.getElementById('ring')!.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  expect(ring).toEqual({ x: 120, y: 146 });   // the ring stays on the map's centre
});
