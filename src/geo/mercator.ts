import { FLAT_FROM, GLOBE_BELOW_ZOOM } from '../config';
import { RAD, smoothstep } from './sphere';

export const TILE = 256;
export const MAX_LAT = 85.05112878;

export interface Cam { lon: number; lat: number; z: number }

export const worldSize = (z: number) => TILE * 2 ** z;

/** The globe's size against the Web Mercator scale: 75 % up to zoom 1.5, so the whole globe and its glow fit, 100 % from 4. */
export const globeEase = (z: number): number => 0.75 + 0.25 * smoothstep(1.5, 4, z);

/** Web Mercator's scale at zoom z on the equator: CSS px per radian. */
export const pxPerRad = (z: number): number => worldSize(z) / (2 * Math.PI);

/**
 * The globe radius in CSS px at zoom z, looking at latitude lat: the Web Mercator scale there (so the hand-over to the
 * tiles at zoom 4 lines up), eased by globeEase; the latitude counts at most as cos .2 (near the poles).
 */
export function globeRadius(z: number, lat: number): number {
  return (pxPerRad(z) / Math.max(0.2, Math.cos(lat * RAD))) * globeEase(z);
}

/** How far both globes have flattened into the tiles' Web Mercator at zoom z: 0 up to FLAT_FROM, 1 from zoom 4. */
export const flatness = (z: number): number => smoothstep(FLAT_FROM, GLOBE_BELOW_ZOOM, z);

/** Web Mercator's y of latitude phi (radians) in radians, ln tan(π/4 + φ/2), the latitude clamped to MAX_LAT as `project`. */
export const mercY = (phi: number): number => Math.log(Math.tan(Math.PI / 4 + Math.max(-MAX_LAT * RAD, Math.min(MAX_LAT * RAD, phi)) / 2));

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
