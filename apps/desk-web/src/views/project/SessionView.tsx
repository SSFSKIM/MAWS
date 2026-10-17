// The session view (DC9; the composite's §9.1): a direct channel's center on a desktop whose session's machine is
// online — MAWS's `Transcript` over the session's main transcript with its owner lane on, so MAWS's report by default
// (the `<message>` spans and questions, one working record per marked turn, an unmarked turn whole) and the full
// transcript a toggle away. The transcript is the session's shared owner's (`depth/owner/session-owner.ts`), which the
// depth column holds too: one subscription feeds both. Its streaming text joins the turn it answers, older rows page in
// at the top until the first, and an ended session stays pageable while the view is open, its liveness read from its
// presence. An `Agent` row opens its agent in the column. Loaded as a chunk of its own, so the phone, which never draws
// it, loads none of MAWS's transcript.
//
// What only the log and the hub know joins the transcript (M4; `tail/`): at its tail, the sends not yet in it, each with
// its delivery state in its bubble's foot; then the session's pending requests as the channel's cards, answered in
// place, with an "N waiting ↓" pill while none of them is in view; then an ended or retired session's end marker. The ask
// mod's async question rows carry the log's question and answer. A session whose machine serves no transcript for it
// (its subscription ended at n 0) draws the channel built from the log instead, saying why (`fallback`). A tapped
// notification lands on its request's card at the tail, or on its `<message>`'s row in the transcript. A send's row
// draws without its delivery frame line, a peer's send labelled with who sent it (`conversation/delivery-frame.ts`).
//
// Two decorations of MAWS's view are the desk's own (`styles/app.css`, under `data-session-view`): a gutter that keeps
// every row, breakouts included, clear of MAWS's floating "Jump to latest"; and, while the session is at rest, that
// control's arrow in place of its working dots. MAWS reads a turn as working until a row ends it, and DX4's rows carry
// no SDK result, so an idle session's last turn stays open in the store; the transcript is left as the rows say it, and
// only the control's drawing follows the session's presence.
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useStore } from 'zustand';
import type { LogEvent } from 'desk-hub/protocol';
import type { SubagentRef } from '../../../../../src/renderer/src/transcript/model/rows';
import type { TranscriptActions } from '../../../../../src/renderer/src/transcript/view/context';
import type { TranscriptListHandle } from '../../../../../src/renderer/src/transcript/view/Transcript';
import { askedQuestions } from '../../conversation/asked';
import { retiredBy } from '../../conversation/capabilities';
import { tailSends } from '../../conversation/tail';
import { useSessionOwner } from '../../depth/owner/session-owner';
import { DESK_ACTIONS } from '../../depth/view/actions';
import { TranscriptPane, transcriptStatus, useKeptTranscript } from '../../depth/view/TranscriptPane';
import { sessionName } from '../../log/projection';
import { useLanding } from '../../pwa/service-worker';
import { useDeskLayout } from '../../shell/layout';
import type { SessionPlane } from '../../shell/session-plane';
import type { DeskSession } from '../../shell/sessions';
import { useDesk } from '../conversation/desk-context';
import { useLandOnMessage } from './landed-message';
import { ReportToggle } from './ReportToggle';
import { QuestionOverlays, type QuestionOverlayFact } from './tail/QuestionOverlay';
import { renderTailRow, TailProvider, tailRows, type TailItem } from './tail/session-tail';

type Props = {
  project: string;
  session: DeskSession;
  plane: SessionPlane;
  /** The project's log, verified: the sends to the session and its async questions are read from it. */
  events?: ReadonlyArray<{ offset: number; event: LogEvent }>;
  /** The request a tapped notification landed on, when this channel is the one it opened. */
  landedRequest?: string | null;
  /** The `src` of the `<message>` a tapped notification landed on (`<row uuid>#<span>`), when this channel is the one it opened. */
  landedMessage?: string | null;
  /** What the view draws when the session's machine serves no transcript for it: the log-built channel, with why. */
  fallback?: (why: string) => ReactNode;
};

