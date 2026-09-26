import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { NEIGHBOUR_PREFETCH, PREFETCH_DELAY_MS, SETTLE_MS } from '../src/config';
import { TILE_SOURCE } from '../src/map/tile-source';
import { minCountForZoom } from '../src/map/lod';
import { visibleTiles } from '../src/map/tiles';
import { buildWalk, stepWalk } from '../src/map/walk';
import { fold } from '../src/voice/fold';
import { fakeStreams, newStations, offline, TILE } from './net';

// The app at the r1's 240×292 CSS viewport (dpr 2). Nothing leaves localhost (e2e/net.ts): map tiles come from a
// fixture, streams are faked, and data/new.json is absent unless a test serves one.
const place = (page: Page) => page.evaluate(() => (window as any).__app.place() as number);
const fire = (page: Page, ev: string) => page.evaluate(e => window.dispatchEvent(new Event(e)), ev);
const send = (page: Page, m: object) => page.evaluate(msg => (window as any).onPluginMessage(msg), m);
const settled = (page: Page) => page.waitForFunction(() => !(window as any).__view.moving);
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.beforeEach(async ({ page }) => {
  await offline(page);
  await fakeStreams(page);
  await newStations(page);
});

async function tuneIn(page: Page, query = '?place=Berlin'): Promise<void> {
  await page.goto(`/${query}`);
  await page.click('#start');
  await expect(page.locator('#gate')).toBeHidden();
}

test('gate, Berlin on the map, wheel walk, station list and favourites, no radio.garden request', async ({ page }) => {
  const hosts: string[] = [];
  page.on('request', r => hosts.push(new URL(r.url()).hostname));
  const strip = page.locator('#strip');
  await page.goto('/?place=Berlin');
  await expect(page.locator('#start')).toHaveText('Tap to tune in');
  await expect(page.locator('#gate .hint')).toContainText('wheel: places');
  await page.click('#start');
  await expect(page.locator('#gate')).toBeHidden();
  await expect(strip.locator('.where')).toHaveText(/^Berlin · Germany · \d\d:\d\d$/);
  await expect(strip.locator('.name')).toHaveClass(/live/);   // the settle, then the (fake) stream
  await expect(page.locator('#ring')).toHaveClass('live');
  await expect(page.locator('#status')).toHaveText('live');
  const berlin = await place(page);
  expect(await page.evaluate(() => (window as any).__view.current)).toBe(berlin);
  expect(await page.evaluate(() => (window as any).__app.walkSize())).toBeGreaterThan(100);

  const step = await page.evaluate(() => {   // read in the same task as the dispatch: before any settle or stream
    window.dispatchEvent(new Event('scrollDown'));
    const text = (sel: string) => document.querySelector(sel)!.textContent;
    const w = window as any;
    return { place: w.__app.place(), current: w.__view.current, where: text('#strip .where'), name: text('#strip .name') };
  });
  expect(step.place).not.toBe(berlin);
  expect(step.current).toBe(step.place);
  expect(step.where).not.toMatch(/^Berlin ·/);
  expect(step.name).toMatch(/^\d+ stations?$/);   // the strip changes at once; the station follows after the settle
  await fire(page, 'scrollUp');
  await expect(strip.locator('.where')).toHaveText(/^Berlin ·/);
  await expect(strip.locator('.name')).toHaveClass(/live/);

  const list = page.locator('#list');
  await page.click('#strip');
  await expect(list).toBeVisible();
  await expect(list.locator('.title')).toHaveText(/^Berlin · \d+ stations$/);
  await expect(list.locator('.row')).toHaveCount(7);
  await expect(list.locator('.row.head')).toHaveText(['★ New stations worldwide (0)', '♥ My favourites (0)']);   // always there
  await expect(list.locator('.row.sel')).toHaveCount(1);
  const sel = Number(await list.locator('.row.sel').getAttribute('data-i'));
  await fire(page, 'scrollDown');
  await expect(list.locator('.row.sel')).toHaveAttribute('data-i', String(sel + 1));
  expect(await place(page)).toBe(berlin);   // the wheel moved the list, not the place

  await fire(page, 'longPressStart');       // hold: favourite
  await fire(page, 'longPressEnd');
  await expect(list.locator('.row.sel')).toHaveText(/^♥ /);
  await expect(list.locator('.row.head').nth(1)).toHaveText('♥ My favourites (1)');   // the header counts it at once
  const fav = (await list.locator('.row.sel').textContent())!.replace(/^♥ /, '');
  await page.click('#list');                // a tap on the list closes it
  await expect(list).toBeHidden();
  await page.click('#strip');
  await expect(list.locator('.row:not(.head)').first()).toHaveText(`♥ ${fav}`);   // favourites first, under the header rows
  await expect(list.locator('.row.head').nth(1)).toHaveText('♥ My favourites (1)');

  await fire(page, 'scrollDown');
  const pick = (await list.locator('.row.sel').textContent())!.replace(/^♥ /, '');
  await fire(page, 'sideClick');            // plays the selected station
  await expect(list).toBeHidden();
  await expect(strip.locator('.name')).toHaveText(pick);
  await expect(strip.locator('.name')).toHaveClass(/live/);

  expect(hosts).toContain('localhost');
  expect(hosts).toContain('tiles.maps.eox.at');   // requested (and answered from the fixture)
  expect(hosts.filter(h => h === 'radio.garden' || h.endsWith('.radio.garden'))).toEqual([]);
});

