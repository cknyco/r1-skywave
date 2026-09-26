import type { Cam } from '../geo/mercator';
import { angleBetween, fromVec, lerp, RAD, slerp, toVec, type Vec3 } from '../geo/sphere';

export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

export interface Flight { from: Cam; to: Cam; a: Vec3; b: Vec3; t0: number; dur: number; peakZ: number }

export function planFlight(from: Cam, to: Cam, t0: number): Flight {
  const a = toVec(from.lon, from.lat), b = toVec(to.lon, to.lat);
  const om = angleBetween(a, b);
  const short = om < 2 * RAD;
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
