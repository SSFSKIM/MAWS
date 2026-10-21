// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D9; M7): the deck editor's comments, shared by the
// toolbar's Comment, the overlay's pins, the threads rail and the card's frame through one context. A comment on the
// selected element writes its thread (anchored by the slide's and the element's ids, quoting the element) and hands it
// to the surface the shell gives, B's `DocumentComments` (src/artifacts/document/editor/comments/surface.ts): the
// renderer opens P2's card for it through B's `CardTarget {kind: 'artifact'}` and `artifact-comment` anchor, labelled
// with the deck's title and the slide's number and title. Without a surface (no session to send it to), commenting is
// not offered; the rail still lists, replies to, resolves and reopens. Every thread write carries the comments' own
// origin, which the deck's undo never tracks (B's rule; the parent's Decision Log 32).
//
// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the prior art's V1 to V15): a pin opens a
// popover of its threads (PinPopover.tsx) instead of the rail. The controller holds what the pins, the popover, the rail
// and the card's frame share: the one popover slot (`popover`, so one is open at a time, V3), the editor's reply drafts
// (one map, the popover's and the rail's, V5), whether the pins are hidden (⌥⌘⇧J, V12) and the thread the compose card
// is on (the surface's `hosting`). Comment first refocuses the artifact's kept draft (X36's one draft per artifact) and
// closes the popover, so the card it opens or reveals shows; showing a thread from the rail opens its pin's popover (V11).
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CommentAuthor, DocumentComments } from '../../../document/editor/comments/surface';
import { resolveAnchor, slideOrder } from '../../model';
import { addThread, elementQuote, newThreadId, slideTitle, threadStatus, type DeckThread } from '../../threads';
import type { DeckSession } from '../session';
import { COMMENTS_COPY as C } from './copy';
import { ReplyDrafts } from './drafts';

/** The origin of every thread write the editor makes: outside the deck's undo (threads.ts holds it; fix wave 1). */
import { COMMENTS_ORIGIN } from '../../threads';
export { COMMENTS_ORIGIN };

export const HUMAN_AUTHOR: CommentAuthor = { actor: { kind: 'human' }, now: () => Date.now() };

/** P4-B2: what a pin's press did. */
export type PinPress = 'closed' | 'opened' | 'card';

/** P4-B2: a pin, by the element it is on (a design's board thread: the board's ROOT), and the thread a popover opens on. */
export interface PinTarget {
  slideId: string;
  elementId: string;
  /** The thread to activate on opening (a thread shown from the rail); else the newest. */
  threadId?: string;
}
export const samePin = (a: Pick<PinTarget, 'slideId' | 'elementId'> | null, b: Pick<PinTarget, 'slideId' | 'elementId'>): boolean => a !== null && a.slideId === b.slideId && a.elementId === b.elementId;

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
  /** P4-B2: the artifact's kept compose draft refocused (its card revealed, the popover closed), or null when there is none. */
  resumeDraft(): string | null;
  /** P4-B2: the pin whose popover is open, one at a time (V3). */
  readonly popover: PinTarget | null;
  openPopover(target: PinTarget): void;
  closePopover(): void;
  /**
   * P4-B2: a pin pressed: its popover closes when it is the open one (V4), and opens otherwise (V2, V3), unless the
   * pin's only open thread is the one the compose card is on, whose card is revealed and focused instead (`card`).
   */
  pressPin(target: PinTarget, threadIds: readonly string[]): PinPress;
  /** P4-B2: the editor's reply drafts, the popover's and the rail's (V5). */
  readonly drafts: ReplyDrafts;
  /** P4-B2: ⌥⌘⇧J hid the pins (and so the popover); nothing is resolved (V12). */
  readonly pinsHidden: boolean;
  togglePins(): void;
  /** P4-B2: the thread the compose card is on (its host's `hosting`), else null. */
  readonly composing: string | null;
  setComposing(threadId: string | null): void;
  /** P4-B2: told by the pins after each placement they commit, so the popover and the card re-place in the same frame. */
  readonly pinMoves: PinMoves;
}

