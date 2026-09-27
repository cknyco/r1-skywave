import { expect, type Page } from '@playwright/test';

/**
 * Ruling 49: the wheel is the volume until the ✈ button turns fly mode on. This taps ✈ only when fly mode is off,
 * since a second tap would end it, and waits for the lit button. Fly mode then lasts FLY_MS of rest after the tap or
 * the last wheel step.
 */
export async function fly(page: Page): Promise<void> {
  const btn = page.locator('#bfly');
  if (!/\bon\b/.test((await btn.getAttribute('class')) ?? '')) await btn.click();
  await expect(btn).toHaveClass(/\bon\b/);
}
