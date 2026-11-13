// The document editor's comment surface in the renderer (P3-B M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md,
// D9; X21's artifact target, X10's artifact-comment anchor): the editor (src/artifacts/, portable) writes a thread and
// its mark and hands the passage here; this opens P2's comment card for it through the composer seam (E5's
// `openCommentComposer`), so Side thread and Send to main go the way every comment goes, and draws the card's host over
// the page, pinned where the editor locates the passage. The card's header gains Resolve (Reopen for a resolved
// thread); a comment the card sent is recorded as the thread's next message, and a new thread whose card closed before
// anything was sent in it is withdrawn with its mark (one whose send is on its way is not: P2's send completes after its
// card went). The card on screen draws its thread as the editor's active one.
// The document tab's wrappers (M8) mount the editor with this, holding the tab's replica open (`holdReplica`) while
// the overlay is mounted and through its withdrawal of a draft after it went, and through a send in flight, since a
// send that lands records its message in the document (fix wave 2); the harness page mounts it too.
//
// P4-B1 (D7, D8 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md): while the editor's margin draws, the
// overlay is rendered in the margin's stack (`placement: 'margin'`) and the card host is a block in flow there, in the
// entry of the thread the card is on, which the host reports as it changes (`hosting`); the card opens with a margin
// placement then. X36's draft rule: the artifact's one unsent comment (./comment-drafts.ts) is what the editor's next
// Comment refocuses (`draft`, `focusDraft`), Escape keeps and the tab's close guard asks about; a blur with an empty field
// discards the card.
//
// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M3, §F, decision 17): the comment lives in
// the card's pass, which this host keeps at one (`holds: 'one'`), and its thread lives exactly as long as the comment is
// in the pass: recorded as the thread's message when its send goes, withdrawn when the person discards it or the
// artifact's last view closes (the pass ends), never because a host unmounted. Each such thread holds the tab's replica
// until then, so its withdrawal is written after the tab went. A comment in flight keeps its thread and its hold until
// its send settles: a refusal with the pass gone withdraws it.
//
// UX wave U5a (M7; decision 20, A17): when the agent's answer to a comment arrives (./answers.ts), the host asks the
// editor once to tint the passage, only while the document is on screen; in a body under 720 px the card on that thread,
// floating over the text there, closes to the passage's mark unless the keyboard is in it (a click on the mark opens
// the thread again, as the editor's activation does). In the margin the card stays. A deck's and a design's editor
// offer no tint, so nothing is read for them.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { CommentOverlayProps, CommentedPassage, DocumentComments } from '@artifacts/document/editor/comments/surface';
import { useThreadStatus } from '@artifacts/document/editor/comments/use-threads';
import { RAIL_BESIDE_FROM_PX } from '@artifacts/document/rail-width'; // UX wave U5a (M7)
import { anchorField, type Anchor } from '@shared/anchor/anchor';
import type { ArtifactKind } from '@shared/artifacts/entity'; // P3-C
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactSessionContext } from '../../artifacts/session-context'; // P3-F1
import { QUIET } from '../../sessions/ui';
import { CommentCardHost, type CardFrame } from '../../side/card/CardHost';
import { closeCard, editComment /* UX wave U5a */, handCardTo /* P4-B3 */, noteThreadOf /* UX wave U5a */, useCommentCard, type CardHostMode, type OpenCard, type PassComment } from '../../side/card/store';
import { focusAtEnd } from '../../side/card/CommentCard'; // P4-B1
import { openCommentComposer, type CommentPlacement } from '../code/anchor/anchor'; // P4-B1: CommentPlacement
import { watchAnswers } from './answers'; // UX wave U5a (M7)
import { commentDraftOf, unsentCommentOf } from './comment-drafts'; // P4-B1; UX wave U5a: readers over the pass
import { cancelPendingComment, PendingCommentNotice, pendingThreadOf, startCommentSession, subscribePending, usePendingComment } from './comment-session'; // P3-F1

const LABEL_MAX = 200; // X10's label cap
const QUOTE_MAX = 300; // the passage as the lead line and the card's title read it; the thread keeps it whole

