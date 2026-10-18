import { expect, test, type Page } from '@playwright/test';
import { globeRadius } from '../src/geo/mercator';
import { RAD } from '../src/geo/sphere';
import { glFrame, projectGl, type GlFrame } from '../src/map/gl/frame';
import { fakeStreams, offline } from './net';
import { at, bare, count, gold, gridTexture, here, inDisc, lit, look, mean, needWebGl, onePlace, shot, white, type Rect } from './pixels';
import { tuneIn } from './ui';

// The WebGL globe (look A), forced with ?globe=gl: its own file, globe-gl.js, drawn on #globe over the map below zoom 4.
// Positions come from the app's own projection (projectGl), so each check also says the shader and the app agree.
// Without ?globe the app chooses (Task 5): WebGL where a frame-time probe finds it fast enough, else the Canvas 2D globe,
// with the choice and its reason as the first line of About's log.

test.beforeEach(async ({ page }) => { await offline(page); });

const VIEW = { x: 0, y: 0, w: 240, h: 292 };

/** The app at `query` once the WebGL globe has loaded, the map alone on screen. */
async function withGl(page: Page, query: string): Promise<void> {
  await needWebGl(page);
  await page.goto(`/${query}`);
  await page.waitForFunction(() => (window as any).__view?.gl);
  await bare(page);
}

/** The bounding box, in CSS px, of the region lon0…lon1, lat0…lat1 as projectGl places it (sampled every degree). */
function span(f: GlFrame, lon0: number, lon1: number, lat0: number, lat1: number): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let lon = lon0; lon <= lon1; lon++) {
    for (let lat = lat0; lat <= lat1; lat++) {
      const p = projectGl(f, lon, lat);
      if (!p) continue;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const frames = (page: Page) => page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))));

test('?globe=gl draws look A at z 1.6: starry dark space, blue-white rim, blue disc, golden Europe, nothing white on the disc', async ({ page }) => {
  await withGl(page, '?place=Berlin&globe=gl');
  const cam = { lon: 10, lat: 30, z: 1.6 };
  await look(page, cam);
  expect(await page.locator('#globe').isVisible()).toBe(true);
  const img = await shot(page), R = await page.evaluate(() => (window as any).__view.gl.R);
  const sky = mean(img, { x: 0, y: 0, w: 12, h: 12 });
  expect(Math.max(...sky)).toBeLessThan(30);
  // 2 px outside the limb: look A's rim (on the side away from the light it is dimmest, about B 114, R 46)
  for (const x of [120 - R - 2, 120 + R + 2]) {
    const p = at(img, x, 146);
    expect(p[2], `rim at x ${x.toFixed(1)}`).toBeGreaterThan(90);
    expect(p[2], `rim at x ${x.toFixed(1)}`).toBeGreaterThan(p[0] + 40);
  }
  const f = glFrame(cam, 240, 292), sea = projectGl(f, -20, -10)!;   // the South Atlantic
  const m = mean(img, { x: sea.x - 15, y: sea.y - 15, w: 30, h: 30 });
  expect(m[2], 'sea: blue over red').toBeGreaterThan(m[0]);
  expect(m[2], 'sea: blue over green').toBeGreaterThan(m[1]);
  const europe = span(f, -10, 30, 35, 60), n = count(img, europe, gold);
  test.info().annotations.push({ type: 'z 1.6', description: `R ${R.toFixed(1)}, gold px in Europe ${n}` });
  expect(inDisc(img, R - 2, white), 'white on the disc').toBe(0);
  for (const z of [2.6, 3.6]) {
    await look(page, { lon: 10, lat: 48, z });
    expect(count(await shot(page), VIEW, white), `z ${z}: white in view`).toBe(0);
  }
  // Measured 671 (Task 6, Apple silicon): the faint lights, capped within LIGHT_DOT px, now glow golden where they crowd;
  // the bound is that less 25 %.
  expect(n, 'golden Europe at z 1.6').toBeGreaterThan(503);
});

