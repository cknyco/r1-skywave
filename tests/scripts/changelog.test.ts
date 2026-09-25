import { describe, expect, it } from 'vitest';
import {
  addDays, diffSnapshots, escapeMd, isDay, latestJson, newStations, parseSnapshot, renderMarkdown, snapshotFrom,
  stableJson, type Snapshot,
} from '../../scripts/lib/changelog';
import type { ChunkJson, ChunkRow, PlacesJson } from '../../scripts/lib/emit';

const places: PlacesJson = {
  v: 'v', lat: [52.5, 48.2, 47.1], lon: [13.4, 16.4, 15.4], count: [3, 1, 2],
  name: ['Berlin', 'Wien', 'Graz'], cc: ['DE', 'AT', 'AT'], tzi: [0, 1, 1], tzs: ['Europe/Berlin', 'Europe/Vienna'],
};
const row = (place: number, id: string, name = id.toUpperCase()): ChunkRow => [place, id, name, `https://x/${id}`, 'MP3', 128, ''];
const chunks = (...rows: ChunkRow[]): Map<string, ChunkJson> => {
  const m = new Map<string, ChunkJson>();
  for (const r of rows) {
    const cc = places.cc[r[0]];
    m.set(cc, { v: 'v', rows: [...(m.get(cc)?.rows ?? []), r] });
  }
  return m;
};

describe('snapshotFrom', () => {
  it('records every current station with place name, country and first-seen date', () => {
    const s = snapshotFrom(places, chunks(row(0, 'a'), row(0, 'b'), row(1, 'c')), '2026-09-26', null);
    expect(s).toEqual({
      v: 1,
      baseline: '2026-09-26',
      stations: {
        a: ['A', 'Berlin', 'DE', '2026-09-26'],
        b: ['B', 'Berlin', 'DE', '2026-09-26'],
        c: ['C', 'Wien', 'AT', '2026-09-26'],
      },
      gone: {},
    });
  });

  it('carries firstSeen and the baseline over, refreshes names, moves stations that disappeared to gone', () => {
    const prev: Snapshot = {
      v: 1, baseline: '2026-09-01',
      stations: { a: ['Old name', 'Berlin', 'DE', '2026-09-01'], x: ['X', 'Wien', 'AT', '2026-09-03'] },
      gone: {},
    };
    const s = snapshotFrom(places, [...chunks(row(0, 'a'), row(2, 'd')).values()], '2026-09-26', prev);
    expect(s.baseline).toBe('2026-09-01');
    expect(s.stations).toEqual({ a: ['A', 'Berlin', 'DE', '2026-09-01'], d: ['D', 'Graz', 'AT', '2026-09-26'] });
    expect(s.gone).toEqual({ x: ['X', 'Wien', 'AT', '2026-09-03', '2026-09-26'] });
  });

  it('gives a station that returns its first-seen date back, so it is not new again', () => {
    const night1 = snapshotFrom(places, chunks(row(0, 'a'), row(1, 'b')), '2026-09-01', null);
    const night2 = snapshotFrom(places, chunks(row(0, 'a')), '2026-09-20', night1);
    expect(night2.gone).toEqual({ b: ['B', 'Wien', 'AT', '2026-09-01', '2026-09-20'] });
    const night3 = snapshotFrom(places, chunks(row(0, 'a'), row(1, 'b')), '2026-09-21', night2);
    expect(night3.stations.b).toEqual(['B', 'Wien', 'AT', '2026-09-01']);
    expect(night3.gone).toEqual({});
    expect(diffSnapshots(night2, night3).added.map(e => e.id)).toEqual(['b']); // the log still reports it
    expect(newStations(night3, '2026-09-21', places, chunks(row(0, 'a'), row(1, 'b'))).stations).toEqual([]);
  });

  it('treats a new id with the same name at the same place as the station it duplicates', () => {
    const prev: Snapshot = {
      v: 1, baseline: '2026-09-01',
      stations: { c: ['Radio  C', 'Wien', 'AT', '2026-09-20'] },
      gone: { a: ['Radio A', 'Berlin', 'DE', '2026-09-01', '2026-09-25'] },
    };
    // a2 replaces a (gone), c2 joins c (still there): both keep the older date; case and spacing do not matter.
    const now = chunks(row(0, 'a2', ' radio a'), row(1, 'c', 'Radio C'), row(1, 'c2', 'RADIO C'), row(2, 'a3', 'Radio A'), row(0, 'n', 'New'));
    const s = snapshotFrom(places, now, '2026-09-26', prev);
    expect(s.stations).toEqual({
      a2: [' radio a', 'Berlin', 'DE', '2026-09-01'],
      c: ['Radio C', 'Wien', 'AT', '2026-09-20'],
      c2: ['RADIO C', 'Wien', 'AT', '2026-09-20'],
      a3: ['Radio A', 'Graz', 'AT', '2026-09-26'], // same name, other place: a different station
      n: ['New', 'Berlin', 'DE', '2026-09-26'],
    });
    expect(diffSnapshots(prev, s).added.map(e => e.id)).toEqual(['c2', 'a3', 'a2', 'n']);
    // new.json lists each station once, even when two ids share its name and place.
    expect(newStations(s, '2026-09-26', places, now).stations.map(n => n.id)).toEqual(['n', 'a3', 'c2']);
  });

  it('forgets gone stations 90 days after they went missing', () => {
    const prev: Snapshot = {
      v: 1, baseline: '2026-01-01', stations: {},
      gone: { kept: ['K', 'Wien', 'AT', '2026-01-01', '2026-06-28'], old: ['O', 'Wien', 'AT', '2026-01-01', '2026-06-27'] },
    };
    const s = snapshotFrom(places, chunks(row(1, 'n', 'O')), '2026-09-26', prev); // 2026-06-28 is exactly 90 days back
    expect(Object.keys(s.gone)).toEqual(['kept']);
    expect(s.stations.n).toEqual(['O', 'Wien', 'AT', '2026-09-26']); // no twin left to inherit from
  });

  it('keeps an id that collides with Object.prototype as plain data', () => {
    const s = snapshotFrom(places, chunks(row(0, '__proto__', 'Odd')), '2026-09-26', null);
    expect(Object.keys(s.stations)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(s.stations)).toBe(Object.prototype);
    expect(JSON.parse(stableJson(s)).stations.__proto__).toEqual(['Odd', 'Berlin', 'DE', '2026-09-26']);
  });
});

