import { test, type Page } from '@playwright/test';
import { project } from '../src/geo/mercator';

// Pixel checks on what the map actually draws: screenshots of the page at the r1's 240×292 CSS viewport, dpr 2.

export type Rect = { x: number; y: number; w: number; h: number };   // CSS px
export interface Img { w: number; h: number; d: Uint8Array }        // RGBA, device px (2× CSS)
type RGB = [number, number, number];

const DPR = 2;

/**
 * Skips the test where the browser has no WebGL at all (Playwright's own Chromium in CI may have none): the WebGL globe
 * cannot be checked there, the Canvas 2D globe still is. The pixel bounds of the WebGL checks were measured on ANGLE
 * Metal (Apple silicon); CI's first run reports its own figures in the annotations.
 */
export async function needWebGl(page: Page): Promise<void> {
  const ok = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl'));
  test.skip(!ok, 'no WebGL in this browser: the WebGL globe cannot be checked here');
}

/** Hides everything drawn over the map (gate, ring, strip, buttons…), so a screenshot shows the map alone. */
export async function bare(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '#gate,#ring,#status,#attr,#zoom,#lists,#tools,#vol,#strip{visibility:hidden!important}',
  });
}

/**
 * Puts the camera at cam: cancels any flight, holds the map (so no glide moves it on), wakes it, waits until every
 * tile it asked for has loaded, then two more frames.
 */
export async function look(page: Page, cam: { lon: number; lat: number; z: number }): Promise<void> {
  const frames = () => page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))));
  await page.evaluate(cam => {
    const v = (window as any).__view;
    v.flight = null;
    v.hold(true);
    v.cam = { ...cam };
    v.wake();
  }, cam);
  await frames();   // the view has drawn at cam and requested its tiles
  await page.waitForFunction(() => [...(window as any).__view.tiles.cache.values()].every((img: HTMLImageElement) => img.complete));
  await frames();
}

/** A screenshot of the page, decoded in the page from a data: URL; attached to the test's results under `name` if given. */
export async function shot(page: Page, name?: string): Promise<Img> {
  const buf = await page.screenshot();
  if (name) await test.info().attach(name, { body: buf, contentType: 'image/png' });
  const png = buf.toString('base64');
  const raw = await page.evaluate(async png => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let s = '';
    for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { w: c.width, h: c.height, b64: btoa(s) };
  }, png);
  return { w: raw.w, h: raw.h, d: new Uint8Array(Buffer.from(raw.b64, 'base64')) };
}

/** The colour at CSS position (x, y). */
export function at(img: Img, x: number, y: number): RGB {
  const o = (Math.floor(y * DPR) * img.w + Math.floor(x * DPR)) * 4;
  return [img.d[o], img.d[o + 1], img.d[o + 2]];
}

/** Every device pixel of the CSS rectangle r, clipped to the image, with its device coordinates. */
function each(img: Img, r: Rect, f: (p: RGB, x: number, y: number) => void): void {
  const x0 = Math.max(0, Math.round(r.x * DPR)), x1 = Math.min(img.w, Math.round((r.x + r.w) * DPR));
  const y0 = Math.max(0, Math.round(r.y * DPR)), y1 = Math.min(img.h, Math.round((r.y + r.h) * DPR));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * img.w + x) * 4;
      f([img.d[o], img.d[o + 1], img.d[o + 2]], x, y);
    }
  }
}

/** How many device pixels of r satisfy pred. */
export function count(img: Img, r: Rect, pred: (p: RGB) => boolean): number {
  let n = 0;
  each(img, r, p => { if (pred(p)) n++; });
  return n;
}

/** How many device pixels within radius r (CSS px) of the view's centre (120, 146) satisfy pred. */
export function inDisc(img: Img, r: number, pred: (p: RGB) => boolean): number {
  let n = 0;
  each(img, { x: 120 - r, y: 146 - r, w: 2 * r, h: 2 * r }, (p, x, y) => {
    if (Math.hypot((x + 0.5) / DPR - 120, (y + 0.5) / DPR - 146) <= r && pred(p)) n++;
  });
  return n;
}

/**
 * The CSS positions (along the line) of the centres of the runs of pixels at least 10 levels above the median of that
 * line in channel ch: the device row at CSS y `at` for 'row', the device column at CSS x `at` for 'col'.
 */
export function peaks(img: Img, axis: 'row' | 'col', at: number, ch = 2): number[] {
  const n = axis === 'row' ? img.w : img.h, a = Math.floor(at * DPR), v: number[] = [];
  for (let i = 0; i < n; i++) v.push(img.d[((axis === 'row' ? a * img.w + i : i * img.w + a) * 4) + ch]);
  const m = [...v].sort((x, y) => x - y)[n >> 1], out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (v[i] < m + 10) continue;
    let j = i;
    while (j + 1 < n && v[j + 1] >= m + 10) j++;
    out.push((i + j + 1) / 2 / DPR);
    i = j;
  }
  return out;
}

/** The mean colour of r. */
export function mean(img: Img, r: Rect): RGB {
  const s: RGB = [0, 0, 0];
  let n = 0;
  each(img, r, p => { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; n++; });
  return [s[0] / n, s[1] / n, s[2] / n];
}

/**
 * 15 cameras moved by less than 2 CSS px around a view (in degrees): what a count depends on where the screen-fixed grids
 * (the caps' cells, the cluster cells) fall, so a check takes the median, or the worst, over all of them.
 */
