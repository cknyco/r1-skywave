import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Lights } from '../../src/map/lights';
import { brighten, BRIGHTEN_K, modelWhitest, NUDGES, places, PLACES, VIEWS } from './whitemodel';

// "Never white" on the real places (findings A2/B6 of the final review), as a model in Node: an early warning, never a
// failure (the user's ruling of 2026-10-18). The gate is the real browser: pages.yml runs e2e/white.spec.ts on the data
// each nightly build makes and deploys that data only when it draws no white (scripts/white-check.ts). This model runs in
// `pnpm test` on the places.json the build just put in dist/ and reports every camera at or over its alarm (BOUND): in the
// test output and, in GitHub Actions, as a ::warning:: line; only its synthetic trip test below asserts.
// Each view's lights come from the app's own pipeline (orthoPlaces, then lightUp as MapView draws them, merged as the
// Canvas 2D globe merges them below FLAT_FROM), screen-composed at dpr 2 over each globe's own colours with land
// everywhere as bright as look A's brightest blue (the brightest ground there is, so the model errs towards white;
// whitemodel.ts). The selected place is Berlin, as in the e2e views. A pixel is white, as in e2e/pixels.ts, when all
// three channels are at least 215; the model's alarm sits above that by its calibrated overestimate (BOUND).
// Measured on the data of 2026-09-27 (3,336 places) with LIGHT_MERGE = 1: WebGL 213.4 at most, at the limb (Europe edge-on
// from Korea, z 2; the browser draws 201 there); Canvas 2D 219.1 (Europe, z 2.4; the browser draws 206). With LIGHT_LIMB
// at look A's 0.3 and the selected light always at 1, the WebGL globe gave 245 (the limb in the Brazil view).

// The model's alarm per globe, calibrated against the browser on 2026-10-18 (data of 2026-09-27, 3,336 places;
// LIGHT_MERGE = 1; headless Chrome on Apple silicon). Rule: 215 + the smallest overestimate (model − browser, the whitest
// pixel's smallest channel each) measured at the cameras of this test (VIEWS × NUDGES), rounded down. So every camera at
// which the browser draws white trips the model, as long as no overestimate falls below the smallest one measured; it
// does fall as the picture brightens (Europe at z 2.4, WebGL: 17–19 today, 9–10 where the browser turns white).
//   WebGL: smallest 2.1 (Europe edge-on from the west, −0.2/−0.1; there the browser's whitest px is the sunlit rim),
//     so 217; the model reaches 213.4 today (margin 3.6).
//   Canvas 2D: smallest 3.6 (Europe edge-on from the west, 0.2/0.1, a light at the limb), so 218. The model reaches
//     218.4–219.1 today at Europe z 2.4 (0.2/−0.1, −0.2/0.1) and London z 2.2 (0/0), where the browser draws 205–206: no
//     single bound is quiet today and still catches every white, so the data cases warn there (expected) and the real
//     browser decides (ruled 2026-10-18; calibration.md).
// Table: .superpowers/sdd/2026-10-16-skywave-glowing-globe/calibration.md (private). Re-measure after a look or model
// change, or when the nightly warns: `PW_CHANNEL=chrome pnpm exec playwright test -c playwright.calibrate.config.ts`
// writes test-results/white-calibration-{gl,2d}.md (the rule's bound per globe) and -{gl,2d}-brightened.md (the trip
// test's cameras); set BOUND from the first, WHITE_CAMS and BRIGHTEN_K (whitemodel.ts) from the second.
const BOUND = { gl: 217, '2d': 218 };

// The trip test's cameras: where the browser draws white (≥ 215) on brighten(places, BRIGHTEN_K) (2026-10-18,
// calibration.md). WebGL, k 5: 215, 216 and 215; Canvas 2D, k 1.5: 217, 218, 218, 215, 217, 216 and 218.
const WHITE_CAMS: Record<'gl' | '2d', [string, number, number, number][]> = {
  gl: [['Europe', 2.4, -0.2, 0.1], ['Europe', 2.4, 0.2, 0.1], ['London', 2.2, 0.2, -0.1]],
  '2d': [
    ['Europe', 2.4, -0.2, -0.1], ['Europe', 2.4, 0.2, -0.1], ['Europe', 2.4, -0.2, 0.1], ['Europe', 2.4, 0.2, 0.1],
    ['London', 2.2, 0, 0], ['London', 2.2, 0.2, -0.1], ['London', 2.2, 0.2, 0.1],
  ],
};

const GLOBES = [['gl', 'WebGL'], ['2d', 'Canvas 2D']] as const;

/**
 * The model's report on one globe: in the test output always, and in GitHub Actions also as a ::warning:: line when a
 * camera reaches the alarm. Never a failure: the real browser decides (pages.yml).
 */
function advise(globe: string, bound: number, top: { v: number; at: string }, over: string[]): void {
  const n = VIEWS.length * NUDGES.length;
  const text = `${globe} globe: at most ${top.v.toFixed(1)} (${top.at}), the alarm from ${bound}; `
    + (over.length ? `at or over it at ${over.length} of ${n} cameras: ${over.join('; ')}` : 'quiet');
  console.log(`white model (advisory), ${text}`);
  if (over.length && process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::warning title=White model (advisory)::${text}. An early warning only: the browser's white check decides.`);
  }
}

describe('the white model on the real places (dist/data/places.json): an early warning, never a failure', () => {
  for (const [mode, globe] of GLOBES) {
    it(`on the ${globe} globe, face on and edge-on at the limb`, async () => {
      const P = await places(), berlin = P.name.indexOf('Berlin'), L: Lights = { data: new Float32Array(0), n: 0 };
      expect(P.n).toBeGreaterThan(1000);
      expect(berlin).toBeGreaterThanOrEqual(0);
      const over: string[] = [];
      let top = { v: -1, at: '' };
      for (const [name, lon, lat, z] of VIEWS) {
        for (const [dl, db] of NUDGES) {
          const w = modelWhitest(P, berlin, { lon: lon + dl, lat: lat + db, z }, mode === '2d', L);
          const at = `${name} at z ${z} (${dl}, ${db})`;
          if (w.v > top.v) top = { v: w.v, at };
          if (w.v >= BOUND[mode]) over.push(`${at} ${w.v.toFixed(1)} at (${w.x}, ${w.y})`);
        }
      }
      advise(globe, BOUND[mode], top, over);
    }, 120000);
  }
});

describe('the calibrated check trips where a brightening turns the browser white', () => {
  for (const [mode, globe] of GLOBES) {
    it(`on the ${globe} globe: the Netherlands and its neighbours at ${BRIGHTEN_K[mode]}× their stations`, async () => {
      const P = await places(brighten(readFileSync(PLACES), BRIGHTEN_K[mode])), berlin = P.name.indexOf('Berlin');
      for (const [name, z, dl, db] of WHITE_CAMS[mode]) {
        const [, lon, lat] = VIEWS.find(v => v[0] === name && v[3] === z)!;
        const w = modelWhitest(P, berlin, { lon: lon + dl, lat: lat + db, z }, mode === '2d');
        expect(w.v, `${name} at z ${z} (${dl}, ${db}): min channel ${w.v.toFixed(1)}, the alarm from ${BOUND[mode]}`)
          .toBeGreaterThanOrEqual(BOUND[mode]);
      }
    }, 120000);
  }
});