// P4 (tracker L275): a tab named as its document is (a default tab carries the document's title) adds nothing to the label
const sameName = (a: string, b: string) => anchorField(a, LABEL_MAX).toLocaleLowerCase() === anchorField(b, LABEL_MAX).toLocaleLowerCase();

/** X10's anchor for a comment on a document's passage: the document and tab as the label, the passage as the locator. */
export function artifactCommentAnchor({ artifactId, title, threadId, tabTitle, quote, artifactKind, artifactTarget }: CommentedPassage & { artifactId: string; title: string; artifactKind?: ArtifactKind /* P3-C */ }): Anchor {
  const label = !tabTitle.trim() || sameName(title, tabTitle) ? title : `${title}, ${tabTitle}`;
  return { kind: 'artifact-comment', label: anchorField(label, LABEL_MAX), locator: anchorField(quote, QUOTE_MAX), artifactId, threadId, ...(artifactKind !== undefined && { artifactKind }) /* P3-C */, ...(artifactTarget !== undefined && { artifactTarget }) /* P3-E */ };
}

interface Options {
  artifactId: string;
  /** The session a comment goes to (its Side thread's parent, or the main conversation it steers). */
  appSessionId?: AppSessionId; // P3-F1: optional, `context` answering without it
  /**
   * P3-F1 (fix 2; the P3 interface ledger's X23 row): without `appSessionId`, the artifact's own context (H's policy): its
   * session opens the card at once, a directory starts one on the owner's Comment (./comment-session.tsx), and none (or
   * no context given) shows the card's notice saying why.
   */
  context?: ArtifactSessionContext;
  /** The document's title, as the anchor names it. */
  title: string;
  /** The surface the editor is in, for a re-docked card (a panel tool or a main tab). */
  mode?: CardHostMode;
  /** The editor is on screen. */
  visible?: boolean;
  /**
   * Holds what the overlay writes into (the tab's replica) until the returned release: taken while the overlay is
   * mounted, until its withdrawal of an unsent draft after it went has been written, and by each send until it settled.
   */
  holdReplica?: () => () => void;
  /** P3-C (M7 fix wave 1; Decision Log 33, 35): the commented artifact's kind when it is not a document (the lead's wording). */
  artifactKind?: ArtifactKind;
  /**
   * P4-B3 M6: the card host's id, when the caller keeps one across bodies (the document tab state's, which a move
   * between the panel and a main tab carries), so a body that replaces another over the same state is the same host,
   * as a remount is: its composing card and draft stay. Else the hook's own.
   */
  hostId?: string;
}

interface Binding {
  artifactId: string;
  hostId: string;
  mode: CardHostMode;
  visible: boolean;
  holdReplica: (() => () => void) | undefined;
}

// A card host's drafts: the new threads it opened that nothing was said in yet. UX wave U5a (decision 17): a draft lives
// while its comment is in a pass of the card's store, while a send in it is on its way, or while it is the comment
// waiting on its session; once none holds, it is withdrawn (the thread and its mark) through the replica it holds. A
// send that went is recorded as the thread's message and the thread is no draft any more, whatever became of the card,
// the editor or the pass meanwhile. Kept outside React, by thread, each naming its host: the opener, the card's sends
// and the store all change it, a send outlives the host, and (P4-B3) a move that activates another view of the document
// hands the host's drafts to that view's host.
interface DraftThread {
  hostId: string;
  sends: number; // on their way
  withdraw(): void; // the thread and its mark, in the editor's replica
  release: (() => void) | undefined; // the replica, held until the draft ends
}
const draftThreads = new Map<string, DraftThread>(); // draft thread id → its host and sends

const threadIdOf = (anchor: { kind: string; threadId?: string }): string | null => (anchor.kind === 'artifact-comment' ? (anchor.threadId ?? null) : null);

