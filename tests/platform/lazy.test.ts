import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { lazyImport } from '../../src/platform/lazy';

describe('lazyImport (a lazily loaded entry next to app.js)', () => {
  afterEach(() => vi.unstubAllGlobals());
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  // The page's base URL is a folder holding one built entry, as dist/ holds cities.js next to index.html.
  const dir = mkdtempSync(join(tmpdir(), 'skywave-lazy-'));
  writeFileSync(join(dir, 'list.mjs'), 'export const CITIES = "Tokyo,JP,357,1397";\n');
  const page = () => vi.stubGlobal('document', { baseURI: pathToFileURL(`${dir}/index.html`).href });

  it('imports the module at a URL relative to the page', async () => {
    page();
    await expect(lazyImport<{ CITIES: string }>('list.mjs')).resolves.toMatchObject({ CITIES: 'Tokyo,JP,357,1397' });
  });

  it('rejects with Error("load failed") when the file cannot be loaded', async () => {
    page();
    await expect(lazyImport('missing.mjs')).rejects.toThrow(/^load failed$/);
  });
});
