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
// inner corners is the row or inside it (a row another element covers is not whole). The page's geometry is read in full
// only when the watch starts and at a press (which stamps what it finds changed and refuses). Between them the guard
// reads no layout of its own (the architect's ruling of 2026-11-15 UTC on M4's second concern): one intersection observer
// of the card and the buttons says what a scroll, a resize or the card's own changes did (the browser clips by the window
// and the scrolling ancestors); what an entry cannot see is something laid over the buttons, so the four hit tests run
// again only when the buttons come wholly into the viewport and when the page's top layer changes (an element added to or
// taken from the body, where overlays, menus and notices are portalled). An overlay's open and close are heard from the
// `data-state` it toggles.
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
// An intersection ratio above nothing and below any sliver a card can show (a pixel of a card a million pixels tall).
const SLIVER = 1e-6;
const HALF_PIXEL = 0.5;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
// Something of the element is shown: what is left of its rectangle has area. The one test of *in view*, whether the page
// is read at a press or an intersection entry reports it (a target that only touches the view's edge intersects by the
// browser's word, with an empty rectangle, and is not shown).
const hasArea = (box: Box) => box.right > box.left && box.bottom > box.top;
// What is left of a rectangle is the whole of it, to within half a pixel.
const within = (seen: Box, r: Box) => Math.abs(seen.left - r.left) <= HALF_PIXEL && Math.abs(seen.top - r.top) <= HALF_PIXEL && Math.abs(seen.right - r.right) <= HALF_PIXEL && Math.abs(seen.bottom - r.bottom) <= HALF_PIXEL;