test('at globe zoom the wheel only visits places the map shows', async ({ page }) => {
  await tuneIn(page);
  await settled(page);   // the boot flight to the start place would otherwise put its own zoom back
  await page.evaluate(() => { const v = (window as any).__view; v.cam = { ...v.cam, z: 2 }; v.wake(); });
  for (let k = 0; k < 3; k++) {
    const before = await place(page);
    await fire(page, 'scrollDown');
    await expect.poll(() => place(page)).not.toBe(before);
    expect(await page.evaluate(() => (window as any).__app.places.count[(window as any).__app.place()])).toBeGreaterThanOrEqual(20);
  }
});

test('M3 minor M1: a wheel step in the middle of a far flight counts the places of the zoom it flies to', async ({ page, request }) => {
  // P3 fix round 1 (I3): the start is searched for in the served data, not assumed. It is the biggest place with a name
  // of its own (so ?place= finds it) whose next place on the walk at zoom 7 is not the next one at the zooms a dipping
  // camera passes (below 4: 5 stations or more, below 2.5: 20 or more).
  const P = await (await request.get('/data/places.json')).json();
  const walk = buildWalk(P.lon, P.lat);
  const next = (from: number, z: number) => stepWalk(walk, from, 1, i => P.count[i] >= minCountForZoom(z));
  const names = new Map<string, number>();
  for (const n of P.name as string[]) names.set(fold(n), (names.get(fold(n)) ?? 0) + 1);
  let start = -1;
  for (let i = 0; i < P.name.length; i++) {
    if (names.get(fold(P.name[i])) !== 1 || (start >= 0 && P.count[i] <= P.count[start])) continue;
    const n7 = next(i, 7);
    if (n7 >= 0 && next(i, 3) !== n7 && next(i, 2) !== n7) start = i;
  }
  expect(start).toBeGreaterThanOrEqual(0);
  await tuneIn(page, `?place=${encodeURIComponent(P.name[start])}`);
  expect(await place(page)).toBe(start);
  await settled(page);
  const lon = ((P.lon[start] + 300) % 360) - 180;   // 120° east: a far flight, the camera dips to the globe
  await page.evaluate(to => (window as any).__view.flyTo(to, 0, 7), lon);
  await page.waitForFunction(() => (window as any).__view.cam.z < 4);
  await fire(page, 'scrollDown');
  await expect.poll(() => place(page)).toBe(next(start, 7));
});