/** P4-B2: the pins' placements as they commit (one per editor, stable). */
export class PinMoves {
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  placed = (): void => {
    for (const listener of [...this.listeners]) listener();
  };
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
  // P4-B2 start
  const [popover, setPopover] = useState<PinTarget | null>(null);
  const [pinsHidden, setPinsHidden] = useState(false);
  const [composing, setComposing] = useState<string | null>(null);
  const [drafts] = useState(() => new ReplyDrafts());
  const [pinMoves] = useState(() => new PinMoves());
  const openPopover = useCallback((target: PinTarget) => setPopover(target), []);
  const closePopover = useCallback(() => setPopover(null), []);
  const togglePins = useCallback(() => {
    setPinsHidden((hidden) => !hidden);
    setPopover(null);
  }, []);
  // the compose card's host is hidden under an open popover: shown (committed) before its field takes the keyboard
  const revealCard = useCallback(() => {
    if (popover !== null) flushSync(() => setPopover(null));
  }, [popover]);
  // X36's one draft per artifact: a comment being written takes a new one's place, its card shown
  const resumeDraft = useCallback((): string | null => {
    const kept = surface?.draft?.() ?? null;
    if (kept === null) return null;
    revealCard();
    setActive(kept);
    surface?.focusDraft?.();
    return kept;
  }, [surface, revealCard]);
  const pressPin = useCallback(
    (target: PinTarget, threadIds: readonly string[]): PinPress => {
      if (samePin(popover, target)) {
        setPopover(null);
        return 'closed';
      }
      if (threadIds.length === 1 && threadIds[0] === composing && surface?.focusDraft) {
        revealCard();
        surface.focusDraft();
        return 'card';
      }
      setPopover({ slideId: target.slideId, elementId: target.elementId });
      return 'opened';
    },
    [popover, composing, surface, revealCard],
  );
  // P4-B2 end
  const show = useCallback(
    (thread: Pick<DeckThread, 'id' | 'slideId' | 'elementId'>) => {
      const doc = session.doc;
      if (slideOrder(doc).includes(thread.slideId)) {
        session.show(thread.slideId);
        const live = resolveAnchor(doc, thread).live;
        session.select(live ? [thread.elementId] : []);
        // P4-B2 (V11): its pin's popover, on the thread
        if (live && threadStatus(doc, thread.id) === 'open') setPopover({ slideId: thread.slideId, elementId: thread.elementId, threadId: thread.id });
      }
      setActive(thread.id);
    },
    [session],
  );
  const comment = useCallback((): string | null => {
    const kept = resumeDraft(); // P4-B2
    if (kept !== null) return kept;
    const { currentSlide, selection } = session.snapshot();
    if (!surface || readOnly || currentSlide === null || selection.length !== 1) return null;
    const doc = session.doc;
    const anchor = { slideId: currentSlide, elementId: selection[0]! };
    if (!resolveAnchor(doc, anchor).live) return null;
    const threadId = newThreadId();
    const quote = elementQuote(doc, anchor.slideId, anchor.elementId);
    addThread(doc, { threadId, ...anchor, quote, by: author.actor, at: author.now() }, COMMENTS_ORIGIN);
    setActive(threadId);
    setPopover(null); // P4-B2: the card it opens shows
    const n = slideOrder(doc).indexOf(anchor.slideId) + 1;
    surface.opened({ threadId, tabId: anchor.slideId, tabTitle: C.where(n, slideTitle(doc, anchor.slideId)), quote });
    return threadId;
  }, [session, surface, readOnly, author, resumeDraft]);
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
      // P4-B2
      resumeDraft,
      popover,
      openPopover,
      closePopover,
      pressPin,
      drafts,
      pinsHidden,
      togglePins,
      composing,
      setComposing,
      pinMoves,
    }),
    [session, author, readOnly, active, show, openRail, surface, comment, resumeDraft, popover, openPopover, closePopover, pressPin, drafts, pinsHidden, togglePins, composing, pinMoves],
  );
}
