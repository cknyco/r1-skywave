// Text folding for the voice matcher (src/voice/match.ts, Ruling 44): one function, so place names, city names,
// country names and transcripts are compared the same way.

// Letters that NFD leaves whole, and "&".
const LETTER: Record<string, string> = { ß: 'ss', ø: 'o', æ: 'ae', œ: 'oe', ł: 'l', đ: 'd', ı: 'i', þ: 'th', ð: 'd', '&': ' and ' };

/**
 * Lower case, no accents, every run of other characters one space, "saint"/"sainte" as "st"/"ste":
 * "São Paulo" → "sao paulo", "Ürümqi" → "urumqi", "St. Petersburg" and "Saint Petersburg" → "st petersburg".
 */
export function fold(s: string): string {
  return s.toLowerCase().replace(/[ßøæœłđıþð&]/g, c => LETTER[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(Boolean)
    .map(w => (w === 'saint' ? 'st' : w === 'sainte' ? 'ste' : w)).join(' ');
}
