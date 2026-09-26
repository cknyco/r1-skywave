// The app's pure logic (Task 18; grown out of the sound preview's src/preview/logic.ts, Task P): start place, the
// strip and list text, the About text, the double tap, and the player shared by the Tuner and the station list.
import type { PlayerState } from '../audio/player';
import type { Places, StationRow } from '../data/store';
import type { ListModel } from '../ui/list';
import { NEW_HEADER } from '../ui/news';
import { findPlace, type Intent } from '../voice/intent';

/** Controls, shown under the gate button. */
export const HINT = ['wheel: places · side: play/stop', 'hold: voice · drag: move the map', 'tap the strip: stations'];
export const LIST_HINT = 'side: play · hold: ♥ · tap: close';
export const NOTE = {
  listening: 'listening…',
  thinking: 'thinking…',
  noVoice: 'voice unavailable',
  noMatch: 'no match',
  noData: 'no signal',
};

/** About screen (Task 20): the attribution text of A.8. */
export const ABOUT_TITLE = 'Skywave';
export const ABOUT = [
  'Live radio from places around the world.',
  'Station data: Radio Browser (public domain).',
  'Place names: GeoNames (CC BY 4.0).',
  'Map imagery: EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel '
    + 'data 2016), CC BY 4.0, https://maps.eox.at. Tiles dimmed.',
  "Globe imagery: We acknowledge the use of imagery provided by services from NASA's Global Imagery Browse Services "
    + "(GIBS), part of NASA's Earth Science Data and Information System (ESDIS).",
];
export const ABOUT_HINT = 'tap to close';

/** Storage key 'last'. `id` (Ruling 38) is newer than `place`/`name`/`cc` — an older save simply has no `id`. */
export interface Last { place: number; name?: string; cc?: string; id?: string }

/** The bottom strip, the status line and the ring. */
export interface StripModel { status: string; name: string; where: string; live: boolean; ring: '' | 'tuning' | 'live' }

export interface ListView { title: string; rows: { i: number; name: string; fav: boolean; sel: boolean; head: boolean }[] }

type Noise = { start(): void; stop(): void };
export interface PlayerLike { play(url: string): Promise<PlayerState>; stop(): void; readonly state: PlayerState }

/** Index of the place with the most stations among those `pick` accepts; -1 when none. */
export function biggest(places: Places, pick: (i: number) => boolean): number {
  let best = -1;
  for (let i = 0; i < places.n; i++) if (pick(i) && (best < 0 || places.count[i] > places.count[best])) best = i;
  return best;
}

function resolveLast(places: Places, last: Last | null): number {
  if (!last || typeof last.place !== 'number') return -1;
  const p = last.place;
  const inRange = Number.isInteger(p) && p >= 0 && p < places.n;
  if (inRange && (last.name === undefined || places.name[p] === last.name)) return p;
  if (typeof last.name !== 'string') return -1;
  return biggest(places, i => places.name[i] === last.name && (!last.cc || places.cc[i] === last.cc));
}

/** ?place= query, then the saved place, then the biggest place in the device time zone, then the biggest overall. */
export function startPlace(places: Places, query: string | null, last: Last | null, deviceTz: string): number {
  if (query) {
    const q = findPlace(places, { place: query, country: null, genre: null });
    if (q >= 0) return q;
  }
  const l = resolveLast(places, last);
  if (l >= 0) return l;
  const t = deviceTz ? biggest(places, i => places.tz[i] === deviceTz) : -1;
  return t >= 0 ? t : biggest(places, () => true);
}

/** What goes into storage key 'last': the index plus the name, which finds the place again in a new dataset. */
export function lastOf(places: Places, p: number): Last {
  return { place: p, name: places.name[p], cc: places.cc[p] };
}

/** The named place, else the biggest place of the named country. Genre-only requests give -1 (no genre search yet). */
export function placeForIntent(places: Places, intent: Intent): number {
  const p = findPlace(places, intent);
  if (p >= 0 || !intent.country) return p;
  return biggest(places, i => places.cc[i] === intent.country);
}

let regions: Intl.DisplayNames | null = null;

export function countryName(cc: string): string {
  try {
    regions ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regions.of(cc) ?? cc;
  } catch {
    return cc;
  }
}

