import { describe, expect, it } from 'vitest';
import { findPlace, genreSearchUrl, intentPrompt, readReply } from '../../src/voice/intent';
import type { Places } from '../../src/data/store';

const places = {
  n: 3, lat: new Float32Array(3), lon: new Float32Array(3), count: Uint16Array.from([4, 90, 12]),
  name: ['São Paulo', 'São Paulo', 'Tokyo'], cc: ['PT', 'BR', 'JP'], tz: ['', '', ''], v: 'v',
} as Places;

const TOKYO = { place: 'Tokyo', country: null, genre: null };

describe('intent', () => {
  it('matches place names ignoring accents and case, preferring the bigger place', () => {
    expect(findPlace(places, { place: 'sao paulo', country: null, genre: null })).toBe(1);
    expect(findPlace(places, { place: 'São Paulo', country: 'PT', genre: null })).toBe(0);
    expect(findPlace(places, { place: 'Atlantis', country: null, genre: null })).toBe(-1);
  });

  it('builds an https-only, geo-tagged genre search', () => {
    const url = genreSearchUrl({ place: null, country: 'BR', genre: 'jazz' });
    expect(url).toContain('tag=jazz');
    expect(url).toContain('countrycode=BR');
    expect(url).toContain('is_https=true');
    expect(url).toContain('has_geo_info=true');
  });

  it('tells the LLM the transcript is from imperfect speech recognition and may be misheard', () => {
    const p = intentPrompt('Dress from Brazil');
    expect(p).toMatch(/speech recognition/i);
    expect(p).toContain('"Dress from Brazil"');
    expect(p).toContain('jazz from Brazil');
  });

  it('reads a bridge status message as status, not as an empty-fields intent', () => {
    expect(readReply({ data: '{"type":"sttStarted"}' })).toEqual({ kind: 'status', type: 'sttStarted' });
  });
});

describe('readReply (Ruling 44: tolerant replies)', () => {
  it('finds the intent in data or message, bare, inside prose, or as an escaped JSON string', () => {
    expect(readReply({ data: '{"place":"Tokyo","country":null,"genre":null}' })).toEqual({ kind: 'intent', intent: TOKYO });
    expect(readReply({ message: 'Sure: {"place":"Tokyo","country":null,"genre":null} Enjoy!' })).toEqual({ kind: 'intent', intent: TOKYO });
    expect(readReply({ data: JSON.stringify('{"place":"Tokyo","country":null,"genre":null}') })).toEqual({ kind: 'intent', intent: TOKYO });
  });

  it('opens nested envelopes (data inside data, message inside JSON) up to three levels', () => {
    const inner = JSON.stringify({ place: 'Tokyo', country: 'jp', genre: null });
    expect(readReply({ data: JSON.stringify({ message: inner }) })).toEqual({ kind: 'intent', intent: { ...TOKYO, country: 'JP' } });
    expect(readReply({ data: JSON.stringify({ data: JSON.stringify({ reply: inner }) }) })).toMatchObject({ kind: 'intent' });
    const deep = JSON.stringify(JSON.stringify(JSON.stringify(JSON.stringify(inner))));
    expect(readReply({ data: deep }).kind).not.toBe('intent');   // a fourth wrapped string is not opened
  });

  it('reads "null" strings and blanks as null fields; an all-null answer is an intent reply that names nothing', () => {
    const m = { message: 'ok', data: '{"place":"null","country":"","genre":null}' };
    expect(readReply(m)).toEqual({ kind: 'intent', intent: { place: null, country: null, genre: null } });
    expect(readReply({ message: 'Sure! {"place":null,"country":"BR","genre":"jazz"} Enjoy' }))
      .toEqual({ kind: 'intent', intent: { place: null, country: 'BR', genre: 'jazz' } });
  });

  it('tells a status message from an answer, even next to a human-readable message', () => {
    expect(readReply({ message: 'STT started', pluginId: 'p', data: '{"type":"sttStarted"}' } as never))
      .toEqual({ kind: 'status', type: 'sttStarted' });
  });

  it('keeps a plain-text answer as text, for the local matcher', () => {
    expect(readReply({ message: 'Taking you to Lisbon!' })).toEqual({ kind: 'text', text: 'Taking you to Lisbon!' });
    expect(readReply({ data: '{not json' })).toEqual({ kind: 'text', text: '{not json' });
  });

  it('ignores our own prompt echoed back by the bridge, and empty messages', () => {
    expect(readReply({ message: intentPrompt('take me to Tokyo') })).toEqual({ kind: 'none' });
    expect(readReply({})).toEqual({ kind: 'none' });
    expect(readReply({ message: '  ', data: '' })).toEqual({ kind: 'none' });
  });
});
