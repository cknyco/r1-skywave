import { RB_BASE } from '../config';
import type { Places } from '../data/store';
import type { PluginMessage } from '../platform/r1';

export interface Intent { place: string | null; country: string | null; genre: string | null }

export function intentPrompt(transcript: string): string {
  return 'You turn a radio listening request into JSON. The request text comes from imperfect speech recognition '
    + 'and may contain misheard words (for example, "Dress from Brazil" probably means "jazz from Brazil"); '
    + 'infer the most plausible radio request. Request: "' + transcript.replace(/"/g, "'") + '". '
    + 'Reply ONLY with JSON of the form {"place": city name in English or null, '
    + '"country": ISO 3166-1 alpha-2 code or null, "genre": one lowercase music or talk genre or null}.';
}

export function parseIntent(msg: PluginMessage): Intent | null {
  for (const text of [msg.data, msg.message]) {
    if (!text) continue;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) continue;
    try {
      const j = JSON.parse(m[0]) as Partial<Intent>;
      const place = j.place ?? null, country = j.country ? String(j.country).toUpperCase() : null, genre = j.genre ?? null;
      if (place === null && country === null && genre === null) continue; // e.g. a bridge status message, not an intent
      return { place, country, genre };
    } catch {
      // try the next field
    }
  }
  return null;
}

/**
 * Whether a bridge message answers intentPrompt at all, including a reply of all nulls (the LLM found nothing, which
 * parseIntent returns as null). A status message such as {"type":"sttStarted"} is not an answer. The voice session
 * counts answers to tell whose reply is whose, so a real reply it failed to count would eat the next search's reply.
 */
export function isIntentReply(msg: PluginMessage): boolean {
  for (const text of [msg.data, msg.message]) {
    const m = text?.match(/\{[\s\S]*\}/);
    if (!m) continue;
    try {
      const j: unknown = JSON.parse(m[0]);
      if (j && typeof j === 'object' && ('place' in j || 'country' in j || 'genre' in j)) return true;
    } catch {
      // try the next field
    }
  }
  return false;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

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
