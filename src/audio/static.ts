export function createStatic(): { start(): void; stop(): void } {
  const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!AC) return { start() {}, stop() {} };
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
  return {
    start() {
      if (src) return;
      void ctx.resume();
      src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.connect(band);
      src.start();
      gain.gain.setTargetAtTime(0.15, ctx.currentTime, 0.05);
    },
    stop() {
      if (!src) return;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      const s = src;
      src = null;
      s.stop(ctx.currentTime + 0.4);
    },
  };
}
