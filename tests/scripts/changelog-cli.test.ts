import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ChunkRow } from '../../scripts/lib/emit';

// The CLI as the pages workflow runs it: each run reads the previous run's snapshot.json and day-base.json.
const dir = mkdtempSync(join(tmpdir(), 'skywave-changelog-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(name: string, date: string, rows: ChunkRow[], prev?: string) {
  const data = join(dir, name, 'data');
  const log = join(dir, name, 'log');
  mkdirSync(join(data, 'st'), { recursive: true });
  writeFileSync(join(data, 'places.json'), JSON.stringify({
    v: 'v', lat: [51.3, 50.9], lon: [12.4, 12.1], count: [0, 0], name: ['Leipzig', 'Gera'], cc: ['DE', 'DE'], tzi: [0, 0], tzs: [''],
  }));
  writeFileSync(join(data, 'st', 'DE.json'), JSON.stringify({ v: 'v', rows }));
  const args = ['--data', data, '--log', log, '--date', date];
  if (prev) args.push('--prev', join(dir, prev, 'log', 'snapshot.json'), '--day-base', join(dir, prev, 'log', 'day-base.json'));
  const out = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/changelog.ts', ...args], { encoding: 'utf8', stdio: 'pipe' });
  const read = (f: string) => (existsSync(join(log, f)) ? readFileSync(join(log, f), 'utf8') : null);
  const fresh = JSON.parse(readFileSync(join(data, 'new.json'), 'utf8')) as { stations: { id: string }[] };
  return { out, read, latest: JSON.parse(read('changes/latest.json')!), fresh: fresh.stations.map(s => s.id) };
}

const r = (id: string, name: string, place = 0, url = `https://s/${id}`): ChunkRow => [place, id, name, url, 'MP3', 128, ''];

describe('changelog CLI', () => {
  it('writes a cumulative day file against the last snapshot of the previous day', () => {
    const night = run('n1', '2026-09-25', [r('a', 'Studentenradio', 0), r('b', 'Radio B'), r('c', 'Radio C')]);
    expect(night.latest).toMatchObject({ baseline: true });
    expect(night.read('day-base.json')).toBeNull();

    // Morning: the Studentenradio stream is listed under another uuid at Gera, and Radio C fails its check.
    const morning = run('n2', '2026-09-26', [r('a2', 'Studentenradio', 1, 'https://s/a'), r('b', 'Radio B'), r('n', 'New')], 'n1');
    expect(morning.read('day-base.json')).toBe(night.read('snapshot.json'));
    expect(morning.latest).toMatchObject({ date: '2026-09-26', added: 1, removed: 1, changed: 1, baseline: false });
    expect(morning.read('changes/2026-09-26.md')).toContain('- Studentenradio — Leipzig → Gera (DE)');

    // Noon, same day: Radio C is back. The day file still compares with the night before, so C is no change.
    const noon = run('n3', '2026-09-26', [r('a2', 'Studentenradio', 1, 'https://s/a'), r('b', 'Radio B'), r('c', 'Radio C'), r('n', 'New')], 'n2');
    expect(noon.read('day-base.json')).toBe(night.read('snapshot.json'));
    expect(noon.latest).toMatchObject({ added: 1, removed: 0, changed: 1 });
    expect(noon.read('changes/2026-09-26.md')).toContain('4 stations: 1 added, 0 removed, 1 changed.');

    // Next day: the last snapshot of the 26th becomes the day base; nothing changed since, so no day file.
    const next = run('n4', '2026-09-27', [r('a2', 'Studentenradio', 1, 'https://s/a'), r('b', 'Radio B'), r('c', 'Radio C'), r('n', 'New')], 'n3');
    expect(next.read('day-base.json')).toBe(noon.read('snapshot.json'));
    expect(next.latest).toMatchObject({ date: '2026-09-27', added: 0, removed: 0, changed: 0 });
    expect(next.read('changes/2026-09-27.md')).toBeNull();
    expect(JSON.parse(next.read('snapshot.json')!).date).toBe('2026-09-27');
  }, 30_000);

  it('replaces a snapshot written before Task 8c with a fresh baseline (Ruling 42)', () => {
    const old = join(dir, 'old', 'log');
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, 'snapshot.json'), `${JSON.stringify({
      v: 1, baseline: '2026-09-25',
      stations: { a: ['Studentenradio', 'Leipzig', 'DE', '2026-09-25'], x: ['Radio X', 'Leipzig', 'DE', '2026-09-26'] },
      gone: { g: ['Radio G', 'Gera', 'DE', '2026-09-25', '2026-09-26'] },
    })}\n`);
    const upgrade = run('m1', '2026-09-26', [r('a', 'Studentenradio', 0), r('x', 'Radio X'), r('g', 'Radio G', 1), r('b', 'Radio B')], 'old');
    const snap = JSON.parse(upgrade.read('snapshot.json')!);
    expect(snap).toMatchObject({ v: 2, baseline: '2026-09-26', date: '2026-09-26', gone: {} });
    expect(Object.keys(snap.stations).sort()).toEqual(['a', 'b', 'g', 'x']);
    expect(Object.values(snap.stations as Record<string, string[]>).map(e => e[3])).toEqual(Array(4).fill('2026-09-26'));
    expect(upgrade.read('day-base.json')).toBe(upgrade.read('snapshot.json'));
    expect(upgrade.fresh).toEqual([]);
    expect(upgrade.latest).toMatchObject({ date: '2026-09-26', total: 4, added: 0, removed: 0, changed: 0, baseline: true });
    expect(upgrade.read('changes/2026-09-26.md')).toBe(
      '# Station changes 2026-09-26\n\nBaseline (format upgrade): 4 stations. Changes are reported from the next run on.\n');
    expect(upgrade.out).toContain('changelog 2026-09-26: baseline (format upgrade), 4 stations');

    // Later the same day the fresh baseline is the day base. A station added then belongs to the baseline day,
    // so new.json does not list it; from the next day on new stations are listed again.
    const noon = run('m2', '2026-09-26', [r('a', 'Studentenradio', 0), r('x', 'Radio X'), r('g', 'Radio G', 1), r('b', 'Radio B'), r('n', 'New')], 'm1');
    expect(noon.read('day-base.json')).toBe(upgrade.read('snapshot.json'));
    expect(noon.latest).toMatchObject({ added: 1, removed: 0, changed: 0, baseline: false });
    expect(noon.fresh).toEqual([]);
    const next = run('m3', '2026-09-27', [r('a', 'Studentenradio', 0), r('x', 'Radio X'), r('b', 'Radio B'), r('n', 'New'), r('m', 'Newer')], 'm2');
    expect(next.read('day-base.json')).toBe(noon.read('snapshot.json'));
    expect(next.latest).toMatchObject({ added: 1, removed: 1, changed: 0, baseline: false });
    expect(next.fresh).toEqual(['m']);
    expect(JSON.parse(next.read('snapshot.json')!).baseline).toBe('2026-09-26');
  }, 30_000);
});
