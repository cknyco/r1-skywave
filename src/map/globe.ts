import { IMAGERY_DIM } from '../config';
import type { Places } from '../data/store';
import { RAD } from '../geo/sphere';
import { worldSize } from '../geo/mercator';
import type { ScreenDot } from './lod';

// Limb shading by q = dx² + dy² (squared distance from the disc centre), tabulated: Math.pow per pixel was the costliest step.
const SHADE_N = 4096;
const SHADE = new Uint16Array(SHADE_N);
for (let k = 0; k < SHADE_N; k++) SHADE[k] = (256 * IMAGERY_DIM * (0.35 + 0.65 * Math.pow(Math.sqrt(1 - k / SHADE_N), 0.6))) | 0;

/** Orthographic globe drawn pixel by pixel into a w×h buffer (1 px per CSS px; the view upscales it to the canvas). */
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
  private U0 = new Int32Array(0);
  private V = new Int32Array(0);
  private uvLat = NaN;
  R = 0;
  w = 0;
  h = 0;

  constructor(private tex: Uint32Array, private TW: number, private TH: number, w: number, h: number) {
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

  /** Radius matching Web Mercator scale at the centre latitude, so the globe→tiles hand-over lines up. */
  setZoom(z: number, lat: number): void {
    const R = Math.round(worldSize(z) / (2 * Math.PI * Math.max(0.2, Math.cos(lat * RAD))));
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

  /** Texture coordinates for every disc pixel. Each row is mirror-symmetric about cx, so only its left half is computed. */
  private buildUV(lat0: number): void {
    const p = lat0 * RAD, cp = Math.cos(p), sp = Math.sin(p), { TW, TH, h, ROW0, ROWN, NX, NY, NZ, U0, V } = this;
    for (let y = 0; y < h; y++) {
      const i0 = ROW0[y], n = ROWN[y];
      for (let k = 0; k < (n + 1) >> 1; k++) {
        const i = i0 + k, j = i0 + n - 1 - k;
        const vx = NX[i], vy = cp * NY[i] + sp * NZ[i], vz = -sp * NY[i] + cp * NZ[i];
        U0[i] = ((Math.atan2(vx, vz) / Math.PI + 1) * 0.5 * TW) | 0;
        V[i] = Math.min(TH - 1, ((0.5 - Math.asin(Math.max(-1, Math.min(1, vy))) / Math.PI) * TH) | 0);
        if (j === i) continue;   // the middle pixel of an odd span is its own mirror
        U0[j] = TW - 1 - U0[i];   // the mirror pixel has -vx: atan2 flips sign, u becomes TW - u (±1 texel after flooring)
        V[j] = V[i];
      }
    }
    this.uvLat = lat0;
  }

  renderLand(buf: Uint32Array, lon: number, lat: number): void {
    buf.fill(0xff0d0806);
    const latQ = Math.round(lat * 4) / 4;
    if (latQ !== this.uvLat) this.buildUV(latQ);
    const du = Math.round((lon / 360) * this.TW), mask = this.TW - 1, { tex, TW, PIX, U0, V, SH } = this;
    for (let i = 0; i < this.np; i++) {
      const c = tex[V[i] * TW + ((U0[i] + du) & mask)], s = SH[i];
      buf[PIX[i]] = 0xff000000 | ((((c >>> 16) & 255) * s >> 8) << 16) | ((((c >>> 8) & 255) * s >> 8) << 8) | (((c & 255) * s) >> 8);
    }
  }

  project(places: Places, eligible: (i: number) => boolean, lon: number, lat: number): ScreenDot[] {
    const l = -lon * RAD, p = Math.round(lat * 4) / 4 * RAD;
    const cl = Math.cos(l), sl = Math.sin(l), cp = Math.cos(p), sp = Math.sin(p);
    const { w, h, cx, cy, R } = this;
    const out: ScreenDot[] = [];
    for (let j = 0; j < places.n; j++) {
      if (!eligible(j)) continue;
      const la = places.lat[j] * RAD, lo = places.lon[j] * RAD, c = Math.cos(la);
      const x = c * Math.sin(lo), y = Math.sin(la), z = c * Math.cos(lo);
      if (-cp * sl * x + sp * y + cp * cl * z <= 0) continue;
      const vx = cl * x + sl * z, vy = sp * sl * x + cp * y - sp * cl * z;
      const sx = cx + vx * R, sy = cy - vy * R;
      if (sx < -8 || sx > w + 8 || sy < -8 || sy > h + 8) continue;
      out.push({ i: j, x: sx, y: sy, count: places.count[j] });
    }
    return out;
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
