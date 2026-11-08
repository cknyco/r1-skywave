import type { Cam } from '../geo/mercator';
import { angleBetween, fromVec, lerp, RAD, slerp, toVec, wrapLon, type Vec3 } from '../geo/sphere';

export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

export interface Flight { from: Cam; to: Cam; a: Vec3; b: Vec3; t0: number; dur: number; peakZ: number }

/**
 * A flight from one camera to another; a glide (glide true) is always the short hop, however far it goes. A flight of
 * ms > 0 takes ms and eases its zoom straight from one end to the other (the start's dive from the whole globe), where
 * a short hop would hold the zoom for its first half and do the whole climb in the last 250 ms.
 */
export function planFlight(from: Cam, to: Cam, t0: number, glide = false, ms = 0): Flight {
  const a = toVec(from.lon, from.lat), b = toVec(to.lon, to.lat);
  if (ms > 0) return { from, to, a, b, t0, dur: ms, peakZ: (from.z + to.z) / 2 };
  const om = angleBetween(a, b);
  const short = glide || om < 2 * RAD;
  const dn = Math.min(1, om / Math.PI);
  return {
    from, to, a, b, t0,
    dur: short ? 500 : Math.round(1200 + 1400 * dn),
    peakZ: short ? Math.min(from.z, to.z) : Math.min(from.z, to.z, 3.6 - 2.2 * dn),
  };
}

export function sampleFlight(f: Flight, now: number): { cam: Cam; done: boolean } {
  const t = Math.min(1, Math.max(0, (now - f.t0) / f.dur));
  if (t >= 1) return { cam: { ...f.to }, done: true };
  const e = easeInOutSine(t);
  const p = fromVec(slerp(f.a, f.b, e));
  const z = e < 0.5 ? lerp(f.from.z, f.peakZ, e * 2) : lerp(f.peakZ, f.to.z, (e - 0.5) * 2);
  return { cam: { lon: p.lon, lat: p.lat, z }, done: false };
}

/** The camera is on lon/lat: the glide's end, judged on the camera, not on screen pixels a renderer may quantise. */
export function atPlace(cam: Cam, lon: number, lat: number): boolean {
  return Math.abs(wrapLon(cam.lon - lon)) < 1e-6 && Math.abs(cam.lat - lat) < 1e-6;
}
