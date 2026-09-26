// Ruling 44: the voice fast path. Finds the place a transcript (or an LLM's plain-text reply) names, without asking the
// LLM: a place of the dataset, one of the world's big cities (src/voice/cities.ts), or a country, which means its
// biggest place. Words are folded (case, accents, punctuation) and tried as phrases, longest first, so "new york" wins
// over "york" and "rio de janeiro" over "rio". Filler, genre and common words never match on their own ("take me
// to", "jazz", "music", "nice"): a place named "Nice" or "Music" is then left to the LLM.
//
// One phrase can name several things: "russia" is a one-station place and a country (Moscow, 58 stations), "new york"
// a one-station place upstate and the big city (New York City, 32). Every candidate of a phrase counts and the one
// with the most stations wins. Across phrases, a place or city beats a country ("Paris France" is Paris, in France if
// the dataset has one there), then the longer phrase, then the bigger place.
//
// The dataset names a place after the town its stations sit in, so a big city resolves by its coordinates: the place
// of the same name within 50 km, else the biggest place of that country within 50 km (the nearest on a tie), else the
// nearest within 150 km, else the country's biggest place ("Beijing" with no Chinese place near it is China).
//
// Fix round 1 (I2): about 250 place names are ordinary English words or also people's names, so a spoken request only
// jumps when the words around the place make it a request for that place (request(), see Matcher). "play Michael
// Jackson", "play Radio Paradise" and "music for reading" go to the LLM, which says "no match" and resumes. An intent's
// place is read as before (match()): the LLM has already taken it for a place.
//
// Fix round 2 (N2): an LLM's plain-text answer goes through request() too. A refusal repeats the name it could not
// play ("Sorry, I can't play Michael Jackson"), and match() would take that for Jackson, US. The answers that do name a
// place read as requests ("Sure! Taking you to Lisbon.", "Tokyo it is!", "Here is some rock from Germany"); the cost is
// that "Here's Berlin for you" names none and the search runs out its 25 s clock.
//
// Fix round 3 (N3): an answer is often more than one sentence ("Tuning in to Tokyo. Have fun!") or a list of fields
// ("place: Lisbon, country: PT"), and request() refuses a place that anything but request words follows. So reply()
// reads an LLM's plain text as runs of consecutive sentence pieces (split after . ! ? ; : and line breaks, never
// at commas or hyphens, which names hold), longest first, and takes the first run that reads as a request. The whole
// text comes first, so a country in a later sentence still counts. A refusal stays one sentence and stays refused; a
// refusal whose next sentence offers another place ("Sorry, no Michael Jackson. Here is some pop from Brazil.") lands
// on that place. "enjoy" joined STOP, so "Taking you to Lisbon now, enjoy!" lands as well. Spoken requests keep
// request() on the whole transcript.
//
// Fix round 4 (N4): a chatty model names a US, Canadian, Australian or UK town with its region after a comma
// ("Taking you to Austin, Texas!"), and request() refused the region word. When a run reads as no request, reply()
// drops a trailing comma clause of up to three words and tries again, at most three times. The region is lost, so
// "Paris, Texas" lands on the bigger Paris, in France, and "London, Ontario" on London, GB: a place instead of a
// 25 s wait. A refusal keeps its artist before the comma ("Playing Michael Jackson, enjoy!") and stays refused.
// Runs are the whole text, then at most 4 pieces, so a 40-line list costs about as much as 40 sentences, not their
// cube. "Scotland" and "Wales" stay place names, not aliases of GB: the dataset has places named so, and an alias
// would send "Taking you to Scotland!" to London, the biggest place of GB.
import type { Places } from '../data/store';
import { distanceKm } from '../geo/sphere';
import { CITIES } from './cities';
import { fold } from './fold';

