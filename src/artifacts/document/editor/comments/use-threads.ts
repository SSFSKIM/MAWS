// The threads as React reads them (M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the rail's list with
// the derived orphan state, and the open count and a thread's status for the chrome. The orphan state reads every tab's
// live marks, so the list is recomputed once the document has been quiet for a moment, not per keystroke; the count and
// a status read the threads map alone and follow it at once.
import { useEffect, useMemo /* P4-B1 */, useState, useSyncExternalStore } from 'react';
import { onUpdate, type Doc } from '../../../yjs';
import { listThreads, liveThreadIds, observeThreads, threadStates, threadStatus, type ThreadState, type ThreadStatus } from '../../threads';

const LIST_QUIET_MS = 50;

/**
 * Every thread with its derived state, oldest first; follows the document once it has been quiet a moment (P4-B1:
 * `quietMs`, 50 ms unless the caller names its own; the margin waits longer, MARGIN_LIST_QUIET_MS).
 */
export function useThreadStates(doc: Doc, options: { quietMs?: number } = {}): ThreadState[] {
  const quietMs = options.quietMs ?? LIST_QUIET_MS; // P4-B1
  const [states, setStates] = useState(() => threadStates(doc, liveThreadIds(doc)));
  useEffect(() => {
    setStates(threadStates(doc, liveThreadIds(doc)));
    let timer: ReturnType<typeof setTimeout> | null = null;
    // an idle debounce: each update restarts the wait, so sustained typing scans nothing until it pauses
    const off = onUpdate(doc, () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        setStates(threadStates(doc, liveThreadIds(doc)));
      }, quietMs);
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [doc, quietMs]);
  return states;
}

/** How many threads are open (orphans included). */
export function useOpenThreadCount(doc: Doc): number {
  return useSyncExternalStore(
    (listener) => observeThreads(doc, listener),
    () => listThreads(doc).filter((thread) => thread.status === 'open').length,
  );
}

// P4-B1 (the prior art's Z6): the tab strip's dots. Read from the threads map alone, as the count above, so the strip
// scans no tab's marks while the owner types.
/** How many threads are open (orphans included) on each tab that has any. */
export function useOpenThreadCounts(doc: Doc): ReadonlyMap<string, number> {
  // the snapshot is a string, stable while the counts are, so the store's equality check holds
  const key = useSyncExternalStore(
    (listener) => observeThreads(doc, listener),
    () => {
      const counts = new Map<string, number>();
      for (const thread of listThreads(doc)) if (thread.status === 'open') counts.set(thread.tabId, (counts.get(thread.tabId) ?? 0) + 1);
      return JSON.stringify([...counts]);
    },
  );
  return useMemo(() => new Map(JSON.parse(key) as [string, number][]), [key]);
}

/** A thread's status, or null when there is no such thread. */
export function useThreadStatus(doc: Doc, threadId: string): ThreadStatus | null {
  return useSyncExternalStore(
    (listener) => observeThreads(doc, listener),
    () => threadStatus(doc, threadId),
  );
}
