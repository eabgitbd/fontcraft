<script lang="ts">
  import { hrefFor } from '../router';
  import { t } from '../i18n/t.svelte';
</script>

<div class="none">
  <h2>{t('project.none.title')}</h2>
  <p>{t('project.none.body')}</p>
  <a class="btn primary" href={hrefFor({ name: 'dashboard' })}>{t('project.none.action')}</a>
</div>

<style>
  .none { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 32px; text-align: center; }
  h2 { font-size: 16px; color: var(--text2); }
  p { font-size: 13px; color: var(--text3); }
  a { text-decoration: none; margin-top: 6px; }
</style>
