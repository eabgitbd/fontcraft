import { Autosaver } from '@/storage/autosave';
import { toast } from './toast.svelte';
import { t } from '../i18n/t.svelte';

/** Drives the little "Saved" badge. */
class AutosaveState {
  visible = $state(false);
  private hide: ReturnType<typeof setTimeout> | null = null;

  flash(): void {
    this.visible = true;
    if (this.hide) clearTimeout(this.hide);
    this.hide = setTimeout(() => (this.visible = false), 1800);
  }
}

export const autosaveState = new AutosaveState();

/** Shared writer for the app. `onExportBackup` is wired by the export screen in a later milestone. */
export const autosaver = new Autosaver({
  onSaved: () => autosaveState.flash(),
  onQuotaError: () => toast(`${t('storage.full.title')}. ${t('storage.full.body')}`, 'wn'),
  onError: (err) => {
    console.error('FontCraft: autosave failed', err);
    toast(String((err as Error)?.message ?? err), 'wn');
  },
});
