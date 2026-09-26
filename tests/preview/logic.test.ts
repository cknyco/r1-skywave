import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerState } from '../../src/audio/player';
import { Tuner } from '../../src/audio/tuner';
import type { Places, StationRow } from '../../src/data/store';
import { ListModel } from '../../src/ui/list';
import {
  HINT, LIST_HINT, NOTE, countryName, lastOf, listView, localTime, msToNextMinute, placeForIntent, playable,
  screenModel, sharePlayer, startPlace, stationCount, statusText, viewport, whereLine,
} from '../../src/preview/logic';

const places: Places = {
  v: 't', n: 5,
  lat: Float32Array.from([52.5, 48.1, 35.7, -23.5, 40.7]),
  lon: Float32Array.from([13.4, 11.6, 139.7, -46.6, -74.0]),
  count: Uint16Array.from([68, 30, 50, 40, 90]),
  name: ['Berlin', 'Munich', 'Tokyo', 'São Paulo', 'New York'],
  cc: ['DE', 'DE', 'JP', 'BR', 'US'],
  tz: ['Europe/Berlin', 'Europe/Berlin', 'Asia/Tokyo', 'America/Sao_Paulo', 'America/New_York'],
};

const row = (id: string, place = 0, url = `https://${id}.example/stream`): StationRow =>
  ({ place, id, name: id.toUpperCase(), url, codec: 'MP3', bitrate: 128, tags: [] });

const at = new Date('2026-09-26T12:34:00Z');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('start place', () => {
  it('takes ?place= first, folding case and accents', () => {
    expect(startPlace(places, 'Berlin', null, '')).toBe(0);
    expect(startPlace(places, 'munich', { place: 2 }, '')).toBe(1);
    expect(startPlace(places, 'Sao Paulo', null, '')).toBe(3);
  });

  it('falls back to the saved place when the query matches nothing', () => {
    expect(startPlace(places, 'Atlantis', { place: 2, name: 'Tokyo', cc: 'JP' }, 'Europe/Berlin')).toBe(2);
    expect(startPlace(places, null, { place: 1 }, 'Europe/Berlin')).toBe(1);
  });

  it('finds the saved place by name when the nightly data moved its index', () => {
    expect(startPlace(places, null, { place: 2, name: 'Munich', cc: 'DE' }, '')).toBe(1);
  });

  it('ignores a saved place that is out of range or gone', () => {
    expect(startPlace(places, null, { place: 99 }, 'Asia/Tokyo')).toBe(2);
    expect(startPlace(places, null, { place: -1 }, 'Asia/Tokyo')).toBe(2);
    expect(startPlace(places, null, { place: 2, name: 'Gone', cc: 'JP' }, 'America/Sao_Paulo')).toBe(3);
  });

  it('then takes the biggest place in the device time zone', () => {
    expect(startPlace(places, null, null, 'Europe/Berlin')).toBe(0);
    expect(startPlace(places, null, null, 'Asia/Tokyo')).toBe(2);
  });

  it('then the biggest place overall, not simply the first one', () => {
    expect(startPlace(places, null, null, 'Pacific/Fiji')).toBe(4);
    expect(startPlace(places, null, null, '')).toBe(4);
  });

  it('saves the name with the index so a later dataset can find it again', () => {
    expect(lastOf(places, 2)).toEqual({ place: 2, name: 'Tokyo', cc: 'JP' });
  });
});

describe('voice intent to place', () => {
  it('uses the named place, else the biggest place of the country', () => {
    expect(placeForIntent(places, { place: 'Tokyo', country: 'JP', genre: 'jazz' })).toBe(2);
    expect(placeForIntent(places, { place: null, country: 'DE', genre: null })).toBe(0);
    expect(placeForIntent(places, { place: 'Nowhere', country: 'BR', genre: null })).toBe(3);
  });

  it('gives up on genre-only requests (the preview has no genre search)', () => {
    expect(placeForIntent(places, { place: null, country: null, genre: 'jazz' })).toBe(-1);
  });
});

