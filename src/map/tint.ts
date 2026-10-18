import { TINT_MUL, TINT_OVER } from '../config';

/** Look A's blue marble for one channel value c (0–255): multiplied by TINT_MUL, then TINT_OVER over it at its alpha. */
const tint = (ch: number, c: number) => Math.round(TINT_OVER[3] * TINT_OVER[ch] + (1 - TINT_OVER[3]) * TINT_MUL[ch] * c / 255);

/** A tinted copy of an RGBA texture (little-endian texels, as getImageData gives them), opaque: one lookup per channel. */
export function tintTexture(tex: Uint32Array): Uint32Array {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256);
  for (let c = 0; c < 256; c++) { r[c] = tint(0, c); g[c] = tint(1, c) << 8; b[c] = tint(2, c) << 16; }
  const out = new Uint32Array(tex.length);
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    out[i] = 0xff000000 | b[(c >>> 16) & 255] | g[(c >>> 8) & 255] | r[c & 255];
  }
  return out;
}

/** The same tint over what a canvas shows: W×H device pixels at the identity transform; leaves source-over. */
export function tintCanvas(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${TINT_MUL})`;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(${TINT_OVER})`;
  ctx.fillRect(0, 0, W, H);
}
