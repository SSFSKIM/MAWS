// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the deck's threads as React reads them (B's
// src/artifacts/document/editor/comments/use-threads.ts for a deck): the list with the derived orphan state, recomputed
// once the deck has been quiet a moment (an element's deletion orphans its thread with no write to the threads), and
// the open count, which reads the threads alone and follows them at once.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { onUpdate, type Doc } from '../../../yjs';
import { observeThreads, openThreadCount, threadStates, type DeckThreadState } from '../../threads';

const LIST_QUIET_MS = 50;

/** Every thread with its derived state, oldest first; follows the deck once it has been quiet a moment. */
export function useDeckThreadStates(doc: Doc): DeckThreadState[] {
  const [states, setStates] = useState(() => threadStates(doc));
  useEffect(() => {
    setStates(threadStates(doc));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = onUpdate(doc, () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setStates(threadStates(doc));
      }, LIST_QUIET_MS);
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [doc]);
  return states;
}

/** How many threads are open (orphans included), following the threads at once. */
export function useOpenThreadCount(doc: Doc): number {
  return useSyncExternalStore(
    (listener) => observeThreads(doc, listener),
    () => openThreadCount(doc),
  );
}
