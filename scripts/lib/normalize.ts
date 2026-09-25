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

export function normalize(rows: RBStation[], opts: { allowHttp: boolean; allowHls: boolean }): Station[] {
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
    if (!prev || s.clicks > prev.clicks) byUrl.set(url, s);
  }
  return [...byUrl.values()];
}
