export interface Places {
  v: string;
  n: number;
  lat: Float32Array;
  lon: Float32Array;
  count: Uint16Array;
  name: string[];
  cc: string[];
  tz: string[];
}

export interface StationRow {
  place: number;
  id: string;
  name: string;
  url: string;
  codec: string;
  bitrate: number;
  tags: string[];
}

interface PlacesJson { v: string; lat: number[]; lon: number[]; count: number[]; name: string[]; cc: string[]; tzi: number[]; tzs: string[] }
type Row = [number, string, string, string, string, number, string];

export class DataStore {
  places!: Places;
  private chunks = new Map<string, Promise<StationRow[]>>();

  constructor(private base = 'data/', private fetchFn: typeof fetch = (u, i) => fetch(u, i)) {}

  async load(): Promise<Places> {
    const r = await this.fetchFn(`${this.base}places.json`);
    if (!r.ok) throw new Error(`places.json: HTTP ${r.status}`);
    const j = (await r.json()) as PlacesJson;
    this.places = {
      v: j.v, n: j.lat.length,
      lat: Float32Array.from(j.lat), lon: Float32Array.from(j.lon), count: Uint16Array.from(j.count),
      name: j.name, cc: j.cc, tz: j.tzi.map(i => j.tzs[i]),
    };
    return this.places;
  }

  async stationsFor(place: number): Promise<StationRow[]> {
    const rows = await this.chunk(this.places.cc[place]);
    return rows.filter(r => r.place === place);
  }

  private chunk(cc: string): Promise<StationRow[]> {
    let p = this.chunks.get(cc);
    if (!p) {
      p = this.fetchFn(`${this.base}st/${cc}.json`)
        .then(r => { if (!r.ok) throw new Error(`st/${cc}.json: HTTP ${r.status}`); return r.json(); })
        .then((j: { rows: Row[] }) => j.rows.map(([place, id, name, url, codec, bitrate, tags]) => ({
          place, id, name, url, codec, bitrate, tags: tags ? tags.split(',') : [],
        })));
      p.catch(() => this.chunks.delete(cc));
      this.chunks.set(cc, p);
    }
    return p;
  }
}
