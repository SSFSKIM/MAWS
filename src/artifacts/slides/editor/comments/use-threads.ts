// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the deck's threads as React reads them (B's
// src/artifacts/document/editor/comments/use-threads.ts for a deck): the list with the derived orphan state, recomputed
// once the deck has been quiet a moment (an element's deletion orphans its thread with no write to the threads), and
// the open count, which reads the threads alone and follows them at once.
//
// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): the open threads as the pins and the popover
// read them, from the threads map alone and at once (B1's Decision Log 11 for the document's margin), so a reply, a
// resolve or an agent's new thread reaches a pin in the task it was written in; whether an element is drawn is the
// canvas's to say. And the open count per slide, orphans counted, for the filmstrip's badges (V10).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { onUpdate, type Doc } from '../../../yjs';
import { listThreads, observeThreads, openThreadCount, threadStates, type DeckThread, type DeckThreadState } from '../../threads';

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

/** P4-B2: every open thread, oldest first, orphans included; the array and each thread's object are kept while unchanged. */
export function useOpenDeckThreads(doc: Doc): readonly DeckThread[] {
  const store = useMemo(() => {
    let dirty = true;
    let kept: DeckThread[] = [];
    return {
      subscribe: (listener: () => void) => {
        dirty = true; // a change while nothing listened is read again
        return observeThreads(doc, () => {
          dirty = true;
          listener();
        });
      },
      snapshot: (): readonly DeckThread[] => {
        if (!dirty) return kept;
        dirty = false;
        const before = new Map(kept.map((thread) => [thread.id, thread]));
        const next = listThreads(doc)
          .filter((thread) => thread.status === 'open')
          .map((thread) => {
            const was = before.get(thread.id);
            return was && sameThread(was, thread) ? was : thread;
          });
        if (next.length !== kept.length || next.some((thread, i) => thread !== kept[i])) kept = next;
        return kept;
      },
    };
  }, [doc]);
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

function sameThread(a: DeckThread, b: DeckThread): boolean {
  if (a.status !== b.status || a.quote !== b.quote || a.slideId !== b.slideId || a.elementId !== b.elementId) return false;
  if (a.createdAt !== b.createdAt || a.resolvedAt !== b.resolvedAt || a.reopenedAt !== b.reopenedAt || a.messages.length !== b.messages.length) return false;
  return a.messages.every((message, i) => {
    const other = b.messages[i]!;
    return message === other || (message.id === other.id && message.at === other.at && message.body === other.body);
  });
}

/** P4-B2 (V10): how many threads are open on each slide that has any, orphans counted, following the threads at once. */
export function useOpenThreadCounts(doc: Doc): ReadonlyMap<string, number> {
  // the snapshot is a string, stable while the counts are, so the store's equality check holds
  const key = useSyncExternalStore(
    (listener) => observeThreads(doc, listener),
    () => {
      const counts = new Map<string, number>();
      for (const thread of listThreads(doc)) if (thread.status === 'open') counts.set(thread.slideId, (counts.get(thread.slideId) ?? 0) + 1);
      return JSON.stringify([...counts]);
    },
  );
  return useMemo(() => new Map(JSON.parse(key) as [string, number][]), [key]);
}
