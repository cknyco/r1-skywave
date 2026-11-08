import { expect, test, type Page } from '@playwright/test';
import { introZoom } from '../src/app/intro';
import { CATCH_RADIUS, INTRO_DIVE_MS, INTRO_MS, LANDING_PREFETCH, SETTLE_MS, ZOOM_DEFAULT } from '../src/config';
import type { ScreenDot } from '../src/map/lod';
import { pickAtCenter } from '../src/map/pick';
import { TILE_SOURCE } from '../src/map/tile-source';
import { visibleTiles } from '../src/map/tiles';
import { smallPlaces } from './data';
import { fakeStreams, newStations, offline, TILE } from './net';
import { tuneIn } from './ui';

// The start and the back arrow (the user's r1 test, 2026-10-18). The start: right after the gate's tap the whole globe on
// the station's place for INTRO_MS while it tunes, then the dive to the landing zoom; any input meanwhile ends it where
// the map is. The back arrow: About and the lists hold one history entry, so a step back closes them, never the plain map.
// Nothing leaves localhost (e2e/net.ts); streams are faked, so nothing plays.
test.beforeEach(async ({ page }) => {
  await offline(page);
  await fakeStreams(page);
  await newStations(page);
});

const cam = (page: Page) => page.evaluate(() => {
  const v = (window as any).__view;
  return { z: v.cam.z as number, moving: v.moving as boolean };
});
const fire = (page: Page, ev: string) => page.evaluate(e => window.dispatchEvent(new Event(e)), ev);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The app at `query`, booted behind the gate: the zoom the start's globe has there (the r1's 240×292 view). */
async function atGate(page: Page, query: string): Promise<number> {
  await page.goto(`/${query}`);
  await page.waitForFunction(() => (window as any).__app);
  return page.evaluate(() => { const a = (window as any).__app; return a.places.lat[a.place()] as number; })
    .then(lat => introZoom(lat, 240, 292));
}

/** Past the gate, once the start's globe is up. */
async function tapGate(page: Page, z0: number): Promise<void> {
  await page.click('#start');
  await expect.poll(async () => (await cam(page)).z).toBeCloseTo(z0, 9);
}

test('every start shows the whole globe on the place while it tunes, then dives to the landing zoom (ZOOM_DEFAULT)', async ({ page }) => {
  const z0 = await atGate(page, '?place=Berlin');
  expect(z0).toBeLessThan(1.4);   // Berlin's whole globe is farther out than the user's own farthest zoom
  expect((await cam(page)).z).toBe(ZOOM_DEFAULT);   // behind the gate the landing view loads its tiles
  await page.click('#start');
  // Every frame from the tap to the landing: the zoom, whether a flight runs, the strip on air, the globe renderer.
  const track = await page.evaluate(land => new Promise<{ t: number; z: number; moving: boolean; live: boolean; globe: boolean }[]>(resolve => {
    const v = (window as any).__view, out: { t: number; z: number; moving: boolean; live: boolean; globe: boolean }[] = [];
    const t0 = performance.now();
    const tick = () => {
      const t = performance.now() - t0;
      out.push({ t, z: v.cam.z, moving: v.moving, live: document.querySelector('#strip .name')!.classList.contains('live'),
        globe: v.frameGlobe[v.frameGlobe.length - 1] });
      if (t > 8000 || (t > 100 && v.cam.z === land && !v.moving)) resolve(out); else requestAnimationFrame(tick);
    };
    tick();
  }), ZOOM_DEFAULT);
  // Checks on time, not on frame counts: CI draws the globe in software, at a fraction of 60 frames a second. Auto mode
  // picks it: the Canvas 2D globe, or, since GL_FRAME_LIMIT_MS is 25 (2026-11-08), WebGL in SwiftShader where the probe
  // passes there (18-23 ms with SwiftShader on Apple silicon). `globe` is true for a frame of either.
  const held = track.filter(s => s.t < INTRO_MS - 300);
  expect(held.length).toBeGreaterThan(3);
  for (const s of held) {
    expect(s.z).toBeCloseTo(z0, 9);   // the whole globe from the first frame on, held still
    expect(s.moving).toBe(false);
  }
  expect(held[held.length - 1].globe).toBe(true);
  expect(track.some(s => s.live && Math.abs(s.z - z0) < 1e-9)).toBe(true);   // the station tunes meanwhile: on air before the dive
  const last = track[track.length - 1];
  expect(last.z).toBe(ZOOM_DEFAULT);
  expect(last.moving).toBe(false);
  for (let k = 1; k < track.length; k++) expect(track[k].z).toBeGreaterThanOrEqual(track[k - 1].z - 1e-9);   // a dive, no dip
  const start = track.find(s => s.z > z0 + 1e-6)!, end = track.find(s => s.z === ZOOM_DEFAULT)!;
  expect(start.t).toBeGreaterThan(INTRO_MS - 300);
  expect(end.t - start.t).toBeGreaterThan(INTRO_DIVE_MS - 300);
  expect(end.t - start.t).toBeLessThan(INTRO_DIVE_MS + 500);
  // Flown, not cut: from half a zoom level in to half a level short of the landing takes about 810 ms of the 1500 at
  // Berlin's dive to 5 (about 940 to 7; a plain short hop: under 250 ms), and no single frame jumps 2.5 levels (the cut
  // itself is caught by the two time checks; one CI frame of up to 90 ms moves the dive at most about 0.6 levels).
  const t = (above: number) => track.find(s => s.z > above)!.t;
  expect(t(ZOOM_DEFAULT - 0.5) - t(z0 + 0.5)).toBeGreaterThan(700);
  for (let k = 1; k < track.length; k++) expect(track[k].z - track[k - 1].z).toBeLessThan(2.5);
  await expect(page.locator('#strip .where')).toHaveText(/^Berlin ·/);
  await expect(page.locator('#strip .name')).toHaveClass(/live/);
});

