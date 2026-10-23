// The threads as React reads them (M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the rail's list with
// the derived orphan state, and the open count and a thread's status for the chrome. The orphan state reads every tab's
// live marks, so the list is recomputed once the document has been quiet for a moment, not per keystroke. WR 49's counts
// exclude missing targets, following their edits after the same quiet moment; thread status changes still follow at once.
import { useEffect, useMemo /* P4-B1 */, useState, useSyncExternalStore } from 'react';
import { onUpdate, type Doc } from '../../../yjs';
import { listThreads, liveThreadIds, observeThreads, threadStates, threadStatus, type Thread /* P4-B1 */, type ThreadState, type ThreadStatus } from '../../threads';
import { documentCommentCounts } from '../../comment-counts';

const LIST_QUIET_MS = 50;

/** Every thread with its derived state, oldest first; follows the document once it has been quiet a moment. */
export function useThreadStates(doc: Doc): ThreadState[] {
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
      }, LIST_QUIET_MS);
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [doc]);
  return states;
}

/** How many live-target threads are open. */
export function useOpenThreadCount(doc: Doc): number {
  const store = useMemo(() => documentCommentCounts(doc), [doc]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot).total;
}

/** P4-B1 (Z6), WR 49: the tab strip's dots count only live-target open threads. */
export function useOpenThreadCounts(doc: Doc): ReadonlyMap<string, number> {
  const store = useMemo(() => documentCommentCounts(doc), [doc]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot).targets;
}

/** A thread's status, or null when there is no such thread. */
export function useThreadStatus(doc: Doc, threadId: string): ThreadStatus | null {
  return useSyncExternalStore(
    (listener) => observeThreads(doc, listener),
    () => threadStatus(doc, threadId),
  );
}

// P4-B1: the margin's list. Read from the threads map alone, as the counts above, so a reply, a resolve or a new thread
// reaches the margin in the task it was written in, while no keystroke scans any tab's marks. Whether a thread is drawn
// here (an orphan is not) is the display's decorations' to say (`drawnThreads`), not this list's.
/** The open threads of `tabId`, oldest first; the array and each thread's object are kept while they are unchanged. */
export function useOpenThreads(doc: Doc, tabId: string): readonly Thread[] {
  const store = useMemo(() => {
    let dirty = true;
    let kept: Thread[] = [];
    return {
      subscribe: (listener: () => void) => {
        dirty = true; // a change while nothing listened is read again
        return observeThreads(doc, () => {
          dirty = true;
          listener();
        });
      },
      snapshot: (): readonly Thread[] => {
        if (!dirty) return kept;
        dirty = false;
        const before = new Map(kept.map((thread) => [thread.id, thread]));
        const next = listThreads(doc)
          .filter((thread) => thread.status === 'open' && thread.tabId === tabId)
          .map((thread) => {
            const was = before.get(thread.id);
            return was && sameThread(was, thread) ? was : thread;
          });
        if (next.length !== kept.length || next.some((thread, i) => thread !== kept[i])) kept = next;
        return kept;
      },
    };
  }, [doc, tabId]);
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

function sameThread(a: Thread, b: Thread): boolean {
  if (a.status !== b.status || a.quote !== b.quote || a.tabId !== b.tabId || a.blockId !== b.blockId) return false;
  if (a.createdAt !== b.createdAt || a.resolvedAt !== b.resolvedAt || a.reopenedAt !== b.reopenedAt || a.messages.length !== b.messages.length) return false;
  return a.messages.every((message, i) => {
    const other = b.messages[i]!;
    return message === other || (message.id === other.id && message.at === other.at && message.body === other.body);
  });
}
