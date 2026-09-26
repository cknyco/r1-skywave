import { describe, expect, it } from 'vitest';
import type { Places } from '../../src/data/store';
import { CITIES } from '../../src/voice/cities';
import { fold } from '../../src/voice/fold';
import { createMatcher } from '../../src/voice/match';

// A small world shaped like the real dataset: Tokyo's stations sit in "Aoi" and "Fujisawa", "New York" is a one-station
// place upstate next to "New York City", "Russia" is also a tiny place, and there are two Londons and two Parises.
// The last row holds places named like people and everyday words, as the real dataset has them (fix round 1, I2).
const P = [
  ['Aoi', 'JP', 35.77, 139.81, 1], ['Fujisawa', 'JP', 35.35, 139.44, 1], ['Osaka', 'JP', 34.64, 135.5, 1],
  ['New York City', 'US', 40.71, -74.01, 32], ['New York', 'US', 43.0, -75.0, 1], ['St. Louis', 'US', 38.63, -90.2, 2],
  ['Reading', 'US', 40.34, -75.93, 1],
  ['Russia', 'US', 40.2, -84.4, 1], ['Moscow', 'RU', 55.76, 37.62, 58],
  ['São Paulo', 'BR', -23.55, -46.63, 19], ['Rio de Janeiro', 'BR', -22.91, -43.17, 6],
  ['London', 'GB', 51.51, -0.13, 56], ['London', 'CA', 42.98, -81.25, 4],
  ['Paris', 'FR', 48.85, 2.35, 63], ['Paris', 'US', 33.66, -95.56, 1],
  ['Köln', 'DE', 50.94, 6.96, 35], ['Berlin', 'DE', 52.52, 13.4, 68], ['Nice', 'FR', 43.7, 7.27, 9],
  ['Jackson', 'US', 32.3, -90.18, 2], ['Houston', 'US', 29.76, -95.37, 6], ['Denver', 'US', 39.74, -104.99, 4],
  ['Van', 'TR', 38.5, 43.38, 1], ['Florence', 'IT', 43.77, 11.25, 2], ['Malé', 'MV', 4.18, 73.51, 2],
  ['Paradise', 'US', 36.1, -115.15, 1], ['Bath', 'GB', 51.38, -2.36, 1], ['Surprise', 'US', 33.63, -112.37, 1],
  ['Americana', 'BR', -22.74, -47.33, 1], ['Glasgow', 'GB', 55.86, -4.25, 7],
] as const;

const places: Places = {
  v: 't', n: P.length,
  name: P.map(p => p[0]), cc: P.map(p => p[1]),
  lat: Float32Array.from(P.map(p => p[2])), lon: Float32Array.from(P.map(p => p[3])),
  count: Uint16Array.from(P.map(p => p[4])), tz: P.map(() => ''),
};
const idx = (name: string, cc: string) => P.findIndex(p => p[0] === name && p[1] === cc);
const COUNTRY: Record<string, string> = {
  JP: 'Japan', US: 'United States', RU: 'Russia', BR: 'Brazil', GB: 'United Kingdom', CA: 'Canada', FR: 'France', DE: 'Germany',
};
const cities = 'Tokyo,JP,357,1397;New York City,US,407,-740;Kyoto,JP,350,1358;Beijing,CN,399,1164;Cologne,DE,509,70';
const m = createMatcher(places, cities, cc => COUNTRY[cc] ?? '');
const name = (i: number) => (i < 0 ? null : `${P[i][0]}, ${P[i][1]}`);
const at = (text: string, cc?: string) => name(m.match(text, cc));
const req = (text: string) => name(m.request(text));
const rep = (text: string) => name(m.reply(text));

describe('fold', () => {
  it('drops case, accents and punctuation, and reads saint as st', () => {
    expect(fold('São Paulo')).toBe('sao paulo');
    expect(fold('Ürümqi')).toBe('urumqi');
    expect(fold('  Köln!? ')).toBe('koln');
    expect(fold('St. Petersburg')).toBe(fold('Saint Petersburg'));
    expect(fold('Łódź')).toBe('lodz');
    expect(fold('Straße')).toBe('strasse');
    expect(fold('Bosnia & Herzegovina')).toBe('bosnia and herzegovina');
    expect(fold('İstanbul')).toBe('istanbul');
  });
});