describe('text', () => {
  it('names countries in English and falls back to the code', () => {
    expect(countryName('DE')).toBe('Germany');
    expect(countryName('JP')).toBe('Japan');
    expect(countryName('X1')).toBe('X1');
    expect(countryName('')).toBe('');
  });

  it('formats the local time of a time zone as HH:MM', () => {
    expect(localTime('Europe/Berlin', at)).toBe('14:34');
    expect(localTime('Asia/Tokyo', at)).toBe('21:34');
    expect(localTime('America/New_York', at)).toBe('08:34');
    expect(localTime('Europe/Berlin', new Date('2026-09-26T22:05:00Z'))).toBe('00:05');
  });

  it('leaves the time out for a missing or unknown time zone', () => {
    expect(localTime('', at)).toBe('');
    expect(localTime('Not/AZone', at)).toBe('');
    expect(whereLine('DE', 'Europe/Berlin', at)).toBe('Germany · 14:34');
    expect(whereLine('DE', '', at)).toBe('Germany');
  });

  it('counts stations', () => {
    expect(stationCount(1)).toBe('1 station');
    expect(stationCount(68)).toBe('68 stations');
  });

  it('maps player states to the status line', () => {
    const s: Record<PlayerState, string> = { idle: '', loading: 'tuning…', playing: 'live', error: 'no signal' };
    for (const k of Object.keys(s) as PlayerState[]) expect(statusText(k)).toBe(s[k]);
  });

  it('never mentions the forbidden name in UI text', () => {
    const all = [...HINT, LIST_HINT, ...Object.values(NOTE), 'tuning…', 'live', 'no signal'];
    for (const t of all) expect(t.toLowerCase()).not.toContain('garden');
    expect(HINT.join(' · ')).toBe('wheel: places · side: play/stop · hold: voice · tap: list');
  });

  it('refreshes the clock on the next minute boundary', () => {
    expect(msToNextMinute(0)).toBe(60000);
    expect(msToNextMinute(59999)).toBe(1);
    expect(msToNextMinute(120500)).toBe(59500);
  });

  it('fills the window, with 240x282 when the size is unknown', () => {
    expect(viewport(240, 292)).toEqual({ w: 240, h: 292 });
    expect(viewport(0, 0)).toEqual({ w: 240, h: 282 });
  });
});

describe('screen model', () => {
  it('is empty before a place is known', () => {
    expect(screenModel(places, -1, 'idle', null, '', at))
      .toEqual({ status: '', place: '', where: '', count: '', station: '', live: false });
  });

  it('shows the place and its live station', () => {
    expect(screenModel(places, 0, 'playing', row('dlf', 0), '', at)).toEqual({
      status: 'live', place: 'Berlin', where: 'Germany · 14:34', count: '68 stations', station: 'DLF', live: true,
    });
  });

  it('hides a station that belongs to the previous place', () => {
    const m = screenModel(places, 2, 'loading', row('dlf', 0), '', at);
    expect([m.status, m.station, m.live]).toEqual(['tuning…', '', false]);
  });

  it('lets a note override the player status', () => {
    expect(screenModel(places, 0, 'playing', null, NOTE.listening, at).status).toBe(NOTE.listening);
  });
});

describe('stations the preview may play', () => {
  it('keeps https streams only and never a radio.garden host', () => {
    const rows = [
      row('ok'),
      row('plain', 0, 'http://plain.example/stream'),
      row('rg', 0, 'https://radio.garden/api/listen/x'),
      row('rg2', 0, 'https://cdn.radio.garden/x'),
      row('bad', 0, 'not a url'),
    ];
    expect(playable(rows).map(r => r.id)).toEqual(['ok']);
  });
});