const drafts = {
  opened(hostId: string, threadId: string, withdraw: () => void, holdReplica: (() => () => void) | undefined): void {
    draftThreads.set(threadId, { hostId, sends: 0, withdraw, release: holdReplica?.() });
    watchDrafts();
  },

  /** Kept on purpose (resolved from its card): never withdrawn. */
  keep(threadId: string): void {
    const draft = draftThreads.get(threadId);
    draftThreads.delete(threadId);
    draft?.release?.();
  },

  /** The person dropped its comment: withdrawn at once, unless a send in it is on its way. */
  discarded(threadId: string): void {
    const draft = draftThreads.get(threadId);
    if (draft && draft.sends === 0) end(threadId, draft);
  },

  /** A send in `threadId` set out; the call returned settles it. */
  sending(threadId: string, text: string, record: (threadId: string, body: string) => void): (went: boolean) => void {
    const draft = draftThreads.get(threadId);
    if (draft) draft.sends += 1;
    return (went) => {
      if (draft && draftThreads.get(threadId) === draft) draft.sends -= 1;
      if (went) {
        if (draft && draftThreads.get(threadId) === draft) {
          draftThreads.delete(threadId);
          draft.release?.();
        }
        record(threadId, text);
      } else settleDrafts();
    };
  },

  /** P4-B3 (its Decision Log 39): the host's drafts are `to`'s from now on. */
  handTo(from: string, to: string): void {
    for (const draft of draftThreads.values()) if (draft.hostId === from) draft.hostId = to;
  },
};

function end(threadId: string, draft: DraftThread): void {
  draftThreads.delete(threadId);
  try {
    draft.withdraw();
  } finally {
    draft.release?.();
  }
}

// Every draft no comment, send or start holds any more is withdrawn; the watch ends with the last draft.
function settleDrafts(): void {
  const live = new Set<string>();
  for (const pass of useCommentCard.getState().passes.values())
    for (const comment of pass.comments) {
      const threadId = threadIdOf(comment.anchor);
      if (threadId !== null) live.add(threadId);
    }
  for (const [threadId, draft] of [...draftThreads]) if (draft.sends === 0 && !live.has(threadId) && pendingThreadOf(draft.hostId) !== threadId) end(threadId, draft);
  if (draftThreads.size === 0) unwatchDrafts();
}
let stopWatching: (() => void) | null = null;
function watchDrafts(): void {
  if (stopWatching) return;
  const offCard = useCommentCard.subscribe(settleDrafts);
  const offPending = subscribePending(settleDrafts);
  stopWatching = () => {
    offCard();
    offPending();
  };
}
function unwatchDrafts(): void {
  stopWatching?.();
  stopWatching = null;
}

// The card hosts whose overlay is mounted. DocumentEditor remounts the overlay with the page on every tab switch while the
// host id stays the document's, and P2's card host keeps its card through a remount within a microtask; so does this.
const mountedOverlays = new Set<string>();
// P4-B1: per host, the card whose thread the host last drew active; a remount drawing the same card (the margin moving
// it, the panel's round trip) leaves the active thread as the human last set it (only the human activates)
const activatedCard = new Map<string, number>();
/**
 * P4-B3 (its Decision Log 37): a move hands the card host to a new editor (the host id the tab state keeps), whose
 * active thread starts at none, so the card it draws must activate its thread again there; an overlay-only remount
 * keeps the mark and does not.
 */
export function forgetCardActivation(hostId: string): void {
  activatedCard.delete(hostId);
}

/**
 * P4-B3 (its Decision Log 39): a move that activates another view of the document (T5, T8) closes this host's view
 * rather than carrying it, so the card this host draws, the comment typed in it and the drafts it holds go to the kept
 * view's host as this view closes, keeping that view's editor: the card is drawn there with its text, its thread stays, and the
 * closing view has nothing of it to lose. A comment still waiting on its session to start (nothing typed yet) stays
 * with this host and goes with it.
 */
export function handCommentCardOver(artifactId: string, from: string, to: string): void {
  if (from === to) return;
  void artifactId; // UX wave U5a: the comment itself is its pass's, the artifact's whichever view draws it
  drafts.handTo(from, to);
  const { open } = useCommentCard.getState();
  if (open?.hostId === from) handCardTo(open.serial, to);
}

