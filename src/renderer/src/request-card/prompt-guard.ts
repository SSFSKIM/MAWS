// Whether a press may answer a permission prompt at a transcript's end (UX wave U1b, Interfaces §F; decisions 7 and 18).
// Two tests decide it. *Whose focus* (`promptFocused`): the prompt's own transcript row, the session's own composer in
// the row's pane, or nothing with that pane holding the keyboard. *The guard* (`watchPrompt`): one per open card, watching
// the card and its row of decision buttons, so a chord meant for what held the keyboard before the prompt could be seen
// answers nothing. Its times, each moved by the event named:
// - `shownAt`: the watch starts, or the card passes from out of view to in view;
// - `wholeAt`: the buttons' row passes from not wholly visible to wholly visible, also at a press that finds it whole
//   while the last observed state was not (the press counts as that moment);
// - `clearedAt`: an open menu, dialog or popover (the dispatcher's `OPEN_OVERLAY`) is seen open, then no longer.
// The card becoming answerable again (§F's `liveAt`) is the start of a new watch: the card starts one each time it becomes
// live (`RequestCard`), so that time is the watch's own start.
// *In view* and *whole* are Claude Desktop's two tests (`shared-192`:22930-23031, :22950-22981 in app-5.1231.2): the
// element is rendered, its rectangle is clipped by every scrolling ancestor and by the window, and it is in view when
// anything is left, whole when the whole rectangle is left to within half a pixel and the element at each of its four
// inner corners is the row or inside it (a row another element covers is not whole). They are re-tested on the next
// animation frame after an intersection change, a scroll or a resize (as the reference watches them, :23033-23075), or a
// change to the page, and again at each press.
import type { AppSessionId } from '@shared/graph/ids';
import { useDictationStore } from '../composer/dictation/store';
import { BUTTON_LIKE_INPUTS, OPEN_OVERLAY } from '../keymap/dispatcher';
import { useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';

export const PROMPT_GRACE_MS = 400;

export interface PromptGuard {
  mayDeny(now: number): boolean;
  mayAllow(now: number): boolean;
  dispose(): void;
}

const CLIPS = new Set(['auto', 'scroll', 'hidden', 'clip']);
const HALF_PIXEL = 0.5;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// What of the element's rectangle is left once every scrolling ancestor and the window clip it; null when nothing is.
function visible(element: HTMLElement): Box | null {
  if (!element.isConnected || element.checkVisibility?.() === false) return null;
  const r = element.getBoundingClientRect();
  const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  for (let ancestor = element.parentElement; ancestor !== null && ancestor !== document.body && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    const clipsX = CLIPS.has(style.overflowX);
    const clipsY = CLIPS.has(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const a = ancestor.getBoundingClientRect();
    if (clipsX) [box.left, box.right] = [Math.max(box.left, a.left), Math.min(box.right, a.right)];
    if (clipsY) [box.top, box.bottom] = [Math.max(box.top, a.top), Math.min(box.bottom, a.bottom)];
  }
  [box.left, box.top] = [Math.max(box.left, 0), Math.max(box.top, 0)];
  [box.right, box.bottom] = [Math.min(box.right, window.innerWidth), Math.min(box.bottom, window.innerHeight)];
  return box.right > box.left && box.bottom > box.top ? box : null;
}

/** Any sliver of the element is visible. */
export const inView = (element: HTMLElement): boolean => visible(element) !== null;

function whole(element: HTMLElement): boolean {
  const seen = visible(element);
  if (seen === null) return false;
  const r = element.getBoundingClientRect();
  const uncut = Math.abs(seen.left - r.left) <= HALF_PIXEL && Math.abs(seen.top - r.top) <= HALF_PIXEL && Math.abs(seen.right - r.right) <= HALF_PIXEL && Math.abs(seen.bottom - r.bottom) <= HALF_PIXEL;
  if (!uncut) return false;
  const corners = [
    [r.left + 1, r.top + 1],
    [r.right - 1, r.top + 1],
    [r.left + 1, r.bottom - 1],
    [r.right - 1, r.bottom - 1],
  ] as const;
  return corners.every(([x, y]) => {
    const hit = document.elementFromPoint(x, y);
    return hit !== null && element.contains(hit);
  });
}

const overlayOpen = () => document.querySelector(OPEN_OVERLAY) !== null;

/** Watch one open prompt's card and its row of decision buttons until disposed. */
export function watchPrompt(card: HTMLElement, buttons: HTMLElement, graceMs: number = PROMPT_GRACE_MS): PromptGuard {
  const startedAt = performance.now();
  let shownAt = startedAt;
  let wholeAt = -Infinity;
  let clearedAt = -Infinity;
  let shown = inView(card);
  let isWhole = whole(buttons);
  if (isWhole) wholeAt = startedAt;
  let overlay = overlayOpen();

  const observe = (now: number) => {
    const nowShown = inView(card);
    if (nowShown && !shown) shownAt = now;
    shown = nowShown;
    const nowWhole = whole(buttons);
    if (nowWhole && !isWhole) wholeAt = now;
    isWhole = nowWhole;
  };
  const overlays = (now: number) => {
    const open = overlayOpen();
    if (overlay && !open) clearedAt = now;
    overlay = open;
  };
  let frame: number | null = null;
  const schedule = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      observe(performance.now());
    });
  };
  const intersections = new IntersectionObserver(schedule);
  intersections.observe(card);
  intersections.observe(buttons);
  // a menu opening or closing, an element laid over the buttons: heard as the page changes
  const mutations = new MutationObserver(() => {
    overlays(performance.now());
    schedule();
  });
  mutations.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] });
  window.addEventListener('scroll', schedule, { capture: true, passive: true });
  window.addEventListener('resize', schedule);

  // at a press: the watch as it is now, so a change no event announced counts from the press
  const refresh = (now: number) => {
    overlays(now);
    observe(now);
  };
  return {
    mayDeny(now) {
      refresh(now);
      return shown && now - Math.max(shownAt, clearedAt) >= graceMs;
    },
    mayAllow(now) {
      refresh(now);
      return shown && isWhole && now - Math.max(shownAt, wholeAt, clearedAt) >= graceMs;
    },
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      intersections.disconnect();
      mutations.disconnect();
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    },
  };
}

