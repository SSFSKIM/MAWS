// The center column: the selected channel, drawn only from verified log events and verified requests (§4). The group
// chat and a direct channel are one stream (`buildStream`); a direct channel's header names the session as its sidebar
// row does (`SessionLabel`: the title, its machine, the alias under it) and carries the session's actions —
// Retire while it is a member, Resume once it ended (never once retired: it says who retired it) — each drawn
// disabled with §5's reason when the session cannot,
// and says when the machine is offline: the conversation stays, presence and depth are unavailable. A direct channel's
// actions and composer are keyed by their session, so a draft, an RPC's status, or a Retire confirmation never follows
// the owner into another session's channel.
//
// A channel a tapped notification opened lands on its card (`useLanding`): the card is marked once it is drawn, and
// until then, or when it will not be, the channel says why. In the session view a request's card is at the tail, a
// message's is its transcript row (`landed-message.ts`; a `<message>`'s, or a message tool's call), and an async question's is its request's card while a
// bridge's request for it waits, else its call's row. On a phone (mockups/desk/05-phone.html, 5A) Retire sits
// behind ⋯ with the note that depth opens on a computer, and an ended session shows Resume in place of the composer.
//
// Wherever a session's machine is online, a direct channel's center is its session view (DC9, `SessionView.tsx`):
// MAWS's report over the session's own transcript, the status word of that transcript in the header; the composer
// stays below it. On the phone too (the owner, 2026-10-18, reversing §4's "the phone never mounts the transcript": the
// working record was the one thing that still sent them to a terminal), its chunk loaded only when a session channel
// first opens, so the grid and the group chat stay as light as they were. The channel built from the log stays where
// the session view cannot draw: for a machine that is offline, and for a session its machine serves no transcript for
// (the view says why); its working record is then a label saying where the record is.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { LogEvent } from 'desk-hub/protocol';
import { buildStream, byWhom, placedRequest, type PlacedRequest } from '../../conversation/stream';
import { kindOf, retiredBy } from '../../conversation/capabilities';
import { eventLanding, landedItem, landingReady, landingStatus, type EventLanding } from '../../conversation/landing';
import { refused } from '../../log/project-log';
import { sessionName } from '../../log/projection';
import { useLanding, type Landed } from '../../pwa/service-worker';
import { useNarrow } from '../../shell/viewport';
import type { Channel } from '../../shell/layout';
import type { DeskSession } from '../../shell/sessions';
import { useProjectName } from '../../state/grid';
import { GroupComposer, SessionComposer } from '../composer/Composer';
import { useCapabilities, useDesk } from '../conversation/desk-context';
import { RpcStatus } from '../conversation/RpcStatus';
import { StreamView } from '../conversation/StreamView';
import { SessionLabel } from '../../shell/SessionLabel';
import { moduleLoader, useLoadedModule } from './module-loader';

// The session view and its status word: one chunk, loaded the first time a session view is drawn, both drawn from that
// one load (`module-loader.ts`).
const sessionViews = moduleLoader(() => import('./SessionView'));

/** Whether a direct channel's center is its session view: while the session's machine is online, phone or desktop. */
const drawsSessionView = (session: DeskSession | null): session is DeskSession => session !== null && session.machineOnline !== false;

