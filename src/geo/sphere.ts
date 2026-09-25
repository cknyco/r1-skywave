export const RAD = Math.PI / 180;
const EARTH_KM = 6371.0088;

export type Vec3 = [number, number, number];

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Unit vector: x east (lon 90), y north, z toward lon 0 on the equator. */
export function toVec(lon: number, lat: number): Vec3 {
  const c = Math.cos(lat * RAD);
  return [c * Math.sin(lon * RAD), Math.sin(lat * RAD), c * Math.cos(lon * RAD)];
}

export function fromVec(v: Vec3): { lon: number; lat: number } {
  const y = Math.max(-1, Math.min(1, v[1]));
  return { lon: Math.atan2(v[0], v[2]) / RAD, lat: Math.asin(y) / RAD };
}

export function angleBetween(a: Vec3, b: Vec3): number {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

export function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const om = angleBetween(a, b);
  if (om < 1e-9) return [a[0], a[1], a[2]];
  const s = Math.sin(om);
  const k1 = Math.sin((1 - t) * om) / s;
  const k2 = Math.sin(t * om) / s;
  return [k1 * a[0] + k2 * b[0], k1 * a[1] + k2 * b[1], k1 * a[2] + k2 * b[2]];
}

export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export function distanceKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