describe('voice matcher (Ruling 44)', () => {
  it('finds places inside a request, longest phrase first', () => {
    expect(at('take me to Berlin')).toBe('Berlin, DE');
    expect(at('Rio de Janeiro please')).toBe('Rio de Janeiro, BR');
    expect(at('radio from São Paulo')).toBe('São Paulo, BR');
    expect(at('Taking you to Sao Paulo!')).toBe('São Paulo, BR');   // an LLM's plain-text answer
    expect(at('saint louis')).toBe('St. Louis, US');
  });

  it('resolves a big city without a place of its own to the place standing for it', () => {
    expect(at('take me to Tokyo')).toBe('Aoi, JP');                 // the biggest place within 50 km, the nearest on a tie
    expect(at('Take me to New York')).toBe('New York City, US');    // the alias beats the one-station place upstate
    expect(at('Kyoto')).toBe('Osaka, JP');                          // nothing within 50 km: the nearest within 150 km
    expect(at('Cologne')).toBe('Köln, DE');                         // an English name: same place by coordinates
  });

  it('reads a country as its biggest place, and a place-and-country phrase in that country', () => {
    expect(at('jazz from Brazil')).toBe('São Paulo, BR');
    expect(at('Dress from Brazil.')).toBe('São Paulo, BR');         // misheard genre, the country still counts
    expect(at('radio from Russia')).toBe('Moscow, RU');             // the country beats the one-station place "Russia"
    expect(at('take me to the USA')).toBe('New York City, US');
    expect(at('London Canada')).toBe('London, CA');
    expect(at('London')).toBe('London, GB');
    expect(at('Paris', 'US')).toBe('Paris, US');                   // an LLM intent's country picks among namesakes
  });

  it('leaves requests without a place to the LLM', () => {
    for (const t of ['play some jazz', 'take me somewhere nice', 'play something romantic', 'hello', 'I love this song',
      'Sorry, I could not find that.', 'south america', '']) expect(at(t), t).toBeNull();
  });

  it('gives a big city of a country without stations nothing', () => {
    expect(at('Beijing')).toBeNull();
  });

  it('reads a place name anywhere in an LLM\'s answer (match), where the LLM has already taken it for a place', () => {
    expect(at('I am reading a book')).toBe('Reading, US');
    expect(req('I am reading a book')).toBeNull();   // a spoken request: see below
  });

  it('never takes "surprise" or "americana" for a place', () => {
    for (const t of ['surprise me', 'play americana', 'Surprise', 'Americana']) expect(at(t), t).toBeNull();
  });
});

describe('spoken requests: the fast path (fix round 1, I2)', () => {
  it('keeps requests for a place fast: nothing or a cue before it, request words or a country after it', () => {
    expect(req('take me to Tokyo')).toBe('Aoi, JP');
    expect(req('Tokyo')).toBe('Aoi, JP');
    expect(req('Dress from Brazil.')).toBe('São Paulo, BR');
    expect(req('radio from Russia')).toBe('Moscow, RU');
    expect(req('London Canada')).toBe('London, CA');
    expect(req('take me to the UK')).toBe('London, GB');       // "the" between the cue and a country
    expect(req('Take me to New York')).toBe('New York City, US');
    expect(req('Rio de Janeiro please')).toBe('Rio de Janeiro, BR');
    expect(req('Berlin radio')).toBe('Berlin, DE');
    expect(req('what is on in Houston')).toBe('Houston, US');
  });

  it('leaves names of people, stations and everyday words that are also places to the LLM', () => {
    const texts = ['play Michael Jackson', 'play Whitney Houston', 'play John Denver', 'play Van Morrison', 'play Van Halen',
      'play Florence and the Machine', 'play a male singer', 'play Radio Paradise', 'play France Inter', 'music for reading',
      "I'm reading", "I'm in the bath", 'play Berlin'];
    for (const t of texts) {
      expect(at(t), t).not.toBeNull();   // match() finds a place in each
      expect(req(t), t).toBeNull();      // a request it is not
    }
  });
});

describe('an LLM\'s plain-text answer is read like a spoken request (fix round 2, N2)', () => {
  it('a refusal that repeats a name which is also a place does not jump', () => {
    const texts = ["Sorry, I can't play Michael Jackson, I can only find places.", 'Playing Michael Jackson radio',
      "I couldn't find a radio station for Whitney Houston.", 'Enjoy some music while reading!'];
    for (const t of texts) {
      expect(at(t), t).not.toBeNull();   // match() would have jumped
      expect(req(t), t).toBeNull();
    }
  });

  it('the usual answer shapes still land', () => {
    expect(req('Sure! Taking you to Paris.')).toBe('Paris, FR');
    expect(req('Taking you to São Paulo!')).toBe('São Paulo, BR');
    expect(req('Sure! Here is some rock from Germany')).toBe('Berlin, DE');
    expect(req('Okay, heading to London')).toBe('London, GB');
    expect(req('Tokyo it is!')).toBe('Aoi, JP');
    expect(req("Here's Berlin for you")).toBeNull();   // the cost: this one waits out the clock
  });
});

