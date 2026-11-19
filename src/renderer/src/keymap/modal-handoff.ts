// The one handoff from a modal to an action that moves the keyboard (UX wave U6b-3b,
// docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, Decision Log 16). A Radix modal traps focus, so an action
// that puts the keyboard somewhere outside it cannot run while it is open: the element it asks for never takes the
// keyboard, and the place it records for later is the modal's own field, gone once the modal closes.
//
// A modal that holds nothing a person would lose (the Command palette, Keyboard shortcuts) *lends* itself: it draws its
// content with a `modalHandoff`, and an action invoked while the keyboard is in it, by its own row or from the menu or a
// key, closes it and runs from its close, once Radix has given the keyboard back to its opener (`handOffModal`, or the
// handoff's own `closeThen`). Every other modal keeps the keyboard: `modalKeepsKeyboard` says so while one holds it, and
// `subscribeModalKeyboard` tells when that may have changed, so an action can stay out of the menu while it does.
//
// "A modal is open" is Radix's own lock: while any modal layer is mounted (a dialog, an alert dialog, a menu or a popover
// drawn modal) Radix sets `pointer-events: none` on the body, and takes it off when the last one goes. The modal that holds
// the keyboard is the one the focused element is in, since a modal traps focus. A lender opened while the lock was
// already on is over another modal (the task review's finding: a palette over a sheet): it remembers the layers it found
// in the page, other lenders' left out, and does not lend while any of them is still there, whatever holds the keyboard.
import type { RefCallback } from 'react';

interface Lender {
  content: HTMLElement;
  over: readonly Element[]; // the layers in the page when it opened over another modal; none when nothing modal was open
  closeThen(run: () => void): void;
}

const lenders = new Set<Lender>();
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());

const locked = () => document.body.style.pointerEvents === 'none';

// A layer Radix portals into the body: a dialog's content itself, or a popper's wrapper around a menu or a popover (never
// a hover card or a tooltip). A dialog's overlay is no layer.
const isLayer = (element: Element): boolean =>
  element.matches('[role="dialog"], [role="alertdialog"]') ||
  (element.matches('[data-radix-popper-content-wrapper]') && element.querySelector('[role="menu"], [role="dialog"]:not([data-hover-card])') !== null);

// The lender the keyboard is in, when nothing it opened over is still in the page.
function lenderHolding(): Lender | null {
  const active = document.activeElement;
  if (active === null) return null;
  for (const lender of lenders) if (lender.content.contains(active)) return lender.over.some((layer) => layer.isConnected) ? null : lender;
  return null;
}

/** True while a modal holds the keyboard that does not lend itself, or lies under one that does: an action that moves the keyboard stays disabled. */
export function modalKeepsKeyboard(): boolean {
  return locked() && lenderHolding() === null;
}

/**
 * When the keyboard is in a modal that lends itself, closes it and runs `run` from its close; true when it did. An action
 * that moves the keyboard calls it first and, when it answers true, returns: it runs again from the close.
 */
export function handOffModal(run: () => void): boolean {
  const lender = lenderHolding();
  if (lender === null) return false;
  lender.closeThen(run);
  return true;
}

// Radix's lock is a change of the body's style; a layer opening or closing, a change of the body's children; the keyboard
// entering a modal, or leaving one, is a focus.
let observer: MutationObserver | null = null;

/** Calls `listener` whenever `modalKeepsKeyboard` may have changed; returns its removal. */
export function subscribeModalKeyboard(listener: () => void): () => void {
  listeners.add(listener);
  if (observer === null) {
    observer = new MutationObserver(tell);
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'], childList: true });
    document.addEventListener('focusin', tell, true);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || observer === null) return;
    observer.disconnect();
    observer = null;
    document.removeEventListener('focusin', tell, true);
  };
}

export interface ModalHandoff {
  /** The ref of the modal's content: it lends itself while drawn. */
  lend: RefCallback<HTMLElement>;
  /** Closes the modal and runs `run` from its close (the modal's own row of an action that moves the keyboard). */
  closeThen(run: () => void): void;
  /** Called from the content's `onCloseAutoFocus`, after the modal's own return of the keyboard: runs what was handed off. */
  closed(): void;
}

/**
 * The handoff of a modal that holds nothing a person would lose, whose `close` closes it. Made once per modal (a
 * component keeps it with `useState(() => modalHandoff(close))`).
 */
export function modalHandoff(close: () => void): ModalHandoff {
  let then: (() => void) | null = null;
  const closeThen = (run: () => void) => {
    then = run;
    close();
  };
  return {
    lend: (content) => {
      if (content === null) return;
      // Attached as the content mounts, before Radix's effect locks the body for it: a lock now is another modal's. Another
      // lender's content is no layer it is over: both may be closed by the handoff, one from the other's close.
      const lent = new Set<Element>([...lenders].map((other) => other.content));
      const over = locked() ? [...document.body.children].filter((element) => element !== content && !lent.has(element) && isLayer(element)) : [];
      const lender: Lender = { content, over, closeThen };
      lenders.add(lender);
      return () => void lenders.delete(lender);
    },
    closeThen,
    closed: () => {
      const run = then;
      then = null;
      run?.();
    },
  };
}
