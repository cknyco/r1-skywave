// globe-gl.js: the WebGL globe (look A), built as a file of its own and loaded by app.js only where WebGL exists
// (src/map/gl-load.ts). It draws the globe, space and the stars in one full-screen pass, then the lights as points.
import { LIGHT_MAX } from '../../config';
import { mercY } from '../../geo/mercator';
import { RAD } from '../../geo/sphere';
import type { GlGlobe, GlTexture } from './api';
import { glFrame, lightViewport, orthoPlaces, type GlFrame } from './frame';
import { GLOBE_VS, LIGHT_FS, LIGHT_VS, globeFs } from './shaders';

type Loc = WebGLUniformLocation | null;

/** A linked program whose attribute 0 is A; throws Error('shader: …') with the start of the info log on a failure. */
function program(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${(gl.getShaderInfoLog(s) ?? '').slice(0, 60)}`);
    gl.attachShader(p, s);
  }
  gl.bindAttribLocation(p, 0, 'A');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`shader: ${(gl.getProgramInfoLog(p) ?? '').slice(0, 60)}`);
  return p;
}

/**
 * The WebGL globe on gl's canvas: the texture as the app decoded it (tinted by the shader), the glow sprite for the
 * lights, and mediump to force mediump in the globe shader. Throws Error('texture too big'), Error('shader: …') or
 * Error('gl error <code>') when it cannot draw. It keeps these inputs, so a lost context that comes back is rebuilt
 * from them.
 */
export function createGlGlobe(gl: WebGLRenderingContext, tex: GlTexture, sprite: ImageData, mediump: boolean): GlGlobe {
  if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < Math.max(tex.w, tex.h)) throw new Error('texture too big');
  const at = (p: WebGLProgram, name: string) => gl.getUniformLocation(p, name);
  const params = (...kv: number[]) => { for (let k = 0; k < kv.length; k += 2) gl.texParameteri(gl.TEXTURE_2D, kv[k], kv[k + 1]); };
  // What the context holds: made here, and again when a lost context is restored.
  let G: WebGLProgram, S: WebGLProgram, V: Loc, Q: Loc, F: Loc, M: Loc, P: Loc;
  let earth: WebGLTexture | null, glow: WebGLTexture | null, tri: WebGLBuffer | null, pts: WebGLBuffer | null;
  const build = () => {
    G = program(gl, GLOBE_VS, globeFs(mediump));
    S = program(gl, LIGHT_VS, LIGHT_FS);
    V = at(G, 'V'); Q = at(G, 'Q'); F = at(G, 'F'); M = at(S, 'M'); P = at(S, 'P');
    // Unit 0: the earth, mipmapped, repeating in longitude. Unit 1: the glow sprite, as the Canvas 2D lights draw it.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, (earth = gl.createTexture()));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tex.w, tex.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, tex.data);
    gl.generateMipmap(gl.TEXTURE_2D);
    params(gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR, gl.TEXTURE_WRAP_S, gl.REPEAT, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (glow = gl.createTexture()));
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sprite);
    params(gl.TEXTURE_MIN_FILTER, gl.LINEAR, gl.TEXTURE_MAG_FILTER, gl.LINEAR, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.useProgram(G);
    gl.uniform1i(at(G, 'T'), 0);
    gl.useProgram(S);
    gl.uniform1i(at(S, 'T'), 1);
    tri = gl.createBuffer();
    pts = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    const err = gl.getError();
    if (err) throw new Error(`gl error ${err}`);
  };
  build();

  const highp = !mediump && (gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0) > 0;
  const maxPt: number = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
  const canvas = gl.canvas as HTMLCanvasElement;
  const lose = gl.getExtension('WEBGL_lose_context');   // taken now: a lost context gives no extension
  let W = 0, H = 0, dpr = 1, f: GlFrame = { lon: 0, lat: 0, R: 0, w: 0, h: 0, k: 1, flat: 0 };
  let ok = true, stop: (() => void) | undefined;   // stop: ends a running probe
  // preventDefault() asks the browser to restore the context; until then the app draws the Canvas 2D globe.
  const lost = (e: Event) => { e.preventDefault(); ok = false; stop?.(); g.onState(false); };
  const restored = () => {
    try { build(); } catch { lose?.loseContext(); return; }   // cannot draw again: stays lost, and frees what build made
    ok = true;
    g.onState(true);
  };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  const g: GlGlobe = {
    canvas,
    info: `WebGL, ${highp ? 'highp' : 'mediump'}, pt ${maxPt}`,
    get R() { return f.R; },
    get ok() { return ok; },
    onState: () => {},
    resize(w, h, d) {
      if (w === f.w && h === f.h && d === dpr) return;   // setting the canvas size again would clear its buffer
      dpr = d;
      canvas.width = W = Math.round(w * d);
      canvas.height = H = Math.round(h * d);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      f = { ...f, w, h };
    },
    view(cam) { f = glFrame(cam, f.w, f.h); },
    project: (places, keep) => orthoPlaces(places, keep, f),
    draw(lights, n) {
      const lon = f.lon * RAD, lat = f.lat * RAD;
      gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND);
      gl.useProgram(G);
      gl.bindBuffer(gl.ARRAY_BUFFER, tri);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.uniform4f(V, (f.w / 2) * dpr, H - (f.h / 2) * dpr, f.R * dpr, lon - 2 * Math.PI * Math.floor(lon / (2 * Math.PI) + 0.5));
      gl.uniform2f(Q, Math.cos(lat), Math.sin(lat));
      gl.uniform3f(F, f.flat, f.k * dpr, mercY(lat));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!n) return;
      // The viewport reaches half the largest point actually drawn beyond every edge (not the GPU's maximum, which
      // could exceed MAX_VIEWPORT_DIMS); M maps CSS px into its clip space, y down to GL's up.
      const [x, y, vw, vh] = lightViewport(W, H, Math.min(maxPt, Math.ceil(LIGHT_MAX * dpr)));
      gl.viewport(x, y, vw, vh);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);   // screen: never brighter than white, dense clusters stay golden
      gl.useProgram(S);
      gl.bindBuffer(gl.ARRAY_BUFFER, pts);
      gl.bufferData(gl.ARRAY_BUFFER, lights.subarray(0, 4 * n), gl.DYNAMIC_DRAW);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      gl.uniform4f(M, (2 * dpr) / vw, (-2 * dpr) / vh, (-2 * x) / vw - 1, (2 * (H - y)) / vh - 1);
      gl.uniform2f(P, dpr, maxPt);
      gl.drawArrays(gl.POINTS, 0, n);
    },
    probe(frames, frame) {
      return new Promise((res, rej) => {
        const ms: number[] = [], px = new Uint8Array(4);
        let k = 0;
        const step = () => {
          if (!ok) return res(ms);
          try {
            const t = performance.now();
            frame();
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // waits for the GPU to finish the frame
            if (k++) ms.push(performance.now() - t);
          } catch (e) {
            return rej(e);   // in an animation frame nothing else would see it: the probe would never settle
          }
          if (k > frames) res(ms);
          else requestAnimationFrame(step);
        };
        stop = () => res(ms);
        requestAnimationFrame(step);
      });
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      ok = false;
      gl.deleteTexture(earth);
      gl.deleteTexture(glow);
      gl.deleteBuffer(tri);
      gl.deleteBuffer(pts);
      gl.deleteProgram(G);
      gl.deleteProgram(S);
      lose?.loseContext();
    },
  };
  return g;
}

export default createGlGlobe;