describe('an LLM\'s plain-text answer is read sentence by sentence (fix round 3, N3)', () => {
  it('an answer with a trailing sentence lands; a spoken request is still read whole', () => {
    const answers: [string, string][] = [
      ['Tuning in to Tokyo. Have fun!', 'Aoi, JP'],
      ['Okay, playing jazz from Paris, France. Enjoy the vibes!', 'Paris, FR'],
      ['Taking you to London, Canada! Have fun with the music.', 'London, CA'],
      ['You asked for jazz from Brazil. Here you go: São Paulo.', 'São Paulo, BR'],
    ];
    for (const [t, want] of answers) {
      expect(rep(t), t).toBe(want);
      expect(req(t), t).toBeNull();   // the fast path keeps request() on the whole text
    }
    expect(rep('Taking you to Berlin now, enjoy!')).toBe('Berlin, DE');   // "enjoy" is a stop word
    expect(rep('Sure! Taking you to Paris.')).toBe('Paris, FR');          // one sentence, as before
  });

  it('key-value and relaxed JSON text lands, and a country in another field still counts', () => {
    expect(rep('place: Paris, country: FR, genre: jazz')).toBe('Paris, FR');
    expect(rep('{place: Berlin, country: DE}')).toBe('Berlin, DE');
    expect(rep('Place: London. Country: Canada. Genre: jazz.')).toBe('London, CA');
  });

  it('a name with a full stop in it survives the split', () => {
    expect(rep('Taking you to St. Louis. Have fun!')).toBe('St. Louis, US');
    expect(rep('St. Louis. Have fun!')).toBe('St. Louis, US');
  });

  it('refusals stay refused, also with a trailing sentence', () => {
    const texts = ["Sorry, I can't play Michael Jackson, I can only find places.", 'Playing Michael Jackson radio',
      "I couldn't find a radio station for Whitney Houston.", 'Enjoy some music while reading!',
      "Sorry, I couldn't find any radio stations for Michael Jackson.",
      "I can't play specific artists like Michael Jackson, but here is some pop from the US.",
      "Sorry, I can't play Michael Jackson. Try another request!", "Here's Berlin for you. Have fun!"];
    for (const t of texts) {
      expect(at(t), t).not.toBeNull();   // match() would have jumped
      expect(rep(t), t).toBeNull();
    }
  });

  it('a refusal whose next sentence offers a place lands on that place', () => {
    expect(rep('Sorry, no Michael Jackson. Here is some pop from Brazil.')).toBe('São Paulo, BR');
    expect(rep('Sorry, no Michael Jackson, but here is some pop from Brazil.')).toBeNull();   // one sentence
  });
});

describe('a region after a comma is dropped from an LLM\'s answer (fix round 4, N4)', () => {
  it('a town with its state, province or nation lands on the town', () => {
    const answers: [string, string][] = [
      ['Taking you to Houston, Texas!', 'Houston, US'],
      ['Heading to Denver, Colorado.', 'Denver, US'],
      ["Here's some jazz from Jackson, Mississippi.", 'Jackson, US'],
      ['Taking you to Houston, Texas, USA!', 'Houston, US'],
      ['Sure! Taking you to Houston, Texas. Enjoy!', 'Houston, US'],
      ['Taking you to Denver, CO.', 'Denver, US'],
      ['Tuning in to Glasgow, Scotland.', 'Glasgow, GB'],
    ];
    for (const [t, want] of answers) {
      expect(req(t), t).toBeNull();   // request() alone refuses the region word
      expect(rep(t), t).toBe(want);
    }
  });

  it('the region is lost, so a town abroad of the same name wins', () => {
    expect(rep('Taking you to Paris, Texas!')).toBe('Paris, FR');
    expect(rep('Taking you to London, Ontario.')).toBe('London, GB');
  });

  it('refusals with a comma clause at the end stay refused', () => {
    const texts = ["Sorry, I can't play Michael Jackson, sorry!", "I couldn't find Whitney Houston, sorry.",
      'Playing Michael Jackson, enjoy!', 'Enjoy some music while reading, friend!',
      "Sorry, I can't find stations for Michael Jackson, unfortunately.",
      'Sorry, no Michael Jackson, but here is some pop from Brazil.'];
    for (const t of texts) expect(rep(t), t).toBeNull();
  });

  it('a long answer is read in about linear time', () => {
    // Before the cap, reply() tried every run of pieces: a 60-line list took seconds, and on the r1 blocked the UI.
    const list = Array.from({ length: 60 }, (_, k) => `${k + 1}. Some station with a long name, number ${k + 1}\n`).join('');
    const t0 = performance.now();
    expect(rep(list)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('the generated city list', () => {
  it('has capitals and big cities as "name,cc,lat×10,lon×10", no districts', () => {
    const entries = CITIES.split(';').map(e => e.split(','));
    expect(entries.length).toBeGreaterThan(600);
    for (const e of entries) {
      expect(e).toHaveLength(4);
      expect(e[1]).toMatch(/^[A-Z]{2}$/);
      expect(Math.abs(Number(e[2]))).toBeLessThanOrEqual(900);
      expect(Math.abs(Number(e[3]))).toBeLessThanOrEqual(1800);
    }
    const names = entries.map(e => e[0]);
    for (const c of ['Tokyo', 'New York City', 'Berlin', 'Canberra', 'Reykjavík']) expect(names).toContain(c);
    expect(names).not.toContain('Kowloon');   // PPLX districts are left out
  });
});
