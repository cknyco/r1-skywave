import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tuner } from '../../src/audio/tuner';
import type { StationRow } from '../../src/data/store';

const row = (place: number, id: string): StationRow => ({ place, id, name: id, url: `https://s/${id}`, codec: 'MP3', bitrate: 128, tags: [] });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function deps(results: Record<string, 'playing' | 'error'> = {}) {
  const played: string[] = [], reported: string[] = [];
  const player = {
    state: 'idle',
    play: vi.fn(async (url: string) => { played.push(url); return results[url] ?? 'playing'; }),
    stop: vi.fn(),
  };
  const stations = async (p: number) => [row(p, `${p}a`), row(p, `${p}b`), row(p, `${p}c`)];
  return { player, stations, report: (id: string) => reported.push(id), played, reported };
}

describe('Tuner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('only the last selected place is tuned', async () => {
    const d = deps();
    const t = new Tuner(d as never, 700);
    for (let p = 0; p < 20; p++) { t.select(p); vi.advanceTimersByTime(100); }
    await vi.advanceTimersByTimeAsync(700);
    await flush();
    expect(d.played).toEqual(['https://s/19a']);
    expect(d.reported).toEqual(['19a']);
  });

  it('skips a station that times out', async () => {
    const d = deps({ 'https://s/3a': 'error' });
    const t = new Tuner(d as never, 0);
    t.select(3);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(d.played).toEqual(['https://s/3a', 'https://s/3b']);
    expect(t.station?.id).toBe('3b');
  });

  it('gives up after three failures in a place', async () => {
    const d = deps({ 'https://s/4a': 'error', 'https://s/4b': 'error', 'https://s/4c': 'error' });
    const t = new Tuner(d as never, 0);
    t.select(4);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(d.played).toHaveLength(3);
    expect(t.station).toBeNull();
  });

  it('resumes the same station after a stop', async () => {
    const d = deps();
    const t = new Tuner(d as never, 0);
    t.select(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    await t.next();
    d.player.state = 'playing';
    await t.toggle();
    d.player.state = 'idle';
    await t.toggle();
    expect(d.played[d.played.length - 1]).toBe('https://s/1b');
  });

  it('next() moves to the next station of the same place', async () => {
    const d = deps();
    const t = new Tuner(d as never, 0);
    t.select(1);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    await t.next();
    expect(t.station?.id).toBe('1b');
  });

  it('reports a failure instead of leaving stale state when stations() rejects', async () => {
    const played: string[] = [];
    const player = { state: 'idle', play: vi.fn(async (url: string) => { played.push(url); return 'playing' as const; }), stop: vi.fn() };
    const stations = vi.fn(async () => { throw new TypeError('offline'); });
    const failures: string[] = [];
    const t = new Tuner({ player, stations, report: () => {}, fail: (why: string) => failures.push(why) } as never, 0);
    t.select(2);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(failures).toEqual(['offline']);
    expect(t.station).toBeNull();
    expect(played).toEqual([]);
  });
});
