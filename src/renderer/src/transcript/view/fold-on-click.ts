// The owner's ruling (UX wave, obs4): an open tool block folds at a click on its blank space, so a block taller than the
// window (a long output, a run of many calls) folds where the reader is, not only at its head. Blank means none of what
// the press could have meant otherwise: not a control, a link or a nested widget with interactions of its own, not text
// or media (a click on a word may be the first of a double click that selects it), not the end of a selection or a drag,
// not a modified click, not the second click of a double one. Of nested blocks (a run's calls) only the innermost open
// one folds. The head's toggle stays the keyboard's way to fold (the body takes no focus stop); after a fold by click,
// focus goes to that toggle and the head scrolls into view, the scroller's own scroll, which the virtualised list reads
// as any other (a row that spans the viewport is never compensated for its size change).
import { useRef, type MouseEvent, type RefObject } from 'react';

export const FOLD_ON_CLICK = 'data-fold-on-click';

// A press that travelled further than this between mousedown and the click was a drag.
const SLOP_PX = 4;

// What owns its clicks: a control, a link, a field, a widget role, anything focusable (a code viewer, a terminal, a
// mention that is a span with the role of a button), media and embedded frames, and what a drawing marks as its own.
const INTERACTIVE = [
  'a', 'button', 'input', 'textarea', 'select', 'option', 'label', 'summary',
  'img', 'svg', 'video', 'audio', 'canvas', 'iframe', 'embed', 'object',
  '[tabindex]', '[contenteditable]:not([contenteditable="false"])', '[draggable="true"]', '[data-own-clicks]',
  ...['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton', 'textbox', 'searchbox', 'combobox', 'listbox', 'menu', 'menubar', 'tree', 'treegrid', 'grid', 'toolbar', 'dialog'].map((role) => `[role="${role}"]`),
].join(', ');

interface Press { x: number; y: number }

function interactiveWithin(target: Element, block: Element): boolean {
  for (let element: Element | null = target; element !== null && element !== block; element = element.parentElement) {
    if (element.matches(INTERACTIVE)) return true;
  }
  return false;
}

function selectionTouches(block: Element): boolean {
  const selection = block.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed) return false;
  for (let k = 0; k < selection.rangeCount; k++) if (selection.getRangeAt(k).intersectsNode(block)) return true;
  return false;
}

// Whether the point is on a glyph of text: the caret position there (Chromium's caretRangeFromPoint), and the character
// on either side of it, whose box must hold the point (a caret past a line's end is not on it).
export function onText(document: Document, x: number, y: number): boolean {
  const at = (document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null }).caretRangeFromPoint?.(x, y);
  const node = at?.startContainer;
  if (!at || !node || node.nodeType !== Node.TEXT_NODE) return false;
  const length = (node as Text).length;
  for (const offset of [at.startOffset, at.startOffset - 1]) {
    if (offset < 0 || offset >= length) continue;
    const glyph = document.createRange();
    glyph.setStart(node, offset);
    glyph.setEnd(node, offset + 1);
    for (const box of Array.from(glyph.getClientRects())) if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return true;
  }
  return false;
}

// Whether this click, on `block` (an open block, marked), is a press on its blank space.
export function foldsAtClick(event: globalThis.MouseEvent, block: HTMLElement, press: Press | null): boolean {
  if (event.defaultPrevented || event.button !== 0 || event.detail !== 1) return false;
  if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (press === null || Math.hypot(event.clientX - press.x, event.clientY - press.y) > SLOP_PX) return false;
  const target = event.target;
  if (!(target instanceof Element) || target.closest(`[${FOLD_ON_CLICK}]`) !== block) return false; // an inner open block's
  if (interactiveWithin(target, block)) return false;
  if (selectionTouches(block)) return false;
  return !onText(block.ownerDocument, event.clientX, event.clientY);
}

// The block's props: spread on its root element, around its head (`head`, the toggle) and its body.
export function useFoldOnClick(open: boolean, fold: () => void, head: RefObject<HTMLElement | null>) {
  const press = useRef<Press | null>(null);
  return {
    [FOLD_ON_CLICK]: open ? '' : undefined,
    onMouseDown: (event: MouseEvent<HTMLElement>) => {
      press.current = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      const from = press.current;
      press.current = null;
      if (!open || !foldsAtClick(event.nativeEvent, event.currentTarget, from)) return;
      fold();
      const toggle = head.current;
      if (!toggle) return;
      toggle.focus({ preventScroll: true });
      toggle.scrollIntoView?.({ block: 'nearest' });
    },
  };
}
