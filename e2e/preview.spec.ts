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
