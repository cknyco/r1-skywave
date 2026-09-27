// The app's pure logic (Task 18; grown out of the sound preview's src/preview/logic.ts, Task P): start place, the
// strip and list text, the About text, and the player shared by the Tuner and the station list. What the wheel does on
// the map (volume or places, Ruling 49) is in src/app/wheel.ts.
import type { PlayerState } from '../audio/player';
import type { Places, StationRow } from '../data/store';
import type { ListModel } from '../ui/list';
import { isHeader } from '../ui/news';
import { findPlace, type Intent } from '../voice/intent';
import type { Matcher } from '../voice/match';
import { VOLUME_MUTED } from './wheel';

/** Controls, shown under the gate button (Ruling 49); the screen draws each ✈ as the ✈ button's own icon. */
export const HINT = ['wheel: volume · side: play/stop', '✈ then wheel: places · hold: voice', 'tap the strip: stations'];
export const LIST_HINT = 'side: play · hold: ♥ · tap: close';
export const FAV_HINT = 'side: play · hold: remove · tap: close';
/** Empty worldwide lists (Rulings 45, 47). */
export const EMPTY_NEW = 'No new stations yet. The list fills every night.';
export const EMPTY_FAVS = 'No favourites yet. Hold the side button on a station in a list to add it.';
export const NOTE = {
  listening: 'listening…',
  thinking: 'thinking…',
  noVoice: 'voice unavailable',
  noMatch: 'no match',
  noData: 'no signal',
  noPlace: 'place unknown',
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
export const ABOUT_HINT = 'wheel: scroll · tap or side: close';
/** The voice log under the credits (Ruling 44): the last bridge events of voice searches, for a photo from the device. */
export const DIAG_TITLE = 'Voice log (ms since the hold, event, message):';
export const DIAG_EMPTY = 'No voice search yet.';

/** Storage key 'last'. `id` (Ruling 38) is newer than `place`/`name`/`cc` — an older save simply has no `id`. */
export interface Last { place: number; name?: string; cc?: string; id?: string }

/** The bottom strip, the status line and the ring. */
export interface StripModel { status: string; name: string; where: string; live: boolean; ring: '' | 'tuning' | 'live' }

/** What the list shows: the place's stations with the two header rows, or a worldwide list (Rulings 45, 47). */
export type ListMode = 'place' | 'new' | 'favs';

export interface ListView {
  title: string;
  rows: { i: number; name: string; fav: boolean; sel: boolean; head: boolean }[];
  empty: string[];   // lines shown instead of rows when there are none
  hint: string;
}

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

/**
 * Where an LLM intent points. With the voice matcher (Ruling 44) the place is read in the named country, so "New York"
 * finds New York City, "London" with CA finds London, Canada, and a big city without a place of its own ("Tokyo") the
 * place standing for it. Without the matcher, or when it finds nothing: the named place, else the biggest place of the
 * named country. Genre-only requests give -1 (no genre search yet).
 */
export function placeForIntent(places: Places, intent: Intent, matcher?: Matcher): number {
  if (matcher && intent.place) {
    const m = matcher.match(intent.place, intent.country);
    if (m >= 0) return m;
  }
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

/**
 * The status line: a note, or the player's state, with "muted" added while the volume is 0 (Ruling 49), so a radio
 * reopened at 0 % never looks live and silent. A note wins: it is short-lived, and "muted" after it could reach ✈.
 */
export const statusLine = (state: PlayerState, note: string, muted: boolean): string =>
  note || [statusText(state), muted ? VOLUME_MUTED : ''].filter(Boolean).join(' · ');

/**
 * Strip: the station on air (amber while live) or the place's station count, then "Place · Country · HH:MM".
 * `muted`: the audio element reads back a volume of 0.
 */
export function stripModel(
  places: Places, place: number, state: PlayerState, station: StationRow | null, note: string, now: Date, muted = false,
): StripModel {
  if (place < 0) return { status: statusLine('idle', note, muted), name: '', where: '', live: false, ring: '' };
  const here = station && station.place === place ? station : null;
  const live = state === 'playing' && here !== null;
  return {
    status: statusLine(state, note, muted),
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

/** The list's title line: the place and its station count, or the worldwide list and its length. */
export function listTitle(list: ListModel, placeName: string, mode: ListMode): string {
  const n = list.rows.filter(r => !isHeader(r.id)).length;
  return mode === 'new' ? `New stations worldwide · ${n}` : mode === 'favs' ? `My favourites · ${n}` : `${placeName} · ${stationCount(n)}`;
}

/**
 * Seven rows around the selection; header rows are marked and never favourites; the favourites list needs no ♥ marks.
 * An empty worldwide list explains itself; the new-stations one adds the date of the data (`updated`).
 */
export function listView(list: ListModel, favs: Set<string>, title: string, mode: ListMode = 'place', updated = ''): ListView {
  const w = list.window(7);
  const empty = w.rows.length ? []
    : mode === 'favs' ? [EMPTY_FAVS]
      : mode === 'new' ? [EMPTY_NEW, ...(updated ? [`Last update: ${updated}`] : [])]
        : ['no stations here'];
  return {
    title,
    rows: w.rows.map((r, k) => {
      const head = isHeader(r.id);
      return { i: w.offset + k, name: r.name, fav: !head && mode !== 'favs' && favs.has(r.id), sel: w.offset + k === list.sel, head };
    }),
    empty,
    hint: mode === 'favs' ? FAV_HINT : LIST_HINT,
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
