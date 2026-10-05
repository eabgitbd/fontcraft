import { describe, expect, it } from 'vitest';
import { BENGALI, BENGALI_NAMES, CHAR_SET_IDS, DIGITS, LATIN, PUNCT, PREVIEW_SAMPLES, charsForSet, charsForTab } from '@/app/charsets';

describe('character sets ported from v3', () => {
  it('has the v3 script sizes', () => {
    expect(LATIN).toHaveLength(52);
    expect(DIGITS).toHaveLength(10);
    expect(BENGALI).toHaveLength(76);
  });

  it('keeps the Bengali conjuncts as single entries', () => {
    for (const c of ['ক্ষ', 'জ্ঞ', 'ত্র', 'ন্ত', 'স্ত']) expect(BENGALI).toContain(c);
  });

  it('every set is free of duplicates', () => {
    for (const id of CHAR_SET_IDS) {
      const chars = charsForSet(id);
      expect(new Set(chars).size, id).toBe(chars.length);
    }
  });

  it('composes sets the way v3 mkChars did', () => {
    expect(charsForSet('latin')).toHaveLength(52);
    expect(charsForSet('bengali')).toHaveLength(76);
    expect(charsForSet('bengali-ext')).toHaveLength(86);
    expect(charsForSet('latin-ext')).toHaveLength(52 + 10 + PUNCT.length);
    expect(charsForSet('all')).toHaveLength(52 + 76 + 10 + PUNCT.length);
  });

  it('script tabs match their sources', () => {
    expect(charsForTab('digits')).toBe(DIGITS);
    expect(charsForTab('punct')).toBe(PUNCT);
  });

  it('carries the Bengali display names and preview sentences', () => {
    expect(BENGALI_NAMES['ক']).toBe('ব্যঞ্জন ক');
    expect(PREVIEW_SAMPLES.some((s) => s.includes('আমার সোনার বাংলা'))).toBe(true);
  });
});
