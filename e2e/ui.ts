import { expect, type Page } from '@playwright/test';

/**
 * The app at `query` (Berlin by default), past the "Tap to tune in" gate: start() has bound the controls and the drag.
 * The start's whole globe is skipped (?intro=0): the map is at the place from the tap on (e2e/intro.spec.ts has the globe).
 */
export async function tuneIn(page: Page, query = '?place=Berlin'): Promise<void> {
  await page.goto(`/${noIntro(query)}`);
  await page.click('#start');
  await expect(page.locator('#gate')).toBeHidden();
}

/**
 * Ruling 49: the wheel is the volume until the ✈ button turns fly mode on. This taps ✈ only when fly mode is off,
 * since a second tap would end it, and waits for the lit button. Fly mode then lasts FLY_MS of rest after the tap or
 * the last wheel step: 30 s since the user's decision of 2026-11-08, longer than a test's wheel steps take, so in a test
 * it ends only by a second tap, a list, About or a voice hold. The one test that lets it run out (app.spec, "FLY_MS of
 * rest later") jumps Playwright's clock over it.
 */
export async function fly(page: Page): Promise<void> {
  const btn = page.locator('#bfly');
  if (!/\bon\b/.test((await btn.getAttribute('class')) ?? '')) await btn.click();
  await expect(btn).toHaveClass(/\bon\b/);
}

/** `query` with intro=0 added, so the start skips the whole globe and the dive (src/app/intro.ts). */
export function noIntro(query: string): string {
  return query.includes('intro=') ? query : `${query}${query.includes('?') ? '&' : '?'}intro=0`;
}
