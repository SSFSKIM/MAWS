// The one handoff from a modal to an action that moves the keyboard (UX wave U6b-3b,
// docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, Decision Log 16). A Radix modal traps focus, so an action
// that puts the keyboard somewhere outside it cannot run while it is open: the element it asks for never takes the
// keyboard, and the place it records for later is the modal's own field, gone once the modal closes.
//
// A modal that holds nothing a person would lose (the Command palette, Keyboard shortcuts) *lends* itself: it draws its
// content with `useModalHandoff`, and an action invoked while the keyboard is in it, by its own row or from the menu or a
// key, closes it and runs from its close, once Radix has given the keyboard back to its opener (`handOffModal`, or the
// hook's `closeThen`). Every other modal keeps the keyboard: `modalKeepsKeyboard` says so while one holds it, and
// `subscribeModalKeyboard` tells when that may have changed, so an action can stay out of the menu while it does.
//
// "A modal is open" is Radix's own lock: while any modal layer is mounted (a dialog, an alert dialog, a menu or a popover
// drawn modal) Radix sets `pointer-events: none` on the body, and takes it off when the last one goes. The modal that holds
// the keyboard is the one the focused element is in, since a modal traps focus.
import { useRef, type RefCallback } from 'react';

interface Lender {
  content: HTMLElement;
  closeThen(run: () => void): void;
}

const lenders = new Set<Lender>();
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());

function lenderHolding(): Lender | null {
  const active = document.activeElement;
  if (active === null) return null;
  for (const lender of lenders) if (lender.content.contains(active)) return lender;
  return null;
}

/** True while a modal holds the keyboard that does not lend itself: an action that moves the keyboard stays disabled. */
export function modalKeepsKeyboard(): boolean {
  return document.body.style.pointerEvents === 'none' && lenderHolding() === null;
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

// Radix's lock is a change of the body's style; the keyboard entering a modal, or leaving one, is a focus.
let observer: MutationObserver | null = null;

/** Calls `listener` whenever `modalKeepsKeyboard` may have changed; returns its removal. */
export function subscribeModalKeyboard(listener: () => void): () => void {
  listeners.add(listener);
  if (observer === null) {
    observer = new MutationObserver(tell);
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] });
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
  /** The modal's content: it lends itself while drawn. */
  ref: RefCallback<HTMLElement>;
  /** The content's `onCloseAutoFocus`: `restore` (the modal's own return of the keyboard), then what was handed off. */
  onCloseAutoFocus(event: Event): void;
  /** Closes the modal and runs `run` from its close (the modal's own row of an action that moves the keyboard). */
  closeThen(run: () => void): void;
}

/** For a modal that holds nothing a person would lose: `close` closes it; `restore` gives the keyboard back as it closes. */
export function useModalHandoff(close: () => void, restore: (event: Event) => void): ModalHandoff {
  const then = useRef<(() => void) | null>(null);
  const closeThen = (run: () => void) => {
    then.current = run;
    close();
  };
  return {
    ref: (content) => {
      if (content === null) return;
      const lender: Lender = { content, closeThen };
      lenders.add(lender);
      return () => void lenders.delete(lender);
    },
    onCloseAutoFocus: (event) => {
      restore(event);
      const run = then.current;
      then.current = null;
      run?.();
    },
    closeThen,
  };
}
