import { distanceKm } from '../../src/geo/sphere';
import { BIG_CITY_KM, BIG_CITY_POP, type City, type Gazetteer } from './gazetteer';
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

// Ruling 51: a place most of whose stations name a city in their `state` takes that city's name when the city is
// more populous than the gazetteer's pick and near: within LISTED_CITY_KM, or within BIG_CITY_KM for a city of
// BIG_CITY_POP or more (as the big-city rule allows). Stations placed at Thessaloníki join a place anchored in
// Kalamariá, 4.5 km out, and 67 of its 70 stations say Thessaloniki; four stations at Bur Dubai, two of which say
// Dubai and none anything else, lie 19.4 km from GeoNames' Dubai point and 13.3 km from Sharjah. "Name" means
// CityPlacer.cityOf, so a state that is also a region names its city only as placement allows: Guarulhos stays
// Guarulhos although its stations say São Paulo. Stations without a state do not count; states naming no city count
// against (Ludwigshafen, 3 of 15 for Mannheim, keeps its name).
export const LISTED_CITY_KM = 10;

/** The city the `state` of more than half of a place's stations that give one names, if any. */
function listedCity(p: Place, cc: string, cityOf: (cc: string, state: string) => City | null): City | null {
  const votes = new Map<City, number>();
  let voters = 0;
  for (const s of p.stations) {
    if (!s.state) continue;
    voters++;
    const c = cityOf(cc, s.state);
    if (c) votes.set(c, (votes.get(c) ?? 0) + 1);
  }
  for (const [c, n] of votes) if (n * 2 > voters) return c;
  return null;
}

/** `cityOf`: the city a state names in a country, if any (CityPlacer.cityOf); without it the gazetteer alone names places. */
export function emit(places: Place[], gazetteer: Gazetteer, v: string, cityOf?: (cc: string, state: string) => City | null) {
  const out: PlacesJson = { v, lat: [], lon: [], count: [], name: [], cc: [], tzi: [], tzs: [] };
  const tzIndex = new Map<string, number>();
  const chunks = new Map<string, ChunkJson>();

  // Name every place; places with the same name within 60 km become one dot (as on radio.garden).
  const named: { p: Place; cc: string; name: string; tz: string }[] = [];
  const byCity = new Map<string, number[]>();
  for (const p of places) {
    const cc = majority(p.stations.map(s => s.cc));
    const near = gazetteer.nearest(p.lat, p.lon, cc);
    const listed = cityOf ? listedCity(p, cc, cityOf) : null;
    const city = listed && (!near || listed.pop > near.pop)
      && distanceKm(p.lon, p.lat, listed.lon, listed.lat) <= (listed.pop >= BIG_CITY_POP ? BIG_CITY_KM : LISTED_CITY_KM) ? listed : near;
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
    // Playback order: the most listened first. Clicks change from run to run, which is fine for order;
    // equal clicks fall back to votes and then the uuid, so the rows never depend on the input order.
    [...p.stations]
      .sort((a, b) => b.clicks - a.clicks || b.votes - a.votes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .forEach(s => chunk.rows.push([i, s.id, s.name, s.url, s.codec, s.bitrate, s.tags.join(',')]));
  });
  return { placesJson: out, chunks };
}

export function sanityCheck(p: PlacesJson, stationCount: number, minStations = 5000, minPlaces = 2000): void {
  if (stationCount < minStations || p.lat.length < minPlaces) {
    throw new Error(`dataset suspiciously small: ${stationCount} stations, ${p.lat.length} places`);
  }
}
