import { describe, expect, it } from 'vitest';
import {
  addDays, dayBase, diffSnapshots, escapeMd, isDay, isLegacy, latestJson, newStations, parseSnapshot, renderMarkdown,
  snapshotFrom, stableJson, streamHash, type Diff, type Snapshot,
} from '../../scripts/lib/changelog';
import type { ChunkJson, ChunkRow, PlacesJson } from '../../scripts/lib/emit';

const places: PlacesJson = {
  v: 'v', lat: [52.5, 48.2, 47.1], lon: [13.4, 16.4, 15.4], count: [3, 1, 2],
  name: ['Berlin', 'Wien', 'Graz'], cc: ['DE', 'AT', 'AT'], tzi: [0, 1, 1], tzs: ['Europe/Berlin', 'Europe/Vienna'],
};
const row = (place: number, id: string, name = id.toUpperCase(), url = `https://x/${id}`): ChunkRow =>
  [place, id, name, url, 'MP3', 128, ''];
/** The stream hash of the station `row(place, id)` writes. */
const h = (id: string) => streamHash(`https://x/${id}`);
const chunks = (...rows: ChunkRow[]): Map<string, ChunkJson> => {
  const m = new Map<string, ChunkJson>();
  for (const r of rows) {
    const cc = places.cc[r[0]];
    m.set(cc, { v: 'v', rows: [...(m.get(cc)?.rows ?? []), r] });
  }
  return m;
};
const noChange = (total: number): Diff => ({ added: [], removed: [], changed: [], byCountry: {}, total, baseline: false });

