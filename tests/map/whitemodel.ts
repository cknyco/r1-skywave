import { readFileSync } from 'node:fs';
import { FLAT_FROM } from '../../src/config';
import { DataStore, type Places } from '../../src/data/store';
import { glFrame, orthoPlaces, type GlFrame } from '../../src/map/gl/frame';
import { glowAt, lightUp, type Lights } from '../../src/map/lights';

// The white model of tests/map/lightsdata.test.ts, shared with its calibration (e2e/calibrate.measure.ts), which measures
// the browser at the same cameras: each view's lights from the app's own pipeline (orthoPlaces, then lightUp as MapView
// draws them, merged as the Canvas 2D globe merges them below FLAT_FROM), screen-composed at dpr 2 over each globe's own
// colours with land everywhere as bright as look A's brightest blue (the brightest ground there is, so the model errs
// towards white). The selected place is Berlin, as in the e2e views.

export const W = 480, H = 584, DPR = 2;
const BRIGHTEST_BLUE = [0.17, 0.25, 0.39];   // look A's brightest blue on the globe
const RIM = [0.42, 0.68, 1];                 // the shader's atmosphere colour (k)
const LIGHT = (() => { const l = Math.hypot(-0.4, 0.55, 0.75); return [-0.4 / l, 0.55 / l, 0.75 / l]; })();
const SUN = (() => { const l = Math.hypot(-0.4, 0.55); return [-0.4 / l, 0.55 / l]; })();

/**
 * The globe's colour (0–1) at every device pixel of the view f, land everywhere as bright as look A's brightest blue:
 * the WebGL globe's shader (shaders.ts: its blue-white rim towards the limb and the glow beyond), or the Canvas 2D
 * globe's (globe.ts: shaded to 35 % at the limb, no rim, dark space).
 */
export function background(f: GlFrame, canvas2d: boolean): Float64Array {
  const out = new Float64Array(3 * W * H), R = f.R * DPR;
  for (let Y = 0; Y < H; Y++) {
    for (let X = 0; X < W; X++) {
      const px = (X + 0.5 - W / 2) / R, py = (H / 2 - Y - 0.5) / R, r = Math.hypot(px, py);
      const z = Math.sqrt(Math.max(1 - r * r, 0)), e = Math.max(r - 1, 0);
      const d = Math.max(px * LIGHT[0] + py * LIGHT[1] + z * LIGHT[2], 0), a = 0.9 * (1 - z) ** 2.5;
      const s = 0.55 + 0.65 * Math.max((px * SUN[0] + py * SUN[1]) / Math.max(r, 0.001), 0), m = Math.exp(-e * 50) + 0.45 * Math.exp(-e * 9);
      const t = Math.min(1, Math.max(0, (1 - r) * R + 0.5));
      for (let ch = 0; ch < 3; ch++) {
        out[3 * (Y * W + X) + ch] = canvas2d
          ? (r < 1 ? BRIGHTEST_BLUE[ch] * (0.35 + 0.65 * z ** 0.6) : [6, 8, 13][ch] / 255)
          : Math.min(1, [0.004, 0.008, 0.022][ch] + RIM[ch] * s * m
            + t * (BRIGHTEST_BLUE[ch] + a * (RIM[ch] * (0.5 + 0.6 * d) - BRIGHTEST_BLUE[ch]) - [0.004, 0.008, 0.022][ch] - RIM[ch] * s * m));
      }
    }
  }
  return out;
}

/** The largest smallest channel (0–255) of the lights L screened over bg, and where (CSS px). */
export function whitest(L: Lights, bg: Float64Array): { v: number; x: number; y: number } {
  const k = Float64Array.from(bg, v => 1 - v), d = L.data;
  for (let q = 0; q < L.n; q++) {
    const X = d[4 * q] * DPR, Y = d[4 * q + 1] * DPR, S = d[4 * q + 2] * DPR, l = d[4 * q + 3];
    for (let py = Math.max(0, Math.ceil(Y - S / 2 - 0.5)); py <= Math.min(H - 1, Math.floor(Y + S / 2 - 0.5)); py++) {
      for (let px = Math.max(0, Math.ceil(X - S / 2 - 0.5)); px <= Math.min(W - 1, Math.floor(X + S / 2 - 0.5)); px++) {
        const dx = (px + 0.5 - X) / S, dy = (py + 0.5 - Y) / S, r2 = 4 * (dx * dx + dy * dy);
        if (r2 >= 1) continue;
        const g = glowAt(r2), o = 3 * (py * W + px);
        for (let ch = 0; ch < 3; ch++) k[o + ch] *= 1 - l * g[ch];
      }
    }
  }
  let best = { v: 0, x: 0, y: 0 };
  for (let o = 0; o < W * H; o++) {
    const v = 255 * (1 - Math.max(k[3 * o], k[3 * o + 1], k[3 * o + 2]));
    if (v > best.v) best = { v, x: (o % W) / DPR, y: Math.floor(o / W) / DPR };
  }
  return best;
}