// Look A's spike in the same Europe box with the same `lit`: look-a-far.png (its "whole globe" view: zoom 1.5, lon 10,
// lat 30, 480×584 at dpr 2; .superpowers/, not in the repo) has 2,922 lit px (1,530 gold, 50 white). Both globes must
// light at least 70 % of that, with nothing white.
const LOOK_A_LIT = 2922;
for (const mode of ['gl', '2d'] as const) {
  test(`?globe=${mode} at z 1.6: Europe a golden cluster as in look A (lit ≥ 70 % of its lit px), nothing white`, async ({ page }) => {
    if (mode === 'gl') await needWebGl(page);
    await page.goto(`/?place=Berlin&globe=${mode}`);
    await page.waitForFunction(m => (window as any).__view?.current >= 0 && (m === '2d' || (window as any).__view.gl), mode);
    await bare(page);
    const cam = { lon: 10, lat: 30, z: 1.6 };
    await look(page, cam);
    const img = await shot(page, `${mode} z 1.6`), europe = span(glFrame(cam, 240, 292), -10, 30, 35, 60);
    const n = count(img, europe, lit);
    test.info().annotations.push({ type: 'lit px in Europe', description: `${n} (${Math.round((100 * n) / LOOK_A_LIT)} % of look A's), gold ${count(img, europe, gold)}` });
    expect(n).toBeGreaterThanOrEqual(0.7 * LOOK_A_LIT);
    expect(count(img, VIEW, white)).toBe(0);
  });
}

test('?globe=gl: grid crossings the app projects lie on the lines the shader draws (z 2 and 3.2)', async ({ page }) => {
  await onePlace(page, 179, -60);   // the only light, on the far side
  await gridTexture(page, 10);
  await withGl(page, '?globe=gl');
  for (const z of [2, 3.2]) {
    const cam = { lon: 0, lat: 20, z };
    await look(page, cam);
    const img = await shot(page), f = glFrame(cam, 240, 292);
    let n = 0;
    for (let lon = -30; lon <= 30; lon += 10) {
      for (let lat = 0; lat <= 50; lat += 10) {
        const p = projectGl(f, lon, lat);
        if (!p || p.z <= 0.3 || p.x < 10 || p.x > 230 || p.y < 10 || p.y > 282) continue;
        const between = [[-8, -8], [8, -8], [-8, 8], [8, 8]].reduce((s, [dx, dy]) => s + at(img, p.x + dx, p.y + dy)[2], 0) / 4;
        expect(at(img, p.x, p.y)[2] - between, `z ${z}: crossing lon ${lon}, lat ${lat}`).toBeGreaterThanOrEqual(10);
        n++;
      }
    }
    test.info().annotations.push({ type: `z ${z}`, description: `${n} crossings` });
    expect(n, `z ${z}: crossings checked`).toBeGreaterThanOrEqual(10);
  }
});

test('?globe=gl: the selected place (Berlin, z 2.6) is a golden light in the ring', async ({ page }) => {
  await withGl(page, '?place=Berlin&globe=gl');
  await look(page, { ...(await here(page)), z: 2.6 });
  expect(gold(at(await shot(page), 120, 146))).toBe(true);
});

test('?globe=gl: zoom 4 and up hides the WebGL canvas; below 4 it shows again', async ({ page }) => {
  await withGl(page, '?place=Berlin&globe=gl');
  const berlin = await here(page);
  await look(page, { ...berlin, z: 3 });
  expect(await page.locator('#globe').isVisible()).toBe(true);
  await look(page, { ...berlin, z: 5 });
  expect(await page.locator('#globe').isHidden()).toBe(true);
  await look(page, { ...berlin, z: 3 });
  expect(await page.locator('#globe').isVisible()).toBe(true);
});

test('?globe=gl: at rest nothing is drawn (render only on change), held or let go', async ({ page }) => {
  await withGl(page, '?place=Berlin&globe=gl');
  await look(page, { lon: 10, lat: 48, z: 2 });   // held, as by a finger
  const quiet = async () => {
    await page.evaluate(() => { (window as any).__view.frameMs.length = 0; });
    await page.waitForTimeout(600);
    return page.evaluate(() => (window as any).__view.frameMs.length);
  };
  expect(await quiet(), 'held').toBe(0);
  // Let go: the map rests freely, so a caught place may glide into the ring once; after that nothing more is drawn.
  await page.evaluate(() => (window as any).__view.hold(false));
  await frames(page);   // the frame that may start the glide
  await page.waitForFunction(() => !(window as any).__view.moving);
  expect(await quiet(), 'let go').toBe(0);
});

