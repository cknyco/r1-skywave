/** The tuning static's loudness at full volume. */
export const STATIC_GAIN = 0.15;

/** Band-passed noise while a station connects; `level` (0–1) is the app's volume, which it follows (Ruling 49). */
export interface Static { start(): void; stop(): void; level(f: number): void }

export function createStatic(AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext): Static {
  if (!AC) return { start() {}, stop() {}, level() {} };
  const ctx = new AC();
  const len = ctx.sampleRate;
  const noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1800;
  band.Q.value = 0.7;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  band.connect(gain).connect(ctx.destination);
  let src: AudioBufferSourceNode | null = null;
  let lvl = 1;
  return {
    start() {
      if (src) return;
      void ctx.resume();
      src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.connect(band);
      src.start();
      gain.gain.setTargetAtTime(STATIC_GAIN * lvl, ctx.currentTime, 0.05);
    },
    stop() {
      if (!src) return;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      const s = src;
      src = null;
      s.stop(ctx.currentTime + 0.4);
    },
    level(f) {
      lvl = Math.max(0, Math.min(1, f));
      if (src) gain.gain.setTargetAtTime(STATIC_GAIN * lvl, ctx.currentTime, 0.05);
    },
  };
}
