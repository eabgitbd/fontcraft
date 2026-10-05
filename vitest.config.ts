import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: { '@': resolve(here, 'src') },
    // Svelte must resolve to its browser build so components can mount under jsdom.
    conditions: ['browser'],
  },
  define: {
    __REPO_URL__: JSON.stringify(''),
    __APP_VERSION__: JSON.stringify('test'),
    __IS_ANDROID_BUILD__: JSON.stringify(false),
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
