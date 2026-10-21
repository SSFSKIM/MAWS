// Where a thread's passage is drawn (P4-B1; lifted from DocumentEditor.tsx's `passageRect`, P3-B M4 and P3-E E2 M4):
// the first line box of the thread's earliest live range in the shown tab, or a block thread's block, as the browser
// draws it now, in a frame's coordinates (the comment card host over the page frame reads it). P4-B1: the margin does
// not read this; it anchors each thread at the display's decorations (plugins.ts's `drawnThreads`) through
// `coordsAtPos`.
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

// The element whose first line box anchors the thread: the mark's first span, or a block thread's block; null when none
// is drawn here.
function passageElement(editor: Editor, doc: Doc, threadId: string): Element | null {
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

// The first line box of a thread's live passage in the shown tab, in the frame's coordinates; null when no live text
// of the thread is drawn here.
export function passageRect(editor: Editor, frame: HTMLElement | null, threadId: string, doc: Doc): PassageRect | null {
  if (!frame) return null;
  const element = passageElement(editor, doc, threadId);
  if (!element) return null;
  const line = firstLineRect(element);
  const origin = frame.getBoundingClientRect();
  return { x: line.left - origin.left, y: line.top - origin.top, width: line.width, height: line.height };
}