export function ChannelView(props: {
  name: string;
  channel: Channel;
  session: DeskSession | null;
  events: Array<{ offset: number; event: LogEvent }>;
}) {
  const { name, channel, session, events } = props;
  const phone = useNarrow();
  const { connection, sessions, member } = useDesk();
  const requests = useStore(connection.conversation.store, (s) => s.requests);
  const outboxAll = useStore(connection.conversation.store, (s) => s.outbox);
  const projectName = useProjectName();
  const items = useMemo(() => {
    const aliases = new Map([...sessions.values()].map((s) => [s.session, s.alias]));
    const placed: PlacedRequest[] = Object.values(requests).map(placedRequest);
    const live = session !== null && ['bridged', 'seat', 'terminal'].includes(kindOf(session));
    return buildStream(channel, events, aliases, placed, { live, member, projectName });
  }, [channel, events, sessions, requests, session, member, projectName]);
  const outbox = Object.values(outboxAll).filter((o) => channel.kind === 'group' || (o.to !== '*' && o.to.some((r) => r.session === channel.session)));
  const sessionView = channel.kind === 'session' && drawsSessionView(session) ? session : null;
  const landed = useLanded(channel, items, sessionView);
  const landedEvent = useLandedEvent(channel, events, sessionView);
  const landedRequest = useLanding((s) => (s.landed?.landing.kind === 'request' && s.landed.project === connection.project && channel.kind === 'session' && s.landed.session === channel.session ? s.landed.landing.request : null)) ?? landedEvent.request;
  // Keyed by channel, so each opens at its own tail (the composer beside it is keyed by the session alone).
  const stream = (workLabel: string) => (
    <StreamView key={channel.kind === 'group' ? 'stream:group' : `stream:${channel.session}`} items={items} outbox={outbox} landed={landed.item} workLabel={workLabel} />
  );
  const { module: views, failed: viewFailed, retry: retryView } = useLoadedModule(sessionViews, sessionView !== null);
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg" aria-label="Channel">
      <header className={['flex shrink-0 items-center gap-2 border-b border-border', phone ? 'min-h-[44px] flex-wrap px-3 py-1.5' : 'h-[44px] px-4'].join(' ')} data-testid="channel-header">
        {channel.kind === 'group' ? (
          <span className="text-ui font-semibold">
            <span className="text-fg-muted">#</span> {name}
          </span>
        ) : (
          <>
            {/* The actions take their width first; the name and the charge truncate in what is left (a phone wraps the
                charge under the name), clipped when a confirmation leaves them nothing. */}
            <span className={['flex min-w-0 flex-1 items-center gap-2 overflow-hidden', phone ? 'flex-wrap' : ''].join(' ')} data-testid="channel-name">
              {session ? (
                <SessionLabel session={session} name="text-ui font-semibold" muted="text-ui-sm text-fg-muted" />
              ) : (
                <span className="text-ui font-semibold">{channel.session.slice(0, 8)}</span>
              )}
              {session?.charge && <span className="min-w-0 truncate text-ui-sm text-fg-muted">· {session.charge}</span>}
            </span>
            {session && (
              <SessionActions
                key={session.session}
                session={session}
                phone={phone}
                status={sessionView && views && <views.SessionStatus project={connection.project} session={sessionView} plane={connection.client} />}
              />
            )}
          </>
        )}
      </header>
      {session?.machineOnline === false && (
        <div className="border-b border-border bg-bg-raised px-4 py-1.5 text-ui-sm text-warning" role="status" data-testid="machine-offline">
          {session.machine} is offline: {sessionName(session)}'s presence and depth are unavailable until it reconnects; everything it sent stays here.
        </div>
      )}
      {session?.machineOnline !== false && session?.machineReadOnly && (
        <div className="border-b border-border bg-bg-raised px-4 py-1.5 text-ui-sm text-warning" role="status" data-testid="machine-read-only">
          {session.machine} is read-only: it runs nothing sent from outside it, so what you send {sessionName(session)} is recorded and not delivered, and only its terminal can answer or steer it.
        </div>
      )}
      {landed.notice && (
        <div className="flex items-center gap-2 border-b border-border bg-bg-raised px-4 py-1.5 text-ui-sm" role="status" data-testid="landing" data-landing={landed.notice.kind}>
          <span className={landed.notice.kind === 'unverified' ? 'text-danger' : 'text-fg-muted'}>{landed.notice.text}</span>
          {landed.notice.kind !== 'checking' && (
            <button type="button" className="ml-auto rounded-sm px-1 text-fg-muted hover:bg-bg-hover hover:text-fg" onClick={() => useLanding.getState().clear()}>
              Dismiss
            </button>
          )}
        </div>
      )}
      {sessionView ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {views && (
            <views.default
              key={sessionView.session}
              project={connection.project}
              session={sessionView}
              plane={connection.client}
              events={events}
              landedRequest={landedRequest}
              landedMessage={landedEvent.message}
              landedQuestion={landedEvent.question}
              fallback={(why) => (
                <>
                  <div className="border-b border-border bg-bg-raised px-4 py-1.5 text-ui-sm text-fg-muted" role="status" data-testid="no-transcript">
                    {why}
                  </div>
                  {stream(`no transcript on ${sessionView.machine}`)}
                </>
              )}
            />
          )}
          {viewFailed !== null && (
            <div className="m-4 flex items-center gap-2 text-ui-sm text-danger" role="alert" data-testid="session-view-failed">
              <span className="min-w-0">The session view could not be loaded ({viewFailed}).</span>
              <button type="button" className="shrink-0 rounded-sm border border-border-strong px-2 py-0.5 text-fg hover:bg-bg-hover" onClick={retryView}>
                Retry
              </button>
              {/* A browser may keep a module it failed to fetch (Chrome's module map does) and refuse it again without a
                  fetch: a reload fetches it anew, and the desk comes back where it was (the URL, the browser's log). */}
              <button type="button" className="shrink-0 rounded-sm border border-border-strong px-2 py-0.5 text-fg hover:bg-bg-hover" onClick={() => location.reload()}>
                Reload the page
              </button>
            </div>
          )}
        </div>
      ) : (
        stream(session ? `${session.machine} is offline` : 'on a computer')
      )}
      {channel.kind === 'group' ? (
        <GroupComposer name={name} />
      ) : (
        session && (phone && session.group === 'ended' ? <ResumeBar key={session.session} session={session} /> : <SessionComposer key={session.session} session={session} />)
      )}
    </section>
  );
}

