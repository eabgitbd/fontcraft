import { detectLocale, type Locale } from '../i18n/core';

export type Theme = 'system' | 'dark' | 'light';
const KEY = 'fc4.settings';

type Saved = { locale?: Locale; theme?: Theme };

function read(): Saved {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : {};
  } catch {
    return {};
  }
}

/** UI preferences only (language, theme). Project data lives in IndexedDB, never here. */
class SettingsStore {
  locale = $state<Locale>('en');
  theme = $state<Theme>('system');

  constructor() {
    const saved = read();
    this.locale = saved.locale === 'bn' || saved.locale === 'en' ? saved.locale : detectLocale(navigator.languages ?? [navigator.language ?? 'en']);
    this.theme = saved.theme === 'dark' || saved.theme === 'light' ? saved.theme : 'system';
    this.apply();
  }

  setLocale(locale: Locale): void {
    this.locale = locale;
    this.persist();
    this.apply();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.persist();
    this.apply();
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ locale: this.locale, theme: this.theme } satisfies Saved));
    } catch {
      /* preferences are best effort */
    }
  }

  private apply(): void {
    const root = document.documentElement;
    root.lang = this.locale;
    if (this.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', this.theme);
  }
}

export const settings = new SettingsStore();
