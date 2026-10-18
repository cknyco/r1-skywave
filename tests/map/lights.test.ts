import { describe, expect, it } from 'vitest';
import { LIGHT_CAP, LIGHT_DOT, LIGHT_FAINT, LIGHT_FAINT_SIZE, LIGHT_LIMB, LIGHT_MERGE } from '../../src/config';
import { buildLights, glowAt, glowPixels, lightLevel, lightSize, limbFade, type Lights } from '../../src/map/lights';
import { minCountForZoom, type ScreenDot } from '../../src/map/lod';

const dot = (i: number, x: number, y: number, count: number, z?: number): ScreenDot => ({ i, x, y, count, z });
/** The colour (0–255 per channel) of lights L composed with `screen` over bg (0–1) at the point (x, y), as both globes blend. */
const composed = (L: Lights, bg: number[], x: number, y: number) => [0, 1, 2].map(ch => {
  let k = 1 - bg[ch];
  for (let j = 0; j < L.n; j++) {
    const d = L.data, dx = (d[4 * j] - x) / d[4 * j + 2], dy = (d[4 * j + 1] - y) / d[4 * j + 2];
    if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5) k *= 1 - d[4 * j + 3] * glowAt(4 * (dx * dx + dy * dy))[ch];
  }
  return 255 * (1 - k);
});
const BRIGHTEST_BLUE = [0.17, 0.25, 0.39];   // look A's brightest blue on the globe