export const NUDGES = [-0.2, -0.1, 0, 0.1, 0.2].flatMap(lon => [-0.1, 0, 0.1].map(lat => ({ lon, lat })));

/** The largest smallest channel of r: how close its whitest pixel comes to `white`. */
export function whitest(img: Img, r: Rect): number {
  let m = 0;
  each(img, r, p => { m = Math.max(m, Math.min(...p)); });
  return m;
}

/** A light burnt out to white: what dense regions must never become (the user's "forest fires"). */
export const white = (p: RGB) => Math.min(...p) >= 215;
/** The golden core of a light. */
export const gold = (p: RGB) => p[0] >= 150 && p[0] - p[2] >= 60;
/** Lit by the station lights, golden or faint: warm, its red over the blue it lies on (a light that reads grey is not lit). */
export const lit = (p: RGB) => p[0] >= 60 && p[0] - p[2] >= 20;

/** The selected place's own coordinates. */
export async function here(page: Page): Promise<{ lon: number; lat: number }> {
  return page.evaluate(() => {
    const v = (window as any).__view;
    return { lon: v.places.lon[v.current], lat: v.places.lat[v.current] };
  });
}

/** places.json with a single place at lon/lat (30 stations, "Testplace"): the only light, and the selected place. */
export async function onePlace(page: Page, lon: number, lat: number): Promise<void> {
  const json = { v: 't', lat: [lat], lon: [lon], count: [30], name: ['Testplace'], cc: ['DE'], tzi: [0], tzs: ['Europe/Berlin'] };
  await page.unroute('**/data/places.json');
  await page.route('**/data/places.json', r => r.fulfill({ json }));
}

/** Serves an SVG as the globe texture (img/earth-2048.jpg), 2048×1024 like the real one. */
async function texture(page: Page, body: string): Promise<void> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="1024">${body}</svg>`;
  await page.unroute('**/img/earth-2048.jpg');
  await page.route('**/img/earth-2048.jpg', r => r.fulfill({ body: svg, contentType: 'image/svg+xml' }));
}

/**
 * A grid texture: #46505a with white lines `width` texels wide every `step` degrees of longitude and latitude, each
 * centred on its degree and drawn on whole texels, so the app's projection can be checked against the shader's.
 */
export async function gridTexture(page: Page, step: number, width = 6): Promise<void> {
  const k = 2048 / 360;   // texels per degree, both ways
  let lines = '';
  for (let lon = -180; lon <= 180; lon += step) lines += `<rect x="${Math.round((lon + 180) * k - width / 2)}" y="0" width="${width}" height="1024"/>`;
  for (let lat = -90; lat <= 90; lat += step) lines += `<rect x="0" y="${Math.round((90 - lat) * k - width / 2)}" width="2048" height="${width}"/>`;
  await texture(page, `<rect width="2048" height="1024" fill="#46505a"/><g fill="#fff" shape-rendering="crispEdges">${lines}</g>`);
}

/**
 * Every map tile (EOX) as a 256×256 SVG of gridTexture(step, width)'s grid in Web Mercator for that tile's z/x/y: #46505a
 * with white bands, each the Mercator image of the band `width` texels (width · 360/2048°) wide around its degree, so the
 * globe texture and the tiles show the same bands. Registered after offline(), it answers the tiles first.
 */
export async function gridTiles(page: Page, step: number, width = 6): Promise<void> {
  const half = (width * 180) / 2048;   // degrees either side of a line
  await page.route('https://tiles.maps.eox.at/**', r => {
    const [z, ty, tx] = new URL(r.request().url()).pathname.split('/').slice(-3).map(parseFloat);
    const at = (lon: number, lat: number) => { const p = project(lon, lat, z); return { x: p.x - tx * 256, y: p.y - ty * 256 }; };
    let lines = '';
    for (let lon = -180; lon <= 180; lon += step) {
      const x0 = at(lon - half, 0).x, x1 = at(lon + half, 0).x;
      if (x1 > 0 && x0 < 256) lines += `<rect x="${x0}" y="0" width="${x1 - x0}" height="256"/>`;
    }
    for (let lat = -90 + step; lat < 90; lat += step) {
      const y0 = at(0, lat + half).y, y1 = at(0, lat - half).y;
      if (y1 > 0 && y0 < 256) lines += `<rect x="0" y="${y0}" width="256" height="${y1 - y0}"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#46505a"/><g fill="#fff">${lines}</g></svg>`;
    return r.fulfill({ body: svg, contentType: 'image/svg+xml' });
  });
}

/**
 * A smooth texture, continuous across ±180°: a horizontal gradient symmetric about longitude 0 under a half-transparent
 * vertical one, no channel stepping more than a level per texel, so comparing two renders measures their shader math,
 * not texture detail.
 */
export async function rampTexture(page: Page): Promise<void> {
  await texture(page, '<defs>'
    + '<linearGradient id="h"><stop offset="0" stop-color="rgb(40,60,200)"/><stop offset=".5" stop-color="rgb(230,150,40)"/><stop offset="1" stop-color="rgb(40,60,200)"/></linearGradient>'
    + '<linearGradient id="v" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>'
    + '</defs><rect width="2048" height="1024" fill="url(#h)"/><rect width="2048" height="1024" fill="url(#v)" opacity=".5"/>');
}
