import { describe, expect, it } from 'vitest';
import { diffSnapshots, snapshotFrom, type Snapshot } from '../../scripts/lib/changelog';
import { emit } from '../../scripts/lib/emit';
import { Gazetteer } from '../../scripts/lib/gazetteer';
import { normalize } from '../../scripts/lib/normalize';
import { preferredIds, stationPlaces } from '../../scripts/lib/pipeline';
import { aggregate, capFamilies, type Place } from '../../scripts/lib/places';
import type { RBStation } from '../../scripts/lib/radiobrowser';

// Ruling 39: Radio Browser's clickcount is a 24-hour count, mostly 0-2, that changes from run to run. Which
// listing keeps a stream, which channels of a broadcaster stay and where a place is anchored must not depend on it.

/** mulberry32: a small seeded generator, so a failing case names its seed. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CITIES = [
  { name: 'Leipzig', lat: 51.34, lon: 12.37, cc: 'DE', pop: 600000, tz: 'Europe/Berlin' },
  { name: 'Gera', lat: 50.88, lon: 12.08, cc: 'DE', pop: 90000, tz: 'Europe/Berlin' },
  { name: 'Quillota', lat: -32.88, lon: -71.25, cc: 'CL', pop: 90000, tz: 'America/Santiago' },
];
const gazetteer = new Gazetteer(CITIES);

/**
 * A small world with the churn seen in the real data: streams listed two or three times under different
 * uuids and names, sometimes at another city (Studentenradio at Leipzig and at Gera), vote ties, and a
 * broadcaster with 14 channels at one place, more than capFamilies keeps.
 */
function world(seed: number): RBStation[] {
  const r = random(seed);
  const hex = () => Math.floor(r() * 0xffffffff).toString(16).padStart(8, '0');
  const rows: RBStation[] = [];
  const add = (city: (typeof CITIES)[number], name: string, url: string) => rows.push({
    stationuuid: `${hex()}-${hex()}`, name, url_resolved: url, countrycode: city.cc, state: '',
    geo_lat: city.lat + (r() - 0.5) * 0.04, geo_long: city.lon + (r() - 0.5) * 0.04,
    codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1, ssl_error: 0,
    clickcount: Math.floor(r() * 4), votes: Math.floor(r() * 3), tags: '',
  });
  for (let i = 0; i < 40; i++) {
    const url = `https://s${i}.example.org/live`;
    const listings = 1 + Math.floor(r() * 3);
    const home = CITIES[Math.floor(r() * CITIES.length)];
    for (let k = 0; k < listings; k++) {
      const city = k > 0 && r() < 0.4 ? CITIES[Math.floor(r() * CITIES.length)] : home;
      add(city, k === 0 ? `Radio ${i}` : `Radio ${i} ${['FM', '24/7', 'Online'][k % 3]}`, url);
    }
  }
  for (let k = 0; k < 14; k++) add(CITIES[0], `Big FM ${k}`, `https://ch${k}.bigfm.example.de/live`);
  return rows;
}

