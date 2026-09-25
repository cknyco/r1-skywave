import { distanceKm } from '../../src/geo/sphere';

export interface City {
  name: string;
  lat: number;
  lon: number;
  cc: string;
  pop: number;
  tz: string;
}

// Districts, historical, abandoned and destroyed places would give names like "Paris 05 Panthéon".
const EXCLUDED = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);

export function parseGeoNames(tsv: string): City[] {
  const out: City[] = [];
  for (const line of tsv.split('\n')) {
    const f = line.split('\t');
    if (f.length < 18 || f[6] !== 'P' || EXCLUDED.has(f[7])) continue;
    out.push({ name: f[1], lat: Number(f[4]), lon: Number(f[5]), cc: f[8], pop: Number(f[14]) || 0, tz: f[17] });
  }
  return out;
}

export class Gazetteer {
  private grid = new Map<string, City[]>();

  constructor(cities: City[]) {
    for (const c of cities) {
      const key = `${Math.floor(c.lat)}:${Math.floor(c.lon)}`;
      const b = this.grid.get(key);
      if (b) b.push(c); else this.grid.set(key, [c]);
    }
  }

  /** Best city within maxKm: close, same country, and populous (a big city a few km away beats a small suburb). */
  nearest(lat: number, lon: number, cc: string, maxKm = 30): City | null {
    let best: City | null = null;
    let bestScore = Infinity;
    const gy = Math.floor(lat), gx = Math.floor(lon);
    const ring = Math.min(6, Math.max(1, Math.ceil(maxKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))))));
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        const x = ((gx + dx + 180 + 360) % 360) - 180;
        for (const c of this.grid.get(`${gy + dy}:${x}`) ?? []) {
          const d = distanceKm(lon, lat, c.lon, c.lat);
          if (d > maxKm) continue;
          const score = ((d + 2) * (c.cc === cc ? 1 : 3)) / Math.log10(Math.max(c.pop, 1000)) ** 2;
          if (score < bestScore) { bestScore = score; best = c; }
        }
      }
    }
    return best;
  }
}