/**
 * The card a tapped notification named, if this channel is the one it opened: its item, or why it is not drawn. In the
 * session view (`sessionView`) a request's card is drawn only while the request is pending, at the transcript's tail,
 * so a settled one, which the log-built stream also draws, is not there to be found and the notice says why.
 */
function useLanded(channel: Channel, items: ReturnType<typeof buildStream>, sessionView: DeskSession | null) {
  const { connection } = useDesk();
  const landed = useLanding((s) => s.landed);
  const here = landed !== null && landed.project === connection.project && channel.kind === 'session' && channel.session === landed.session;
  // Leaving the channel a notification opened ends the landing; coming back is an ordinary visit.
  useEffect(() => {
    if (landed && !here) useLanding.getState().clear();
  }, [landed, here]);
  const caughtUp = useStore(connection.live, (s) => s.caughtUp);
  const checked = useStore(connection.conversation.store, (s) => s.checked);
  const unverified = useStore(connection.conversation.store, (s) => s.unverified);
  const requests = useStore(connection.conversation.store, (s) => s.requests);
  const failed = useStore(connection.log.store, (s) => s);
  if (!landed || !here) return { item: null, notice: null };
  const item = landedItem(landed.landing, items);
  const { landing } = landed;
  const found =
    sessionView !== null && landing.kind === 'request'
      ? Object.values(requests).some((r) => r.pending && r.machine === sessionView.machine && r.raised.session === sessionView.session && r.request === landing.request)
      : item !== null;
  const bad =
    landing.kind === 'request'
      ? unverified.some((u) => u.what === 'request' && u.id === landing.request && u.session === landed.session)
      : refused(failed).some((e) => e.event?.writer === landing.writer && e.event?.seq === landing.seq);
  const status = landingStatus({ landing, found, ready: landingReady(caughtUp, { checked }, failed), unverified: bad });
  return { item, notice: status.kind === 'shown' ? null : status };
}

/**
 * Where the session view (`sessionView`, null when the channel draws none) lands the log event a tapped notification
 * named, when this channel is the one it opened (`eventLanding`): a message's transcript row; an async question's
 * request card while a bridge's request for it waits, else its call's row. A landing that reached the card stays on
 * it: the question answered there settles the request, which must not then send the reader up to the call.
 */
function useLandedEvent(channel: Channel, events: Array<{ offset: number; event: LogEvent }>, sessionView: DeskSession | null): EventLanding {
  const { connection } = useDesk();
  const landed = useLanding((s) => (s.landed?.landing.kind === 'event' && s.landed.project === connection.project && channel.kind === 'session' && s.landed.session === channel.session ? s.landed : null));
  const requests = useStore(connection.conversation.store, (s) => s.requests);
  const checked = useStore(connection.conversation.store, (s) => s.checked);
  const found = useMemo(() => {
    const landing = landed?.landing;
    if (landing?.kind !== 'event' || sessionView === null) return eventLanding(undefined, [], checked);
    const event = events.find((e) => e.event.writer === landing.writer && e.event.seq === landing.seq)?.event;
    const pending = Object.values(requests).filter((r) => r.pending && r.machine === sessionView.machine && r.raised.session === sessionView.session);
    return eventLanding(event, pending, checked);
  }, [landed, events, requests, checked, sessionView]);
  const [card, setCard] = useState<{ landed: Landed; request: string } | null>(null);
  if (landed !== null && found.request !== null && (card?.landed !== landed || card.request !== found.request)) setCard({ landed, request: found.request });
  return card !== null && card.landed === landed && found.request === null ? { request: card.request, message: null, question: null } : found;
}

