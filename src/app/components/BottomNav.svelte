<script lang="ts">
  import Icon, { type IconName } from './Icon.svelte';
  import { hrefFor, type RouteName } from '../router';
  import { t } from '../i18n/t.svelte';

  let { active }: { active: RouteName } = $props();

  type Item = { name: RouteName; icon: IconName; label: string; also?: RouteName[] };
  // Projects, Glyphs, Scan, Preview, Export (plan section 9). The editor belongs under Glyphs.
  const items: Item[] = [
    { name: 'dashboard', icon: 'folder', label: 'nav.projects' },
    { name: 'glyphs', icon: 'grid', label: 'nav.glyphs', also: ['editor'] },
    { name: 'scan', icon: 'camera', label: 'nav.scan' },
    { name: 'preview', icon: 'eye', label: 'nav.preview' },
    { name: 'export', icon: 'export', label: 'nav.export' },
  ];
  const isOn = (item: Item) => active === item.name || !!item.also?.includes(active);
</script>

<nav class="bottom no-select" aria-label={t('nav.main')}>
  {#each items as item (item.name)}
    <a class:on={isOn(item)} href={hrefFor({ name: item.name })} aria-current={isOn(item) ? 'page' : undefined}>
      <Icon name={item.icon} />
      <span>{t(item.label)}</span>
    </a>
  {/each}
</nav>

<style>
  .bottom {
    position: fixed;
    inset: auto 0 0 0;
    min-height: calc(var(--bottomnav) + var(--safe-bottom));
    padding: 0 var(--safe-right) var(--safe-bottom) var(--safe-left);
    background: var(--bg2);
    border-top: 1px solid var(--border);
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    z-index: 100;
  }
  a {
    min-height: 48px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    color: var(--text3);
    text-decoration: none;
    font-size: 11px;
    font-weight: 500;
  }
  a.on { color: var(--accent2); }
  a.on :global(svg) { filter: drop-shadow(0 0 6px var(--aborder)); }
  span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 2px; }
</style>
