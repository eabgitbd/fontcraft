import en from './en.json';
import bn from './bn.json';

export type Locale = 'en' | 'bn';
export type MessageKey = keyof typeof en;

export const LOCALES: readonly { id: Locale; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'bn', label: 'বাংলা' },
];

const TABLES: Record<Locale, Record<string, string>> = { en, bn };

/** Looks up a message, falling back to English, then to the key itself. `{name}` placeholders are filled from `vars`. */
export function translate(locale: Locale, key: MessageKey | (string & {}), vars?: Record<string, string | number>): string {
  const raw = TABLES[locale][key] ?? TABLES.en[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Picks `.one` or `.other` using Intl plural rules. */
export function translatePlural(locale: Locale, base: string, n: number, vars?: Record<string, string | number>): string {
  const rule = new Intl.PluralRules(locale).select(n);
  const key = `${base}.${rule === 'one' ? 'one' : 'other'}`;
  return translate(locale, key, { n, ...vars });
}

export function detectLocale(languages: readonly string[]): Locale {
  return languages.some((l) => l.toLowerCase().startsWith('bn')) ? 'bn' : 'en';
}