describe('lights', () => {
  it('lightSize follows look A and grows with the globe radius up to √3', () => {
    expect(lightSize(1, 50)).toBeCloseTo(4.6, 6);
    expect(lightSize(20, 100)).toBeCloseTo(3 + 1.6 * Math.sqrt(20), 6);
    expect(lightSize(20, 200)).toBeCloseTo((3 + 1.6 * Math.sqrt(20)) * Math.SQRT2, 6);
    expect(lightSize(20, Infinity)).toBeCloseTo((3 + 1.6 * Math.sqrt(20)) * Math.sqrt(3), 6);
    expect(lightSize(5000, Infinity)).toBe(30);
  });

  it('lightLevel follows look A, fades over the last LIGHT_LIMB of depth towards the limb and stops at 1', () => {
    expect(lightLevel(1)).toBeCloseTo(0.47, 6);
    expect(lightLevel(20)).toBeCloseTo(0.35 + 0.12 * Math.log2(21), 6);
    expect(lightLevel(1000)).toBe(1);
    expect(lightLevel(20, 0)).toBe(0);
    expect(lightLevel(20, LIGHT_LIMB / 2)).toBeCloseTo(lightLevel(20) / 2, 6);
    expect(lightLevel(20, LIGHT_LIMB)).toBe(lightLevel(20));
    expect(limbFade(0.8)).toBe(1);   // a face (depth over 0.8, Europe in look A's view) is not faded
  });

  it('the glow is a pale-gold core in an orange halo, black at the rim', () => {
    const c = glowAt(0);
    expect(c[0]).toBe(1); expect(c[1]).toBeCloseTo(0.785, 3); expect(c[2]).toBeCloseTo(0.372, 3);
    expect(glowAt(1)).toEqual([0, 0, 0]);
    const p = glowPixels(64), mid = (32 * 64 + 32) * 4;
    expect(p.length).toBe(64 * 64 * 4);
    expect(Array.from(p.subarray(0, 4))).toEqual([0, 0, 0, 255]);
    expect(p[mid]).toBeGreaterThanOrEqual(250); expect(p[mid + 2]).toBeLessThan(p[mid + 1]);
  });

  it('buildLights: faint for places the ring cannot catch, golden for picks, the selected place last at level 1', () => {
    const all = [dot(0, 10, 10, 1), dot(1, 50, 50, 20), dot(2, 120, 146, 8)];
    const picks = [dot(1, 50, 50, 25), dot(2, 120, 146, 8)];   // 1: a cluster host with its summed count; 2: selected
    const L = buildLights(all, picks, 2, Infinity);
    expect(L.n).toBe(3);
    expect(Array.from(L.data.subarray(0, 12))).toEqual([
      10, 10, LIGHT_FAINT_SIZE * lightSize(1, Infinity), lightLevel(1) * LIGHT_FAINT,
      50, 50, lightSize(25, Infinity), lightLevel(25),
      120, 146, lightSize(8, Infinity), 1,
    ].map(Math.fround));
  });

  it('buildLights caps the faint layer on any LIGHT_DOT px and the golden one around any point; lone lights stay', () => {
    const sum = (L: Lights) => { let s = 0; for (let k = 0; k < L.n; k++) s += L.data[4 * k + 3]; return s; };
    const onePx = Array.from({ length: 300 }, (_, i) => dot(i, 100 + (i % 5) * 0.06, 100 + (i % 7) * 0.04, 30));
    expect(sum(buildLights(onePx, [], -1, Infinity))).toBeLessThanOrEqual(LIGHT_CAP[0] + 1e-5);
    const spread = Array.from({ length: 300 }, (_, i) => dot(i, 100 + (i % 5), 100 + (i % 7), 30));
    expect(sum(buildLights([], spread, -1, Infinity))).toBeLessThanOrEqual(LIGHT_CAP[1] + 1e-5);
    // Faint lights 2 LIGHT_DOT apart share no cap window: a dense region glows as look A does (each light on its own).
    const apart = buildLights([dot(0, 0, 0, 3), dot(1, 2 * LIGHT_DOT, 0, 3)], [], -1, Infinity);
    expect(apart.data[3]).toBeCloseTo(lightLevel(3) * LIGHT_FAINT, 6);
    expect(apart.data[7]).toBeCloseTo(lightLevel(3) * LIGHT_FAINT, 6);
    const lone = buildLights([dot(0, 0, 0, 30), dot(1, 200, 200, 30)], [], -1, Infinity);
    expect(lone.data[3]).toBeCloseTo(Math.min(LIGHT_CAP[0], lightLevel(30) * LIGHT_FAINT), 6);
  });

  it('the cap window follows `cell`: 20 px apart, two bright lights share a 12 px window but not a 9 px one', () => {
    const two = [dot(0, 0, 0, 1000), dot(1, 20, 0, 1000)];   // level 1 each: 2 together, over LIGHT_CAP[1]
    const at12 = buildLights([], two, -1, Infinity), at9 = buildLights([], two, -1, Infinity, undefined, false, 9);
    expect(at12.data[3]).toBeCloseTo(LIGHT_CAP[1] / 2, 6);
    expect(at9.data[3]).toBe(1);
    expect(at9.data[7]).toBe(1);
  });

  it('merge folds the faint lights of one LIGHT_MERGE cell into one light and leaves golden ones alone', () => {
    const cell = [dot(0, 0.1, 0.1, 2), dot(1, 0.5, 0.3, 3), dot(2, 0.9, 0.9, 5)].map(d => ({ ...d, x: d.x * LIGHT_MERGE, y: d.y * LIGHT_MERGE }));
    const L = buildLights([...cell, dot(3, 100, 100, 1)], [dot(4, 50, 50, 9)], -1, 200, undefined, true);
    expect(L.n).toBe(3);                                                 // merged cell, lone faint light, golden light
    expect(L.data[2]).toBeCloseTo(LIGHT_FAINT_SIZE * lightSize(10, 200), 5);   // sized from the summed count
    expect(L.data[0]).toBeGreaterThan(0.1 * LIGHT_MERGE); expect(L.data[0]).toBeLessThan(0.9 * LIGHT_MERGE);   // inside the cell
  });

  it('a catchable light is clearly brighter than any faint one, and never smaller, at every minCountForZoom band', () => {
    for (const [z, R] of [[1.6, 107], [3, 400], [4.5, Infinity]]) {
      const min = minCountForZoom(z);
      // the faintest golden light (min stations) against the brightest faint one (min − 1 stations, alone)
      const L = buildLights([dot(0, 0, 0, min - 1), dot(1, 100, 100, min)], [dot(1, 100, 100, min)], -1, R, undefined, false, 12, min);
      expect(L.data[7], `z ${z}`).toBeGreaterThanOrEqual(1.3 * L.data[3]);
      expect(L.data[6], `z ${z}`).toBeGreaterThanOrEqual(L.data[2]);
    }
  });

  it('a lone faint light of one station reads golden, not grey, over the globe\'s sea: R > G > B and R − B ≥ 10 at its core', () => {
    const L = buildLights([dot(0, 100, 100, 1)], [], -1, 107);
    const [r, g, b] = composed(L, [12 / 255, 26 / 255, 62 / 255], 100, 100);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r - b).toBeGreaterThanOrEqual(10);
  });

  // What this covers: the faint layer's LIGHT_CAP[0] spread over 300 lights stacked on one pixel (many small lights screen
  // dimmer than one light of the same total), with the golden stack and the selected light, over the disc's blue.
  it('never composes to white: both capped layers and the selected light on one pixel over look A\'s brightest blue', () => {
    const many = Array.from({ length: 300 }, (_, i) => dot(i, 100, 100, 30));
    const L = buildLights(many, [...many.map(d => ({ ...d, i: d.i + 1000 })), dot(9999, 100, 100, 30)], 9999, Infinity);
    const g = glowAt(0), bg = [0.17, 0.25, 0.39];
    const out = [0, 1, 2].map(ch => { let k = 1 - bg[ch]; for (let j = 0; j < L.n; j++) k *= 1 - L.data[4 * j + 3] * g[ch]; return 1 - k; });
    expect(Math.min(...out) * 255).toBeLessThan(215);
  });

  // What this covers: a ⅓ px field of 1-station faint lights with the selected light, without the golden stack. Real data
  // is checked by tests/map/lightsdata.test.ts and the e2e white checks (e2e/white.spec.ts).
  it('never composes to white where faint lights crowd every ⅓ px: a 24 px field at tile size, the selected light on top', () => {
    const field: ScreenDot[] = [];
    for (let x = 88; x <= 112; x += 1 / 3) for (let y = 88; y <= 112; y += 1 / 3) field.push(dot(field.length, x, y, 1));
    const sel = dot(99999, 100, 100, 30), L = buildLights(field, [sel], sel.i, Infinity);
    expect(Math.min(...composed(L, BRIGHTEST_BLUE, 100, 100))).toBeLessThan(215);
  });

  // Ruling F2: the white guarantee for faint lights is empirical (real data: lightsdata.test.ts, e2e/white.spec.ts), not
  // structural. The worst point stack is one faint light that reaches LIGHT_CAP[0] alone (19 stations at LIGHT_FAINT 0.8),
  // under the golden stack and the selected light: 215.5 by this model, a cream core and not a blob, documented here.
  it('documents the worst single-faint stack (cream core below 230)', () => {
    const golden = Array.from({ length: 300 }, (_, i) => dot(1000 + i, 100, 100, 30)), sel = dot(9999, 100, 100, 30);
    const L = buildLights([dot(0, 100, 100, 19), ...golden, sel], [...golden, sel], sel.i, Infinity);
    expect(L.data[3]).toBeCloseTo(LIGHT_CAP[0], 6);   // the one faint light, capped
    const [r, g, b] = composed(L, BRIGHTEST_BLUE, 100, 100);
    expect(Math.min(r, g, b)).toBeLessThan(230);
    expect(r).toBeGreaterThanOrEqual(g);   // cream: warm, not a blue-white glare
    expect(g).toBeGreaterThan(b);
  });

  // Finding A1: towards the limb a light composes over the atmosphere rim, which the globe shader blends in by
  // 0.9·(1 − depth)^2.5 towards its blue-white (0.42, 0.68, 1)·1.1 on the lit side: about (0.41, 0.66, 0.97) at the edge.
  // There the selected light at level 1 composed white (254 measured on the WebGL globe); it now fades with depth as every
  // light does. Stacks at the limb are not bounded here (a full golden cap over the rim would still compose white), so
  // real stacks are checked on real data (lightsdata.test.ts, e2e/white.spec.ts).
  it('the selected light dragged out to the limb stays below white over the bright atmosphere rim', () => {
    const rim = (depth: number) => BRIGHTEST_BLUE.map((c, ch) => Math.min(1, c + 0.9 * (1 - depth) ** 2.5 * ([0.42, 0.68, 1][ch] * 1.1 - c)));
    for (const depth of [0.4, 0.3, 0.2, 0.1, 0.05]) {   // r/R ≈ 0.92 … 0.999
      const sel = dot(9999, 100, 100, 30, depth), L = buildLights([sel], [sel], sel.i, 200);
      expect(Math.min(...composed(L, rim(depth), 100, 100)), `depth ${depth}`).toBeLessThan(215);
    }
    const level1: Lights = { data: Float32Array.of(100, 100, lightSize(30, 200), 1), n: 1 };   // as it was
    expect(Math.min(...composed(level1, rim(0.2), 100, 100))).toBeGreaterThanOrEqual(215);
  });

  it('reuses the list it is given and grows it only when needed', () => {
    const L = buildLights([dot(0, 10, 10, 1)], [], -1, Infinity);
    const data = L.data;
    expect(buildLights([dot(0, 20, 20, 1)], [], -1, Infinity, L)).toBe(L);
    expect(L.data).toBe(data);
    expect(L.n).toBe(1);
    expect(L.data[0]).toBe(20);
    const big = Array.from({ length: 50 }, (_, i) => dot(i, 30 * i, 0, 1));
    buildLights(big, [], -1, Infinity, L);
    expect(L.n).toBe(50);
    expect(L.data.length).toBeGreaterThanOrEqual(200);
  });

  it('fades lights towards the limb by their depth on the globe, the selected one too; facing the viewer it is at 1', () => {
    const L = buildLights([dot(0, 10, 10, 20, 0.15), dot(1, 200, 200, 20, 1)], [dot(1, 200, 200, 20, 1), dot(2, 100, 100, 5, 0.05)], 2, 200);
    expect(L.data[3]).toBeCloseTo(lightLevel(20, 0.15) * LIGHT_FAINT, 6);
    expect(L.data[7]).toBeCloseTo(lightLevel(20), 6);
    expect(L.data[11]).toBeCloseTo(limbFade(0.05), 6);   // a selection dragged out to the limb, over the bright rim
    expect(limbFade(0.05)).toBeLessThan(0.1);
    expect(buildLights([], [dot(2, 120, 146, 5, 0.99)], 2, 200).data[3]).toBe(1);   // under the ring
    expect(buildLights([], [dot(2, 120, 146, 5)], 2, Infinity).data[3]).toBe(1);    // on tiles
  });
});
