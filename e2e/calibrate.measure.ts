import { mkdirSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { brighten, BRIGHTEN_K, modelWhitest, NUDGES, places, VIEWS } from '../tests/map/whitemodel';
import { offline } from './net';
import { bare, look, needWebGl, shot, white, type Img } from './pixels';

// The calibration of tests/map/lightsdata.test.ts's white model, not part of the e2e suite (no .spec name). Run it with
//   PW_CHANNEL=chrome pnpm exec playwright test -c playwright.calibrate.config.ts
// For every camera the data test covers (its VIEWS × NUDGES) on each globe it puts the model's whitest pixel (the
// smallest channel of the lightest one, over the places.json the dev server serves) next to the browser's at the same
// camera (the whole view, as e2e/white.spec.ts takes it), and writes the table with the overestimate model − browser to
// $CALIBRATION_OUT (default test-results/white-calibration)-<globe>.md and .json. The model's alarm for a globe is
// 215 + the smallest overestimate, rounded down (the rule in lightsdata.test.ts). The same on the trip test's synthetic
// brightening goes to -<globe>-brightened.md and .json: the cameras where the browser draws white there are the trip
// test's WHITE_CAMS, and the model must reach the alarm at each.

const OUT = process.env.CALIBRATION_OUT ?? 'test-results/white-calibration';
type Row = { view: string; z: number; dl: number; db: number; model: number; mAt: string; browser: number; bAt: string; whitePx: number; over: number };

/** The browser's whitest pixel: its smallest channel, where (CSS px), and how many px are white. */
function browserWhitest(img: Img): { v: number; at: string; px: number } {
  let v = -1, o = 0, px = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    const p: [number, number, number] = [img.d[4 * i], img.d[4 * i + 1], img.d[4 * i + 2]], m = Math.min(...p);
    if (white(p)) px++;
    if (m > v) { v = m; o = i; }
  }
  return { v, at: `${(o % img.w) / 2}, ${Math.floor(o / img.w) / 2}`, px };
}

/** The places.json bytes the dev server serves. */
const served = async (page: Page): Promise<Buffer> => (await page.request.get('/data/places.json')).body();

/** Opens the app on globe mode with Berlin selected and the map bare, on the places.json body if given. */
async function open(page: Page, mode: 'gl' | '2d', body?: string): Promise<void> {
  if (body) {
    await page.unroute('**/data/places.json');
    await page.route('**/data/places.json', r => r.fulfill({ body, contentType: 'application/json' }));
  }
  await page.goto(`/?place=Berlin&globe=${mode}`);
  await page.waitForFunction(m => (window as any).__view?.current >= 0 && (m === '2d' || (window as any).__view.gl), mode);
  await bare(page);
}

/** Model and browser at each camera of views (each with NUDGES), Berlin selected. */
async function measure(page: Page, body: Uint8Array | string, mode: 'gl' | '2d', views = VIEWS): Promise<Row[]> {
  const P = await places(body), berlin = P.name.indexOf('Berlin'), rows: Row[] = [];
  for (const [view, lon, lat, z] of views) {
    for (const [dl, db] of NUDGES) {
      const cam = { lon: lon + dl, lat: lat + db, z }, m = modelWhitest(P, berlin, cam, mode === '2d');
      await look(page, cam);
      const b = browserWhitest(await shot(page));
      rows.push({ view, z, dl, db, model: m.v, mAt: `${m.x}, ${m.y}`, browser: b.v, bAt: b.at, whitePx: b.px, over: m.v - b.v });
    }
  }
  return rows;
}

function table(rows: Row[]): string {
  const f = (v: number) => v.toFixed(1);
  return ['| View | z | nudge (lon, lat) | model | at (CSS px) | browser | at (CSS px) | white px | overestimate |', '|---|---|---|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.view} | ${r.z} | ${r.dl}, ${r.db} | ${f(r.model)} | ${r.mAt} | ${r.browser} | ${r.bAt} | ${r.whitePx} | ${f(r.over)} |`)].join('\n');
}

function summary(name: string, rows: Row[]): string {
  const lo = rows.reduce((a, r) => (r.over < a.over ? r : a)), hi = rows.reduce((a, r) => (r.model > a.model ? r : a));
  const wb = rows.reduce((a, r) => (r.browser > a.browser ? r : a)), bound = 215 + Math.floor(lo.over);
  return `${name}: ${rows.length} cameras. Smallest overestimate ${lo.over.toFixed(1)} (${lo.view} z ${lo.z}, ${lo.dl}, ${lo.db}): `
    + `bound 215 + ${Math.floor(lo.over)} = ${bound}. Model at most ${hi.model.toFixed(1)} (${hi.view} z ${hi.z}, ${hi.dl}, ${hi.db}): `
    + `margin ${(bound - hi.model).toFixed(1)}. Browser at most ${wb.browser} (${wb.view} z ${wb.z}, ${wb.dl}, ${wb.db}), `
    + `white px ${rows.reduce((s, r) => s + r.whitePx, 0)}. ${whiteCams(rows)}`;
}

/** The cameras where the browser draws white, and the model's lowest value there (what the alarm must not exceed). */
function whiteCams(rows: Row[]): string {
  const w = rows.filter(r => r.browser >= 215);
  if (!w.length) return 'The browser draws white at no camera.';
  const lo = w.reduce((a, r) => (r.model < a.model ? r : a));
  return `The browser draws white at ${w.length} cameras (${w.map(r => `${r.view} z ${r.z} ${r.dl}/${r.db}: ${r.browser}`).join('; ')}); `
    + `the model there at least ${lo.model.toFixed(1)} (${lo.view} z ${lo.z}, ${lo.dl}, ${lo.db}).`;
}

function save(file: string, rows: Row[], title: string): void {
  mkdirSync(OUT.replace(/[^/]*$/, '') || '.', { recursive: true });
  writeFileSync(`${OUT}-${file}.json`, JSON.stringify(rows, null, 1));
  writeFileSync(`${OUT}-${file}.md`, `${summary(title, rows)}\n\n${table(rows)}\n`);
  console.log(summary(title, rows));
}

test.describe.configure({ mode: 'parallel' });
test.beforeEach(async ({ page }) => { await offline(page); });

for (const mode of ['gl', '2d'] as const) {
  const name = mode === 'gl' ? 'WebGL' : 'Canvas 2D';
  test(`${name} globe: the model against the browser at every camera of the data test`, async ({ page }) => {
    test.setTimeout(600000);
    if (mode === 'gl') await needWebGl(page);
    const body = await served(page);
    await open(page, mode);
    save(mode, await measure(page, body, mode), `${name} globe, real places`);
  });

  // The trip test's synthetic brightening (brighten), at BRIGHTEN_K or at each k of $BRIGHTEN (comma-separated), at every
  // camera of the data test: where the browser draws white (at least 215), the model must reach the bound.
  test(`${name} globe: the model against the browser on a synthetic brightening of the Netherlands`, async ({ page }) => {
    test.setTimeout(600000);
    if (mode === 'gl') await needWebGl(page);
    const real = await served(page), rows: Row[] = [];
    for (const k of process.env.BRIGHTEN ? process.env.BRIGHTEN.split(',').map(Number) : [BRIGHTEN_K[mode]]) {
      const body = brighten(real, k);
      await open(page, mode, body);
      for (const r of await measure(page, body, mode)) rows.push({ ...r, view: `${r.view}, k ${k}` });
    }
    save(`${mode}-brightened`, rows, `${name} globe, brightened`);
  });
}