// Text entry and buttons, as the dispatcher refuses them: their keys are their own.
const isTextEntry = (element: Element) =>
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement ||
  (element instanceof HTMLInputElement && !BUTTON_LIKE_INPUTS.has(element.type)) ||
  element.closest('[contenteditable]:not([contenteditable="false"])') !== null;
const isButtonOrLink = (element: Element) =>
  element.closest('button, a[href], [role="button"], [role="link"]') !== null || (element instanceof HTMLInputElement && BUTTON_LIKE_INPUTS.has(element.type));

// The composer's own lists over the box (the `@` and `/` popups, which the editor portals marked as its key sink) and its
// history line (while ↑ recalls or Ctrl+R searches): while one shows, the box's keys are the box's.
const COMPOSER_POPUP = '[data-key-sink="composer"] [role="listbox"], [data-key-sink="composer"][role="listbox"]';
const HISTORY_LINE = '[aria-label="Prompt history"]';

/**
 * Whether the keyboard is where a press may answer the prompt drawn in `row` (§F, "Whose focus"): on `row` itself, or
 * inside it on what is not a text field, a button or a link; in the session's own composer in `row`'s pane, while none of
 * the composer's lists or its history line shows and no dictation is live in it; or on nothing, with `row`'s pane the one
 * the shell says holds the keyboard. Anything else is refused: another request's row, any other row, a child transcript,
 * another field, another pane. A transcript outside a pane has the first case only.
 */
export function promptFocused(row: HTMLElement, appSessionId: AppSessionId): boolean {
  const focused = document.activeElement;
  const pane = row.closest<HTMLElement>('[data-pane]');
  if (focused === null || focused === document.body) return pane !== null && pane.dataset.pane === String(currentSet(useLayout.getState().main).focusedPane);
  if (row.contains(focused)) return focused === row || !(isTextEntry(focused) || isButtonOrLink(focused));
  if (pane === null) return false;
  const box = focused.closest<HTMLElement>('[data-key-sink="composer"]');
  const composer = box?.closest<HTMLElement>('[data-composer]') ?? null;
  if (box === null || composer === null || composer.dataset.composer !== appSessionId || !pane.contains(composer) || box.closest('.transcript-row') !== null) return false;
  if (document.querySelector(COMPOSER_POPUP) !== null || box.querySelector(HISTORY_LINE) !== null) return false;
  return useDictationStore.getState().capture?.appSessionId !== appSessionId;
}

/** Whether the session's composer is empty, as the box that greys Send says; no composer mounted reads as empty. */
export const composerEmpty = (appSessionId: AppSessionId): boolean => useComposerStore.getState().focusTargets.get(appSessionId)?.empty?.() ?? true;