describe('snapshotFrom', () => {
  it('records every current station with place name, country, first-seen date and stream hash', () => {
    const s = snapshotFrom(places, chunks(row(0, 'a'), row(0, 'b'), row(1, 'c')), '2026-09-26', null);
    expect(s).toEqual({
      v: 2,
      baseline: '2026-09-26',
      date: '2026-09-26',
      stations: {
        a: ['A', 'Berlin', 'DE', '2026-09-26', h('a')],
        b: ['B', 'Berlin', 'DE', '2026-09-26', h('b')],
        c: ['C', 'Wien', 'AT', '2026-09-26', h('c')],
      },
      gone: {},
    });
  });

  it('hashes the stream URL to 12 hex characters of its SHA-1', () => {
    expect(streamHash('https://x/a')).toMatch(/^[0-9a-f]{12}$/);
    expect(streamHash('https://x/a')).toBe(streamHash('https://x/a'));
    expect(streamHash('https://x/a')).not.toBe(streamHash('https://x/b'));
    expect(streamHash('abc')).toBe('a9993e364706'); // SHA-1("abc") = a9993e364706816a…
  });

  it('carries firstSeen and the baseline over, refreshes names, moves stations that disappeared to gone', () => {
    const prev: Snapshot = {
      v: 2, baseline: '2026-09-01', date: '2026-09-25',
      stations: { a: ['Old name', 'Berlin', 'DE', '2026-09-01', h('a')], x: ['X', 'Wien', 'AT', '2026-09-03', h('x')] },
      gone: {},
    };
    const s = snapshotFrom(places, [...chunks(row(0, 'a'), row(2, 'd')).values()], '2026-09-26', prev);
    expect(s.baseline).toBe('2026-09-01');
    expect(s.date).toBe('2026-09-26');
    expect(s.stations).toEqual({ a: ['A', 'Berlin', 'DE', '2026-09-01', h('a')], d: ['D', 'Graz', 'AT', '2026-09-26', h('d')] });
    expect(s.gone).toEqual({ x: ['X', 'Wien', 'AT', '2026-09-03', '2026-09-26', h('x')] });
  });

  it('gives a station that returns its first-seen date back, so it is not new again', () => {
    const night1 = snapshotFrom(places, chunks(row(0, 'a'), row(1, 'b')), '2026-09-01', null);
    const night2 = snapshotFrom(places, chunks(row(0, 'a')), '2026-09-20', night1);
    expect(night2.gone).toEqual({ b: ['B', 'Wien', 'AT', '2026-09-01', '2026-09-20', h('b')] });
    const night3 = snapshotFrom(places, chunks(row(0, 'a'), row(1, 'b')), '2026-09-21', night2);
    expect(night3.stations.b).toEqual(['B', 'Wien', 'AT', '2026-09-01', h('b')]);
    expect(night3.gone).toEqual({});
    expect(diffSnapshots(night2, night3).added.map(e => e.id)).toEqual(['b']); // the log still reports it
    expect(newStations(night3, '2026-09-21', places, chunks(row(0, 'a'), row(1, 'b'))).stations).toEqual([]);
  });

  it('treats a new id with the same name at the same place as the station it duplicates', () => {
    const prev: Snapshot = {
      v: 2, baseline: '2026-09-01', date: '2026-09-25',
      stations: { c: ['Radio  C', 'Wien', 'AT', '2026-09-20', h('c')] },
      gone: { a: ['Radio A', 'Berlin', 'DE', '2026-09-01', '2026-09-25', h('a')] },
    };
    // a2 replaces a (gone), c2 joins c (still there): both keep the older date; case and spacing do not matter.
    const now = chunks(row(0, 'a2', ' radio a'), row(1, 'c', 'Radio C'), row(1, 'c2', 'RADIO C'), row(2, 'a3', 'Radio A'), row(0, 'n', 'New'));
    const s = snapshotFrom(places, now, '2026-09-26', prev);
    expect(s.stations).toEqual({
      a2: [' radio a', 'Berlin', 'DE', '2026-09-01', h('a2')],
      c: ['Radio C', 'Wien', 'AT', '2026-09-20', h('c')],
      c2: ['RADIO C', 'Wien', 'AT', '2026-09-20', h('c2')],
      a3: ['Radio A', 'Graz', 'AT', '2026-09-26', h('a3')], // same name, other place: a different station
      n: ['New', 'Berlin', 'DE', '2026-09-26', h('n')],
    });
    expect(diffSnapshots(prev, s).added.map(e => e.id)).toEqual(['c2', 'a3', 'a2', 'n']);
    // new.json lists each station once, even when two ids share its name and place.
    expect(newStations(s, '2026-09-26', places, now).stations.map(n => n.id)).toEqual(['n', 'a3', 'c2']);
  });

  it('gives a new id on a known stream the earliest first-seen date of that stream, from stations or gone', () => {
    const prev: Snapshot = {
      v: 2, baseline: '2026-09-01', date: '2026-09-25',
      stations: { a: ['Radio A', 'Berlin', 'DE', '2026-09-10', streamHash('https://s/1')] },
      gone: { g: ['Radio G', 'Wien', 'AT', '2026-09-05', '2026-09-20', streamHash('https://s/2')] },
    };
    const s = snapshotFrom(places, chunks(row(2, 'a2', 'Other name', 'https://s/1'), row(0, 'g2', 'Radio G2', 'https://s/2')), '2026-09-26', prev);
    expect(s.stations.a2[3]).toBe('2026-09-10');
    expect(s.stations.g2[3]).toBe('2026-09-05');
    expect(s.gone.g).toBeDefined(); // g itself stays remembered until its uuid returns or 90 days pass
  });

  it('forgets gone stations 90 days after they went missing', () => {
    const prev: Snapshot = {
      v: 2, baseline: '2026-01-01', date: '2026-09-25', stations: {},
      gone: {
        kept: ['K', 'Wien', 'AT', '2026-01-01', '2026-06-28', h('kept')],
        old: ['O', 'Wien', 'AT', '2026-01-01', '2026-06-27', h('n')],
      },
    };
    const s = snapshotFrom(places, chunks(row(1, 'n', 'O')), '2026-09-26', prev); // 2026-06-28 is exactly 90 days back
    expect(Object.keys(s.gone)).toEqual(['kept']);
    expect(s.stations.n).toEqual(['O', 'Wien', 'AT', '2026-09-26', h('n')]); // no twin or stream left to inherit from
  });

  it('keeps an id that collides with Object.prototype as plain data', () => {
    const s = snapshotFrom(places, chunks(row(0, '__proto__', 'Odd')), '2026-09-26', null);
    expect(Object.keys(s.stations)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(s.stations)).toBe(Object.prototype);
    expect(JSON.parse(stableJson(s)).stations.__proto__).toEqual(['Odd', 'Berlin', 'DE', '2026-09-26', h('__proto__')]);
  });
});

