import { describe, expect, it } from 'vitest';
import { fromB64, toB64 } from '../../src/platform/b64';
import { createStore, loadJson, saveJson } from '../../src/platform/storage';

function fakeCreationStorage() {
  const m = new Map<string, string>();
  return {
    plain: {
      async getItem(k: string) { return m.has(k) ? m.get(k)! : null; },
      async setItem(k: string, v: string) {
        if (!/^[A-Za-z0-9+/=]*$/.test(v)) throw new Error('not base64');
        m.set(k, v);
      },
    },
    raw: m,
  };
}

describe('b64', () => {
  it('round-trips non-Latin text', () => {
    const s = 'Радио Рекорд · 東京FM · راديو · Rádio 969';
    expect(fromB64(toB64(s))).toBe(s);
  });
});

describe('storage', () => {
  it('uses creationStorage with base64 values when present', async () => {
    const cs = fakeCreationStorage();
    const kv = createStore({ creationStorage: cs } as never);
    await saveJson(kv, 'fav', [{ name: '東京FM' }]);
    expect(cs.raw.get('fav')).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(await loadJson(kv, 'fav', [])).toEqual([{ name: '東京FM' }]);
  });

  it('falls back to localStorage and survives a throwing localStorage', async () => {
    const kv = createStore({ localStorage: { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } } } as never);
    await saveJson(kv, 'x', 1);
    expect(await loadJson(kv, 'x', 42)).toBe(42);
  });

  it('returns the fallback for corrupt JSON', async () => {
    const m = new Map([['x', '{oops']]);
    const kv = createStore({ localStorage: { getItem: (k: string) => m.get(k) ?? null, setItem: () => {} } } as never);
    expect(await loadJson(kv, 'x', 'fb')).toBe('fb');
  });
});