test('dragging the map tunes the place that settles under the ring', async ({ page }) => {
  await tuneIn(page);
  await expect(page.locator('#strip .where')).toHaveText(/^Berlin ·/);
  await settled(page);
  // The dot nearest the ring (other than Berlin's own), at least 12 px away: the drag starts at the ring's centre (the
  // ring lets pointers through to the map) and pulls that dot under it.
  const target = await page.evaluate(() => {
    const v = (window as any).__view, cx = v.w / 2, cy = v.h / 2;
    const dist = (d: any) => Math.hypot(d.x - cx, d.y - cy);
    const d = v.dots.filter((d: any) => d.i !== v.current && dist(d) >= 12 && Math.abs(d.x - cx) < cx - 10 && Math.abs(d.y - cy) < cy - 10)
      .sort((a: any, b: any) => dist(a) - dist(b))[0];
    return d ? { i: d.i, dx: cx - d.x, dy: cy - d.y, cx, cy, name: (window as any).__app.places.name[d.i] as string } : null;
  });
  expect(target).not.toBeNull();
  const t = target!;
  await page.mouse.move(t.cx, t.cy);
  await page.mouse.down();
  await page.mouse.move(t.cx + t.dx, t.cy + t.dy, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => place(page)).toBe(t.i);
  await expect(page.locator('#strip .where')).toHaveText(new RegExp(`^${esc(t.name)} ·`));
  await expect(page.locator('#strip .name')).toHaveClass(/live/);   // tuned once the map rested for SETTLE_MS
  await expect(page.locator('#list')).toBeHidden();                // a drag is not a tap
});

/** A stand-in for the r1 bridge and creationStorage, installed before the app's own script runs. */
async function fakeBridge(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any;
    w.__sent = [];
    w.__store = new Map();
    w.PluginMessageHandler = { postMessage: (s: string) => w.__sent.push(s) };
    w.CreationVoiceHandler = { postMessage: (s: string) => w.__sent.push(`voice:${s}`) };
    w.creationStorage = { plain: {
      getItem: (k: string) => Promise.resolve(w.__store.has(k) ? w.__store.get(k) : null),
      setItem: (k: string, v: string) => (/^[A-Za-z0-9+/=]*$/.test(v)
        ? Promise.resolve(void w.__store.set(k, v)) : Promise.reject(new Error('not base64'))),
    } };
  });
}
const asks = (page: Page) => page.evaluate(() => ((window as any).__sent as string[]).filter(s => s.startsWith('{')).length);

test('voice: hold, transcript, LLM reply flies to the place and saves it', async ({ page }) => {
  await fakeBridge(page);
  const status = page.locator('#status');
  const where = page.locator('#strip .where');
  await tuneIn(page);
  await expect(where).toHaveText(/^Berlin ·/);

  await fire(page, 'longPressStart');
  await expect(status).toHaveText('listening…');
  await fire(page, 'longPressEnd');
  await send(page, { message: 'stt', pluginId: 'p', data: JSON.stringify({ type: 'sttStarted' }) });
  await send(page, { type: 'sttEnded', transcript: 'Dress from the south' });   // names no place: the LLM is asked
  await expect(status).toHaveText('thinking…');
  const sent: string[] = await page.evaluate(() => (window as any).__sent);
  expect(sent.slice(0, 2)).toEqual(['voice:start', 'voice:stop']);
  const ask = JSON.parse(sent[2]);
  expect(ask.useLLM).toBe(true);
  expect(ask.message).toContain('Dress from the south');

  await send(page, { message: 'ok', pluginId: 'p', data: '{"place":"Sao Paulo","country":"BR","genre":"jazz"}' });
  await expect(where).toHaveText(/^São Paulo · Brazil · \d\d:\d\d$/);
  expect(await page.evaluate(() => (window as any).__view.moving)).toBe(true);   // an arc, not a jump cut
  await settled(page);
  const cam = await page.evaluate(() => {
    const a = (window as any).__app, v = (window as any).__view, p = a.place();
    return { z: v.cam.z, dLon: v.cam.lon - a.places.lon[p], dLat: v.cam.lat - a.places.lat[p], current: v.current, p };
  });
  expect(cam.current).toBe(cam.p);
  expect(cam.z).toBeGreaterThanOrEqual(7);
  expect(Math.abs(cam.dLon) + Math.abs(cam.dLat)).toBeLessThan(1e-3);
  await expect.poll(() => page.evaluate(() => {
    const v = (window as any).__store.get('last');
    return v ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v), c => c.charCodeAt(0)))).name : null;
  })).toBe('São Paulo');

  await send(page, { message: '{"place":null,"country":null,"genre":"jazz"}' });
  await expect(status).toHaveText('no match');
  await expect(where).toHaveText(/^São Paulo ·/);
});

