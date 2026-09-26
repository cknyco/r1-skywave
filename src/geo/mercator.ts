import { RAD } from './sphere';

export const TILE = 256;
export const MAX_LAT = 85.05112878;

export interface Cam { lon: number; lat: number; z: number }

export const worldSize = (z: number) => TILE * 2 ** z;

export function project(lon: number, lat: number, z: number): { x: number; y: number } {
  const s = worldSize(z);
  const phi = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD;
  return {
    x: ((lon + 180) / 360) * s,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * s,
  };
}

export function unproject(x: number, y: number, z: number): { lon: number; lat: number } {
  const s = worldSize(z);
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { lon: (x / s) * 360 - 180, lat: Math.atan(Math.sinh(n)) / RAD };
}

export function screenOf(lon: number, lat: number, cam: Cam, w: number, h: number): { x: number; y: number } {
  const s = worldSize(cam.z);
  const c = project(cam.lon, cam.lat, cam.z);
  const p = project(lon, lat, cam.z);
  let dx = p.x - c.x;
  if (dx > s / 2) dx -= s;
  if (dx < -s / 2) dx += s;
  return { x: Math.round((w / 2 + dx) * 1000) / 1000, y: Math.round((h / 2 + (p.y - c.y)) * 1000) / 1000 };
}
