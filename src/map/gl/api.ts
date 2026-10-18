// The WebGL globe's interface between app.js and globe-gl.js. app.js imports this file with `import type` only, so no
// WebGL code reaches it.
import type { Places } from '../../data/store';
import type { Cam } from '../../geo/mercator';
import type { ScreenDot } from '../lod';

/** The globe texture as the app decoded it: RGBA, equirectangular, lon −180 at the left edge. */
export interface GlTexture { data: Uint8Array; w: number; h: number }

/** The WebGL globe, drawn on a canvas of its own over the map below zoom 4. */
export interface GlGlobe {
  readonly canvas: HTMLCanvasElement;
  readonly info: string;     // "WebGL, highp, pt 64": precision used and ALIASED_POINT_SIZE_RANGE max
  readonly R: number;        // globe radius at the last view(), CSS px
  readonly ok: boolean;      // false while the context is lost
  onState: (ok: boolean) => void;   // the context was lost (false), or restored and everything rebuilt (true)
  resize(w: number, h: number, dpr: number): void;   // drawing buffer w·dpr × h·dpr, CSS size w × h
  view(cam: Cam): void;
  project(places: Places, keep: (i: number) => boolean): ScreenDot[];   // visible side, CSS px, with z; margin 16 px
  draw(lights: Float32Array, n: number): void;   // globe pass, then the light pass
  /**
   * Calls frame() frames + 1 times, once per animation frame, and resolves with the time of each but the first (a
   * warm-up), in ms, from before frame() to after a 1×1 readPixels (so the GPU's work counts). Resolves at once with
   * what it has when the context is lost; rejects with what frame() or readPixels throws.
   */
  probe(frames: number, frame: () => void): Promise<number[]>;
  dispose(): void;   // removes its context listeners, frees the texture and buffers, then loses the context
}

/**
 * What globe-gl.js exports: createGlGlobe, also as its default export. app.js calls the default, so the name
 * createGlGlobe (which a property access would keep through minification) never appears in app.js.
 */
export interface GlModule {
  createGlGlobe(gl: WebGLRenderingContext, tex: GlTexture, sprite: ImageData, mediump: boolean): GlGlobe;
  default: GlModule['createGlGlobe'];
}
