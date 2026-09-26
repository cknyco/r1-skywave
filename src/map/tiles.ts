import { IMAGERY_DIM } from '../config';
import { type Cam, MAX_LAT, project, TILE, worldSize } from '../geo/mercator';
import { RAD } from '../geo/sphere';
import type { Flight } from './camera';

export interface TileSource {
  url(z: number, x: number, y: number): string;
  maxZ: number;
  attribution: string;
}

/** One tile on screen: wrapped column x, row y, and its rectangle in device pixels. */
export interface TileSpot { x: number; y: number; dx: number; dy: number; dw: number; dh: number }

/** A canvas drawn at scale s ≥ 2 asks for tiles one level deeper, so a tile pixel lands on 1-2 device pixels (Ruling 24). */
export const tileZoom = (z: number, maxZ: number, s: number): number =>
  Math.max(0, Math.min(maxZ, Math.floor(z) + (s >= 2 ? 1 : 0)));

/** Tiles covering a w×h CSS-pixel view drawn at s device pixels per CSS pixel; edges snap to whole device pixels. */
export function visibleTiles(cam: Cam, w: number, h: number, maxZ: number, s = 1): { z: number; spots: TileSpot[] } {
  const zi = tileZoom(cam.z, maxZ, s);
  const k = 2 ** (cam.z - zi) * s, n = 1 << zi;   // device pixels per tile pixel; tiles per row
  const W = Math.round(w * s), H = Math.round(h * s);
  const c = project(cam.lon, cam.lat, zi);
  const x0 = c.x - W / 2 / k, y0 = c.y - H / 2 / k;   // tile-space position of the top-left device pixel
  const ex = (t: number) => Math.round((t * TILE - x0) * k), ey = (t: number) => Math.round((t * TILE - y0) * k);
  const spots: TileSpot[] = [];
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + H / k) / TILE); ty++) {
    if (ty < 0 || ty >= n) continue;
    const top = ey(ty), bottom = ey(ty + 1);
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + W / k) / TILE); tx++) {
      const left = ex(tx);
      spots.push({ x: ((tx % n) + n) % n, y: ty, dx: left, dy: top, dw: ex(tx + 1) - left, dh: bottom - top });
    }
  }
  return { z: zi, spots };
}

/** How long before a flight lands its tiles are requested, to hide the network round trip. */
export const FETCH_LEAD_MS = 250;

/**
 * Whether the tile layer may request tiles now. A far flight (every hop of 2° or more) dips below the zoom of both
 * its ends, to 3.6 or less, and passes over tiles it never shows again, so it draws only cached tiles and loaded
 * parents until its last FETCH_LEAD_MS. A flight whose zoom moves one way requests all the way: a flat hop lands
 * next to what it passes, a zoom in passes over the parents of its landing tiles, and a zoom out over its landing
 * view, whose tiles no deeper cached tile can stand in for.
 */
export function fetchTiles(f: Flight | null, now: number): boolean {
  return !f || f.t0 + f.dur - now <= FETCH_LEAD_MS || f.peakZ >= Math.min(f.from.z, f.to.z);
}

/** For each row of a size×size Web Mercator world, the row of an equirectangular texture th rows high to copy there. */
export function mercatorRows(size: number, th: number): Int32Array {
  const rows = new Int32Array(size);
  for (let y = 0; y < size; y++) {
    const lat = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / size))) / RAD;
    rows[y] = Math.min(th - 1, Math.max(0, Math.floor(((90 - lat) / 180) * th)));
  }
  return rows;
}

/**
 * Ruling 46: the globe's NASA texture (equirectangular, lon -180 at the left edge) reprojected once to a size×size Web
 * Mercator canvas, the ground the tile layer draws under its tiles, so a tile not loaded yet is never black.
 */
