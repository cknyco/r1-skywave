import { describe, expect, it } from 'vitest';
import { normalize } from '../../scripts/lib/normalize';
import type { RBStation } from '../../scripts/lib/radiobrowser';

const base: RBStation = {
  stationuuid: 'u1', name: '  Radio Eins ', url_resolved: 'https://example.org/live.mp3', countrycode: 'de', state: 'Berlin',
  geo_lat: 52.5, geo_long: 13.4, codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1, ssl_error: 0,
  clickcount: 10, votes: 3, tags: 'Pop,  Rock ,news,talk',
};
const opts = { allowHttp: false, allowHls: false };

describe('normalize', () => {
  it('maps a good row', () => {
    expect(normalize([base], opts)).toEqual([{
      id: 'u1', name: 'Radio Eins', url: 'https://example.org/live.mp3', cc: 'DE', state: 'Berlin',
      lat: 52.5, lon: 13.4, codec: 'MP3', bitrate: 128, hls: false, clicks: 10, votes: 3, tags: ['pop', 'rock', 'news'],
      placed: false,
    }]);
  });

  it.each([
    ['broken', { lastcheckok: 0 }],
    ['http', { url_resolved: 'http://example.org/live.mp3' }],
    ['tls error', { ssl_error: 1 }],
    ['hls', { hls: 1 }],
    ['playlist', { url_resolved: 'https://example.org/list.pls' }],
    ['radio.garden host', { url_resolved: 'https://radio.garden/api/ara/content/listen/vxqa6HTr/channel.mp3' }],
    ['no coords', { geo_lat: null }],
    ['null island', { geo_lat: 0, geo_long: 0 }],
    ['bad coords', { geo_lat: -85.37, geo_long: -273.16 }],
    ['empty name', { name: '   ' }],
  ])('drops %s', (_label, patch) => {
    expect(normalize([{ ...base, ...patch } as RBStation], opts)).toEqual([]);
  });

  it('keeps http when allowed', () => {
    expect(normalize([{ ...base, url_resolved: 'http://x.org/a' }], { ...opts, allowHttp: true })).toHaveLength(1);
  });

  it('dedupes by stream URL keeping the most voted row, then the smallest uuid, never the most clicked', () => {
    const rows = [
      { ...base, stationuuid: 'b', clickcount: 9, votes: 3 },
      { ...base, stationuuid: 'c', clickcount: 0, votes: 7 },
      { ...base, stationuuid: 'a', clickcount: 1, votes: 7 },
    ];
    expect(normalize(rows, opts).map(s => s.id)).toEqual(['a']);
  });

  it('keeps the row the previous snapshot had over more votes', () => {
    const rows = [{ ...base, stationuuid: 'a', votes: 9 }, { ...base, stationuuid: 'b', votes: 0 }];
    expect(normalize(rows, { ...opts, prefer: new Set(['b']) }).map(s => s.id)).toEqual(['b']);
  });
});

// Ruling 51: a row without coordinates sits at the city its state names (opts.place), and on a shared stream a row
// with coordinates wins against it.
describe('normalize: rows without coordinates', () => {
  const noGeo = { ...base, stationuuid: 'p', geo_lat: null, geo_long: null, state: ' Berlin ' };
  const calls: [string, string][] = [];
  const place = (cc: string, state: string) => {
    calls.push([cc, state]);
    return state === 'Berlin' ? { lat: 52.52437, lon: 13.41053 } : null;
  };

  it('places a row at the city opts.place gives, and marks it', () => {
    const [s] = normalize([noGeo], { ...opts, place });
    expect(s).toMatchObject({ id: 'p', cc: 'DE', state: 'Berlin', lat: 52.52437, lon: 13.41053, placed: true });
  });

  it('drops it when opts.place knows no city, or without opts.place', () => {
    expect(normalize([{ ...noGeo, state: 'Bayern' }], { ...opts, place })).toEqual([]);
    expect(normalize([noGeo], opts)).toEqual([]);
  });

  it('never places a row with bad coordinates, and asks only for rows that pass every other check', () => {
    calls.length = 0;
    expect(normalize([{ ...base, geo_lat: 0, geo_long: 0 }, { ...base, geo_lat: 91 }], { ...opts, place })).toEqual([]);
    expect(normalize([{ ...noGeo, lastcheckok: 0 }, { ...noGeo, url_resolved: 'http://example.org/a' }], { ...opts, place })).toEqual([]);
    expect(calls).toEqual([]);
    normalize([noGeo], { ...opts, place });
    expect(calls).toEqual([['DE', 'Berlin']]);
  });

  it('keeps the row with coordinates on a shared stream, against more votes, a smaller uuid and the previous snapshot', () => {
    const geo = { ...base, stationuuid: 'z', votes: 0 };
    const placed = { ...noGeo, stationuuid: 'a', votes: 99 };
    for (const rows of [[geo, placed], [placed, geo]]) {
      const kept = normalize(rows, { ...opts, place, prefer: new Set(['a']) });
      expect(kept.map(s => [s.id, s.placed])).toEqual([['z', false]]);
    }
  });

  it('decides between two placed rows as between two with coordinates', () => {
    const rows = [{ ...noGeo, stationuuid: 'b', votes: 5 }, { ...noGeo, stationuuid: 'a', votes: 1 }];
    expect(normalize(rows, { ...opts, place }).map(s => s.id)).toEqual(['b']);
    expect(normalize(rows, { ...opts, place, prefer: new Set(['a']) }).map(s => s.id)).toEqual(['a']);
  });
});
