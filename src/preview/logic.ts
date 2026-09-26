import type { PlayerState } from '../audio/player';
import type { Places, StationRow } from '../data/store';
import type { ListModel } from '../ui/list';
import { findPlace, type Intent } from '../voice/intent';

export const HINT = ['wheel: places · side: play/stop', 'hold: voice · tap: list'];
export const LIST_HINT = 'side: play · hold: ♥ · tap: close';
export const NOTE = {
  listening: 'listening…',
  thinking: 'thinking…',
  noVoice: 'voice unavailable',
  noMatch: 'no match',
  noData: 'no signal',
};

/** Storage key 'last'. `id` (Ruling 38) is newer than `place`/`name`/`cc` — an older save simply has no `id`. */
export interface Last { place: number; name?: string; cc?: string; id?: string }

export interface ScreenModel { status: string; place: string; where: string; count: string; station: string; live: boolean }

export interface ListView { title: string; rows: { i: number; name: string; fav: boolean; sel: boolean }[] }

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

/** What goes into storage key 'last': the index (as Task 18 reads it) plus the name, which survives a new dataset. */
export function lastOf(places: Places, p: number): Last {
  return { place: p, name: places.name[p], cc: places.cc[p] };
}

/** The named place, else the biggest place of the named country. Genre-only requests give -1 in the preview. */
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

export const viewport = (w: number, h: number) => ({ w: w > 0 ? w : 240, h: h > 0 ? h : 282 });

export function screenModel(
  places: Places, place: number, state: PlayerState, station: StationRow | null, note: string, now: Date,
): ScreenModel {
  if (place < 0) return { status: note, place: '', where: '', count: '', station: '', live: false };
  const here = station && station.place === place ? station : null;
  return {
    status: note || statusText(state),
    place: places.name[place],
    where: whereLine(places.cc[place], places.tz[place], now),
    count: stationCount(places.count[place]),
    station: here ? here.name : '',
    live: state === 'playing' && here !== null,
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

export function listView(list: ListModel, favs: Set<string>, placeName: string): ListView {
  const w = list.window(7);
  return {
    title: `${placeName} · ${stationCount(list.rows.length)}`,
    rows: w.rows.map((r, k) => ({ i: w.offset + k, name: r.name, fav: favs.has(r.id), sel: w.offset + k === list.sel })),
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
