import { expect, test, type Page } from '@playwright/test';
import { offline } from './net';
import { bare, gridTexture, gridTiles, look, mean, needWebGl, onePlace, peaks, shot, type Img } from './pixels';

// The hand-over at zoom 4 (Task 6): just below it a globe, at it the tiles, whichever globe the app runs (WebGL, or the
// Canvas 2D fallback). Both globes flatten into the tiles' Web Mercator from FLAT_FROM, so the same grid lies where the
// tiles draw it, top edge included, the tint matches and the light has eased to flat: nothing jumps.

test.beforeEach(async ({ page }) => { await offline(page); });

/** The brightest pixel (red) of r, in CSS px. */
function brightest(img: Img, x0: number, y0: number, s: number): { x: number; y: number } {
  let best = -1, at = { x: 0, y: 0 };
  for (let y = 2 * y0; y < 2 * (y0 + s); y++) {
    for (let x = 2 * x0; x < 2 * (x0 + s); x++) {
      const o = (y * img.w + x) * 4, v = img.d[o] + img.d[o + 1];
      if (v > best) { best = v; at = { x: (x + 0.5) / 2, y: (y + 0.5) / 2 }; }
    }
  }
  return at;
}

const isGlobe = (page: Page) => page.locator('#globe').isVisible();

for (const mode of ['gl', '2d'] as const) {
  test(`at zoom 4 the ${mode} globe and the tiles agree: grid within 1.5 px (top edge included), tint within 8 levels, the light alike`, async ({ page }) => {
    // 5.625° = 32 texels, so every band edge lies on a texel edge and the Canvas 2D globe's texel lookup draws it where
    // the tiles do. The cam is off the old ¼° and texel steps; at z 4 the meridians lie at x ≈ 58, 122, 186, the
    // parallels at y ≈ 29, 137, 232 and the light at (72, 191).
    if (mode === 'gl') await needWebGl(page);
    await onePlace(page, -32.5, 47.5);
    await gridTexture(page, 5.625, 2);
    await gridTiles(page, 5.625, 2);
    await page.goto(`/?globe=${mode}`);
    await page.waitForFunction(m => (window as any).__view?.places && (m === '2d' || (window as any).__view.gl), mode);
    await bare(page);
    const cam = { lon: -28.3, lat: 50.1 };
    await look(page, { ...cam, z: 3.999 });
    expect(await isGlobe(page)).toBe(mode === 'gl');
    expect(await page.evaluate(() => { const v = (window as any).__view; return v.frameGlobe[v.frameGlobe.length - 1]; })).toBe(true);
    const g = await shot(page, `${mode} globe z 3.999`);
    await look(page, { ...cam, z: 4 });
    expect(await isGlobe(page)).toBe(false);
    const tl = await shot(page, 'tiles z 4');
    // rows cross the meridians, column 150 (between the meridians at x 122 and 186, clear of the light) the parallels
    for (const [axis, i] of [['row', 12], ['row', 146], ['row', 280], ['col', 150]] as const) {
      const a = peaks(g, axis, i), b = peaks(tl, axis, i);
      test.info().annotations.push({ type: `${axis} ${i}`, description: `globe ${a.map(v => v.toFixed(1)).join(' ')} | tiles ${b.map(v => v.toFixed(1)).join(' ')}` });
      expect(a.length, `${axis} ${i}`).toBe(b.length);
      a.forEach((v, k) => expect(Math.abs(v - b[k]), `${axis} ${i}, line ${k}`).toBeLessThanOrEqual(1.5));
    }
    for (const x of [40, 92, 200]) {   // grid-free patches left, centre, right: no leftover directional light
      const m = mean(g, { x, y: 110, w: 12, h: 12 }), n = mean(tl, { x, y: 110, w: 12, h: 12 });
      test.info().annotations.push({ type: `tint at x ${x}`, description: `globe ${m.map(Math.round)} | tiles ${n.map(Math.round)}` });
      m.forEach((v, c) => expect(Math.abs(v - n[c]), `tint at x ${x}, channel ${c}`).toBeLessThanOrEqual(8));
    }
    // the test place's light: the same peak position ± 1 px and a 24×24 mean within 6 levels
    const p = brightest(g, 57, 176, 30), q = brightest(tl, 57, 176, 30);
    test.info().annotations.push({ type: 'light', description: `globe (${p.x}, ${p.y}) | tiles (${q.x}, ${q.y})` });
    expect(Math.abs(p.x - q.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.y - q.y)).toBeLessThanOrEqual(1);
    const m = mean(g, { x: q.x - 12, y: q.y - 12, w: 24, h: 24 }), n = mean(tl, { x: q.x - 12, y: q.y - 12, w: 24, h: 24 });
    m.forEach((v, c) => expect(Math.abs(v - n[c]), `light mean, channel ${c}`).toBeLessThanOrEqual(6));
  });
}
