// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the deck's threads as React reads them (B's
// src/artifacts/document/editor/comments/use-threads.ts for a deck): the list with the derived orphan state, recomputed
// once the deck has been quiet a moment (an element's deletion orphans its thread with no write to the threads), and
// the visible-open count (WR 49), which follows thread writes at once and target edits after that quiet moment.
//
// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md): the open threads as the pins and the popover
// read them, a write to the threads at once (B1's Decision Log 11 for the document's margin), so a reply, a resolve or
// an agent's new thread reaches a pin in the task it was written in, and their derived quotes as the list reads them;
// whether an element is drawn is the canvas's to say. And the visible-open count per slide for the filmstrip's badges (V10).
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { onUpdate, type Doc } from '../../../yjs';
import { listThreads, observeThreads, threadStates, type DeckThread, type DeckThreadState } from '../../threads';
import { deckCommentCounts } from '../../comment-counts';

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

/** WR 49: how many live-target threads are open; target edits follow after a quiet moment. */
export function useOpenThreadCount(doc: Doc): number {
  const store = useMemo(() => deckCommentCounts(doc), [doc]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot).total;
}

/**
 * P4-B2: every open thread, oldest first, orphans included; the array and each thread's object are kept while unchanged.
 * A write to the threads is read at once; a quote, derived from its element's text or its board's title, changes with no
 * write to the threads (a republish, a rename), so the deck's other updates read it again once the deck has been quiet
 * a moment, as the list does.
 */
export function useOpenDeckThreads(doc: Doc): readonly DeckThread[] {
  const store = useMemo(() => {
    let dirty = true;
    let kept: DeckThread[] = [];
    return {
      subscribe: (listener: () => void) => {
        dirty = true; // a change while nothing listened is read again
        const changed = () => {
          dirty = true;
          listener();
        };
        let timer: ReturnType<typeof setTimeout> | null = null;
        const offThreads = observeThreads(doc, changed);
        const offDoc = onUpdate(doc, () => {
          if (timer !== null) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            changed();
          }, LIST_QUIET_MS);
        });
        return () => {
          offThreads();
          offDoc();
          if (timer !== null) clearTimeout(timer);
        };
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

/** P4-B2 (V10), WR 49: the filmstrip's badges count only live-target open threads. */
export function useOpenThreadCounts(doc: Doc): ReadonlyMap<string, number> {
  const store = useMemo(() => deckCommentCounts(doc), [doc]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot).targets;
}
