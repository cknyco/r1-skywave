import { describe, expect, it } from 'vitest';
import { FLY_MS, VOLUME_STEP } from '../../src/config';
import { createStore, loadJson, saveJson } from '../../src/platform/storage';
import {
  FLY_OFF, VOLUME_KEY, VOLUME_MAX_NOTE, VOLUME_MUTED, flyEnds, flyNext, readVolume, stepVolume, volumeView,
  type Fly, type FlyEvent,
} from '../../src/app/wheel';

/** Runs events [event, time] from `s` and returns every state on the way. */
function run(events: [FlyEvent, number][], s: Fly = FLY_OFF): Fly[] {
  const out: Fly[] = [];
  for (const [e, t] of events) out.push(s = flyNext(s, e, t));
  return out;
}
const last = (events: [FlyEvent, number][], s?: Fly) => { const all = run(events, s); return all[all.length - 1]; };

describe('fly mode (Ruling 49)', () => {
  it('is off at first: a wheel step goes to the volume and arms nothing', () => {
    const s = flyNext(FLY_OFF, 'step', 1000);
    expect(s.mode).toBe('volume');
    expect(flyEnds(s)).toBe(Infinity);
    expect(last([['tick', 5000], ['rest', 6000], ['step', 7000]]).mode).toBe('volume');
  });

  it('a tap at rest turns it on for FLY_MS; the tick at the deadline ends it, not one before', () => {
    const on = flyNext(FLY_OFF, 'tap', 1000);
    expect(on.mode).toBe('fly');
    expect(flyEnds(on)).toBe(1000 + FLY_MS);
    expect(flyNext(on, 'tick', 1000 + FLY_MS - 1).mode).toBe('fly');
    expect(flyNext(on, 'tick', 1000 + FLY_MS).mode).toBe('volume');
    expect(flyNext(on, 'tick', 1000 + FLY_MS + 500).mode).toBe('volume');
  });

  it('a tick early by a little keeps it on and moves the deadline nowhere', () => {
    const early = last([['tap', 0], ['tick', FLY_MS - 2]]);
    expect(early.mode).toBe('fly');
    expect(flyEnds(early)).toBe(FLY_MS);
  });

  it('each wheel step in fly mode starts FLY_MS again', () => {
    const s = last([['tap', 0], ['step', 2000], ['step', 4000]]);
    expect(s.mode).toBe('fly');
    expect(flyEnds(s)).toBe(4000 + FLY_MS);
    expect(flyNext(s, 'tick', 4000 + FLY_MS - 1).mode).toBe('fly');
    expect(flyNext(s, 'tick', 4000 + FLY_MS).mode).toBe('volume');
  });

  it('a step after the countdown ran out (before its tick) goes to the volume', () => {
    const s = last([['tap', 0], ['step', FLY_MS]]);
    expect(s.mode).toBe('volume');
    expect(flyEnds(s)).toBe(Infinity);
  });

  it('the countdown only runs while the map rests: a flight pauses it, the landing lets it go on', () => {
    const [, flying, still] = run([['tap', 0], ['moving', 1000], ['tick', 60000]]);
    expect(flying.mode).toBe('fly');
    expect(flyEnds(flying)).toBe(Infinity);
    expect(still.mode).toBe('fly');   // however long the flight
    const landed = flyNext(still, 'rest', 60000);
    expect(flyEnds(landed)).toBe(60000 + FLY_MS - 1000);   // 1 s of rest was used before the flight
    expect(flyNext(landed, 'tick', 60000 + FLY_MS - 1001).mode).toBe('fly');
    expect(flyNext(landed, 'tick', 60000 + FLY_MS - 1000).mode).toBe('volume');
  });

  it('a wheel step starts a flight: FLY_MS of rest after the landing', () => {
    const s = last([['tap', 0], ['step', 2500], ['moving', 2500], ['rest', 3200]]);
    expect(s.mode).toBe('fly');
    expect(flyEnds(s)).toBe(3200 + FLY_MS);
  });

  it('a step during a flight starts FLY_MS again, still paused until the landing', () => {
    const s = last([['tap', 0], ['moving', 1000], ['step', 1500]]);
    expect(flyEnds(s)).toBe(Infinity);
    expect(flyEnds(flyNext(s, 'rest', 2000))).toBe(2000 + FLY_MS);
  });

  it('a tap during a flight (boot flight, zoom) turns it on but waits for the landing', () => {
    const s = last([['moving', 0], ['tap', 100]]);   // moving is heard while off, too
    expect(s.mode).toBe('fly');
    expect(s.moving).toBe(true);
    expect(flyEnds(s)).toBe(Infinity);
    expect(flyNext(s, 'tick', 9000).mode).toBe('fly');
    expect(flyEnds(flyNext(s, 'rest', 9000))).toBe(9000 + FLY_MS);
  });

  it('a second tap ends it at once, at rest or in flight, and a late tick does not bring it back', () => {
    const off = last([['tap', 0], ['tap', 500]]);
    expect(off.mode).toBe('volume');
    expect(flyEnds(off)).toBe(Infinity);
    expect(flyNext(off, 'tick', FLY_MS).mode).toBe('volume');
    expect(last([['tap', 0], ['moving', 100], ['tap', 200]]).mode).toBe('volume');
  });

  it('a second tap just after the countdown ran out, before its tick, still ends it (the button was lit)', () => {
    expect(last([['tap', 0], ['tap', FLY_MS + 5]]).mode).toBe('volume');
  });

  it('a third tap turns it on again with a fresh FLY_MS', () => {
    const s = last([['tap', 0], ['tap', 500], ['tap', 900]]);
    expect(s.mode).toBe('fly');
    expect(flyEnds(s)).toBe(900 + FLY_MS);
  });

  it('close (a list, About, a voice hold) ends it at once, at rest or in flight; off stays off', () => {
    expect(last([['tap', 0], ['close', 100]]).mode).toBe('volume');
    expect(last([['tap', 0], ['moving', 100], ['close', 200]]).mode).toBe('volume');
    const off = last([['close', 100]]);
    expect(off.mode).toBe('volume');
    expect(flyEnds(off)).toBe(Infinity);
  });

  it('tracks the map while off, so the next tap knows it is flying or resting', () => {
    expect(last([['moving', 0]]).moving).toBe(true);
    expect(last([['moving', 0], ['rest', 500]]).moving).toBe(false);
    expect(flyEnds(last([['moving', 0], ['rest', 500], ['tap', 700]]))).toBe(700 + FLY_MS);
  });

  it('takes another length', () => {
    expect(flyEnds(flyNext(FLY_OFF, 'tap', 0, 1000))).toBe(1000);
    expect(FLY_MS).toBe(3000);
  });
});

