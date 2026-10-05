<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import { hrefFor, type RouteName } from '../router';
  import { t } from '../i18n/t.svelte';
  import { ui } from '../stores/ui.svelte';

  let { active }: { active: RouteName } = $props();

  type Item = { name: RouteName; icon: IconName; label: string };
  const items: Item[] = [
    { name: 'dashboard', icon: 'folder', label: 'nav.projects' },
    { name: 'glyphs', icon: 'grid', label: 'nav.glyphs' },
    { name: 'editor', icon: 'pen', label: 'nav.editor' },
    { name: 'scan', icon: 'camera', label: 'nav.scan' },
    { name: 'ligatures', icon: 'link', label: 'nav.ligatures' },
    { name: 'kerning', icon: 'kern', label: 'nav.kerning' },
    { name: 'preview', icon: 'eye', label: 'nav.preview' },
    { name: 'export', icon: 'export', label: 'nav.export' },
  ];
</script>

<nav class="rail no-select" aria-label={t('nav.main')}>
  <a class="logo" href={hrefFor({ name: 'dashboard' })} aria-label={t('app.name')}>Fc</a>
  {#each items as item (item.name)}
    <a class="nb" class:on={active === item.name} href={hrefFor({ name: item.name })} aria-label={t(item.label)} aria-current={active === item.name ? 'page' : undefined} title={t(item.label)}>
      <Icon name={item.icon} />
    </a>
  {/each}
  <span class="grow"></span>
  <button class="nb" onclick={() => (ui.showShortcuts = true)} aria-label={t('nav.shortcuts')} title={t('nav.shortcuts')}><Icon name="keyboard" /></button>
  <a class="nb" class:on={active === 'settings'} href={hrefFor({ name: 'settings' })} aria-label={t('nav.settings')} aria-current={active === 'settings' ? 'page' : undefined} title={t('nav.settings')}>
    <Icon name="settings" />
  </a>
</nav>

<style>
  .rail {
    position: fixed;
    inset: 0 auto 0 0;
    width: calc(var(--rail) + var(--safe-left));
    padding: calc(12px + var(--safe-top)) 0 calc(14px + var(--safe-bottom)) var(--safe-left);
    background: var(--bg2);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    z-index: 100;
  }
  .logo {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: var(--accent);
    color: #fff;
    display: grid;
    place-items: center;
    font: 700 19px/1 var(--font-mono);
    letter-spacing: -1px;
    text-decoration: none;
    margin-bottom: 14px;
  }
  .nb {
    width: var(--tap);
    height: var(--tap);
    border-radius: var(--r);
    display: grid;
    place-items: center;
    color: var(--text3);
    text-decoration: none;
    transition: var(--tr);
  }
  button.nb { border: none; background: transparent; }
  .nb:hover { background: var(--bg3); color: var(--text2); }
  .nb.on { background: var(--abg); color: var(--accent2); }
  .grow { flex: 1; }
</style>
