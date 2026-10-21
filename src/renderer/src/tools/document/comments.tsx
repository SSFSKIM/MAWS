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
// placement then. The host opts into X36's draft rule: the composing field's text is the artifact's draft
// (./comment-drafts.ts), which the editor's next Comment refocuses (`draft`, `focusDraft`), Escape keeps and the tab's
// close guard asks about; a blur with an empty field discards the card.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { CommentOverlayProps, CommentedPassage, DocumentComments } from '@artifacts/document/editor/comments/surface';
import { useThreadStatus } from '@artifacts/document/editor/comments/use-threads';
import { anchorField, type Anchor } from '@shared/anchor/anchor';
import type { ArtifactKind } from '@shared/artifacts/entity'; // P3-C
import type { AppSessionId } from '@shared/graph/ids';
import type { ArtifactSessionContext } from '../../artifacts/session-context'; // P3-F1
import { QUIET } from '../../sessions/ui';
import { CommentCardHost, type CardFrame } from '../../side/card/CardHost';
import { closeCard, handCardTo /* P4-B3 */, useCommentCard, type CardHostMode, type OpenCard } from '../../side/card/store';
import { focusAtEnd } from '../../side/card/CommentCard'; // P4-B1
import { openCommentComposer, type CommentPlacement } from '../code/anchor/anchor'; // P4-B1: CommentPlacement
import { commentDraftEntry, dropCommentDraft, recordCommentDraft } from './comment-drafts'; // P4-B1
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
   * P4-B1 (D8; X36's draft rule): the surface keeps a typed comment as the artifact's one draft (Escape keeps it, an empty
   * card is discarded on a blur, `draft()` and the tab's close guard read it). Only a surface whose editor asks `draft()`
   * and whose tab guards its close opts in (the document's); without it Escape discards as before.
   */
  draftRule?: true;
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
  namesParent: boolean; // P3-F1: no chat beside it, so the card names its session
  draftRule: boolean; // P4-B1
}

// A card host's drafts: the new threads it opened that nothing was said in yet, each with the sends in it still on their
// way. A draft is withdrawn (the thread and its mark) once its card no longer composes and no send in it is on its way;
// a send that went is recorded as the thread's message and the thread is no draft any more, whatever became of the card
// or the editor meanwhile (P2 completes a send after its card was closed or replaced, by design); a refused one leaves
// the draft as it was. Kept outside React, by thread, each naming its host: the opener, the card's sends and the host's
// effect all change it, a send outlives the host, and (P4-B3) a move that activates another view of the document hands
// the host's drafts to that view's host, sends on their way included.
interface DraftThread {
  hostId: string;
  sends: number; // on their way
}
const draftThreads = new Map<string, DraftThread>(); // draft thread id → its host and sends
const composingIn = new Map<string, string>(); // host id → the thread its card composes in

const drafts = {
  opened(hostId: string, threadId: string): void {
    draftThreads.set(threadId, { hostId, sends: 0 });
  },

  /** Kept on purpose (resolved from its card): never withdrawn. */
  keep(threadId: string): void {
    draftThreads.delete(threadId);
  },

  /** The host's card composes in `threadId` now (null: none, or the host went): every other idle draft of it is withdrawn. */
  follow(hostId: string, threadId: string | null, withdraw: (threadId: string) => void): void {
    if (threadId === null) composingIn.delete(hostId);
    else composingIn.set(hostId, threadId);
    for (const [id, draft] of [...draftThreads]) {
      if (draft.hostId !== hostId || id === threadId || draft.sends > 0) continue;
      draftThreads.delete(id);
      withdraw(id);
    }
  },

  /** A send in `threadId` set out; the call returned settles it. */
  sending(threadId: string, text: string, { record, withdraw }: { record(threadId: string, body: string): void; withdraw(threadId: string): void }): (went: boolean) => void {
    const draft = draftThreads.get(threadId);
    if (draft) draft.sends += 1;
    return (went) => {
      if (went) {
        draftThreads.delete(threadId);
        record(threadId, text);
      } else if (draft && draftThreads.get(threadId) === draft) {
        draft.sends -= 1;
        if (draft.sends === 0 && composingIn.get(draft.hostId) !== threadId) {
          draftThreads.delete(threadId);
          withdraw(threadId);
        }
      }
    };
  },

  /** P4-B3 (its Decision Log 39): the host's drafts, and the thread its card composes in, are `to`'s from now on. */
  handTo(from: string, to: string): void {
    for (const draft of draftThreads.values()) if (draft.hostId === from) draft.hostId = to;
    const composing = composingIn.get(from);
    composingIn.delete(from);
    if (composing !== undefined) composingIn.set(to, composing);
  },
};

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
  drafts.handTo(from, to); // first: this host following the card away withdraws only what is still its own
  const entry = commentDraftEntry(artifactId);
  if (entry?.hostId === from) recordCommentDraft(artifactId, { ...entry, hostId: to });
  const { open } = useCommentCard.getState();
  if (open?.hostId === from) handCardTo(open.serial, to);
}

/** The surface DocumentEditor takes (`comments`), stable while the artifact and the session stay. */
export function useDocumentComments({ artifactId, appSessionId, context, title, mode = 'panel', visible = true, holdReplica, artifactKind, draftRule /* P4-B1 */, hostId: kept /* P4-B3 */ }: Options): DocumentComments { // P3-F1: context
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
      // P3-F1 start: the explicit session, else the artifact's own; with neither, a start or the notice (the draft
      // registered after, so the window's card closing for the notice keeps it)
      const session = appSessionId ?? (context?.kind === 'session' ? context.appSessionId : undefined);
      if (session === undefined) {
        startCommentSession({ hostId, artifactId, threadId: passage.threadId, label: anchor.label, context: context?.kind === 'directory' ? context : { kind: 'none' }, open: (started) => openCommentComposer(anchor, { appSessionId: started, placement, destination: 'main' }) });
        drafts.opened(hostId, passage.threadId);
        return;
      }
      // P3-F1 end
      drafts.opened(hostId, passage.threadId);
      openCommentComposer(anchor, { appSessionId: session /* P3-F1 */, placement });
    },
    [artifactId, appSessionId, context /* P3-F1 */, hostId, artifactKind],
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
  const namesParent = appSessionId === undefined; // P3-F1
  return useMemo(() => {
    const binding: Binding = { artifactId, hostId, mode, visible, holdReplica, namesParent /* P3-F1 */, draftRule: draftRule === true /* P4-B1 */ };
    // P4-B1 (C7, X36's one draft per artifact): the thread whose card on this host holds unsent text
    const draft = (): string | null => {
      const entry = commentDraftEntry(artifactId);
      const { open } = useCommentCard.getState();
      return entry !== null && entry.hostId === hostId && open?.serial === entry.serial && open.hostId === hostId && open.phase.kind === 'composing' ? entry.threadId : null;
    };
    // P4-B2: or, with nothing typed yet, the card this host draws (a deck's pin whose only thread is the card's reveals it)
    const focusDraft = () => {
      const entry = commentDraftEntry(artifactId);
      const { open } = useCommentCard.getState();
      const serial = entry?.hostId === hostId ? entry.serial : open?.hostId === hostId ? open.serial : null;
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
      ...(draftRule && { draft, focusDraft }), // P4-B1
    };
  }, [opened, artifactId, hostId, mode, visible, holdReplica, namesParent /* P3-F1 */, draftRule /* P4-B1 */]);
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
  const { artifactId, hostId, mode, visible, holdReplica, namesParent, draftRule } = binding; // P3-F1: namesParent; P4-B1: draftRule
  const pending = usePendingComment(hostId); // P3-F1
  const { doc, locate, layoutKey, setActive, resolve, reopen, record, discard, focus, hosting, placement } = editor; // P4-B1: hosting, placement
  const inMargin = placement === 'margin'; // P4-B1

  // The card on screen draws its thread as active; a draft whose card went with nothing on its way is withdrawn. The
  // overlay going is the card going only when no overlay of this host is back a microtask later (P2's host closes the
  // card then); a remount (a tab switch) keeps the composing card, and so its draft.
  useEffect(() => {
    mountedOverlays.add(hostId);
    // the replica the draft is withdrawn from stays open until that withdrawal is written (the tab may go first)
    const release = holdReplica?.();
    let shown: string | null = null;
    const follow = (open: OpenCard | null) => {
      const mine = open?.hostId === hostId ? open : null;
      const waiting = pendingThreadOf(hostId); // P3-F1: a comment waiting on its session is this host's draft too
      const threadId = threadOf(mine) ?? waiting; // P3-F1: ?? waiting
      drafts.follow(hostId, mine?.phase.kind === 'composing' ? threadOf(mine) : waiting, discard); // P3-F1: threadOf(mine), waiting
      // P4-B1: the typed draft goes with its card (closed, replaced, or turned into its thread)
      dropCommentDraft(artifactId, hostId, mine?.phase.kind === 'composing' ? { serial: mine.serial } : undefined);
      if (threadId !== shown) {
        shown = threadId;
        if (mine === null || activatedCard.get(hostId) !== mine.serial) setActive(threadId); // P4-B1: not again for the same card
        if (mine === null) activatedCard.delete(hostId);
        else activatedCard.set(hostId, mine.serial); // P4-B1
        hosting?.(threadId); // P4-B1: the margin hosts the card in that thread's entry
      }
    };
    follow(useCommentCard.getState().open);
    const stop = useCommentCard.subscribe((state) => follow(state.open));
    const stopPending = subscribePending(() => follow(useCommentCard.getState().open)); // P3-F1
    return () => {
      stop();
      stopPending(); // P3-F1
      if (shown !== null) hosting?.(null); // P4-B1: at once; a remount (the overlay moving in the margin) reports again
      mountedOverlays.delete(hostId);
      queueMicrotask(() => {
        try {
          if (!mountedOverlays.has(hostId)) {
            cancelPendingComment(hostId); // P3-F1: the editor went, and the comment waiting on its session with it
            drafts.follow(hostId, null, discard);
            dropCommentDraft(artifactId, hostId); // P4-B1
            activatedCard.delete(hostId); // P4-B1
          }
        } finally {
          release?.();
        }
      });
    };
  }, [hostId, discard, setActive, holdReplica, hosting, artifactId /* P4-B1 */]);

  const frame = useMemo<CardFrame>(
    () => ({
      scale: 1,
      offset: { x: 0, y: 0 },
      key: layoutKey,
      // the card's thread, wherever the editor now draws its passage (the anchor's locator is the quote)
      locate: async () => {
        const { open } = useCommentCard.getState();
        const threadId = open?.hostId === hostId ? threadOf(open) : null;
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
        const settle = drafts.sending(threadId, text, { record, withdraw: discard });
        return (went) => {
          try {
            settle(went);
          } finally {
            release?.();
          }
        };
      },
      ...(namesParent && { namesParent: true as const }), // P3-F1
      // P4-B1 start (D8; X36's draft rule, for the surface that opts in)
      ...(draftRule && {
        onDraft: (card: OpenCard, text: string) => {
          const threadId = threadOf(card);
          if (threadId !== null) recordCommentDraft(artifactId, { hostId, serial: card.serial, threadId, text });
        },
        draftOf: (card: OpenCard) => {
          const entry = commentDraftEntry(artifactId);
          return entry?.hostId === hostId && entry.serial === card.serial ? entry.text : '';
        },
        keepDraftOnEscape: true as const,
        discardOnBlurEmpty: true as const,
      }),
      // P4-B1 end
    }),
    [layoutKey, hostId, locate, doc, resolve, reopen, record, discard, focus, holdReplica, namesParent /* P3-F1 */, artifactId, draftRule /* P4-B1 */],
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
      />
    </>
  );
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