test('Ruling 44: a transcript naming a place jumps at once, without asking the LLM; the About screen logs it', async ({ page }) => {
  await fakeBridge(page);
  const status = page.locator('#status');
  const where = page.locator('#strip .where');
  await tuneIn(page);
  await expect(status).toHaveText('live');

  await fire(page, 'longPressStart');
  await fire(page, 'longPressEnd');
  await send(page, { type: 'sttEnded', transcript: 'Dress from Sao Paulo' });
  await expect(where).toHaveText(/^São Paulo · Brazil ·/);
  await expect(status).not.toHaveText('thinking…');
  expect(await asks(page)).toBe(0);

  await fire(page, 'longPressStart');   // a big city with no place of that name: the place standing for it
  await fire(page, 'longPressEnd');
  await send(page, { type: 'sttEnded', transcript: 'take me to New York' });
  await expect(where).toHaveText(/^New York City · United States ·/);
  expect(await asks(page)).toBe(0);

  await page.dblclick('#status');
  const about = page.locator('#about');
  await expect(about).toBeVisible();
  await expect(about.locator('.diag')).toContainText('Voice log');
  await expect(about.locator('.diag')).toContainText('"transcript":"Dress from Sao Paulo"');
  await expect(about.locator('.diag')).toContainText('fast path: São Paulo, BR');
  await expect(about.locator('.diag')).toContainText('fast path: New York City, US');
  expect(await about.textContent()).not.toContain('"pluginId"');
});

test('Ruling 44: a slow LLM reply (20 s) still lands; plain text counts only when it asks for a place, so a refusal naming an artist never jumps', async ({ page }) => {
  test.setTimeout(60000);
  await fakeBridge(page);
  const status = page.locator('#status');
  const where = page.locator('#strip .where');
  await tuneIn(page);
  await expect(status).toHaveText('live');

  await fire(page, 'longPressStart');
  await fire(page, 'longPressEnd');
  await send(page, { type: 'sttEnded', transcript: 'something warm please' });
  await expect(status).toHaveText('thinking…');
  await send(page, { message: 'Processing your request', pluginId: 'p' });   // prose naming no place is not the answer
  // Fix round 2 (N2): read like a request, a refusal that repeats a name is no answer (never Jackson, US)
  await send(page, { message: "Sorry, I can't play Michael Jackson, I can only find places.", pluginId: 'p' });
  await page.waitForTimeout(20000);                                   // the old 10 s clock would have given up
  await expect(status).toHaveText('thinking…');
  await expect(where).toHaveText(/^Berlin ·/);
  await send(page, { message: 'Sure! Taking you to Lisbon. Have fun!', pluginId: 'p' });   // N3: read sentence by sentence
  await expect(where).toHaveText(/^Lisbon · Portugal ·/);
  await page.dblclick('#status');
  await expect(page.locator('#about .diag')).toContainText('text without a place: still waiting');
  await expect(page.locator('#about .diag')).toContainText('accepted: Lisbon, PT');
});

test('Ruling 37: voice search stops the radio before it starts listening', async ({ page }) => {
  // A fake CreationVoiceHandler, installed before the app's own script runs, plus a patched
  // HTMLMediaElement.pause() that both push into one array — so the relative order is unambiguous.
  await page.addInitScript(() => {
    const w = window as any;
    w.__order = [];
    const origPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      w.__order.push('audio:paused');
      return origPause.call(this);
    };
    w.CreationVoiceHandler = { postMessage: (s: string) => { if (s === 'start') w.__order.push('handler:start'); } };
  });
  await tuneIn(page);
  await expect(page.locator('#status')).toHaveText('live');

  await page.evaluate(() => { (window as any).__order = []; });   // only what longPressStart itself does
  await fire(page, 'longPressStart');

  const order: string[] = await page.evaluate(() => (window as any).__order);
  expect(order).toEqual(['audio:paused', 'handler:start']);   // stopped, then — only then — voice starts listening

  const audioState = await page.evaluate(() => (window as any).__app.audio());
  expect(audioState.paused).toBe(true);
  expect(audioState.src).toBe('');
});

