import {
  GLOBE_BELOW_ZOOM, LIGHT_CAP, LIGHT_CELL, LIGHT_DOT, LIGHT_FAINT, LIGHT_FAINT_SIZE, LIGHT_LIMB, LIGHT_MAX, LIGHT_MERGE,
  LIGHT_SPRITE,
} from '../config';
import { globeEase } from '../geo/mercator';
import { smoothstep } from '../geo/sphere';
import { clusterScreen, minCountForZoom, type ScreenDot } from './lod';

/** Lights to draw, 4 floats per light: x, y (CSS px), size (CSS px across) and level 0–1; the first n are in use. */
export interface Lights { data: Float32Array; n: number }

type RGB = [number, number, number];

/**
 * Look A's light at r2 = 4·|d|² from the sprite centre (d in sprite widths): a pale-gold core in a faint orange halo,
 * black from r2 = 1 on.
 */
export function glowAt(r2: number): RGB {
  const core = Math.exp(-28 * r2), halo = 0.1 * Math.exp(-4 * r2), k = Math.max(1 - r2, 0);
  return [core + 0.85 * halo, 0.74 * core + 0.45 * halo, 0.36 * core + 0.12 * halo].map(v => Math.min(1, v * k)) as RGB;
}

/** The glow as an opaque px×px RGBA sprite, black outside its circle (which `screen` leaves as it is). */
export function glowPixels(px = LIGHT_SPRITE): Uint8ClampedArray<ArrayBuffer> {
  const p = new Uint8ClampedArray(px * px * 4);
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const dx = (x + 0.5) / px - 0.5, dy = (y + 0.5) / px - 0.5, c = glowAt(4 * (dx * dx + dy * dy)), o = 4 * (y * px + x);
      p[o] = 255 * c[0];
      p[o + 1] = 255 * c[1];
      p[o + 2] = 255 * c[2];
      p[o + 3] = 255;
    }
  }
  return p;
}

/** The glow sprite as ImageData (browser only). */
export const glowSprite = (px = LIGHT_SPRITE): ImageData => new ImageData(glowPixels(px), px);

/** Size of a light in CSS px across, as in look A: it grows with the globe radius R (CSS px; Infinity on tiles) up to √3. */
export function lightSize(count: number, R: number): number {
  return Math.min(LIGHT_MAX, (3 + 1.6 * Math.sqrt(count)) * Math.sqrt(Math.min(3, Math.max(1, R / 100))));
}

/** How much of a light shows at its depth on the globe (1 facing the viewer, 0 at the limb; LIGHT_LIMB). */
export const limbFade = (depth = 1): number => smoothstep(0, LIGHT_LIMB, depth);

/** Level of a light, as in look A: by station count, faded towards the limb by its depth on the globe (1 facing the viewer). */
export function lightLevel(count: number, depth = 1): number {
  return Math.min(1, limbFade(depth) * (0.35 + 0.12 * Math.log2(1 + count)));
}

// Scratch for the cell grid of merge and cap, reused from frame to frame: cells maps a cell's key to its slot.
const cells = new Map<number, number>();
const picked = new Set<number>();
let A = new Float64Array(0);   // 4 per slot: merge sums (level, level·x, level·y, count); cap (level sum, key, scale)
let slot = new Int32Array(0);  // per light: its cell's slot

/** Key of the cell (s px) at x, y; the cell (gx + ox, gy + oy) has key + ox·65536 + oy. */
const cellKey = (x: number, y: number, s: number) => Math.floor(x / s) * 65536 + Math.floor(y / s);

/** The slot of key's cell; a new, zeroed slot m when the cell has none yet (m is the number of slots in use). */
function cellSlot(key: number, m: number): number {
  let s = cells.get(key);
  if (s === undefined) {
    cells.set(key, (s = m));
    A.fill(0, 4 * s, 4 * s + 4);
  }
  return s;
}

/** The brightness cap of one layer: scales each light from…to by min(1, c / the summed level of its 3×3 cells of `cell` px). */
function cap(L: Float32Array, from: number, to: number, c: number, cell: number): void {
  cells.clear();
  let m = 0;
  for (let k = from; k < to; k++) {
    const key = cellKey(L[4 * k], L[4 * k + 1], cell), s = cellSlot(key, m);
    if (s === m) { A[4 * s + 1] = key; m++; }
    A[4 * s] += L[4 * k + 3];
    slot[k] = s;
  }
  for (let s = 0; s < m; s++) {
    let t = 0;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const q = cells.get(A[4 * s + 1] + ox * 65536 + oy);
        if (q !== undefined) t += A[4 * q];
      }
    }
    A[4 * s + 2] = t > c ? c / t : 1;
  }
  for (let k = from; k < to; k++) L[4 * k + 3] *= A[4 * slot[k] + 2];
}

