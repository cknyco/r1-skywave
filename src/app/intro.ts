// The start (the user's r1 test, 2026-10-18): every start shows the whole globe on the station's place right after the
// gate's tap, then dives to the landing zoom (src/main.ts). ?z=<zoom> sets the landing zoom for the comparison on the
// device; ?intro=0 skips the globe (the e2e tests that start at a place).
import { INTRO_FILL, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from '../config';
import { globeEase, TILE } from '../geo/mercator';
import { RAD } from '../geo/sphere';

/** The landing zoom: ?z= clamped to ZOOM_MIN..ZOOM_MAX, or ZOOM_DEFAULT when it is missing or not a number. */
export function landingZoom(search: string): number {
  const s = new URLSearchParams(search).get('z');
  const z = s === null || !s.trim() ? NaN : Number(s);
  return Number.isFinite(z) ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z)) : ZOOM_DEFAULT;
}

/** Whether the start shows the whole globe first: always, unless ?intro=0. */
export const wantsIntro = (search: string): boolean => new URLSearchParams(search).get('intro') !== '0';

/**
 * The start's zoom at latitude lat in a w×h view: the globe's radius (globeRadius, which grows with the latitude) is
 * INTRO_FILL of the narrower side. globeRadius solved for z; globeEase barely changes, so a few rounds settle it. At most
 * zoom 3 (a globe on a large screen), at least 0 (beyond about 72° the globe is then a little larger).
 */
export function introZoom(lat: number, w: number, h: number): number {
  const R = INTRO_FILL * Math.min(w, h), c = Math.max(0.2, Math.cos(lat * RAD));
  let z = 1;
  for (let k = 0; k < 4; k++) z = Math.log2((R * 2 * Math.PI * c) / (TILE * globeEase(z)));
  return Math.max(0, Math.min(3, z));
}