test('Ruling 38: the gate offers to resume the exact station remembered from last time', async ({ page }) => {
  await page.goto('/');
  const saved = await page.evaluate(async () => {
    const places = await fetch('data/places.json').then(r => r.json());
    const idx = places.name.indexOf('Berlin');
    const cc = places.cc[idx];
    const st = await fetch(`data/st/${cc}.json`).then(r => r.json());
    const rows = st.rows.filter((r: unknown[]) => r[0] === idx && (r[3] as string).startsWith('https://') && !(r[3] as string).includes('radio.garden'));
    const row = rows[rows.length - 1];   // not the place's first station: a plain tune would not land on it
    return { place: idx, name: places.name[idx] as string, cc: cc as string, id: row[1] as string, stationName: row[2] as string };
  });
  await page.evaluate(
    s => localStorage.setItem('last', JSON.stringify({ place: s.place, name: s.name, cc: s.cc, id: s.id })),
    saved,
  );

  await page.reload();
  await expect(page.locator('#start')).toContainText('Tap to resume');
  await expect(page.locator('#start')).toContainText(saved.stationName);

  await page.click('#start');
  await expect(page.locator('#strip .where')).toHaveText(/^Berlin ·/);
  await expect(page.locator('#strip .name')).toHaveText(saved.stationName);
  await expect(page.locator('#strip .name')).toHaveClass(/live/);
});

test('I1: voice resume after a list pick plays the pick again (not a parked, silent player)', async ({ page }) => {
  await page.addInitScript(() => { (window as any).CreationVoiceHandler = { postMessage: () => {} }; });
  const status = page.locator('#status');
  const name = page.locator('#strip .name');
  const list = page.locator('#list');
  await tuneIn(page);
  await expect(status).toHaveText('live');

  await page.click('#strip');
  await expect(list).toBeVisible();
  await fire(page, 'scrollDown');   // another station than the one on air
  const picked = (await list.locator('.row.sel').textContent())!.replace(/^♥ /, '');
  await fire(page, 'sideClick');
  await expect(list).toBeHidden();
  await expect(name).toHaveText(picked);
  await expect(status).toHaveText('live');

  await fire(page, 'longPressStart');
  await expect(status).toHaveText('listening…');
  await fire(page, 'longPressEnd');
  await send(page, { type: 'sttEnded' });   // no transcript at all

  await expect(status).toHaveText('live');   // resumed, not stuck parked/silent
  await expect(name).toHaveText(picked);     // the same pick, not the place's top station
  const audioState = await page.evaluate(() => (window as any).__app.audio());
  expect(audioState.paused).toBe(false);
  expect(audioState.src).not.toBe('');
});

test('N1: a retry hold never inherits the previous search\'s late reply', async ({ page }) => {
  test.setTimeout(75000);
  await fakeBridge(page);
  const audio = () => page.evaluate(() => (window as any).__app.audio() as { paused: boolean; src: string });
  const status = page.locator('#status');
  const where = page.locator('#strip .where');
  await tuneIn(page);
  await expect(status).toHaveText('live');
  const berlin = (await audio()).src;

  await fire(page, 'longPressStart');
  await fire(page, 'longPressEnd');
  await send(page, { type: 'sttEnded', transcript: 'play me something romantic' });   // no place in it: the LLM is asked
  await expect(status).toHaveText('thinking…');
  await expect(status).toHaveText('live', { timeout: 28000 });   // no reply within 25s (Ruling 44): the same station is back
  expect((await audio()).src).toBe(berlin);

  await fire(page, 'longPressStart');                            // retry, button still held
  await expect(status).toHaveText('listening…');
  await send(page, { message: 'ok', pluginId: 'p', data: '{"place":"Paris","country":"FR","genre":null}' });   // the first search's late reply
  await page.waitForTimeout(800);
  await expect(where).toHaveText(/^Berlin ·/);
  expect((await audio()).src).toBe('');                          // nothing plays while the mic is open
  await expect(status).toHaveText('listening…');

  await fire(page, 'longPressEnd');                              // the retry's own search still goes through
  await send(page, { type: 'sttEnded', transcript: 'jazz from the south' });
  await expect(status).toHaveText('thinking…');
  await send(page, { message: 'ok', pluginId: 'p', data: '{"place":"Sao Paulo","country":"BR","genre":"jazz"}' });
  await expect(where).toHaveText(/^São Paulo ·/);
  expect(await asks(page)).toBe(2);
});

