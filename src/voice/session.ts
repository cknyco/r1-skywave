// Ruling 37: voice search stops the radio before it starts listening, and — unless a place is
// found — puts back whatever was playing before. This module holds only that timing/decision
// logic; it knows nothing about the player, the Tuner or the screen. main.ts supplies those as
// `stop`/`resume`/`onSettle` and decides itself what "was playing" and "resume" mean.
//
// Fix round 1: the 10s clock never runs while the mic is open (I3); any other user action ends a
// live session through abandon() without resuming (I2); a retry hold carries the first session's
// "was playing" forward, since that session's stop() already silenced the player (I4).
//
// Fix round 2 (N1): two invariants.
//  1. While the mic is open (start() .. release()), nothing arms the clock, resumes or jumps. An
//     outcome that lands mid-hold — the r1 may deliver this session's own sttEnded on silence while
//     the button is still held — is held back and applied at release().
//  2. A transcript or reply produced for an earlier session never resolves a later one. The bridge
//     carries no request id, so this counts what each session is still owed (one sttEnded per
//     start(), one reply per asked()) and, when a session ends with some of it outstanding, discards
//     that many of the next arrivals. FIFO is assumed.
//     Self-heal: a session that times out after discarding k "stale" arrivals of a kind, while
//     never getting its own, forgives k of its own debt. Otherwise a single lost sttEnded or reply
//     would eat the next session's, which then times out owing its own, and so on for every later
//     search.
//
// Fix round 3 (N1): only a discard that could have been the live session's own message counts
// toward that forgiveness. The debt it was charged to must come from a session that itself timed
// out (its message was already 10s late, so lost is plausible), and the live session must have been
// waiting for one of that kind at the time. A session ended by a retry start() or abandon() still
// has its message on the way, so eating it is correct, not a sign of loss; forgiving it made the
// forgiving session's own slow reply unowned, and the next search took it as its own. What is left:
// a timed-out session's reply that arrives after all, and a later session's own reply that also
// takes over 10s, can still land one session off.

export interface VoiceSessionDeps {
  /** Whether audio was actually playing (or still connecting) right now, read at start(). */
  isPlaying(): boolean;
  /** Stop playback immediately: the player, the tuning static, any pending settle/tune. */
  stop(): void;
  /** Put back what start() found playing. Called at most once per session. */
  resume(): void;
  /** Runs once whenever the session ends, resumed or not — the caller's cue to clear its "listening…"/"thinking…" note. */
  onSettle?(): void;
}

/** What answer() did with an LLM reply. */
export type Answer = 'accepted' | 'stale' | 'ignored';

export interface VoiceSession {
  /** longPressStart: records whether audio was playing, stops it, opens the mic. Expects one sttEnded. Arms nothing. */
  start(): void;
  /** longPressEnd: the mic is closed. Applies an outcome that landed while it was open, or else arms the 10s clock. */
  release(): void;
  /** Voice never started (startVoice() returned false): no sttEnded is coming; ends the session right away, same as a "not found". */
  end(): boolean;
  /** An sttEnded arrived. True only when it is the live session's own; false for an earlier session's (or an unexpected one). */
  transcript(): boolean;
  /** askLLM() went out for the live session: one reply is now owed. Restarts the 10s clock unless the mic is still open. */
  asked(): void;
  /**
   * An LLM reply arrived. 'stale' when it answers an earlier session's request (discarded, changes nothing); 'accepted'
   * when it answers the live session's (resolved as found/not found — held back until release() while the mic is open);
   * 'ignored' when nothing is owed a reply at all.
   */
  answer(found: boolean, jump?: () => void): Answer;
  /**
   * The live session reached an outcome without an LLM reply (no transcript, or askLLM() failed), or a caller settles it
   * directly. Not found + had been playing = resume; found runs `jump` instead. Held back until release() while the mic is
   * open. Returns false when no session is live (or it already has an outcome) — a stray call changes nothing.
   */
  resolved(found: boolean, jump?: () => void): boolean;
  /** A user action elsewhere (scroll, side click, a list pick) ends the session without resuming. */
  abandon(): void;
  /** Whether a session is currently open. */
  isLive(): boolean;
}

