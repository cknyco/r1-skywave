import type { Places } from '../data/store';
import { RAD } from '../geo/sphere';
import { flatness, globeRadius, mercY, pxPerRad } from '../geo/mercator';
import { orthoPlaces } from './gl/frame';
import type { ScreenDot } from './lod';
import { tintTexture } from './tint';

// Limb shading by q = dx² + dy² (squared distance from the disc centre), tabulated: Math.pow per pixel was the costliest
// step. 256 (the texel as it is) at the centre, 35 % at the limb.
const SHADE_N = 4096;
const SHADE = new Uint16Array(SHADE_N);
for (let k = 0; k < SHADE_N; k++) SHADE[k] = (256 * (0.35 + 0.65 * Math.pow(Math.sqrt(1 - k / SHADE_N), 0.6))) | 0;

/**
 * Orthographic globe drawn pixel by pixel into a w×h buffer (1 px per CSS px; the view upscales it to the canvas). From
 * FLAT_FROM it flattens into the tiles' Web Mercator as the WebGL globe does (flatness), so zoom 4 hands over to the
 * tiles without a jump; its disc then covers the screen (R ≥ 449 px) and its limb shading is within 2 levels of flat.
 */
export class Globe {
  private np = 0;
  private cx = 0;
  private cy = 0;
  private ROW0 = new Int32Array(0);   // per screen row: index of its first disc pixel, and how many (a span symmetric about cx)
  private ROWN = new Int32Array(0);
  private PIX = new Int32Array(0);
  private NX = new Float32Array(0);
  private NY = new Float32Array(0);
  private NZ = new Float32Array(0);
  private SH = new Uint16Array(0);
  private U0 = new Int32Array(0);   // texture column, in 1/256 texel (24.8 fixed point)
  private V = new Int32Array(0);
  private uvLat = NaN;   // the latitude the texture coordinates are for (NaN: none); flat changes clear it
  private k = 1;         // Web Mercator CSS px per radian at the zoom
  private flat = 0;      // flatness at the zoom
  private tinted?: Uint32Array;   // the texture in look A's blue marble, made on the first render
  private tex?: Uint32Array;      // the texture as loaded, until its tinted copy exists (then about 8 MB freed on the r1)
  R = 0;
  w = 0;
  h = 0;

  constructor(tex: Uint32Array, private TW: number, private TH: number, w: number, h: number) {
    this.tex = tex;
    this.resize(w, h);
  }

  /** Buffers sized for the whole screen once, so a zoom change refills them instead of allocating. */
  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.cx = w / 2;
    this.cy = h / 2;
    const n = w * h;
    this.ROW0 = new Int32Array(h);
    this.ROWN = new Int32Array(h);
    this.PIX = new Int32Array(n);
    this.NX = new Float32Array(n);
    this.NY = new Float32Array(n);
    this.NZ = new Float32Array(n);
    this.SH = new Uint16Array(n);
    this.U0 = new Int32Array(n);
    this.V = new Int32Array(n);
    this.np = 0;
    this.R = 0;
    this.uvLat = NaN;
  }

  /**
   * The radius for zoom z at latitude lat: globeRadius, rounded to whole pixels (the WebGL globe's, give or take ½ px);
   * the Web Mercator scale k and the flatness for z.
   */
  setZoom(z: number, lat: number): void {
    const R = Math.round(globeRadius(z, lat)), flat = flatness(z);
    this.k = pxPerRad(z);
    if (flat !== this.flat) { this.flat = flat; this.uvLat = NaN; }
    if (R === this.R) return;
    this.R = R;
    const { w, h, cx, cy, ROW0, ROWN, PIX, NX, NY, NZ, SH } = this;
    let np = 0;
    for (let y = 0; y < h; y++) {
      ROW0[y] = np;
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5 - cx) / R, dy = (cy - y - 0.5) / R, q = dx * dx + dy * dy;
        if (q >= 1) continue;
        PIX[np] = y * w + x; NX[np] = dx; NY[np] = dy; NZ[np] = Math.sqrt(1 - q);
        SH[np] = SHADE[(q * SHADE_N) | 0];
        np++;
      }
      ROWN[y] = np - ROW0[y];
    }
    this.np = np;
    this.uvLat = NaN;
  }

  /**
   * Texture coordinates for every disc pixel: the orthographic inverse mixed by flat, as the shader does, with the Web
   * Mercator one (longitude dx/k per column, latitude one exp/atan per row). Each row is mirror-symmetric about cx in
   * both, so only its left half is computed.
   */
  private buildUV(lat0: number): void {
    const p = lat0 * RAD, cp = Math.cos(p), sp = Math.sin(p), { TW, TH, h, cy, R, k, flat, ROW0, ROWN, NX, NY, NZ, U0, V } = this;
    const T = 256 * TW, m0 = mercY(p);
    for (let y = 0; y < h; y++) {
      const i0 = ROW0[y], n = ROWN[y], vm = 1 - (2 / Math.PI) * Math.atan(Math.exp(m0 + (cy - y - 0.5) / k));
      for (let j = 0; j < (n + 1) >> 1; j++) {
        const i = i0 + j, o = i0 + n - 1 - j;
        const vx = NX[i], vy = cp * NY[i] + sp * NZ[i], vz = -sp * NY[i] + cp * NZ[i], u = Math.atan2(vx, vz);
        U0[i] = ((0.5 + (u + flat * ((vx * R) / k - u)) / (2 * Math.PI)) * T) | 0;
        const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, vy))) / Math.PI;
        V[i] = Math.min(TH - 1, ((v + flat * (vm - v)) * TH) | 0);
        if (o === i) continue;   // the middle pixel of an odd span is its own mirror
        U0[o] = T - 1 - U0[i];   // the mirror pixel has -vx (and -dx): u becomes T - u (±1 after flooring)
        V[o] = V[i];
      }
    }
    this.uvLat = lat0;
  }

  /** The latitude both renderLand and project draw at lat: exact once flattening, else on the ¼° step. */
  private latAt(lat: number): number {
    return this.flat ? lat : Math.round(lat * 4) / 4;
  }

  renderLand(buf: Uint32Array, lon: number, lat: number): void {
    buf.fill(0xff0d0806);
    const latQ = this.latAt(lat);
    if (latQ !== this.uvLat) this.buildUV(latQ);
    if (!this.tinted) { this.tinted = tintTexture(this.tex!); this.tex = undefined; }
    const tex = this.tinted;
    const du = Math.round((lon / 360) * 256 * this.TW), mask = this.TW - 1, { TW, PIX, U0, V, SH } = this;
    for (let i = 0; i < this.np; i++) {
      const c = tex[V[i] * TW + (((U0[i] + du) >> 8) & mask)], s = SH[i];
      buf[PIX[i]] = 0xff000000 | ((((c >>> 16) & 255) * s >> 8) << 16) | ((((c >>> 8) & 255) * s >> 8) << 8) | (((c & 255) * s) >> 8);
    }
  }

  /** The places eligible admits on the visible side, with their depth, as renderLand draws the globe. */
  project(places: Places, eligible: (i: number) => boolean, lon: number, lat: number): ScreenDot[] {
    const { R, w, h, k, flat } = this;
    return orthoPlaces(places, eligible, { lon, lat: this.latAt(lat), R, w, h, k, flat });
  }
}

export async function loadTexture(url: string): Promise<{ tex: Uint32Array; TW: number; TH: number }> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  return { tex: new Uint32Array(data.buffer), TW: c.width, TH: c.height };
}
