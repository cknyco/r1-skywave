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
// Runtime Radio Browser server. The build discovers servers via /json/servers; on 2026-09-25 de1 was the only one.
export const RB_BASE = 'https://de1.api.radio-browser.info';