/** A data/new.json that matches the served places.json: the last playable station of the two biggest places after Berlin. */
async function newFixture(request: APIRequestContext) {
  const P = await (await request.get('/data/places.json')).json();
  const order = (P.count as number[]).map((_, i) => i).sort((a, b) => P.count[b] - P.count[a]);
  const stations: { id: string; name: string; place: number; placeName: string; cc: string; since: string; first: string }[] = [];
  for (const i of order) {
    if (P.name[i] === 'Berlin') continue;
    const st = await (await request.get(`/data/st/${P.cc[i]}.json`)).json();
    const rows = (st.rows as unknown[][]).filter(r => r[0] === i && String(r[3]).startsWith('https://') && !String(r[3]).includes('radio.garden'));
    if (rows.length < 2) continue;
    const r = [...rows].reverse().find(x => x[2] !== rows[0][2]);   // not the place's first station, nor a namesake
    if (!r) continue;
    stations.push({ id: String(r[1]), name: String(r[2]), place: i, placeName: P.name[i], cc: P.cc[i], since: '2026-09-26', first: String(rows[0][2]) });
    if (stations.length === 2) break;
  }
  return { v: 1, date: '2026-09-26', days: 14, stations };
}

test('Ruling 45: new stations worldwide from the header row; a pick flies there and plays that station', async ({ page, request }) => {
  const body = await newFixture(request);
  expect(body.stations).toHaveLength(2);
  await newStations(page, body);
  const list = page.locator('#list');
  await tuneIn(page);
  await expect(page.locator('#strip .name')).toHaveClass(/live/);

  await page.click('#strip');
  await expect(list).toBeVisible();
  await expect(list.locator('.row').first()).toHaveText('★ New stations worldwide (2)');
  await expect(list.locator('.row').first()).toHaveClass(/head/);
  await expect(list.locator('.title')).toHaveText(/^Berlin · \d+ stations$/);   // the header rows are not counted
  for (let k = 0; k < 10; k++) await fire(page, 'scrollUp');
  await expect(list.locator('.row.sel')).toHaveAttribute('data-i', '0');
  await fire(page, 'longPressStart');   // the header row is not a station: no favourite
  await fire(page, 'longPressEnd');
  await expect(list.locator('.row').first()).toHaveText('★ New stations worldwide (2)');

  await fire(page, 'sideClick');        // opens the new stations
  await expect(list.locator('.title')).toHaveText('New stations worldwide · 2');
  await expect(list.locator('.row')).toHaveText(body.stations.map(s => `${s.name} — ${s.placeName}, ${s.cc}`));
  await fire(page, 'scrollDown');
  await fire(page, 'sideClick');        // the second one: flies there and plays exactly it
  const s = body.stations[1];
  await expect(list).toBeHidden();
  await expect.poll(() => place(page)).toBe(s.place);
  await expect(page.locator('#strip .where')).toHaveText(new RegExp(`^${esc(s.placeName)} ·`));
  await expect(page.locator('#strip .name')).toHaveText(s.name);
  await expect(page.locator('#strip .name')).toHaveClass(/live/);
  expect(s.name === s.first).toBe(false);   // a plain tune of the place would have played another station
  await settled(page);
  await page.waitForTimeout(SETTLE_MS + 200);   // no settle armed by the jump may replace the station
  await expect(page.locator('#strip .name')).toHaveText(s.name);
  const v = await page.evaluate(() => ({ z: (window as any).__view.cam.z, current: (window as any).__view.current }));
  expect(v.current).toBe(s.place);
  expect(v.z).toBeGreaterThanOrEqual(7);
});

test('About: a double tap on the status line shows the credits and the voice log, the wheel scrolls, a tap or side click closes; the tile credit shows over tiles only', async ({ page }) => {
  const attr = page.locator('#attr');
  const about = page.locator('#about');
  await tuneIn(page);
  await expect(attr).toBeVisible();
  await expect(attr).toHaveText(TILE_SOURCE.attribution);

  await page.click('#status');
  await expect(about).toBeHidden();   // one tap is not enough
  await page.waitForTimeout(500);
  await page.dblclick('#status');
  await expect(about).toBeVisible();
  for (const s of ['Radio Browser (public domain)', 'GeoNames (CC BY 4.0)', 'EOX IT Services GmbH', 'Copernicus Sentinel data 2016',
    "NASA's Global Imagery Browse Services (GIBS)"]) await expect(about).toContainText(s);
  expect((await about.textContent())!.toLowerCase()).not.toContain('garden');
  await expect(about.locator('.diag')).toContainText('No voice search yet.');
  await page.click('#about');
  await expect(about).toBeHidden();
  await page.dblclick('#status');
  await expect(about).toBeVisible();
  const here = await place(page);
  const top = () => about.evaluate(e => e.scrollTop);
  expect(await top()).toBe(0);
  await fire(page, 'scrollDown');   // the wheel scrolls it (to the voice log) and moves nothing else
  await expect(about).toBeVisible();
  await expect.poll(top).toBeGreaterThan(0);
  expect(await place(page)).toBe(here);
  await fire(page, 'sideClick');    // any other input only closes it
  await expect(about).toBeHidden();
  expect(await place(page)).toBe(here);

  for (let z = 7; z > 3; z--) {   // zoom out to the globe with the − button
    await page.click('#zout');
    await settled(page);
  }
  expect(await page.evaluate(() => (window as any).__view.cam.z)).toBeCloseTo(3, 5);
  await expect(attr).toBeHidden();
  await page.click('#zin');
  await settled(page);
  await expect(attr).toBeVisible();
});

