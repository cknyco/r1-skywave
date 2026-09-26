import { describe, expect, it } from 'vitest';
import { IMAGERY_DIM } from '../../src/config';
import type { Places } from '../../src/data/store';
import { worldSize } from '../../src/geo/mercator';
import { RAD } from '../../src/geo/sphere';
import { Globe } from '../../src/map/globe';

const BG = 0xff0d0806;                       // #06080d as little-endian RGBA
const tex = new Uint32Array(8 * 4).fill(0xff804020);   // r=0x20 g=0x40 b=0x80

const places = (pts: [number, number][]): Places => ({
  v: 't', n: pts.length,
  lon: Float32Array.from(pts.map(p => p[0])), lat: Float32Array.from(pts.map(p => p[1])),
  count: Uint16Array.from(pts.map(() => 3)), name: pts.map((_, i) => `p${i}`), cc: pts.map(() => 'DE'), tz: pts.map(() => ''),
});

describe('Globe', () => {
  it('sizes the disc to the Mercator scale at the centre latitude', () => {
    const g = new Globe(tex, 8, 4, 240, 292);
    g.setZoom(2, 0);
    expect(g.R).toBe(Math.round(worldSize(2) / (2 * Math.PI)));
    g.setZoom(2, 60);
    expect(g.R).toBe(Math.round(worldSize(2) / (2 * Math.PI * 0.5)));
  });

  it('renders a dimmed disc into a buffer of the given size, background outside', () => {
    const w = 240, h = 292, g = new Globe(tex, 8, 4, w, h);
    g.setZoom(1.4, 0);
    const buf = new Uint32Array(w * h);
    g.renderLand(buf, 0, 0);
    expect(buf[0]).toBe(BG);
    expect(buf[w * h - 1]).toBe(BG);
    expect(buf[5 * w + w / 2]).toBe(BG);                 // above the disc: R < h/2
    const s = (256 * IMAGERY_DIM) | 0;                    // shading at the disc centre (normal z = 1)
    const mid = buf[(h / 2) * w + w / 2];
    expect(mid & 255).toBe((0x20 * s) >> 8);
    expect((mid >>> 8) & 255).toBe((0x40 * s) >> 8);
    expect((mid >>> 16) & 255).toBe((0x80 * s) >> 8);
    expect(mid >>> 24).toBe(255);
  });

  it('projects the centre place to the middle of the screen and hides the far side', () => {
    const g = new Globe(tex, 8, 4, 240, 292);
    g.setZoom(2, 50);
    const dots = g.project(places([[10, 50], [-170, -50], [10, 40]]), () => true, 10, 50);
    expect(dots.map(d => d.i)).toEqual([0, 2]);
    expect(dots[0].x).toBeCloseTo(120, 6);
    expect(dots[0].y).toBeCloseTo(146, 6);
    expect(dots[1].y).toBeGreaterThan(146);              // south is down
  });

  it('skips places the filter rejects', () => {
    const g = new Globe(tex, 8, 4, 240, 292);
    g.setZoom(2, 0);
    expect(g.project(places([[0, 0], [5, 5]]), i => i === 1, 0, 0).map(d => d.i)).toEqual([1]);
  });

  it('matches a straightforward per-pixel orthographic render within rounding', () => {
    const TW = 256, TH = 128, w = 240, h = 292;
    const smooth = new Uint32Array(TW * TH);                // gentle ramps (wrapping in u), so one texel off stays small
    for (let v = 0; v < TH; v++) {
      for (let u = 0; u < TW; u++) smooth[v * TW + u] = 0xff000000 | (64 << 16) | ((v * 2) << 8) | Math.min(255, 2 * Math.min(u, TW - u));
    }
    const g = new Globe(smooth, TW, TH, w, h), buf = new Uint32Array(w * h), ref = new Uint32Array(w * h);
    for (const [z, lon, lat] of [[1.4, 0, 0], [2.3, 13.4, 52.5], [3.2, -120, -33.25], [3.9, 170, 71]]) {
      g.setZoom(z, lat);
      g.renderLand(buf, lon, lat);
      reference(smooth, TW, TH, w, h, g.R, lon, lat, ref);
      let edge = 0, worst = 0;
      for (let i = 0; i < w * h; i++) {
        if ((buf[i] === BG) !== (ref[i] === BG)) edge++;     // a pixel inside one disc but not the other
        for (const sh of [0, 8, 16]) worst = Math.max(worst, Math.abs(((buf[i] >>> sh) & 255) - ((ref[i] >>> sh) & 255)));
      }
      expect(edge).toBe(0);
      expect(worst).toBeLessThanOrEqual(3);
    }
  });

  it('keeps the centre column exact on an odd width, where a row has a middle pixel with no mirror partner', () => {
    const TW = 256, TH = 128, w = 241, h = 292;
    const stripe = new Uint32Array(TW * TH).fill(0xff000000);   // black, except texture column TW/2 (longitude 0)
    for (let v = 0; v < TH; v++) stripe[v * TW + TW / 2] = 0xffffffff;
    const g = new Globe(stripe, TW, TH, w, h), buf = new Uint32Array(w * h);
    g.setZoom(1.4, 0);
    g.renderLand(buf, 0, 0);
    let disc = 0, dark = 0;
    for (let y = 0; y < h; y++) {
      const c = buf[y * w + (w - 1) / 2];
      if (c === BG) continue;
      disc++;
      if ((c & 255) === 0) dark++;
    }
    expect(disc).toBeGreaterThan(100);
    expect(dark).toBe(0);
  });
});

/** The unoptimised renderer: per pixel, inverse orthographic projection, texture lookup, limb shading. */
function reference(tex: Uint32Array, TW: number, TH: number, w: number, h: number, R: number, lon: number, lat: number, out: Uint32Array) {
  const p = (Math.round(lat * 4) / 4) * RAD, cp = Math.cos(p), sp = Math.sin(p), du = Math.round((lon / 360) * TW);
  out.fill(BG);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / R, dy = (h / 2 - y - 0.5) / R, q = dx * dx + dy * dy;
      if (q >= 1) continue;
      const nz = Math.sqrt(1 - q), vy = cp * dy + sp * nz, vz = -sp * dy + cp * nz;
      const u = ((Math.atan2(dx, vz) / Math.PI + 1) * 0.5 * TW) | 0;
      const v = Math.min(TH - 1, ((0.5 - Math.asin(Math.max(-1, Math.min(1, vy))) / Math.PI) * TH) | 0);
      const c = tex[v * TW + ((u + du) & (TW - 1))], s = (256 * IMAGERY_DIM * (0.35 + 0.65 * Math.pow(nz, 0.6))) | 0;
      out[y * w + x] = 0xff000000 | ((((c >>> 16) & 255) * s >> 8) << 16) | ((((c >>> 8) & 255) * s >> 8) << 8) | (((c & 255) * s) >> 8);
    }
  }
}
