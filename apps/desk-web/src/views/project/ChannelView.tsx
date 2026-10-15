// The center column: the selected channel, drawn only from verified log events and verified requests (§4). The group
// chat and a direct channel are one stream (`buildStream`); a direct channel's header carries the session's actions —
// Retire while it is a member, Resume once it ended — each drawn disabled with §5's reason when the session cannot,
// and says when the machine is offline: the conversation stays, presence and depth are unavailable. A direct channel's
// actions and composer are keyed by their session, so a draft, an RPC's status, or a Retire confirmation never follows
// the owner into another session's channel.
//
// A channel a tapped notification opened lands on its card (`useLanding`): the card is marked once it is drawn, and
// until then, or when it will not be, the channel says why. On a phone the header carries the way to the channel list.
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { LogEvent } from 'desk-hub/protocol';
import { buildStream, type PlacedRequest } from '../../conversation/stream';
import { capabilities, kindOf } from '../../conversation/capabilities';
import { isQuestion } from '../../conversation/card-state';
import { landedItem, landingStatus } from '../../conversation/landing';
import { refused } from '../../log/project-log';
import { useLanding } from '../../pwa/service-worker';
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
  /** A phone's way to the channel list, with how many sessions wait on the owner. */
  onChannels?: () => void;
  waiting?: number;
}) {
  const { name, channel, session, events, onChannels, waiting = 0 } = props;
  const { connection, sessions } = useDesk();
  const requests = useStore(connection.conversation.store, (s) => s.requests);
  const outboxAll = useStore(connection.conversation.store, (s) => s.outbox);
  const items = useMemo(() => {
    const aliases = new Map([...sessions.values()].map((s) => [s.session, s.alias]));
    const placed: PlacedRequest[] = Object.values(requests).map((r) => ({ request: r.request, session: r.raised.session, at: r.at, question: isQuestion(r.raised.tool) }));
    const live = session !== null && ['bridged', 'seat', 'terminal'].includes(kindOf(session));
    return buildStream(channel, events, aliases, placed, { live });
  }, [channel, events, sessions, requests, session]);
  const outbox = Object.values(outboxAll).filter((o) => channel.kind === 'group' || (o.to !== '*' && o.to.some((r) => r.session === channel.session)));
  const landed = useLanded(channel, items);
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg" aria-label="Channel">
      <header className={['flex shrink-0 items-center gap-2 border-b border-border', onChannels ? 'min-h-[44px] flex-wrap px-3 py-1.5' : 'h-[44px] px-4'].join(' ')} data-testid="channel-header">
        {onChannels && (
          <button type="button" onClick={onChannels} className="flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-border px-2 text-ui-sm text-fg-muted hover:bg-bg-hover hover:text-fg" data-testid="channels">
            Channels
            {waiting > 0 && <span className="rounded-sm bg-bg-waiting px-1 font-semibold text-warning">{waiting}</span>}
          </button>
        )}
        {channel.kind === 'group' ? (
          <span className="text-ui font-semibold">
            <span className="text-fg-muted">#</span> {name}
          </span>
        ) : (
          <>
            <span className="text-ui font-semibold">{session?.alias ?? channel.session.slice(0, 8)}</span>
            {session && <span className="text-ui-sm text-fg-muted">@{session.machine}</span>}
            {session?.charge && <span className="min-w-0 truncate text-ui-sm text-fg-muted">· {session.charge}</span>}
            {session && <SessionActions key={session.session} session={session} />}
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
      {channel.kind === 'group' ? <GroupComposer name={name} /> : session && <SessionComposer key={session.session} session={session} />}
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
  const unverified = useStore(connection.conversation.store, (s) => s.unverified);
  const failed = useStore(connection.log.store, (s) => s);
  if (!landed || !here) return { item: null, notice: null };
  const item = landedItem(landed.landing, items);
  const { landing } = landed;
  const bad =
    landing.kind === 'request'
      ? unverified.some((u) => u.what === 'request' && u.id === landing.request)
      : refused(failed).some((e) => e.event?.writer === landing.writer && e.event?.seq === landing.seq);
  const status = landingStatus({ landing, found: item !== null, caughtUp, unverified: bad });
  return { item, notice: status.kind === 'shown' ? null : status };
}

function SessionActions({ session }: { session: DeskSession }) {
  const { connection, member } = useDesk();
  const [rpc, setRpc] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const can = capabilities(session);
  const ended = session.group === 'ended';
  const button = 'shrink-0 rounded-sm border border-border-strong px-2 py-0.5 text-ui-sm hover:bg-bg-hover disabled:cursor-not-allowed disabled:text-fg-faint disabled:hover:bg-transparent';
  return (
    // The header's own width bounds it: a confirmation's words truncate rather than run under the depth column.
    <span className="ml-auto flex min-w-0 items-center gap-2">
      <RpcStatus nonce={rpc} />
      {ended ? (
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
    </span>
  );
}
