import '@fontsource-variable/inter/wght.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/noto-sans-bengali/bengali-400.css';
import '@fontsource/noto-sans-bengali/bengali-600.css';
import '@/shared/tokens.css';
import '@/shared/base.css';
import { mount } from 'svelte';
import { initPlatform } from '@/platform';
import { requestPersistence } from '@/storage/db';
import App from './App.svelte';

async function start(): Promise<void> {
  const target = document.getElementById('app');
  if (!target) throw new Error('FontCraft: #app mount point is missing');
  // The platform adapter must exist before any component asks for it.
  await initPlatform();
  void requestPersistence();
  mount(App, { target });
}

start().catch((err) => {
  console.error('FontCraft failed to start', err);
  const el = document.getElementById('app');
  if (el) el.textContent = `FontCraft could not start: ${String((err as Error)?.message ?? err)}`;
});
