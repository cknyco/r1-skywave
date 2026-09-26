import { RB_BASE } from '../config';
import type { Places } from '../data/store';
import type { PluginMessage } from '../platform/r1';
import { fold } from './fold';

export interface Intent { place: string | null; country: string | null; genre: string | null }

export function intentPrompt(transcript: string): string {
  return 'You turn a radio listening request into JSON. The request text comes from imperfect speech recognition '
    + 'and may contain misheard words (for example, "Dress from Brazil" probably means "jazz from Brazil"); '
    + 'infer the most plausible radio request. Request: "' + transcript.replace(/"/g, "'") + '". '
    + 'Reply ONLY with JSON of the form {"place": city name in English or null, '
    + '"country": ISO 3166-1 alpha-2 code or null, "genre": one lowercase music or talk genre or null}.';
}

/**
 * What a bridge message is (Ruling 44): an intent (JSON with place/country/genre, however deeply wrapped), a plain-text
 * answer, or a status message to ignore. The r1 delivers status as {message:"STT started", pluginId, data:
 * "{\"type\":\"sttStarted\"}"}; an LLM reply may put its JSON in `data` or `message`, inside prose, as an escaped JSON
 * string, or inside another envelope with its own data/message. Wrappers are opened up to three levels deep.
 */
export type Reply =
  | { kind: 'intent'; intent: Intent }
  | { kind: 'text'; text: string }
  | { kind: 'status'; type: string }
  | { kind: 'none' };

const INTENT_KEYS = ['place', 'country', 'genre'];
const INNER = ['data', 'message', 'text', 'content', 'reply', 'response', 'result', 'answer'];
const PROMPT_START = 'You turn a radio listening request';   // the bridge echoing our own request back is not an answer

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() && v.trim() !== 'null' ? v.trim() : null);

function toIntent(o: Record<string, unknown>): Intent {
  const country = str(o.country);
  return { place: str(o.place), country: country ? country.toUpperCase() : null, genre: str(o.genre) };
}

/** A string that is JSON, or has a JSON object inside it ("Sure! {...} Enjoy"); undefined when it is neither. */
function json(s: string): unknown {
  const t = s.trim();
  if (/^[{["]/.test(t)) {
    try { return JSON.parse(t); } catch { /* maybe prose around an object */ }
  }
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  try { return JSON.parse(m[0]); } catch { return undefined; }
}

interface Found { intent?: Intent; status: string | null; texts: string[] }

/** `depth` counts the JSON strings opened so far; a fourth level is not opened. */
function visit(v: unknown, depth: number, out: Found): void {
  if (v == null) return;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s || s.startsWith(PROMPT_START)) return;
    const j = json(s);
    if (j === undefined) out.texts.push(s);
    else if (depth < 3) visit(j, depth + 1, out);
    return;
  }
  if (typeof v !== 'object' || Array.isArray(v)) return;
  const o = v as Record<string, unknown>;
  if (INTENT_KEYS.some(k => k in o)) { out.intent ??= toIntent(o); return; }
  const inner = INNER.filter(k => o[k] != null);
  if (typeof o.type === 'string' && !inner.length) { out.status ??= o.type; return; }   // {"type":"sttStarted"}
  for (const k of inner) visit(o[k], depth, out);
}

export function readReply(msg: PluginMessage): Reply {
  const out: Found = { status: null, texts: [] };
  visit(msg.data, 0, out);
  visit(msg.message, 0, out);
  if (out.intent) return { kind: 'intent', intent: out.intent };
  if (out.status !== null) return { kind: 'status', type: out.status };   // e.g. "STT started" next to {"type":"sttStarted"}
  return out.texts.length ? { kind: 'text', text: out.texts.join(' ') } : { kind: 'none' };
}

export function findPlace(places: Places, intent: Intent): number {
  if (!intent.place) return -1;
  const q = fold(intent.place);
  let best = -1, bestScore = -1;
  for (let i = 0; i < places.n; i++) {
    const name = fold(places.name[i]);
    const exact = name === q ? 2 : name.startsWith(q) ? 1 : 0;
    if (!exact) continue;
    const countryOk = !intent.country || places.cc[i] === intent.country ? 1 : 0;
    const score = countryOk * 1e6 + exact * 1e5 + places.count[i];
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

export function genreSearchUrl(intent: Intent, server = RB_BASE): string {
  const p = new URLSearchParams({
    tag: intent.genre ?? '', has_geo_info: 'true', is_https: 'true', hidebroken: 'true',
    order: 'clickcount', reverse: 'true', limit: '20',
  });
  if (intent.country) p.set('countrycode', intent.country);
  return `${server}/json/stations/search?${p}`;
}
