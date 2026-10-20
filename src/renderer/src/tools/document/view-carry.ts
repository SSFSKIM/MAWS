// What a document's body carries across a remount (P4-B3 M5, its Decision Log 25; X38's carry for the document kind and
// the dashboard's, which shares its body). R-1 (`spikes/p4-reparent/findings.txt`) settled on an explicit carry rather
// than keeping the editor alive: the editor is destroyed and a new one made over the same replica, which the hold carries.
//
// - The undo history: the binding's own UndoManager dies with its editor, so the tab state keeps one per tab body and
//   the body swaps it into every editor it mounts (`keepUndoManager`), the swap @y/prosemirror 2's undo plugin supports
//   (`tr.setMeta(yUndoPluginKey, { undoManager })`; the view's destroy then only detaches it). The binding swaps its own
//   in a microtask after the view is in the page, so ours goes in again whenever the binding's (or its placeholder) is
//   the plugin's; a manager anyone else swapped in is left alone.
// - The view, on a move only (the registry's `captureView`, taken once by the target's first mount): the first visible
//   block and how far into it the page was scrolled (the panel and a main tab differ in width, so the same offset would
//   land elsewhere), the selection as Y relative positions (they survive the edits made meanwhile), and whether the page
//   had the keyboard. Restored once the new editor has drawn its tab, focus first, then the scroll, then the selection.
//   The tab the document editor shows is its own state (`src/artifacts/document/editor/`), so a view captured on
//   another of the document's tabs restores nothing.
import type { Editor } from '@tiptap/core';
import { NodeSelection, TextSelection, type Selection } from '@tiptap/pm/state';
import type { Node as YType } from '@artifacts/yjs';
import type { UndoManager } from '@artifacts/yjs/document';
import { relativePositionsToResolvedPositions, resolvedPositionsToRelativePositions, ySyncPluginKey, yUndoPluginKey } from '@artifacts/yjs/prosemirror';

type RelativePosition = NonNullable<ReturnType<typeof resolvedPositionsToRelativePositions>[number]>;

export interface DocumentView {
  /** The tab body the editor showed. */
  body: YType;
  selection: { node: boolean; anchor: RelativePosition; head: RelativePosition } | null;
  /** 'top': scrolled to its top; null: no laid-out page to read (hidden behind a version, say), so nothing restored. */
  scroll: { block: RelativePosition; fraction: number } | 'top' | null;
  focused: boolean;
}

/** The tab body the live editor binds (its collaboration extension's), or null. */
export function liveBody(editor: Editor): YType | null {
  const options = editor.extensionManager.extensions.find((extension) => extension.name === 'collaboration')?.options as { ytype?: YType | null } | undefined;
  return options?.ytype ?? null;
}

const drawn = (editor: Editor, body: YType): boolean => !editor.isDestroyed && (ySyncPluginKey.getState(editor.state) as { ytype?: unknown } | undefined)?.ytype === body;

/** Keeps `manager` as the editor's undo history; returns the stop. */
export function keepUndoManager(editor: Editor, manager: UndoManager): () => void {
  const wanted = (): boolean => {
    if (editor.isDestroyed) return false;
    const current = (yUndoPluginKey.getState(editor.state) as { undoManager?: UndoManager } | undefined)?.undoManager;
    const { undoManager: own, scratch } = editor.storage.collaboration;
    return current !== manager && current !== undefined && (current === own || current === scratch?.undoManager);
  };
  const swap = () => {
    if (wanted()) editor.view.dispatch(editor.state.tr.setMeta(yUndoPluginKey, { undoManager: manager }));
  };
  swap();
  // The binding's own swap is a transaction: ours follows it before anything else runs (no edit lands in between).
  const onTransaction = () => {
    if (wanted()) queueMicrotask(swap);
  };
  editor.on('transaction', onTransaction);
  return () => void editor.off('transaction', onTransaction);
}

