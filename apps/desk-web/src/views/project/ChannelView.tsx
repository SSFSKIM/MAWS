// The center column: the selected channel, drawn only from verified log events and verified requests (§4). The group
// chat and a direct channel are one stream (`buildStream`); a direct channel's header carries the session's actions —
// Retire while it is a member, Resume once it ended (never once retired: it says who retired it) — each drawn
// disabled with §5's reason when the session cannot,
// and says when the machine is offline: the conversation stays, presence and depth are unavailable. A direct channel's
// actions and composer are keyed by their session, so a draft, an RPC's status, or a Retire confirmation never follows
// the owner into another session's channel.
//
// A channel a tapped notification opened lands on its card (`useLanding`): the card is marked once it is drawn, and
// until then, or when it will not be, the channel says why. On a phone (mockups/desk/05-phone.html, 5A) Retire sits
// behind ⋯ with the note that depth opens on a computer, and an ended session shows Resume in place of the composer.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { LogEvent } from 'desk-hub/protocol';
import { buildStream, byWhom, placedRequest, type PlacedRequest } from '../../conversation/stream';
import { capabilities, kindOf, retiredBy } from '../../conversation/capabilities';
import { landedItem, landingReady, landingStatus } from '../../conversation/landing';
import { refused } from '../../log/project-log';
import { useLanding } from '../../pwa/service-worker';
import { useNarrow } from '../../shell/viewport';
import type { Channel } from '../../shell/layout';
import type { DeskSession } from '../../shell/sessions';
import { GroupComposer, SessionComposer } from '../composer/Composer';
import { useDesk } from '../conversation/desk-context';
import { RpcStatus } from '../conversation/RpcStatus';
import { StreamView } from '../conversation/StreamView';

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
  const items = useMemo(() => {
    const aliases = new Map([...sessions.values()].map((s) => [s.session, s.alias]));
    const placed: PlacedRequest[] = Object.values(requests).map(placedRequest);
    const live = session !== null && ['bridged', 'seat', 'terminal'].includes(kindOf(session));
    return buildStream(channel, events, aliases, placed, { live, member });
  }, [channel, events, sessions, requests, session, member]);
  const outbox = Object.values(outboxAll).filter((o) => channel.kind === 'group' || (o.to !== '*' && o.to.some((r) => r.session === channel.session)));
  const landed = useLanded(channel, items);
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg" aria-label="Channel">
      <header className={['flex shrink-0 items-center gap-2 border-b border-border', phone ? 'min-h-[44px] flex-wrap px-3 py-1.5' : 'h-[44px] px-4'].join(' ')} data-testid="channel-header">
        {channel.kind === 'group' ? (
          <span className="text-ui font-semibold">
            <span className="text-fg-muted">#</span> {name}
          </span>
        ) : (
          <>
            <span className="text-ui font-semibold">{session?.alias ?? channel.session.slice(0, 8)}</span>
            {session && <span className="text-ui-sm text-fg-muted">@{session.machine}</span>}
            {session?.charge && <span className="min-w-0 truncate text-ui-sm text-fg-muted">· {session.charge}</span>}
            {session && <SessionActions key={session.session} session={session} phone={phone} />}
          </>
        )}
      </header>
      {session?.machineOnline === false && (
        <div className="border-b border-border bg-bg-raised px-4 py-1.5 text-ui-sm text-warning" role="status" data-testid="machine-offline">
          {session.machine} is offline: {session.alias}'s presence and depth are unavailable until it reconnects; everything it sent stays here.
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
      <StreamView items={items} outbox={outbox} landed={landed.item} />
      {channel.kind === 'group' ? (
        <GroupComposer name={name} />
      ) : (
        session && (phone && session.group === 'ended' ? <ResumeBar key={session.session} session={session} /> : <SessionComposer key={session.session} session={session} />)
      )}
    </section>
  );
}

/** The card a tapped notification named, if this channel is the one it opened: its item, or why it is not drawn. */
function useLanded(channel: Channel, items: ReturnType<typeof buildStream>) {
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
  const failed = useStore(connection.log.store, (s) => s);
  if (!landed || !here) return { item: null, notice: null };
  const item = landedItem(landed.landing, items);
  const { landing } = landed;
  const bad =
    landing.kind === 'request'
      ? unverified.some((u) => u.what === 'request' && u.id === landing.request && u.session === landed.session)
      : refused(failed).some((e) => e.event?.writer === landing.writer && e.event?.seq === landing.seq);
  const status = landingStatus({ landing, found: item !== null, ready: landingReady(caughtUp, { checked }, failed), unverified: bad });
  return { item, notice: status.kind === 'shown' ? null : status };
}

/** "Retired by <who>", from the log's `retired`. */
const retiredText = (by: string, member: string) => (by ? `Retired by ${byWhom(by, member)}` : 'Retired');

/** The phone's composer for an ended session: Resume, at thumb height (a send to it would only be recorded); for a
 * retired one, who retired it. */
function ResumeBar({ session }: { session: DeskSession }) {
  const { connection, member } = useDesk();
  const [rpc, setRpc] = useState<string | null>(null);
  const can = capabilities(session).resume;
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
        Resume {session.alias}
      </button>
      {can.reason && <p className="m-0 text-ui-sm text-fg-faint">{can.reason}</p>}
      <RpcStatus nonce={rpc} />
    </div>
  );
}

function SessionActions({ session, phone }: { session: DeskSession; phone: boolean }) {
  const { connection, member } = useDesk();
  const [rpc, setRpc] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [opened, setOpened] = useState(false);
  const can = capabilities(session);
  const ended = session.group === 'ended';
  const retired = retiredBy(session);
  if (phone && ended) return null; // Resume (or who retired it) replaces the composer
  if (phone && !opened)
    return (
      <button type="button" className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-bg-hover" aria-label={`${session.alias}: Retire, and what opens on a computer`} onClick={() => setOpened(true)}>
        ⋯
      </button>
    );
  const button = 'shrink-0 rounded-sm border border-border-strong px-2 py-0.5 text-ui-sm hover:bg-bg-hover disabled:cursor-not-allowed disabled:text-fg-faint disabled:hover:bg-transparent';
  return (
    // The header's own width bounds it: a confirmation's words truncate rather than run under the depth column.
    <span className={['ml-auto flex min-w-0 items-center gap-2', phone ? 'w-full flex-wrap' : ''].join(' ')}>
      {phone && <span className="w-full text-ui-sm text-fg-muted">{session.alias}'s transcript, subagents and diff open on a computer.</span>}
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
            {can.retire.note ? `Retire ${session.alias}? This ${can.retire.note}.` : `Retire ${session.alias}? Its job stops.`}
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