describe('diffSnapshots', () => {
  const prev: Snapshot = {
    v: 1, baseline: '2026-09-01',
    stations: { a: ['A', 'Berlin', 'DE', '2026-09-01'], b: ['B', 'Berlin', 'DE', '2026-09-01'], c: ['C', 'Wien', 'AT', '2026-09-01'] },
    gone: {},
  };
  const next = snapshotFrom(places, chunks(row(0, 'a'), row(0, 'f'), row(1, 'c'), row(2, 'e', 'E | FM'), row(2, 'd')), '2026-09-26', prev);

  it('reports a first run as the baseline, with no changes', () => {
    expect(diffSnapshots(null, next)).toEqual({ added: [], removed: [], byCountry: {}, total: 5, baseline: true });
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
    expect(d.byCountry).toEqual({ AT: { added: 2, removed: 0 }, DE: { added: 1, removed: 1 } });
  });

  it('renders the change log and the latest.json summary', () => {
    const d = diffSnapshots(prev, next);
    expect(renderMarkdown(d, '2026-09-26', 5)).toBe([
      '# Station changes 2026-09-26',
      '',
      '5 stations: 3 added, 1 removed.',
      '',
      '| Country | Added | Removed |',
      '|:--|--:|--:|',
      '| AT | 2 | 0 |',
      '| DE | 1 | 1 |',
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
      v: 1, date: '2026-09-26', total: 5, added: 3, removed: 1, baseline: false,
      byCountry: { AT: { added: 2, removed: 0 }, DE: { added: 1, removed: 1 } },
    });
  });
});

