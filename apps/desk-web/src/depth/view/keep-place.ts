// The reader's place through an older page. MAWS's list keeps the reader where they were across a change at its top
// edge by the row under the reader's offset (TanStack's `anchorTo: 'end'`, keyed by row id). An older page rebuilds the
// transcript, and the rows at the top of what was held — the oldest turn's time and divider rows, keyed by its turn —
// change id once the page holds the turn's prompt (`turn:e<event>` becomes `turn:<uuid>`): the row under a reader at
// the top is exactly the one whose key goes, the list finds no anchor, and the reader is thrown to the top of the page.
// So the pane keeps its own anchor: the first row in view whose id outlives a rebuild, and how far below the viewport's
// top it sat, read when the page is answered. The page's rows are the first rows drawn after the answer (rows that land
// while it is out are live ones, beneath the reader, and settle nothing here); when they are, the scroller moves by
// however far that row moved (nothing, when the list's anchor held), and is held there frame by frame while the list
// measures the page's rows at their sizes, each of which, above the reader, moves them again. A row the list has not
// rendered (a page longer than its overscan) is jumped to by index first, then held the same way: its index among the
// rows the list draws (`indexOf`), which in the report are not the held rows (a closed working record stands for the
// rows it folds).
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import { watchReaderIntent } from './reader-intent';

/** Rows keyed by their turn (which a rebuild can rename: the report's working record too) or drawn by the stream (which a row replaces). */
const VOLATILE = /^(time|divider|owner-record|desk-stream):/;
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

/**
 * `rows` are the held rows, whose change says a page's rows are in; `indexOf` is a row's index in what the list draws
 * now (-1 when it draws none by that id).
 */
export function useKeepPlaceThroughOlderRows(list: RefObject<TranscriptListHandle | null>, rows: readonly Row[], loadingOlder: boolean, indexOf: (id: string) => number): void {
  const place = useRef<Place | null>(null);
  const asked = useRef(false); // an older page is on its way
  const landed = useRef(false); // it was answered; its rows are the next drawn
  const correcting = useRef<number | null>(null); // the frame request of an offset being held after a page
  const drawn = useRef(rows); // the rows the last layout below handled: the ones the list draws now

  // The reader's place as of their last scroll (rows drawn beneath it, the stream included, do not move it).
  useEffect(() => {
    const scroller = list.current?.scrollElement;
    if (!scroller) return;
    // A reader who wheels, touches, presses on the list or its scrollbar, or pages with the keys takes their place back
    // (`reader-intent.ts`): a correction still running stops, and their scroll is their place. The list's own scrolling
    // (its jump, its realignments while it measures) is none of that, so it never stops one.
    const yieldToReader = () => {
      if (correcting.current === null) return;
      cancelAnimationFrame(correcting.current);
      correcting.current = null;
    };
    const stopWatching = watchReaderIntent(scroller, yieldToReader); // ahead of `scrolled`: a reader's scroll stops the hold first
    const scrolled = () => {
      if (correcting.current === null) place.current = placeOf(scroller);
    };
    scrolled();
    scroller.addEventListener('scroll', scrolled, { passive: true });
    return () => {
      stopWatching();
      scroller.removeEventListener('scroll', scrolled);
      yieldToReader();
    };
  }, [list]);

  // Before the rows' layout effect below, so a render that brings both the answer and its rows restores at once. The
  // place is armed at the answer, from what is drawn then: since the reader's last scroll a row above them may have
  // been measured at its size rather than its guess (MAWS's list guesses a turn's time row at 56 px), which moves no
  // scroll position and so leaves no scroll event to read it by. The page's own rows are not drawn yet when the answer
  // comes alone (the rebuilt source installs later); when they come in the same render, the place stays as it was.
  useLayoutEffect(() => {
    if (loadingOlder) {
      asked.current = true;
      return;
    }
    if (!asked.current) return;
    asked.current = false;
    landed.current = true;
    const scroller = list.current?.scrollElement;
    if (scroller && correcting.current === null && rows === drawn.current) place.current = placeOf(scroller) ?? place.current;
  }, [list, loadingOlder, rows]);

  // After the list's own layout for the new rows (a child's layout effects run first).
  useLayoutEffect(() => {
    const handle = list.current;
    const scroller = handle?.scrollElement;
    if (!handle || !scroller) return;
    const kept = place.current;
    if (landed.current) {
      // These are the page's rows. A reader the list holds at the end, or one with no row in view, is the list's.
      landed.current = false;
      const index = kept === null || handle.following ? -1 : indexOf(kept.id);
      if (kept !== null && index >= 0) {
        // Drawn or not, the page's rows go on being measured over the next frames (the list draws them at its guesses,
        // then at their size), each measurement above the reader moving them: the place is held until it holds.
        if (!settle(scroller, kept)) handle.scrollToIndex(index, 'start');
        holdPlace(scroller, kept);
        drawn.current = rows;
        return;
      }
    }
    if (correcting.current === null) place.current = placeOf(scroller);
    drawn.current = rows;

    // The list draws the page over the next frames (measuring rows it had guessed, and scrolling again while a jump's
    // target moves): the offset is moved back each frame until it holds.
    function holdPlace(scroller: HTMLElement, kept: Place): void {
      if (correcting.current !== null) cancelAnimationFrame(correcting.current);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `indexOf` is read when the rows change, as the list draws them then
  }, [list, rows]);
}