/**
 * The lights of a frame. `all` is every place in view, `picks` the view's dots (cluster hosts with their summed counts,
 * and the selected place `current`). In order: faint, each place of `all` that is no pick, at its own count, LIGHT_FAINT
 * of its level and LIGHT_FAINT_SIZE of its size, but never larger than a place with `min` stations (the fewest a
 * catchable place has: minCountForZoom); golden, each pick but the selected place, at its cluster count; the selected
 * place last, at level 1 faded towards the limb as every light is (limbFade: 1 under the ring). Each layer is capped
 * around any point (LIGHT_CAP): the faint one within LIGHT_DOT px, so a dense region glows as in look A while lights
 * stacked on one spot sum to at most LIGHT_CAP[0], the golden one on a grid of `cell` px (the globe's LIGHT_CELL ·
 * globeEase: the same places per cap window at every zoom, as the cluster cell). With
 * `merge`, the faint lights of each LIGHT_MERGE cell first become one, at their level-weighted centroid, sized from
 * their summed count, at their summed level. R is the globe radius in CSS px (Infinity on tiles). Reuses `out` and grows its
 * data only when needed.
 */
export function buildLights(
  all: ScreenDot[], picks: ScreenDot[], current: number, R: number,
  out: Lights = { data: new Float32Array(0), n: 0 }, merge = false, cell = LIGHT_CELL, min = Infinity,
): Lights {
  const most = all.length + picks.length;
  if (out.data.length < 4 * most) out.data = new Float32Array(8 * most);
  if (slot.length < most) { slot = new Int32Array(2 * most); A = new Float64Array(8 * most); }
  const L = out.data;
  let n = 0;
  const put = (x: number, y: number, size: number, level: number) => {
    L[4 * n] = x; L[4 * n + 1] = y; L[4 * n + 2] = size; L[4 * n + 3] = level;
    n++;
  };
  const faintSize = (count: number) => Math.min(LIGHT_FAINT_SIZE * lightSize(count, R), lightSize(min, R));
  picked.clear();
  for (const d of picks) picked.add(d.i);
  if (merge) {
    cells.clear();
    let m = 0;
    for (const d of all) {
      if (picked.has(d.i)) continue;
      const s = cellSlot(cellKey(d.x, d.y, LIGHT_MERGE), m), l = lightLevel(d.count, d.z) * LIGHT_FAINT;
      if (s === m) m++;
      A[4 * s] += l; A[4 * s + 1] += l * d.x; A[4 * s + 2] += l * d.y; A[4 * s + 3] += d.count;
    }
    for (let s = 0; s < m; s++) {
      const l = A[4 * s];
      if (l > 0) put(A[4 * s + 1] / l, A[4 * s + 2] / l, faintSize(A[4 * s + 3]), l);
    }
  } else {
    for (const d of all) if (!picked.has(d.i)) put(d.x, d.y, faintSize(d.count), lightLevel(d.count, d.z) * LIGHT_FAINT);
  }
  const faint = n;
  let sel: ScreenDot | undefined;
  for (const d of picks) {
    if (d.i === current) sel = d;
    else put(d.x, d.y, lightSize(d.count, R), lightLevel(d.count, d.z));
  }
  cap(L, 0, faint, LIGHT_CAP[0], LIGHT_DOT / 3);
  cap(L, faint, n, LIGHT_CAP[1], cell);
  if (sel) put(sel.x, sel.y, lightSize(sel.count, R), limbFade(sel.z));
  out.n = n;
  return out;
}

/**
 * The light pipeline of every frame, the WebGL probe's too: the dots at zoom z (the places the ring can catch, those
 * with minCountForZoom(z) stations but cur, clustered on 10 px · globeEase on the globe, eased smaller than the Mercator
 * scale below zoom 4, and 22 px on tiles; then `selected`), and the lights of `all` into `out`, the golden cap's cell
 * eased with the cluster cell (as many places per cap window at every zoom; globeEase is 1 from zoom 4, on tiles).
 * Returns the dots.
 */
export function lightUp(all: ScreenDot[], selected: ScreenDot[], cur: number, z: number, R: number, merge: boolean, out: Lights): ScreenDot[] {
  const k = globeEase(z), min = minCountForZoom(z);
  const dots = [...clusterScreen(all.filter(d => d.i !== cur && d.count >= min), z < GLOBE_BELOW_ZOOM ? 10 * k : 22), ...selected];
  buildLights(all, dots, cur, R, out, merge, LIGHT_CELL * k, min);
  return dots;
}

/**
 * Draws the lights with `screen` (never `lighter`): screen at alpha g is screen with the sprite scaled by g, as the WebGL
 * pass blends. Leaves the transform at dpr, source-over and alpha 1.
 */
export function drawLights(ctx: CanvasRenderingContext2D, L: Lights, sprite: CanvasImageSource, dpr: number): void {
  const d = L.data;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalCompositeOperation = 'screen';
  for (let k = 0; k < L.n; k++) {
    const a = d[4 * k + 3], s = d[4 * k + 2];
    if (a < 0.002) continue;   // under half a level even at the core
    ctx.globalAlpha = a;
    ctx.drawImage(sprite, d[4 * k] - s / 2, d[4 * k + 1] - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}
