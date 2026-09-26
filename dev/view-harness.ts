// Dev-only renderer harness (never in the release build): mounts MapView full-screen for e2e tests and screenshots.
// URL: /dev/view.html?place=Berlin&z=7 (or &lon=..&lat=..). Keys: arrows pan, +/- zoom, [ ] walk to the previous/next place.
import { RING_RADIUS, TEXTURE_URL, ZOOM_DEFAULT } from '../src/config';
import { DataStore } from '../src/data/store';
import { Globe, loadTexture } from '../src/map/globe';
import { minCountForZoom } from '../src/map/lod';
import { TILE_SOURCE } from '../src/map/tile-source';
import { TileLayer } from '../src/map/tiles';
import { MapView, viewSize } from '../src/map/view';
import { buildWalk, stepWalk } from '../src/map/walk';

const hud = document.getElementById('hud') as HTMLElement;

async function boot(): Promise<void> {
  const canvas = document.getElementById('map') as HTMLCanvasElement;
  const ring = document.getElementById('ring') as HTMLElement;
  ring.style.width = ring.style.height = `${2 * RING_RADIUS}px`;
  const data = new DataStore('../data/');
  const [places, texture] = await Promise.all([data.load(), loadTexture(`../${TEXTURE_URL}`)]);
  const { w, h } = viewSize(canvas);
  const globe = new Globe(texture.tex, texture.TW, texture.TH, w, h);
  let view!: MapView;
  const tiles = new TileLayer(TILE_SOURCE, () => view.wake());
  view = new MapView(canvas, places, globe, tiles, p => { hud.textContent = `${places.name[p]} · ${places.count[p]}`; });

  const q = new URLSearchParams(location.search);
  const name = (q.get('place') ?? 'Berlin').toLowerCase();
  let start = -1;
  for (let i = 0; i < places.n; i++) {
    if (places.name[i].toLowerCase() === name && (start < 0 || places.count[i] > places.count[start])) start = i;
  }
  const num = (k: string, d: number) => { const v = Number(q.get(k)); return q.has(k) && Number.isFinite(v) ? v : d; };
  view.cam = {
    lon: num('lon', start >= 0 ? places.lon[start] : 0),
    lat: num('lat', start >= 0 ? places.lat[start] : 30),
    z: num('z', ZOOM_DEFAULT),
  };
  view.wake();

  const walk = buildWalk(places.lon, places.lat);
  window.addEventListener('keydown', e => {
    const k = e.key;
    if (k === 'ArrowLeft') view.panBy(40, 0);
    else if (k === 'ArrowRight') view.panBy(-40, 0);
    else if (k === 'ArrowUp') view.panBy(0, 40);
    else if (k === 'ArrowDown') view.panBy(0, -40);
    else if (k === '+' || k === '=') view.zoomBy(1);
    else if (k === '-') view.zoomBy(-1);
    else if (k === '[' || k === ']') {
      const min = minCountForZoom(view.cam.z);
      const next = stepWalk(walk, view.current, k === ']' ? 1 : -1, i => places.count[i] >= min);
      if (next >= 0) view.select(next);
    }
  });

  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    view.panBy(e.clientX - drag.x, e.clientY - drag.y);
    drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', () => { drag = null; });

  Object.assign(window, { __view: view, __places: places });
}

void boot().catch(e => { hud.textContent = `error: ${e instanceof Error ? e.message : String(e)}`; });
