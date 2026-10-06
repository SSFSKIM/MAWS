// The editor's registrations (E5 execution document, Interfaces *The close guard and the action*): C5's close guard for
// `file` tabs, which closes a clean tab at once and asks about a dirty one (Save closes it only when the save answered
// `ok` and left the entry clean: the sheet closes on submit, so typing during the write stays in the document and keeps
// the tab, as a conflict keeps it showing the disk's version and an error its message). A dirty tab already in the
// merge view is never saved here: a save from it sends the hash the merge shows, so the sheet's default button would
// write the unresolved document over the disk's change; the guard keeps the tab and brings it to the front instead, for
// the owner to resolve, Reload or Keep mine there. And `file.save` (⌘S, File › Save file), which saves the focused
// pane's active tab when it is a file tab and does nothing otherwise.
import type { TabRef } from '@shared/ipc/schema/layout';
import { registerAction, registerCloseGuard } from '../../../keymap/actions-runtime';
import { useLayout } from '../../../stores/layout';
import { activeTab } from '../../../stores/layout-model';
import { useViewer } from '../viewer/viewer-store';
import { askClose } from './EditorDialogs';

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

async function guardFileClose(ref: TabRef): Promise<boolean> {
  const entry = ref.kind === 'file' ? useViewer.getState().entries.get(ref.id) : undefined;
  if (!entry?.dirty) return true;
  if (entry.theirs?.view === 'merge') {
    useLayout.getState().activateTab(ref.id);
    return false;
  }
  const choice = await askClose(ref.id, basename(entry.path));
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  if ((await useViewer.getState().save(ref.id)) !== 'ok') return false;
  return !useViewer.getState().entries.get(ref.id)?.dirty;
}

function saveFocusedFile(): void {
  const tab = activeTab(useLayout.getState().main);
  if (tab?.kind === 'file') void useViewer.getState().save(tab.id);
}

export function registerEditor(): () => void {
  const offs = [registerCloseGuard('file', guardFileClose), registerAction('file.save', saveFocusedFile)];
  return () => offs.forEach((off) => off());
}