/** Never a match on their own: request fillers, radio and genre words, and common words that are also place names. */
const STOP = new Set((
  'take me to the a an of and or in on at for from with by into near around play playing plays radio radios station '
  + 'stations channel channels fm am music song songs listen listening hear want wanna would like please can could you '
  + 'your my i id im lets let us go going get give put show find tune tuned fly travel visit somewhere anywhere '
  + 'something some any place city town country world local live now today tonight what whats where is it its there '
  + 'here this that best good great nice new old big little top hits most normal golden popular favorite favourite '
  + 'news talk sport sports weather jazz rock pop classical classic blues metal folk techno house dance hip hop rap '
  + 'reggae soul funk disco latin electronic ambient chill lounge oldies christian gospel indie alternative punk salsa '
  + 'samba bossa nova tango opera kids children religious trance dub drum bass grunge instrumental piano acoustic '
  + 'romantic love party college university independent public community english spanish french german surprise '
  + 'americana enjoy'
).split(' '));
/** Right before a place in a request: "take me to Tokyo", "Dress from Brazil", "in Reading". */
const CUE = new Set(['to', 'from', 'in', 'near', 'around', 'at']);
/** May stand between a cue and a country: "take me to the UK". */
const ARTICLE = new Set(['the', 'a', 'an']);

/** Spoken names of countries next to their English display names (Intl.DisplayNames), and of big cities. */
const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US', america: 'US', 'united states of america': 'US', 'the states': 'US', uk: 'GB', britain: 'GB',
  'great britain': 'GB', england: 'GB', holland: 'NL', 'the netherlands': 'NL', turkey: 'TR', turkiye: 'TR',
  'czech republic': 'CZ', czechia: 'CZ', korea: 'KR', 'south korea': 'KR', 'north korea': 'KP', 'ivory coast': 'CI',
  burma: 'MM', macedonia: 'MK', swaziland: 'SZ', 'cape verde': 'CV', congo: 'CD', drc: 'CD', bosnia: 'BA',
  trinidad: 'TT', palestine: 'PS', 'hong kong': 'HK', macau: 'MO', macao: 'MO', uae: 'AE', emirates: 'AE',
  vatican: 'VA', russia: 'RU', vietnam: 'VN', laos: 'LA', syria: 'SY', iran: 'IR', bolivia: 'BO', venezuela: 'VE',
  tanzania: 'TZ', moldova: 'MD', 'east timor': 'TL',
};
const CITY_ALIASES: Record<string, string> = {
  'new york': 'new york city', nyc: 'new york city', rio: 'rio de janeiro', bombay: 'mumbai', calcutta: 'kolkata',
  madras: 'chennai', saigon: 'ho chi minh city', peking: 'beijing', kiev: 'kyiv', cologne: 'koln',
  'washington dc': 'washington', vegas: 'las vegas', 'mexico df': 'mexico city',
};
/** Consumed without a match, so "south america" is not the United States. */
const NOTHING = new Set(['south america', 'north america', 'latin america', 'central america']);

interface City { cc: string; lat: number; lon: number }
/** A phrase of the text that names something: its first word, its length in words, the name it stands for. */
interface Hit { i: number; n: number; phrase: string; country: string | null }

export interface Matcher {
  /**
   * The place `text` names, or -1: for an intent's place, which the LLM has already taken for a place. `cc` (ISO 3166-1
   * alpha-2), when given, prefers places in that country.
   */
  match(text: string, cc?: string | null): number;
  /**
   * The place a spoken request names (fix round 1, I2), or -1: the place match() finds, but only when after it come
   * request words or a country, and before it nothing or a cue (to, from, in, near, around, at) right before it, with
   * the/a/an allowed between for a country. "Tokyo", "take me to the UK", "Dress from Brazil.", "London Canada",
   * "Tokyo radio" and "Sure! Taking you to Lisbon." are requests; "play Michael Jackson", "play Van Morrison", "I'm in
   * the bath" and "Sorry, I can't play Michael Jackson" are not.
   */
  request(text: string): number;
  /**
   * The place an LLM's plain-text answer names, or -1 (fix rounds 2 and 3, N2 and N3): request() over runs of
   * consecutive sentence pieces, the whole text first, then shorter runs from the start. "Tuning in to Tokyo. Have
   * fun!", "place: Lisbon, country: PT" and "Taking you to St. Louis. Have fun!" land; "Sorry, I couldn't find any
   * radio stations for Michael Jackson." does not.
   */
  reply(text: string): number;
}

