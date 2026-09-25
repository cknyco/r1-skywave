import { distanceKm } from '../../src/geo/sphere';
import type { Gazetteer } from './gazetteer';
import type { Place } from './places';

export interface PlacesJson {
  v: string;
  lat: number[];
  lon: number[];
  count: number[];
  name: string[];
  cc: string[];
  tzi: number[];
  tzs: string[];
}

export type ChunkRow = [place: number, id: string, name: string, url: string, codec: string, bitrate: number, tags: string];
export interface ChunkJson { v: string; rows: ChunkRow[] }

const r3 = (x: number) => Math.round(x * 1000) / 1000;

function majority<T>(xs: T[]): T {
  const m = new Map<T, number>();
  let best = xs[0], n = 0;
  for (const x of xs) {
    const c = (m.get(x) ?? 0) + 1;
    m.set(x, c);
    if (c > n) { n = c; best = x; }
  }
  return best;
}

export function emit(places: Place[], gazetteer: Gazetteer, v: string) {
  const out: PlacesJson = { v, lat: [], lon: [], count: [], name: [], cc: [], tzi: [], tzs: [] };
  const tzIndex = new Map<string, number>();
  const chunks = new Map<string, ChunkJson>();

  // Name every place; places with the same name within 60 km become one dot (as on radio.garden).
  const named: { p: Place; cc: string; name: string; tz: string }[] = [];
  const byCity = new Map<string, number[]>();
  for (const p of places) {
    const cc = majority(p.stations.map(s => s.cc));
    const city = gazetteer.nearest(p.lat, p.lon, cc);
    const wide = city ?? gazetteer.nearest(p.lat, p.lon, cc, 250);
    const state = majority(p.stations.map(s => s.state).filter(Boolean));
    const name = city?.name ?? state ?? (wide ? `near ${wide.name}` : cc);
    const key = `${name}|${cc}`;
    const host = (byCity.get(key) ?? []).find(h => distanceKm(named[h].p.lon, named[h].p.lat, p.lon, p.lat) <= 60);
    if (host !== undefined) {
      named[host].p = { ...named[host].p, stations: [...named[host].p.stations, ...p.stations] };
      continue;
    }
    byCity.set(key, [...(byCity.get(key) ?? []), named.length]);
    named.push({ p, cc, name, tz: wide?.tz ?? '' });
  }

  named.forEach(({ p, cc, name, tz }, i) => {
    if (!tzIndex.has(tz)) { tzIndex.set(tz, out.tzs.length); out.tzs.push(tz); }
    out.lat.push(r3(p.lat));
    out.lon.push(r3(p.lon));
    out.count.push(p.stations.length);
    out.name.push(name);
    out.cc.push(cc);
    out.tzi.push(tzIndex.get(tz)!);

    const chunk = chunks.get(cc) ?? { v, rows: [] };
    chunks.set(cc, chunk);
    [...p.stations]
      .sort((a, b) => b.clicks - a.clicks || b.votes - a.votes)
      .forEach(s => chunk.rows.push([i, s.id, s.name, s.url, s.codec, s.bitrate, s.tags.join(',')]));
  });
  return { placesJson: out, chunks };
}

export function sanityCheck(p: PlacesJson, stationCount: number, minStations = 5000, minPlaces = 2000): void {
  if (stationCount < minStations || p.lat.length < minPlaces) {
    throw new Error(`dataset suspiciously small: ${stationCount} stations, ${p.lat.length} places`);
  }
}
