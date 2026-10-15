import { describe, expect, it } from 'vitest';
import { aggregate, capFamilies } from '../../scripts/lib/places';
import { BIG_CITY_KM, BIG_CITY_POP, Gazetteer, parseGeoNames, type City } from '../../scripts/lib/gazetteer';
import type { Station } from '../../scripts/lib/normalize';

const st = (id: string, lat: number, lon: number, votes = 0): Station => ({
  id, name: id, url: `https://x/${id}`, cc: 'DE', state: '', lat, lon, codec: 'MP3', bitrate: 128,
  hls: false, clicks: 0, votes, tags: [], placed: false,
});

describe('aggregate', () => {
  it('merges stations within 5 km into one place at the most voted station', () => {
    const places = aggregate([{ ...st('a', 52.52, 13.40, 1), clicks: 90 }, st('b', 52.53, 13.41, 50), st('c', 48.14, 11.58)]);
    expect(places).toHaveLength(2);
    expect(places[0].stations.map(s => s.id).sort()).toEqual(['a', 'b']);
    expect(places[0].lat).toBe(52.53);
  });

  it('anchors a place at a station the previous snapshot had, then by votes, then by id', () => {
    expect(aggregate([st('a', 52.52, 13.40, 1), st('b', 52.53, 13.41, 50)], new Set(['a']))[0].lat).toBe(52.52);
    expect(aggregate([st('b', 52.53, 13.41), st('a', 52.52, 13.40)])[0].lat).toBe(52.52);
  });

  it('merges across a grid cell border and across the antimeridian', () => {
    expect(aggregate([st('a', 10.0999, 20.0999), st('b', 10.1001, 20.1001)])).toHaveLength(1);
    expect(aggregate([st('a', -17.0, 179.99), st('b', -17.0, -179.99)])).toHaveLength(1);
  });

  it('keeps stations 20 km apart separate', () => {
    expect(aggregate([st('a', 50.0, 8.0), st('b', 50.18, 8.0)])).toHaveLength(2);
  });

  it('caps one broadcaster at 10 channels per place, keeping the most voted, never the most clicked', () => {
    const family = Array.from({ length: 15 }, (_, i) => ({ ...st(`n${i}`, 50.3, 11.9, i), url: `https://ch${i}.radionetz.de/live`, clicks: 20 - i }));
    const [place] = capFamilies(aggregate([...family, st('x', 50.3, 11.9), st('y', 50.3, 11.9)]));
    expect(place.stations).toHaveLength(12);
    expect(place.stations.filter(s => s.url.includes('radionetz')).map(s => s.id).sort()).toEqual(
      ['n10', 'n11', 'n12', 'n13', 'n14', 'n5', 'n6', 'n7', 'n8', 'n9'],
    );
  });

  // Ruling 51: of two stations the previous snapshot has (or of two it has not), the one with coordinates anchors
  // a place and keeps a broadcaster slot, whatever the votes; a known placed station keeps both against a new one.
  it('anchors a place at a station with coordinates before one placed at its city of the same preference', () => {
    const placed = { ...st('p', 52.52, 13.40, 99), placed: true };
    expect(aggregate([placed, st('a', 52.53, 13.41)], new Set(['p', 'a']))[0].lat).toBe(52.53);
    expect(aggregate([placed, st('a', 52.53, 13.41)])[0].lat).toBe(52.53);
    expect(aggregate([placed, st('a', 52.53, 13.41)], new Set(['p']))[0].lat).toBe(52.52);
  });

  it('caps a broadcaster keeping its stations with coordinates before placed ones', () => {
    const geo = Array.from({ length: 9 }, (_, i) => ({ ...st(`g${i}`, 50.3, 11.9, i), url: `https://ch${i}.radionetz.de/live` }));
    const placed = Array.from({ length: 3 }, (_, i) => ({ ...st(`p${i}`, 50.31, 11.9, 50 + i), url: `https://city${i}.radionetz.de/live`, placed: true }));
    const known = new Set([...geo, ...placed].map(s => s.id));
    const ids = capFamilies(aggregate([...placed, ...geo], known), known)[0].stations.map(s => s.id);
    expect(ids).toHaveLength(10);
    expect(ids).toEqual(expect.arrayContaining(geo.map(s => s.id)));
    expect(ids.filter(id => id.startsWith('p'))).toEqual(['p2']);
  });

  it('keeps a known placed channel in its slot against a new channel with coordinates, whatever its votes', () => {
    const geo = Array.from({ length: 9 }, (_, i) => ({ ...st(`g${i}`, 50.3, 11.9, i), url: `https://ch${i}.radionetz.de/live` }));
    const placed = { ...st('p', 50.31, 11.9, 5), url: 'https://city.radionetz.de/live', placed: true };
    const fresh = { ...st('new', 50.32, 11.91, 900), url: 'https://new.radionetz.de/live' };
    const known = new Set([...geo, placed].map(s => s.id));
    const [place] = capFamilies(aggregate([fresh, placed, ...geo], known), known);
    expect(place.stations.map(s => s.id).sort()).toEqual([...known].sort());
    expect(place.lat).toBe(50.3);
  });

  it('keeps the channels the previous snapshot had', () => {
    const family = Array.from({ length: 12 }, (_, i) => ({ ...st(`n${i}`, 50.3, 11.9, i), url: `https://ch${i}.radionetz.de/live` }));
    const known = new Set(['n0', 'n1']);
    const ids = capFamilies(aggregate(family, known), known)[0].stations.map(s => s.id);
    expect(ids).toHaveLength(10);
    expect(ids).toEqual(expect.arrayContaining(['n0', 'n1']));
    expect(ids).not.toContain('n2');
    expect(ids).not.toContain('n3');
  });
});