describe('volume (Ruling 49)', () => {
  it('starts at 100 % and reads back only numbers, clamped to 0–100', () => {
    for (const v of [null, undefined, '50', NaN, Infinity, {}]) expect(readVolume(v)).toBe(100);
    expect(readVolume(55)).toBe(55);
    expect(readVolume(150)).toBe(100);
    expect(readVolume(-5)).toBe(0);
    expect(readVolume(42.4)).toBe(42);
  });

  it('steps 5 % per wheel event: dir -1 (wheel up) louder, dir 1 softer, clamped to 0–100', () => {
    expect(VOLUME_STEP).toBe(5);
    expect(stepVolume(50, -1)).toBe(55);
    expect(stepVolume(50, 1)).toBe(45);
    expect(stepVolume(100, -1)).toBe(100);
    expect(stepVolume(0, 1)).toBe(0);
    expect(stepVolume(0, -1)).toBe(5);
    expect(stepVolume(3, 1)).toBe(0);
    let v = 100;
    for (let k = 0; k < 25; k++) v = stepVolume(v, 1);
    expect(v).toBe(0);
    for (let k = 0; k < 12; k++) v = stepVolume(v, -1);
    expect(v).toBe(60);
  });

  it('the bar shows the level read back from the element, "muted" at 0, the note only for louder at 100 %', () => {
    expect(volumeView(0.6, false)).toEqual({ fill: 60, text: '60 %', note: '' });
    expect(volumeView(1, true)).toEqual({ fill: 100, text: '100 %', note: VOLUME_MAX_NOTE });
    expect(volumeView(0, false)).toEqual({ fill: 0, text: VOLUME_MUTED, note: '' });
    expect(volumeView(0.05, false).text).toBe('5 %');
    expect(volumeView(NaN, false).text).toBe(VOLUME_MUTED);
    expect(VOLUME_MUTED).toBe('muted');
    for (const t of [VOLUME_MAX_NOTE, VOLUME_MUTED]) expect(t.toLowerCase()).not.toContain('garden');
  });

  it('is remembered in the app store (creationStorage on the r1) and read back at boot', async () => {
    const m = new Map<string, string>();
    const kv = createStore({ creationStorage: { plain: {
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: string) => { m.set(k, v); },
    } } } as never);
    expect(readVolume(await loadJson<unknown>(kv, VOLUME_KEY, null))).toBe(100);   // first run
    await saveJson(kv, VOLUME_KEY, 35);
    expect(readVolume(await loadJson<unknown>(kv, VOLUME_KEY, null))).toBe(35);
    m.set(VOLUME_KEY, 'not json!');
    expect(readVolume(await loadJson<unknown>(kv, VOLUME_KEY, null))).toBe(100);
  });
});
