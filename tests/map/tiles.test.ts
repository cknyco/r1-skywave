import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { project, TILE, worldSize } from '../../src/geo/mercator';
import { planFlight } from '../../src/map/camera';
import { FETCH_LEAD_MS, fetchTiles, mercatorRows, TileLayer, tileZoom, underlayRects, visibleTiles } from '../../src/map/tiles';

describe('tile zoom', () => {
  it('asks one level deeper on a 2x canvas and never beyond the source maximum', () => {
    expect(tileZoom(7.4, 13, 1)).toBe(7);
    expect(tileZoom(7.4, 13, 2)).toBe(8);
    expect(tileZoom(7, 13, 2)).toBe(8);
    expect(tileZoom(12.9, 13, 2)).toBe(13);
    expect(tileZoom(13.6, 13, 1)).toBe(13);
    expect(tileZoom(4, 3, 2)).toBe(3);
  });
});

describe('visibleTiles', () => {
  const W = 240, H = 292;

  it('covers the viewport edge to edge with tiles that abut on whole device pixels', () => {
    for (const s of [1, 2]) {
      const v = visibleTiles({ lon: 13.335, lat: 52.48, z: 7.3 }, W, H, 13, s);
      expect(v.z).toBe(s === 2 ? 8 : 7);
      const cols = [...new Set(v.spots.map(t => t.dx))].sort((a, b) => a - b);
      const rows = [...new Set(v.spots.map(t => t.dy))].sort((a, b) => a - b);
      expect(v.spots.length).toBe(cols.length * rows.length);
      for (const t of v.spots) {
        for (const k of [t.dx, t.dy, t.dw, t.dh]) expect(Number.isInteger(k)).toBe(true);
        const right = v.spots.find(o => o.dy === t.dy && o.dx === t.dx + t.dw);
        if (t.dx + t.dw < W * s) expect(right).toBeDefined();   // no gap, no overlap
      }
      expect(cols[0]).toBeLessThanOrEqual(0);
      expect(rows[0]).toBeLessThanOrEqual(0);
      const last = v.spots[v.spots.length - 1];
      expect(last.dx + last.dw).toBeGreaterThanOrEqual(W * s);
      expect(last.dy + last.dh).toBeGreaterThanOrEqual(H * s);
    }
  });

  it('draws a z+1 tile pixel onto one device pixel at an integer zoom on a 2x canvas', () => {
    const v = visibleTiles({ lon: 13.335, lat: 52.48, z: 7 }, W, H, 13, 2);
    for (const t of v.spots) expect([t.dw, t.dh]).toEqual([TILE, TILE]);
  });

  it('puts the camera centre in the middle of the viewport', () => {
    const cam = { lon: 13.335, lat: 52.48, z: 7.3 }, s = 2;
    const v = visibleTiles(cam, W, H, 13, s);
    const c = project(cam.lon, cam.lat, v.z);
    const tx = Math.floor(c.x / TILE), ty = Math.floor(c.y / TILE);
    const t = v.spots.find(o => o.x === tx && o.y === ty)!;
    const k = t.dw / TILE;   // device px per tile px
    expect(t.dx + (c.x - tx * TILE) * k).toBeCloseTo((W * s) / 2, 0);
    expect(t.dy + (c.y - ty * TILE) * k).toBeCloseTo((H * s) / 2, 0);
  });

  it('wraps columns across the antimeridian', () => {
    const v = visibleTiles({ lon: 179.95, lat: 0, z: 6 }, W, H, 13, 2);
    const n = 1 << v.z;
    const xs = new Set(v.spots.map(t => t.x));
    expect(xs.has(0)).toBe(true);
    expect(xs.has(n - 1)).toBe(true);
    for (const t of v.spots) expect(t.x >= 0 && t.x < n).toBe(true);
    const west = v.spots.find(t => t.x === n - 1)!, east = v.spots.find(t => t.x === 0 && t.dy === west.dy)!;
    expect(east.dx).toBe(west.dx + west.dw);   // column 0 sits right of column n-1
  });

  it('clamps rows at the top and bottom of the world', () => {
    for (const lat of [84.9, -84.9]) {
      const v = visibleTiles({ lon: 0, lat, z: 4 }, W, H, 13, 2);
      const n = 1 << v.z;
      expect(v.spots.length).toBeGreaterThan(0);
      for (const t of v.spots) expect(t.y >= 0 && t.y < n).toBe(true);
    }
    const north = visibleTiles({ lon: 0, lat: 84.9, z: 4 }, W, H, 13, 2);
    expect(Math.min(...north.spots.map(t => t.y))).toBe(0);
    expect(Math.min(...north.spots.map(t => t.dy))).toBeGreaterThan(0);   // dark band above the world's edge
  });
});

