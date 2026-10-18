import { expect, test, type Page } from '@playwright/test';
import { wrapLon } from '../src/geo/sphere';
import { offline } from './net';
import { bare, look, needWebGl, onePlace, rampTexture, shot, type Img } from './pixels';

// The mediump globe shader against the highp one. The r1's PowerVR may lack highp in fragment shaders; ANGLE's
// --emulate-shader-precision rounds every mediump result to fp16 as such a GPU computes it. Every shot is on the smooth
// ramp texture, so a difference is shader math, not texture detail. The spike's tilt is dropped, so the close views at
// z 3.9 fill the 240×292 frame and show no limb: the limb is checked at z 2.0, where it is largest on screen (R ≈ 126
// px), its arcs above and below the centre.

test.use({ launchOptions: { args: ['--mute-audio', '--emulate-shader-precision'] } });   // ANGLE rounds mediump to fp16

test.beforeEach(async ({ page }) => {
  await needWebGl(page);
  await offline(page);
  // The canary: (1 + 1/4096) − 1 in mediump is 1/4096 in fp32 (red 255) and 0 in fp16, where 1 + 1/4096 rounds to 1.
  // u is a uniform, so nothing folds it at compile time.
  const red = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const gl = c.getContext('webgl')!, p = gl.createProgram()!;
    for (const [type, src] of [
      [gl.VERTEX_SHADER, 'attribute vec2 A;void main(){gl_Position=vec4(A,0.,1.);}'],
      [gl.FRAGMENT_SHADER, 'precision mediump float;uniform float u;void main(){gl_FragColor=vec4(((1.+u)-1.)*4096.,0.,0.,1.);}'],
    ] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'A');
    gl.linkProgram(p);
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(gl.getUniformLocation(p, 'u'), 1 / 4096);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px[0];
  });
  test.skip(red >= 200, 'mediump not emulated: --emulate-shader-precision has no effect on this ANGLE backend, so this run says nothing about fp16');
  expect(red, 'canary: fp16 gives red ≤ 20').toBeLessThanOrEqual(20);
});

const VIEWS = [
  { name: 'seam at ±180°', lon: 180, lat: 10, z: 1.6, limb: true, seam: true },
  { name: 'north pole', lon: 0, lat: 85, z: 1.6 },
  { name: 'south pole', lon: 0, lat: -85, z: 1.6 },
  { name: 'limb', lon: 0, lat: 0, z: 2.0, limb: true },
  { name: 'close view, north', lon: 0, lat: 85, z: 3.9 },
  { name: 'close view, Europe', lon: 10, lat: 48, z: 3.9 },
];
type View = (typeof VIEWS)[number];
const W = 480, H = 584;   // device px

/** A fresh load at ?globe=<mode>, the only place at the view's antipode (no light in view), shot and attached. */
async function globeShot(page: Page, mode: 'gl' | 'mediump', v: View): Promise<{ img: Img; R: number }> {
  await onePlace(page, wrapLon(v.lon + 180), -v.lat);
  await page.goto(`/?globe=${mode}`);
  await page.waitForFunction(() => (window as any).__view?.gl);
  await bare(page);
  await look(page, { lon: v.lon, lat: v.lat, z: v.z });
  return { img: await shot(page, `${v.name}, ${mode}`), R: await page.evaluate(() => (window as any).__view.gl.R) };
}

/** CSS distance of device pixel (x, y) from the view's centre. */
const dist = (x: number, y: number) => Math.hypot((x + 0.5) / 2 - 120, (y + 0.5) / 2 - 146);

/** The share of the device pixels `inside` admits that are within 12 levels of b in every channel. */
function agree(a: Img, b: Img, inside: (x: number, y: number) => boolean): { share: number; n: number } {
  let n = 0, ok = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      const o = 4 * (y * W + x);
      n++;
      if (Math.abs(a.d[o] - b.d[o]) <= 12 && Math.abs(a.d[o + 1] - b.d[o + 1]) <= 12 && Math.abs(a.d[o + 2] - b.d[o + 2]) <= 12) ok++;
    }
  }
  return { share: n ? ok / n : 1, n };
}

/** Inside radius r (CSS px): pixels near black (R + G + B < 10), and specks (a channel > 64 from its 3×3 median). */
function flaws(img: Img, r: number): { black: number; specks: number } {
  let black = 0, specks = 0;
  const nb = new Array<number>(9);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (dist(x, y) > r) continue;
      const o = 4 * (y * W + x);
      if (img.d[o] + img.d[o + 1] + img.d[o + 2] < 10) black++;
      for (let c = 0; c < 3; c++) {
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) nb[k++] = img.d[o + 4 * (dy * W + dx) + c];
        nb.sort((p, q) => p - q);
        if (Math.abs(img.d[o + c] - nb[4]) > 64) { specks++; break; }
      }
    }
  }
  return { black, specks };
}

/** The largest per-channel difference between a device column's mean (over rows inside radius r) and its neighbours'. */
function seamStep(img: Img, r: number, x: number): number {
  const col = (cx: number) => {
    const s = [0, 0, 0];
    let n = 0;
    for (let y = 0; y < H; y++) {
      if (dist(x, y) > r) continue;
      for (let c = 0; c < 3; c++) s[c] += img.d[4 * (y * W + cx) + c];
      n++;
    }
    return s.map(v => v / n);
  };
  const m = col(x), l = col(x - 1), rr = col(x + 1);
  return Math.max(...m.map((v, c) => Math.abs(v - (l[c] + rr[c]) / 2)));
}

test('?globe=mediump matches ?globe=gl: no specks, black pixels, seam or stepped limb at the poles, ±180°, the limb and the close view', async ({ page }) => {
  test.setTimeout(180000);
  await rampTexture(page);
  for (const v of VIEWS) {
    const hi = await globeShot(page, 'gl', v), lo = await globeShot(page, 'mediump', v), R = hi.R;
    const frame = agree(lo.img, hi.img, () => true);
    test.info().annotations.push({ type: v.name, description: `R ${R.toFixed(1)}, frame ${(100 * frame.share).toFixed(2)} %` });
    expect(frame.share, `${v.name}: whole frame within 12 levels`).toBeGreaterThanOrEqual(0.995);
    if (v.limb) {
      const limb = agree(lo.img, hi.img, (x, y) => Math.abs(dist(x, y) - R) <= 6);
      test.info().annotations.push({ type: `${v.name}, limb`, description: `${limb.n} px, ${(100 * limb.share).toFixed(2)} %` });
      expect(limb.n, `${v.name}: the limb is on screen`).toBeGreaterThan(0);
      expect(limb.share, `${v.name}: limb annulus within 12 levels`).toBeGreaterThanOrEqual(0.995);
    }
    for (const [mode, s] of [['gl', hi], ['mediump', lo]] as const) {
      expect(flaws(s.img, R - 2), `${v.name}, ${mode}: black pixels and specks on the disc`).toEqual({ black: 0, specks: 0 });
      if (!v.seam) continue;
      // The seam lies on the centre line, device x 239 | 240; each column near it against its two neighbours.
      for (let x = 236; x <= 244; x++) expect(seamStep(s.img, R - 2, x), `${v.name}, ${mode}: column ${x}`).toBeLessThanOrEqual(6);
    }
  }
});
