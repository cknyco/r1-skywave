import { describe, expect, it } from 'vitest';
import { STATIC_GAIN, createStatic } from '../../src/audio/static';

/** Just enough of an AudioContext: the gain's targets and the sources started and stopped. */
function fakeContext() {
  const targets: number[] = [];
  const sources: { started: boolean; stopped: boolean }[] = [];
  const node = () => ({ connect: (n: unknown) => n });
  class FakeContext {
    sampleRate = 8;
    currentTime = 0;
    destination = {};
    resume() { return Promise.resolve(); }
    createBuffer() { return { getChannelData: () => new Float32Array(8) }; }
    createBiquadFilter() { return { ...node(), type: '', frequency: { value: 0 }, Q: { value: 0 } }; }
    createGain() { return { ...node(), gain: { value: 0, setTargetAtTime: (v: number) => { targets.push(v); } } }; }
    createBufferSource() {
      const s = { started: false, stopped: false };
      sources.push(s);
      return { ...node(), buffer: null, loop: false, start() { s.started = true; }, stop() { s.stopped = true; } };
    }
  }
  return { AC: FakeContext as unknown as typeof AudioContext, targets, sources };
}

describe('tuning static (Ruling 49: it follows the volume)', () => {
  it('plays at STATIC_GAIN at full volume', () => {
    const f = fakeContext();
    const s = createStatic(f.AC);
    s.start();
    expect(f.targets).toEqual([STATIC_GAIN]);
    expect(STATIC_GAIN).toBe(0.15);
    s.stop();
    expect(f.targets[f.targets.length - 1]).toBe(0);
    expect(f.sources[0].stopped).toBe(true);
  });

  it('starts at the volume set before it, proportionally', () => {
    const f = fakeContext();
    const s = createStatic(f.AC);
    s.level(0.6);
    expect(f.targets).toEqual([]);   // silent until a station connects
    s.start();
    expect(f.targets[0]).toBeCloseTo(STATIC_GAIN * 0.6, 10);
  });

  it('follows a volume change while it plays, and is silent at 0', () => {
    const f = fakeContext();
    const s = createStatic(f.AC);
    s.start();
    s.level(0.25);
    expect(f.targets[f.targets.length - 1]).toBeCloseTo(STATIC_GAIN * 0.25, 10);
    s.level(0);
    expect(f.targets[f.targets.length - 1]).toBe(0);
    s.level(3);   // clamped
    expect(f.targets[f.targets.length - 1]).toBeCloseTo(STATIC_GAIN, 10);
  });

  it('without Web Audio it is a silent stand-in', () => {
    const s = createStatic(undefined);
    expect(() => { s.level(0.5); s.start(); s.stop(); }).not.toThrow();
  });
});