/** "Retired by <who>", from the log's `retired`. */
const retiredText = (by: string, member: string) => (by ? `Retired by ${byWhom(by, member)}` : 'Retired');

/** The phone's composer for an ended session: Resume, at thumb height (a send to it would only be recorded); for a
 * retired one, who retired it. */
function ResumeBar({ session }: { session: DeskSession }) {
  const { connection, member } = useDesk();
  const [rpc, setRpc] = useState<string | null>(null);
  const can = useCapabilities(session).resume;
  const retired = retiredBy(session);
  if (retired !== null)
    return (
      <p className="m-0 shrink-0 border-t border-border px-4 py-3 text-ui-sm text-fg-muted" data-testid="retired-by">
        {retiredText(retired, member)}
      </p>
    );
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-border px-4 py-3" data-testid="resume-bar">
      <button
        type="button"
        className="h-11 rounded-md border border-fg bg-fg text-ui font-medium text-bg disabled:cursor-not-allowed disabled:border-fg-faint disabled:bg-fg-faint"
        disabled={!can.can}
        title={can.reason ?? undefined}
        onClick={async () => setRpc(await connection.rpc(member, session.machine, 'resume', { session: session.session }))}
      >
        Resume {sessionName(session)}
      </button>
      {can.reason && <p className="m-0 text-ui-sm text-fg-faint">{can.reason}</p>}
      <RpcStatus nonce={rpc} />
    </div>
  );
}

/** The session's actions, after `status`: the session view's word for its transcript (loading, unavailable, …). */
function SessionActions({ session, phone, status }: { session: DeskSession; phone: boolean; status?: ReactNode }) {
  const { connection, member } = useDesk();
  const [rpc, setRpc] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [opened, setOpened] = useState(false);
  const can = useCapabilities(session);
  const ended = session.group === 'ended';
  const retired = retiredBy(session);
  // On a phone the status word stays in view beside ⋯; Resume (or who retired it) replaces an ended session's composer.
  if (phone && (ended || !opened))
    return (
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {status}
        {!ended && (
          <button type="button" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover" aria-label={`${sessionName(session)}: Retire, and what opens on a computer`} onClick={() => setOpened(true)}>
            ⋯
          </button>
        )}
      </span>
    );
  const button = 'shrink-0 rounded-sm border border-border-strong px-2 py-0.5 text-ui-sm hover:bg-bg-hover disabled:cursor-not-allowed disabled:text-fg-faint disabled:hover:bg-transparent';
  return (
    // The header's own width bounds it: a confirmation's words truncate rather than run under the depth column.
    <span className={['ml-auto flex min-w-0 items-center gap-2', phone ? 'w-full flex-wrap' : ''].join(' ')}>
      {status}
      {phone && <span className="w-full text-ui-sm text-fg-muted">{sessionName(session)}'s subagents, jobs and diff open on a computer.</span>}
      <RpcStatus nonce={rpc} />
      {retired !== null ? (
        // Retired is the owner's taking it out of the project: its machine refuses Resume, so none is offered.
        <span className="shrink-0 text-ui-sm text-fg-muted" data-testid="retired-by">
          {retiredText(retired, member)}
        </span>
      ) : ended ? (
        <button type="button" className={button} disabled={!can.resume.can} title={can.resume.reason ?? undefined} onClick={async () => setRpc(await connection.rpc(member, session.machine, 'resume', { session: session.session }))}>
          Resume
        </button>
      ) : confirming ? (
        <>
          <span className="min-w-0 truncate text-ui-sm text-fg-muted" title={can.retire.note ? `This ${can.retire.note}.` : 'Its job stops.'}>
            {can.retire.note ? `Retire ${sessionName(session)}? This ${can.retire.note}.` : `Retire ${sessionName(session)}? Its job stops.`}
          </span>
          <button
            type="button"
            className={`${button} text-danger`}
            onClick={async () => {
              setConfirming(false);
              setRpc(await connection.rpc(member, session.machine, 'retire', { session: session.session }));
            }}
          >
            Retire
          </button>
          <button type="button" className={button} onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className={button} disabled={!can.retire.can} title={can.retire.reason ?? undefined} onClick={() => setConfirming(true)}>
          Retire…
        </button>
      )}
      {phone && !confirming && (
        <button type="button" className={button} onClick={() => setOpened(false)}>
          Close
        </button>
      )}
    </span>
  );
}
