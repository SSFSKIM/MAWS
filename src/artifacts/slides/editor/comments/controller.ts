// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the deck editor's comments, shared by the
// toolbar's Comment, the overlay's pins, the threads rail and the card's frame through one context. A comment on the
// selected element writes its thread (anchored by the slide's and the element's ids, quoting the element) and hands it
// to the surface the shell gives, B's `DocumentComments` (src/artifacts/document/editor/comments/surface.ts): the
// renderer opens P2's card for it through B's `CardTarget {kind: 'artifact'}` and `artifact-comment` anchor, labelled
// with the deck's title and the slide's number and title. Without a surface (no session to send it to), commenting is
// not offered; the rail still lists, replies to, resolves and reopens. Every thread write carries the comments' own
// origin, which the deck's undo never tracks (B's rule; the parent's Decision Log 32).
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { CommentAuthor, DocumentComments } from '../../../document/editor/comments/surface';
import { resolveAnchor, slideOrder } from '../../model';
import { addThread, elementQuote, newThreadId, slideTitle, type DeckThread } from '../../threads';
import type { DeckSession } from '../session';
import { COMMENTS_COPY as C } from './copy';

/** The origin of every thread write the editor makes: outside the deck's undo (threads.ts holds it; fix wave 1). */
import { COMMENTS_ORIGIN } from '../../threads';
export { COMMENTS_ORIGIN };

export const HUMAN_AUTHOR: CommentAuthor = { actor: { kind: 'human' }, now: () => Date.now() };

export interface DeckCommentsApi {
  readonly session: DeckSession;
  readonly author: CommentAuthor;
  /** The store is read-only: threads are listed and shown, not written. */
  readonly readOnly: boolean;
  /** The thread drawn as active (its card's, a shown one's, a clicked pin's). */
  readonly active: string | null;
  setActive(threadId: string | null): void;
  /** Shows a thread: its slide on the stage, its element selected when it lives, the thread active. */
  show(thread: Pick<DeckThread, 'id' | 'slideId' | 'elementId'>): void;
  /** Opens the threads rail on a thread. */
  openRail(threadId: string): void;
  /** Commenting is offered: a surface to send it to, a writable store. */
  readonly canComment: boolean;
  /** Comments the one selected element: its thread written and its card opened. Null when nothing was commented. */
  comment(): string | null;
}

const Context = createContext<DeckCommentsApi | null>(null);
export const DeckCommentsProvider = Context.Provider;
/** The editor's comments, or null where the editor gives none (a test's bare stage). */
export const useDeckCommentsApi = (): DeckCommentsApi | null => useContext(Context);

export interface DeckCommentsOptions {
  session: DeckSession;
  surface: DocumentComments | undefined;
  author?: CommentAuthor;
  readOnly: boolean;
  /** Opens the threads rail (the session's, so the header's Comments and the tab's lifetime share it). */
  openRail(): void;
}

export function useDeckComments({ session, surface, author = HUMAN_AUTHOR, readOnly, openRail }: DeckCommentsOptions): DeckCommentsApi {
  const [active, setActive] = useState<string | null>(null);
  const show = useCallback(
    (thread: Pick<DeckThread, 'id' | 'slideId' | 'elementId'>) => {
      const doc = session.doc;
      if (slideOrder(doc).includes(thread.slideId)) {
        session.show(thread.slideId);
        session.select(resolveAnchor(doc, thread).live ? [thread.elementId] : []);
      }
      setActive(thread.id);
    },
    [session],
  );
  const comment = useCallback((): string | null => {
    const { currentSlide, selection } = session.snapshot();
    if (!surface || readOnly || currentSlide === null || selection.length !== 1) return null;
    const doc = session.doc;
    const anchor = { slideId: currentSlide, elementId: selection[0]! };
    if (!resolveAnchor(doc, anchor).live) return null;
    const threadId = newThreadId();
    const quote = elementQuote(doc, anchor.slideId, anchor.elementId);
    addThread(doc, { threadId, ...anchor, quote, by: author.actor, at: author.now() }, COMMENTS_ORIGIN);
    setActive(threadId);
    const n = slideOrder(doc).indexOf(anchor.slideId) + 1;
    surface.opened({ threadId, tabId: anchor.slideId, tabTitle: C.where(n, slideTitle(doc, anchor.slideId)), quote });
    return threadId;
  }, [session, surface, readOnly, author]);
  return useMemo(
    () => ({
      session,
      author,
      readOnly,
      active,
      setActive,
      show,
      openRail: (threadId: string) => {
        openRail();
        setActive(threadId);
      },
      canComment: surface !== undefined && !readOnly,
      comment,
    }),
    [session, author, readOnly, active, show, openRail, surface, comment],
  );
}
