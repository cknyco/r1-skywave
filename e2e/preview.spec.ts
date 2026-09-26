import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const place = (page: Page) => page.evaluate(() => (window as any).__preview.place() as number);
const wheel = (page: Page, ev: 'scrollUp' | 'scrollDown') => page.evaluate(e => window.dispatchEvent(new Event(e)), ev);

// Test runs are not listeners: keep them out of Radio Browser's click counts.
test.beforeEach(({ page }) => page.route(/\/json\/url\//, r => r.abort()));

test('sound preview: gate, wheel walk, station list, no radio.garden request', async ({ page }) => {
  const hosts: string[] = [];
  page.on('request', r => hosts.push(new URL(r.url()).hostname));
  await page.goto('/?place=Berlin');
  await page.click('#start');
  await expect(page.locator('#gate')).toBeHidden();
  await expect(page.locator('#preview .place')).toHaveText('Berlin');
  await expect(page.locator('#preview .where')).toHaveText(/^Germany · \d\d:\d\d$/);
  await expect(page.locator('#preview .count')).toHaveText(/^\d+ stations?$/);
  expect(await page.evaluate(() => (window as any).__preview.walkSize())).toBeGreaterThan(100);

  const berlin = await place(page);
  await wheel(page, 'scrollDown');
  await expect.poll(() => place(page)).not.toBe(berlin);
  await expect(page.locator('#preview .place')).not.toHaveText('Berlin');
  await wheel(page, 'scrollUp');
  await expect(page.locator('#preview .place')).toHaveText('Berlin');

  const list = page.locator('#preview .list');
  await page.click('#preview');
  await expect(list).toBeVisible();
  await expect(list.locator('.title')).toHaveText(/^Berlin · \d+ stations$/);
  await expect(list.locator('.row')).toHaveCount(7);
  await expect(list.locator('.row.sel')).toHaveCount(1);
  const sel = Number(await list.locator('.row.sel').getAttribute('data-i'));
  await wheel(page, 'scrollDown');
  await expect(list.locator('.row.sel')).toHaveAttribute('data-i', String(sel + 1));
  expect(await place(page)).toBe(berlin);   // the wheel moved the list, not the place
  await page.click('#preview');
  await expect(list).toBeHidden();

  await page.waitForTimeout(1500);          // let the settled tune reach the stream hosts
  expect(hosts).toContain('localhost');
  expect(hosts.filter(h => h === 'radio.garden' || h.endsWith('.radio.garden'))).toEqual([]);
});

test('voice: hold, transcript, LLM reply jumps to the place and saves it', async ({ page }) => {
  await page.addInitScript(() => {   // a stand-in for the r1 bridge and creationStorage
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
  const send = (m: object) => page.evaluate(msg => (window as any).onPluginMessage(msg), m);
  const status = page.locator('#preview .status');
  await page.goto('/?place=Berlin');
  await page.click('#start');
  await expect(page.locator('#preview .place')).toHaveText('Berlin');

  await wheel(page, 'scrollUp');
  await wheel(page, 'scrollDown');   // back on Berlin; only the voice path moves us from here
  await page.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
  await expect(status).toHaveText('listening…');
  await page.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
  await send({ message: 'stt', pluginId: 'p', data: JSON.stringify({ type: 'sttStarted' }) });
  await send({ type: 'sttEnded', transcript: 'Dress from Sao Paulo' });
  await expect(status).toHaveText('thinking…');
  const sent: string[] = await page.evaluate(() => (window as any).__sent);
  expect(sent.slice(0, 2)).toEqual(['voice:start', 'voice:stop']);
  const ask = JSON.parse(sent[2]);
  expect(ask.useLLM).toBe(true);
  expect(ask.message).toContain('Dress from Sao Paulo');

  await send({ message: 'ok', pluginId: 'p', data: '{"place":"Sao Paulo","country":"BR","genre":"jazz"}' });
  await expect(page.locator('#preview .place')).toHaveText('São Paulo');
  await expect(page.locator('#preview .where')).toHaveText(/^Brazil · \d\d:\d\d$/);
  await expect.poll(() => page.evaluate(() => {
    const v = (window as any).__store.get('last');
    return v ? JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(v), c => c.charCodeAt(0)))).name : null;
  })).toBe('São Paulo');

  await send({ message: '{"place":null,"country":null,"genre":"jazz"}' });
  await expect(status).toHaveText('no match');
  await expect(page.locator('#preview .place')).toHaveText('São Paulo');
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
  await page.goto('/?place=Berlin');
  await page.click('#start');
  // "Tuning…" (connecting) is enough: it already means the player is loading or playing, the two states
  // cancel() stops — waiting for a fully-live external stream here would make the test hostage to its uptime.
  await expect(page.locator('#preview .status')).toHaveText(/tuning…|live/, { timeout: 15000 });

  await page.evaluate(() => { (window as any).__order = []; });   // only what longPressStart itself does
  await page.evaluate(() => window.dispatchEvent(new Event('longPressStart')));

  const order: string[] = await page.evaluate(() => (window as any).__order);
  expect(order).toEqual(['audio:paused', 'handler:start']);   // stopped, then — only then — voice starts listening

  const audioState = await page.evaluate(() => (window as any).__preview.audio());
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
    const row = st.rows.find((r: unknown[]) => r[0] === idx && (r[3] as string).startsWith('https://') && !(r[3] as string).includes('radio.garden'));
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
  await expect(page.locator('#preview .place')).toHaveText('Berlin');
  await expect(page.locator('#preview .station')).toHaveText(saved.stationName, { timeout: 15000 });
});

test('I1: voice resume after a list pick actually plays again (not a parked, silent player)', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.CreationVoiceHandler = { postMessage: () => {} };
  });
  const status = page.locator('#preview .status');
  const list = page.locator('#preview .list');
  await page.goto('/?place=Berlin');
  await page.click('#start');
  await expect(page.locator('#preview .place')).toHaveText('Berlin');

  await page.click('#preview');
  await expect(list).toBeVisible();
  const pickedName = await list.locator('.row.sel').textContent();
  await page.evaluate(() => window.dispatchEvent(new Event('sideClick')));   // picks the selected row (playPick)
  await expect(list).toBeHidden();
  await expect(status).toHaveText('live', { timeout: 15000 });
  await expect(page.locator('#preview .station')).toHaveText(pickedName ?? '');

  await page.evaluate(() => window.dispatchEvent(new Event('longPressStart')));
  await expect(status).toHaveText('listening…');
  await page.evaluate(() => window.dispatchEvent(new Event('longPressEnd')));
  await page.evaluate(() => (window as any).onPluginMessage({ type: 'sttEnded' }));   // no transcript at all

  await expect(status).toHaveText('live', { timeout: 15000 });   // resumed, not stuck parked/silent
  await expect(page.locator('#preview .station')).toHaveText(pickedName ?? '');   // the same pick, not the place's top station
  const audioState = await page.evaluate(() => (window as any).__preview.audio());
  expect(audioState.paused).toBe(false);
  expect(audioState.src).not.toBe('');
});

