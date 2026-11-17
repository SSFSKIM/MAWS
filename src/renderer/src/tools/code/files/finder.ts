// Go to file (UX wave U6b-3b, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md, Interfaces §A and §C; M1).
//
// The action (decision 11; R5): `files.goToFile` (Go ▸ Go to file, ⌘P, the palette's row) is registered exactly while it
// can end with the keyboard in Files' field: the side column has a session and neither the Settings dialog nor the
// Overview is open. Its handler leaves an open page (root UC-12), records where the keyboard is (for Esc's second step),
// shows the session's Files (`showFiles`, which shows a hidden or collapsed column), marks the tab it lands in as finding
// (decision 9: that tab draws the tree column for the search, whatever its fold) and asks for the keyboard for that tab's
// field.
//
// The request for the keyboard (decision 10; sequence S2): one at most, for a taker that may not be drawn yet. A drawn
// taker is told at once (`useKeyboardRequest`), one drawn later takes it when it draws (`takeKeyboard`, true once). The
// person's next key or pointer press anywhere drops it, so the keyboard stays where that act put it; the menu's own key
// reaches the page before the action runs, so the press that made the request is never heard. M1 builds the field's
// taker; a file's view is M2's, on the same request.
import { useSyncExternalStore } from 'react';
import { registerAction } from '../../../keymap/actions-runtime';
import { surfaceSession } from '../../../panel/surface-model';
import { pageOpen, useLayout, type LayoutState } from '../../../stores/layout';
import { showFiles } from './tabs';
import { useTreeState } from './tree-state';

// ---- the request for the keyboard ---------------------------------------------------------------------------------------

export type KeyboardRequest = { into: 'filter'; tabId: string } | { into: 'file'; key: string };

const takerOf = (request: KeyboardRequest): string => (request.into === 'filter' ? `filter\n${request.tabId}` : `file\n${request.key}`);

let pending: { taker: string; made: number } | null = null;
let made = 0;
const takers = new Set<() => void>();
const tell = () => takers.forEach((taker) => taker());

// Ends the waiting request and takes down its pair of capture listeners on the window.
function end(): void {
  pending = null;
  window.removeEventListener('keydown', drop, true);
  window.removeEventListener('pointerdown', drop, true);
  tell();
}
function drop(): void {
  if (pending !== null) end();
}

/** Replaces any earlier request; the next keydown or pointerdown anywhere drops it. */
export function requestKeyboard(request: KeyboardRequest): void {
  made += 1;
  pending = { taker: takerOf(request), made };
  window.addEventListener('keydown', drop, true);
  window.addEventListener('pointerdown', drop, true);
  tell();
}

/** True once, for the taker the waiting request names; false for any other, and while none waits. */
export function takeKeyboard(request: KeyboardRequest): boolean {
  if (pending?.taker !== takerOf(request)) return false;
  end();
  return true;
}

const subscribe = (taker: () => void) => {
  takers.add(taker);
  return () => void takers.delete(taker);
};

/** Changes when a request for this taker is made (0 while none waits for it), so a drawn taker runs its effect. */
export function useKeyboardRequest(request: KeyboardRequest | null): number {
  const taker = request === null ? null : takerOf(request);
  return useSyncExternalStore(subscribe, () => (pending !== null && pending.taker === taker ? pending.made : 0));
}

// ---- where the keyboard was when ⌘P was pressed (Esc's second step) -----------------------------------------------------

const FILTER_SELECTOR = '[data-files-filter]'; // the field's marker (Interfaces §A)
let before: HTMLElement | null = null;

// M1 decision 2 and S2: never the page's body (nothing held it), and never a field of Go to file (⌘P pressed again from
// the field keeps the element the first press found).
function recordKeyboard(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body || active.matches(FILTER_SELECTOR)) return;
  before = active;
}

/** Esc in an empty field: the keyboard back to the element ⌘P found it in, while that element is in the page. */
export function giveKeyboardBack(): boolean {
  const element = before;
  before = null;
  if (element === null || !element.isConnected) return false;
  element.focus({ preventScroll: true });
  return true;
}

// ---- the action -------------------------------------------------------------------------------------------------------

/** Decision 11 (R5): a session for the side column, no Settings dialog, no Overview. */
export function canGoToFile(state: LayoutState): boolean {
  return surfaceSession(state) !== null && state.settings === null && !state.overviewOpen;
}

/** The handler: the page left, the keyboard's place recorded, Files shown, its tab finding, the request for its field. */
export function goToFile(): void {
  const state = useLayout.getState();
  if (!canGoToFile(state)) return;
  const session = surfaceSession(state)!;
  if (pageOpen(state)) state.closeDestination();
  recordKeyboard();
  const tabId = showFiles(session);
  useTreeState.getState().setFinding(session, tabId);
  requestKeyboard({ into: 'filter', tabId });
}

/** Keeps `files.goToFile` registered while `canGoToFile` holds; returns its removal. */
export function connectGoToFile(): () => void {
  let unregister: (() => void) | null = null;
  const sync = () => {
    const can = canGoToFile(useLayout.getState());
    if (can && unregister === null) unregister = registerAction('files.goToFile', goToFile);
    else if (!can && unregister !== null) {
      unregister();
      unregister = null;
    }
  };
  sync();
  const unsubscribe = useLayout.subscribe(sync); // the side column's session, the dialog and the Overview
  return () => {
    unsubscribe();
    unregister?.();
    unregister = null;
  };
}
