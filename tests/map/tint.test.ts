import { describe, expect, it } from 'vitest';
import { TINT_MUL, TINT_OVER } from '../../src/config';
import { tintTexture } from '../../src/map/tint';

const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** The spike's look A ramp (without its lighting): deep blue to steel blue by luminance, plus a little of the colour. */
function lookA(c: number[]): number[] {
  const [r, g, b] = c.map(v => v / 255), t = sm(0.02, 0.8, 0.3 * r + 0.5 * g + 0.2 * b);
  const lo = [0.012, 0.055, 0.19], hi = [0.09, 0.15, 0.27], k = [0.08, 0.1, 0.12];
  return [r, g, b].map((v, ch) => 255 * (lo[ch] + (hi[ch] - lo[ch]) * t + v * k[ch]));
}

const rgb = (t: number) => [t & 255, (t >>> 8) & 255, (t >>> 16) & 255];
/** One texel (little-endian RGBA, as getImageData gives it) through tintTexture. */
const tinted = (c: number[]) => rgb(tintTexture(Uint32Array.of((0xff000000 | (c[2] << 16) | (c[1] << 8) | c[0]) >>> 0))[0]);
const maxDiff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

describe('tint', () => {
  it('stays within 10 levels of look A for ocean, deep ocean, forest, grass, desert, rock, ice, cloud and black', () => {
    for (const c of [[10, 22, 52], [6, 12, 40], [40, 70, 30], [90, 110, 60], [200, 170, 120], [120, 100, 80], [240, 245, 250], [200, 200, 205], [0, 0, 0]])
      expect(maxDiff(tinted(c), lookA(c))).toBeLessThanOrEqual(10);
  });

  it('tints texel by texel as the canvas fills do (multiply, then the 25 % overlay), alpha opaque', () => {
    const tex = Uint32Array.of(0xff342210, 0xffffffff, 0xff000000);
    const out = tintTexture(tex);
    expect(out).not.toBe(tex);
    expect(out.length).toBe(tex.length);
    for (let k = 0; k < tex.length; k++) {
      const c = rgb(tex[k]), o = rgb(out[k]);
      for (let ch = 0; ch < 3; ch++) {
        const want = Math.round(TINT_OVER[3] * TINT_OVER[ch] + (1 - TINT_OVER[3]) * TINT_MUL[ch] * c[ch] / 255);
        expect(Math.abs(o[ch] - want)).toBeLessThanOrEqual(1);
      }
      expect(out[k] >>> 24).toBe(255);
    }
    expect(tex[0]).toBe(0xff342210);   // the source is left as it was
  });
});
