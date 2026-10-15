// The center column: the selected channel, drawn only from verified log events and verified requests (§4). The group
// chat and a direct channel are one stream (`buildStream`); a direct channel's header carries the session's actions —
// Retire while it is a member, Resume once it ended — each drawn disabled with §5's reason when the session cannot,
// and says when the machine is offline: the conversation stays, presence and depth are unavailable.
import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { LogEvent } from 'desk-hub/protocol';
import { buildStream, type PlacedRequest } from '../../conversation/stream';
import { capabilities } from '../../conversation/capabilities';
import type { Channel } from '../../shell/layout';
import type { DeskSession } from '../../shell/sessions';
import { GroupComposer, SessionComposer } from '../composer/Composer';
import { useDesk } from '../conversation/desk-context';
import { RpcStatus } from '../conversation/RpcStatus';
import { StreamView } from '../conversation/StreamView';

export function ChannelView(props: { name: string; channel: Channel; session: DeskSession | null; events: Array<{ offset: number; event: LogEvent }> }) {
  const { name, channel, session, events } = props;
  const { connection, sessions } = useDesk();
  const requests = useStore(connection.conversation.store, (s) => s.requests);
  const outboxAll = useStore(connection.conversation.store, (s) => s.outbox);
  const items = useMemo(() => {
    const aliases = new Map([...sessions.values()].map((s) => [s.session, s.alias]));
    const placed: PlacedRequest[] = Object.values(requests).map((r) => ({ request: r.request, session: r.raised.session, at: r.at }));
    return buildStream(channel, events, aliases, placed);
  }, [channel, events, sessions, requests]);
  const outbox = Object.values(outboxAll).filter((o) => channel.kind === 'group' || (o.to !== '*' && o.to.some((r) => r.session === channel.session)));
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg" aria-label="Channel">
      <header className="flex h-[44px] shrink-0 items-center gap-2 border-b border-border px-4" data-testid="channel-header">
        {channel.kind === 'group' ? (
          <span className="text-ui font-semibold">
            <span className="text-fg-muted">#</span> {name}
          </span>
        ) : (
          <>
            <span className="text-ui font-semibold">{session?.alias ?? channel.session.slice(0, 8)}</span>
            {session && <span className="text-ui-sm text-fg-muted">@{session.machine}</span>}
            {session?.charge && <span className="min-w-0 truncate text-ui-sm text-fg-muted">· {session.charge}</span>}
            {session && <SessionActions session={session} />}
          </>
        )}
      </header>
      {session?.machineOnline === false && (
        <div className="border-b border-border bg-bg-raised px-4 py-1.5 text-ui-sm text-warning" role="status" data-testid="machine-offline">
          {session.machine} is offline: {session.alias}'s presence and depth are unavailable until it reconnects; everything it sent stays here.
        </div>
      )}
      <StreamView items={items} outbox={outbox} />
      {channel.kind === 'group' ? <GroupComposer name={name} /> : session && <SessionComposer session={session} />}
    </section>
  );
}

function SessionActions({ session }: { session: DeskSession }) {
  const { connection, member } = useDesk();
  const [rpc, setRpc] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const can = capabilities(session);
  const ended = session.group === 'ended';
  const button = 'rounded-sm border border-border-strong px-2 py-0.5 text-ui-sm hover:bg-bg-hover disabled:cursor-not-allowed disabled:text-fg-faint disabled:hover:bg-transparent';
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2">
      <RpcStatus nonce={rpc} />
      {ended ? (
        <button type="button" className={button} disabled={!can.resume.can} title={can.resume.reason ?? undefined} onClick={async () => setRpc(await connection.rpc(member, session.machine, 'resume', { session: session.session }))}>
          Resume
        </button>
      ) : confirming ? (
        <>
          <span className="text-ui-sm text-fg-muted">{can.retire.note ? `Retire ${session.alias}? This ${can.retire.note}.` : `Retire ${session.alias}? Its job stops.`}</span>
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
