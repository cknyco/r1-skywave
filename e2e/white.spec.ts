import { expect, test } from '@playwright/test';
import { whiteNote } from '../scripts/lib/white-verdict';
import { offline } from './net';
import { bare, count, look, needWebGl, NUDGES, shot, white, whitest } from './pixels';

// The spec's anti-goal: lights that burn out to white (the user's "forest fires"). Checked on the real places, on both
// globes, where they come closest: the densest regions face on at z 2.4, just below the band edge 2.5 where faint lights
// are largest (ruling F2), and Europe and the US east coast seen edge-on, where foreshortening packs 1/depth more lights
// into each px over the bright atmosphere rim (final review A1). Each view is the worst of the 15 NUDGES cameras: at one
// camera the result depends on where the screen-fixed cap and cluster grids fall (final review A2: 205 at one camera, 213
// at a nudged one). The selected place is Berlin, as in every look check. Every view is measured, also after a white one
// (expect.soft), and annotated with its values (whiteNote).
// This file is also the nightly gate: pages.yml runs it alone on the data each build makes, before that data deploys
// (scripts/white-check.ts reads the annotations; white anywhere keeps the live dataset). tests/map/lightsdata.test.ts is
// the Node model's early warning on the same data, advisory only.
test.describe.configure({ mode: 'parallel' });
test.beforeEach(async ({ page }) => { await offline(page); });

const VIEW = { x: 0, y: 0, w: 240, h: 292 };
const VIEWS: Record<string, [string, number, number, number][]> = {
  'dense regions face on': [
    ['Europe', 10, 48, 2.4], ['the US east coast', -74, 40.7, 2.4], ['Brazil', -38.6, -23.5, 2.2],
    ['Japan and Korea', 135, 36, 2.4], ['Mexico', -99.1, 19.4, 2.4],
  ],
  'dense regions edge-on at the limb': [
    ['Europe from Korea', 135, 37.5, 2], ['Europe from Korea', 135, 37.5, 1.8], ['Europe from the west', -60, 45, 2],
    ['the US east coast (and Europe over the pole) from the Pacific', -165, 40, 1.8],
  ],
};

for (const mode of ['gl', '2d'] as const) {
  for (const [group, views] of Object.entries(VIEWS)) {
    test(`?globe=${mode}, ${group}: nothing white at any of 15 cameras`, async ({ page }) => {
      test.setTimeout(240000);
      if (mode === 'gl') await needWebGl(page);
      await page.goto(`/?place=Berlin&globe=${mode}`);
      await page.waitForFunction(m => (window as any).__view?.current >= 0 && (m === '2d' || (window as any).__view.gl), mode);
      await bare(page);
      for (const [name, lon, lat, z] of views) {
        let px = 0, max = 0;
        for (const d of NUDGES) {
          await look(page, { lon: lon + d.lon, lat: lat + d.lat, z });
          const img = await shot(page);
          px += count(img, VIEW, white);
          max = Math.max(max, whitest(img, VIEW));
        }
        test.info().annotations.push({ type: `${name}, z ${z}`, description: whiteNote(max, px) });
        expect.soft(px, `${name} at z ${z}: white px over 15 cameras (whitest ${max})`).toBe(0);
      }
    });
  }
}