describe('tile requests during a flight', () => {
  const berlin = { lon: 13.4, lat: 52.52, z: 7 };

  it('asks at rest, and on a far flight, which dips below both its ends, only in its last FETCH_LEAD_MS', () => {
    expect(fetchTiles(null, 0)).toBe(true);
    const far = planFlight(berlin, { lon: 139.69, lat: 35.69, z: 7 }, 1000);   // dips to the globe and back
    const end = far.t0 + far.dur;
    for (const now of [far.t0, far.t0 + far.dur / 2, end - FETCH_LEAD_MS - 1]) expect(fetchTiles(far, now)).toBe(false);
    for (const now of [end - FETCH_LEAD_MS, end - 1]) expect(fetchTiles(far, now)).toBe(true);
  });

  it('asks all the way on a flight whose zoom moves one way, which lands on or next to what it passes', () => {
    const hop = planFlight(berlin, { lon: 14.4, lat: 52.3, z: 7 }, 0);   // under 2°: one zoom throughout
    const zoomIn = planFlight(berlin, { ...berlin, z: 8 }, 0);           // passes over parents of its landing tiles
    const zoomOut = planFlight(berlin, { ...berlin, z: 6 }, 0);          // passes over its own landing view
    expect(hop.peakZ).toBe(7);
    for (const [name, f] of Object.entries({ hop, zoomIn, zoomOut })) {
      for (const now of [0, f.dur / 2, f.dur - FETCH_LEAD_MS - 1]) {
        expect(fetchTiles(f, now), `${name} at ${now}`).toBe(true);
      }
    }
  });
});