export function localTime(tz: string, now: Date): string {
  if (!tz) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: tz }).format(now);
  } catch {
    return '';
  }
}

export function whereLine(cc: string, tz: string, now: Date): string {
  return [countryName(cc), localTime(tz, now)].filter(Boolean).join(' · ');
}

export const stationCount = (n: number) => `${n} station${n === 1 ? '' : 's'}`;

export function statusText(s: PlayerState): string {
  return s === 'playing' ? 'live' : s === 'loading' ? 'tuning…' : s === 'error' ? 'no signal' : '';
}

export const msToNextMinute = (nowMs: number) => 60000 - (nowMs % 60000);

/** The app's CSS size: the WebView's inner size (240×292 on the r1, Ruling 19), 240×282 when it reports none yet. */
export const viewport = (w: number, h: number) => ({ w: w > 0 ? w : 240, h: h > 0 ? h : 282 });

/** Strip: the station on air (amber while live) or the place's station count, then "Place · Country · HH:MM". */
export function stripModel(
  places: Places, place: number, state: PlayerState, station: StationRow | null, note: string, now: Date,
): StripModel {
  if (place < 0) return { status: note, name: '', where: '', live: false, ring: '' };
  const here = station && station.place === place ? station : null;
  const live = state === 'playing' && here !== null;
  return {
    status: note || statusText(state),
    name: here ? here.name : stationCount(places.count[place]),
    where: [places.name[place], whereLine(places.cc[place], places.tz[place], now)].filter(Boolean).join(' · '),
    live,
    ring: live ? 'live' : state === 'loading' ? 'tuning' : '',
  };
}

function allowedUrl(u: string): boolean {
  try {
    const { protocol, hostname } = new URL(u);
    return protocol === 'https:' && hostname !== 'radio.garden' && !hostname.endsWith('.radio.garden');
  } catch {
    return false;
  }
}

/** Defence in depth over the build filters: https streams only, and never a radio.garden host. */
export const playable = (rows: StationRow[]) => rows.filter(r => allowedUrl(r.url));

/** The list's title line: the place and its station count, or how many new stations there are. */
export function listTitle(list: ListModel, placeName: string, newMode: boolean): string {
  const n = list.rows.filter(r => r.id !== NEW_HEADER).length;
  return newMode ? `New stations · ${n}` : `${placeName} · ${stationCount(n)}`;
}

/** Seven rows around the selection; the "★ New stations" header row is marked and never a favourite. */
export function listView(list: ListModel, favs: Set<string>, title: string): ListView {
  const w = list.window(7);
  return {
    title,
    rows: w.rows.map((r, k) => {
      const head = r.id === NEW_HEADER;
      return { i: w.offset + k, name: r.name, fav: !head && favs.has(r.id), sel: w.offset + k === list.sel, head };
    }),
  };
}

/** Feed it every tap (time in ms, position in px): true on a second tap within `ms` and `px` of the first. */
export function doubleTap(ms = 400, px = 24): (t: number, x: number, y: number) => boolean {
  let first: { t: number; x: number; y: number } | null = null;
  return (t, x, y) => {
    const hit = first !== null && t - first.t <= ms && Math.hypot(x - first.x, y - first.y) <= px;
    first = hit ? null : { t, x, y };
    return hit;
  };
}

/**
 * One player, two callers. The list plays its pick through `direct`; a Tuner loop still connecting would
 * read the superseded play as a dead station and start the next one over the pick. While a pick owns the
 * player, the Tuner's plays never start and never resolve (the loop is dropped, nothing is marked bad) and
 * its static stays off. `reattach` hands the player back before the next select() or toggle().
 */
export function sharePlayer(p: PlayerLike, noise: () => Noise | undefined): {
  player: PlayerLike; noise: Noise; direct(url: string): Promise<PlayerState>; reattach(): void;
} {
  let picked = false;
  const parked = () => new Promise<PlayerState>(() => {});
  return {
    player: {
      play: url => (picked ? parked() : p.play(url).then(r => (picked ? parked() : r))),
      stop: () => p.stop(),
      get state() { return p.state; },
    },
    noise: {
      start() { if (!picked) noise()?.start(); },
      stop() { noise()?.stop(); },
    },
    direct(url) {
      picked = true;
      noise()?.stop();
      return p.play(url);
    },
    reattach() { picked = false; },
  };
}
