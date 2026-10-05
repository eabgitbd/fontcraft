import { Capacitor } from '@capacitor/core';
import type { Platform } from './types';
import { createWebPlatform } from './web';

export type { Platform, SaveResult } from './types';

let cached: Platform | null = null;

/** Picks the web or Android implementation once, at runtime. The native one is a lazy chunk. */
export async function initPlatform(): Promise<Platform> {
  if (cached) return cached;
  cached = Capacitor.isNativePlatform() ? (await import('./android')).createAndroidPlatform() : createWebPlatform();
  return cached;
}

/** Synchronous accessor for code that runs after `initPlatform()` resolved (all of the UI). */
export function platform(): Platform {
  if (!cached) throw new Error('Platform used before initPlatform() finished');
  return cached;
}

/** Test helper. */
export function setPlatformForTests(p: Platform | null): void {
  cached = p;
}
