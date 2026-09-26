// The station pipeline of build-data.ts: Radio Browser rows → one station per stream → places, with every step
// that picks one station over another preferring the ids of the previous snapshot (Rulings 39 and 42).
import { existsSync, readFileSync } from 'node:fs';
import { isLegacy, parseSnapshot, type Snapshot } from './changelog';
import { normalize, type Station } from './normalize';
import { aggregate, capFamilies, type Place } from './places';
import type { RBStation } from './radiobrowser';

/**
 * The previous snapshot's stations and the ones it lost in the last 90 days (`gone`). A listing that failed a
 * check for a run left its stream, broadcaster slot or place anchor to a stand-in; both are preferred then, and
 * votes and uuid give it back to the listing that held it before (Ruling 42). The gone list of a v1 snapshot is
 * the click churn of Task 8b: the rebaseline forgets it, and so does the preference.
 */
export function preferredIds(snap: Snapshot): Set<string> {
  return new Set([...Object.keys(snap.stations), ...(isLegacy(snap) ? [] : Object.keys(snap.gone))]);
}

/** PREV_SNAPSHOT: no path or no file (the first run) prefers nothing; an unreadable file warns and prefers nothing. */
export function readPrefer(path: string | undefined, warn: (line: string) => void = console.log): Set<string> {
  if (!path || !existsSync(path)) return new Set();
  try {
    return preferredIds(parseSnapshot(readFileSync(path, 'utf8')));
  } catch (e) {
    warn(`::warning::previous snapshot ${path} unreadable (${(e as Error).message}); no station is preferred`);
    return new Set();
  }
}

/** Dedupe by stream, cluster into places, cap broadcasters: all three with the same preference. */
export function stationPlaces(
  rows: RBStation[],
  opts: { allowHttp: boolean; allowHls: boolean; prefer?: ReadonlySet<string> },
): { stations: Station[]; places: Place[] } {
  const stations = normalize(rows, opts);
  return { stations, places: capFamilies(aggregate(stations, opts.prefer), opts.prefer) };
}
