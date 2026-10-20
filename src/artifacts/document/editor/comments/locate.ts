// Where a thread's passage is drawn (P4-B1; lifted from DocumentEditor.tsx's `passageRect`, P3-B M4 and P3-E E2 M4):
// the first line box of the thread's earliest live range in the shown tab, or a block thread's block, as the browser
// draws it now. `passageRect` answers in a frame's coordinates (the comment card host over the page frame reads it);
// `lineRect` answers the viewport rect itself (the margin reads it against its own column, so a scroll changes
// nothing). The mark's span is found once per thread and kept while it stays in the document: ProseMirror keeps the
// DOM of text it did not redraw, so a keystroke elsewhere re-reads only rects, and one query over the page finds every
// thread's first span when a kept one is gone (`MarginLocator`).
import type { Editor } from '@tiptap/core';
import type { Doc } from '../../../yjs';
import { getThread, isBlockAnchor } from '../../threads';
import type { PassageRect } from './surface';

const SAFE_ID = /^[\w-]+$/;

// P3-E (E2 M4): where a block thread's block is in the editor's doc, or -1 (not a block thread, or no such block here).
export function blockPos(editor: Editor, doc: Doc, threadId: string): number {
  const thread = getThread(doc, threadId);
  if (!thread || !isBlockAnchor(thread.anchor) || thread.blockId === null) return -1;
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.attrs.id === thread.blockId) at = pos;
    return !node.isTextblock;
  });
  return at;
}

/** The element whose first line box anchors the thread: the mark's first span, or a block thread's block; null when none is drawn here. */
export function passageElement(editor: Editor, doc: Doc, threadId: string): Element | null {
  if (editor.isDestroyed || !SAFE_ID.test(threadId)) return null;
  const block = blockPos(editor, doc, threadId);
  const span = block >= 0 ? editor.view.nodeDOM(block) : editor.view.dom.querySelector(`[data-thread="${threadId}"]`);
  return span instanceof Element ? span : null;
}

/** The first line box of `element` in viewport coordinates (a zero-width first rect at a soft wrap is skipped, P6). */
export function firstLineRect(element: Element): DOMRect {
  const rects = element.getClientRects();
  for (const rect of rects) if (rect.width > 0) return rect; // P4-B1: Chromium's empty fragment at a soft wrap has the line's height
  return rects[0] ?? element.getBoundingClientRect();
}

/** The viewport rect of the thread's first line here, or null. */
export function lineRect(editor: Editor, doc: Doc, threadId: string): DOMRect | null {
  const element = passageElement(editor, doc, threadId);
  return element ? firstLineRect(element) : null;
}

// The first line box of a thread's live passage in the shown tab, in the frame's coordinates; null when no live text
// of the thread is drawn here.
export function passageRect(editor: Editor, frame: HTMLElement | null, threadId: string, doc: Doc): PassageRect | null {
  if (!frame) return null;
  const line = lineRect(editor, doc, threadId);
  if (!line) return null;
  const origin = frame.getBoundingClientRect();
  return { x: line.left - origin.left, y: line.top - origin.top, width: line.width, height: line.height };
}

/**
 * The margin's locator: every thread's anchoring element, found by one pass over the page's marks and kept while it is
 * still in the document. `refresh` is called once per layout pass with the thread ids wanted, in any order, and answers
 * them in document order with their elements; a thread whose kept element has gone is looked up again by the one query
 * (and a block thread by its position); a thread drawn nowhere here is left out, and (P4-B1) not looked for again until
 * the ids wanted change, so a thread the page no longer draws costs no pass a query.
 */
export class MarginLocator {
  private readonly kept = new Map<string, Element>();
  // P4-B1: the ids the last query could not find, kept while the ids wanted stay the same
  private readonly unfound = new Set<string>();
  private wantedKey = '';

  constructor(
    private readonly editor: Editor,
    private readonly doc: Doc,
  ) {}

  /** The threads that are drawn here, in document order, each with its anchoring element. */
  refresh(threadIds: readonly string[]): Array<{ id: string; element: Element }> {
    if (this.editor.isDestroyed) return [];
    const root = this.editor.view.dom;
    // P4-B1: a new set of ids wanted is looked for afresh
    const key = threadIds.join(' ');
    if (key !== this.wantedKey) {
      this.wantedKey = key;
      this.unfound.clear();
    }
    const missing: string[] = [];
    for (const id of threadIds) {
      const element = this.kept.get(id);
      if (!element || !element.isConnected || !root.contains(element)) {
        this.kept.delete(id);
        if (!this.unfound.has(id)) missing.push(id); // P4-B1
      }
    }
    if (missing.length > 0) {
      const wanted = new Set(missing.filter((id) => SAFE_ID.test(id)));
      for (const span of root.querySelectorAll<HTMLElement>('[data-thread]')) {
        const id = span.dataset.thread;
        if (id !== undefined && wanted.has(id) && !this.kept.has(id)) this.kept.set(id, span);
      }
      for (const id of wanted) {
        if (this.kept.has(id)) continue;
        const block = blockPos(this.editor, this.doc, id);
        const node = block >= 0 ? this.editor.view.nodeDOM(block) : null;
        if (node instanceof Element) this.kept.set(id, node);
        else this.unfound.add(id); // P4-B1
      }
    }
    const found = threadIds.filter((id) => this.kept.has(id)).map((id) => ({ id, element: this.kept.get(id)! }));
    // document order: the DOM's (the marks' spans and the blocks are in the page in document order)
    found.sort((a, b) => (a.element === b.element ? 0 : a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    return found;
  }

  forget(threadId: string): void {
    this.kept.delete(threadId);
  }
}