const TIMEOUT_MS = 10000;

type Kind = 'stt' | 'reply';

export function createVoiceSession(d: VoiceSessionDeps, timeoutMs = TIMEOUT_MS): VoiceSession {
  let live = false;
  let listening = false;   // the live session's mic is open
  let wasPlaying = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let held: { resume: boolean; jump?: () => void } | null = null;   // an outcome that landed while listening
  const owed = { stt: 0, reply: 0 };    // what the live session still expects
  // What ended sessions are still owed, oldest first: the next that many arrivals are theirs. Each entry records whether
  // the session that owed it timed out (true) or was cut short by a retry, abandon() or an outcome (false).
  const stale: Record<Kind, boolean[]> = { stt: [], reply: [] };
  const ate = { stt: 0, reply: 0 };     // self-heal: discards the live session may have lost its own message to

  function clearTimer() {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
  }

  function finish(resume: boolean, jump?: () => void, timedOut = false): boolean {
    if (!live) return false;
    live = false;
    listening = false;
    held = null;
    clearTimer();
    for (const k of ['stt', 'reply'] as const) {
      const forgiven = timedOut ? Math.min(owed[k], ate[k]) : 0;
      for (let i = forgiven; i < owed[k]; i++) stale[k].push(timedOut);
      owed[k] = 0;
      ate[k] = 0;
    }
    if (jump) jump(); else if (resume) d.resume();
    d.onSettle?.();
    return true;
  }

  function arm() {
    clearTimer();
    timer = setTimeout(() => finish(wasPlaying, undefined, true), timeoutMs);
  }

  function settle(found: boolean, jump?: () => void): boolean {
    if (!live || held) return false;
    const outcome = { resume: !found && wasPlaying, jump: found ? jump : undefined };
    if (listening) { held = outcome; return true; }   // invariant 1: nothing happens while the mic is open
    return finish(outcome.resume, outcome.jump);
  }

  /** Attributes one arrival of `kind`: an ended session's first (FIFO), else the live session's if it's owed one. */
  function arrive(kind: Kind): 'current' | 'stale' | 'none' {
    const debt = stale[kind];
    if (debt.length > 0) {
      const lapsed = debt.shift();   // its session timed out: its message may have been lost, not just slow
      // Round 3: only then, and only while the live session is itself waiting for one, might this be its own.
      if (live && lapsed && owed[kind] > 0) ate[kind]++;
      return 'stale';
    }
    if (live && owed[kind] > 0) { owed[kind]--; return 'current'; }
    return 'none';
  }

  return {
    start() {
      const carried = live && wasPlaying;   // I4: a retry hold keeps the original flag, not the now-silent player's
      finish(false);                        // a still-open session ends unresumed; what it was owed turns stale
      wasPlaying = carried || d.isPlaying();
      live = true;
      listening = true;
      owed.stt = 1;                         // one sttEnded per startVoice(); end() takes it back if voice never starts
      d.stop();
    },
    release() {
      if (!live || !listening) return;
      listening = false;
      if (held) { const o = held; finish(o.resume, o.jump); return; }
      arm();   // fallback clock, in case sttEnded never arrives
    },
    end() {
      if (!live) return false;
      owed.stt = 0;
      return finish(wasPlaying);
    },
    transcript() {
      return arrive('stt') === 'current';
    },
    asked() {
      if (!live) return;
      owed.reply++;
      if (!listening) arm();   // a fresh 10s for the reply; while the mic is open, release() arms it
    },
    answer(found, jump) {
      const whose = arrive('reply');
      if (whose === 'stale') return 'stale';
      if (whose === 'none') return 'ignored';
      return settle(found, jump) ? 'accepted' : 'ignored';
    },
    resolved(found, jump) {
      return settle(found, jump);
    },
    abandon() {
      finish(false);
    },
    isLive() {
      return live;
    },
  };
}
