// A notification's landing on one of the session view's tail cards (a pending request): the card is brought into view
// in MAWS's virtualized list, focused, and marked (`session-tail.tsx` draws the mark on the landing's card).
import { useEffect, type RefObject } from 'react';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import { watchReaderIntent } from '../../depth/view/reader-intent';
import type { RowIndex } from '../../depth/view/TranscriptPane';

/** Frames a landing waits for its card to be mounted, after moving the list to it, before it gives up. */
const LANDING_FRAMES = 120;

/**
 * A notification that landed on one of the tail's cards (`row`, its tail row's id): the card is brought into view,
 * focused, and marked (its row draws the mark while it is the landing's). The list is virtualized, so a reader far up
 * in the history has no card mounted to scroll to: the list is moved to the card's index among the rows it draws, and
 * the card is waited for, frame by frame, until the list mounts it. A reader who moves while it is on its way — a wheel,
 * a touch, a press or the keys on the list, focus taken elsewhere (`reader-intent.ts`) — keeps the place they went to:
 * the landing stops there, its card still marked. The list's own scrolling toward the card is not theirs.
 */
export function useLandOnCard(root: HTMLElement | null, list: RefObject<TranscriptListHandle | null>, rowIndex: RefObject<RowIndex | null>, landed: { request: string; row: string } | null) {
  const request = landed?.request ?? null;
  const row = landed?.row ?? null;
  useEffect(() => {
    if (!root || request === null || row === null) return;
    let frame = 0;
    let frames = 0;
    let moved = false;
    const scroller = list.current?.scrollElement;
    const stop = () => {
      cancelAnimationFrame(frame);
      stopWatching();
    };
    const stopWatching = scroller ? watchReaderIntent(scroller, stop, { focus: true }) : () => {};
    const step = () => {
      frame = 0;
      const card = root.querySelector<HTMLElement>(`[data-tail-request="${CSS.escape(request)}"]`);
      if (card) {
        stopWatching(); // the landing's own focus, below, is not the reader's
        card.scrollIntoView({ block: 'center' });
        card.focus({ preventScroll: true });
        return;
      }
      if (!moved) {
        const index = rowIndex.current?.(row) ?? -1;
        if (index >= 0) {
          list.current?.scrollToIndex(index, 'center');
          moved = true;
        }
      }
      if (++frames < LANDING_FRAMES) frame = requestAnimationFrame(step);
      else stopWatching();
    };
    frame = requestAnimationFrame(step);
    return stop;
  }, [root, list, rowIndex, request, row]);
}
