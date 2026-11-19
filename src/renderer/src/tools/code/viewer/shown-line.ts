// The line a file's "Open in" hands an editor (UX wave U6b-4a, docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4a-open-in.md,
// decision 5): the cursor's line while the cursor is in the part of the file shown, else the first line shown. The code
// view of a tab registers how to read both while it is mounted; a tab with no code view mounted (a rendered Markdown file,
// an image) has no line, and its file opens with none.
export interface ShownLines {
  cursor: { line: number; shown: boolean } | null;
  top: number | null; // the first line shown
}

export function lineToOpen({ cursor, top }: ShownLines): number | null {
  if (cursor?.shown === true) return cursor.line;
  return top ?? cursor?.line ?? null;
}

const readers = new Map<string, () => ShownLines>();

/** Registers how the tab's view reads its lines; returns the removal, which leaves a later view's registration alone. */
export function registerShownLine(tabId: string, read: () => ShownLines): () => void {
  readers.set(tabId, read);
  return () => {
    if (readers.get(tabId) === read) readers.delete(tabId);
  };
}

export function shownLine(tabId: string): number | null {
  const read = readers.get(tabId);
  return read === undefined ? null : lineToOpen(read());
}
