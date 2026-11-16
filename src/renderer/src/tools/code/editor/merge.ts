// The merge view (E5 execution document, Interfaces *The code view's modes*; M3's decisions): `@codemirror/merge`'s
// unified view over the editor's own document (mine), the disk's version (theirs) as the original, drawn while the
// entry's `theirs.view` is 'merge'. One editor, one scroll, one document to save. Each chunk carries MAWS's own controls,
// which say whose version a click keeps: Keep mine (the library's accept: the original takes mine's lines, the document
// is untouched) and Take theirs (its reject: the document's chunk reverts to theirs). Loaded with CodeView, never in the
// main chunk; the colours are code-theme.ts's, from tokens.
import { getChunks, getOriginalDoc, goToNextChunk, goToPreviousChunk, unifiedMergeView } from '@codemirror/merge';
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

// A state left behind keeps its chunks' widgets as the view that drew them built them: `@codemirror/merge` caches each
// deletion widget's DOM, and its controls act on that view, destroyed since (the Mac run's second failure: Take theirs
// after a move changed nothing). A view that takes the state over draws the merge view anew, from the original as it now
// is (the chunks kept so far are in it), so its controls act on this view.
export function redrawMergeView(view: EditorView): void {
  const hash = mergedWith(view.state);
  if (hash === null) return;
  const text = getOriginalDoc(view.state).toString();
  view.dispatch({ effects: merging.reconfigure([]) });
  view.dispatch({ effects: merging.reconfigure(mergeView({ text, hash })) });
}

// How many chunks differ from the disk's version; null while no merge view is open.
export const changeCount = (state: EditorState): number | null => getChunks(state)?.chunks.length ?? null;

export const stepChange = (view: EditorView, direction: -1 | 1): boolean => (direction > 0 ? goToNextChunk : goToPreviousChunk)(view);
