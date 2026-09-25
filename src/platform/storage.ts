import { fromB64, toB64 } from './b64';

export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

interface PlainStore {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
}

type Host = { creationStorage?: { plain?: PlainStore }; localStorage?: Pick<Storage, 'getItem' | 'setItem'> };

/** Looks up the platform store on every call, so a harness can inject it after page load. */
export function createStore(host: Host = globalThis as unknown as Host): KV {
  const plain = () => host.creationStorage?.plain;
  return {
    async get(k) {
      const cs = plain();
      if (cs) {
        const v = await cs.getItem(k);
        return v == null ? null : fromB64(v);
      }
      try { return host.localStorage?.getItem(k) ?? null; } catch { return null; }
    },
    async set(k, v) {
      const cs = plain();
      if (cs) return cs.setItem(k, toB64(v));
      try { host.localStorage?.setItem(k, v); } catch { /* storage full or denied: keep running */ }
    },
  };
}

export async function loadJson<T>(kv: KV, key: string, fallback: T): Promise<T> {
  try {
    const s = await kv.get(key);
    return s == null ? fallback : (JSON.parse(s) as T);
  } catch {
    return fallback;
  }
}

export async function saveJson(kv: KV, key: string, value: unknown): Promise<void> {
  await kv.set(key, JSON.stringify(value));
}
