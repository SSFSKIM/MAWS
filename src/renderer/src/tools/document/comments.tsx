// The document editor's comment surface in the renderer (P3-B M4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md,
// D9; X21's artifact target, X10's artifact-comment anchor): the editor (src/artifacts/, portable) writes a thread and
// its mark and hands the passage here; this opens P2's comment card for it through the composer seam (E5's
// `openCommentComposer`), so Side thread and Send to main go the way every comment goes, and draws the card's host over
// the page, pinned where the editor locates the passage. The card's header gains Resolve (Reopen for a resolved
// thread); a comment the card sent is recorded as the thread's next message, and a new thread whose card closed before
// anything was sent in it is withdrawn with its mark (one whose send is on its way is not: P2's send completes after its
// card went). The card on screen draws its thread as the editor's active one.
// M8's wrappers mount the editor with this; until then the harness page does.
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import type { CommentOverlayProps, CommentedPassage, DocumentComments } from '@artifacts/document/editor/comments/surface';
import { useThreadStatus } from '@artifacts/document/editor/comments/use-threads';
import { anchorField, type Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { QUIET } from '../../sessions/ui';
import { CommentCardHost, type CardFrame } from '../../side/card/CardHost';
import { closeCard, useCommentCard, type CardHostMode, type OpenCard } from '../../side/card/store';
import { openCommentComposer } from '../code/anchor/anchor';

const LABEL_MAX = 200; // X10's label cap
const QUOTE_MAX = 300; // the passage as the lead line and the card's title read it; the thread keeps it whole

/** X10's anchor for a comment on a document's passage: the document and tab as the label, the passage as the locator. */
export function artifactCommentAnchor({ artifactId, title, threadId, tabTitle, quote }: CommentedPassage & { artifactId: string; title: string }): Anchor {
  return { kind: 'artifact-comment', label: anchorField(`${title}, ${tabTitle}`, LABEL_MAX), locator: anchorField(quote, QUOTE_MAX), artifactId, threadId };
}

interface Options {
  artifactId: string;
  /** The session a comment goes to (its Side thread's parent, or the main conversation it steers). */
  appSessionId: AppSessionId;
  /** The document's title, as the anchor names it. */
  title: string;
  /** The surface the editor is in, for a re-docked card (a panel tool or a main tab). */
  mode?: CardHostMode;
  /** The editor is on screen. */
  visible?: boolean;
}

interface Binding {
  artifactId: string;
  hostId: string;
  mode: CardHostMode;
  visible: boolean;
}

// A card host's drafts: the new threads it opened that nothing was said in yet, each with the sends in it still on their
// way. A draft is withdrawn (the thread and its mark) once its card no longer composes and no send in it is on its way;
// a send that went is recorded as the thread's message and the thread is no draft any more, whatever became of the card
// or the editor meanwhile (P2 completes a send after its card was closed or replaced, by design); a refused one leaves
// the draft as it was. Kept outside React, by host id: the opener, the card's sends and the host's effect all change it,
// and a send outlives the host. An entry with no drafts is dropped; it holds nothing else worth keeping.
class Drafts {
  private readonly sends = new Map<string, number>(); // draft thread id → its sends on their way
  private composing: string | null = null; // the thread whose card this host shows composing

  constructor(private readonly hostId: string) {}

  opened(threadId: string): void {
    this.sends.set(threadId, 0);
  }

  /** Kept on purpose (resolved from its card): never withdrawn. */
  keep(threadId: string): void {
    this.sends.delete(threadId);
    this.prune();
  }

  /** The host's card composes in `threadId` now (null: none, or the host went): every other idle draft is withdrawn. */
  follow(threadId: string | null, withdraw: (threadId: string) => void): void {
    this.composing = threadId;
    for (const [id, sending] of [...this.sends]) {
      if (id === threadId || sending > 0) continue;
      this.sends.delete(id);
      withdraw(id);
    }
    this.prune();
  }

  /** A send in `threadId` set out; the call returned settles it. */
  sending(threadId: string, text: string, { record, withdraw }: { record(threadId: string, body: string): void; withdraw(threadId: string): void }): (went: boolean) => void {
    const draft = this.sends.has(threadId);
    if (draft) this.sends.set(threadId, this.sends.get(threadId)! + 1);
    return (went) => {
      if (went) {
        this.sends.delete(threadId);
        record(threadId, text);
      } else if (draft && this.sends.has(threadId)) {
        const left = this.sends.get(threadId)! - 1;
        this.sends.set(threadId, left);
        if (left === 0 && threadId !== this.composing) {
          this.sends.delete(threadId);
          withdraw(threadId);
        }
      }
      this.prune();
    };
  }

  private prune(): void {
    if (this.sends.size === 0 && draftsByHost.get(this.hostId) === this) draftsByHost.delete(this.hostId);
  }
}

const draftsByHost = new Map<string, Drafts>();
function draftsOf(hostId: string): Drafts {
  let drafts = draftsByHost.get(hostId);
  if (!drafts) draftsByHost.set(hostId, (drafts = new Drafts(hostId)));
  return drafts;
}

/** The surface DocumentEditor takes (`comments`), stable while the artifact and the session stay. */
export function useDocumentComments({ artifactId, appSessionId, title, mode = 'panel', visible = true }: Options): DocumentComments {
  const hostId = `document:${useId()}`;
  const titleRef = useRef(title);
  useLayoutEffect(() => {
    titleRef.current = title;
  });
  const opened = useCallback(
    (passage: CommentedPassage) => {
      draftsOf(hostId).opened(passage.threadId);
      openCommentComposer(artifactCommentAnchor({ artifactId, title: titleRef.current, ...passage }), { appSessionId, placement: { kind: 'card', host: 'artifact', hostId } });
    },
    [artifactId, appSessionId, hostId],
  );
  return useMemo(() => {
    const binding: Binding = { artifactId, hostId, mode, visible };
    return { opened, overlay: (props: CommentOverlayProps): ReactNode => <DocumentCardHost {...props} binding={binding} /> };
  }, [opened, artifactId, hostId, mode, visible]);
}

const threadOf = (card: OpenCard | null): string | null => (card?.target?.kind === 'artifact' ? card.target.threadId : null);

function DocumentCardHost({ binding, ...editor }: CommentOverlayProps & { binding: Binding }) {
  const { artifactId, hostId, mode, visible } = binding;
  const { doc, locate, layoutKey, setActive, resolve, reopen, record, discard, focus } = editor;

  // The card on screen draws its thread as active; a draft whose card went with nothing on its way is withdrawn.
  useEffect(() => {
    let shown: string | null = null;
    const follow = (open: OpenCard | null) => {
      const mine = open?.hostId === hostId ? open : null;
      const threadId = threadOf(mine);
      draftsOf(hostId).follow(mine?.phase.kind === 'composing' ? threadId : null, discard);
      if (threadId !== shown) {
        shown = threadId;
        setActive(threadId);
      }
    };
    follow(useCommentCard.getState().open);
    const stop = useCommentCard.subscribe((state) => follow(state.open));
    return () => {
      stop();
      draftsOf(hostId).follow(null, discard);
    };
  }, [hostId, discard, setActive]);

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
              draftsOf(hostId).keep(threadId); // resolved on purpose: it stays, listed under Resolved
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
        return threadId === null ? () => {} : draftsOf(hostId).sending(threadId, text, { record, withdraw: discard });
      },
    }),
    [layoutKey, hostId, locate, doc, resolve, reopen, record, discard, focus],
  );

  return (
    <CommentCardHost
      hostId={hostId}
      host="artifact"
      mode={mode}
      layout="anchored"
      accepts={(card) => card.target?.kind === 'artifact' && card.target.artifactId === artifactId}
      frame={frame}
      visible={visible}
      restoreFocus={focus}
    />
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
