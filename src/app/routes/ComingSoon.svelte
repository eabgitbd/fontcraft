<script lang="ts">
  import TopBar from '../components/TopBar.svelte';
  import { t } from '../i18n/t.svelte';
  let { titleKey }: { titleKey: string } = $props();
</script>

<TopBar title={t(titleKey)} />
<div class="empty">
  <h2>{t('screen.soon.title')}</h2>
  <p>{t('screen.soon.body')}</p>
</div>

<style>
  .empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 32px; text-align: center; color: var(--text3); }
  h2 { font-size: 16px; color: var(--text2); }
  p { font-size: 13px; max-width: 320px; line-height: 1.5; }
</style>
