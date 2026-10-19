// P4-B2's spike S-IME (docs/doperpowers/plans/2026-10-19-p4-smoothing.md §4.4, §4.10; spikes/p4-click-model/findings.txt):
// the ARMED prototype's switch and its registry. ARMED is a selection of exactly one text element whose text box is
// already mounted, focused and editable with its caret hidden, so the input method composes the first key in place
// (Chromium on macOS gives a focused non-editable element no input context, and tells AppKit about a newly focused
// editable only after 100 ms). The prototype is off unless the presentations' e2e seam turns it on; with it off every
// path is P3's. It is not §4.4's state machine: only enough to answer the spike's three questions.
//
// Two modes. `clear`: the caret sits hidden at the start, and the first printable or keyCode-229 keydown clears the
// content before the key's own insertion or composition (T10, T11). `select`: the whole text sits selected with the
// selection drawn transparent, and the key replaces it natively, the input method's composition included (the fallback
// if the platform refuses the clear on the real Mac).
import { useSyncExternalStore } from 'react';

export type ArmedMode = 'clear' | 'select';

let mode: ArmedMode | null = null;
const listeners = new Set<() => void>();

/** Turns the prototype on in one mode, or off (null). The e2e seam's alone. */
export function setArmedPrototype(next: ArmedMode | null): void {
  if (next === mode) return;
  mode = next;
  for (const listener of [...listeners]) listener();
}
export const armedMode = (): ArmedMode | null => mode;
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const useArmedMode = (): ArmedMode | null => useSyncExternalStore(subscribe, armedMode);

/** The armed text box's acts, which the stage's keys reach while it is armed. */
export interface ArmedBox {
  elementId: string;
  /** The editor's root, the focused element while armed. */
  root: HTMLElement;
  /** Whether the box is armed now (false once a key or a press turned it into an edit). */
  armed(): boolean;
  /** T10, T11: the content cleared (mode `clear`), then the edit begins, with no remount and no focus change. */
  replace(): void;
  /** T12: the edit begins with all the text selected. */
  editAll(): void;
}

const boxes = new WeakMap<object, ArmedBox>();
/** The text box of `session` registers itself while mounted; the returned call unregisters it. */
export function registerArmed(session: object, box: ArmedBox): () => void {
  boxes.set(session, box);
  return () => {
    if (boxes.get(session) === box) boxes.delete(session);
  };
}
/** The armed box of `session`, if its text box is mounted and armed now. */
export function armedBox(session: object): ArmedBox | null {
  const box = boxes.get(session);
  return box && box.armed() && box.root.isConnected ? box : null;
}
