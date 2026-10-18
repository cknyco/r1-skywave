// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: {
    baseURL: 'http://localhost:8240', viewport: { width: 240, height: 292 }, deviceScaleFactor: 2,
    headless: true, launchOptions: { args: ['--mute-audio'] },   // never a visible or audible browser
    channel: process.env.PW_CHANNEL,   // unset in CI (Playwright's own Chromium); `chrome` locally: the installed Chrome, no download
  },
  webServer: { command: 'pnpm run dev', url: 'http://localhost:8240', reuseExistingServer: true },
});
