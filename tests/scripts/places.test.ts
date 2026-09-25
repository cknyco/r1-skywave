import { describe, expect, it } from 'vitest';
import { aggregate, capFamilies } from '../../scripts/lib/places';
import { Gazetteer, parseGeoNames } from '../../scripts/lib/gazetteer';
import type { Station } from '../../scripts/lib/normalize';

const st = (id: string, lat: number, lon: number, clicks = 0): Station => ({
  id, name: id, url: `https://x/${id}`, cc: 'DE', state: '', lat, lon, codec: 'MP3', bitrate: 128,
  hls: false, clicks, votes: 0, tags: [],
});

describe('aggregate', () => {
  it('merges stations within 5 km into one place at the most clicked station', () => {
    const places = aggregate([st('a', 52.52, 13.40, 1), st('b', 52.53, 13.41, 50), st('c', 48.14, 11.58)]);
    expect(places).toHaveLength(2);
    expect(places[0].stations.map(s => s.id).sort()).toEqual(['a', 'b']);
    expect(places[0].lat).toBe(52.53);
  });

  it('merges across a grid cell border and across the antimeridian', () => {
    expect(aggregate([st('a', 10.0999, 20.0999), st('b', 10.1001, 20.1001)])).toHaveLength(1);
    expect(aggregate([st('a', -17.0, 179.99), st('b', -17.0, -179.99)])).toHaveLength(1);
  });

  it('keeps stations 20 km apart separate', () => {
    expect(aggregate([st('a', 50.0, 8.0), st('b', 50.18, 8.0)])).toHaveLength(2);
  });

  it('caps one broadcaster at 10 channels per place, keeping the most clicked', () => {
    const family = Array.from({ length: 15 }, (_, i) => ({ ...st(`n${i}`, 50.3, 11.9, i), url: `https://ch${i}.radionetz.de/live` }));
    const [place] = capFamilies(aggregate([...family, st('x', 50.3, 11.9), st('y', 50.3, 11.9)]));
    expect(place.stations).toHaveLength(12);
    expect(place.stations.filter(s => s.url.includes('radionetz')).map(s => s.id)).not.toContain('n0');
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
    expect(parseGeoNames(tsv)[0]).toEqual({ name: 'Berlin', lat: 52.52437, lon: 13.41053, cc: 'DE', pop: 3426354, tz: 'Europe/Berlin' });
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
