import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Player, type MediaLike } from '../../src/audio/player';

class FakeMedia extends EventTarget implements MediaLike {
  src = '';
  playCalls = 0;
  rejectWith: string | null = null;
  play() {
    this.playCalls++;
    return this.rejectWith ? Promise.reject(Object.assign(new Error('x'), { name: this.rejectWith })) : Promise.resolve();
  }
  pause() {}
  load() {}
  removeAttribute(n: string) { if (n === 'src') this.src = ''; }
  fire(t: string) { this.dispatchEvent(new Event(t)); }
}

describe('Player', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('goes loading → playing', async () => {
    const m = new FakeMedia(), states: string[] = [];
    const p = new Player(m, s => states.push(s));
    const done = p.play('https://a');
    m.fire('playing');
    expect(await done).toBe('playing');
    expect(states).toEqual(['loading', 'playing']);
  });

  it('times out as error', async () => {
    const m = new FakeMedia();
    const p = new Player(m, () => {}, 12000);
    const done = p.play('https://a');
    vi.advanceTimersByTime(12001);
    expect(await done).toBe('error');
    expect(m.src).toBe('');
  });

  it('reports autoplay rejection', async () => {
    const m = new FakeMedia();
    m.rejectWith = 'NotAllowedError';
    const why: string[] = [];
    const p = new Player(m, (s, w) => { if (w) why.push(w); });
    expect(await p.play('https://a')).toBe('error');
    expect(why).toContain('NotAllowedError');
  });

  it('ignores events from a superseded station', async () => {
    const m = new FakeMedia();
    const p = new Player(m, () => {});
    const first = p.play('https://a');
    const second = p.play('https://b');
    m.fire('playing');
    expect(await second).toBe('playing');
    expect(await first).toBe('idle');
  });

  it('does not double-report when release() aborts the pending play()', async () => {
    class AbortingMedia extends EventTarget implements MediaLike {
      src = '';
      private rejectPlay: ((e: Error) => void) | null = null;
      play() {
        return new Promise<void>((_resolve, reject) => { this.rejectPlay = reject; });
      }
      pause() {}
      load() {
        // Real media elements reject the in-flight play() promise once
        // load() (or clearing src) aborts it — release() triggers this.
        this.rejectPlay?.(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        this.rejectPlay = null;
      }
      removeAttribute(n: string) { if (n === 'src') this.src = ''; }
      fire(t: string) { this.dispatchEvent(new Event(t)); }
    }
    const m = new AbortingMedia();
    const whys: (string | undefined)[] = [];
    const p = new Player(m, (s, w) => { if (s === 'error') whys.push(w); }, 12000);
    const done = p.play('https://a');
    vi.advanceTimersByTime(12001);
    expect(await done).toBe('error');
    expect(whys).toEqual(['timeout']);
  });
});
