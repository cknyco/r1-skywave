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
//
// The seeded loops below take about a second under a full parallel run, and once took more than vitest's default
// 5 s on a loaded machine. This file runs in the nightly Pages job, where a timeout would block the deploy, so they
// have SLOW (30 s) instead.
const SLOW = 30_000;

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
  }, SLOW);

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
  }, SLOW);

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
  }, SLOW);

  it('yields the same snapshot from runs that differ only in clicks and row order', () => {
    for (const w of [1, 2, 3]) {
      const first = build(world(w));
      const known = new Set(Object.keys(first.stations));
      for (let seed = 1; seed <= 25; seed++) {
        expect(build(rerun(world(w), seed)), `world ${w}, seed ${seed}`).toEqual(first);
        expect(build(rerun(world(w), seed), known), `world ${w}, seed ${seed}, sticky`).toEqual(first);
      }
    }
  }, SLOW);
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
  }, SLOW);
});

// Ruling 51: a station without coordinates sits at the city its state names. A row with coordinates wins a shared
// stream whatever the votes, the uuid or the previous snapshot say. For anchors and broadcaster slots the previous
// snapshot comes first, as before, and between two stations it has (or two it has not) the one with coordinates;
// between two of a kind the rest is unchanged.
describe('station identity with rows placed by their city', () => {
  const place = (cc: string, state: string) => {
    const c = CITIES.find(x => x.cc === cc && x.name === state);
    return c ? { lat: c.lat, lon: c.lon } : null;
  };
  const placedOpts = { ...opts, place };

  /** world(seed) plus listings without coordinates: a third of the streams again, voted up, and ten streams of their own. */
  function placedWorld(seed: number): RBStation[] {
    const r = random(seed + 500);
    const hex = () => Math.floor(r() * 0xffffffff).toString(16).padStart(8, '0');
    const rows = world(seed);
    const noGeo = (url: string, cc: string, state: string, name: string): RBStation => ({
      stationuuid: `${hex()}-${hex()}`, name, url_resolved: url, countrycode: cc, state, geo_lat: null, geo_long: null,
      codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1, ssl_error: 0, clickcount: Math.floor(r() * 4), votes: 3 + Math.floor(r() * 5), tags: '',
    });
    const extra: RBStation[] = [];
    for (const url of [...new Set(rows.map(row => row.url_resolved))]) {
      const cc = rows.find(row => row.url_resolved === url)!.countrycode;
      if (r() < 0.33) extra.push(noGeo(url, cc, cc === 'CL' ? 'Quillota' : r() < 0.5 ? 'Leipzig' : 'Gera', `Placed ${url}`));
    }
    for (let k = 0; k < 10; k++) extra.push(noGeo(`https://own${k}.example.net/live`, 'DE', ['Leipzig', 'Gera', 'Saxony', ''][k % 4], `Own ${k}`));
    return [...rows, ...extra];
  }

  function nightPlaced(rows: RBStation[], day: string, prev: Snapshot | null): Snapshot {
    const { places } = stationPlaces(rows, { ...placedOpts, prefer: prev ? preferredIds(prev) : new Set() });
    const { placesJson, chunks } = emit(places, gazetteer, day);
    return snapshotFrom(placesJson, chunks, day, prev);
  }

  it('keeps the row with coordinates of every shared stream, and the same snapshot whatever the clicks and row order', () => {
    for (const w of [1, 2, 3]) {
      const rows = placedWorld(w);
      const geoUrls = new Set(rows.filter(row => row.geo_lat !== null).map(row => row.url_resolved));
      const stations = normalize(rows, placedOpts);
      expect(stations.filter(s => s.placed).map(s => s.name).filter(n => n.startsWith('Own')).sort()).toEqual(
        ['Own 0', 'Own 1', 'Own 4', 'Own 5', 'Own 8', 'Own 9'],
      );
      for (const s of stations) if (geoUrls.has(s.url)) expect(s.placed, `world ${w}: ${s.url}`).toBe(false);

      const first = nightPlaced(rows, '2026-09-26', null);
      for (let seed = 1; seed <= 15; seed++) {
        expect(nightPlaced(rerun(rows, seed), '2026-09-26', null), `world ${w}, seed ${seed}`).toEqual(first);
      }
    }
  }, SLOW);

  // A placed station kept on the upgrade night is in the previous snapshot the night after, so preferred like every
  // other. Were only the stream decided by coordinates, the votes of placed channels would then anchor a place at the
  // city point, pull in the stations around it and win the broadcaster's slots: 8 stations with coordinates removed
  // here, a night after the baseline that was to absorb every change the new rules make.
  it('keeps the same stations and place names on the night after placed stations join the snapshot', () => {
    const [leipzig] = CITIES;
    const row = (id: string, lat: number | null, url: string, votes: number, state = ''): RBStation => ({
      stationuuid: id, name: id, url_resolved: url, countrycode: 'DE', state, geo_lat: lat, geo_long: lat === null ? null : leipzig.lon,
      codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1, ssl_error: 0, clickcount: 0, votes, tags: '',
    });
    // One broadcaster: 8 channels 3.3 km north of the city point, 8 channels 3.3 km south (6.7 km apart, two places),
    // and 3 listings without coordinates that name Leipzig, better voted than all of them.
    const north = Array.from({ length: 8 }, (_, k) => row(`n${k}`, leipzig.lat + 0.03, `https://n${k}.mdr.example.de/live`, 1 + k));
    const south = Array.from({ length: 8 }, (_, k) => row(`s${k}`, leipzig.lat - 0.03, `https://s${k}.mdr.example.de/live`, 1 + k));
    const city = Array.from({ length: 3 }, (_, k) => row(`c${k}`, null, `https://c${k}.mdr.example.de/live`, 100 + k, 'Leipzig'));
    const geo = nightPlaced([...north, ...south], '2026-09-26', null);
    const n1 = nightPlaced([...north, ...south, ...city], '2026-09-27', geo);
    expect(Object.keys(n1.stations).sort()).toEqual([...Object.keys(geo.stations), 'c1', 'c2'].sort());

    const n2 = nightPlaced([...north, ...south, ...city], '2026-09-28', n1);
    expect(n2.stations).toEqual(n1.stations);
    expect(counts(n1, n2)).toEqual([0, 0, 0]);
    expect(nightPlaced(rerun([...north, ...south, ...city], 3), '2026-09-29', n2).stations).toEqual(n1.stations);
  });

  // The previous snapshot comes before coordinates: a known placed channel keeps its broadcaster slot against a new
  // listing with coordinates next to it, as a known channel with coordinates keeps it against a better-voted one.
  // With coordinates first, the new one would take the slot and the placed station would never come back.
  it('keeps a known placed station at a capped place when a new station of the same broadcaster with coordinates arrives', () => {
    const [leipzig] = CITIES;
    const row = (id: string, lat: number | null, url: string, votes: number, state = ''): RBStation => ({
      stationuuid: id, name: id, url_resolved: url, countrycode: 'DE', state, geo_lat: lat, geo_long: lat === null ? null : leipzig.lon,
      codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1, ssl_error: 0, clickcount: 0, votes, tags: '',
    });
    // Nine channels with coordinates 1 km north of the city point and one listing without them that names Leipzig:
    // ten channels of one broadcaster at one place, the cap.
    const geo = Array.from({ length: 9 }, (_, k) => row(`g${k}`, leipzig.lat + 0.01, `https://g${k}.mdr.example.de/live`, 1 + k));
    const city = row('city', null, 'https://city.mdr.example.de/live', 50, 'Leipzig');
    const n0 = nightPlaced([...geo, city], '2026-09-26', null);
    const n1 = nightPlaced([...geo, city], '2026-09-27', n0);
    expect(Object.keys(n1.stations).sort()).toEqual([...geo.map(r => r.stationuuid), 'city'].sort());

    // A new channel of the same broadcaster, with coordinates 3 km from the city point and more votes than all.
    const fresh = row('fresh', leipzig.lat - 0.027, 'https://fresh.mdr.example.de/live', 900);
    const n2 = nightPlaced([...geo, city, fresh], '2026-09-28', n1);
    expect(n2.stations).toEqual(n1.stations);
    expect(counts(n1, n2)).toEqual([0, 0, 0]);
    const n3 = nightPlaced(rerun([...geo, city, fresh], 5), '2026-09-29', n2);
    expect(n3.stations).toEqual(n1.stations);
    expect(counts(n2, n3)).toEqual([0, 0, 0]);
  });

  it('gives a stream back to its row with coordinates when it returns, against the previous snapshot', () => {
    const [leipzig] = CITIES;
    const url = 'https://mdr.example.de/live';
    const geo: RBStation = {
      stationuuid: 'geo', name: 'MDR', url_resolved: url, countrycode: 'DE', state: '', geo_lat: leipzig.lat, geo_long: leipzig.lon,
      codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1, ssl_error: 0, clickcount: 0, votes: 0, tags: '',
    };
    const placed: RBStation = { ...geo, stationuuid: 'city', state: 'Leipzig', geo_lat: null, geo_long: null, votes: 50 };
    const f1 = nightPlaced([geo, placed], '2026-09-25', null);
    expect(Object.keys(f1.stations)).toEqual(['geo']);

    // The row with coordinates fails one check: the placed listing carries the stream for a night.
    const f2 = nightPlaced([{ ...geo, lastcheckok: 0 }, placed], '2026-09-26', f1);
    expect(Object.keys(f2.stations)).toEqual(['city']);
    expect(counts(f1, f2)).toEqual([0, 0, 1]);

    // Back the next night, it wins although the previous snapshot has the placed listing and not it.
    const f3 = nightPlaced([geo, placed], '2026-09-27', f2);
    expect(Object.keys(f3.stations)).toEqual(['geo']);
    expect(f3.stations.geo[3]).toBe('2026-09-25');
    expect(counts(f1, f3)).toEqual([0, 0, 0]);
  });
});
