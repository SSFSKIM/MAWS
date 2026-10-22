// The session view (DC9; the composite's §9.1): a direct channel's center wherever its session's machine is online,
// on a phone as on a desktop (the owner, 2026-10-18) — MAWS's `Transcript` over the session's main transcript with its
// owner lane on, so MAWS's report by default (the `<message>` spans and questions, one working record per marked turn,
// an unmarked turn whole) and the full transcript a toggle away. The transcript is the session's shared owner's
// (`depth/owner/session-owner.ts`), which the depth column holds too: one subscription feeds both. Its streaming text
// joins the turn it answers, older rows page in at the top until the first, and an ended session stays pageable while
// the view is open, its liveness read from its presence. On a desktop an `Agent` row opens its agent in the column; on
// a phone, which has no column, it is a plain row. Loaded as a chunk of its own, the first time a session channel
// opens, so the grid and the group chat load none of MAWS's transcript.
//
// What only the log and the hub know joins the transcript (M4; `tail/`): at its tail, the sends not yet in it, each with
// its delivery state in its bubble's foot; then the session's pending requests as the channel's cards, answered in
// place, with an "N waiting ↓" pill while none of them is in view; then an ended or retired session's end marker. The ask
// mod's async question rows carry the log's question and answer, or say the question was withdrawn unanswered. A
// session whose machine serves no transcript for it (its subscription ended at n 0, `shell/transcript-served.ts`)
// draws the channel built from the log instead, saying why, and that an ended one is not offered Resume (`fallback`).
// A tapped notification lands on its request's card at the tail, brought into the virtualized list wherever the reader
// was, or on its message's row in the transcript (a `<message>`'s, or a message tool's call drawn as the message), or,
// for an async question with no request waiting (MAWS's own ask), on its call's row. A send's row draws without its delivery frame line, a peer's send labelled with who sent it
// (`conversation/delivery-frame.ts`).
//
// A decoration of MAWS's view is the desk's own (`styles/app.css`, under `data-session-view`): a gutter that keeps every
// row, breakouts included, clear of MAWS's floating "Jump to latest". MAWS reads a turn as working until a row ends it,
// and DX4's rows carry no SDK result, so a turn whose rows never ended it (a process killed mid-turn, an interrupt with
// no marker the desk reads) stays open in the store. The store keeps it so; the drawing follows the session's presence:
// while its machine reports it idle or with no process, MAWS draws that turn as its own app does once its disk follower
// ends a transcript nobody is writing (`atRest`, `restingRows`): its divider in a finished turn's words ("Worked for …",
// "Continued for …") up to its last row, no running mark on its working record, the control's arrow. Busy or waiting,
// or with presence unknown, it draws working.
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
import { useAccess } from '../../hub/access';
import { TranscriptPane, transcriptStatus, useKeptTranscript, type RowIndex } from '../../depth/view/TranscriptPane';
import { sessionName } from '../../log/projection';
import { useLanding } from '../../pwa/service-worker';
import { useDeskLayout } from '../../shell/layout';
import type { SessionPlane } from '../../shell/session-plane';
import type { DeskSession } from '../../shell/sessions';
import { useTranscriptServed } from '../../shell/transcript-served';
import { useNarrow } from '../../shell/viewport';
import { useDesk } from '../conversation/desk-context';
import { useLandOnCard } from './land-on-card';
import { useLandOnMessage } from './landed-message';
import { ReportToggle } from './ReportToggle';
import { questionOverlayFacts, QuestionOverlays } from './tail/QuestionOverlay';
import { renderTailRow, requestRowId, TailProvider, tailRows, type TailItem } from './tail/session-tail';

type Props = {
  project: string;
  session: DeskSession;
  plane: SessionPlane;
  /** The project's log, verified: the sends to the session and its async questions are read from it. */
  events?: ReadonlyArray<{ offset: number; event: LogEvent }>;
  /** The request a tapped notification landed on, when this channel is the one it opened. */
  landedRequest?: string | null;
  /** The `src` of the message a tapped notification landed on (a `<message>`'s `<row uuid>#<span>`, a message tool's call
   * id), when this channel is the one it opened. */
  landedMessage?: string | null;
  /** The call's id of the async question a tapped notification landed on, when no request of it waits at the tail. */
  landedQuestion?: string | null;
  /** What the view draws when the session's machine serves no transcript for it: the log-built channel, with why. */
  fallback?: (why: string) => ReactNode;
};

const NO_EVENTS: ReadonlyArray<{ offset: number; event: LogEvent }> = [];

/** The session is at rest as its machine reports it: idle, or no process. Not while its presence is unknown. */
const atRest = (session: DeskSession) => session.machineOnline !== false && session.presence != null && (session.presence.record === null || session.presence.record.status === 'idle');

