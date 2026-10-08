// The editor's registrations (E5 execution document, Interfaces *The close guard and the action*): C5's close guard for
// `file` tabs, which closes a clean tab at once and asks about a dirty one (Save closes it only when the save answered
// `ok` and left the entry clean: the sheet closes on submit, so typing during the write stays in the document and keeps
// the tab, as a conflict keeps it showing the disk's version and an error its message). A dirty tab already in the
// merge view is never saved here: a save from it sends the hash the merge shows, so the sheet's default button would
// write the unresolved document over the disk's change; the guard keeps the tab and brings it to the front instead, for
// the owner to resolve, Reload or Keep mine there. And `file.save` (⌘S, File › Save file), which saves the focused
// pane's active tab when it is a file tab and does nothing otherwise. E11: `file.commentLine` (Comment on this line)
// opens the comment composer for that tab's cursor line, likewise.
import type { TabRef } from '@shared/ipc/schema/layout';
import { registerAction, registerCloseGuard, registerReplaceVerdict } from '../../../keymap/actions-runtime';
import { useLayout, type ReplaceVerdict } from '../../../stores/layout';
import { commentOnCursorLine } from '../anchor/anchor'; // E11
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

function commentOnFocusedLine(): void {
  const tab = activeTab(useLayout.getState().main);
  if (tab?.kind === 'file') commentOnCursorLine(tab.id);
}

// E11 F2b (plan 2.5): opening a session in this file tab's place keeps the tab while it holds unsaved changes or a save
// is on its way, and says so; a clean file gives its place.
export function fileReplaceVerdict(ref: TabRef): ReplaceVerdict {
  const entry = ref.kind === 'file' ? useViewer.getState().entries.get(ref.id) : undefined;
  if (entry?.saving) return { keep: `${basename(entry.path)} is being saved` };
  if (entry?.dirty) return { keep: `${basename(entry.path)} has unsaved changes` };
  return null;
}

export function registerEditor(): () => void {
  const offs = [
    registerCloseGuard('file', guardFileClose),
    registerReplaceVerdict('file', fileReplaceVerdict), // E11 F2b
    registerAction('file.save', saveFocusedFile),
    registerAction('file.commentLine', commentOnFocusedLine),
  ];
  return () => offs.forEach((off) => off());
}
