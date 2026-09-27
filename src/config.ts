export const LONG_PRESS_MS = 600;       // desktop fallback only; the device sends longPressStart itself
export const SETTLE_MS = 700;           // wheel rest before tuning
export const CONNECT_TIMEOUT_MS = 12000;
export const ZOOM_DEFAULT = 7;          // region level, a handful of dots
export const ZOOM_MIN = 1.4;            // whole globe fits the screen
export const ZOOM_MAX = 11;
export const GLOBE_BELOW_ZOOM = 4;      // globe renderer below, tiles at and above
export const RING_RADIUS = 28;          // px, the tuning ring (radio.garden uses 28 on small screens)
export const DOT_CSS = '#E8A33D';       // amber dots (look A); '#00FF82' for look B
export const IMAGERY_DIM = 0.55;        // look A brightness of globe and tiles; 1 for look B
export const RING_COLOR = '#FFFFFF';
export const TEXTURE_URL = 'img/earth-2048.jpg';
// Ruling 46: tile prefetch. A flight requests its landing view at the start (at most LANDING_PREFETCH tiles); once the
// map has rested PREFETCH_DELAY_MS on a place, the wheel's next and previous places get at most NEIGHBOUR_PREFETCH each.
export const LANDING_PREFETCH = 16;
export const NEIGHBOUR_PREFETCH = 10;
export const PREFETCH_DELAY_MS = 1500;
// Ruling 49: the wheel is the volume, 5 % per wheel event, 0–100 % of the r1's own volume, shown for VOLUME_SHOW_MS.
// ✈ switches it to places; fly mode ends FLY_MS after the tap or the last wheel step, counted only while the map rests.
export const VOLUME_STEP = 5;
export const VOLUME_SHOW_MS = 1500;
export const VOLUME_SAVE_MS = 400;      // the volume is saved once the wheel has rested this long
export const FLY_MS = 3000;
// Runtime Radio Browser server. The build discovers servers via /json/servers; on 2026-09-25 de1 was the only one.
export const RB_BASE = 'https://de1.api.radio-browser.info';
