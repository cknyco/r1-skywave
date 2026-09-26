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

  it('loads new stations once and drops rows that do not match the loaded places', async () => {
    const calls: string[] = [];
    const news = { v: 1, date: '2026-09-26', days: 14, stations: [
      { id: 'n1', name: 'N1', place: 1, placeName: 'München', cc: 'DE', since: '2026-09-26' },
      { id: 'n2', name: 'N2', place: 1, placeName: 'Hamburg', cc: 'DE', since: '2026-09-25' }, // stale place index
      { id: 'n3', name: 'N3', place: 7, placeName: 'Köln', cc: 'DE', since: '2026-09-24' },    // out of range
    ] };
    const f = (async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(url.endsWith('new.json') ? news : places));
    }) as typeof fetch;
    const store = new DataStore('data/', f);
    await store.load();
    expect((await store.newStations()).map(s => s.id)).toEqual(['n1']);
    await store.newStations();
    expect(calls.filter(u => u.endsWith('new.json'))).toHaveLength(1);
  });

  it('treats a missing new.json as no new stations', async () => {
    const store = new DataStore('data/', fakeFetch([]));
    await store.load();
    expect(await store.newStations()).toEqual([]);
  });

  it('treats an unreadable new.json as no new stations', async () => {
    for (const body of ['not json', '{"v":1}', '{"stations":{"id":"x"}}', '{"stations":[null,{"id":1,"place":0}]}']) {
      const f = (async (url: string) => new Response(url.endsWith('places.json') ? JSON.stringify(places) : body)) as typeof fetch;
      const store = new DataStore('data/', f);
      await store.load();
      expect(await store.newStations()).toEqual([]);
    }
  });

  it('retries new.json after a network failure', async () => {
    let fail = true;
    const f = (async (url: string) => {
      if (url.endsWith('places.json')) return new Response(JSON.stringify(places));
      if (fail) { fail = false; throw new TypeError('offline'); }
      return new Response(JSON.stringify({ v: 1, date: '2026-09-26', days: 14, stations: [] }));
    }) as typeof fetch;
    const store = new DataStore('data/', f);
    await store.load();
    await expect(store.newStations()).rejects.toThrow('offline');
    expect(await store.newStations()).toEqual([]);
  });
});
