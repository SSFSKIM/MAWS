// The editor's registrations (E5 execution document, Interfaces *The close guard and the action*): C5's close guard for
// `file` tabs, which closes a clean tab at once and asks about a dirty one (Save closes it only when the save answered
// `ok` and left the entry clean: the sheet closes on submit, so typing during the write stays in the document and keeps
// the tab, as a conflict keeps it showing the disk's version and an error its message). A dirty tab already in the
// merge view is never saved here: a save from it sends the hash the merge shows, so the sheet's default button would
// write the unresolved document over the disk's change; the guard keeps the tab and brings it to the front instead, for
// the owner to resolve, Reload or Keep mine there. And `file.save` (⌘S, File › Save file), which saves the focused
// pane's active tab when it is a file tab and does nothing otherwise. E11: `file.commentLine` (Comment on this line)
// opens the comment composer for that tab's cursor line, likewise.
//
// UX wave U6b-1 (docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-chat.md, M2; R4, sequence 2): the question
// is asked by the file's key (`closeGuardOf`), for a file beside the chat in the same words as for a main file tab, and
// the two actions act on the file whose viewer holds the keyboard before the main tab on screen (`focusedFile`).
import type { TabRef } from '@shared/ipc/schema/layout';
import { registerAction, registerCloseGuard, registerReplaceVerdict } from '../../../keymap/actions-runtime';
import { tabOnScreen, useLayout, type ReplaceVerdict } from '../../../stores/layout';
import { commentOnCursorLine } from '../anchor/anchor'; // E11
import { connectOpenFile } from '../files/open-chosen'; // UX wave U6e: File › Open File… (⌘O)
import type { SideFilesViewer } from '../files/tabs';
import { useViewer } from '../viewer/viewer-store';
import { askClose } from './EditorDialogs';

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

// Where a file is being closed: `reveal` brings it into view when the merge view vetoes the close, and `holds` says
// whether that place still holds the file once the person has answered.
export interface CloseSite {
  reveal(): void;
  holds(): boolean;
}

// The file's main tab: brought to the front on a veto, and answered as it always was.
const mainTabSite = (key: string): CloseSite => ({ reveal: () => useLayout.getState().activateTab(key), holds: () => true });

// The close question, by the file's key. An answer that comes back to a place no longer holding the file (it moved
// while the question was open) changes nothing: what holds the file now keeps it, edits and all (sequence 2).
// UX wave U6e (the panel's finding 3): the merge view's veto guards a Save that would write the unresolved document; an
// entry whose latest admission locks it is never saved, so its question is asked as any dirty tab's, and Don't save is
// its way out (Save then writes nothing and keeps the tab).
const vetoed = (entry: { theirs: { view: string } | null; locked: unknown } | undefined) => entry?.theirs?.view === 'merge' && entry.locked === null;

export async function closeGuardOf(key: string, site: CloseSite = mainTabSite(key)): Promise<boolean> {
  const entry = useViewer.getState().entries.get(key);
  if (!entry?.dirty) return true;
  if (vetoed(entry)) {
    site.reveal();
    return false;
  }
  const choice = await askClose(key, basename(entry.path));
  if (choice === 'cancel' || !site.holds()) return false;
  // A save under way while the question was open can have settled as a conflict: the merge view's veto holds after the
  // answer too, so neither answer writes the unresolved document over the disk's change nor drops it unresolved.
  if (vetoed(useViewer.getState().entries.get(key))) {
    site.reveal();
    return false;
  }
  if (choice === 'discard') return true;
  if ((await useViewer.getState().save(key)) !== 'ok') return false;
  return !useViewer.getState().entries.get(key)?.dirty;
}

const guardFileClose = (ref: TabRef): Promise<boolean> => (ref.kind === 'file' ? closeGuardOf(ref.id) : Promise.resolve(true));

// R4: the file whose viewer holds the keyboard (a file beside the chat while its tab is visible, registered by its body;
// a main file tab is then the focused pane's tab on screen, since C5's Pane takes the focus on focus-in), else the main
// tab on screen when it is a file; none behind a page (UX wave U7b, §N: `tabOnScreen`, and for the side column the
// body's `visible`).
const sideFiles = new Map<Element, string>();

export function registerSideFile(body: Element, key: string): () => void {
  sideFiles.set(body, key);
  return () => {
    if (sideFiles.get(body) === key) sideFiles.delete(body);
  };
}

export function focusedFile(): string | null {
  const active = document.activeElement;
  if (active) for (const [body, key] of sideFiles) if (body.contains(active)) return key;
  const tab = tabOnScreen(useLayout.getState());
  return tab?.kind === 'file' ? tab.id : null;
}

function saveFocusedFile(): void {
  const key = focusedFile();
  if (key !== null) void useViewer.getState().save(key);
}

function commentOnFocusedLine(): void {
  const key = focusedFile();
  if (key !== null) commentOnCursorLine(key);
}

// What the side tabs' one subscriber (`files/tabs.ts`, sequence 6) asks of the viewer, which that module does not
// import: the prune; whether a file is unsaved (edits not yet saved, or a save under way); and a file's first edit (its
// entry turning dirty), which keeps the preview tab that holds it.
export const sideFilesViewer: SideFilesViewer = {
  prune: () => useViewer.getState().prune(),
  unsaved: (key) => {
    const entry = useViewer.getState().entries.get(key);
    return entry !== undefined && (entry.dirty || entry.saving);
  },
  edited: (listener) =>
    useViewer.subscribe((state, previous) => {
      if (state.entries === previous.entries) return;
      for (const [key, entry] of state.entries) if (entry.dirty && !previous.entries.get(key)?.dirty) listener(key);
    }),
};

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
    connectOpenFile(),
  ];
  return () => offs.forEach((off) => off());
}
