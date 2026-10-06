// The merge view (E5 execution document, Interfaces *The code view's modes*; M3's decisions): `@codemirror/merge`'s
// unified view over the editor's own document (mine), the disk's version (theirs) as the original, drawn while the
// entry's `theirs.view` is 'merge'. One editor, one scroll, one document to save. Each chunk carries MAWS's own controls,
// which say whose version a click keeps: Keep mine (the library's accept: the original takes mine's lines, the document
// is untouched) and Take theirs (its reject: the document's chunk reverts to theirs). Loaded with CodeView, never in the
// main chunk; the colours are code-theme.ts's, from tokens.
import { getChunks, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge';
import { Compartment, Facet, type EditorState, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { EDITOR_COPY } from '../copy';

// Module-level, as CodeView's other compartments, so a state left behind keeps its merge view (and the chunks already
// resolved in it) under the tab's next view.
export const merging = new Compartment();

// The hash of the disk version the merge view holds, so the view reconfigures only for another version (a reconfigure
// rebuilds the original, which would forget the chunks already kept).
const mergedHash = Facet.define<string, string | null>({ combine: (values) => values[0] ?? null });
export const mergedWith = (state: EditorState): string | null => state.facet(mergedHash);

function control(type: 'accept' | 'reject', action: (event: MouseEvent) => void): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cm-merge-control';
  button.dataset.mergeControl = type;
  button.textContent = type === 'accept' ? EDITOR_COPY.keepMineChunk : EDITOR_COPY.takeTheirs;
  button.addEventListener('click', action);
  return button;
}

export function mergeView(theirs: { text: string; hash: string }): Extension {
  return [
    mergedHash.of(theirs.hash),
    unifiedMergeView({ original: theirs.text, mergeControls: control, highlightChanges: true, gutter: true, collapseUnchanged: { margin: 3, minSize: 4 } }),
  ];
}

// How many chunks differ from the disk's version; null while no merge view is open.
export const changeCount = (state: EditorState): number | null => getChunks(state)?.chunks.length ?? null;

export const stepChange = (view: EditorView, direction: -1 | 1): boolean => (direction > 0 ? goToNextChunk : goToPreviousChunk)(view);