describe('list view', () => {
  it('shows 7 rows with the selection and favourites marked', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`s${i}`));
    const m = new ListModel(rows, new Set(['s9']));
    for (let i = 0; i < 6; i++) m.move(1);
    const v = listView(m, new Set(['s9']), 'Berlin');
    expect(v.title).toBe('Berlin · 12 stations');
    expect(v.rows).toHaveLength(7);
    expect(v.rows.filter(r => r.sel).map(r => r.i)).toEqual([6]);
    expect(v.rows[0]).toEqual({ i: 1, name: 'S0', fav: false, sel: false });
    expect(listView(new ListModel(rows, new Set(['s9'])), new Set(['s9']), 'Berlin').rows[0])
      .toEqual({ i: 0, name: 'S9', fav: true, sel: true });
  });
});

function fakePlayer() {
  const calls: string[] = [];
  let pending: ((s: PlayerState) => void) | null = null;
  const p = {
    state: 'idle' as PlayerState,
    play(url: string): Promise<PlayerState> {
      calls.push(url);
      const prev = pending;
      pending = null;
      prev?.('idle');            // like Player: a new play settles the one before it as 'idle'
      p.state = 'loading';
      return new Promise(r => { pending = r; });
    },
    stop() { const prev = pending; pending = null; prev?.('idle'); p.state = 'idle'; },
    finish(s: PlayerState) { p.state = s; const f = pending; pending = null; f?.(s); },
  };
  return { p, calls };
}

describe('sharePlayer', () => {
  afterEach(() => vi.useRealTimers());

  it('passes the tuner through while no list pick owns the player', async () => {
    const { p, calls } = fakePlayer();
    const shared = sharePlayer(p, () => undefined);
    const r = shared.player.play('a');
    p.finish('playing');
    expect(await r).toBe('playing');
    expect(calls).toEqual(['a']);
    expect(shared.player.state).toBe('playing');
  });

  it('parks the tuner while a pick owns the player, until reattach', async () => {
    const { p, calls } = fakePlayer();
    const noise = { start: vi.fn(), stop: vi.fn() };
    const shared = sharePlayer(p, () => noise);
    let settled = false;
    void shared.player.play('a').then(() => { settled = true; });
    void shared.direct('pick');
    expect(noise.stop).toHaveBeenCalledTimes(1);
    await flush();
    expect(settled).toBe(false);          // the superseded tuner play never reports 'idle' back

    let later = false;
    void shared.player.play('b').then(() => { later = true; });
    shared.noise.start();
    await flush();
    expect(calls).toEqual(['a', 'pick']); // 'b' never started
    expect(later).toBe(false);
    expect(noise.start).not.toHaveBeenCalled();

    shared.reattach();
    void shared.player.play('c');
    shared.noise.start();
    expect(calls).toEqual(['a', 'pick', 'c']);
    expect(noise.start).toHaveBeenCalledTimes(1);
  });

  it('keeps a connecting Tuner from replacing a list pick', async () => {
    const { p, calls } = fakePlayer();
    const shared = sharePlayer(p, () => undefined);
    const rows = [row('a'), row('b'), row('c')];
    const tuner = new Tuner({ player: shared.player, stations: async () => rows, report: () => {}, noise: shared.noise }, 0);
    tuner.select(0);
    await vi.waitFor(() => expect(calls).toEqual([rows[0].url]));
    const pick = shared.direct('https://pick.example/stream');
    p.finish('playing');
    expect(await pick).toBe('playing');
    await flush();
    expect(calls).toEqual([rows[0].url, 'https://pick.example/stream']);
    expect(p.state).toBe('playing');
  });

  it('keeps a tune still waiting to settle from starting after a pick', async () => {
    vi.useFakeTimers();
    const { p, calls } = fakePlayer();
    const noise = { start: vi.fn(), stop: vi.fn() };
    const shared = sharePlayer(p, () => noise);
    const tuner = new Tuner({ player: shared.player, stations: async () => [row('a')], report: () => {}, noise: shared.noise }, 700);
    tuner.select(0);
    void shared.direct('https://pick.example/stream');
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(calls).toEqual(['https://pick.example/stream']);
    expect(noise.start).not.toHaveBeenCalled();
  });
});
