// The depth column's Diff tab: its own one-file view state and the words only it says. MAWS's Review became one stack of
// sections (UX wave U5b) and no longer has a selected file, a file's scroll offset or the previous and next file
// buttons, so the pane keeps what it draws by itself here, as it drew it before: one file at a time under the list, its
// hunk, its mode and the offset its diff body was left at.
import { createStore, type StoreApi } from 'zustand/vanilla';

export type DiffMode = 'unified' | 'split';

export interface DiffViewUi {
  selected: string | null; // the file shown, by its path
  hunk: number; // the shown file's current hunk, 0-based
  navigate: number; // bumped by a button that moved the hunk or the file: the body scrolls to the hunk
  mode: DiffMode;
  scrollTop: number; // the diff body's, restored when it mounts
}

export function createDiffViewUi(): StoreApi<DiffViewUi> {
  return createStore<DiffViewUi>()(() => ({ selected: null, hunk: 0, navigate: 0, mode: 'unified', scrollTop: 0 }));
}

// Another file shown: from its first hunk, at its top.
export function selectFile(path: string): Partial<DiffViewUi> {
  return { selected: path, hunk: 0, scrollTop: 0 };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const DIFF_COPY = {
  header: (files: number, added: number, removed: number, base: string) => `${plural(files, 'file')} changed · +${added} −${removed} · Since ${base}`,
  fileHeader: (path: string, kind: string) => `${path} · ${kind}`,
  previousFile: 'Previous file',
  nextFile: 'Next file',
} as const;