describe('gazetteer', () => {
  const tsv = [
    // geonameid name asciiname alternatenames lat lon fclass fcode cc cc2 a1 a2 a3 a4 pop elev dem tz moddate
    '2950159\tBerlin\tBerlin\t\t52.52437\t13.41053\tP\tPPLC\tDE\t\t16\t\t\t\t3426354\t\t74\tEurope/Berlin\t2022-01-01',
    '2945024\tBrandenburg an der Havel\tBrandenburg\t\t52.41667\t12.55\tP\tPPL\tDE\t\t11\t\t\t\t72040\t\t32\tEurope/Berlin\t2022-01-01',
    '2988507\tParis\tParis\t\t48.85341\t2.3488\tP\tPPLC\tFR\t\t11\t\t\t\t2138551\t\t42\tEurope/Paris\t2022-01-01',
    '6545310\tMitte\tMitte\t\t52.52\t13.405\tP\tPPLX\tDE\t\t16\t\t\t\t101932\t\t40\tEurope/Berlin\t2022-01-01',
  ].join('\n');

  it('parses GeoNames rows', () => {
    expect(parseGeoNames(tsv)[0]).toEqual({
      name: 'Berlin', lat: 52.52437, lon: 13.41053, cc: 'DE', pop: 3426354, tz: 'Europe/Berlin', ascii: 'Berlin', admin1: '16',
    });
  });

  it('drops city districts such as Berlin-Mitte', () => {
    expect(parseGeoNames(tsv).map(c => c.name)).toEqual(['Berlin', 'Brandenburg an der Havel', 'Paris']);
  });

  it('finds the nearest city in the same country within the radius', () => {
    const g = new Gazetteer(parseGeoNames(tsv));
    expect(g.nearest(52.52, 13.405, 'DE')?.name).toBe('Berlin');
    expect(g.nearest(52.0, 5.0, 'NL')).toBeNull();
  });

  it('searches wider when asked, for time zones and "near X" names', () => {
    const g = new Gazetteer(parseGeoNames(tsv));
    expect(g.nearest(51.2, 13.4, 'DE')).toBeNull();
    expect(g.nearest(51.2, 13.4, 'DE', 250)?.name).toBe('Berlin');
  });
});

// Ruling 51: a city of a million people or more within 20 km, in the place's own country, names the place. GeoNames
// cities15000 rows (2026-09-27); each case puts a place on a town's own coordinates.
describe('gazetteer: big cities', () => {
  const at = (name: string, lat: number, lon: number, cc: string, pop: number): City => ({ name, lat, lon, cc, pop, tz: '' });
  const CITIES = [
    at('Tokyo', 35.6895, 139.69171, 'JP', 9733276),
    at('Aoi', 35.77432, 139.81654, 'JP', 17422),          // a town in Tokyo prefecture, 14.7 km from Tokyo
    at('Kawasaki', 35.52056, 139.71722, 'JP', 1538262),   // 18.9 km from Tokyo
    at('Yokohama', 35.43333, 139.65, 'JP', 3777491),      // 28.7 km from Tokyo, 11.5 km from Kawasaki
    at('Berlin', 52.52437, 13.41053, 'DE', 3426354),
    at('Potsdam', 52.39886, 13.06566, 'DE', 184754),      // 27.2 km from Berlin
    at('Frankfurt am Main', 50.11552, 8.68417, 'DE', 650000),
    at('Offenbach', 50.10061, 8.76647, 'DE', 119192),     // 6.1 km from Frankfurt, which is under a million
    at('Macau', 22.20056, 113.54611, 'MO', 649335),
    at('Zhuhai', 22.27694, 113.56778, 'CN', 2207090),     // 8.8 km from Macau, in another country
  ];
  const g = new Gazetteer(CITIES);
  const name = (town: string) => {
    const c = CITIES.find(x => x.name === town)!;
    return g.nearest(c.lat, c.lon, c.cc)?.name;
  };

  it('names a place in a town near a big city after the big city: Aoi is Tokyo', () => {
    expect([BIG_CITY_POP, BIG_CITY_KM]).toEqual([1_000_000, 20]);
    expect(name('Aoi')).toBe('Tokyo');
  });

  it('keeps the name of a big city next to a bigger one: Kawasaki and Yokohama', () => {
    expect(name('Kawasaki')).toBe('Kawasaki');
    expect(name('Yokohama')).toBe('Yokohama');
    expect(name('Tokyo')).toBe('Tokyo');
  });

  it('keeps a town more than 20 km from a big city, or next to a city under a million: Potsdam, Offenbach', () => {
    expect(name('Potsdam')).toBe('Potsdam');
    expect(name('Offenbach')).toBe('Offenbach');
    expect(name('Frankfurt am Main')).toBe('Frankfurt am Main');
  });

  it('never takes a big city from another country: Macau stays Macau', () => {
    expect(name('Macau')).toBe('Macau');
    expect(g.nearest(22.20056, 113.54611, 'CN')?.name).toBe('Zhuhai');
  });
});
