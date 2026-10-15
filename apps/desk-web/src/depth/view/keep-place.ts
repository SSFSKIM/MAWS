// The reader's place through an older page. MAWS's list keeps the reader where they were across a change at its top
// edge by the row under the reader's offset (TanStack's `anchorTo: 'end'`, keyed by row id). An older page rebuilds the
// transcript, and the rows at the top of what was held — the oldest turn's time and divider rows, keyed by its turn —
// change id once the page holds the turn's prompt (`turn:e<event>` becomes `turn:<uuid>`): the row under a reader at
// the top is exactly the one whose key goes, the list finds no anchor, and the reader is thrown to the top of the page.
// So the pane keeps its own anchor: the first row in view whose id outlives a rebuild, and how far below the viewport's
// top it sat; when the page lands, the scroller moves by however far that row moved (nothing, when the list's anchor
// held). A row the list has not rendered (a page longer than its overscan) is scrolled to by index.
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Row } from '../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';

/** Rows keyed by their turn (which a rebuild can rename) or drawn by the stream (which a row replaces). */
const VOLATILE = /^(time|divider|desk-stream):/;

type Place = { id: string; offset: number };

function placeOf(scroller: HTMLElement): Place | null {
  const top = scroller.getBoundingClientRect().top;
  let best: { id: string; offset: number } | null = null;
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

/** Moves the scroller by however far the kept row moved; false while the rows do not hold it yet. */
function restore(handle: TranscriptListHandle, scroller: HTMLElement, rows: readonly Row[], kept: Place): boolean {
  const index = rows.findIndex((row) => row.id === kept.id);
  if (index < 0) return false;
  const element = scroller.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(kept.id)}"]`);
  if (element) scroller.scrollBy({ top: element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - kept.offset, behavior: 'instant' });
  else handle.scrollToIndex(index, 'start');
  return true;
}

export function useKeepPlaceThroughOlderRows(list: RefObject<TranscriptListHandle | null>, rows: readonly Row[], loadingOlder: boolean): void {
  const place = useRef<Place | null>(null);
  const pending = useRef(false);

  // The reader's place as of their last scroll (rows drawn beneath it, the stream included, do not move it).
  useEffect(() => {
    const scroller = list.current?.scrollElement;
    if (!scroller) return;
    const scrolled = () => {
      place.current = placeOf(scroller);
    };
    scrolled();
    scroller.addEventListener('scroll', scrolled, { passive: true });
    return () => scroller.removeEventListener('scroll', scrolled);
  }, [list]);

  useEffect(() => {
    if (loadingOlder) pending.current = true;
  }, [loadingOlder]);

  // After the list's own layout for the new rows (a child's layout effects run first).
  useLayoutEffect(() => {
    const handle = list.current;
    const scroller = handle?.scrollElement;
    if (!handle || !scroller) return;
    const kept = place.current;
    if (pending.current && kept !== null && !handle.following && restore(handle, scroller, rows, kept)) pending.current = false;
    place.current = placeOf(scroller);
  }, [list, rows]);
}