/** The surface DocumentEditor takes (`comments`), stable while the artifact and the session stay. */
export function useDocumentComments({ artifactId, appSessionId, context, title, mode = 'panel', visible = true, holdReplica, artifactKind, hostId: kept /* P4-B3 */ }: Options): DocumentComments { // P3-F1: context
  const own = `document:${useId()}`;
  const hostId = kept ?? own;
  const titleRef = useRef(title);
  useLayoutEffect(() => {
    titleRef.current = title;
  });
  // P4-B1: the overlay's latest props, whether the margin hosts it (its placement) and where the passage is
  const overlaid = useRef<CommentOverlayProps | null>(null);
  const opened = useCallback(
    (passage: CommentedPassage) => {
      const anchor = artifactCommentAnchor({ artifactId, title: titleRef.current, ...passage, ...(artifactKind !== undefined && { artifactKind }) /* P3-C */ });
      const placement = placementOf(overlaid.current, hostId, passage.threadId); // P4-B1
      // UX wave U5a: the draft withdrawn through the overlay that drew it (its replica, held by the draft)
      const view = overlaid;
      const withdraw = () => view.current?.discard(passage.threadId);
      // P3-F1 start: the explicit session, else the artifact's own; with neither, a start or the notice (the draft
      // registered after, so the window's card closing for the notice keeps it)
      const session = appSessionId ?? (context?.kind === 'session' ? context.appSessionId : undefined);
      if (session === undefined) {
        startCommentSession({ hostId, artifactId, threadId: passage.threadId, label: anchor.label, context: context?.kind === 'directory' ? context : { kind: 'none' }, open: (started) => openCommentComposer(anchor, { appSessionId: started, placement, destination: 'main' }) });
        drafts.opened(hostId, passage.threadId, withdraw, holdReplica);
        return;
      }
      // P3-F1 end
      // UX wave U5a: the pass keeps one unsent comment; one with text returns the person to it, the new thread withdrawn
      // (the store opens the card on it and the new draft, held by nothing, goes)
      drafts.opened(hostId, passage.threadId, withdraw, holdReplica);
      openCommentComposer(anchor, { appSessionId: session /* P3-F1 */, placement });
    },
    [artifactId, appSessionId, context /* P3-F1 */, hostId, artifactKind, holdReplica],
  );
  // P3-F1 start: a comment waiting on its session belongs to the target it was made for; the target moving on (another
  // directory, a session found, a chat shown beside it) withdraws it and its draft, so its start, settling later, opens
  // nothing on the old one. An equal target given anew is the same target.
  const target = targetKeyOf(appSessionId, context);
  const madeFor = useRef(target);
  useLayoutEffect(() => {
    if (madeFor.current === target) return;
    madeFor.current = target;
    cancelPendingComment(hostId);
  }, [target, hostId]);
  // P3-F1 end
  return useMemo(() => {
    const binding: Binding = { artifactId, hostId, mode, visible, holdReplica }; // UX wave U5a: the card names its session by one rule
    // P4-B1 (C7, X36's one draft per artifact): the thread of the artifact's unsent comment with text (UX wave U5a: its
    // pass's, whichever view's card it was written in)
    const draft = (): string | null => commentDraftOf(artifactId)?.threadId ?? null;
    // P4-B2: or, with nothing typed yet, the card this host draws (a deck's pin whose only thread is the card's reveals
    // it). UX wave U5a: a comment with no card open is opened on this host first; its field takes the keyboard as it mounts
    const focusDraft = () => {
      const unsent = unsentCommentOf(artifactId);
      const { open } = useCommentCard.getState();
      const onIt = open?.hostId === hostId && open.phase.kind === 'composing' && unsent !== null && open.phase.comment === unsent.comment.id;
      if (unsent !== null && !onIt) return editComment(unsent.pass, unsent.comment.id, hostId);
      const serial = open?.hostId === hostId ? open.serial : null;
      const card = serial === null ? null : document.querySelector<HTMLElement>(`[data-comment-card][data-card-serial="${serial}"]`);
      const field = card?.querySelector<HTMLTextAreaElement>('textarea');
      if (field) focusAtEnd(field);
      else card?.focus({ preventScroll: true });
    };
    return {
      opened,
      overlay: (props: CommentOverlayProps): ReactNode => {
        overlaid.current = props; // P4-B1
        return <DocumentCardHost {...props} binding={binding} />;
      },
      draft,
      focusDraft, // P4-B1
    };
  }, [opened, artifactId, hostId, mode, visible, holdReplica]);
}