describe('diffSnapshots', () => {
  const prev: Snapshot = {
    v: 2, baseline: '2026-09-01', date: '2026-09-25',
    stations: {
      a: ['A', 'Berlin', 'DE', '2026-09-01', h('a')],
      b: ['B', 'Berlin', 'DE', '2026-09-01', h('b')],
      c: ['C', 'Wien', 'AT', '2026-09-01', h('c')],
    },
    gone: {},
  };
  const next = snapshotFrom(places, chunks(row(0, 'a'), row(0, 'f'), row(1, 'c'), row(2, 'e', 'E | FM'), row(2, 'd')), '2026-09-26', prev);

  it('reports a first run as the baseline, with no changes', () => {
    expect(diffSnapshots(null, next)).toEqual({ added: [], removed: [], changed: [], byCountry: {}, total: 5, baseline: true });
  });

  it('lists added and removed stations by country, then name', () => {
    const d = diffSnapshots(prev, next);
    expect(d.baseline).toBe(false);
    expect(d.total).toBe(5);
    expect(d.added).toEqual([
      { id: 'd', name: 'D', place: 'Graz', cc: 'AT' },
      { id: 'e', name: 'E | FM', place: 'Graz', cc: 'AT' },
      { id: 'f', name: 'F', place: 'Berlin', cc: 'DE' },
    ]);
    expect(d.removed).toEqual([{ id: 'b', name: 'B', place: 'Berlin', cc: 'DE' }]);
    expect(d.changed).toEqual([]);
    expect(d.byCountry).toEqual({ AT: { added: 2, removed: 0, changed: 0 }, DE: { added: 1, removed: 1, changed: 0 } });
  });

  it('renders the change log and the latest.json summary', () => {
    const d = diffSnapshots(prev, next);
    expect(renderMarkdown(d, '2026-09-26', 5)).toBe([
      '# Station changes 2026-09-26',
      '',
      '5 stations: 3 added, 1 removed, 0 changed.',
      '',
      '| Country | Added | Removed | Changed |',
      '|:--|--:|--:|--:|',
      '| AT | 2 | 0 | 0 |',
      '| DE | 1 | 1 | 0 |',
      '',
      '## Added',
      '',
      '- D — Graz (AT)',
      '- E \\| FM — Graz (AT)',
      '- F — Berlin (DE)',
      '',
      '## Removed',
      '',
      '- B — Berlin (DE)',
      '',
    ].join('\n'));
    expect(latestJson(d, '2026-09-26', 5)).toEqual({
      v: 1, date: '2026-09-26', total: 5, added: 3, removed: 1, changed: 0, baseline: false,
      byCountry: { AT: { added: 2, removed: 0, changed: 0 }, DE: { added: 1, removed: 1, changed: 0 } },
    });
  });
});

