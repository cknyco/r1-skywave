import { describe, expect, it } from 'vitest';
import { discoverServers, fetchStations } from '../../scripts/lib/radiobrowser';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('radiobrowser', () => {
  it('discovers servers from /json/servers', async () => {
    const f = async () => json([{ name: 'de1.api.radio-browser.info' }, { name: 'de1.api.radio-browser.info' }]);
    expect(await discoverServers(f as typeof fetch)).toEqual(['https://de1.api.radio-browser.info']);
  });

  it('retries a 502 and then succeeds', async () => {
    let calls = 0;
    const f = async (url: string) => {
      if (url.endsWith('/json/servers')) return json([{ name: 'de1.api.radio-browser.info' }]);
      calls++;
      return calls < 3 ? new Response('bad gateway', { status: 502 }) : json([{ stationuuid: 'x' }]);
    };
    const rows = await fetchStations(f as typeof fetch, async () => {});
    expect(rows).toEqual([{ stationuuid: 'x' }]);
    expect(calls).toBe(3);
  });

  it('asks for every working station, with coordinates or without (Ruling 51)', async () => {
    const urls: string[] = [];
    const f = async (url: string) => {
      urls.push(url);
      return url.endsWith('/json/servers') ? json([{ name: 'de1.api.radio-browser.info' }]) : json([]);
    };
    await fetchStations(f as typeof fetch, async () => {});
    expect(urls[1]).toBe('https://de1.api.radio-browser.info/json/stations/search?hidebroken=true&limit=100000');
  });

  it('gives up after 5 failed attempts', async () => {
    const f = async (url: string) =>
      url.endsWith('/json/servers') ? json([{ name: 'de1.api.radio-browser.info' }]) : new Response('x', { status: 502 });
    await expect(fetchStations(f as typeof fetch, async () => {})).rejects.toThrow(/after 5 attempts/);
  });
});
