import { expect, test, type Page } from '@playwright/test';
import { offline } from './net';
import { at, bare, count, gold, here, inDisc, look, mean, NUDGES, shot, white } from './pixels';

// Look A on the tile view and on the Canvas 2D globe (the fallback where WebGL is not usable): blue-marble imagery, the
// places as gentle golden lights, and never a white blob where lights crowd. Every URL carries ?globe=2d, which pins the
// Canvas 2D globe once the WebGL globe exists (Task 4) and is ignored before that.

test.beforeEach(async ({ page }) => { await offline(page); });

const VIEW = { x: 0, y: 0, w: 240, h: 292 };

/** The app at Berlin, the map alone on screen. */
async function berlin(page: Page): Promise<void> {
  await page.goto('/?place=Berlin&globe=2d');
  await page.waitForFunction(() => (window as any).__view?.current >= 0);
  await bare(page);
}

test('tiles at Berlin z 7: the selected place is a golden light in the ring, the imagery is blue, nothing burns white', async ({ page }) => {
  await berlin(page);
  await look(page, { ...(await here(page)), z: 7 });
  const img = await shot(page);
  expect(gold(at(img, 120, 146))).toBe(true);
  const m = mean(img, VIEW);
  expect(m[2]).toBeGreaterThan(m[0] + 15);
  expect(m[2]).toBeGreaterThan(m[1]);
  expect(count(img, VIEW, white)).toBe(0);
});

test('tiles over the Netherlands at z 4.5: dense faint and golden lights, nothing burns white', async ({ page }) => {
  await berlin(page);
  await look(page, { lon: 5.3, lat: 52.1, z: 4.5 });
  const img = await shot(page);
  const n = count(img, VIEW, gold);
  test.info().annotations.push({ type: 'gold-px', description: String(n) });
  expect(n).toBeGreaterThan(30);
  expect(count(img, VIEW, white)).toBe(0);
});

// At z 3.6 one view's gold count depends on where the screen-fixed grids (the cap's cells, the cluster cells) fall: it
// swings by about a third within 2 CSS px. So there the count is the median of the 15 NUDGES views.

test('the Canvas 2D globe over Europe at z 1.6, 2.6 and 3.6: blue disc, golden lights, nothing white on the disc', async ({ page }) => {
  test.setTimeout(90000);
  await berlin(page);
  for (const z of [1.6, 2.6, 3.6]) {
    const counts: number[] = [];
    let R = 0;
    for (const d of z === 3.6 ? NUDGES : [{ lon: 0, lat: 0 }]) {
      await look(page, { lon: 10 + d.lon, lat: 48 + d.lat, z });
      const v = await page.evaluate(() => { const v = (window as any).__view; return { globe: v.frameGlobe[v.frameGlobe.length - 1], R: v.globe.R }; });
      expect(v.globe, `z ${z}`).toBe(true);
      const img = await shot(page);
      const m = mean(img, { x: 45, y: 175, w: 30, h: 30 });   // south-west of the centre: France, Iberia, the Atlantic
      expect(m[2], `z ${z}: blue over red`).toBeGreaterThan(m[0]);
      expect(m[2], `z ${z}: blue over green`).toBeGreaterThan(m[1]);
      expect(inDisc(img, v.R - 2, white), `z ${z}: white on the disc`).toBe(0);
      counts.push(count(img, { x: 60, y: 96, w: 120, h: 100 }, gold));
      R = v.R;
    }
    const n = [...counts].sort((a, b) => a - b)[counts.length >> 1];
    test.info().annotations.push({ type: `z ${z}`, description: `R ${R}, gold px ${counts.length > 1 ? `median ${n} of ${counts.join(' ')}` : n}` });
    expect(n, `z ${z}: golden lights`).toBeGreaterThan(100);
  }
});