test('?z=7 sets the landing zoom: behind the gate and after the dive', async ({ page }) => {
  expect(ZOOM_DEFAULT).not.toBe(7);   // 7, the landing before the user's choice of 5, is still there for comparisons
  const z0 = await atGate(page, '?place=Berlin&z=7');
  expect((await cam(page)).z).toBe(7);
  await tapGate(page, z0);
  await expect.poll(() => cam(page), { timeout: INTRO_MS + INTRO_DIVE_MS + 5000 }).toEqual({ z: 7, moving: false });
});

// Ruling 46 at the landing zoom: behind the gate the boot camera stands at the landing, and its flight requests the
// landing view (at most LANDING_PREFETCH tiles). At ZOOM_DEFAULT that view must fit the cap and be loaded before the tap.
for (const name of ['Berlin', 'Tokyo']) {
  test(`behind the gate the landing view at ${name} (ZOOM_DEFAULT) is requested whole, within LANDING_PREFETCH, and loads`, async ({ page }) => {
    const tiles = new Set<string>();
    await page.route('https://tiles.maps.eox.at/**', r => { tiles.add(r.request().url()); return r.fulfill({ path: TILE, contentType: 'image/jpeg' }); });
    await atGate(page, `?place=${name}`);
    await page.waitForFunction(() => !(window as any).__view.moving);
    const at = await page.evaluate(() => { const v = (window as any).__view; return { cam: { ...v.cam }, w: v.w, h: v.h, dpr: v.dpr }; });
    expect(at.cam.z).toBe(ZOOM_DEFAULT);
    const view = visibleTiles(at.cam, at.w, at.h, TILE_SOURCE.maxZ, at.dpr);
    test.info().annotations.push({ type: 'landing view', description: `${view.spots.length} tiles at tile zoom ${view.z}` });
    expect(view.spots.length).toBeLessThanOrEqual(LANDING_PREFETCH);   // the flight's own prefetch covers all of it
    const want = view.spots.map(t => TILE_SOURCE.url(view.z, t.x, t.y));
    await expect.poll(() => want.filter(u => !tiles.has(u))).toEqual([]);
    await page.waitForFunction(urls => {
      const c = (window as any).__view.tiles.cache as Map<string, HTMLImageElement>;
      return urls.every(u => [...c.values()].some(i => i.src === u && i.complete && i.naturalWidth > 0));
    }, want);
    await expect(page.locator('#gate')).toBeVisible();   // all of it while the gate still shows
  });
}

// The landing zoom at a one-station place (e2e/data.ts), reached through "Tap to resume" (Ruling 38) with the start on:
// the dive lands at ZOOM_DEFAULT, where the ring would catch the big city whose dot covers the place, and the place and
// its station stay, at rest past the settle.
test('"Tap to resume" at a one-station place inside a big city\'s dot: the dive lands at ZOOM_DEFAULT and keeps the place and station', async ({ page, request }) => {
  const s = (await smallPlaces(request)).out[0];
  expect(s).toBeDefined();
  await page.goto('/?intro=0');   // any page of the app, to reach its storage
  await page.evaluate(s => localStorage.setItem('last', JSON.stringify({ place: s.place, name: s.placeName, cc: s.cc, id: s.id })), s);
  await page.goto('/');
  await expect(page.locator('#start')).toContainText('Tap to resume');
  await expect(page.locator('#start')).toContainText(s.station);
  const z0 = await page.evaluate(() => { const a = (window as any).__app; return a.places.lat[a.place()] as number; }).then(lat => introZoom(lat, 240, 292));
  await tapGate(page, z0);   // the whole globe first
  await expect.poll(() => cam(page), { timeout: INTRO_MS + INTRO_DIVE_MS + 5000 }).toEqual({ z: ZOOM_DEFAULT, moving: false });
  await expect(page.locator('#strip .where')).toHaveText(new RegExp(`^${esc(s.placeName)} ·`));
  await expect(page.locator('#strip .name')).toHaveText(s.station);
  await expect(page.locator('#strip .name')).toHaveClass(/live/);
  await page.waitForTimeout(SETTLE_MS + 300);   // at rest past the settle: no pick, no tune may replace them
  const v = await page.evaluate(() => {
    const v = (window as any).__view, a = (window as any).__app;
    return { z: v.cam.z as number, current: v.current as number, place: a.place() as number, dots: v.dots as ScreenDot[], w: v.w as number, h: v.h as number };
  });
  expect({ z: v.z, current: v.current, place: v.place }).toEqual({ z: ZOOM_DEFAULT, current: s.place, place: s.place });
  await expect(page.locator('#strip .name')).toHaveText(s.station);
  expect(pickAtCenter(v.dots, v.w / 2, v.h / 2, CATCH_RADIUS, v.current)).not.toBe(s.place);   // not vacuous: the ring's own pick is the city
});