let regions: Intl.DisplayNames | null = null;

function englishName(cc: string): string {
  try {
    regions ??= new Intl.DisplayNames(['en'], { type: 'region' });
    return regions.of(cc) ?? '';
  } catch {
    return '';
  }
}

export function createMatcher(places: Places, cities = CITIES, countryName: (cc: string) => string = englishName): Matcher {
  const byName = new Map<string, number[]>();   // folded place name → its places
  const big = new Map<string, number>();        // country → its biggest place
  const byCountry = new Map<string, string>();  // folded country name → code
  const byCity = new Map<string, City[]>();     // folded big-city name → cities
  let maxN = 1;
  const key = (k: string) => { maxN = Math.max(maxN, Math.min(6, k.split(' ').length)); return k; };

  const folded = places.name.map(fold);
  for (let i = 0; i < places.n; i++) {
    const k = key(folded[i]);
    const l = byName.get(k);
    if (l) l.push(i); else byName.set(k, [i]);
    const b = big.get(places.cc[i]);
    if (b === undefined || places.count[i] > places.count[b]) big.set(places.cc[i], i);
  }
  for (const cc of big.keys()) {
    const name = countryName(cc);
    for (const n of [name.replace(/\s*\(.*\)/, ''), name.match(/\((.*)\)/)?.[1] ?? '', name.replace(/ SAR China$/, '')]) {
      const k = fold(n);
      if (k) byCountry.set(key(k), cc);
    }
  }
  for (const [alias, cc] of Object.entries(COUNTRY_ALIASES)) if (big.has(cc)) byCountry.set(key(alias), cc);
  for (const e of cities.split(';')) {
    const [name, cc, lat, lon] = e.split(',');
    if (!big.has(cc)) continue;
    const k = key(fold(name));
    const c = { cc, lat: Number(lat) / 10, lon: Number(lon) / 10 };
    const l = byCity.get(k);
    if (l) l.push(c); else byCity.set(k, [c]);
  }
  for (const a of Object.keys(CITY_ALIASES)) key(a);

  const bigger = (a: number, b: number) => (b < 0 || (a >= 0 && places.count[a] > places.count[b]) ? a : b);

  /** The dataset place standing for a big city (see the header). Kept once found: reply() may ask for it many times. */
  const cityMemo = new Map<City, number>();
  function cityPlace(c: City, name: string): number {
    let p = cityMemo.get(c);
    if (p === undefined) cityMemo.set(c, p = scanCity(c, name));
    return p;
  }
  function scanCity(c: City, name: string): number {
    let named = -1, best = -1, bestD = Infinity, near = -1, nearD = 150;
    for (let i = 0; i < places.n; i++) {
      if (places.cc[i] !== c.cc) continue;
      const d = distanceKm(c.lon, c.lat, places.lon[i], places.lat[i]);
      if (d <= 50 && folded[i] === name) named = bigger(i, named);
      if (d <= 50 && (best < 0 || places.count[i] > places.count[best] || (places.count[i] === places.count[best] && d < bestD))) {
        best = i;
        bestD = d;
      }
      if (d < nearD) { near = i; nearD = d; }
    }
    return named >= 0 ? named : best >= 0 ? best : near >= 0 ? near : big.get(c.cc) ?? -1;
  }

  /** Every place a phrase names, in country `cc` when it has one there; -1 when it names none. */
  function placeOf(phrase: string, cc: string | null): number {
    const cands: number[] = [...(byName.get(phrase) ?? [])];
    for (const c of byCity.get(phrase) ?? []) cands.push(cityPlace(c, phrase));
    const inCc = cc ? cands.filter(i => i >= 0 && places.cc[i] === cc) : [];
    return (inCc.length ? inCc : cands).reduce(bigger, -1);
  }

  /** The place `text` names (-1 if none), the phrase that won, and every phrase that named something. */
  function find(text: string, cc: string | null): { best: number; win: Hit | null; tokens: string[]; found: Hit[] } {
    const tokens = fold(text).split(' ').filter(Boolean);
    const used = new Array<boolean>(tokens.length).fill(false);
    const found: Hit[] = [];
    for (let n = Math.min(maxN, tokens.length); n >= 1; n--) {
      for (let i = 0; i + n <= tokens.length; i++) {
        if (used.slice(i, i + n).some(Boolean)) continue;
        const words = tokens.slice(i, i + n);
        if (words.every(w => STOP.has(w))) continue;
        const phrase = words.join(' ');
        const alias = CITY_ALIASES[phrase];
        const country = byCountry.get(phrase) ?? null;
        const known = NOTHING.has(phrase) || country !== null || alias !== undefined
          || byName.has(phrase) || byCity.has(phrase);
        if (!known || (phrase.replace(/ /g, '').length < 3 && country === null)) continue;
        used.fill(true, i, i + n);
        if (!NOTHING.has(phrase)) found.push({ i, n, phrase: alias ?? phrase, country });
      }
    }
    const inCountry = cc ?? found.find(f => f.country)?.country ?? null;
    let best = -1, bestRank = -1, win: Hit | null = null;
    for (const f of found) {
      const named = placeOf(f.phrase, inCountry);
      const p = [named, f.country ? big.get(f.country) ?? -1 : -1].reduce(bigger, -1);
      if (p < 0) continue;
      const rank = (named >= 0 ? 1e9 : 0) + f.n * 1e6 + places.count[p];
      if (rank > bestRank) { best = p; bestRank = rank; win = f; }
    }
    return { best, win, tokens, found };
  }

  /** Whether the words around the winning phrase make the text a request for it (see Matcher.request). */
  function meant(tokens: string[], found: Hit[], win: Hit): boolean {
    const country = new Array<boolean>(tokens.length).fill(false);
    for (const f of found) if (f.country) country.fill(true, f.i, f.i + f.n);
    for (let k = win.i + win.n; k < tokens.length; k++) if (!country[k] && !STOP.has(tokens[k])) return false;
    let k = win.i - 1;
    if (win.country) while (k >= 0 && ARTICLE.has(tokens[k])) k--;
    return k < 0 || CUE.has(tokens[k]);
  }

  function request(text: string): number {
    const { best, win, tokens, found } = find(text, null);
    return win && meant(tokens, found, win) ? best : -1;
  }

  return {
    match(text, cc = null) {
      return find(text, cc).best;
    },
    request,
    reply(text) {
      // A piece keeps its closing mark, commas and hyphens stay inside; "St. Louis" splits, a longer run rejoins it.
      // The whole text, then runs of at most 4 pieces: a long list stays about linear.
      const pieces = text.split(/(?<=[.!?;:\n])/);
      for (let len = pieces.length; len >= 1; len = len === pieces.length ? Math.min(len - 1, 4) : len - 1) {
        for (let i = 0; i + len <= pieces.length; i++) {
          let run = pieces.slice(i, i + len).join('');
          for (let k = 0; k < 3; k++) {
            const p = request(run);
            if (p >= 0) return p;
            // Drop a short trailing comma clause: "Austin, Texas!" is read as "Austin!".
            const cut = run.replace(/,\s*(?:[^\s,.!?;:]+\s*){1,3}([.!?;:\s]*)$/u, '$1');
            if (cut === run) break;
            run = cut;
          }
        }
      }
      return -1;
    },
  };
}