test('?globe=gl: a light whose centre is 2 px off the left edge still lights the edge', async ({ page }) => {
  // The only place, so the selected one (level 1). PowerVR would drop this point without the widened viewport; desktop
  // GPUs and SwiftShader may not, so lightViewport's unit test carries the fix itself.
  await onePlace(page, 0, 0);
  await withGl(page, '?globe=gl');
  const z = 2.6, cam = { lon: Math.asin(122 / globeRadius(z, 0)) / RAD, lat: 0, z };
  const p = projectGl(glFrame(cam, 240, 292), 0, 0)!;
  expect(p.x).toBeCloseTo(-2, 6);
  expect(p.y).toBeCloseTo(146, 6);
  await look(page, cam);
  const img = await shot(page);
  expect(at(img, 0, 146)[0] - at(img, 0, 120)[0]).toBeGreaterThanOrEqual(40);
});

test('?globe=gl: a late WebView resize keeps the WebGL globe full-size and the selected light in the ring', async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 282 });
  await withGl(page, '?place=Berlin&globe=gl');
  await look(page, { ...(await here(page)), z: 2.6 });
  const size = () => page.evaluate(() => { const c = document.getElementById('globe') as HTMLCanvasElement; return [c.width, c.height]; });
  expect(await size()).toEqual([480, 564]);
  await page.setViewportSize({ width: 240, height: 292 });
  await expect.poll(size).toEqual([480, 584]);
  expect(await page.locator('#globe').boundingBox()).toEqual({ x: 0, y: 0, width: 240, height: 292 });
  await frames(page);
  expect(gold(at(await shot(page), 120, 146))).toBe(true);
});

/** The app at `query`, past the gate with ⓘ bound; streams are faked, so nothing plays. */
async function tunedIn(page: Page, query: string): Promise<void> {
  await fakeStreams(page);
  await tuneIn(page, query);
  await page.waitForFunction(() => (window as any).__app);   // set by boot just before start() binds ⓘ
}

/** About's globe line as shown: ⓘ opens About, its log's first line is read, a tap closes it again. */
async function shown(page: Page): Promise<string> {
  const about = page.locator('#about');
  await page.click('#binfo');
  await expect(about).toBeVisible();
  const text = (await about.locator('.diag p').first().textContent()) ?? '';
  await page.click('#about');
  await expect(about).toBeHidden();
  return text;
}

/** About's globe line without the frame time it adds once the globe has drawn (", frames 9.4 ms"). */
const line = async (page: Page) => (await shown(page)).replace(/, frames \d+\.\d ms$/, '');

/** The line once the choice is made (it reads 'globe: starting' until then). */
async function decided(page: Page): Promise<string> {
  await expect.poll(() => line(page), { timeout: 20000 }).not.toBe('globe: starting');
  return line(page);
}

/** After a look() on the globe: whether the Canvas 2D globe drew that frame, and #globe is hidden. */
const canvas2d = async (page: Page) => (await page.evaluate(() => {
  const v = (window as any).__view;
  return v.frameGlobe[v.frameGlobe.length - 1] === true && v.globe.R > 0 && (!v.gl || !v.gl.ok);
})) && (await page.locator('#globe').isHidden());

const EUROPE = { lon: 10, lat: 48, z: 2 };
const CENTRE = { x: 110, y: 136, w: 20, h: 20 };
const bright = (m: number[]) => (m[0] + m[1] + m[2]) / 3;

test('auto: the About line names the renderer the map really uses', async ({ page }) => {
  await tunedIn(page, '?place=Berlin');
  const text = await decided(page);
  test.info().annotations.push({ type: 'line', description: text });
  expect(text).toMatch(/^globe: (WebGL, (highp|mediump), pt \d+, \d+\.\d ms|Canvas 2D, .+)$/);
  await look(page, EUROPE);
  expect(await page.locator('#globe').isVisible()).toBe(text.startsWith('globe: WebGL'));
  expect(await canvas2d(page)).toBe(text.startsWith('globe: Canvas 2D'));
});

test('?globe=2d: "globe: Canvas 2D, forced", the Canvas 2D globe draws and #globe stays hidden', async ({ page }) => {
  await tunedIn(page, '?place=Berlin&globe=2d');
  expect(await decided(page)).toBe('globe: Canvas 2D, forced');
  await look(page, EUROPE);
  expect(await canvas2d(page)).toBe(true);
});

