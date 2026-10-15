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
  /** Placed at the city its `state` names, for want of coordinates (Ruling 51). */
  placed: boolean;
}

export interface NormalizeOptions {
  allowHttp: boolean;
  allowHls: boolean;
  /** The ids of the previous snapshot and the ones it recently lost (Rulings 39, 42). */
  prefer?: ReadonlySet<string>;
  /** Coordinates for a row without them, or null when it stays off the map (Ruling 51, CityPlacer.place). */
  place?: (cc: string, state: string) => { lat: number; lon: number } | null;
}

const PLAYLIST = /\.(pls|m3u|asx|xspf)(\?|$)/i;

/**
 * Ruling 39: decides which listing keeps a stream, which channels of a broadcaster stay and where a place is
 * anchored. A station in `prefer` comes first (build-data prefers what the previous snapshot has or recently
 * lost, Ruling 42), then a station with its own coordinates before one placed at its city (Ruling 51), then more
 * votes, then the smaller uuid. Never clickcount: it is a 24-hour count, mostly 0-2, so a winner picked by clicks
 * changes from run to run.
 *
 * `prefer` first keeps the map sticky: a new listing never takes a broadcaster slot or an anchor from a known
 * station, whether either has coordinates or not. Coordinates before votes: on the upgrade night no placed
 * station is preferred, so stations with coordinates anchor the places and take the slots; the night after, the
 * kept ones of both kinds are preferred, and coordinates still decide between them, so the votes of placed channels
 * never move an anchor to the city point. The stream is the one pick where coordinates beat `prefer` (normalize).
 */
export function byIdentity(prefer: ReadonlySet<string> = new Set()): (a: Station, b: Station) => number {
  return (a, b) => Number(prefer.has(b.id)) - Number(prefer.has(a.id)) || Number(a.placed) - Number(b.placed)
    || b.votes - a.votes || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function normalize(rows: RBStation[], opts: NormalizeOptions): Station[] {
  const first = byIdentity(opts.prefer);
  const byUrl = new Map<string, Station>();
  for (const r of rows) {
    const name = (r.name ?? '').trim();
    const url = (r.url_resolved ?? '').trim();
    if (r.lastcheckok !== 1 || !name || !url) continue;
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
    const cc = (r.countrycode || '').toUpperCase(), state = (r.state || '').trim();
    let lat = r.geo_lat, lon = r.geo_long, placed = false;
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      // Ruling 51: no coordinates, so the city its state names, if opts.place knows one.
      const at = opts.place?.(cc, state);
      if (!at) continue;
      ({ lat, lon } = at);
      placed = true;
    } else if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    const s: Station = {
      id: r.stationuuid, name, url, cc, state, lat, lon, codec: r.codec || '', bitrate: r.bitrate || 0, hls: r.hls === 1,
      clicks: r.clickcount || 0, votes: r.votes || 0,
      tags: (r.tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean).slice(0, 3), placed,
    };
    // Ruling 51: a row with coordinates keeps its stream against one placed by its city, whatever the votes, the
    // uuid or the previous snapshot say; between two of a kind, byIdentity decides.
    const prev = byUrl.get(url);
    if (!prev || (prev.placed && !placed) || (prev.placed === placed && first(s, prev) < 0)) byUrl.set(url, s);
  }
  return [...byUrl.values()];
}
