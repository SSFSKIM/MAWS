// P3-F1 fix 2 (docs/doperpowers/ledgers/2026-10-17-P3-F1.md; the P3 co-work spec's Decision Log 96; the P3 interface
// ledger's X23 row of fix 2): the session a comment on a document or deck goes to, and the owner's start of one when
// the artifact has no session yet. Beside a chat the comment goes to the session the main area shows, as it always did.
// On a tab with no chat beside it the comment goes where the artifact itself points, H's owner-start policy
// (`artifacts/session-context.ts`, Decision Log 87): its own session at once; else a session in its Space's linked
// directory or its project's, started by the owner's Comment (never on mount or a timer) and reused by the next
// comment; else none, and the card says so in its place.
//
// While a start runs, or when it is refused or there is no context, a notice stands where the card would: one per
// window, as the card is (the latest gesture wins), naming why in H's words, with Open session when a session it made
// holds the reason. Close, Escape, a later card anywhere, or the editor going withdraws it, and its comment's draft with
// it (B's drafts read `pendingThreadOf`); a start that settles after that opens nothing. One start runs per artifact
// and directory at a time (a Comment meanwhile joins it), and the session it made is reused only in that directory. A
// card opened on a session started for the comment starts on Send to main: a blank session has no conversation a side
// thread could fork.
// P3-F F4 (c26, the owner's E1 mark): a start that meets the trust card asks the owner in the notice itself, naming the
// folder, with the composer card's two answers (Trust and start, Start without trusting); the comment's draft stays
// meanwhile, and the owner's click starts the same session again with that answer (StartOptions.trust, the one way the
// composer's card sends it), the card then opening on the same passage. Nothing here answers trust by itself. Open
// session stays for every other card and refusal. The notice says of the folder what the composer's card says
// (TrustCard's `TrustDetails`): the repository trust is recorded for, and what trust would turn on.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { create } from 'zustand';
import type { PassageRect } from '@artifacts/document/editor/comments/surface';
import type { AppSessionId } from '@shared/graph/ids';
import type { TrustState } from '@shared/sessions/trust'; // P3-F F4
import { NO_SESSION_CONTEXT, startArtifactSession, useArtifactSessionContext, type ArtifactSessionContext, type ArtifactSessionEnd, type StartTrust } from '../../artifacts/session-context'; // P3-F F4: StartTrust
import { useLibraryRow, useLibrarySpaces } from '../../library/store';
import { shownSession } from '../../panel/host';
import { TrustDetails } from '../../sessions/TrustCard'; // P3-F F4
import { PRIMARY, QUIET, SECONDARY } from '../../sessions/ui'; // P3-F F4: PRIMARY, QUIET
import { SIDE_COPY } from '../../side/copy';
import { placeCard, pinOf, type CardStyle } from '../../side/card/placement';
import { closeCard, useCommentCard } from '../../side/card/store';
import { useLayout } from '../../stores/layout';

const COPY = SIDE_COPY.card;
const STARTING = 'Starting a session for this comment…';
const COULD_NOT_START = 'The session did not start';
const OPEN_SESSION = 'Open session';
// P3-F F4: the trust question in the card's place (what it records and turns on is the composer card's, TrustDetails)
const TRUST_ASK = 'Trust this folder to start a session for this comment?';

// ---- the target --------------------------------------------------------------------------------------------------------

/** Where a document surface's comments go: an explicit session (the shown chat's), or the artifact's own context. */
export type ArtifactCommentTarget = { appSessionId: AppSessionId } | { context: ArtifactSessionContext };

/**
 * The shown chat's session; with none shown, the artifact's context as the window knows it. Null only while the
 * artifact's library row, or the Spaces an artifact in a Space needs, are still unread (comments are not offered then,
 * so the card never says "no context" of an artifact it has not read yet).
 */