describe('changed stations (Ruling 40)', () => {
  // The day before: four stations, baseline 2026-09-20; "Radio D" was new on 2026-09-22.
  const before = snapshotFrom(places, chunks(
    row(0, 'a', 'Radio A', 'https://s/1'), row(1, 'b', 'Radio B', 'https://s/2'), row(1, 'c', 'Radio C', 'https://s/3'), row(0, 'k', 'Kept'),
  ), '2026-09-20', null);
  const mid = snapshotFrom(places, chunks(
    row(0, 'a', 'Radio A', 'https://s/1'), row(1, 'b', 'Radio B', 'https://s/2'), row(1, 'c', 'Radio C', 'https://s/3'), row(0, 'k', 'Kept'),
    row(2, 'd', 'Radio D', 'https://s/4'),
  ), '2026-09-22', before);
  // Today the same streams are listed under other uuids: renamed, moved, both; and one station is really new.
  const nowRows = chunks(
    row(0, 'a2', 'Radio A 24/7', 'https://s/1'), // renamed
    row(2, 'b2', 'Radio B', 'https://s/2'), // moved from Wien to Graz
    row(0, 'c2', 'Radio C Berlin', 'https://s/3'), // renamed and moved to another country
    row(2, 'd2', 'Radio D', 'https://s/4'), // re-listed: same name, same place, new uuid
    row(0, 'k', 'Kept'),
    row(1, 'n', 'New'),
  );
  const now = snapshotFrom(places, nowRows, '2026-09-26', mid);

  it('pairs a removed and an added station with the same stream hash as one changed station', () => {
    const d = diffSnapshots(mid, now);
    expect(d.added).toEqual([{ id: 'n', name: 'New', place: 'Wien', cc: 'AT' }]);
    expect(d.removed).toEqual([]);
    expect(d.changed).toEqual([
      { id: 'b2', oldId: 'b', name: 'Radio B', oldName: 'Radio B', place: 'Graz', oldPlace: 'Wien', cc: 'AT', oldCc: 'AT' },
      { id: 'd2', oldId: 'd', name: 'Radio D', oldName: 'Radio D', place: 'Graz', oldPlace: 'Graz', cc: 'AT', oldCc: 'AT' },
      { id: 'a2', oldId: 'a', name: 'Radio A 24/7', oldName: 'Radio A', place: 'Berlin', oldPlace: 'Berlin', cc: 'DE', oldCc: 'DE' },
      { id: 'c2', oldId: 'c', name: 'Radio C Berlin', oldName: 'Radio C', place: 'Berlin', oldPlace: 'Wien', cc: 'DE', oldCc: 'AT' },
    ]);
    expect(d.byCountry).toEqual({ AT: { added: 1, removed: 0, changed: 2 }, DE: { added: 0, removed: 0, changed: 2 } });
  });

  it('carries firstSeen over through a changed pair', () => {
    expect(now.stations.a2[3]).toBe('2026-09-20');
    expect(now.stations.b2[3]).toBe('2026-09-20');
    expect(now.stations.c2[3]).toBe('2026-09-20');
    expect(now.stations.d2[3]).toBe('2026-09-22');
    expect(now.stations.n[3]).toBe('2026-09-26');
  });

  it('never makes a changed station new: new.json keeps its first-seen date', () => {
    expect(newStations(now, '2026-09-26', places, nowRows).stations).toEqual([
      { id: 'n', name: 'New', place: 1, placeName: 'Wien', cc: 'AT', since: '2026-09-26' },
      { id: 'd2', name: 'Radio D', place: 2, placeName: 'Graz', cc: 'AT', since: '2026-09-22' }, // new since the 22nd, as before
    ]);
  });

  it('renders a Changed column and section, naming only what changed', () => {
    const d = diffSnapshots(mid, now);
    expect(renderMarkdown(d, '2026-09-26', 6)).toBe([
      '# Station changes 2026-09-26',
      '',
      '6 stations: 1 added, 0 removed, 4 changed.',
      '',
      '| Country | Added | Removed | Changed |',
      '|:--|--:|--:|--:|',
      '| AT | 1 | 0 | 2 |',
      '| DE | 0 | 0 | 2 |',
      '',
      '## Added',
      '',
      '- New — Wien (AT)',
      '',
      '## Changed',
      '',
      '- Radio B — Wien → Graz (AT)',
      '- Radio D — Graz (AT), re-listed',
      '- Radio A → Radio A 24/7 — Berlin (DE)',
      '- Radio C — Wien (AT) → Radio C Berlin — Berlin (DE)',
      '',
    ].join('\n'));
    expect(latestJson(d, '2026-09-26', 6)).toMatchObject({ added: 1, removed: 0, changed: 4 });
  });

  it('escapes untrusted old and new names and places in changed entries', () => {
    const md = renderMarkdown({
      ...noChange(1),
      changed: [{
        id: 'x2', oldId: 'x', name: '<b>New</b> [x](y)', oldName: 'Old | *one*\n# h', place: 'P_Q', oldPlace: 'R#S', cc: 'D|E', oldCc: 'D|E',
      }],
      byCountry: { 'D|E': { added: 0, removed: 0, changed: 1 } },
    }, '2026-09-26', 1);
    expect(md).toContain('- Old \\| \\*one\\* \\# h — R\\#S → \\<b\\>New\\</b\\> \\[x\\](y) — P\\_Q (D\\|E)\n');
    expect(md.split('\n').filter(l => l.startsWith('#'))).toEqual(['# Station changes 2026-09-26', '## Changed']);
  });

  it('does not pair stations whose stream hash is unknown (snapshots written before Task 8c)', () => {
    const old = parseSnapshot('{"v":1,"baseline":"2026-09-20","stations":{"a":["Radio A","Berlin","DE","2026-09-20"]}}');
    const s = snapshotFrom(places, chunks(row(0, 'a2', 'Radio A 24/7', 'https://s/1')), '2026-09-26', old);
    expect(s.stations.a2[3]).toBe('2026-09-26');
    const d = diffSnapshots(old, s);
    expect(d.changed).toEqual([]);
    expect(d.added.map(e => e.id)).toEqual(['a2']);
    expect(d.removed.map(e => e.id)).toEqual(['a']);
  });
});