describe('TileLayer', () => {
  let made: FakeImage[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    src = '';
    complete = false;
    naturalWidth = 0;
    constructor() { made.push(this); }
  }
  const drawn: unknown[][] = [];
  const ctx = {
    fillStyle: '',
    setTransform() {},
    fillRect() {},
    drawImage(...a: unknown[]) { drawn.push(a); },
  } as unknown as CanvasRenderingContext2D;
  const src = { url: (z: number, x: number, y: number) => `t/${z}/${x}/${y}`, maxZ: 13, attribution: '' };
  const W = 240, H = 292, cam = { lon: 13.4, lat: 52.52, z: 7 };

  beforeEach(() => { made = []; drawn.length = 0; vi.stubGlobal('Image', FakeImage); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('creates no Image while fetching is off and one per visible tile when on', () => {
    const layer = new TileLayer(src, () => {});
    const n = visibleTiles(cam, W, H, 13, 2).spots.length;
    layer.draw(ctx, cam, W, H, 2, false);
    expect(made).toHaveLength(0);
    expect(drawn).toHaveLength(0);   // nothing cached: dark ground only
    layer.draw(ctx, cam, W, H, 2);
    expect(made).toHaveLength(n);
    const c = project(cam.lon, cam.lat, 8);   // tile zoom 8 on the 2x canvas
    expect(made.map(i => i.src)).toContain(`t/8/${Math.floor(c.x / TILE)}/${Math.floor(c.y / TILE)}`);
  });

  it('draws cached tiles and loaded parents while not fetching', () => {
    const layer = new TileLayer(src, () => {});
    layer.draw(ctx, cam, W, H, 2);
    for (const i of made) { i.complete = true; i.naturalWidth = TILE; }
    const n = made.length;
    drawn.length = 0;
    layer.draw(ctx, cam, W, H, 2, false);
    expect(drawn).toHaveLength(n);
    drawn.length = 0;
    const closer = { ...cam, z: 8 };   // tile zoom 9: nothing cached, every spot falls back to a zoom 8 parent
    layer.draw(ctx, closer, W, H, 2, false);
    expect(made).toHaveLength(n);
    expect(drawn).toHaveLength(visibleTiles(closer, W, H, 13, 2).spots.length);
    for (const a of drawn) expect(a).toHaveLength(9);   // source rectangle of the parent, then the spot
  });

  it('Ruling 46: draws the base under the tiles, dark ground first, then the tiles over it', () => {
    const layer = new TileLayer(src, () => {});
    layer.base = { width: 1024, height: 1024 } as HTMLCanvasElement;
    layer.draw(ctx, cam, W, H, 2, false);
    expect(drawn).toHaveLength(1);                       // nothing cached: the base alone
    expect(drawn[0][0]).toBe(layer.base);
    expect(drawn[0].slice(5)).toEqual([0, 0, W * 2, H * 2]);
    layer.draw(ctx, cam, W, H, 2);
    for (const i of made) { i.complete = true; i.naturalWidth = TILE; }
    drawn.length = 0;
    layer.draw(ctx, cam, W, H, 2, false);
    expect(drawn).toHaveLength(1 + made.length);
    expect(drawn[0][0]).toBe(layer.base);
  });

  it('Ruling 46: prefetches a view\'s tiles up to the cap, nearest the centre first, never twice', () => {
    const layer = new TileLayer(src, () => {});
    const n = visibleTiles(cam, W, H, 13, 2).spots.length;
    expect(n).toBeGreaterThan(4);
    expect(layer.prefetch(cam, W, H, 2, 4)).toBe(4);
    const c = project(cam.lon, cam.lat, 8);
    expect(made.map(i => i.src)).toContain(`t/8/${Math.floor(c.x / TILE)}/${Math.floor(c.y / TILE)}`);
    expect(layer.prefetch(cam, W, H, 2, 100)).toBe(n - 4);   // the rest; the first four are cached
    expect(layer.prefetch(cam, W, H, 2, 100)).toBe(0);
    made.length = 0;
    layer.draw(ctx, cam, W, H, 2);                            // the view itself asks for nothing new
    expect(made).toHaveLength(0);
  });
});

describe('Mercator base (Ruling 46)', () => {
  const W = 240, H = 292;

  it('maps each Mercator row to the texture row of its latitude', () => {
    const rows = mercatorRows(1024, 1024);
    expect(rows[511]).toBeGreaterThanOrEqual(511);            // the equator sits mid-texture
    expect(rows[512]).toBeLessThanOrEqual(512);
    expect(rows[0]).toBeGreaterThanOrEqual(0);
    expect(rows[0]).toBeLessThan(30);                         // the top row is at +85°, near the texture's top
    for (let y = 1; y < 1024; y++) expect(rows[y]).toBeGreaterThanOrEqual(rows[y - 1]);
    const lat = 52.52, y = Math.floor((project(0, lat, 0).y / TILE) * 1024);   // Berlin's Mercator row at size 1024
    expect(rows[y]).toBeCloseTo(((90 - lat) / 180) * 1024, -1);
  });

  it('places the view on the base, split in two across ±180° and clipped to the world', () => {
    const at = { lon: 13.4, lat: 52.52, z: 7 };
    const [r] = underlayRects(at, W, H, 2, 1024);
    const k = 1024 / worldSize(7), c = project(at.lon, at.lat, 7);
    expect(r[0]).toBeCloseTo((c.x - W / 2) * k, 6);
    expect(r[1]).toBeCloseTo((c.y - H / 2) * k, 6);
    expect(r.slice(2)).toEqual([W * k, H * k, 0, 0, W * 2, H * 2]);

    const split = underlayRects({ lon: 179.99, lat: 0, z: 5 }, W, H, 2, 1024);
    expect(split).toHaveLength(2);
    expect(split[0][2] + split[1][2]).toBeCloseTo(W * (1024 / worldSize(5)), 6);
    expect(split[1][0]).toBe(0);                              // the second part starts at the base's left edge
    expect(split[0][4] + split[0][6]).toBeCloseTo(split[1][4], 6);

    const top = underlayRects({ lon: 0, lat: 85.05, z: 4 }, W, H, 2, 1024);
    expect(top).toHaveLength(1);
    expect(top[0][1]).toBe(0);                                // the source starts at the world's top row
    expect(top[0][5]).toBeCloseTo(H, 0);                      // drawn from mid-screen down: above it is off the world
  });
});
