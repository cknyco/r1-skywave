import { DOT_CSS, GLOBE_BELOW_ZOOM, RING_RADIUS, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from '../config';
import type { Places } from '../data/store';
import { type Cam, project, screenOf, unproject, worldSize } from '../geo/mercator';
import { wrapLon } from '../geo/sphere';
import { planFlight, sampleFlight, type Flight } from './camera';
import type { Globe } from './globe';
import { clusterScreen, dotRadius, minCountForZoom, type ScreenDot } from './lod';
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
  readonly w: number;
  readonly h: number;
  readonly dpr: number;   // canvas backing store = CSS size × dpr
  frameMs: number[] = [];
  frameGlobe: boolean[] = [];   // parallel to frameMs: true where the globe renderer drew that frame
  onFrame: (globe: boolean) => void = () => {};   // after every frame; the app shows the tile attribution over tiles only
  private sticky = false;   // a wheel or voice selection stays selected until the user drags
  private flight: Flight | null = null;
  private raf = 0;
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;   // the 1x globe buffer, upscaled onto the canvas with drawImage
  private offCtx: CanvasRenderingContext2D;
  private img: ImageData;
  private buf: Uint32Array;

  constructor(
    private canvas: HTMLCanvasElement,
    private places: Places,
    private globe: Globe,
    private tiles: TileLayer,
    private onPick: (place: number) => void,
  ) {
    const { w, h } = viewSize(canvas);
    this.w = w;
    this.h = h;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * this.dpr);
    canvas.height = Math.round(h * this.dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    globe.resize(w, h);
    this.off = document.createElement('canvas');
    this.off.width = w;
    this.off.height = h;
    this.offCtx = this.off.getContext('2d')!;
    this.img = this.offCtx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  wake = (): void => { if (!this.raf) this.raf = requestAnimationFrame(this.frame); };

  flyTo(lon: number, lat: number, z = this.cam.z): void {
    this.flight = planFlight(this.cam, { lon, lat, z: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) }, performance.now());
    this.moving = true;
    this.wake();
  }

  /** Explicit selection (wheel, voice): tune at once, fly there (to zoom z), never let clustering or picking override it. */
  select(place: number, z = this.cam.z): void {
    this.current = place;
    this.sticky = true;
    this.onPick(place);
    this.flyTo(this.places.lon[place], this.places.lat[place], z);
  }

  panBy(dx: number, dy: number): void {
    this.flight = null;
    this.sticky = false;
    const c = project(this.cam.lon, this.cam.lat, this.cam.z);
    const p = unproject(c.x - dx, Math.max(0, Math.min(worldSize(this.cam.z), c.y - dy)), this.cam.z);
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
      const picked = pickAtCenter(this.dots, this.w / 2, this.h / 2, RING_RADIUS, this.current);
      if (picked >= 0 && picked !== this.current) { this.current = picked; this.onPick(picked); }
    }
  };

  /** Draws one frame; fetch lets the tile layer request missing tiles. Returns true when the globe renderer drew it. */
  private draw(fetch: boolean): boolean {
    const { cam, places, w, h, dpr, ctx } = this;
    const minCount = minCountForZoom(cam.z);
    const cur = this.current;
    const eligible = (i: number) => i !== cur && places.count[i] >= minCount;
    const globe = cam.z < GLOBE_BELOW_ZOOM;
    let raw: ScreenDot[];
    let selected: ScreenDot[] = [];
    if (globe) {
      this.globe.setZoom(cam.z, cam.lat);
      this.globe.renderLand(this.buf, cam.lon, cam.lat);
      raw = this.globe.project(places, eligible, cam.lon, cam.lat);
      if (cur >= 0) selected = this.globe.project(places, i => i === cur, cam.lon, cam.lat);
      this.offCtx.putImageData(this.img, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(this.off, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.tiles.draw(ctx, cam, w, h, dpr, fetch);
      raw = [];
      for (let i = 0; i < places.n; i++) {
        if (!eligible(i)) continue;
        const p = screenOf(places.lon[i], places.lat[i], cam, w, h);
        if (p.x > -8 && p.x < w + 8 && p.y > -8 && p.y < h + 8) raw.push({ i, x: p.x, y: p.y, count: places.count[i] });
      }
      if (cur >= 0) {
        const p = screenOf(places.lon[cur], places.lat[cur], cam, w, h);
        selected = [{ i: cur, x: p.x, y: p.y, count: places.count[cur] }];
      }
    }
    this.dots = [...clusterScreen(raw, globe ? 10 : 22), ...selected];
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const d of this.dots) {
      const r = dotRadius(d.count), active = d.i === this.current;
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = active ? '#ffffff' : DOT_CSS;
      ctx.beginPath(); ctx.arc(d.x, d.y, r * 2.2, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, 6.2832); ctx.fill();
    }
    return globe;
  }
}