describe('dayBase (Ruling 41)', () => {
  const snap = (date: string): Snapshot => ({ v: 2, baseline: '2026-09-20', date, stations: {}, gone: {} });

  it('keeps the day base through later runs on the same day', () => {
    const kept = snap('2026-09-25');
    expect(dayBase(snap('2026-09-26'), kept, '2026-09-26')).toBe(kept);
  });

  it('adopts the previous snapshot when it is from an earlier day', () => {
    const prev = snap('2026-09-26');
    expect(dayBase(prev, snap('2026-09-25'), '2026-09-27')).toBe(prev);
    expect(dayBase(prev, null, '2026-09-27')).toBe(prev);
  });

  it('falls back to the previous snapshot when no day base is kept, and has none on the baseline night', () => {
    const prev = snap('2026-09-26');
    expect(dayBase(prev, null, '2026-09-26')).toBe(prev);
    expect(dayBase(null, snap('2026-09-25'), '2026-09-26')).toBeNull();
  });

  it('adopts an old snapshot without a date, even when a day base is kept', () => {
    const old = parseSnapshot('{"v":1,"baseline":"2026-09-25","stations":{}}');
    expect(dayBase(old, null, '2026-09-26')).toBe(old);
    expect(dayBase(old, snap('2026-09-25'), '2026-09-26')).toBe(old);
  });

  it('makes the day file cumulative: a station that flaps and recovers within the day is no change', () => {
    const base = snapshotFrom(places, chunks(row(0, 'a'), row(1, 'b')), '2026-09-25', null);
    const morning = snapshotFrom(places, chunks(row(0, 'a')), '2026-09-26', base);
    expect(diffSnapshots(dayBase(base, null, '2026-09-26'), morning).removed.map(e => e.id)).toEqual(['b']);
    const noon = snapshotFrom(places, chunks(row(0, 'a'), row(1, 'b'), row(2, 'c')), '2026-09-26', morning);
    const d = diffSnapshots(dayBase(morning, base, '2026-09-26'), noon);
    expect(d.removed).toEqual([]);
    expect(d.added.map(e => e.id)).toEqual(['c']);
  });
});

