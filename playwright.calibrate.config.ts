// playwright.calibrate.config.ts: the white model's calibration (e2e/calibrate.measure.ts), outside the e2e suite.
// PW_CHANNEL=chrome pnpm exec playwright test -c playwright.calibrate.config.ts
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({ ...base, testMatch: '**/calibrate.measure.ts' });
