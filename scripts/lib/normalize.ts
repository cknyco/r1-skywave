import type { RBStation } from './radiobrowser';

export interface Station {
  id: string;
  name: string;
  url: string;
  cc: string;
  state: string;
  lat: number;
  lon: number;
  codec: string;
  bitrate: number;
  hls: boolean;
  clicks: number;
  votes: number;
  tags: string[];
}

const PLAYLIST = /\.(pls|m3u|asx|xspf)(\?|$)/i;

/**
 * Ruling 39: decides which listing keeps a stream, which channels of a broadcaster stay and where a place is
 * anchored. A station in `prefer` comes first (build-data prefers what the previous snapshot has or recently
 * lost, Ruling 42), then more votes, then the smaller uuid. Never clickcount: it is a 24-hour count, mostly
 * 0-2, so a winner picked by clicks changes from run to run.
 */
export function byIdentity(prefer: ReadonlySet<string> = new Set()): (a: Station, b: Station) => number {
  return (a, b) => Number(prefer.has(b.id)) - Number(prefer.has(a.id)) || b.votes - a.votes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function normalize(
  rows: RBStation[],
  opts: { allowHttp: boolean; allowHls: boolean; prefer?: ReadonlySet<string> },
): Station[] {
  const first = byIdentity(opts.prefer);
  const byUrl = new Map<string, Station>();
  for (const r of rows) {
    const name = (r.name ?? '').trim();
    const url = (r.url_resolved ?? '').trim();
    const lat = r.geo_lat, lon = r.geo_long;
    if (r.lastcheckok !== 1 || !name || !url) continue;
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    if (!url.startsWith('https://') && !(opts.allowHttp && url.startsWith('http://'))) continue;
    if (r.ssl_error === 1 || PLAYLIST.test(url)) continue;
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      continue;
    }
    if (hostname === 'radio.garden' || hostname.endsWith('.radio.garden')) continue;
    if (r.hls === 1 && !opts.allowHls) continue;
    const s: Station = {
      id: r.stationuuid, name, url, cc: (r.countrycode || '').toUpperCase(), state: (r.state || '').trim(),
      lat, lon, codec: r.codec || '', bitrate: r.bitrate || 0, hls: r.hls === 1,
      clicks: r.clickcount || 0, votes: r.votes || 0,
      tags: (r.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 3),
    };
    const prev = byUrl.get(url);
    if (!prev || first(s, prev) < 0) byUrl.set(url, s);
  }
  return [...byUrl.values()];
}