export default function SessionView({ project, session, plane, events = NO_EVENTS, landedRequest = null, landedMessage = null, landedQuestion = null, fallback }: Props) {
  const owner = useSessionOwner(project, session, plane);
  const state = useKeptTranscript(owner.keeper);
  const list = useRef<TranscriptListHandle>(null);
  const rowIndex = useRef<RowIndex>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const { connection } = useDesk();
  const conversation = useStore(connection.conversation.store);
  const phone = useNarrow();
  const actions = useMemo<Partial<TranscriptActions>>(
    () =>
      // A phone has no column (depth stays desktop-only), so MAWS draws an Agent row as a plain row there.
      phone
        ? DESK_ACTIONS
        : {
            ...DESK_ACTIONS,
            // The column takes the request and opens its Subagents tab on the agent; a closed column opens for it.
            openSubagent: (ref: SubagentRef) => {
              owner.openSubagent(ref);
              if (!useDeskLayout.getState().depth.open) useDeskLayout.getState().setDepth({ open: true });
            },
          },
    [owner, phone],
  );

  // The rows held, as the subscription keeps them: a new array whenever the held set changes (a row, a page, a fresh
  // snapshot merged in).
  const held = state.held;
  const loaded = state.phase === 'live' || held.length > 0;
  const sends = useMemo(
    () =>
      tailSends({
        session: session.session,
        machine: session.machine,
        entries: events,
        deliveries: conversation.deliveries,
        outbox: Object.values(conversation.outbox),
        rpcs: Object.values(conversation.rpcs),
        transcript: loaded ? { rows: held, complete: !state.more } : null,
      }),
    [session.session, session.machine, events, conversation.deliveries, conversation.outbox, conversation.rpcs, loaded, state.more, held],
  );
  // The session's requests as the conversation keeps them, settled ones included; those pending are the tail's cards.
  const known = useMemo(() => Object.values(conversation.requests).filter((r) => r.machine === session.machine && r.raised.session === session.session), [conversation.requests, session.machine, session.session]);
  const requests = useMemo(() => known.filter((r) => r.pending).sort((a, b) => a.at - b.at), [known]);
  const ended = session.group === 'ended';
  const resting = atRest(session);
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

  // The ask mod's async questions the log or the transcript knows, each waiting on its card below while its request is
  // pending, or withdrawn once its request was settled so.
  const overlays = useMemo(() => questionOverlayFacts(askedQuestions(session.session, events, held), known), [session.session, events, known, held]);

  // The machine serves no transcript for it, as the session's owner learned from its subscription.
  const unavailable = useTranscriptServed(session) === 'none';
  const landedCard = requests.find((r) => r.request === landedRequest) ?? null;
  useLandOnCard(root, list, rowIndex, landedCard && { request: landedCard.request, row: requestRowId(landedCard.key) });
  const landedOn = landedMessage === null && landedQuestion !== null ? 'question' : 'message';
  const landing = useLandOnMessage(root, owner.main, state, landedMessage ?? landedQuestion, landedOn);

  if (unavailable && fallback)
    return fallback(
      `${session.machine} serves no transcript for this session: it never wrote one there, its daemon predates the session view, or a /clear left the history under another id. ${ended && retiredBy(session) === null ? 'Resume is not offered: it needs that transcript. ' : ''}What it sent and was sent stays here, from the project's log.`,
    );
  return (
    <section
      ref={setRoot}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      data-testid="session-view"
      data-session-view=""
      data-at-rest={resting ? '' : undefined}
      data-session={session.session}
      aria-label={`${sessionName(session)}'s session`}
    >
      {landing !== null && (
        // The landed message's (or question's) row is being paged toward, or the history ran out without it.
        <div className="flex items-center gap-2 border-b border-border bg-bg-raised px-4 py-1.5 text-ui-sm" role="status" data-testid="landing" data-landing={landing === 'finding' ? 'checking' : 'missing'}>
          <span className="text-fg-muted">{landing === 'finding' ? `Finding the ${landedOn} in the session’s history…` : `This ${landedOn}’s row is not in the session’s transcript.`}</span>
          {landing === 'missing' && (
            <button type="button" className="ml-auto rounded-sm px-1 text-fg-muted hover:bg-bg-hover hover:text-fg" onClick={() => useLanding.getState().clear()}>
              Dismiss
            </button>
          )}
        </div>
      )}
      <ReportToggle storeKey={owner.main.key} />
      <TailProvider value={tail}>
        <TranscriptPane controller={owner.main} state={state} variant="session" ownerLane actions={actions} list={list} extraTail={drawn.rows} renderRequest={renderTailRow} rowIndex={rowIndex} atRest={resting} />
      </TailProvider>
      <QuestionOverlays root={root} facts={overlays} />
      <WaitingPill list={list} count={requests.length} />
    </section>
  );
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
  const state = useKeptTranscript(owner.keeper);
  const signedOut = useAccess((s) => s.lapsed !== null);
  const status = signedOut && state.phase === 'reconnecting' ? 'Signed out' : transcriptStatus(state);
  return (
    <span className="shrink-0 text-ui-sm text-fg-muted" data-testid="session-status">
      {status}
    </span>
  );
}
