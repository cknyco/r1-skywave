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

  describe('cancel', () => {
    it('drops a pending settle before it ever fetches or plays', async () => {
      const d = deps();
      const t = new Tuner(d as never, 700);
      t.select(5);
      t.cancel();
      await vi.advanceTimersByTimeAsync(700);
      await flush();
      expect(d.played).toEqual([]);
      expect(t.station).toBeNull();
    });

    it('stops live playback without forgetting the current station', async () => {
      const d = deps();
      const t = new Tuner(d as never, 0);
      t.select(6);
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      d.player.state = 'playing';
      t.cancel();
      expect(d.player.stop).toHaveBeenCalledTimes(1);
      expect(t.station?.id).toBe('6a');
    });

    it('does nothing when idle (no timer, no playback)', () => {
      const d = deps();
      const t = new Tuner(d as never, 700);
      expect(() => t.cancel()).not.toThrow();
      expect(d.player.stop).not.toHaveBeenCalled();
    });

    it('invalidates an in-flight tune, so a late resolve cannot land after cancel()', async () => {
      let resolvePlay: (r: 'playing' | 'error') => void = () => {};
      const played: string[] = [];
      const player = {
        state: 'idle' as const,
        play: vi.fn((url: string) => { played.push(url); return new Promise<'playing' | 'error'>(r => { resolvePlay = r; }); }),
        stop: vi.fn(),
      };
      const stations = async (p: number) => [row(p, `${p}a`)];
      const t = new Tuner({ player, stations, report: () => {} } as never, 0);
      t.select(7);
      await vi.advanceTimersByTimeAsync(1);
      await flush();                  // stations() has resolved; play() is now pending
      expect(played).toEqual(['https://s/7a']);
      t.cancel();
      resolvePlay('playing');         // the aborted attempt still settles, late
      await flush();
      expect(t.station).toBeNull();   // ...but it never lands
    });
  });

  describe('resume', () => {
    it('plays the saved station by id immediately, no settle wait', async () => {
      const d = deps();
      const t = new Tuner(d as never, 700);
      await t.resume(7, '7b');
      await flush();
      expect(d.played).toEqual(['https://s/7b']);
      expect(t.station?.id).toBe('7b');
      expect(d.reported).toEqual(['7b']);
    });

    it('falls back to the top station when the saved id is gone', async () => {
      const d = deps();
      const t = new Tuner(d as never, 700);
      await t.resume(8, 'not-there-anymore');
      await flush();
      expect(d.played).toEqual(['https://s/8a']);
      expect(t.station?.id).toBe('8a');
    });

    it('plays the top station when no id is given', async () => {
      const d = deps();
      const t = new Tuner(d as never, 700);
      await t.resume(9);
      await flush();
      expect(t.station?.id).toBe('9a');
    });

    it('reports a failure like select() does when stations() rejects', async () => {
      const player = { state: 'idle', play: vi.fn(async () => 'playing' as const), stop: vi.fn() };
      const stations = vi.fn(async () => { throw new TypeError('offline'); });
      const failures: string[] = [];
      const t = new Tuner({ player, stations, report: () => {}, fail: (why: string) => failures.push(why) } as never, 0);
      await t.resume(2, 'x');
      expect(failures).toEqual(['offline']);
      expect(t.station).toBeNull();
      expect(player.play).not.toHaveBeenCalled();
    });

    it('cancels a pending settle from select() first', async () => {
      const d = deps();
      const t = new Tuner(d as never, 700);
      t.select(10);
      await t.resume(11, '11b');
      await vi.advanceTimersByTimeAsync(700);
      await flush();
      expect(d.played).toEqual(['https://s/11b']);   // the settle for place 10 never fires
    });

    it('plays a station picked from the new-stations list, not the first one the select() settle would', async () => {
      const d = deps();
      const t = new Tuner(d as never, 700);
      t.select(2);                 // what MapView.select → onPick does first
      await t.resume(2, '2c');
      await vi.advanceTimersByTimeAsync(700);
      await flush();
      expect(d.played).toEqual(['https://s/2c']);
      expect(t.station?.id).toBe('2c');
      await t.next();
      expect(t.station?.id).toBe('2a');
    });

    it('tries the requested station again even after it failed earlier this session', async () => {
      const d = deps({ 'https://s/3a': 'error' });
      const t = new Tuner(d as never, 0);
      t.select(3);
      await vi.advanceTimersByTimeAsync(1);
      await flush();               // 3a failed and is remembered as bad; 3b plays
      d.played.length = 0;
      await t.resume(3, '3a');
      expect(d.played).toEqual(['https://s/3a', 'https://s/3b']);   // asked for 3a: tried first, then the place order
      expect(t.station?.id).toBe('3b');
    });
  });
});