export function useArtifactCommentTarget(artifactId: string): ArtifactCommentTarget | null {
  const shown = useLayout((s) => shownSession(s.main));
  const row = useLibraryRow(shown === null ? artifactId : null);
  const spaces = useLibrarySpaces();
  const artifact = shown === null ? (row.value ?? null) : null;
  const context = useArtifactSessionContext(artifact);
  const rowUnread = row.value === undefined && row.status !== 'error';
  const spacesUnread = artifact?.spaceId !== undefined && spaces.value === undefined && spaces.status !== 'error';
  const waiting = shown === null && (rowUnread || spacesUnread);
  // keyed by what the target is, so the comment surface built on it stays stable while it stays
  const own = context.kind === 'session' ? context.appSessionId : null;
  const path = context.kind === 'directory' ? context.path : null;
  const projectId = context.kind === 'directory' ? context.projectId : null;
  const kind = context.kind;
  return useMemo((): ArtifactCommentTarget | null => {
    if (shown !== null) return { appSessionId: shown };
    if (waiting) return null;
    if (kind === 'session' && own !== null) return { context: { kind, appSessionId: own } };
    if (kind === 'directory' && path !== null) return { context: { kind, path, projectId } };
    return { context: { kind: 'none' } };
  }, [shown, waiting, kind, own, path, projectId]);
}

// ---- the pending comment -----------------------------------------------------------------------------------------------

type Notice =
  | { status: 'none' | 'starting'; words: string }
  | { status: 'refused' | 'card'; words: string; appSessionId: AppSessionId | null }
  // P3-F F4: the trust card's question, answered here by the owner's click (`decide`)
  | { status: 'trust'; words: string; trust: TrustState; decide(trust: StartTrust): void };

interface Pending {
  serial: number;
  hostId: string;
  threadId: string;
  label: string; // the anchor's, as the card's title reads it
  notice: Notice;
}

const usePending = create<{ pending: Pending | null }>()(() => ({ pending: null }));
let serials = 0;
let stopWatch: (() => void) | null = null; // the card store's watch for a later card

// The starts of each artifact's directory in this window, by the artifact and the directory (and project) it starts in:
// the session the last one made (the next one's `previous`, H's reuse, so a context that moved never resumes the old
// directory's session) and the start still on its way, which a Comment arriving meanwhile joins rather than making a
// second session. A start runs to its end whatever becomes of the notices waiting on it; only the latest opens a card.
interface Starts {
  previous: AppSessionId | null;
  running: Promise<ArtifactSessionEnd> | null;
}
const starts = new Map<string, Starts>();
const startKey = (artifactId: string, context: Extract<ArtifactSessionContext, { kind: 'directory' }>) => JSON.stringify([artifactId, context.path, context.projectId]);

// P3-F F4: `trust`, the owner's answer to the trust card the last start met (a start already on its way is joined as is)
function startIn(artifactId: string, context: Extract<ArtifactSessionContext, { kind: 'directory' }>, trust?: StartTrust): Promise<ArtifactSessionEnd> {
  const key = startKey(artifactId, context);
  let entry = starts.get(key);
  if (!entry) starts.set(key, (entry = { previous: null, running: null }));
  const own = entry;
  if (own.running) return own.running;
  const running = (async (): Promise<ArtifactSessionEnd> => {
    try {
      const answer = await startArtifactSession(context, own.previous, undefined, trust); // P3-F F4: trust
      if (answer.appSessionId !== null) own.previous = answer.appSessionId;
      return answer.status === 'starting' ? await answer.settled : answer;
    } catch (error) {
      return { status: 'refused', appSessionId: null, words: error instanceof Error ? error.message : String(error) };
    }
  })();
  own.running = running;
  void running.then(() => {
    if (own.running === running) own.running = null;
  });
  return running;
}

function clear(): void {
  stopWatch?.();
  stopWatch = null;
  if (usePending.getState().pending !== null) usePending.setState({ pending: null });
}

