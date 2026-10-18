import type { Places } from '../../data/store';
import { type Cam, flatness, globeRadius, mercY, pxPerRad } from '../../geo/mercator';
import { RAD, toVec, wrapLon } from '../../geo/sphere';
import { MARGIN, type ScreenDot } from '../lod';

// The globe's projection, pure math shared by the Canvas 2D globe (app.js) and the WebGL globe (globe-gl.js): no WebGL
// and no DOM in this file, so app.js can bundle it.

/**
 * What a globe view shows: centred on lon/lat (degrees) in a w×h CSS-pixel view, the centre at (w/2, h/2), radius R;
 * flattened by `flat` (0 orthographic, 1 the tiles' Web Mercator at k CSS px per radian).
 */
export interface GlFrame { lon: number; lat: number; R: number; w: number; h: number; k: number; flat: number }

/** The WebGL globe's frame for the camera: R = globeRadius(cam.z, cam.lat), unrounded; k and flat for cam.z. */
export function glFrame(cam: Cam, w: number, h: number): GlFrame {
  return { lon: cam.lon, lat: cam.lat, R: globeRadius(cam.z, cam.lat), w, h, k: pxPerRad(cam.z), flat: flatness(cam.z) };
}

interface Point { x: number; y: number; z: number }

/**
 * The view f as a function of a place's unit vector (x east, y north, z toward lon 0 on the equator), longitude
 * (degrees) and mercY: it sets `out` to the screen position (CSS px), the orthographic one mixed by f.flat with the
 * tiles' Web Mercator one (screenOf's), and the orthographic depth (1 facing the viewer, 0 at the limb), and says
 * whether the place is on the visible side.
 */
function viewOf(f: GlFrame): (x: number, y: number, z: number, lon: number, my: number, out: Point) => boolean {
  const l = -f.lon * RAD, p = f.lat * RAD, cl = Math.cos(l), sl = Math.sin(l), cp = Math.cos(p), sp = Math.sin(p);
  const cx = f.w / 2, cy = f.h / 2, { R, k, flat } = f, m0 = mercY(p);
  return (x, y, z, lon, my, out) => {
    const ox = cx + (cl * x + sl * z) * R, oy = cy - (sp * sl * x + cp * y - sp * cl * z) * R;
    out.z = -cp * sl * x + sp * y + cp * cl * z;
    out.x = ox + flat * (cx + k * wrapLon(lon - f.lon) * RAD - ox);
    out.y = oy + flat * (cy - k * (my - m0) - oy);
    return out.z > 0;
  };
}

const units = new WeakMap<Places, Float64Array>();

/** x, y, z (as toVec) and mercY per place, made on first use for a given Places. */
function unitVectors(places: Places): Float64Array {
  let u = units.get(places);
  if (!u) {
    u = new Float64Array(4 * places.n);
    for (let j = 0; j < places.n; j++) u.set([...toVec(places.lon[j], places.lat[j]), mercY(places.lat[j] * RAD)], 4 * j);
    units.set(places, u);
  }
  return u;
}

/** Where lon/lat lies in the view f (CSS px, with its depth z), wherever that is on screen; null on the far side. */
export function projectGl(f: GlFrame, lon: number, lat: number): Point | null {
  const out = { x: 0, y: 0, z: 0 };
  return viewOf(f)(...toVec(lon, lat), lon, mercY(lat * RAD), out) ? out : null;
}

/**
 * The places `keep` admits on the visible side of the view f, each exactly where projectGl puts it, with its depth;
 * places more than MARGIN px beyond the view are left out.
 */
export function orthoPlaces(places: Places, keep: (i: number) => boolean, f: GlFrame): ScreenDot[] {
  const at = viewOf(f), u = unitVectors(places), p = { x: 0, y: 0, z: 0 }, out: ScreenDot[] = [];
  for (let j = 0; j < places.n; j++) {
    if (!at(u[4 * j], u[4 * j + 1], u[4 * j + 2], places.lon[j], u[4 * j + 3], p) || !keep(j)) continue;
    if (p.x < -MARGIN || p.x > f.w + MARGIN || p.y < -MARGIN || p.y > f.h + MARGIN) continue;
    out.push({ i: j, x: p.x, y: p.y, count: places.count[j], z: p.z });
  }
  return out;
}

/**
 * The place under the CSS pixel (x, y) of the view f, by the globe fragment shader's math (without its 1e-3 nudge,
 * which only keeps the shader's atan off (0, 0) at a pole): the orthographic inverse mixed by f.flat, in longitude and
 * latitude, with the Web Mercator one; null off the disc, in space. It inverts projectGl exactly at flat 0 and 1 and to
 * within 2 px in between, where projectGl mixes on screen instead.
 */
export function unprojectGl(f: GlFrame, x: number, y: number): { lon: number; lat: number } | null {
  const dx = x - f.w / 2, dy = f.h / 2 - y, px = dx / f.R, py = dy / f.R, q = px * px + py * py;
  if (q >= 1) return null;
  const z = Math.sqrt(1 - q), p = f.lat * RAD, cp = Math.cos(p), sp = Math.sin(p), { k, flat } = f;
  const lon = Math.atan2(px, cp * z - sp * py), lat = Math.asin(Math.max(-1, Math.min(1, cp * py + sp * z)));
  return {
    lon: wrapLon(f.lon + (lon + flat * (dx / k - lon)) / RAD),
    lat: (lat + flat * (2 * Math.atan(Math.exp(mercY(p) + dy / k)) - Math.PI / 2 - lat)) / RAD,
  };
}

/**
 * The light pass's viewport for a W×H drawing buffer: m = ceil(maxPt / 2) device px wider on every side, so a point
 * whose centre lies just off-screen is still drawn (PowerVR clips points by their centre).
 */
export function lightViewport(W: number, H: number, maxPt: number): [number, number, number, number] {
  const m = Math.ceil(maxPt / 2);
  return [-m, -m, W + 2 * m, H + 2 * m];
}