// P4-B1 (D7): a card the margin will host opens with the margin placement (where its passage is, for the record), any
// other over the page's frame; both are this host's card.
function placementOf(overlay: CommentOverlayProps | null, hostId: string, threadId: string): CommentPlacement {
  if (overlay?.placement !== 'margin') return { kind: 'card', host: 'artifact', hostId };
  return { kind: 'margin', host: 'document', hostId, anchorY: overlay.locate(threadId)?.y ?? 0 };
}

// P3-F1: where a document's comments go, by what it is rather than by the object that says it
function targetKeyOf(appSessionId: AppSessionId | undefined, context: ArtifactSessionContext | undefined): string {
  if (appSessionId !== undefined) return JSON.stringify(['session', appSessionId]);
  if (context?.kind === 'session') return JSON.stringify(['session', context.appSessionId]);
  if (context?.kind === 'directory') return JSON.stringify(['directory', context.path, context.projectId]);
  return JSON.stringify(['none']);
}

const threadOf = (card: OpenCard | null): string | null => (card?.target?.kind === 'artifact' ? card.target.threadId : null);

function DocumentCardHost({ binding, ...editor }: CommentOverlayProps & { binding: Binding }) {
  const { artifactId, hostId, mode, visible, holdReplica } = binding;
  const pending = usePendingComment(hostId); // P3-F1
  const { doc, locate, layoutKey, setActive, resolve, reopen, record, focus, hosting, placement, flash } = editor; // P4-B1: hosting, placement; UX wave U5a: flash
  const inMargin = placement === 'margin'; // P4-B1

  // UX wave U5a (M7; A17): the answer's arrival, read while the editor offers its tint, and acted on only while the
  // document is on screen
  const shown = useRef({ visible, inMargin });
  useLayoutEffect(() => {
    shown.current = { visible, inMargin };
  });
  useEffect(() => {
    if (!flash) return;
    return watchAnswers(doc, hostId, (threadId) => {
      if (!shown.current.visible || document.visibilityState === 'hidden') return;
      flash(threadId);
      if (!shown.current.inMargin) foldCard(hostId, threadId);
    });
  }, [doc, hostId, flash]);

  // The card on screen draws its thread as active. The overlay going is the editor going only when no overlay of this
  // host is back a microtask later; a remount (a tab switch) keeps the composing card. UX wave U5a: neither withdraws a
  // draft (its comment is the pass's), and with no card the margin keeps the entry of the line's or the unsent comment's
  // thread, where the host draws them.
  useEffect(() => {
    mountedOverlays.add(hostId);
    // the replica the draft is withdrawn from stays open until that withdrawal is written (the tab may go first)
    const release = holdReplica?.();
    let shown: string | null = null;
    let hosted: string | null = null; // UX wave U5a
    const follow = (open: OpenCard | null) => {
      const mine = open?.hostId === hostId ? open : null;
      const waiting = pendingThreadOf(hostId); // P3-F1: a comment waiting on its session is this host's draft too
      const threadId = threadOf(mine) ?? waiting; // P3-F1: ?? waiting
      if (threadId !== shown) {
        shown = threadId;
        if (mine === null || activatedCard.get(hostId) !== mine.serial) setActive(threadId); // P4-B1: not again for the same card
        if (mine === null) activatedCard.delete(hostId);
        else activatedCard.set(hostId, mine.serial); // P4-B1
      }
      // P4-B1: the margin hosts the card in that thread's entry. UX wave U5a (§C): with no card, the line of where its
      // send went, in the entry of the thread it was on, until the line ends
      const host = threadId ?? (mine === null ? (noteThreadOf('artifact', artifactId) ?? unsentCommentOf(artifactId)?.threadId ?? null) : null);
      if (host !== hosted) {
        hosted = host;
        hosting?.(host);
      }
    };
    follow(useCommentCard.getState().open);
    const stop = useCommentCard.subscribe((state) => follow(state.open));
    const stopPending = subscribePending(() => follow(useCommentCard.getState().open)); // P3-F1
    return () => {
      stop();
      stopPending(); // P3-F1
      if (hosted !== null) hosting?.(null); // P4-B1: at once; a remount (the overlay moving in the margin) reports again
      mountedOverlays.delete(hostId);
      queueMicrotask(() => {
        try {
          if (!mountedOverlays.has(hostId)) {
            cancelPendingComment(hostId); // P3-F1: the editor went, and the comment waiting on its session with it
            activatedCard.delete(hostId); // P4-B1
          }
        } finally {
          release?.();
        }
      });
    };
  }, [hostId, setActive, holdReplica, hosting, artifactId /* P4-B1 */]);

  const frame = useMemo<CardFrame>(
    () => ({
      scale: 1,
      offset: { x: 0, y: 0 },
      key: layoutKey,
      // the card's thread, wherever the editor now draws its passage (the anchor's locator is the quote); UX wave U5a: with
      // no card of this host's, the unsent comment's, where its chip sits
      locate: async () => {
        const { open } = useCommentCard.getState();
        const threadId = open?.hostId === hostId ? threadOf(open) : (unsentCommentOf(artifactId)?.threadId ?? null);
        return threadId === null ? null : locate(threadId);
      },
      actions: (card) => {
        const threadId = threadOf(card);
        return threadId === null ? null : (
          <ThreadAction
            doc={doc}
            threadId={threadId}
            onResolve={() => {
              drafts.keep(threadId); // resolved on purpose: it stays, listed under Resolved
              resolve(threadId);
              closeCard(card.serial);
              focus();
            }}
            onReopen={() => reopen(threadId)}
          />
        );
      },
      onSending: (card, { text }) => {
        const threadId = threadOf(card);
        if (threadId === null) return () => {};
        const release = holdReplica?.();
        const settle = drafts.sending(threadId, text, record);
        return (went) => {
          try {
            settle(went);
          } finally {
            release?.();
          }
        };
      },
      // UX wave U5a (§F): one unsent comment per artifact, and the person's discard withdraws its thread and mark
      holds: 'one',
      onDiscarded: (comment: PassComment) => {
        const threadId = threadIdOf(comment.anchor);
        if (threadId !== null) drafts.discarded(threadId);
      },
    }),
    [layoutKey, hostId, locate, doc, resolve, reopen, record, focus, holdReplica, artifactId],
  );

  return (
    <>
      {/* P3-F1: the comment waiting on its session, where its card will be */}
      {pending && (
        <PendingCommentNotice
          pending={pending}
          locate={locate}
          layoutKey={layoutKey}
          inFlow={inMargin} // P4-B1: in the margin's entry, above the card host
          onClose={() => {
            cancelPendingComment(hostId);
            focus();
          }}
        />
      )}
      <CommentCardHost
        hostId={hostId}
        host="artifact"
        mode={mode}
        layout={inMargin ? 'margin' : 'anchored'} // P4-B1
        accepts={(card) => card.target?.kind === 'artifact' && card.target.artifactId === artifactId}
        frame={frame}
        visible={visible}
        restoreFocus={focus}
        subject={artifactId} // UX wave U5a: the artifact's pass
      />
    </>
  );
}