test('M3 minor M7: the longest status line and the tile credit never overlap', async ({ page }) => {
  await tuneIn(page);   // no CreationVoiceHandler here: a hold reports "voice unavailable"
  await expect(page.locator('#attr')).toBeVisible();
  await fire(page, 'longPressStart');
  await fire(page, 'longPressEnd');
  await expect(page.locator('#status')).toHaveText('voice unavailable');
  const boxes = await page.evaluate(() => ['status', 'attr', 'zoom', 'lists', 'strip'].map(id => {
    const r = document.getElementById(id)!.getBoundingClientRect();
    return { id, l: r.left, t: r.top, r: r.right, b: r.bottom };
  }));
  const overlap = (a: typeof boxes[0], b: typeof boxes[0]) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  for (const a of boxes) for (const b of boxes) if (a.id < b.id) expect(overlap(a, b), `${a.id} × ${b.id}`).toBe(false);
  for (const b of boxes) expect(b.r, b.id).toBeLessThanOrEqual(240);
});

/** The first playable station of the place called `name` (index, id and name), read from the served data. */
async function stationOf(request: APIRequestContext, name: string, nth = 0) {
  const P = await (await request.get('/data/places.json')).json();
  const i = (P.name as string[]).indexOf(name);
  const st = await (await request.get(`/data/st/${P.cc[i]}.json`)).json();
  const rows = (st.rows as unknown[][]).filter(r => r[0] === i && String(r[3]).startsWith('https://') && !String(r[3]).includes('radio.garden'));
  const r = rows[nth];
  return { place: i, cc: P.cc[i] as string, id: String(r[1]), name: String(r[2]), first: String(rows[0][2]) };
}

test('Ruling 47: favourites worldwide: add in a list, the ♥ list flies there and plays exactly it, hold removes it', async ({ page, request }) => {
  const list = page.locator('#list');
  const name = page.locator('#strip .name');
  await tuneIn(page);
  await expect(name).toHaveClass(/live/);

  await page.click('#strip');
  await expect(list.locator('.row.head').nth(1)).toHaveText('♥ My favourites (0)');
  await fire(page, 'scrollDown');   // not the station on air
  const fav = (await list.locator('.row.sel').textContent())!;
  await fire(page, 'longPressStart');
  await fire(page, 'longPressEnd');
  await expect(list.locator('.row.sel')).toHaveText(`♥ ${fav}`);
  await page.click('#list');
  await expect(list).toBeHidden();

  const munich = await stationOf(request, 'Munich');
  await page.evaluate(p => (window as any).__view.select(p), munich.place);   // somewhere else first
  await expect(page.locator('#strip .where')).toHaveText(/^Munich ·/);
  await expect(name).toHaveClass(/live/);

  await page.click('#bfav');        // the ♥ map button
  await expect(list).toBeVisible();
  await expect(list.locator('.title')).toHaveText('My favourites · 1');
  await expect(list.locator('.row')).toHaveText([`${fav} — Berlin, DE`]);
  await expect(list.locator('.hint')).toHaveText('side: play · hold: remove · tap: close');
  await fire(page, 'sideClick');    // flies to Berlin and plays exactly that station
  await expect(list).toBeHidden();
  await expect(page.locator('#strip .where')).toHaveText(/^Berlin ·/);
  await expect(name).toHaveText(fav);
  await expect(name).toHaveClass(/live/);
  await page.waitForTimeout(SETTLE_MS + 300);   // no settle may replace it with the place's first station
  await expect(name).toHaveText(fav);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('favs2')!));
  expect(saved.v).toBe(2);
  expect(saved.items).toEqual([expect.objectContaining({ name: fav, placeName: 'Berlin', cc: 'DE' })]);

  await page.click('#strip');       // the place list, on the station on air; up to the ♥ header row
  await expect(list).toBeVisible();
  for (let k = 0; k < 10; k++) await fire(page, 'scrollUp');
  await fire(page, 'scrollDown');
  await expect(list.locator('.row.sel')).toHaveText('♥ My favourites (1)');
  await fire(page, 'sideClick');
  await expect(list.locator('.title')).toHaveText('My favourites · 1');
  await fire(page, 'longPressStart');   // hold removes it
  await fire(page, 'longPressEnd');
  await expect(list.locator('.title')).toHaveText('My favourites · 0');
  await expect(list.locator('.empty')).toHaveText(['No favourites yet. Hold the side button on a station in a list to add it.']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('favs2')!).items)).toEqual([]);
});

