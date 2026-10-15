import { describe, expect, it } from 'vitest';
import { CityPlacer, parseAdmin1 } from '../../scripts/lib/cityplace';
import { emit, LISTED_CITY_KM, sanityCheck } from '../../scripts/lib/emit';
import { Gazetteer, parseGeoNames } from '../../scripts/lib/gazetteer';
import type { Place } from '../../scripts/lib/places';
import type { Station } from '../../scripts/lib/normalize';

const s = (id: string, cc: string, clicks: number): Station => ({
  id, name: `R ${id}`, url: `https://x/${id}`, cc, state: 'Bayern', lat: 48.1, lon: 11.6, codec: 'AAC', bitrate: 96,
  hls: false, clicks, votes: 0, tags: ['jazz', 'news'], placed: false,
});

describe('emit', () => {
  const places: Place[] = [
    { lat: 48.13743, lon: 11.57549, stations: [s('a', 'DE', 5), s('b', 'DE', 9)] },
    { lat: -33.9, lon: 151.2, stations: [s('c', 'AU', 1)] },
  ];
  const g = new Gazetteer([{ name: 'München', lat: 48.137, lon: 11.575, cc: 'DE', pop: 1260391, tz: 'Europe/Berlin' }]);

  it('writes columnar places with names, time zones and counts', () => {
    const { placesJson } = emit(places, g, '2026-09-25');
    expect(placesJson.lat).toEqual([48.137, -33.9]);
    expect(placesJson.name).toEqual(['München', 'Bayern']); // no city within 250 km → state
    expect(placesJson.count).toEqual([2, 1]);
    expect(placesJson.tzs[placesJson.tzi[0]]).toBe('Europe/Berlin');
  });

  it('writes one chunk per country, most clicked first within a place', () => {
    const { chunks } = emit(places, g, '2026-09-25');
    expect([...chunks.keys()].sort()).toEqual(['AU', 'DE']);
    expect(chunks.get('DE')!.rows.map(r => r[1])).toEqual(['b', 'a']);
    expect(chunks.get('DE')!.rows[0]).toEqual([0, 'b', 'R b', 'https://x/b', 'AAC', 96, 'jazz,news']);
  });

  it('orders equal clicks by votes, then by id, whatever the input order', () => {
    const tie = (id: string, votes: number): Station => ({ ...s(id, 'DE', 3), votes });
    const place: Place = { lat: 48.13743, lon: 11.57549, stations: [tie('d', 0), tie('b', 2), tie('c', 0), s('a', 'DE', 4)] };
    expect(emit([place], g, 'v').chunks.get('DE')!.rows.map(r => r[1])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('merges places that resolve to the same city', () => {
    const withSuburb: Place[] = [places[0], { lat: 48.2, lon: 11.6, stations: [s('c2', 'DE', 1)] }, places[1]];
    const { placesJson, chunks } = emit(withSuburb, g, 'v');
    expect(placesJson.name).toEqual(['München', 'Bayern']);
    expect(placesJson.count).toEqual([3, 1]);
    expect(chunks.get('DE')!.rows.map(r => r[0])).toEqual([0, 0, 0]);
  });

  it('refuses to emit a suspiciously small dataset', () => {
    const { placesJson } = emit(places, g, 'v');
    expect(() => sanityCheck(placesJson, 3)).toThrow(/suspiciously small/);
  });
});

// Ruling 51: a place most of whose stations name a city in their `state` takes that city's name when it is more
// populous than the gazetteer's pick and near (LISTED_CITY_KM, or BIG_CITY_KM for a city of a million). GeoNames
// cities15000 and admin1 rows of 2026-09-27; "rest of BR.27" stands for the other cities of São Paulo state, so the
// city's share of its region is the real .29 and the state "São Paulo" names no city (CityPlacer).
describe('emit: the city its stations name', () => {
  type Row = [name: string, ascii: string, cc: string, admin1: string, pop: number, lat: number, lon: number];
  const ROWS: Row[] = [
    ['Thessaloníki', 'Thessaloniki', 'GR', 'ESYE12', 317778, 40.64072, 22.93493],
    ['Kalamariá', 'Kalamaria', 'GR', 'ESYE12', 91518, 40.5825, 22.95028],       // 6.6 km from Thessaloníki
    ['Dubai', 'Dubai', 'AE', '03', 3790000, 25.07725, 55.30927],
    ['Sharjah', 'Sharjah', 'AE', '06', 1800000, 25.3342, 55.41221],
    ['Mannheim', 'Mannheim', 'DE', '01', 307960, 49.4891, 8.46694],
    ['Ludwigshafen am Rhein', 'Ludwigshafen am Rhein', 'DE', '08', 163196, 49.48121, 8.44641], // 1.7 km from Mannheim
    ['A Coruña', 'A Coruna', 'ES', '58', 250438, 43.37135, -8.396],
    ['Ferrol', 'Ferrol', 'ES', '58', 66799, 43.48451, -8.23293],                 // 18.2 km from A Coruña
    ['São Paulo', 'Sao Paulo', 'BR', '27', 12400232, -23.5475, -46.63611],
    ['Guarulhos', 'Guarulhos', 'BR', '27', 1345364, -23.46278, -46.53333],      // 14.1 km from São Paulo
    ['rest of BR.27', '', 'BR', '27', 29486084, -21, -49],
  ];
  const ADMIN1 = 'BR.27\tSão Paulo\tSao Paulo\t3448433\nES.58\tGalicia\tGalicia\t3336902\n';
  const cities = parseGeoNames(ROWS.map(([name, ascii, cc, admin1, pop, lat, lon]) =>
    ['0', name, ascii, '', lat, lon, 'P', 'PPL', cc, '', admin1, '', '', '', pop, '', '', 'UTC', '2026-09-27'].join('\t')).join('\n'));
  const placer = new CityPlacer(cities, parseAdmin1(ADMIN1));
  const gz = new Gazetteer(cities);
  const cityOf = (cc: string, state: string) => placer.cityOf(cc, state);
  /** The name of a place at `town` whose stations give these states, with and without their cities. */
  const names = (town: string, states: string[]) => {
    const c = cities.find(x => x.name === town)!;
    const place: Place = { lat: c.lat, lon: c.lon, stations: states.map((state, i) => ({ ...s(`s${i}`, c.cc, 0), state })) };
    return [emit([place], gz, 'v', cityOf).placesJson.name[0], emit([place], gz, 'v').placesJson.name[0]];
  };

  it('names a place after the city most of its stations name: Kalamariá is Thessaloníki', () => {
    expect(LISTED_CITY_KM).toBe(10);
    expect(names('Kalamariá', ['Thessaloniki', 'Thessaloníki', 'thessaloniki ', ''])).toEqual(['Thessaloníki', 'Kalamariá']);
  });

  it('takes a big city up to 20 km away: Bur Dubai is Dubai, not Sharjah', () => {
    // A place at Bur Dubai: 19.4 km from GeoNames' Dubai, 13.3 km from Sharjah, which the score picks.
    const place: Place = { lat: 25.252, lon: 55.316, stations: ['Dubai', 'Dubai,', '', ''].map((state, i) => ({ ...s(`d${i}`, 'AE', 0), state })) };
    expect(emit([place], gz, 'v', cityOf).placesJson.name).toEqual(['Dubai']);
    expect(emit([place], gz, 'v').placesJson.name).toEqual(['Sharjah']);
  });

  it('keeps the gazetteer name when only a minority names the city: Ludwigshafen', () => {
    const states = [...Array(3).fill('Mannheim'), ...Array(11).fill('Rheinland-Pfalz'), ''];
    expect(names('Ludwigshafen am Rhein', states)).toEqual(['Ludwigshafen am Rhein', 'Ludwigshafen am Rhein']);
    expect(names('Ludwigshafen am Rhein', ['Mannheim', 'Mannheim', 'Rheinland-Pfalz', ''])[0]).toBe('Mannheim');
  });

  it('keeps it for a city under a million more than 10 km away, a state that is also its region, or a smaller city', () => {
    expect(names('Ferrol', ['A Coruña'])[0]).toBe('Ferrol');
    expect(names('Guarulhos', ['São Paulo', 'Sao Paulo'])[0]).toBe('Guarulhos');
    expect(names('Thessaloníki', ['Kalamaria', 'Kalamariá'])[0]).toBe('Thessaloníki');
  });
});
