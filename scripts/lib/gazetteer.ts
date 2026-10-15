import { distanceKm } from '../../src/geo/sphere';

export interface City {
  name: string;
  lat: number;
  lon: number;
  cc: string;
  pop: number;
  tz: string;
}

/** A cities15000 row as the data build reads it: a City plus what placing a station by its city needs (Ruling 51). */
export interface GeoCity extends City {
  ascii: string;
  admin1: string;
}

// Districts, historical, abandoned and destroyed places would give names like "Paris 05 Panthéon".
const EXCLUDED = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH']);

// Ruling 51: a city of BIG_CITY_POP people or more within BIG_CITY_KM of a place, in the place's own country, names it,
// whatever smaller town lies closer. Without this rule the score below named Tokyo's stations "Aoi" (17,000 people,
// 0 km) instead of Tokyo (9.7 million, 14.7 km). 20 km keeps a big neighbour's own name: Kawasaki (1.5 million) is
// 19 km from Tokyo and stays Kawasaki, as both qualify and the score picks the nearer one; Potsdam, 27 km from Berlin,
// stays Potsdam. The own country only: Zhuhai (2.2 million, China) is 9 km from Macau.
export const BIG_CITY_POP = 1_000_000;
export const BIG_CITY_KM = 20;

export function parseGeoNames(tsv: string): GeoCity[] {
  const out: GeoCity[] = [];
  for (const line of tsv.split('\n')) {
    const f = line.split('\t');
    if (f.length < 18 || f[6] !== 'P' || EXCLUDED.has(f[7])) continue;
    out.push({
      name: f[1], lat: Number(f[4]), lon: Number(f[5]), cc: f[8], pop: Number(f[14]) || 0, tz: f[17], ascii: f[2], admin1: f[10],
    });
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

  /**
   * Best city within maxKm: a big city of the same country within BIG_CITY_KM if there is one (Ruling 51), else
   * close, same country and populous (a big city a few km away beats a small suburb). The score decides among the
   * big cities too.
   */
  nearest(lat: number, lon: number, cc: string, maxKm = 30): City | null {
    let best: City | null = null, big: City | null = null;
    let bestScore = Infinity, bigScore = Infinity;
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
          if (c.cc === cc && c.pop >= BIG_CITY_POP && d <= BIG_CITY_KM && score < bigScore) { bigScore = score; big = c; }
        }
      }
    }
    return big ?? best;
  }
}
