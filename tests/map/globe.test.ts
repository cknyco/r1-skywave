import { describe, expect, it } from 'vitest';
import type { Places } from '../../src/data/store';
import { FLAT_FROM } from '../../src/config';
import { flatness, globeRadius, mercY, pxPerRad } from '../../src/geo/mercator';
import { RAD } from '../../src/geo/sphere';
import { Globe } from '../../src/map/globe';
import { tintTexture } from '../../src/map/tint';

const BG = 0xff0d0806;                       // #06080d as little-endian RGBA
const tex = new Uint32Array(8 * 4).fill(0xff804020);   // r=0x20 g=0x40 b=0x80

const places = (pts: [number, number][]): Places => ({
  v: 't', n: pts.length,
  lon: Float32Array.from(pts.map(p => p[0])), lat: Float32Array.from(pts.map(p => p[1])),
  count: Uint16Array.from(pts.map(() => 3)), name: pts.map((_, i) => `p${i}`), cc: pts.map(() => 'DE'), tz: pts.map(() => ''),
});

describe('Globe', () => {
  it('sizes the disc to globeRadius, rounded: the Mercator scale at the centre latitude, eased at low zooms', () => {
    const g = new Globe(tex, 8, 4, 240, 292);
    g.setZoom(2, 0);
    expect(g.R).toBe(Math.round(globeRadius(2, 0)));
    g.setZoom(2, 60);
    expect(g.R).toBe(Math.round(globeRadius(2, 60)));
  });

  it('renders a tinted disc into a buffer of the given size, background outside', () => {
    const w = 240, h = 292, g = new Globe(tex, 8, 4, w, h);
    g.setZoom(1.4, 0);
    const buf = new Uint32Array(w * h);
    g.renderLand(buf, 0, 0);
    expect(buf[0]).toBe(BG);
    expect(buf[w * h - 1]).toBe(BG);
    expect(buf[5 * w + w / 2]).toBe(BG);                 // above the disc: R < h/2
    expect(buf[(h / 2) * w + w / 2]).toBe(tintTexture(tex)[0]);   // shading 256 at the disc centre (normal z = 1)
  });

  it('lets go of the untinted texture once its tinted copy exists (about 8 MB on the r1)', () => {
    const g = new Globe(tex, 8, 4, 240, 292), buf = new Uint32Array(240 * 292);
    g.setZoom(1.4, 0);
    g.renderLand(buf, 0, 0);
    expect((g as unknown as { tex?: Uint32Array }).tex).toBeUndefined();
    const first = buf.slice();
    g.renderLand(buf, 0, 0);   // later frames draw from the tinted copy alone
    expect(buf).toEqual(first);
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

  it('gives each place its depth: 1 facing the viewer, towards 0 at the limb', () => {
    const g = new Globe(tex, 8, 4, 240, 292);
    g.setZoom(1.4, 0);
    const dots = g.project(places([[0, 0], [30, 0], [80, 0]]), () => true, 0, 0);
    expect(dots.map(d => d.i)).toEqual([0, 1, 2]);
    expect(dots[0].z).toBeCloseTo(1, 6);
    expect(dots[1].z).toBeCloseTo(Math.cos(30 * RAD), 6);
    expect(dots[2].z).toBeGreaterThan(0);
    expect(dots[2].z).toBeLessThan(dots[1].z!);
  });

  it('keeps lights just off the edge: a 16 px margin around the view', () => {
    const g = new Globe(tex, 8, 4, 240, 292);
    g.setZoom(3, 0);
    const deg = (px: number) => Math.asin(px / g.R) / RAD;   // longitude that lands px right of the centre on the equator
    const dots = g.project(places([[deg(120 + 12), 0], [deg(120 + 20), 0]]), () => true, 0, 0);
    expect(dots.map(d => d.i)).toEqual([0]);
  });

  it('projects a second set of places with its own coordinates (unit vectors cached per Places)', () => {
    const g = new Globe(tex, 8, 4, 240, 292);
    g.setZoom(2, 0);
    const a = g.project(places([[0, 0]]), () => true, 0, 0);
    const b = g.project(places([[5, 0]]), () => true, 0, 0);
    expect(a[0].x).toBeCloseTo(120, 6);
    expect(b[0].x).toBeCloseTo(120 + g.R * Math.sin(5 * RAD), 6);
  });

  it('skips places the filter rejects', () => {
    const g = new Globe(tex, 8, 4, 240, 292);
    g.setZoom(2, 0);
    expect(g.project(places([[0, 0], [5, 5]]), i => i === 1, 0, 0).map(d => d.i)).toEqual([1]);
  });

  it('matches a straightforward per-pixel render (orthographic, flattening into Mercator from FLAT_FROM) within rounding', () => {
    // The real texture's size and triangle ramps of 8 levels per texel: one texel off stays within 2 levels once tinted,
    // a hand-over 10 px off (5 texels at zoom 4) is far beyond.
    const TW = 2048, TH = 1024, w = 240, h = 292, tri = (t: number) => Math.min(255, 8 * Math.abs((t % 64) - 32));
    const smooth = new Uint32Array(TW * TH);
    for (let v = 0; v < TH; v++) {
      for (let u = 0; u < TW; u++) smooth[v * TW + u] = 0xff000000 | (tri(u) << 16) | (tri(v) << 8) | 64;
    }
    const g = new Globe(smooth, TW, TH, w, h), buf = new Uint32Array(w * h), ref = new Uint32Array(w * h);
    for (const [z, lon, lat] of [[1.4, 0, 0], [2.3, 13.4, 52.5], [3.2, -120, -33.25], [3.9, 170, 71], [3.999, -28.3, 50.1]]) {
      g.setZoom(z, lat);
      g.renderLand(buf, lon, lat);
      reference(tintTexture(smooth), TW, TH, w, h, g.R, lon, lat, z, ref);
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
    for (let v = 0; v < TH; v++) stripe[v * TW + TW / 2] = 0xffffffff;   // tinted: red 45 (18 at the limb), black 3
    const g = new Globe(stripe, TW, TH, w, h), buf = new Uint32Array(w * h);
    g.setZoom(1.4, 0);
    g.renderLand(buf, 0, 0);
    let disc = 0, dark = 0;
    for (let y = 0; y < h; y++) {
      const c = buf[y * w + (w - 1) / 2];
      if (c === BG) continue;
      disc++;
      if ((c & 255) < 10) dark++;
    }
    expect(disc).toBeGreaterThan(100);
    expect(dark).toBe(0);
  });
});

/**
 * The unoptimised renderer: per pixel, the inverse orthographic projection mixed by flatness(z) with the inverse Web
 * Mercator one (in longitude and latitude, as the shader), the exact longitude, from FLAT_FROM the exact latitude (below
 * it the ¼° step); (tinted) texture lookup, limb shading.
 */
function reference(tex: Uint32Array, TW: number, TH: number, w: number, h: number, R: number, lon: number, lat: number, z: number, out: Uint32Array) {
  const f = flatness(z), p = (z < FLAT_FROM ? Math.round(lat * 4) / 4 : lat) * RAD, cp = Math.cos(p), sp = Math.sin(p);
  const k = pxPerRad(z), m0 = mercY(p);
  out.fill(BG);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / R, dy = (h / 2 - y - 0.5) / R, q = dx * dx + dy * dy;
      if (q >= 1) continue;
      const nz = Math.sqrt(1 - q), vy = cp * dy + sp * nz, vz = -sp * dy + cp * nz;
      const lo = Math.atan2(dx, vz) + f * ((x + 0.5 - w / 2) / k - Math.atan2(dx, vz));   // radians east of the centre
      const la = Math.asin(Math.max(-1, Math.min(1, vy))), lm = 2 * Math.atan(Math.exp(m0 + (h / 2 - y - 0.5) / k)) - Math.PI / 2;
      const u = Math.floor(((lon * RAD + lo) / (2 * Math.PI) + 0.5) * TW);
      const v = Math.min(TH - 1, ((0.5 - (la + f * (lm - la)) / Math.PI) * TH) | 0);
      const c = tex[v * TW + (u & (TW - 1))], s = (256 * (0.35 + 0.65 * Math.pow(nz, 0.6))) | 0;
      out[y * w + x] = 0xff000000 | ((((c >>> 16) & 255) * s >> 8) << 16) | ((((c >>> 8) & 255) * s >> 8) << 8) | (((c & 255) * s) >> 8);
    }
  }
}
