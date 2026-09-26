import { describe, expect, it } from 'vitest';
import { emit, sanityCheck } from '../../scripts/lib/emit';
import { Gazetteer } from '../../scripts/lib/gazetteer';
import type { Place } from '../../scripts/lib/places';
import type { Station } from '../../scripts/lib/normalize';

const s = (id: string, cc: string, clicks: number): Station => ({
  id, name: `R ${id}`, url: `https://x/${id}`, cc, state: 'Bayern', lat: 48.1, lon: 11.6, codec: 'AAC', bitrate: 96,
  hls: false, clicks, votes: 0, tags: ['jazz', 'news'],
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