/** Where the owner is in the live editor; null when it shows no tab yet. */
export function captureDocumentView(editor: Editor, page: HTMLElement | null): DocumentView | null {
  const body = liveBody(editor);
  if (!body || !drawn(editor, body)) return null;
  const { view, state } = editor;
  const { selection } = state;
  const [anchor, head] = resolvedPositionsToRelativePositions(view, [selection.$anchor, selection.$head]);
  return {
    body,
    selection: anchor && head ? { node: selection instanceof NodeSelection, anchor, head } : null,
    scroll: page ? scrollPlace(editor, page) : null,
    focused: view.hasFocus(),
  };
}

// The document's top-level blocks as drawn, with their positions.
function blocksOf(editor: Editor): { pos: number; dom: HTMLElement }[] {
  const blocks: { pos: number; dom: HTMLElement }[] = [];
  editor.state.doc.forEach((_node, pos) => {
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) blocks.push({ pos, dom });
  });
  return blocks;
}

function scrollPlace(editor: Editor, page: HTMLElement): DocumentView['scroll'] {
  if (page.scrollTop <= 0) return 'top';
  const top = page.getBoundingClientRect().top;
  const blocks = blocksOf(editor);
  // the first block whose bottom is below the page's top (the blocks are drawn in order)
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (blocks[mid]!.dom.getBoundingClientRect().bottom > top) high = mid;
    else low = mid + 1;
  }
  const found = blocks[low];
  if (!found) return null;
  const rect = found.dom.getBoundingClientRect();
  const [block] = resolvedPositionsToRelativePositions(editor.view, [editor.state.doc.resolve(found.pos)]);
  if (!block) return null;
  return { block, fraction: rect.height > 0 ? Math.min(1, Math.max(0, (top - rect.top) / rect.height)) : 0 };
}

/**
 * Restores `view` once the editor has drawn its tab (a frame after, so the page is laid out); `onRestored` is told when
 * it ran or when it cannot (another tab shown, the editor gone). Returns the cancel.
 */
export function restoreDocumentViewWhenDrawn(editor: Editor, page: () => HTMLElement | null, view: DocumentView, onRestored: () => void): () => void {
  let frame: number | null = null;
  const ready = (): boolean => {
    if (editor.isDestroyed || liveBody(editor) !== view.body) {
      onRestored();
      return true;
    }
    if (!drawn(editor, view.body)) return false;
    frame = requestAnimationFrame(() => {
      frame = null;
      onRestored();
      if (!editor.isDestroyed) restoreDocumentView(editor, page(), view);
    });
    return true;
  };
  const onTransaction = () => {
    if (ready()) editor.off('transaction', onTransaction);
  };
  if (!ready()) editor.on('transaction', onTransaction);
  return () => {
    editor.off('transaction', onTransaction);
    if (frame !== null) cancelAnimationFrame(frame);
  };
}

/** Focus first (ProseMirror's own, which does not scroll), then the scroll, then the selection. */
export function restoreDocumentView(editor: Editor, page: HTMLElement | null, view: DocumentView): void {
  const { view: pm } = editor;
  if (view.focused) pm.focus();
  if (page && view.scroll === 'top') page.scrollTop = 0;
  else if (page && typeof view.scroll === 'object' && view.scroll !== null) {
    const [$block] = relativePositionsToResolvedPositions(pm, [view.scroll.block]);
    const dom = $block ? pm.nodeDOM($block.depth === 0 ? $block.pos : $block.before(1)) : null;
    if (dom instanceof HTMLElement) {
      const rect = dom.getBoundingClientRect();
      page.scrollTop += rect.top - page.getBoundingClientRect().top + view.scroll.fraction * rect.height;
    }
  }
  const restored = view.selection && selectionAt(editor, view.selection);
  if (restored) pm.dispatch(editor.state.tr.setSelection(restored).setMeta('addToHistory', false));
}

function selectionAt(editor: Editor, { node, anchor, head }: NonNullable<DocumentView['selection']>): Selection | null {
  const [$anchor, $head] = relativePositionsToResolvedPositions(editor.view, [anchor, head]);
  if (!$anchor || !$head) return null;
  if (node && $anchor.nodeAfter) return NodeSelection.create(editor.state.doc, $anchor.pos);
  return TextSelection.between($anchor, $head);
}
