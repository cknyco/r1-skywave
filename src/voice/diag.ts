// Ruling 44 (d): on-device diagnostics. Neither the shape nor the timing of the LLM's reply on the user's r1 is known,
// so the app keeps the last bridge events of voice searches and shows them in the About screen, where the user can
// photograph them. Each line: milliseconds since the latest voice start, the kind, and the start of the event as JSON
// (the plugin id left out: it identifies the installation, not the event).

import type { PluginMessage } from '../platform/r1';
import type { Reply } from './intent';

export type DiagKind = 'voice' | 'sttStarted' | 'sttEnded' | 'llm-sent' | 'llm-reply' | 'result' | 'other';

export interface DiagEntry { t: number; kind: DiagKind; text: string }

const MAX_TEXT = 80;

/** A JSON dump of `v` without `pluginId`, control characters as spaces, at most 80 characters. */
export function sanitize(v: unknown): string {
  let s: string;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v, (k, x: unknown) => (k === 'pluginId' ? undefined : x)) ?? String(v);
  } catch {
    s = String(v);
  }
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, MAX_TEXT);
}

/** The kind of an incoming bridge message, given what readReply() made of it. */
export function kindOf(m: PluginMessage, r: Reply): DiagKind {
  if (m.type === 'sttEnded') return 'sttEnded';
  if (m.type === 'sttStarted' || (r.kind === 'status' && r.type === 'sttStarted')) return 'sttStarted';
  return r.kind === 'intent' || r.kind === 'text' ? 'llm-reply' : 'other';
}

/** Ring buffer of the last `max` events. `now` is injectable for tests. */
export class Diag {
  private items: DiagEntry[] = [];
  private t0: number;

  constructor(private max = 12, private now: () => number = () => performance.now()) {
    this.t0 = now();
  }

  /** A voice search started: later times count from here. */
  start(): void {
    this.t0 = this.now();
    this.push('voice', 'start');
  }

  push(kind: DiagKind, v: unknown): void {
    this.items.push({ t: Math.round(this.now() - this.t0), kind, text: sanitize(v) });
    if (this.items.length > this.max) this.items.shift();
  }

  entries(): DiagEntry[] {
    return [...this.items];
  }

  /** Oldest first: "+1234 sttEnded {"type":"sttEnded","transcript":"take me to Tokyo"}". */
  lines(): string[] {
    return this.items.map(e => `+${e.t} ${e.kind} ${e.text}`);
  }
}