// UX wave U5a (M7; A17): the host's card on the answered thread closes to the passage's mark when it floats over the text
// of a body under 720 px and the keyboard is not in it; nothing else changes.
function foldCard(hostId: string, threadId: string): void {
  const { open } = useCommentCard.getState();
  if (open?.hostId !== hostId || threadOf(open) !== threadId) return;
  const card = document.querySelector<HTMLElement>(`[data-comment-card][data-card-serial="${open.serial}"]`);
  if (!card || card.contains(document.activeElement)) return;
  const width = card.closest<HTMLElement>('.doc-editor-body')?.clientWidth ?? 0; // 0: not laid out, which is not narrow
  if (width > 0 && width < RAIL_BESIDE_FROM_PX) closeCard(open.serial);
}

// Resolve for an open thread, Reopen for a resolved one, following the threads map.
function ThreadAction({ doc, threadId, onResolve, onReopen }: { doc: CommentOverlayProps['doc']; threadId: string; onResolve(): void; onReopen(): void }) {
  const status = useThreadStatus(doc, threadId);
  if (status === null) return null;
  return (
    <button type="button" className={`${QUIET} text-ui-sm`} onClick={status === 'open' ? onResolve : onReopen}>
      {status === 'open' ? 'Resolve' : 'Reopen'}
    </button>
  );
}