const NO_EVENTS: ReadonlyArray<{ offset: number; event: LogEvent }> = [];

/** The session is at rest as its machine reports it: idle, or no process. Not while its presence is unknown. */
const atRest = (session: DeskSession) => session.machineOnline !== false && session.presence != null && (session.presence.record === null || session.presence.record.status === 'idle');

export default function SessionView({ project, session, plane, events = NO_EVENTS, landedRequest = null, landedMessage = null, fallback }: Props) {
  const owner = useSessionOwner(project, session, plane);
  const state = useKeptTranscript(owner.keeper);
  const list = useRef<TranscriptListHandle>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const { connection } = useDesk();
  const conversation = useStore(connection.conversation.store);
  const actions = useMemo<Partial<TranscriptActions>>(
    () => ({
      ...DESK_ACTIONS,
      // The column takes the request and opens its Subagents tab on the agent; a closed column opens for it.
      openSubagent: (ref: SubagentRef) => {
        owner.openSubagent(ref);
        if (!useDeskLayout.getState().depth.open) useDeskLayout.getState().setDepth({ open: true });
      },
    }),
    [owner],
  );

  // The rows held, as the subscription keeps them: read again whenever the held set changes (a row, a page, a reset),
  // which its count and its oldest row say.
  const held = owner.main.heldRows();
  const loaded = state.phase === 'live' || held.length > 0;
  const heldCount = held.length;
  const oldest = held[0];
  const sends = useMemo(
    () =>
      tailSends({
        session: session.session,
        machine: session.machine,
        entries: events,
        deliveries: conversation.deliveries,
        outbox: Object.values(conversation.outbox),
        rpcs: Object.values(conversation.rpcs),
        transcript: loaded ? { rows: owner.main.heldRows(), complete: !state.more } : null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the held rows are read through their count and oldest row
    [session.session, session.machine, events, conversation.deliveries, conversation.outbox, conversation.rpcs, loaded, state.more, heldCount, oldest, owner],
  );
  const requests = useMemo(
    () =>
      Object.values(conversation.requests)
        .filter((r) => r.pending && r.machine === session.machine && r.raised.session === session.session)
        .sort((a, b) => a.at - b.at),
    [conversation.requests, session.machine, session.session],
  );
  const ended = session.group === 'ended';
  const items = useMemo<TailItem[]>(
    () => [...sends.map((send) => ({ kind: 'send' as const, send })), ...requests.map((r) => ({ kind: 'request' as const, key: r.key, request: r.request })), ...(ended ? [{ kind: 'end' as const }] : [])],
    [sends, requests, ended],
  );
  const drawn = useMemo(() => tailRows(items), [items]);
  const tail = {
    items: drawn.byId,
    session,
    landed: landedRequest,
    foot: { running: session.presence?.record != null, ended, resumable: retiredBy(session) === null },
  };

  // The ask mod's async questions the log knows, each waiting on its card below while its request is pending.
  const overlays = useMemo(() => {
    const facts = new Map<string, QuestionOverlayFact>();
    const calls = new Set(requests.map((r) => r.raised.toolUseId ?? r.request));
    for (const [src, asked] of askedQuestions(session.session, events, owner.main.heldRows()))
      facts.set(src, { ...asked, waiting: asked.answeredText !== null ? null : calls.has(src) ? 'below' : 'open' });
    return facts;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the held rows are read through their count and oldest row
  }, [session.session, events, requests, heldCount, oldest, owner]);

  const unavailable = useNoTranscript(state, heldCount);
  useLandOnCard(root, landedRequest, requests.some((r) => r.request === landedRequest));
  const landing = useLandOnMessage(root, owner.main, state, landedMessage);

  if (unavailable && fallback)
    return fallback(`${session.machine} serves no transcript for this session: its daemon predates the session view, or a /clear left the history under another id. What it sent and was sent stays here, from the project's log.`);
  return (
    <section
      ref={setRoot}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="session-view"
      data-session-view=""
      data-at-rest={atRest(session) ? '' : undefined}
      data-session={session.session}
      aria-label={`${sessionName(session)}'s session`}
    >
      {landing !== null && (
        // The landed message's row is being paged toward, or the history ran out without it.
        <div className="flex items-center gap-2 border-b border-border bg-bg-raised px-4 py-1.5 text-ui-sm" role="status" data-testid="landing" data-landing={landing === 'finding' ? 'checking' : 'missing'}>
          <span className="text-fg-muted">{landing === 'finding' ? 'Finding the message in the session’s history…' : 'This message’s row is not in the session’s transcript.'}</span>
          {landing === 'missing' && (
            <button type="button" className="ml-auto rounded-sm px-1 text-fg-muted hover:bg-bg-hover hover:text-fg" onClick={() => useLanding.getState().clear()}>
              Dismiss
            </button>
          )}
        </div>
      )}
      <ReportToggle storeKey={owner.main.key} />
      <TailProvider value={tail}>
        <TranscriptPane controller={owner.main} state={state} variant="session" ownerLane actions={actions} list={list} extraTail={drawn.rows} renderRequest={renderTailRow} />
      </TailProvider>
      <QuestionOverlays root={root} facts={overlays} />
      <WaitingPill list={list} count={requests.length} />
    </section>
  );
}

/**
 * Whether the session's machine serves no transcript for it: its subscription ended at n 0 (`session-ended` before any
 * snapshot, DX4's one remaining meaning of it), held until a snapshot comes, so a retry under way does not flicker back.
 */
function useNoTranscript(state: { phase: string; ended: { reason: string } | null }, held: number): boolean {
  const [none, setNone] = useState(false);
  if (!none && state.phase === 'ended' && state.ended?.reason === 'session-ended' && held === 0) setNone(true);
  if (none && state.phase === 'live') setNone(false);
  return none;
}

/** A notification that landed on one of the tail's cards: the card is scrolled into view once it is drawn. */
function useLandOnCard(root: HTMLElement | null, request: string | null, present: boolean) {
  useEffect(() => {
    if (!root || request === null || !present) return;
    const frame = requestAnimationFrame(() => root.querySelector(`[data-tail-request="${CSS.escape(request)}"]`)?.scrollIntoView({ block: 'center' }));
    return () => cancelAnimationFrame(frame);
  }, [root, request, present]);
}

/**
 * "N waiting ↓" (the owner's 2B): while requests wait at the tail and none of their cards is in the reader's view, a
 * pill that takes the reader down to the first of them.
 */
function WaitingPill({ list, count }: { list: RefObject<TranscriptListHandle | null>; count: number }) {
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const scroller = list.current?.scrollElement;
    if (!scroller || count === 0) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const box = scroller.getBoundingClientRect();
      const seen = [...scroller.querySelectorAll('[data-tail-request]')].some((card) => {
        const rect = card.getBoundingClientRect();
        return rect.bottom > box.top && rect.top < box.bottom;
      });
      setInView(seen);
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(check);
    };
    check();
    scroller.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [list, count]);
  if (count === 0 || inView) return null;
  const jump = () => {
    list.current?.scrollToEnd();
    requestAnimationFrame(() => list.current?.scrollElement?.querySelector('[data-tail-request]')?.scrollIntoView({ block: 'start' }));
  };
  return (
    <button type="button" className="desk-waiting-pill" onClick={jump} data-testid="waiting-pill">
      {count} waiting <span aria-hidden="true">↓</span>
    </button>
  );
}

/** The session view's status word, in the center's header: its transcript loading, reconnecting, paging, unavailable. */
export function SessionStatus({ project, session, plane }: Pick<Props, 'project' | 'session' | 'plane'>) {
  const owner = useSessionOwner(project, session, plane);
  const status = transcriptStatus(useKeptTranscript(owner.keeper));
  return (
    <span className="shrink-0 text-ui-sm text-fg-muted" data-testid="session-status">
      {status}
    </span>
  );
}
