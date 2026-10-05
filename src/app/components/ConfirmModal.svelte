<script lang="ts">
  import Modal from './Modal.svelte';
  import { t } from '../i18n/t.svelte';
  let {
    title,
    body,
    confirmLabel,
    danger = false,
    onconfirm,
    oncancel,
  }: { title: string; body: string; confirmLabel: string; danger?: boolean; onconfirm: () => void; oncancel: () => void } = $props();
</script>

<Modal {title} description={body} onclose={oncancel}>
  {#snippet actions()}
    <button class="btn ghost" onclick={oncancel}>{t('common.cancel')}</button>
    <button class="btn {danger ? 'danger' : 'primary'}" onclick={onconfirm}>{confirmLabel}</button>
  {/snippet}
</Modal>
