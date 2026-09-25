import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('scaffold', () => {
  it('index.html declares the r1 viewport and no forbidden name', () => {
    const html = readFileSync('index.html', 'utf8');
    expect(html).toContain('width=240, initial-scale=1, user-scalable=no');
    expect(html.toLowerCase()).not.toContain('garden');
  });

  it('build output is a classic script, not a module', () => {
    const html = readFileSync('dist/index.html', 'utf8');
    expect(html).toMatch(/<script src="app\.js\?v=[0-9a-f]{8}"><\/script>/);
    expect(html).not.toContain('type="module"');
  });
});