/** The same rows as another run would fetch them: clickcount drawn again from 0..3, rows in another order. */
function rerun(rows: RBStation[], seed: number): RBStation[] {
  const r = random(seed);
  const out = rows.map(row => ({ ...row, clickcount: Math.floor(r() * 4) }));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const opts = { allowHttp: false, allowHls: true };
const shape = (places: Place[]) => places.map(p => [p.lat, p.lon, p.stations.map(s => s.id).sort()]);

function build(rows: RBStation[], prefer?: ReadonlySet<string>) {
  const { placesJson, chunks } = emit(stationPlaces(rows, { ...opts, prefer }).places, gazetteer, 'v');
  return snapshotFrom(placesJson, chunks, '2026-09-26', null);
}

/** One run as the workflow chains them: build-data prefers what the previous snapshot has or lost, then the snapshot. */
function night(rows: RBStation[], day: string, prev: Snapshot | null): Snapshot {
  const { places } = stationPlaces(rows, { ...opts, prefer: prev ? preferredIds(prev) : new Set() });
  const { placesJson, chunks } = emit(places, gazetteer, day);
  return snapshotFrom(placesJson, chunks, day, prev);
}

/** The listings in `ids` fail Radio Browser's check for this run. */
const down = (rows: RBStation[], ids: ReadonlySet<string>) =>
  rows.map(row => (ids.has(row.stationuuid) ? { ...row, lastcheckok: 0 } : row));
const counts = (prev: Snapshot, next: Snapshot) => {
  const d = diffSnapshots(prev, next);
  return [d.added.length, d.removed.length, d.changed.length];
};

describe('station identity under clickcount churn', () => {
  it('keeps the most voted listing of a stream, then the smallest uuid, whatever the clicks and row order', () => {
    for (const w of [1, 2, 3]) {
      const rows = world(w);
      const expected = new Map<string, RBStation>();
      for (const row of rows) {
        const best = expected.get(row.url_resolved);
        const wins = !best || row.votes > best.votes || (row.votes === best.votes && row.stationuuid < best.stationuuid);
        if (wins) expected.set(row.url_resolved, row);
      }
      const ids = [...expected.values()].map(row => row.stationuuid).sort();
      for (let seed = 1; seed <= 25; seed++) {
        expect(normalize(rerun(rows, seed), opts).map(s => s.id).sort(), `world ${w}, seed ${seed}`).toEqual(ids);
      }
    }
  });

  it('keeps the listing the previous snapshot had, even against more votes', () => {
    const rows = world(4);
    const url = rows.find((row, i) => rows.findIndex(o => o.url_resolved === row.url_resolved) !== i)!.url_resolved;
    const twins = rows.filter(row => row.url_resolved === url).map(row => row.stationuuid);
    const known = twins[twins.length - 1];
    const voted = rows.map(row => (row.url_resolved === url ? { ...row, votes: row.stationuuid === known ? 0 : 99 } : row));
    for (let seed = 1; seed <= 10; seed++) {
      const ids = normalize(rerun(voted, seed), { ...opts, prefer: new Set([known]) }).map(s => s.id);
      expect(ids.filter(id => twins.includes(id)), `seed ${seed}`).toEqual([known]);
    }
  });

  it('anchors places and caps broadcasters the same way on every run', () => {
    for (const w of [1, 2, 3]) {
      const stations = normalize(world(w), opts);
      const reference = shape(capFamilies(aggregate(stations)));
      expect(reference.some(([, , ids]) => (ids as string[]).length >= 10)).toBe(true);
      for (let seed = 1; seed <= 25; seed++) {
        const again = normalize(rerun(world(w), seed), opts);
        expect(shape(capFamilies(aggregate(again))), `world ${w}, seed ${seed}`).toEqual(reference);
      }
    }
  });

  it('yields the same snapshot from runs that differ only in clicks and row order', () => {
    for (const w of [1, 2, 3]) {
      const first = build(world(w));
      const known = new Set(Object.keys(first.stations));
      for (let seed = 1; seed <= 25; seed++) {
        expect(build(rerun(world(w), seed)), `world ${w}, seed ${seed}`).toEqual(first);
        expect(build(rerun(world(w), seed), known), `world ${w}, seed ${seed}, sticky`).toEqual(first);
      }
    }
  });
});

// Ruling 42: a listing that fails one check leaves its stream and its broadcaster slot to a stand-in. It is in
// the snapshot's gone list then, and build-data prefers gone ids too, so on its return it takes both back.
describe('station identity when listings fail a check for one run', () => {
  it('gives the stream and the channel slot back to the listings that held them', () => {
    const [leipzig, gera] = CITIES;
    const row = (id: string, city: (typeof CITIES)[number], url: string, votes: number): RBStation => ({
      stationuuid: id, name: id, url_resolved: url, countrycode: city.cc, state: '', geo_lat: city.lat, geo_long: city.lon,
      codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1, ssl_error: 0, clickcount: 0, votes, tags: '',
    });
    const rows = [
      row('holder', leipzig, 'https://studentenradio.example.org/live', 2),
      row('stand-in', gera, 'https://studentenradio.example.org/live', 1),
      ...Array.from({ length: 11 }, (_, k) => row(`big-${k}`, leipzig, `https://ch${k}.bigfm.example.de/live`, 20 - k)),
    ];
    const f1 = night(rows, '2026-09-25', night(rows, '2026-09-24', null));
    const held = [...Array.from({ length: 10 }, (_, k) => `big-${k}`), 'holder'].sort();
    expect(Object.keys(f1.stations).sort()).toEqual(held);

    const f2 = night(down(rows, new Set(['holder', 'big-3'])), '2026-09-26', f1);
    expect(Object.keys(f2.stations)).toEqual(expect.arrayContaining(['stand-in', 'big-10']));
    expect(Object.keys(f2.gone).sort()).toEqual(['big-3', 'holder']);

    const f3 = night(rows, '2026-09-27', f2);
    expect(Object.keys(f3.stations).sort()).toEqual(held);
    expect(f3.stations.holder.slice(0, 4)).toEqual(['holder', 'Leipzig', 'DE', '2026-09-24']);
    expect(counts(f1, f3)).toEqual([0, 0, 0]);

    // Preferring only the stations of f2, as before Ruling 42, would hand both to the stand-ins for good.
    const stale = stationPlaces(rows, { ...opts, prefer: new Set(Object.keys(f2.stations)) }).places.flatMap(p => p.stations.map(s => s.id));
    expect(stale).toEqual(expect.arrayContaining(['stand-in', 'big-10']));
    expect(stale).not.toContain('holder');
    expect(stale).not.toContain('big-3');
  });

  it('comes back to the same dataset after a tenth of its stations fail one check, whatever the clicks and row order', () => {
    let standIns = 0;
    for (const w of [1, 2, 3]) {
      const rows = world(w);
      const f1 = night(rows, '2026-09-25', night(rows, '2026-09-24', null));
      for (let seed = 1; seed <= 10; seed++) {
        const r = random(1000 + seed);
        const flap = new Set(Object.keys(f1.stations).filter(() => r() < 0.1));
        const f2 = night(down(rerun(rows, seed), flap), '2026-09-26', f1);
        const f3 = night(rerun(rows, seed + 100), '2026-09-27', f2);
        standIns += counts(f1, f2)[0] + counts(f1, f2)[2];
        expect(counts(f1, f3), `world ${w}, seed ${seed}`).toEqual([0, 0, 0]);
        expect(f3.stations, `world ${w}, seed ${seed}`).toEqual(f1.stations);
      }
    }
    expect(standIns).toBeGreaterThan(0);
  });
});