// What of the element's rectangle is left once every scrolling ancestor and the window clip it; null when nothing is.
function visible(element: HTMLElement): Box | null {
  if (!element.isConnected || element.checkVisibility?.() === false) return null;
  const r = element.getBoundingClientRect();
  const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  for (let ancestor = element.parentElement; ancestor !== null && ancestor !== document.body && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
    const style = window.getComputedStyle(ancestor);
    const clipsX = CLIPS.has(style.overflowX);
    const clipsY = CLIPS.has(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const a = ancestor.getBoundingClientRect();
    if (clipsX) [box.left, box.right] = [Math.max(box.left, a.left), Math.min(box.right, a.right)];
    if (clipsY) [box.top, box.bottom] = [Math.max(box.top, a.top), Math.min(box.bottom, a.bottom)];
  }
  [box.left, box.top] = [Math.max(box.left, 0), Math.max(box.top, 0)];
  [box.right, box.bottom] = [Math.min(box.right, window.innerWidth), Math.min(box.bottom, window.innerHeight)];
  return hasArea(box) ? box : null;
}

/** Any sliver of the element is visible. */
export const inView = (element: HTMLElement): boolean => visible(element) !== null;

// The four inner corners of `r` (1 px in) are the row or inside it: nothing is laid over it.
function uncovered(element: HTMLElement, r: DOMRectReadOnly): boolean {
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

// The row wholly inside the viewport (`entirely`), and moreover uncovered (`whole`): the full reading of the page.
function measure(element: HTMLElement): { entirely: boolean; whole: boolean } {
  const seen = visible(element);
  const r = element.getBoundingClientRect();
  const entirely = seen !== null && within(seen, r);
  return { entirely, whole: entirely && uncovered(element, r) };
}

const overlayOpen = () => document.querySelector(OPEN_OVERLAY) !== null;

// An intersection entry's own rectangles say the target is wholly inside the viewport (within half a pixel).
const entire = (entry: IntersectionObserverEntry) =>
  entry.isIntersecting && within(entry.intersectionRect, entry.boundingClientRect);

/** Watch one open prompt's card and its row of decision buttons until disposed. */
export function watchPrompt(card: HTMLElement, buttons: HTMLElement, graceMs: number = PROMPT_GRACE_MS): PromptGuard {
  const startedAt = performance.now();
  let shownAt = startedAt;
  let wholeAt = -Infinity;
  let clearedAt = -Infinity;
  let shown = inView(card);
  const first = measure(buttons);
  let entirely = first.entirely; // the buttons wholly inside the viewport, as last reported (what lies over them aside)
  let isWhole = first.whole;
  if (isWhole) wholeAt = startedAt;
  let overlay = overlayOpen();

  const see = (now: number, nowShown: boolean, nowWhole: boolean) => {
    if (nowShown && !shown) shownAt = now;
    shown = nowShown;
    if (nowWhole && !isWhole) wholeAt = now;
    isWhole = nowWhole;
  };
  const overlays = (now: number) => {
    const open = overlayOpen();
    if (overlay && !open) clearedAt = now;
    overlay = open;
  };

  const intersections = new IntersectionObserver(
    (entries) => {
      const now = performance.now();
      let nowShown = shown;
      let nowWhole = isWhole;
      for (const entry of entries) {
        if (entry.target === card) nowShown = entry.isIntersecting && hasArea(entry.intersectionRect);
        if (entry.target !== buttons) continue;
        const nowEntirely = entire(entry);
        nowWhole = nowEntirely && (entirely && isWhole ? true : uncovered(buttons, entry.boundingClientRect));
        entirely = nowEntirely;
      }
      see(now, nowShown, nowWhole);
    },
    // `SLIVER`: the card's first area, as an entry of its own (from touching the edge to a sliver crosses no other)
    { threshold: [0, SLIVER, 1] },
  );
  intersections.observe(card);
  intersections.observe(buttons);
  // the top layer: an element added to or taken from the body may lie over the buttons, or uncover them
  const topLayer = new MutationObserver(() => {
    const now = performance.now();
    overlays(now);
    if (entirely) see(now, shown, uncovered(buttons, buttons.getBoundingClientRect()));
  });
  topLayer.observe(document.body, { childList: true });
  // an overlay opening or closing anywhere in the page (Radix toggles its content's `data-state`)
  const overlayStates = new MutationObserver(() => overlays(performance.now()));
  overlayStates.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state'] });

  // at a press: the page's geometry in full, so a change no observer reported counts from the press
  const refresh = (now: number) => {
    overlays(now);
    const buttonsNow = measure(buttons);
    entirely = buttonsNow.entirely;
    see(now, inView(card), buttonsNow.whole);
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
      intersections.disconnect();
      topLayer.disconnect();
      overlayStates.disconnect();
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

// The main pane a pane boundary stands for: its own index, or for the floating card's (`data-pane="card"`) the pane the
// card stands for, which it names (`data-card-pane`: the panel's card the focused pane, the split's its floating pane).
// So the shell's focused pane says which surface holds the keyboard, and at most one prompt takes a press from nothing:
// the main pane the card stands for draws no session of its own while the card draws it (`main/Pane.tsx`).
const paneOf = (pane: HTMLElement): string | undefined => (pane.dataset.pane === 'card' ? pane.dataset.cardPane : pane.dataset.pane);

/**
 * Whether the keyboard is where a press may answer the prompt drawn in `row` (§F, "Whose focus"): on `row` itself, or
 * inside it on what is not a text field, a button or a link; in the session's own composer in `row`'s pane, while none of
 * the composer's lists or its history line shows and no dictation is live in it; or on nothing, with `row`'s pane the one
 * the shell says holds the keyboard (for the floating card, the main pane it stands for). Anything else is refused: another request's row, any other row, a child transcript,
 * another field, another pane. A transcript outside a pane, and a child transcript's end (`from: 'row'`, the architect's
 * ruling of 2026-11-15 UTC: in one pane at most one end takes the composer's and no focus's presses), has the first case
 * only.
 */
export function promptFocused(row: HTMLElement, appSessionId: AppSessionId, from: 'pane' | 'row' = 'pane'): boolean {
  const focused = document.activeElement;
  const pane = from === 'pane' ? row.closest<HTMLElement>('[data-pane]') : null;
  if (focused === null || focused === document.body) return pane !== null && paneOf(pane) === String(currentSet(useLayout.getState().main).focusedPane);
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
