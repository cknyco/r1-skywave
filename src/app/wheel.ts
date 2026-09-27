// What the wheel does on the map (Ruling 49). By default it is the volume: 0–100 % of the r1's own volume, VOLUME_STEP
// per wheel event, wheel up louder. The ✈ button switches it to places ("fly over the globe") for a while.
import { FLY_MS, VOLUME_STEP } from '../config';

export type WheelMode = 'volume' | 'fly';
export type FlyEvent = 'tap' | 'step' | 'moving' | 'rest' | 'tick' | 'close';

/**
 * Fly mode as a state machine. `left` is the rest time fly mode still has, counted down from `at` while the map rests.
 * - `tap` (the ✈ button): turns fly mode on with FLY_MS to run, or, when it is on, ends it at once.
 * - `step` (a wheel event on the map): while fly mode is on, FLY_MS to run again; the step goes to places. When the
 *   countdown has already run out, or fly mode is off, the step goes to the volume and changes nothing here.
 * - `moving` / `rest` (a flight starts / the map lands): the countdown only runs while the map rests, so a flight
 *   pauses it and the landing lets it go on where it stopped. They are fed whatever the mode, so a tap during a
 *   flight (the boot flight, a zoom) waits for the landing.
 * - `tick` (the app's timer at `flyEnds`): the countdown ends fly mode once it reaches 0.
 * - `close` (the station list, a worldwide list or About opens, or a voice hold): ends fly mode at once.
 * So fly mode ends FLY_MS of rest after the tap or the last wheel step.
 */
export interface Fly { mode: WheelMode; moving: boolean; left: number; at: number }

export const FLY_OFF: Fly = { mode: 'volume', moving: false, left: 0, at: 0 };

export function flyNext(s: Fly, e: FlyEvent, now: number, ms = FLY_MS): Fly {
  let { mode, moving, left } = s;
  if (mode === 'fly' && !moving) {   // the countdown runs while the map rests
    left -= now - s.at;
    if (left <= 0) mode = 'volume';
  }
  if (e === 'tap') { mode = s.mode === 'fly' ? 'volume' : 'fly'; left = ms; }   // what the lit button showed
  else if (e === 'step' && mode === 'fly') left = ms;
  else if (e === 'moving') moving = true;
  else if (e === 'rest') moving = false;
  else if (e === 'close') mode = 'volume';
  return { mode, moving, left: mode === 'fly' ? left : 0, at: now };
}

/** When fly mode ends if nothing else happens: its deadline while the map rests; Infinity while it flies, or when off. */
export const flyEnds = (s: Fly): number => (s.mode === 'fly' && !s.moving ? s.at + s.left : Infinity);

/** Storage key of the volume (per cent). */
export const VOLUME_KEY = 'volume';
export const VOLUME_MUTED = 'muted';
export const VOLUME_MAX_NOTE = "The r1's own volume sets the maximum.";

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** The stored volume in per cent: 100 on the first run, or when what is stored is not a number. */
export const readVolume = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v) : 100);

/** One wheel event: dir -1 (wheel up, as for places unless the controls are inverted) is louder, dir 1 softer. */
export const stepVolume = (v: number, dir: 1 | -1): number => clamp(v - dir * VOLUME_STEP);

/**
 * The volume bar, from what the audio element reads back (0–1), not from the value the app set: a WebView that
 * ignores the setter shows up in a photo. `max`: the event asked for louder at 100 %.
 */
export function volumeView(readBack: number, max: boolean): { fill: number; text: string; note: string } {
  const pct = Number.isFinite(readBack) ? clamp(readBack * 100) : 0;
  return { fill: pct, text: pct ? `${pct} %` : VOLUME_MUTED, note: max ? VOLUME_MAX_NOTE : '' };
}
