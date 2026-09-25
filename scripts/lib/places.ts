import { distanceKm } from '../../src/geo/sphere';
import type { Station } from './normalize';

export interface Place {
  lat: number;
  lon: number;
  stations: Station[];
}

const CELL = 0.1; // degrees; 5 km fits inside one neighbouring cell below about 60° latitude
const LON_CELLS = Math.round(360 / CELL);

function cellOf(lat: number, lon: number): [number, number] {
  return [Math.floor(lat / CELL), Math.floor((lon + 180) / CELL)];
}

export function aggregate(stations: Station[], radiusKm = 5): Place[] {
  const sorted = [...stations].sort((a, b) => b.clicks - a.clicks || b.votes - a.votes);
  const grid = new Map<string, Place[]>();
  const places: Place[] = [];
  const reach = (lat: number) => Math.max(1, Math.ceil(radiusKm / (111 * CELL * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))));

  for (const s of sorted) {
    const [cy, cx] = cellOf(s.lat, s.lon);
    const rx = reach(s.lat);
    let host: Place | undefined;
    for (let dy = -1; dy <= 1 && !host; dy++) {
      for (let dx = -rx; dx <= rx && !host; dx++) {
        const key = `${cy + dy}:${(((cx + dx) % LON_CELLS) + LON_CELLS) % LON_CELLS}`;
        for (const p of grid.get(key) ?? []) {
          if (distanceKm(s.lon, s.lat, p.lon, p.lat) <= radiusKm) { host = p; break; }
        }
      }
    }
    if (host) {
      host.stations.push(s);
    } else {
      const p: Place = { lat: s.lat, lon: s.lon, stations: [s] };
      places.push(p);
      const key = `${cy}:${cx}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(p); else grid.set(key, [p]);
    }
  }
  return places.sort((a, b) => b.stations.length - a.stations.length);
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.split('.').slice(-2).join('.');
  } catch {
    return url;
  }
}

/** A broadcaster with dozens of channels at one address would bury everyone else there; keep its most clicked few. */
export function capFamilies(places: Place[], max = 10): Place[] {
  return places
    .map(p => {
      const seen = new Map<string, number>();
      const stations = [...p.stations]
        .sort((a, b) => b.clicks - a.clicks)
        .filter(s => {
          const d = domainOf(s.url);
          const n = (seen.get(d) ?? 0) + 1;
          seen.set(d, n);
          return n <= max;
        });
      return { ...p, stations };
    })
    .sort((a, b) => b.stations.length - a.stations.length);
}
