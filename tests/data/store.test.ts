import { describe, expect, it } from 'vitest';
import { DataStore } from '../../src/data/store';

const places = { v: 'v1', lat: [52.52, 48.1], lon: [13.4, 11.6], count: [2, 1], name: ['Berlin', 'München'],
  cc: ['DE', 'DE'], tzi: [0, 0], tzs: ['Europe/Berlin'] };
const de = { v: 'v1', rows: [[0, 'a', 'A', 'https://a', 'MP3', 128, 'pop,rock'], [0, 'b', 'B', 'https://b', 'AAC', 64, ''],
  [1, 'c', 'C', 'https://c', 'MP3', 128, 'jazz']] };

function fakeFetch(calls: string[]) {
  return (async (url: string) => {
    calls.push(url);
    const body = url.endsWith('places.json') ? places : url.endsWith('st/DE.json') ? de : null;
    return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
  }) as typeof fetch;
}

describe('DataStore', () => {
  it('loads columnar places into typed arrays', async () => {
    const store = new DataStore('data/', fakeFetch([]));
    const p = await store.load();
    expect(p.n).toBe(2);
    expect(p.lat[0]).toBeCloseTo(52.52, 4);
    expect(p.tz[1]).toBe('Europe/Berlin');
  });

  it('loads a country chunk once and filters by place', async () => {
    const calls: string[] = [];
    const store = new DataStore('data/', fakeFetch(calls));
    await store.load();
    expect((await store.stationsFor(0)).map(s => s.id)).toEqual(['a', 'b']);
    expect((await store.stationsFor(1))[0].tags).toEqual(['jazz']);
    expect(calls.filter(u => u.includes('st/DE.json'))).toHaveLength(1);
  });

  it('retries a chunk after a failed load', async () => {
    let fail = true;
    const f = (async (url: string) => {
      if (url.endsWith('places.json')) return new Response(JSON.stringify(places));
      if (fail) { fail = false; throw new TypeError('offline'); }
      return new Response(JSON.stringify(de));
    }) as typeof fetch;
    const store = new DataStore('data/', f);
    await store.load();
    await expect(store.stationsFor(0)).rejects.toThrow('offline');
    expect(await store.stationsFor(0)).toHaveLength(2);
  });
});
