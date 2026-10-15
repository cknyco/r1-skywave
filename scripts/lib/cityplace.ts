// Ruling 51 (user choice "only if their city is known"): Radio Browser lists about 27,000 working https stations
// without coordinates. Their free-text `state` often names a city ("Tokyo", "Beijing", "Madrid"). Such a station is
// placed at that city, a GeoNames cities15000 city of the same country whose name or ASCII name folds (case, accents,
// punctuation, as the voice matcher folds) to the same words; the most populous one when several do. Every other
// station without coordinates stays off the map.
//
// A state is often a region, not a city, and some regions share their name with their capital: "São Paulo" is the
// state as often as the city. When the folded state is also the name of a GeoNames admin1 region of that country,
// the city stands for it only when it lies in that region and holds at least REGION_SHARE of the region's cities15000
// population. Measured on 2026-09-27: Tokyo .59, Beijing .96, Dubai .90, Madrid .51, Shanghai .48 and Bangkok .48
// pass; São Paulo .29, Rio de Janeiro .40, Quebec .07, Chihuahua .30 and Jilin .14 do not; and Washington (DC, not
// the state), Oregon (a town in Ohio) and Buenos Aires (the capital district, not the province) lie outside the region
// of their name.
import { fold } from '../../src/voice/fold';
import type { GeoCity } from './gazetteer';

/** One line of GeoNames admin1CodesASCII.txt: "JP.40", "Tokyo", "Tokyo". */
export interface Admin1 {
  code: string;
  name: string;
  ascii: string;
}

export const REGION_SHARE = 0.45;

/** Why a station without coordinates stays off the map. */
export type Unplaced = 'no state' | 'no city' | 'region';
export type Placement = { city: GeoCity } | { reason: Unplaced };

export function parseAdmin1(tsv: string): Admin1[] {
  const out: Admin1[] = [];
  for (const line of tsv.split('\n')) {
    const f = line.split('\t');
    if (f.length >= 3 && f[0].includes('.')) out.push({ code: f[0], name: f[1], ascii: f[2] });
  }
  return out;
}

function add<T>(m: Map<string, T[]>, key: string, v: T): void {
  const l = m.get(key);
  if (l) l.push(v); else m.set(key, [v]);
}

/** The folded forms of a name and its ASCII spelling, without repeats or empty ones. */
const folds = (...names: string[]) => [...new Set(names.map(fold))].filter(Boolean);

export class CityPlacer {
  private cities = new Map<string, GeoCity>();  // "CC|folded name" → the most populous city of that name
  private regions = new Map<string, string[]>(); // "CC|folded name" → admin1 codes ("JP.40") of that name
  private regionPop = new Map<string, number>(); // admin1 code → the population of its cities15000 cities
  /** Outcomes of place() so far, for the build log. */
  readonly tally: Record<'placed' | Unplaced, number> = { placed: 0, 'no state': 0, 'no city': 0, region: 0 };

  constructor(cities: GeoCity[], regions: Admin1[]) {
    for (const c of cities) {
      const code = `${c.cc}.${c.admin1}`;
      this.regionPop.set(code, (this.regionPop.get(code) ?? 0) + c.pop);
      for (const k of folds(c.name, c.ascii)) {
        const key = `${c.cc}|${k}`;
        const held = this.cities.get(key);
        if (!held || c.pop > held.pop) this.cities.set(key, c); // the first in file order on a tie
      }
    }
    for (const r of regions) for (const k of folds(r.name, r.ascii)) add(this.regions, `${r.code.split('.')[0]}|${k}`, r.code);
  }

  /** The city a station's `state` names in country `cc`, or why there is none. */
  find(cc: string, state: string): Placement {
    const k = fold(state);
    if (!k) return { reason: 'no state' };
    const city = this.cities.get(`${cc}|${k}`);
    if (!city) return { reason: 'no city' };
    const regions = this.regions.get(`${cc}|${k}`);
    if (!regions) return { city };
    const code = `${cc}.${city.admin1}`;
    return regions.includes(code) && city.pop >= REGION_SHARE * (this.regionPop.get(code) ?? Infinity) ? { city } : { reason: 'region' };
  }

  /** The city a state names in country `cc`, or null; not counted in tally (emit's place names, Ruling 51). */
  cityOf(cc: string, state: string): GeoCity | null {
    const p = this.find(cc, state);
    return 'city' in p ? p.city : null;
  }

  /** normalize's hook for a row without coordinates: its city's, or null when it stays off the map. Counted in tally. */
  place(cc: string, state: string): { lat: number; lon: number } | null {
    const p = this.find(cc, state);
    if ('reason' in p) {
      this.tally[p.reason]++;
      return null;
    }
    this.tally.placed++;
    return { lat: p.city.lat, lon: p.city.lon };
  }
}