/** The thread a pending comment of this host holds (its draft is kept), or null. Read outside render. */
export const pendingThreadOf = (hostId: string): string | null => {
  const { pending } = usePending.getState();
  return pending?.hostId === hostId ? pending.threadId : null;
};
export const subscribePending = (listener: () => void): (() => void) => usePending.subscribe(listener);
/** The host's pending comment, if any, withdrawn (Close, Escape, the editor going). */
export function cancelPendingComment(hostId: string): void {
  if (usePending.getState().pending?.hostId === hostId) clear();
}
export const usePendingComment = (hostId: string): Pending | null => usePending((s) => (s.pending?.hostId === hostId ? s.pending : null));

interface StartInput {
  hostId: string;
  artifactId: string;
  threadId: string;
  label: string;
  context: Extract<ArtifactSessionContext, { kind: 'directory' | 'none' }>; // an own session opens the card at once, never here
  open(appSessionId: AppSessionId): void; // the card, on the session the start answered
}

/** The owner's Comment with no session to open the card on: a start in the artifact's directory, or the notice why not. */
export function startCommentSession({ hostId, artifactId, threadId, label, context, open }: StartInput): void {
  clear();
  const serial = ++serials;
  const mine = (): boolean => usePending.getState().pending?.serial === serial;
  const words = context.kind === 'none' ? NO_SESSION_CONTEXT : STARTING;
  // set before the card goes, so the host's drafts keep this comment's while the window's card closes
  usePending.setState({ pending: { serial, hostId, threadId, label, notice: { status: context.kind === 'none' ? 'none' : 'starting', words } } });
  closeCard(); // the latest gesture wins, as a card's open would
  stopWatch = useCommentCard.subscribe((s) => {
    if (s.open !== null && mine()) clear(); // a later card, ours included: the notice is done
  });
  if (context.kind === 'none') return;
  const say = (notice: Notice) => {
    if (mine()) usePending.setState({ pending: { ...usePending.getState().pending!, notice } });
  };
  // P3-F F4: a start, with the owner's trust answer once the trust card asked for it
  const run = (trust?: StartTrust) =>
    void startIn(artifactId, context, trust).then((end) => {
      if (!mine()) return; // replaced, closed or gone meanwhile: the start's session stays for the next comment
      if (end.status === 'ready') open(end.appSessionId); // the card's open clears the notice
      else if (end.status === 'card' && end.trust) say({ status: 'trust', words: TRUST_ASK, trust: end.trust, decide }); // P3-F F4
      else say({ status: end.status, words: end.words || COULD_NOT_START, appSessionId: end.appSessionId });
    });
  // P3-F F4: the owner's click on one of the notice's answers; a notice already gone starts nothing
  const decide = (trust: StartTrust) => {
    if (!mine()) return;
    say({ status: 'starting', words: STARTING });
    run(trust);
  };
  run();
}

// ---- the notice --------------------------------------------------------------------------------------------------------

function positionOf(style: CardStyle): CSSProperties {
  switch (style.mode) {
    case 'below':
      return { left: style.left, top: style.top, width: style.width, maxHeight: style.maxHeight };
    case 'above':
      return { left: style.left, bottom: style.bottom, width: style.width, maxHeight: style.maxHeight };
    default:
      return { left: 8, bottom: 8, width: style.width, maxHeight: style.maxHeight };
  }
}

interface NoticeProps {
  pending: Pending;
  locate(threadId: string): PassageRect | null;
  layoutKey: string;
  onClose(): void;
  // P4-B1 (D7 of docs/doperpowers/plans/2026-10-20-p4-b1-margin-comments.md): in the document margin's entry, in flow
  // at the entry's width above the card host, rather than pinned over the page
  inFlow?: boolean;
}

/**
 * The pending comment's notice, where its card would be: over the editor's page, pinned under the passage. Each comment's
 * notice is its own (keyed by its serial), so one replacing another on the same host mounts afresh and takes the keyboard.
 */
export function PendingCommentNotice(props: NoticeProps) {
  return <Notice key={props.pending.serial} {...props} />;
}

