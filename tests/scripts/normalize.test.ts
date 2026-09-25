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

  it('dedupes by stream URL keeping the more clicked row', () => {
    const rows = [{ ...base, stationuuid: 'a', clickcount: 1 }, { ...base, stationuuid: 'b', clickcount: 9 }];
    expect(normalize(rows, opts).map(s => s.id)).toEqual(['b']);
  });
});
