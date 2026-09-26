// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:8240', viewport: { width: 240, height: 292 }, deviceScaleFactor: 2 },
  webServer: { command: 'npm run dev', url: 'http://localhost:8240', reuseExistingServer: true },
});
