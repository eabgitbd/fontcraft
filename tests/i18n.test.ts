import { describe, expect, it } from 'vitest';
import en from '@/app/i18n/en.json';
import bn from '@/app/i18n/bn.json';
import { detectLocale, translate, translatePlural } from '@/app/i18n/core';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('message tables', () => {
  it('Bengali has exactly the same keys as English', () => {
    expect(Object.keys(bn).sort()).toEqual(Object.keys(en).sort());
  });

  it('placeholders match between languages for every key', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(placeholders(bn[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('no message is empty', () => {
    for (const table of [en, bn]) for (const [k, v] of Object.entries(table)) expect(v.trim(), k).not.toBe('');
  });
});

describe('translate', () => {
  it('fills placeholders', () => {
    expect(translate('en', 'app.version', { version: '4.0.0+7' })).toBe('Version 4.0.0+7');
  });
  it('falls back to English for an unknown Bengali key, then to the key', () => {
    expect(translate('bn', 'definitely.missing')).toBe('definitely.missing');
  });
  it('leaves unknown placeholders untouched', () => {
    expect(translate('en', 'app.version', {})).toBe('Version {version}');
  });
  it('picks plural forms', () => {
    expect(translatePlural('en', 'dashboard.count', 1)).toBe('1 project');
    expect(translatePlural('en', 'dashboard.count', 3)).toBe('3 projects');
    expect(translatePlural('en', 'dashboard.count', 0)).toBe('0 projects');
    expect(translatePlural('bn', 'dashboard.count', 2)).toBe('2টি প্রকল্প');
  });
  it('detects Bengali from the browser language list', () => {
    expect(detectLocale(['bn-BD', 'en'])).toBe('bn');
    expect(detectLocale(['en-US'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });
});