export function mercatorBase(tex: Uint32Array, tw: number, th: number, size = 1024): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const out = new Uint32Array(img.data.buffer);
  const rows = mercatorRows(size, th);
  for (let y = 0; y < size; y++) {
    const v = rows[y] * tw, o = y * size;
    for (let x = 0; x < size; x++) out[o + x] = tex[v + (((x + 0.5) * tw / size) | 0)];
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Where the w×h CSS-pixel view at cam lies on a b×b Mercator base, as drawImage arguments (source rectangle in base
 * pixels, then target in device pixels at scale s): one rectangle, or two where the view crosses ±180°; the rows above
 * and below the world (beyond ±85.05°) are left out.
 */
export function underlayRects(cam: Cam, w: number, h: number, s: number, b: number): number[][] {
  const S = worldSize(cam.z), k = b / S;
  const c = project(cam.lon, Math.max(-MAX_LAT, Math.min(MAX_LAT, cam.lat)), cam.z);
  const y0 = c.y - h / 2, top = Math.max(0, y0), bottom = Math.min(S, y0 + h);
  if (bottom <= top) return [];
  const out: number[][] = [];
  let x = (((c.x - w / 2) % S) + S) % S, done = 0;
  while (done < w) {
    const run = Math.min(w - done, S - x);
    out.push([x * k, top * k, run * k, (bottom - top) * k, done * s, (top - y0) * s, run * s, (bottom - top) * s]);
    done += run;
    x = 0;
  }
  return out;
}

export class TileLayer {
  private cache = new Map<string, HTMLImageElement>();
  /** Ruling 46: the ground under the tiles (mercatorBase); null draws the plain dark ground. */
  base: HTMLCanvasElement | null = null;

  constructor(private src: TileSource, private onLoad: () => void, private max = 96) {}

  private get(z: number, x: number, y: number): HTMLImageElement {
    const key = `${z}/${x}/${y}`;
    let img = this.cache.get(key);
    if (img) {
      this.cache.delete(key);
      this.cache.set(key, img);
      return img;
    }
    img = new Image();
    img.onload = () => this.onLoad();
    img.onerror = () => this.onLoad();   // redraw so the upscaled parent shows instead
    img.src = this.src.url(z, x, y);
    this.cache.set(key, img);
    if (this.cache.size > this.max) this.cache.delete(this.cache.keys().next().value!);
    return img;
  }

  private ready(z: number, x: number, y: number): HTMLImageElement | null {
    const img = this.cache.get(`${z}/${x}/${y}`);
    return img && img.complete && img.naturalWidth ? img : null;
  }

  /**
   * Ruling 46: requests the tiles of a view before it shows (a flight's landing, the wheel's next places): at most `cap`
   * tiles not cached yet, nearest the view's centre first. Returns how many it requested.
   */
  prefetch(cam: Cam, w: number, h: number, s = 1, cap = 16): number {
    const { z, spots } = visibleTiles(cam, w, h, this.src.maxZ, s);
    const cx = (w * s) / 2, cy = (h * s) / 2;
    const d = (t: TileSpot) => Math.hypot(t.dx + t.dw / 2 - cx, t.dy + t.dh / 2 - cy);
    let n = 0;
    for (const t of [...spots].sort((a, b) => d(a) - d(b))) {
      if (n >= cap) break;
      if (this.cache.has(`${z}/${t.x}/${t.y}`)) continue;
      this.get(z, t.x, t.y);
      n++;
    }
    return n;
  }

  /**
   * Draws the w×h CSS-pixel view onto a canvas whose backing store is s times that size; leaves the transform at identity.
   * With fetch false no Image is created. A missing tile shows its loaded parent, else the base (Ruling 46), else the
   * dark ground.
   */
  draw(ctx: CanvasRenderingContext2D, cam: Cam, w: number, h: number, s = 1, fetch = true): void {
    const W = Math.round(w * s), H = Math.round(h * s);
    const { z, spots } = visibleTiles(cam, w, h, this.src.maxZ, s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#06080d';
    ctx.fillRect(0, 0, W, H);
    const base = this.base;
    if (base) for (const r of underlayRects(cam, w, h, s, base.width)) ctx.drawImage(base, r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]);
    for (const t of spots) {
      const img = fetch ? this.get(z, t.x, t.y) : this.ready(z, t.x, t.y);
      if (img && img.complete && img.naturalWidth) { ctx.drawImage(img, t.dx, t.dy, t.dw, t.dh); continue; }
      for (let up = 1; up <= 4 && z - up >= 0; up++) {
        const f = 1 << up, parent = this.ready(z - up, t.x >> up, t.y >> up);
        if (!parent) continue;
        const sub = TILE / f;
        ctx.drawImage(parent, (t.x % f) * sub, (t.y % f) * sub, sub, sub, t.dx, t.dy, t.dw, t.dh);
        break;
      }
    }
    if (IMAGERY_DIM < 1) {
      ctx.fillStyle = `rgba(4,6,12,${(1 - IMAGERY_DIM).toFixed(2)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }
}