describe('renderMarkdown', () => {
  it('says so on the baseline night', () => {
    const md = renderMarkdown({ ...noChange(7906), baseline: true }, '2026-09-26', 7906);
    expect(md).toBe('# Station changes 2026-09-26\n\nBaseline: 7906 stations. Changes are reported from the next run on.\n');
  });

  it('names the baseline that replaces a snapshot from before Task 8c (Ruling 42)', () => {
    const md = renderMarkdown({ ...noChange(7906), baseline: true }, '2026-09-26', 7906, true);
    expect(md).toBe('# Station changes 2026-09-26\n\nBaseline (format upgrade): 7906 stations. Changes are reported from the next run on.\n');
  });

  it('sorts countries by the size of their change, then by code', () => {
    const e = (id: string, cc: string) => ({ id, name: id, place: 'P', cc });
    const c = (id: string, cc: string) => ({ id, oldId: `${id}0`, name: id, oldName: `${id}0`, place: 'P', oldPlace: 'P', cc, oldCc: cc });
    const md = renderMarkdown({
      added: [e('1', 'FR'), e('2', 'US'), e('3', 'US')], removed: [e('4', 'BR'), e('5', 'US')], changed: [c('6', 'BR'), c('7', 'BR')],
      byCountry: {
        BR: { added: 0, removed: 1, changed: 2 }, FR: { added: 1, removed: 0, changed: 0 }, US: { added: 2, removed: 1, changed: 0 },
      },
      total: 10, baseline: false,
    }, '2026-09-26', 10);
    expect(md).toContain('| BR | 0 | 1 | 2 |\n| US | 2 | 1 | 0 |\n| FR | 1 | 0 | 0 |\n');
  });

  it('caps each list at 200 lines', () => {
    const added = Array.from({ length: 250 }, (_, i) => ({ id: `${i}`, name: `S${i}`, place: 'P', cc: 'DE' }));
    const md = renderMarkdown({ ...noChange(250), added, byCountry: { DE: { added: 250, removed: 0, changed: 0 } } }, '2026-09-26', 250);
    expect(md.split('\n').filter(l => l.startsWith('- '))).toHaveLength(200);
    expect(md).toContain('\n\n…and 50 more\n');
    expect(md).not.toContain('## Removed');
    expect(md).not.toContain('## Changed');
  });

  it('escapes untrusted names so they cannot inject Markdown or HTML', () => {
    const md = renderMarkdown({
      ...noChange(1),
      added: [{ id: 'x', name: '<img src=x onerror=alert(1)> [click](https://e)\n# Owned', place: 'A_B*C', cc: 'D|E' }],
      byCountry: { 'D|E': { added: 1, removed: 0, changed: 0 } },
    }, '2026-09-26', 1);
    expect(md).toContain('- \\<img src=x onerror=alert(1)\\> \\[click\\](https://e) \\# Owned — A\\_B\\*C (D\\|E)\n');
    expect(md).toContain('| D\\|E | 1 | 0 | 0 |');
    expect(md.split('\n').filter(l => l.startsWith('#'))).toEqual(['# Station changes 2026-09-26', '## Added']);
  });
});

describe('escapeMd', () => {
  it('backslash-escapes \\ ` * _ [ ] < > | # and collapses newlines to one space', () => {
    expect(escapeMd('a\\b`c*d_e[f]g<h>i|j#k')).toBe('a\\\\b\\`c\\*d\\_e\\[f\\]g\\<h\\>i\\|j\\#k');
    expect(escapeMd(' two \r\n lines\n\nand\u2028more ')).toBe('two lines and more');
  });
});

