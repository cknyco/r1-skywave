export const LONG_PRESS_MS = 600;       // desktop fallback only; the device sends longPressStart itself
export const GATE_TRY_MS = 150;         // a side click at the gate: how long play() may stay pending before it counts as allowed
export const CITIES_WAIT_MS = 2000;     // a transcript waits this long for the voice city list (cities.js) still loading
export const SETTLE_MS = 700;           // wheel rest before tuning
export const CONNECT_TIMEOUT_MS = 12000;
export const ZOOM_DEFAULT = 7;          // region level, a handful of dots
export const ZOOM_MIN = 1.4;            // whole globe fits the screen
export const ZOOM_MAX = 11;
export const GLOBE_BELOW_ZOOM = 4;      // globe renderer below, tiles at and above
export const RING_RADIUS = 10;          // px, the visible tuning ring
export const CATCH_RADIUS = 28;         // px, the pick: a place this close to the centre is caught and glides into the ring
// Look A's station lights (src/map/lights.ts): every place in view glows; the places the ring can catch are golden.
// Faint: the places the ring cannot catch at this zoom, at LIGHT_FAINT of their level (a lone one still reads golden; a
// catchable light is ≥ 1.3× as bright) and LIGHT_FAINT_SIZE of their size (never beyond the smallest catchable light).
// Their cap acts within LIGHT_DOT px (3×3 cells of ⅓ px; not eased with the globe, unlike the golden cap), so dense
// regions glow as in look A and lights stacked on one spot stay below LIGHT_CAP[0].
export const LIGHT_FAINT = 0.8;
export const LIGHT_FAINT_SIZE = 1.2;
export const LIGHT_DOT = 1;            // px: the faint layer's cap window
export const LIGHT_MERGE = 1;          // px: the Canvas 2D globe's faint merge cell below FLAT_FROM (its frame time)
export const LIGHT_CELL = 12;          // px, the golden layer's cap cell (× globeEase on the globe)
// Every light, the selected one too, fades towards the limb over the last LIGHT_LIMB of depth (look A: 0.3). Seen
// edge-on, a dense region packs 1/depth more lights into each px, over the bright atmosphere rim: at 0.3 Europe on the
// limb composed white (smallest channel up to 217 measured on the WebGL globe, the selected light 254). At 0.6 it stays
// below white even over the brightest ground (tests/map/lightsdata.test.ts; 201 measured), and a face (depth over 0.6,
// all of Europe in look A's view) keeps its lights as they were (final fix wave, finding A1).
export const LIGHT_LIMB = 0.6;
export const LIGHT_CAP = [0.6, 1.75];  // most summed level of a cap window: faint layer, golden layer (above ~1.79 it could compose to white)
export const LIGHT_SPRITE = 64;        // px, the glow sprite
export const LIGHT_MAX = 30;           // CSS px, the largest light (lightSize's cap)
export const FLAT_FROM = 3.5;          // zoom where the globes start to flatten into Mercator (Task 6); faint-light merging stops here
// Blue marble on tiles and the Canvas 2D globe: out = a·OVER + (1 − a)·MUL·c per channel, the per-channel fit of
// look A's luminance ramp (within 4 levels on ocean, land, ice, cloud; 9 on bright desert).
export const TINT_MUL = [55, 72, 72];
export const TINT_OVER = [13, 52, 190, 0.25];
// The automatic choice (?globe unset): WebGL when the median of GL_PROBE_FRAMES timed frames of a globe filling the
// screen (zoom GL_PROBE_Z), GPU finish included, stays under GL_FRAME_LIMIT_MS; else the Canvas 2D globe.
export const GL_FRAME_LIMIT_MS = 12;
export const GL_PROBE_FRAMES = 5;      // after one untimed warm-up frame
export const GL_PROBE_Z = 3.5;
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
