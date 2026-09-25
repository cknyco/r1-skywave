export interface RBStation {
  stationuuid: string;
  name: string;
  url_resolved: string;
  countrycode: string;
  state: string;
  geo_lat: number | null;
  geo_long: number | null;
  codec: string;
  bitrate: number;
  hls: number;
  lastcheckok: number;
  ssl_error: number;
  clickcount: number;
  votes: number;
  tags: string;
}

export const USER_AGENT = 'skywave-build/0.1';
const SEEDS = ['https://all.api.radio-browser.info', 'https://de1.api.radio-browser.info'];
const QUERY = '/json/stations/search?has_geo_info=true&hidebroken=true&limit=100000';

type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = ms => new Promise(r => setTimeout(r, ms));

export async function discoverServers(fetchFn: typeof fetch = fetch): Promise<string[]> {
  for (const seed of SEEDS) {
    try {
      const r = await fetchFn(`${seed}/json/servers`, { headers: { 'User-Agent': USER_AGENT } });
      if (!r.ok) continue;
      const list = (await r.json()) as { name: string }[];
      const names = [...new Set(list.map(s => s.name))];
      if (names.length) return names.map(n => `https://${n}`);
    } catch {
      // try the next seed
    }
  }
  return ['https://de1.api.radio-browser.info'];
}

export async function fetchGeoStations(fetchFn: typeof fetch = fetch, sleep: Sleep = realSleep): Promise<RBStation[]> {
  const servers = await discoverServers(fetchFn);
  let lastError = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const server = servers[attempt % servers.length];
    try {
      const r = await fetchFn(server + QUERY, { headers: { 'User-Agent': USER_AGENT } });
      if (r.ok) return (await r.json()) as RBStation[];
      lastError = `HTTP ${r.status} from ${server}`;
    } catch (e) {
      lastError = String(e);
    }
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error(`Radio Browser fetch failed after 5 attempts: ${lastError}`);
}
