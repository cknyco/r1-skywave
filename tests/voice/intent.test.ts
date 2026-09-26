import { describe, expect, it } from 'vitest';
import { findPlace, genreSearchUrl, intentPrompt, isIntentReply, parseIntent } from '../../src/voice/intent';
import type { Places } from '../../src/data/store';

const places = {
  n: 3, lat: new Float32Array(3), lon: new Float32Array(3), count: Uint16Array.from([4, 90, 12]),
  name: ['São Paulo', 'São Paulo', 'Tokyo'], cc: ['PT', 'BR', 'JP'], tz: ['', '', ''], v: 'v',
} as Places;

describe('intent', () => {
  it('parses JSON from data.data, data.message, or text with extra words', () => {
    expect(parseIntent({ data: '{"place":"Tokyo","country":null,"genre":null}' })?.place).toBe('Tokyo');
    expect(parseIntent({ message: 'Sure! {"place":null,"country":"BR","genre":"jazz"} Enjoy' })?.genre).toBe('jazz');
    expect(parseIntent({ message: 'no json here' })).toBeNull();
  });

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

  it('returns null for a bridge status message, not an empty-fields intent', () => {
    expect(parseIntent({ data: '{"type":"sttStarted"}' })).toBeNull();
  });

  it('counts an all-null reply as an answer, a status message or plain text not', () => {
    expect(isIntentReply({ message: 'ok', data: '{"place":null,"country":null,"genre":null}' })).toBe(true);
    expect(isIntentReply({ message: 'Sure: {"place":"Tokyo","country":null,"genre":null}' })).toBe(true);
    expect(isIntentReply({ message: 'stt', data: '{"type":"sttStarted"}' })).toBe(false);
    expect(isIntentReply({ message: 'no json here' })).toBe(false);
    expect(isIntentReply({ data: '{not json' })).toBe(false);
  });
});