test('N1: a retry hold never inherits the previous search\'s late reply', async ({ page }) => {
  test.setTimeout(45000);
  // Streams are faked (play() resolves, 'playing' fires 30 ms later) and nothing leaves localhost: across a 10s
  // wait, a real external stream's uptime is the wrong thing for this test to depend on.
  await page.route(u => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname), r => r.abort());
  await page.addInitScript(() => {
    const w = window as any;
    w.__sent = [];
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const el = this, src = el.src;
      if (src) setTimeout(() => { if (el.src === src) el.dispatchEvent(new Event('playing')); }, 30);
      return Promise.resolve();
    };
    w.PluginMessageHandler = { postMessage: (s: string) => w.__sent.push(s) };
    w.CreationVoiceHandler = { postMessage: (s: string) => w.__sent.push(`voice:${s}`) };
  });
  const send = (m: object) => page.evaluate(msg => (window as any).onPluginMessage(msg), m);
  const press = (e: 'longPressStart' | 'longPressEnd') => page.evaluate(n => window.dispatchEvent(new Event(n)), e);
  const audio = () => page.evaluate(() => (window as any).__preview.audio() as { paused: boolean; src: string });
  const status = page.locator('#preview .status');
  const where = page.locator('#preview .place');
  await page.goto('/?place=Berlin');
  await page.click('#start');
  await expect(status).toHaveText('live');
  const berlin = (await audio()).src;

  await press('longPressStart');
  await press('longPressEnd');
  await send({ type: 'sttEnded', transcript: 'radio from paris' });
  await expect(status).toHaveText('thinking…');
  await expect(status).toHaveText('live', { timeout: 12000 });   // no reply within 10s: the same station is back
  expect((await audio()).src).toBe(berlin);

  await press('longPressStart');                                 // retry, button still held
  await expect(status).toHaveText('listening…');
  await send({ message: 'ok', pluginId: 'p', data: '{"place":"Paris","country":"FR","genre":null}' });   // the first search's late reply
  await page.waitForTimeout(800);
  await expect(where).toHaveText('Berlin');
  expect((await audio()).src).toBe('');                          // nothing plays while the mic is open
  await expect(status).toHaveText('listening…');

  await press('longPressEnd');                                   // the retry's own search still goes through
  await send({ type: 'sttEnded', transcript: 'jazz from Sao Paulo' });
  await expect(status).toHaveText('thinking…');
  await send({ message: 'ok', pluginId: 'p', data: '{"place":"Sao Paulo","country":"BR","genre":"jazz"}' });
  await expect(where).toHaveText('São Paulo');
  const asks = await page.evaluate(() => ((window as any).__sent as string[]).filter(s => s.startsWith('{')).length);
  expect(asks).toBe(2);
});

test('screenshot for the user', async ({ page }) => {
  const path = process.env.PREVIEW_SCREENSHOT;
  test.skip(!path, 'set PREVIEW_SCREENSHOT=<file.png> to save one');
  await page.goto('/?place=Berlin');
  await page.click('#start');
  await expect(page.locator('#preview .place')).toHaveText('Berlin');
  await expect(page.locator('#preview .station.live')).toBeVisible({ timeout: 15000 }).catch(() => {});
  mkdirSync(dirname(path!), { recursive: true });
  await page.screenshot({ path: path! });
});