// Findings A5/B5: About also gives the median time of the last globe frames, so a photo of it shows whether the globe
// the r1 uses (the Canvas 2D fallback above all) is smooth there.
for (const mode of ['2d', 'gl'] as const) {
  test(`?globe=${mode}: once the globe has drawn, About adds its median frame time (", frames x.x ms")`, async ({ page }) => {
    if (mode === 'gl') await needWebGl(page);
    await tunedIn(page, `?place=Berlin&globe=${mode}`);
    if (mode === 'gl') await page.waitForFunction(() => (window as any).__view.gl?.ok);
    const before = await shown(page);
    expect(before, 'only the tile view has drawn yet').not.toContain('frames');
    await look(page, EUROPE);
    const name = mode === 'gl' ? 'WebGL, (highp|mediump), pt \\d+' : 'Canvas 2D';
    const text = await shown(page);
    test.info().annotations.push({ type: 'line', description: text });
    expect(text).toMatch(new RegExp(`^globe: ${name}, forced, frames \\d+\\.\\d ms$`));
  });
}

test('no WebGL: "globe: Canvas 2D, no WebGL" and globe-gl.js is never requested', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', r => { asked.push(r.url()); });
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, ...a: unknown[]) => unknown;
    (HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return type === 'webgl' || type === 'experimental-webgl' ? null : get.call(this, type, ...rest);
    };
  });
  await tunedIn(page, '?place=Berlin');
  expect(await decided(page)).toBe('globe: Canvas 2D, no WebGL');
  await look(page, EUROPE);
  expect(await canvas2d(page)).toBe(true);
  expect(asked.filter(u => u.includes('globe-gl.js'))).toEqual([]);
});

test('globe-gl.js does not load: "globe: Canvas 2D, load failed", the context is released', async ({ page }) => {
  await needWebGl(page);
  await page.route('**/globe-gl.js*', r => r.abort());
  await tunedIn(page, '?place=Berlin');
  expect(await decided(page)).toBe('globe: Canvas 2D, load failed');
  expect(await page.evaluate(() => (document.getElementById('globe') as HTMLCanvasElement).getContext('webgl')!.isContextLost())).toBe(true);
  await look(page, EUROPE);
  expect(await canvas2d(page)).toBe(true);
});

test('a shader that does not compile: "globe: Canvas 2D, shader: ERROR: test", the context is released', async ({ page }) => {
  await needWebGl(page);
  await page.addInitScript(() => {
    const P = WebGLRenderingContext.prototype, param = P.getShaderParameter;
    P.getShaderParameter = function (this: WebGLRenderingContext, s: WebGLShader, p: number) {
      return p === this.COMPILE_STATUS ? false : param.call(this, s, p);
    };
    P.getShaderInfoLog = () => 'ERROR: test';
  });
  await tunedIn(page, '?place=Berlin');
  expect(await decided(page)).toBe('globe: Canvas 2D, shader: ERROR: test');
  expect(await page.evaluate(() => (document.getElementById('globe') as HTMLCanvasElement).getContext('webgl')!.isContextLost())).toBe(true);
  await look(page, EUROPE);
  expect(await canvas2d(page)).toBe(true);
});

test('a slow GPU: "globe: Canvas 2D, slow (2x.x ms)", the context is released, the Canvas 2D globe draws', async ({ page }) => {
  await needWebGl(page);
  await page.addInitScript(() => {
    const P = WebGLRenderingContext.prototype, read = P.readPixels as (...a: unknown[]) => void;
    (P as any).readPixels = function (this: WebGLRenderingContext, ...a: unknown[]) {
      const t = performance.now();
      while (performance.now() - t < 20) { /* a GPU that needs 20 ms more per frame */ }
      return read.apply(this, a);
    };
  });
  await tunedIn(page, '?place=Berlin');
  // "slow (2x.x ms)" here; a software GPU (CI) adds its own frame time to the 20 ms, so only the floor is checked.
  const text = await decided(page), ms = Number(/^globe: Canvas 2D, slow \((\d+\.\d) ms\)$/.exec(text)?.[1]);
  expect(ms, text).toBeGreaterThanOrEqual(20);
  expect(await page.evaluate(() => (document.getElementById('globe') as HTMLCanvasElement).getContext('webgl')!.isContextLost())).toBe(true);
  expect(await page.evaluate(() => (window as any).__view.gl)).toBeNull();
  await look(page, EUROPE);
  expect(await canvas2d(page)).toBe(true);
});

