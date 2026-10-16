// The reader's place through an older page. MAWS's list keeps the reader where they were across a change at its top
// edge by the row under the reader's offset (TanStack's `anchorTo: 'end'`, keyed by row id). An older page rebuilds the
// transcript, and the rows at the top of what was held — the oldest turn's time and divider rows, keyed by its turn —
// change id once the page holds the turn's prompt (`turn:e<event>` becomes `turn:<uuid>`): the row under a reader at
// the top is exactly the one whose key goes, the list finds no anchor, and the reader is thrown to the top of the page.
// So the pane keeps its own anchor: the first row in view whose id outlives a rebuild, and how far below the viewport's
// top it sat. The page's rows are the first rows drawn after the request is answered (rows that land while it is out
// are live ones, beneath the reader, and settle nothing here); when they are, the scroller moves by however far that
// row moved (nothing, when the list's anchor held). A row the list has not rendered (a page longer than its overscan)
// is jumped to by index, and the offset is finished once the list has drawn and measured it.
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';

/** Rows keyed by their turn (which a rebuild can rename) or drawn by the stream (which a row replaces). */
const VOLATILE = /^(time|divider|desk-stream):/;
/** What only a reader does to the scroller (the list's own scrolling raises none of it): their move ends a correction. */
const INTENT = ['wheel', 'touchstart', 'pointerdown'] as const;
const NAVIGATION_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
/** Frames the offset must hold, after an index jump, before the place is the list's again; and the most it waits. */
const STEADY_FRAMES = 5;
const MAX_FRAMES = 120;

export type Place = { id: string; offset: number };

function placeOf(scroller: HTMLElement): Place | null {
  const top = scroller.getBoundingClientRect().top;
  let best: Place | null = null;
  for (const element of scroller.querySelectorAll<HTMLElement>('[data-row-id]')) {
    const id = element.getAttribute('data-row-id')!;
    if (VOLATILE.test(id)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= top) continue; // above the viewport
    const offset = rect.top - top;
    if (best === null || offset < best.offset) best = { id, offset };
  }
  return best;
}

/** How far the kept row sits from where it was, or null while the list has not drawn it. */
function driftOf(scroller: HTMLElement, kept: Place): number | null {
  const element = scroller.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(kept.id)}"]`);
  return element ? element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - kept.offset : null;
}

/** Moves the scroller back by the kept row's drift; whether the row was drawn to move by. */
function settle(scroller: HTMLElement, kept: Place): boolean {
  const drift = driftOf(scroller, kept);
  if (drift === null) return false;
  if (drift !== 0) scroller.scrollBy({ top: drift, behavior: 'instant' });
  return true;
}

export function useKeepPlaceThroughOlderRows(list: RefObject<TranscriptListHandle | null>, rows: readonly Row[], loadingOlder: boolean): void {
  const place = useRef<Place | null>(null);
  const asked = useRef(false); // an older page is on its way
  const landed = useRef(false); // it was answered; its rows are the next drawn
  const correcting = useRef<number | null>(null); // the frame request of an offset being finished after an index jump

  // The reader's place as of their last scroll (rows drawn beneath it, the stream included, do not move it).
  useEffect(() => {
    const scroller = list.current?.scrollElement;
    if (!scroller) return;
    const scrolled = () => {
      if (correcting.current === null) place.current = placeOf(scroller);
    };
    // A reader who wheels, touches, presses on the list or its scrollbar, or pages with the keys takes their place back:
    // a correction still running stops, and their scroll is their place. The list's own scrolling (its jump, its
    // realignments while it measures) raises no such event, so it never stops one.
    const yieldToReader = () => {
      if (correcting.current === null) return;
      cancelAnimationFrame(correcting.current);
      correcting.current = null;
    };
    const keyed = (event: KeyboardEvent) => {
      if (NAVIGATION_KEYS.has(event.key)) yieldToReader();
    };
    scrolled();
    scroller.addEventListener('scroll', scrolled, { passive: true });
    for (const kind of INTENT) scroller.addEventListener(kind, yieldToReader, { passive: true });
    scroller.addEventListener('keydown', keyed);
    return () => {
      scroller.removeEventListener('scroll', scrolled);
      for (const kind of INTENT) scroller.removeEventListener(kind, yieldToReader);
      scroller.removeEventListener('keydown', keyed);
      yieldToReader();
    };
  }, [list]);

  // Before the rows' layout effect below, so a render that brings both the answer and its rows restores at once.
  useLayoutEffect(() => {
    if (loadingOlder) asked.current = true;
    else if (asked.current) {
      asked.current = false;
      landed.current = true;
    }
  }, [loadingOlder]);

  // After the list's own layout for the new rows (a child's layout effects run first).
  useLayoutEffect(() => {
    const handle = list.current;
    const scroller = handle?.scrollElement;
    if (!handle || !scroller) return;
    const kept = place.current;
    if (landed.current) {
      // These are the page's rows. A reader the list holds at the end, or one with no row in view, is the list's.
      landed.current = false;
      const index = kept === null || handle.following ? -1 : rows.findIndex((row) => row.id === kept.id);
      if (kept !== null && index >= 0 && !settle(scroller, kept)) {
        handle.scrollToIndex(index, 'start');
        finishAfterJump(scroller, kept);
        return;
      }
    }
    if (correcting.current === null) place.current = placeOf(scroller);

    // The list jumps to the row and draws it over the next frames (measuring rows it had guessed, and scrolling again
    // while its target moves): the offset is moved back each frame until it holds.
    function finishAfterJump(scroller: HTMLElement, kept: Place): void {
      let frames = 0;
      let steady = 0;
      const frame = () => {
        frames += 1;
        const drift = driftOf(scroller, kept);
        if (drift !== null && Math.abs(drift) < 1) steady += 1;
        else {
          steady = 0;
          if (drift !== null) scroller.scrollBy({ top: drift, behavior: 'instant' });
        }
        if (steady >= STEADY_FRAMES || frames >= MAX_FRAMES) {
          correcting.current = null;
          place.current = placeOf(scroller);
        } else correcting.current = requestAnimationFrame(frame);
      };
      settle(scroller, kept); // drawn at once when the list renders it in the jump's own pass
      correcting.current = requestAnimationFrame(frame);
    }
  }, [list, rows]);
}