describe('newStations', () => {
  const snap: Snapshot = {
    v: 2, baseline: '2026-09-01', date: '2026-09-26',
    stations: {
      a: ['A', 'Berlin', 'DE', '2026-09-01', h('a')], // baseline night: never "new", even inside the window
      b: ['B', 'Berlin', 'DE', '2026-09-12', h('b')], // exactly 14 days before 2026-09-26: in
      c: ['C', 'Wien', 'AT', '2026-09-11', h('c')], //   15 days: out
      d: ['Zeta', 'Graz', 'AT', '2026-09-26', h('d')],
      e: ['Alpha', 'Graz', 'AT', '2026-09-26', h('e')],
      f: ['F', 'Wien', 'AT', '2026-09-20', h('f')],
    },
    gone: {},
  };
  const now = chunks(row(0, 'a'), row(0, 'b'), row(1, 'c'), row(2, 'd'), row(2, 'e'), row(1, 'f'));

  it('lists stations first seen in the last 14 days, newest first, then by name', () => {
    const j = newStations(snap, '2026-09-26', places, now);
    expect(j.v).toBe(1);
    expect(j.date).toBe('2026-09-26');
    expect(j.days).toBe(14);
    expect(j.stations).toEqual([
      { id: 'e', name: 'Alpha', place: 2, placeName: 'Graz', cc: 'AT', since: '2026-09-26' },
      { id: 'd', name: 'Zeta', place: 2, placeName: 'Graz', cc: 'AT', since: '2026-09-26' },
      { id: 'f', name: 'F', place: 1, placeName: 'Wien', cc: 'AT', since: '2026-09-20' },
      { id: 'b', name: 'B', place: 0, placeName: 'Berlin', cc: 'DE', since: '2026-09-12' },
    ]);
  });

  it('is empty on the baseline night', () => {
    const s = snapshotFrom(places, now, '2026-09-26', null);
    expect(newStations(s, '2026-09-26', places, now).stations).toEqual([]);
  });

  it('caps the list and honours a shorter window', () => {
    expect(newStations(snap, '2026-09-26', places, now, 14, 2).stations.map(s => s.id)).toEqual(['e', 'd']);
    expect(newStations(snap, '2026-09-26', places, now, 6).stations.map(s => s.id)).toEqual(['e', 'd', 'f']);
  });

  it('resolves the place index from the current chunks and skips ids missing from them', () => {
    const moved = chunks(row(1, 'd'), row(2, 'e'));
    expect(newStations(snap, '2026-09-26', places, [...moved.values()]).stations).toEqual([
      { id: 'e', name: 'Alpha', place: 2, placeName: 'Graz', cc: 'AT', since: '2026-09-26' },
      { id: 'd', name: 'Zeta', place: 1, placeName: 'Wien', cc: 'AT', since: '2026-09-26' },
    ]);
  });
});

describe('dates', () => {
  it('does day arithmetic in UTC across month, leap-day and year boundaries', () => {
    expect(addDays('2026-09-26', -14)).toBe('2026-09-12');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2027-01-05', -14)).toBe('2026-12-22');
  });

  it('accepts only real YYYY-MM-DD dates', () => {
    expect(isDay('2026-09-26')).toBe(true);
    expect(isDay('2026-9-26')).toBe(false);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-09-26T00:00:00Z')).toBe(false);
  });
});