// The probe's own frame (drawProbe, through the globe's draw) or its readPixels throwing: settled as a fallback, never
// 'globe: starting' for the rest of the run.
for (const fn of ['readPixels', 'uniform4f'] as const) {
  test(`${fn} throwing in the probe: "globe: Canvas 2D, probe: test", the context is released, the Canvas 2D globe draws`, async ({ page }) => {
    await needWebGl(page);
    await page.addInitScript(fn => { (WebGLRenderingContext.prototype as any)[fn] = () => { throw new Error('test'); }; }, fn);
    await tunedIn(page, '?place=Berlin');
    expect(await decided(page)).toBe('globe: Canvas 2D, probe: test');
    expect(await page.evaluate(() => (document.getElementById('globe') as HTMLCanvasElement).getContext('webgl')!.isContextLost())).toBe(true);
    expect(await page.evaluate(() => (window as any).__view.gl)).toBeNull();
    await look(page, EUROPE);
    expect(await canvas2d(page)).toBe(true);
  });
}

test('context lost mid-flight: the flight goes on with the Canvas 2D globe; restored, WebGL again; no page errors', async ({ page }) => {
  await needWebGl(page);
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on('pageerror', e => { errors.push(e.message); });
  await tunedIn(page, '?place=Berlin&globe=gl');
  await page.waitForFunction(() => (window as any).__view.gl?.ok);
  expect(await line(page)).toMatch(/^globe: WebGL, (highp|mediump), pt \d+, forced$/);
  const r = await page.evaluate(async () => {
    const v = (window as any).__view, c = document.getElementById('globe') as HTMLCanvasElement;
    const frame = () => new Promise(res => requestAnimationFrame(res));
    const ext = c.getContext('webgl')!.getExtension('WEBGL_lose_context')!;
    (window as any).__lose = ext;   // the same object restores it: a lost context hands out no extension
    v.flyTo(139.69, 35.69, 7);      // Tokyo
    while (v.cam.z >= 4) await frame();
    ext.loseContext();
    while (v.gl.ok) await frame();  // the loss is reported a task later
    v.frameMs.length = 0;
    v.frameGlobe.length = 0;
    const seen: { z: number; hidden: boolean }[] = [];
    while (v.moving) { await frame(); seen.push({ z: v.cam.z, hidden: c.hidden }); }
    return { frames: v.frameMs.length, globe: v.frameGlobe.filter(Boolean).length, seen, end: { ...v.cam } };
  });
  test.info().annotations.push({ type: 'after the loss', description: `${r.frames} frames, ${r.globe} on the globe` });
  expect(r.frames).toBeGreaterThanOrEqual(10);                    // the flight goes on
  expect(r.globe).toBeGreaterThanOrEqual(3);                      // on the Canvas 2D globe below zoom 4
  expect(r.seen.filter(s => s.z < 4).every(s => s.hidden)).toBe(true);
  expect(r.end.lon).toBeCloseTo(139.69, 6);
  expect(await line(page)).toBe('globe: Canvas 2D, context lost');
  await page.evaluate(() => (window as any).__lose.restoreContext());
  await page.waitForFunction(() => (window as any).__view.gl.ok);
  await look(page, EUROPE);
  expect(await page.locator('#globe').isVisible()).toBe(true);
  expect(bright(mean(await shot(page), CENTRE))).toBeGreaterThan(15);
  expect(await line(page)).toMatch(/^globe: WebGL, /);
  expect(errors).toEqual([]);
});

test('zooming out before the WebGL decision draws the Canvas 2D globe, then WebGL takes over without a black frame', async ({ page }) => {
  await needWebGl(page);
  await page.route('**/globe-gl.js*', async r => { await new Promise(res => setTimeout(res, 2000)); await r.continue(); });
  await page.goto('/?place=Berlin&globe=gl');
  await page.waitForFunction(() => (window as any).__view);
  await bare(page);
  await look(page, EUROPE);
  expect(await page.evaluate(() => (window as any).__view.gl)).toBeNull();
  expect(await canvas2d(page)).toBe(true);
  expect(bright(mean(await shot(page), CENTRE))).toBeGreaterThan(15);
  // The WebGL globe draws its first frame and only then shows #globe, so no frame shows an empty canvas.
  await page.waitForFunction(() => (window as any).__view.gl && !document.getElementById('globe')!.hidden, null, { timeout: 10000 });
  expect(bright(mean(await shot(page), CENTRE))).toBeGreaterThan(15);
});
