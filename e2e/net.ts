import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

/** One 256 px tile (a crop of the NASA globe texture) answers every map tile request: no test reaches EOX. */
export const TILE = fileURLToPath(new URL('./fixtures/tile.jpg', import.meta.url));
const EOX = 'tiles.maps.eox.at';
const local = (host: string) => host === 'localhost' || host === '127.0.0.1';

/**
 * Nothing leaves localhost. Map tiles come from the fixture; every other outside request (stream hosts, Radio
 * Browser's click counter) is aborted, so a test run is never a listener. `onTile` counts the tiles served.
 */
export async function offline(page: Page, onTile: () => void = () => {}): Promise<void> {
  await page.route(u => !local(u.hostname) && u.hostname !== EOX, r => r.abort());
  await page.route(`https://${EOX}/**`, r => { onTile(); return r.fulfill({ path: TILE, contentType: 'image/jpeg' }); });
}

/**
 * A stream "plays" 30 ms after play() and loads nothing: the Player sees 'playing', no stream host is asked, and
 * `paused` reads false from play() until pause().
 */
export async function fakeStreams(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const on = new WeakSet<HTMLMediaElement>();
    const pause = HTMLMediaElement.prototype.pause;
    Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
      configurable: true,
      get(this: HTMLMediaElement) { return !on.has(this); },
    });
    HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
      on.delete(this);
      return pause.call(this);
    };
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const el = this, src = el.src;
      if (src) {
        on.add(el);
        setTimeout(() => { if (el.src === src) el.dispatchEvent(new Event('playing')); }, 30);
      }
      return Promise.resolve();
    };
  });
}

/** data/new.json as a test needs it: absent (404) unless a body is given. The dev server may or may not have one. */
export async function newStations(page: Page, body?: object): Promise<void> {
  await page.route('**/data/new.json', r => (body ? r.fulfill({ json: body }) : r.fulfill({ status: 404, body: '' })));
}