test('Ruling 47: favourites saved as bare ids before P3 are kept and filled in once their country loads', async ({ page, request }) => {
  const berlin = await stationOf(request, 'Berlin', 2);
  const tokyoLike = 'not-a-station-anymore';
  await page.addInitScript(ids => { if (!localStorage.getItem('favs2')) localStorage.setItem('favs', JSON.stringify(ids)); }, [berlin.id, tokyoLike]);
  const list = page.locator('#list');
  await tuneIn(page);
  await expect(page.locator('#strip .name')).toHaveClass(/live/);   // Berlin's chunk has loaded
  await page.click('#bfav');
  await expect(list.locator('.row')).toHaveText([`${berlin.name} — Berlin, DE`, 'Saved station · place unknown']);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('favs2')!));
  expect(saved.items.map((f: { id: string }) => f.id)).toEqual([berlin.id, tokyoLike]);   // none dropped
  await fire(page, 'scrollDown');
  await fire(page, 'sideClick');    // an unresolved one cannot fly anywhere
  await expect(page.locator('#status')).toHaveText('place unknown');
  await expect(page.locator('#strip .where')).toHaveText(/^Berlin ·/);
});

test('Ruling 45: the ★ map button opens the new stations; an empty list explains itself with the date of the data', async ({ page }) => {
  await newStations(page, { v: 1, date: '2026-09-26', days: 14, stations: [] });
  const list = page.locator('#list');
  await tuneIn(page);
  await page.click('#bnew');
  await expect(list.locator('.title')).toHaveText('New stations worldwide · 0');
  await expect(list.locator('.empty')).toHaveText(['No new stations yet. The list fills every night.', 'Last update: 2026-09-26']);
  await fire(page, 'sideClick');    // nothing to play
  await expect(list).toBeVisible();
  await page.click('#list');
  await expect(list).toBeHidden();
});

test('Ruling 46: once the map rests, the wheel\'s next and previous places get their tiles', async ({ page }) => {
  const tiles: string[] = [];
  await page.route('https://tiles.maps.eox.at/**', r => { tiles.push(r.request().url()); return r.fulfill({ path: TILE, contentType: 'image/jpeg' }); });
  await tuneIn(page);
  for (let k = 0; k < 3; k++) { await page.click('#zin'); await settled(page); }   // zoom 10: the neighbours lie off this view
  await fire(page, 'scrollDown');
  await settled(page);
  const mark = tiles.length;
  const own = await page.evaluate(() => { const v = (window as any).__view; return { cam: { ...v.cam }, w: v.w, h: v.h }; });
  expect(own.cam.z).toBeCloseTo(10, 5);
  const view = visibleTiles(own.cam, own.w, own.h, TILE_SOURCE.maxZ, 2);
  const mine = new Set(view.spots.map(t => TILE_SOURCE.url(view.z, t.x, t.y)));
  await page.waitForTimeout(PREFETCH_DELAY_MS + 1000);
  const extra = [...new Set(tiles.slice(mark))].filter(u => !mine.has(u));
  console.log(`neighbour prefetch: ${extra.length} tiles beyond the ${mine.size} of the view`);
  expect(extra.length).toBeGreaterThan(0);
  expect(extra.length).toBeLessThanOrEqual(2 * NEIGHBOUR_PREFETCH);
});
