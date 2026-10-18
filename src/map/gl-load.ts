import { GL_FRAME_LIMIT_MS } from '../config';
import { lazyImport } from '../platform/lazy';
import type { GlGlobe, GlModule, GlTexture } from './gl/api';

/** How the globe is drawn: the app's choice (auto), or forced with ?globe=gl, ?globe=mediump (WebGL in mediump) or ?globe=2d. */
export type GlobeMode = 'auto' | 'gl' | 'mediump' | '2d';

export function globeMode(search: string): GlobeMode {
  const m = new URLSearchParams(search).get('globe');
  return m === 'gl' || m === 'mediump' || m === '2d' ? m : 'auto';
}

/** The probe's verdict on its frame times (ms): their median, and whether it is under `limit`. No frames: not ok. */
export function probeVerdict(ms: number[], limit = GL_FRAME_LIMIT_MS): { ok: boolean; median: number } {
  const median = [...ms].sort((a, b) => a - b)[ms.length >> 1] ?? NaN;
  return { ok: median < limit, median };
}

/**
 * The WebGL globe on `canvas`, made by globe-gl.js at `url`. Rejects with Error('forced') for '2d'; Error('no WebGL') when
 * the canvas has no WebGL1 context, so globe-gl.js is only fetched where WebGL exists; Error('load failed') when the file
 * does not load; and with createGlGlobe's own errors (`shader: …`, `gl error …`, `texture too big`). On every rejection
 * after the context exists it loses the context, which frees whatever was made in it (the earth texture is about 11 MB of
 * the r1's memory), as dispose() does for a globe that was made.
 */
export async function loadGlGlobe(
  url: string, canvas: HTMLCanvasElement, mode: GlobeMode, tex: GlTexture, sprite: ImageData,
): Promise<GlGlobe> {
  if (mode === '2d') throw new Error('forced');
  const gl = canvas.getContext('webgl', {
    alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('no WebGL');
  try {
    return (await lazyImport<GlModule>(url)).default(gl, tex, sprite, mode === 'mediump');
  } catch (e) {
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    throw e;
  }
}
