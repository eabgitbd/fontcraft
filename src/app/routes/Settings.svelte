<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import { LOCALES, type Locale } from '../i18n/core';
  import { settings, type Theme } from '../stores/settings.svelte';
  import { updateProject } from '@/storage/projects';
  import type { FontSettings } from '@/storage/types';
  import { store } from '../stores/project.svelte';
  import { toast } from '../stores/toast.svelte';
  import { t } from '../i18n/t.svelte';

  const themes: { id: Theme; label: string }[] = [
    { id: 'system', label: 'settings.theme.system' },
    { id: 'dark', label: 'settings.theme.dark' },
    { id: 'light', label: 'settings.theme.light' },
  ];

  type NumKey = 'upm' | 'ascender' | 'descender' | 'xheight' | 'capheight' | 'defWidth' | 'defLsb' | 'defRsb' | 'italic' | 'tracking';
  type TextKey = 'subfamily' | 'designer' | 'license' | 'version';
  const NUMS: [NumKey, string][] = [
    ['upm', 'fontset.upm'], ['ascender', 'fontset.ascender'], ['descender', 'fontset.descender'], ['xheight', 'fontset.xheight'], ['capheight', 'fontset.capheight'],
    ['defWidth', 'fontset.defWidth'], ['defLsb', 'fontset.defLsb'], ['defRsb', 'fontset.defRsb'], ['italic', 'fontset.italic'], ['tracking', 'fontset.tracking'],
  ];
  const TEXTS: [TextKey, string][] = [['subfamily', 'fontset.subfamily'], ['designer', 'fontset.designer'], ['license', 'fontset.license'], ['version', 'fontset.version']];

  let family = $state('');
  let form = $state<FontSettings | null>(null);
  let loadedFor = '';

  $effect(() => {
    const p = store.project;
    if (p && loadedFor !== p.id) {
      loadedFor = p.id;
      family = p.name;
      form = { ...p.settings };
    } else if (!p) {
      loadedFor = '';
      form = null;
    }
  });

  async function saveFont() {
    const p = store.project;
    if (!p || !form) return;
    const fixed = { ...form };
    // Same guard as v3: an empty or zero value falls back to the previous one instead of breaking the font.
    for (const [k] of NUMS) if (!Number.isFinite(Number(fixed[k]))) fixed[k] = p.settings[k];
    fixed.upm = Number(fixed.upm) || p.settings.upm;
    try {
      store.setProject(await updateProject(p.id, { name: family, settings: fixed }));
      toast(t('fontset.saved'), 'ok');
    } catch (e) {
      toast(String((e as Error)?.message ?? e), 'wn');
    }
  }
</script>

<TopBar title={t('nav.settings')} />
<div class="scroll body">
  <section class="card">
    <h3>{t('app.settings')}</h3>
    <div class="field">
      <label for="lang">{t('settings.language')}</label>
      <select id="lang" class="input" value={settings.locale} onchange={(e) => settings.setLocale(e.currentTarget.value as Locale)}>
        {#each LOCALES as l (l.id)}<option value={l.id}>{l.label}</option>{/each}
      </select>
    </div>
    <div class="field">
      <label for="theme">{t('settings.theme')}</label>
      <select id="theme" class="input" value={settings.theme} onchange={(e) => settings.setTheme(e.currentTarget.value as Theme)}>
        {#each themes as th (th.id)}<option value={th.id}>{t(th.label)}</option>{/each}
      </select>
    </div>
  </section>

  {#if form}
    <section class="card">
      <h3>{t('fontset.title')}</h3>
      <div class="field"><label for="fs-family">{t('fontset.family')}</label><input id="fs-family" class="input" bind:value={family} /></div>
      <div class="grid">
        {#each TEXTS as [key, label] (key)}
          <div class="field"><label for="fs-{key}">{t(label)}</label><input id="fs-{key}" class="input" bind:value={form[key]} /></div>
        {/each}
        {#each NUMS as [key, label] (key)}
          <div class="field"><label for="fs-{key}">{t(label)}</label><input id="fs-{key}" class="input mono" type="number" inputmode="numeric" bind:value={form[key]} /></div>
        {/each}
        <div class="field">
          <label for="fs-var">{t('fontset.varMode')}</label>
          <select id="fs-var" class="input" bind:value={form.varMode}>
            <option value="random">{t('fontset.varMode.random')}</option>
            <option value="cycle">{t('fontset.varMode.cycle')}</option>
            <option value="first">{t('fontset.varMode.first')}</option>
          </select>
        </div>
      </div>
      <button class="btn primary" onclick={saveFont}>{t('common.save')}</button>
    </section>
  {/if}
</div>

<style>
  .body { display: grid; gap: 14px; align-content: start; max-width: 720px; }
  h3 { font-size: 12px; font-weight: 600; color: var(--text3); text-transform: uppercase; letter-spacing: 0.7px; margin-bottom: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0 12px; }
</style>