describe('renderMarkdown', () => {
  it('says so on the baseline night', () => {
    const md = renderMarkdown({ added: [], removed: [], byCountry: {}, total: 7906, baseline: true }, '2026-09-26', 7906);
    expect(md).toBe('# Station changes 2026-09-26\n\nBaseline: 7906 stations. Changes are reported from the next run on.\n');
  });

  it('sorts countries by the size of their change, then by code', () => {
    const e = (id: string, cc: string) => ({ id, name: id, place: 'P', cc });
    const md = renderMarkdown({
      added: [e('1', 'FR'), e('2', 'US'), e('3', 'US')], removed: [e('4', 'BR'), e('5', 'US')],
      byCountry: { BR: { added: 0, removed: 1 }, FR: { added: 1, removed: 0 }, US: { added: 2, removed: 1 } },
      total: 10, baseline: false,
    }, '2026-09-26', 10);
    expect(md).toContain('| US | 2 | 1 |\n| BR | 0 | 1 |\n| FR | 1 | 0 |\n');
  });

  it('caps each list at 200 lines', () => {
    const added = Array.from({ length: 250 }, (_, i) => ({ id: `${i}`, name: `S${i}`, place: 'P', cc: 'DE' }));
    const md = renderMarkdown({ added, removed: [], byCountry: { DE: { added: 250, removed: 0 } }, total: 250, baseline: false }, '2026-09-26', 250);
    expect(md.split('\n').filter(l => l.startsWith('- '))).toHaveLength(200);
    expect(md).toContain('\n\n…and 50 more\n');
    expect(md).not.toContain('## Removed');
  });

  it('escapes untrusted names so they cannot inject Markdown or HTML', () => {
    const md = renderMarkdown({
      added: [{ id: 'x', name: '<img src=x onerror=alert(1)> [click](https://e)\n# Owned', place: 'A_B*C', cc: 'D|E' }],
      removed: [], byCountry: { 'D|E': { added: 1, removed: 0 } }, total: 1, baseline: false,
    }, '2026-09-26', 1);
    expect(md).toContain('- \\<img src=x onerror=alert(1)\\> \\[click\\](https://e) \\# Owned — A\\_B\\*C (D\\|E)\n');
    expect(md).toContain('| D\\|E | 1 | 0 |');
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
    v: 1, baseline: '2026-09-01',
    stations: {
      a: ['A', 'Berlin', 'DE', '2026-09-01'], // baseline night: never "new", even inside the window
      b: ['B', 'Berlin', 'DE', '2026-09-12'], // exactly 14 days before 2026-09-26: in
      c: ['C', 'Wien', 'AT', '2026-09-11'], //   15 days: out
      d: ['Zeta', 'Graz', 'AT', '2026-09-26'],
      e: ['Alpha', 'Graz', 'AT', '2026-09-26'],
      f: ['F', 'Wien', 'AT', '2026-09-20'],
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
    v: 1, baseline: '2026-09-01',
    stations: { b: ['B', 'Berlin', 'DE', '2026-09-02'], a: ['A "x"', 'Wien', 'AT', '2026-09-01'] },
    gone: { c: ['C', 'Graz', 'AT', '2026-09-01', '2026-09-02'] },
  };

  it('writes sorted keys and one station per line, so nightly diffs stay small', () => {
    expect(stableJson(s)).toBe([
      '{',
      '  "baseline": "2026-09-01",',
      '  "gone": {',
      '    "c": ["C","Graz","AT","2026-09-01","2026-09-02"]',
      '  },',
      '  "stations": {',
      '    "a": ["A \\"x\\"","Wien","AT","2026-09-01"],',
      '    "b": ["B","Berlin","DE","2026-09-02"]',
      '  },',
      '  "v": 1',
      '}',
    ].join('\n'));
    expect(JSON.parse(stableJson(s))).toEqual(s);
  });

  it('reads back a v1 snapshot and rejects anything else', () => {
    expect(parseSnapshot(stableJson(s))).toEqual(s);
    expect(() => parseSnapshot('{"v":2,"baseline":"2026-09-01","stations":{}}')).toThrow(/snapshot/);
    expect(() => parseSnapshot('{"v":1,"baseline":"2026-09-01","stations":{"a":["A","B","C"]}}')).toThrow(/snapshot/);
    expect(() => parseSnapshot('[]')).toThrow(/snapshot/);
    expect(() => parseSnapshot('{"v":1,"baseline":"2026-09-01","stations":{},"gone":{"c":["C","Graz","AT","2026-09-01"]}}')).toThrow(/snapshot/);
  });

  it('reads a snapshot written before gone existed as one with nothing gone', () => {
    expect(parseSnapshot('{"v":1,"baseline":"2026-09-01","stations":{"a":["A","Wien","AT","2026-09-01"]}}')).toEqual({
      v: 1, baseline: '2026-09-01', stations: { a: ['A', 'Wien', 'AT', '2026-09-01'] }, gone: {},
    });
  });
});
