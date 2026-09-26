import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseSnapshot } from '../../scripts/lib/changelog';
import { preferredIds, readPrefer, stationPlaces } from '../../scripts/lib/pipeline';
import type { RBStation } from '../../scripts/lib/radiobrowser';

// build-data.ts: PREV_SNAPSHOT names the previous run's snapshot.json. Its stations and its gone ids are
// preferred by every step that picks one station over another (Rulings 39 and 42).
const dir = mkdtempSync(join(tmpdir(), 'skywave-prefer-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

const v2 = JSON.stringify({
  v: 2, baseline: '2026-09-25', date: '2026-09-26',
  stations: {
    twin: ['Radio Twin', 'Leipzig', 'DE', '2026-09-25', 'aaaaaaaaaaaa'],
    ch10: ['Big 10', 'Leipzig', 'DE', '2026-09-25', 'bbbbbbbbbbbb'],
  },
  gone: {
    back: ['Radio Back', 'Leipzig', 'DE', '2026-09-25', '2026-09-26', 'cccccccccccc'],
    west: ['Radio West', 'Leipzig', 'DE', '2026-09-25', '2026-09-26', 'dddddddddddd'],
  },
});

const rb = (id: string, url: string, votes: number, lon = 12.37): RBStation => ({
  stationuuid: id, name: `Radio ${id}`, url_resolved: url, countrycode: 'DE', state: '', geo_lat: 51.34, geo_long: lon,
  codec: 'MP3', bitrate: 128, hls: 0, lastcheckok: 1, ssl_error: 0, clickcount: 0, votes, tags: '',
});

/**
 * Leipzig: two streams listed twice each (the known listing has fewer votes), a broadcaster with 11 channels
 * (the known channel ch10 has the fewest votes) and, 2 km west, the known station with the most votes among
 * the known ones but fewer than the unknown listings.
 */
const rows: RBStation[] = [
  rb('twin', 'https://a.example.org/live', 0), rb('rival', 'https://a.example.org/live', 50),
  rb('back', 'https://c.example.org/live', 0), rb('comet', 'https://c.example.org/live', 50),
  ...Array.from({ length: 11 }, (_, k) => rb(`ch${k}`, `https://ch${k}.big.example.de/live`, k < 10 ? 40 - k : 2)),
  rb('west', 'https://w.example.org/live', 3, 12.34),
];
const opts = { allowHttp: false, allowHls: true };

describe('preferredIds', () => {
  it('prefers the stations of the previous snapshot and the ones it recently lost', () => {
    expect([...preferredIds(parseSnapshot(v2))].sort()).toEqual(['back', 'ch10', 'twin', 'west']);
  });
});

describe('readPrefer (PREV_SNAPSHOT)', () => {
  it('reads the station and gone ids of a v2 snapshot', () => {
    expect([...readPrefer(file('v2.json', v2))].sort()).toEqual(['back', 'ch10', 'twin', 'west']);
  });

  it('reads only the station ids of a v1 snapshot: its gone list is the click churn the rebaseline forgets', () => {
    const v1 = '{"v":1,"baseline":"2026-09-25","stations":{"a":["A","Leipzig","DE","2026-09-25"]},'
      + '"gone":{"g":["G","Gera","DE","2026-09-25","2026-09-26"]}}';
    expect([...readPrefer(file('v1.json', v1))]).toEqual(['a']);
  });

  it('prefers nothing, silently, when no snapshot is named or the file is missing (the first run)', () => {
    const warnings: string[] = [];
    expect(readPrefer(undefined, w => warnings.push(w)).size).toBe(0);
    expect(readPrefer(join(dir, 'missing.json'), w => warnings.push(w)).size).toBe(0);
    expect(warnings).toEqual([]);
  });

  it('prefers nothing and warns when the snapshot is unreadable', () => {
    const warnings: string[] = [];
    const path = file('broken.json', '{"v":2,');
    expect(readPrefer(path, w => warnings.push(w)).size).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^::warning::previous snapshot .*broken\.json unreadable/);
  });
});

describe('stationPlaces', () => {
  it('keeps the known listings, channels and anchor that PREV_SNAPSHOT names, against more votes', () => {
    const { stations, places } = stationPlaces(rows, { ...opts, prefer: readPrefer(file('prev.json', v2)) });
    const ids = stations.map(s => s.id);
    expect(ids).toContain('twin');
    expect(ids).toContain('back');
    expect(ids).not.toContain('rival');
    expect(ids).not.toContain('comet');
    expect(places).toHaveLength(1);
    const kept = places[0].stations.map(s => s.id);
    expect(kept.filter(id => id.startsWith('ch')).sort()).toEqual(['ch0', 'ch1', 'ch10', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7', 'ch8']);
    expect(places[0].lon).toBe(12.34);
  });

  it('keeps the most voted listings, channels and anchor without a previous snapshot', () => {
    const { stations, places } = stationPlaces(rows, { ...opts, prefer: readPrefer(join(dir, 'missing.json')) });
    const ids = stations.map(s => s.id);
    expect(ids).toContain('rival');
    expect(ids).toContain('comet');
    expect(ids).not.toContain('twin');
    expect(places[0].stations.map(s => s.id)).not.toContain('ch10');
    expect(places[0].lon).toBe(12.37);
  });
});