function Notice({ pending, locate, layoutKey, onClose, inFlow = false /* P4-B1 */ }: NoticeProps) {
  const host = useRef<HTMLDivElement>(null);
  const box = useHostBox(host);
  const rect = useLocated(pending.threadId, locate, layoutKey, box, !inFlow /* P4-B1: the margin places the entry */);
  const style = placeCard(box, rect ? pinOf(rect, { scale: 1, offset: { x: 0, y: 0 } }) : null);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => card.current?.focus(), []);
  const { notice } = pending;
  const session = 'appSessionId' in notice ? notice.appSessionId : null;
  const trust = notice.status === 'trust' ? notice : null; // P3-F F4
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };
  return (
    // P4-B1: in flow in the margin's entry (the column carries the occluder), else over the page
    <div ref={host} {...(inFlow ? { 'data-notice-flow': '' } : { 'data-markup-occluder': '' })} className={inFlow ? 'relative' : 'pointer-events-none absolute inset-0 z-10 overflow-hidden'}>
      <div
        ref={card}
        role="dialog"
        tabIndex={-1}
        aria-label={COPY.title(pending.label)}
        data-comment-context={notice.status}
        style={inFlow ? undefined : positionOf(style) /* P4-B1 */}
        onKeyDown={onKeyDown}
        className={`pointer-events-auto ${inFlow ? 'relative w-full' : 'absolute'} flex flex-col gap-2 overflow-y-auto rounded-lg border border-border-strong bg-bg-raised p-2.5 text-ui text-fg shadow-float outline-none`}
      >
        <header className="flex min-w-0 shrink-0 items-center gap-1">
          <h3 className="m-0 min-w-0 flex-1 truncate text-ui-sm font-medium text-fg">{pending.label}</h3>
          <button
            type="button"
            aria-label={COPY.close}
            title={COPY.close}
            onClick={onClose}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2"
          >
            <svg viewBox="0 0 16 16" aria-hidden className="size-3" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>
        <p role="status" className={`m-0 text-ui-sm ${notice.status === 'refused' ? 'text-danger' : 'text-fg-muted'}`}>
          {notice.words}
        </p>
        {trust !== null && (
          // P3-F F4: what the composer's card says of the folder, then its two answers
          <>
            <TrustDetails trust={trust.trust} />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={PRIMARY} onClick={() => trust.decide('accepted')}>
                Trust and start
              </button>
              <button type="button" className={QUIET} onClick={() => trust.decide('declined')}>
                Start without trusting
              </button>
            </div>
          </>
        )}
        {session !== null && (
          <div className="flex justify-end">
            <button type="button" className={SECONDARY} onClick={() => useLayout.getState().openSession(session, { how: 'tab' })}>
              {OPEN_SESSION}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// The passage where the editor draws it now, asked again whenever it may have moved (the editor's layout key, the box),
// as P2's card host asks its frame: `locate` reads the editor's live view, which a render must not read for itself.
function useLocated(threadId: string, locate: (threadId: string) => PassageRect | null, layoutKey: string, box: { width: number; height: number }, enabled: boolean /* P4-B1 */): PassageRect | null {
  const [located, setLocated] = useState<{ threadId: string; rect: PassageRect | null } | null>(null);
  const { width, height } = box;
  useEffect(() => {
    if (!enabled) return; // P4-B1
    let latest = true;
    void Promise.resolve().then(() => {
      if (latest) setLocated({ threadId, rect: locate(threadId) });
    });
    return () => {
      latest = false;
    };
  }, [threadId, locate, layoutKey, width, height, enabled /* P4-B1 */]);
  return located?.threadId === threadId ? located.rect : null;
}

function useHostBox(ref: RefObject<HTMLDivElement | null>): { width: number; height: number } {
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox((was) => (was.width === el.clientWidth && was.height === el.clientHeight ? was : { width: el.clientWidth, height: el.clientHeight }));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [ref]);
  return box;
}