test('a wheel event during the start ends it where it is: the volume changes, the map stays on the whole globe', async ({ page }) => {
  const z0 = await atGate(page, '?place=Berlin');
  await tapGate(page, z0);
  await fire(page, 'scrollDown');   // the wheel is the volume (Ruling 49)
  await expect(page.locator('#vol .pct')).toHaveText('95 %');
  await page.waitForTimeout(INTRO_MS + INTRO_DIVE_MS + 500);
  expect(await cam(page)).toEqual({ z: z0, moving: false });
});

test('"−" during the start ends it and never zooms in from the whole globe; a drag ends it too', async ({ page }) => {
  const z0 = await atGate(page, '?place=Berlin');
  await tapGate(page, z0);
  await page.click('#zout');
  await page.waitForTimeout(INTRO_MS + INTRO_DIVE_MS + 500);
  expect(await cam(page)).toEqual({ z: z0, moving: false });

  const z1 = await atGate(page, '?place=Tokyo');
  await tapGate(page, z1);
  await page.mouse.move(120, 146);
  await page.mouse.down();
  await page.mouse.move(150, 160, { steps: 3 });
  await page.mouse.up();   // a caught place may glide into the ring, at this zoom
  await page.waitForTimeout(INTRO_MS + INTRO_DIVE_MS + 500);
  const c = await cam(page);
  expect(c.z).toBeCloseTo(z1, 9);
  expect(c.moving).toBe(false);
});

test('the back arrow closes About and keeps the app; About closed by a tap leaves no entry behind', async ({ page }) => {
  await tuneIn(page);
  const url = page.url();
  const n = await page.evaluate(() => { (window as any).__kept = true; return history.length; });
  const about = page.locator('#about');

  await page.click('#binfo');
  await expect(about).toBeVisible();
  expect(await page.evaluate(() => history.length)).toBe(n + 1);
  await page.goBack();
  await expect(about).toBeHidden();
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => (window as any).__kept)).toBe(true);   // the same page: no reload, no other page
  await expect(page.locator('#strip')).toBeVisible();

  for (let k = 0; k < 3; k++) {   // opened and closed by a tap: the history never grows
    await page.click('#binfo');
    await expect(about).toBeVisible();
    await page.click('#about');
    await expect(about).toBeHidden();
    await expect.poll(() => page.evaluate(() => history.state)).toBeNull();   // the app's own step back has landed
  }
  expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(n + 1);
  await page.goBack();   // from the plain map: not ours, the page is left
  expect(page.url()).toBe('about:blank');
});

test('the back arrow closes the station list, ★ and ♥, one entry each, also after switching lists', async ({ page }) => {
  await tuneIn(page);
  const url = page.url();
  const list = page.locator('#list');
  for (const sel of ['#strip', '#bnew', '#bfav']) {
    await page.click(sel);
    await expect(list).toBeVisible();
    await page.goBack();
    await expect(list).toBeHidden();
    expect(page.url()).toBe(url);
  }

  await page.click('#strip');
  await expect(list).toBeVisible();
  await page.evaluate(() => { for (let k = 0; k < 200; k++) window.dispatchEvent(new Event('scrollUp')); });   // to "★ New stations worldwide"
  await fire(page, 'sideClick');
  await expect(list.locator('.title')).toContainText('New');
  await page.goBack();
  await expect(list).toBeHidden();
  expect(page.url()).toBe(url);
  await page.goBack();   // one entry for the whole visit: the next step back leaves the page
  expect(page.url()).toBe('about:blank');
});

test('from the plain map the back arrow is not intercepted: the page is left', async ({ page }) => {
  await tuneIn(page);
  await page.goBack();
  expect(page.url()).toBe('about:blank');
});