describe('snapshot files', () => {
  const s: Snapshot = {
    v: 2, baseline: '2026-09-01', date: '2026-09-02',
    stations: { b: ['B', 'Berlin', 'DE', '2026-09-02', h('b')], a: ['A "x"', 'Wien', 'AT', '2026-09-01', h('a')] },
    gone: { c: ['C', 'Graz', 'AT', '2026-09-01', '2026-09-02', h('c')] },
  };

  it('writes sorted keys and one station per line, so nightly diffs stay small', () => {
    expect(stableJson(s)).toBe([
      '{',
      '  "baseline": "2026-09-01",',
      '  "date": "2026-09-02",',
      '  "gone": {',
      `    "c": ["C","Graz","AT","2026-09-01","2026-09-02","${h('c')}"]`,
      '  },',
      '  "stations": {',
      `    "a": ["A \\"x\\"","Wien","AT","2026-09-01","${h('a')}"],`,
      `    "b": ["B","Berlin","DE","2026-09-02","${h('b')}"]`,
      '  },',
      '  "v": 2',
      '}',
    ].join('\n'));
    expect(JSON.parse(stableJson(s))).toEqual(s);
  });

  it('reads back a v2 snapshot and rejects anything else', () => {
    expect(parseSnapshot(stableJson(s))).toEqual(s);
    expect(() => parseSnapshot('{"v":3,"baseline":"2026-09-01","date":"2026-09-01","stations":{},"gone":{}}')).toThrow(/snapshot/);
    expect(() => parseSnapshot('{"v":2,"baseline":"2026-09-01","date":"2026-09-01","stations":{"a":["A","B","C","2026-09-01"]},"gone":{}}')).toThrow(/snapshot/);
    expect(() => parseSnapshot('{"v":2,"baseline":"2026-09-01","stations":{},"gone":{}}')).toThrow(/snapshot/);
    expect(() => parseSnapshot('{"v":2,"baseline":"2026-09-01","date":"2026-09-01","stations":{}}')).toThrow(/snapshot/);
    expect(() => parseSnapshot('[]')).toThrow(/snapshot/);
    expect(() => parseSnapshot('{"v":1,"baseline":"2026-09-01","stations":{"a":["A","B","C"]}}')).toThrow(/snapshot/);
    expect(() => parseSnapshot('{"v":1,"baseline":"2026-09-01","stations":{},"gone":{"c":["C","Graz","AT","2026-09-01"]}}')).toThrow(/snapshot/);
  });

  it('reads a v1 snapshot (before Task 8c) with an unknown date and unknown stream hashes', () => {
    const v1 = '{"v":1,"baseline":"2026-09-01","stations":{"a":["A","Wien","AT","2026-09-01"]},"gone":{"g":["G","Graz","AT","2026-09-01","2026-09-02"]}}';
    expect(parseSnapshot(v1)).toEqual({
      v: 2, baseline: '2026-09-01', date: '',
      stations: { a: ['A', 'Wien', 'AT', '2026-09-01', ''] },
      gone: { g: ['G', 'Graz', 'AT', '2026-09-01', '2026-09-02', ''] },
    });
  });

  it('marks a v1 snapshot as legacy, to be replaced by a fresh baseline (Ruling 42)', () => {
    expect(isLegacy(parseSnapshot('{"v":1,"baseline":"2026-09-01","stations":{}}'))).toBe(true);
    expect(isLegacy(parseSnapshot(stableJson(s)))).toBe(false);
  });

  it('reads a v1 snapshot written before gone existed as one with nothing gone', () => {
    expect(parseSnapshot('{"v":1,"baseline":"2026-09-01","stations":{"a":["A","Wien","AT","2026-09-01"]}}')).toEqual({
      v: 2, baseline: '2026-09-01', date: '', stations: { a: ['A', 'Wien', 'AT', '2026-09-01', ''] }, gone: {},
    });
  });

  it('carries firstSeen over from a v1 snapshot by uuid and by twin, and diffs against it', () => {
    const old = parseSnapshot('{"v":1,"baseline":"2026-09-01","stations":{"a":["A","Berlin","DE","2026-09-03"],"b":["Radio B","Wien","AT","2026-09-04"]}}');
    const s = snapshotFrom(places, chunks(row(0, 'a'), row(1, 'b2', 'radio b')), '2026-09-26', old);
    expect(s.stations).toEqual({ a: ['A', 'Berlin', 'DE', '2026-09-03', h('a')], b2: ['radio b', 'Wien', 'AT', '2026-09-04', h('b2')] });
    expect(s.gone).toEqual({ b: ['Radio B', 'Wien', 'AT', '2026-09-04', '2026-09-26', ''] });
    const d = diffSnapshots(old, s);
    expect([d.added.length, d.removed.length, d.changed.length]).toEqual([1, 1, 0]);
  });
});
