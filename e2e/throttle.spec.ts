import { expect, test } from '@playwright/test';

// The r1 is roughly 6-10x slower than a desktop (Ruling 36). This checks the wheel walk still
// updates the place name promptly under that load, not just at full desktop speed.
// Test runs are not listeners: keep them out of Radio Browser's click counts.
test.beforeEach(({ page }) => page.route(/\/json\/url\//, r => r.abort()));

test('wheel walk changes place within 500ms at 6x CPU throttling', async ({ page }) => {
  test.setTimeout(60000);   // generous overall budget; the per-step budget below stays tight

  await page.goto('/?place=Berlin');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });

  await page.click('#start');
  await expect(page.locator('#gate')).toBeHidden({ timeout: 15000 });
  await expect(page.locator('#preview .place')).toHaveText('Berlin', { timeout: 15000 });

  for (let i = 0; i < 5; i++) {
    // Dispatch the event and poll __preview.place() from inside the same page.evaluate, so no CDP
    // round trip falls inside the measured window — a slow handler is timed, not the bridge to it.
    const step = await page.evaluate(() => new Promise<{ ms: number; changed: boolean }>(resolve => {
      const before = (window as any).__preview.place();
      const t0 = performance.now();
      window.dispatchEvent(new Event('scrollDown'));
      const check = () => {
        const ms = performance.now() - t0;
        const changed = (window as any).__preview.place() !== before;
        if (changed || ms >= 500) resolve({ ms, changed });
        else setTimeout(check, 10);
      };
      check();
    }));
    test.info().annotations.push({ type: 'step-ms', description: step.ms.toFixed(1) });
    expect(step.changed).toBe(true);
    expect(step.ms).toBeLessThan(500);
  }

  await cdp.detach().catch(() => {});
});
