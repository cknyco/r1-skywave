import { describe, expect, it } from 'vitest';
import { fetchLiveData } from '../../scripts/lib/live-data';

const BASE = 'https://cknyco.github.io/r1-skywave/';

function bigPlaces(n = 2000): { v: string; cc: string[] } {
  return { v: 'v', cc: Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 'DE' : 'AU')) };
}

const res = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('fetchLiveData', () => {
  it('downloads places.json, one chunk per country and version.json, and writes them verbatim', async () => {
    const places = bigPlaces();
    const written = new Map<string, string>();
    const f = async (url: string) => {
      if (url === `${BASE}data/places.json`) return res(places);
      if (url === `${BASE}data/st/DE.json`) return res({ v: 'v', rows: [['DE-row']] });
      if (url === `${BASE}data/st/AU.json`) return res({ v: 'v', rows: [['AU-row']] });
      if (url === `${BASE}data/version.json`) return res({ v: 'v', stations: 1, places: n(places) });
      throw new Error(`unexpected url ${url}`);
    };
    const write = (relPath: string, body: string) => written.set(relPath, body);

    const result = await fetchLiveData(BASE, f as typeof fetch, write);

    expect(result).toEqual({ places: 2000, chunks: 2 });
    expect(JSON.parse(written.get('places.json')!)).toEqual(places);
    expect(JSON.parse(written.get('st/DE.json')!)).toEqual({ v: 'v', rows: [['DE-row']] });
    expect(JSON.parse(written.get('st/AU.json')!)).toEqual({ v: 'v', rows: [['AU-row']] });
    expect(JSON.parse(written.get('version.json')!)).toEqual({ v: 'v', stations: 1, places: 2000 });
  });

  it('rejects and writes nothing when a chunk 404s', async () => {
    const places = bigPlaces();
    const written = new Map<string, string>();
    const f = async (url: string) => {
      if (url === `${BASE}data/places.json`) return res(places);
      if (url === `${BASE}data/st/DE.json`) return res('not found', 404);
      if (url === `${BASE}data/st/AU.json`) return res({ v: 'v', rows: [] });
      return res({});
    };
    await expect(fetchLiveData(BASE, f as typeof fetch, (p, b) => written.set(p, b))).rejects.toThrow(/404/);
    expect(written.size).toBe(0);
  });

  it('rejects a suspiciously small places.json without fetching anything else', async () => {
    const places = bigPlaces(3);
    const written = new Map<string, string>();
    let chunkOrVersionCalled = false;
    const f = async (url: string) => {
      if (url === `${BASE}data/places.json`) return res(places);
      chunkOrVersionCalled = true;
      return res({});
    };
    await expect(fetchLiveData(BASE, f as typeof fetch, (p, b) => written.set(p, b))).rejects.toThrow(/suspiciously small/);
    expect(chunkOrVersionCalled).toBe(false);
    expect(written.size).toBe(0);
  });
});

function n(p: { cc: string[] }): number {
  return p.cc.length;
}