/** The places.json the build just put in dist/: what the nightly build deploys. */
export const PLACES = 'dist/data/places.json';

/** The places of a places.json body (by default PLACES), as the app loads them. */
export async function places(body: Uint8Array | string = readFileSync(PLACES)): Promise<Places> {
  return new DataStore('', async () => new Response(typeof body === 'string' ? body : new Uint8Array(body))).load();
}

/** The model's whitest pixel at camera cam, Berlin (index berlin) selected, on the Canvas 2D globe or the WebGL one. */
export function modelWhitest(
  P: Places, berlin: number, cam: { lon: number; lat: number; z: number }, canvas2d: boolean,
  L: Lights = { data: new Float32Array(0), n: 0 },
): { v: number; x: number; y: number } {
  const f = glFrame(cam, 240, 292), all = orthoPlaces(P, () => true, f);
  lightUp(all, all.filter(d => d.i === berlin), berlin, cam.z, f.R, canvas2d && cam.z < FLAT_FROM, L);
  return whitest(L, background(f, canvas2d));
}

// The trip test's synthetic brightening (brighten): the Netherlands, Belgium and the Lower Rhine, around the whitest spot
// of Europe at z 2.4 (Amsterdam). BRIGHTEN_K: the smallest k of the sweep 1.25, 1.5, 1.75, 2, 3, 4, 5, 6 at which the
// browser draws a white px over 215 on each globe (2026-10-18, calibration.md): 216 on the WebGL globe at k 5 (212 at
// k 4), 218 on the Canvas 2D globe at k 1.5 (215 at k 1.25, a single px). e2e/calibrate.measure.ts measures the browser
// at these.
export const BRIGHTEN_BOX = { lon: [3, 8], lat: [50.5, 53.5] };
export const BRIGHTEN_K = { gl: 5, '2d': 1.5 };

/**
 * A places.json body with every place in BRIGHTEN_BOX at k times its stations (rounded): its lights brighter, larger and
 * more of them catchable, as if the data grew there.
 */
export function brighten(body: Uint8Array | string, k: number): string {
  const j = JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body));
  j.count = j.count.map((c: number, i: number) => {
    const lon = j.lon[i], lat = j.lat[i];
    const inside = lon >= BRIGHTEN_BOX.lon[0] && lon <= BRIGHTEN_BOX.lon[1] && lat >= BRIGHTEN_BOX.lat[0] && lat <= BRIGHTEN_BOX.lat[1];
    return inside ? Math.round(c * k) : c;
  });
  return JSON.stringify(j);
}

// The densest regions face on (Central Europe, the US east coast, Brazil, Japan and Korea, Mexico), and Europe and the
// US east coast seen edge-on, at the limb over the rim, where 1/depth more lights share each px; each at five cameras
// within 0.2°, as the e2e white checks nudge theirs.
export const VIEWS: [string, number, number, number][] = [
  ['Europe', 10, 48, 1.6], ['Europe', 10, 48, 2.4], ['Europe', 10, 48, 2.8], ['London', 7.9, 51.5, 2.2],
  ['US east coast', -74, 40.7, 2.4], ['Brazil', -38.6, -23.5, 2.2], ['Japan and Korea', 135, 36, 2.4],
  ['Mexico', -99.1, 19.4, 2.4], ['Europe edge-on from Korea', 135, 37.5, 2], ['Europe edge-on from Korea', 135, 37.5, 1.8],
  ['Europe edge-on from the west', -60, 45, 2], ['the US east coast edge-on from the Pacific', -165, 40, 1.8],
];
export const NUDGES = [[0, 0], [-0.2, -0.1], [0.2, -0.1], [-0.2, 0.1], [0.2, 0.1]];
