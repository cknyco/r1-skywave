import {
  CATCH_RADIUS, FLAT_FROM, GL_PROBE_Z, GLOBE_BELOW_ZOOM, LANDING_PREFETCH, LIGHT_SPRITE, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN,
} from '../config';
import type { Places } from '../data/store';
import { type Cam, globeEase, project, screenOf, TILE, unproject, worldSize } from '../geo/mercator';
import { wrapLon } from '../geo/sphere';
import { atPlace, planFlight, sampleFlight, type Flight } from './camera';
import type { GlGlobe } from './gl/api';
import type { Globe } from './globe';
import { drawLights, glowSprite, lightUp, type Lights } from './lights';
import { MARGIN, type ScreenDot } from './lod';
import { pickAtCenter } from './pick';
import { fetchTiles, type TileLayer } from './tiles';

/** CSS size of the view: its container (the r1 WebView gives 240×292, Ruling 19), else the window. */
export function viewSize(canvas: HTMLCanvasElement): { w: number; h: number } {
  const host = canvas.parentElement;
  return { w: host?.clientWidth || window.innerWidth, h: host?.clientHeight || window.innerHeight };
}

export class MapView {
  cam: Cam = { lon: 0, lat: 30, z: ZOOM_DEFAULT };
  current = -1;
  dots: ScreenDot[] = [];
  moving = false;
  w = 0;
  h = 0;
  readonly dpr: number;   // canvas backing store = CSS size × dpr
  frameMs: number[] = [];
  frameGlobe: boolean[] = [];   // parallel to frameMs: true where the globe renderer drew that frame
  onFrame: (globe: boolean) => void = () => {};   // after every frame; the app shows the tile attribution over tiles only
  readonly glow: ImageData;   // look A's light, made once; drawLights draws it from `sprite`, the WebGL globe uploads it
  gl: GlGlobe | null = null;  // the WebGL globe, drawn on its own canvas below GLOBE_BELOW_ZOOM instead of `globe` while gl.ok
  private sticky = false;   // a wheel or voice selection stays selected until the user drags
  private held = false;     // a finger is on the map: no glide starts
  private glided = false;   // the last flight was a glide: no other glide until a drag, a zoom or letting go
  private flight: Flight | null = null;
  private raf = 0;
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;   // the 1x globe buffer, upscaled onto the canvas with drawImage
  private offCtx!: CanvasRenderingContext2D;
  private img!: ImageData;
  private buf!: Uint32Array;
  private sprite: HTMLCanvasElement;
  private lights: Lights = { data: new Float32Array(0), n: 0 };   // the last frame's lights, reused
  private wx: Float64Array;   // per place: its Web Mercator position at zoom 0, for the tile view's places in view
  private wy: Float64Array;

  constructor(
    private canvas: HTMLCanvasElement,
    private places: Places,
    private globe: Globe,
    private tiles: TileLayer,
    private onPick: (place: number) => void,
  ) {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.off = document.createElement('canvas');
    this.glow = glowSprite();
    this.sprite = document.createElement('canvas');
    this.sprite.width = this.sprite.height = LIGHT_SPRITE;
    this.sprite.getContext('2d')!.putImageData(this.glow, 0, 0);
    this.wx = new Float64Array(places.n);
    this.wy = new Float64Array(places.n);
    for (let i = 0; i < places.n; i++) ({ x: this.wx[i], y: this.wy[i] } = project(places.lon[i], places.lat[i], 0));
    const { w, h } = viewSize(canvas);
    this.resize(w, h);
  }

  /**
   * Sizes the canvas, the globe and its buffer to a w×h CSS-pixel view and redraws. The app calls it again when the
   * WebView reports another size after boot (M3 minor: the r1 may settle its innerHeight late).
   */
  resize(w: number, h: number): void {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.globe.resize(w, h);
    this.gl?.resize(w, h, this.dpr);
    this.off.width = w;
    this.off.height = h;
    this.offCtx = this.off.getContext('2d')!;
    this.img = this.offCtx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.wake();
  }

