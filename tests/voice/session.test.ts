import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoiceSession, type VoiceSessionDeps } from '../../src/voice/session';

// `stop()` flips the mock's own "on" flag, so a later isPlaying() read genuinely reflects that the
// player was silenced — needed to exercise I4's carry-over fix, where a retry's isPlaying() would
// otherwise (wrongly) read false just because the first session already called stop().
function deps(playing: boolean) {
  let on = playing;
  const stop = vi.fn(() => { on = false; });
  const resume = vi.fn(() => { on = true; });
  const onSettle = vi.fn();
  const d: VoiceSessionDeps = { isPlaying: () => on, stop, resume, onSettle };
  return { d, stop, resume, onSettle };
}

/** One full search up to the LLM request: hold, sttEnded (own), askLLM, release. */
function ask(s: ReturnType<typeof createVoiceSession>) {
  s.start();
  s.release();
  expect(s.transcript()).toBe(true);
  s.asked();
}

describe('voice session', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stops playback as soon as it starts', () => {
    const { d, stop } = deps(true);
    createVoiceSession(d).start();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('was playing, no match found: resumes exactly once', () => {
    const { d, resume } = deps(true);
    const s = createVoiceSession(d);
    s.start();
    s.release();
    expect(s.resolved(false)).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(s.resolved(false)).toBe(false);   // already settled: a second call resumes nothing more
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('was stopped, no match found: never resumes', () => {
    const { d, resume } = deps(false);
    const s = createVoiceSession(d);
    s.start();
    s.release();
    expect(s.resolved(false)).toBe(true);
    expect(resume).not.toHaveBeenCalled();
  });

  it('a found place jumps and never resumes, even if audio had been playing', () => {
    const { d, resume } = deps(true);
    const jump = vi.fn();
    const s = createVoiceSession(d);
    s.start();
    s.release();
    expect(s.resolved(true, jump)).toBe(true);
    expect(jump).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
  });

  it('holding past 10s never resumes while the mic is still open (I3)', async () => {
    const { d, resume } = deps(true);
    const s = createVoiceSession(d);
    s.start();
    await vi.advanceTimersByTimeAsync(15000);
    expect(resume).not.toHaveBeenCalled();
    expect(s.isLive()).toBe(true);
  });

  it('release() arms the 10s clock: no reply by then resumes what had been playing', async () => {
    const { d, resume } = deps(true);
    const s = createVoiceSession(d);
    s.start();
    s.release();
    await vi.advanceTimersByTimeAsync(9999);
    expect(resume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('asked() after release restarts the clock: a fresh 10s for the reply', async () => {
    const { d, resume } = deps(true);
    const s = createVoiceSession(d);
    s.start();
    s.release();                                // fallback armed
    await vi.advanceTimersByTimeAsync(6000);
    expect(s.transcript()).toBe(true);
    s.asked();                                  // restart the countdown
    await vi.advanceTimersByTimeAsync(6000);    // 12s since release, only 6s since the ask
    expect(resume).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(4000);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('voice unavailable resumes immediately, without waiting for the timeout', () => {
    const { d, resume } = deps(true);
    const s = createVoiceSession(d);
    s.start();
    expect(s.end()).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('voice unavailable while nothing was playing stays stopped', () => {
    const { d, resume } = deps(false);
    const s = createVoiceSession(d);
    s.start();
    expect(s.end()).toBe(true);
    expect(resume).not.toHaveBeenCalled();
  });

  it('voice unavailable leaves no sttEnded owed: the next session takes the next one as its own', () => {
    const { d } = deps(true);
    const s = createVoiceSession(d);
    s.start();
    s.end();
    s.start();
    s.release();
    expect(s.transcript()).toBe(true);
  });

  it('onSettle runs once whenever the session ends, resumed or not', () => {
    const { d, onSettle } = deps(false);
    const s = createVoiceSession(d);
    s.start();
    s.release();
    expect(s.resolved(false)).toBe(true);
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(s.resolved(true)).toBe(false);   // already ended: no second onSettle
    expect(onSettle).toHaveBeenCalledTimes(1);
  });

  it('a second start() abandons an unresolved session without resuming it', () => {
    const { d, resume, stop } = deps(true);
    const s = createVoiceSession(d);
    s.start();
    s.start();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(resume).not.toHaveBeenCalled();
  });

  it('a retry hold (start, start) still carries "was playing" through to its own resolve (I4)', () => {
    const { d, resume } = deps(true);
    const s = createVoiceSession(d);
    s.start();
    s.start();   // isPlaying() would read false here — the first start()'s stop() already fired
    s.release();
    expect(s.resolved(false)).toBe(true);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('abandon() ends a live session without resuming, and cancels an armed clock (I2)', async () => {
    const { d, resume, onSettle } = deps(true);
    const s = createVoiceSession(d);
    s.start();
    s.release();
    s.abandon();
    expect(onSettle).toHaveBeenCalledTimes(1);
    expect(s.resolved(false)).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(resume).not.toHaveBeenCalled();
  });

  it('abandon() with no session live is a harmless no-op', () => {
    const { d, resume, onSettle } = deps(true);
    const s = createVoiceSession(d);
    s.abandon();
    expect(resume).not.toHaveBeenCalled();
    expect(onSettle).not.toHaveBeenCalled();
  });

  describe('N1: nothing happens while the mic is open', () => {
    it('a no-match outcome mid-hold is held back: no resume until release, then exactly one', () => {
      const { d, resume } = deps(true);
      const s = createVoiceSession(d);
      s.start();
      expect(s.transcript()).toBe(true);        // the r1 delivers sttEnded on silence, button still held
      expect(s.resolved(false)).toBe(true);     // e.g. no transcript: accepted, but deferred
      expect(resume).not.toHaveBeenCalled();
      expect(s.isLive()).toBe(true);
      s.release();
      expect(resume).toHaveBeenCalledTimes(1);
      expect(s.isLive()).toBe(false);
    });

    it('a found outcome mid-hold is held back: no jump until release, then exactly one', () => {
      const { d, resume } = deps(true);
      const jump = vi.fn();
      const s = createVoiceSession(d);
      s.start();
      expect(s.transcript()).toBe(true);
      s.asked();
      expect(s.answer(true, jump)).toBe('accepted');
      expect(jump).not.toHaveBeenCalled();
      s.release();
      expect(jump).toHaveBeenCalledTimes(1);
      expect(resume).not.toHaveBeenCalled();
      s.release();                               // a stray second release changes nothing
      expect(jump).toHaveBeenCalledTimes(1);
    });

    it('asked() while the mic is open arms no clock; release() does', async () => {
      const { d, resume } = deps(true);
      const s = createVoiceSession(d);
      s.start();
      expect(s.transcript()).toBe(true);
      s.asked();
      await vi.advanceTimersByTimeAsync(15000);   // still holding
      expect(resume).not.toHaveBeenCalled();
      s.release();
      await vi.advanceTimersByTimeAsync(10000);
      expect(resume).toHaveBeenCalledTimes(1);
    });

    it('a second outcome for a session that already holds one is refused', () => {
      const { d, resume } = deps(true);
      const jump = vi.fn();
      const s = createVoiceSession(d);
      s.start();
      expect(s.resolved(false)).toBe(true);
      expect(s.resolved(true, jump)).toBe(false);
      s.release();
      expect(jump).not.toHaveBeenCalled();
      expect(resume).toHaveBeenCalledTimes(1);
    });
  });

  describe('N1: an earlier session\'s messages never resolve a later one', () => {
    it('timeout resumed, retry hold, the stale found reply lands: rejected, no jump, radio stays off', async () => {
      const { d, resume, stop } = deps(true);
      const jump = vi.fn();
      const s = createVoiceSession(d);
      ask(s);
      await vi.advanceTimersByTimeAsync(10000);
      expect(resume).toHaveBeenCalledTimes(1);   // session 1 timed out and put the radio back
      s.start();                                  // retry hold
      expect(stop).toHaveBeenCalledTimes(2);
      expect(s.answer(true, jump)).toBe('stale');
      expect(jump).not.toHaveBeenCalled();
      expect(resume).toHaveBeenCalledTimes(1);
      expect(s.isLive()).toBe(true);
    });

    it('a stale no-match reply mid-hold does not resume', async () => {
      const { d, resume } = deps(true);
      const s = createVoiceSession(d);
      ask(s);
      await vi.advanceTimersByTimeAsync(10000);
      s.start();
      expect(s.answer(false)).toBe('stale');
      expect(resume).toHaveBeenCalledTimes(1);   // only session 1's own timeout resume
      await vi.advanceTimersByTimeAsync(15000);   // still holding
      expect(resume).toHaveBeenCalledTimes(1);
    });

    it('the retry\'s own reply is still accepted after the stale one is discarded', async () => {
      const { d } = deps(true);
      const jump = vi.fn();
      const s = createVoiceSession(d);
      ask(s);
      await vi.advanceTimersByTimeAsync(10000);
      s.start();
      expect(s.answer(true, vi.fn())).toBe('stale');
      s.release();
      expect(s.transcript()).toBe(true);
      s.asked();
      expect(s.answer(true, jump)).toBe('accepted');
      expect(jump).toHaveBeenCalledTimes(1);
    });

    it('start, ask, start, ask: the first reply is rejected, the second accepted', () => {
      const { d } = deps(true);
      const first = vi.fn();
      const second = vi.fn();
      const s = createVoiceSession(d);
      ask(s);
      ask(s);                                         // retry while session 1 still waits: 1 is ended, its reply stale
      expect(s.answer(true, first)).toBe('stale');
      expect(s.answer(true, second)).toBe('accepted');
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('re-hold before session 1\'s sttEnded: that transcript is discarded, arms nothing, and the retry\'s own is taken', async () => {
      const { d, resume } = deps(true);
      const s = createVoiceSession(d);
      s.start();
      s.release();
      s.start();                                  // re-hold; session 1's sttEnded is still in flight
      expect(s.transcript()).toBe(false);         // session 1's: the caller must not askLLM for it
      await vi.advanceTimersByTimeAsync(15000);   // still holding
      expect(resume).not.toHaveBeenCalled();
      s.release();
      expect(s.transcript()).toBe(true);          // the retry's own
    });

    it('an abandoned session\'s late reply is discarded rather than taken by the next search', () => {
      const { d } = deps(true);
      const jump = vi.fn();
      const s = createVoiceSession(d);
      ask(s);
      s.abandon();                                // e.g. a scroll while "thinking…"
      ask(s);
      expect(s.answer(true, jump)).toBe('stale');
      expect(jump).not.toHaveBeenCalled();
      expect(s.answer(true, jump)).toBe('accepted');
      expect(jump).toHaveBeenCalledTimes(1);
    });

    it('a reply nobody asked for is ignored', () => {
      const { d, resume } = deps(true);
      const jump = vi.fn();
      const s = createVoiceSession(d);
      expect(s.answer(true, jump)).toBe('ignored');   // no session at all
      s.start();
      expect(s.answer(false)).toBe('ignored');        // a session that has not asked yet
      expect(jump).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();
      expect(s.isLive()).toBe(true);
    });

    it('a transcript nobody expects is not taken', () => {
      const { d } = deps(true);
      const s = createVoiceSession(d);
      expect(s.transcript()).toBe(false);   // no session
      s.start();
      s.release();
      expect(s.transcript()).toBe(true);
      expect(s.transcript()).toBe(false);   // a second one for the same session
    });

    it('self-heal: a lost reply costs one later search at most, not every one after it', async () => {
      const { d } = deps(true);
      const s = createVoiceSession(d);
      ask(s);                                           // session 1's reply never comes
      await vi.advanceTimersByTimeAsync(10000);
      ask(s);
      expect(s.answer(true, vi.fn())).toBe('stale');    // taken for session 1's: session 2 loses its reply
      await vi.advanceTimersByTimeAsync(10000);         // session 2 times out; it forgives the one it discarded
      const jump = vi.fn();
      ask(s);
      expect(s.answer(true, jump)).toBe('accepted');   // session 3 is back in step
      expect(jump).toHaveBeenCalledTimes(1);
    });

    // Fix round 3: forgiveness only counts a discard that could have been the live session's own message.
    it('a retry\'s discarded reply is not forgiven: its slow reply after the timeout never resolves search 3', async () => {
      const { d, resume } = deps(true);
      const s = createVoiceSession(d);
      ask(s);                                           // search 1 asks ("paris")
      s.start();                                        // retry while search 1 still waits: its reply is on the way
      expect(s.answer(true, vi.fn())).toBe('stale');    // search 1's reply lands mid-retry: correctly discarded
      s.release();
      expect(s.transcript()).toBe(true);
      s.asked();                                        // search 2 asks ("madrid"); its reply is slow
      await vi.advanceTimersByTimeAsync(10000);
      expect(resume).toHaveBeenCalledTimes(1);          // search 2 timed out and put the radio back
      ask(s);                                           // search 3 asks ("sao paulo")
      const j2 = vi.fn();
      const j3 = vi.fn();
      expect(s.answer(true, j2)).toBe('stale');         // search 2's late reply: no jump
      expect(j2).not.toHaveBeenCalled();
      expect(s.answer(true, j3)).toBe('accepted');      // search 3's own
      expect(j3).toHaveBeenCalledTimes(1);
      expect(resume).toHaveBeenCalledTimes(1);
    });

    it('an abandoned search\'s reply that lands after the next one asked is not forgiven', async () => {
      const { d } = deps(true);
      const s = createVoiceSession(d);
      ask(s);
      s.abandon();                                      // a scroll while "thinking…": search 1's reply is on the way
      ask(s);                                           // search 2 asks before it lands
      expect(s.answer(true, vi.fn())).toBe('stale');    // search 1's reply
      await vi.advanceTimersByTimeAsync(10000);         // search 2's own reply is slow
      ask(s);
      const j2 = vi.fn();
      const j3 = vi.fn();
      expect(s.answer(true, j2)).toBe('stale');         // search 2's late reply
      expect(s.answer(true, j3)).toBe('accepted');
      expect(j2).not.toHaveBeenCalled();
      expect(j3).toHaveBeenCalledTimes(1);
    });

    it('a re-hold\'s discarded sttEnded is not forgiven either', async () => {
      const { d, resume } = deps(true);
      const s = createVoiceSession(d);
      s.start();
      s.release();
      s.start();                                  // re-hold: session 1's sttEnded is still on the way
      expect(s.transcript()).toBe(false);         // session 1's, discarded
      s.release();                                // session 2's own sttEnded is slow
      await vi.advanceTimersByTimeAsync(10000);
      expect(resume).toHaveBeenCalledTimes(1);
      s.start();
      s.release();
      expect(s.transcript()).toBe(false);         // session 2's late one: no askLLM for it
      expect(s.transcript()).toBe(true);          // session 3's own
    });

    it('a timed-out session\'s reply that lands before the next search has asked is not forgiven', async () => {
      const { d } = deps(true);
      const s = createVoiceSession(d);
      ask(s);
      await vi.advanceTimersByTimeAsync(10000);         // search 1 times out; its reply is only slow
      s.start();
      expect(s.answer(true, vi.fn())).toBe('stale');    // lands mid-hold, before search 2 asked: cannot be search 2's
      s.release();
      expect(s.transcript()).toBe(true);
      s.asked();
      await vi.advanceTimersByTimeAsync(10000);         // search 2's reply is slow too
      ask(s);
      const j2 = vi.fn();
      const j3 = vi.fn();
      expect(s.answer(true, j2)).toBe('stale');
      expect(s.answer(true, j3)).toBe('accepted');
      expect(j2).not.toHaveBeenCalled();
      expect(j3).toHaveBeenCalledTimes(1);
    });

    it('self-heal: a lost sttEnded costs one later search at most', async () => {
      const { d } = deps(true);
      const s = createVoiceSession(d);
      s.start();
      s.release();                                      // session 1's sttEnded never comes
      await vi.advanceTimersByTimeAsync(10000);
      s.start();
      s.release();
      expect(s.transcript()).toBe(false);               // taken for session 1's
      await vi.advanceTimersByTimeAsync(10000);
      s.start();
      s.release();
      expect(s.transcript()).toBe(true);                // session 3 is back in step
    });
  });
});
