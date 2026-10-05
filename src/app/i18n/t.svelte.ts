import { settings } from '../stores/settings.svelte';
import { translate, translatePlural, type MessageKey } from './core';

/** Reactive translate: reads the current locale, so components re-render when it changes. */
export function t(key: MessageKey | (string & {}), vars?: Record<string, string | number>): string {
  return translate(settings.locale, key, vars);
}

export function tn(base: string, n: number, vars?: Record<string, string | number>): string {
  return translatePlural(settings.locale, base, n, vars);
}