  wake = (): void => { if (!this.raf) this.raf = requestAnimationFrame(this.frame); };

  /** Draws the globe with g from the next frame on (sized to the view), or with the Canvas 2D globe again for null. */
  useGl(g: GlGlobe | null): void {
    if (this.gl && this.gl !== g) this.gl.canvas.hidden = true;
    this.gl = g;
    g?.resize(this.w, this.h, this.dpr);
    this.wake();
  }

  /**
   * One frame of the WebGL probe: g, still hidden and not in use, draws the view the camera looks at, at GL_PROBE_Z (a
   * globe filling the screen), with its lights. Changes nothing of the view's own state.
   */
  drawProbe(g: GlGlobe): void {
    const L: Lights = { data: new Float32Array(0), n: 0 };
    g.resize(this.w, this.h, this.dpr);
    g.view({ ...this.cam, z: GL_PROBE_Z });
    lightUp(g.project(this.places, () => true), [], -1, GL_PROBE_Z, g.R, false, L);
    g.draw(L.data, L.n);
  }

  /** The zoom the map is at, or flying to: a far flight dips far below both ends on the way (M3 minor M1). */
  get targetZ(): number {
    return this.flight ? this.flight.to.z : this.cam.z;
  }

  /**
   * Flies to lon/lat at zoom z; a landing in tile mode requests its tiles right away (Ruling 46). A glide is the short
   * 500 ms hop at any zoom, and the next rest does not glide again.
   */
  flyTo(lon: number, lat: number, z = this.cam.z, glide = false): void {
    const to = { lon, lat, z: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) };
    this.flight = planFlight(this.cam, to, performance.now(), glide);
    this.glided = glide;
    this.moving = true;
    if (to.z >= GLOBE_BELOW_ZOOM) this.tiles.prefetch(to, this.w, this.h, this.dpr, LANDING_PREFETCH);
    this.wake();
  }

  /** Explicit selection (wheel, voice): tune at once, fly there (to zoom z), never let clustering or picking override it. */
  select(place: number, z = this.cam.z): void {
    this.current = place;
    this.sticky = true;
    this.onPick(place);
    this.flyTo(this.places.lon[place], this.places.lat[place], z);
  }

  /**
   * True while a finger is on the map. Putting it down ends a running flight at once (a glide, a zoom), except the
   * flight of a wheel or voice selection, which still ends only on the first panBy; letting go lets the map rest, so a
   * caught place glides into the ring (once more after a glide, too).
   */
  hold(on: boolean): void {
    this.held = on;
    if (on && !this.sticky) { this.flight = null; this.moving = false; }
    if (!on) { this.glided = false; this.wake(); }
  }

  /** Moves the map under a finger that moved dx, dy px: on the globe, eased smaller below zoom 4, as far on the sphere. */
  panBy(dx: number, dy: number): void {
    this.flight = null;
    this.sticky = false;
    this.glided = false;
    const { z } = this.cam, k = globeEase(z);   // 1 from zoom 4, the tile view
    const c = project(this.cam.lon, this.cam.lat, z);
    const p = unproject(c.x - dx / k, Math.max(0, Math.min(worldSize(z), c.y - dy / k)), z);
    this.cam = { ...this.cam, lon: wrapLon(p.lon), lat: p.lat };
    this.wake();
  }

  zoomBy(dz: number): void {
    this.flyTo(this.cam.lon, this.cam.lat, this.cam.z + dz);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const t0 = performance.now();
    if (this.flight) {
      const s = sampleFlight(this.flight, now);
      this.cam = s.cam;
      if (s.done) this.flight = null;
    }
    this.moving = !!this.flight;
    const globe = this.draw(fetchTiles(this.flight, now));
    this.frameMs.push(performance.now() - t0);
    this.frameGlobe.push(globe);
    if (this.frameMs.length > 120) { this.frameMs.shift(); this.frameGlobe.shift(); }
    this.onFrame(globe);
    if (this.flight) this.wake();
    else if (!this.sticky) {
      const picked = pickAtCenter(this.dots, this.w / 2, this.h / 2, CATCH_RADIUS, this.current);
      if (picked < 0) return;
      if (picked !== this.current) { this.current = picked; this.onPick(picked); }
      // The glide: once the map rests, the caught place eases into the ring in one short flight. During a drag the
      // pick still follows the finger (the strip with it) but nothing glides. One glide per rest: the current place is
      // drawn alone, so where two places lie a few px apart the other one absorbs their neighbours and wins the pick on
      // landing; gliding again would fly between the two for ever. A drag, a zoom or letting go allows the next glide.
      const lon = this.places.lon[picked], lat = this.places.lat[picked];
      if (!this.held && !this.glided && !atPlace(this.cam, lon, lat)) this.flyTo(lon, lat, this.cam.z, true);
    }
  };

  /**
   * Draws one frame; fetch lets the tile layer request missing tiles. Returns true when a globe renderer drew it. Every
   * place in view is a light: the dots (what the ring can catch, and the selected place) golden, the rest faint. The
   * WebGL globe draws on its own canvas, shown only for its frames; #map keeps its last frame underneath.
   */
  private draw(fetch: boolean): boolean {
    const { cam, places, w, h, dpr, ctx } = this;
    const cur = this.current;
    const globe = cam.z < GLOBE_BELOW_ZOOM, gl = globe && this.gl?.ok ? this.gl : null;   // the Canvas 2D globe while lost
    let all: ScreenDot[];
    let selected: ScreenDot[];
    if (globe) {
      if (gl) {
        gl.view(cam);
        all = gl.project(places, () => true);
      } else {
        this.globe.setZoom(cam.z, cam.lat);
        this.globe.renderLand(this.buf, cam.lon, cam.lat);
        all = this.globe.project(places, () => true, cam.lon, cam.lat);
        this.offCtx.putImageData(this.img, 0, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(this.off, 0, 0, this.canvas.width, this.canvas.height);
      }
      selected = all.filter(d => d.i === cur);
    } else {
      this.tiles.draw(ctx, cam, w, h, dpr, fetch);
      // screenOf for every place, from its position at zoom 0 scaled to cam.z, wrapped and rounded as screenOf does.
      const k = 2 ** cam.z, S = TILE * k, c = project(cam.lon, cam.lat, 0), { wx, wy } = this;
      all = [];
      for (let i = 0; i < places.n; i++) {
        let dx = (wx[i] - c.x) * k;
        if (dx > S / 2) dx -= S;
        if (dx < -S / 2) dx += S;
        const x = Math.round((w / 2 + dx) * 1000) / 1000, y = Math.round((h / 2 + (wy[i] - c.y) * k) * 1000) / 1000;
        if (x > -MARGIN && x < w + MARGIN && y > -MARGIN && y < h + MARGIN) all.push({ i, x, y, count: places.count[i] });
      }
      selected = [];
      if (cur >= 0) {
        const p = screenOf(places.lon[cur], places.lat[cur], cam, w, h);
        selected = [{ i: cur, x: p.x, y: p.y, count: places.count[cur] }];
      }
    }
    // The Canvas 2D globe merges the faint lights that share a LIGHT_MERGE cell (1 px) below FLAT_FROM, where it shows
    // most of them (frame time: about 1,500 sprites over Europe at z 1.6 instead of 1,600, the look kept).
    const R = gl ? gl.R : globe ? this.globe.R : Infinity;
    this.dots = lightUp(all, selected, cur, cam.z, R, globe && !gl && cam.z < FLAT_FROM, this.lights);
    if (gl) gl.draw(this.lights.data, this.lights.n);
    else drawLights(ctx, this.lights, this.sprite, dpr);
    if (this.gl && this.gl.canvas.hidden !== !gl) this.gl.canvas.hidden = !gl;
    return globe;
  }
}
