// A project (§4): the channels on the left, the selected channel in the center, the selected session's depth on the
// right (DX8's `depth` slot, DC6's). Nothing from the log is drawn until it verifies; locked, nothing is drawn at all,
// and the view says why. Events, requests, settlements, and deliveries whose code fails are reported, never drawn.
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { Me } from '../../hub/me';
import { useKeyHolder } from '../../key/holder';
import { drawable, refused } from '../../log/project-log';
import { useProjectConnection } from '../../project/registry';
import type { AuditItem, ProjectConnection } from '../../project/connection';
import { useDeskLayout, type Channel } from '../../shell/layout';
import { useDeskSessions } from '../../shell/sessions';
import { useSlot } from '../../shell/slots';
import { useGrid } from '../../state/grid';
import { UnlockForm } from '../key/UnlockForm';
import { DeskContext } from '../conversation/desk-context';
import { ChannelView } from './ChannelView';
import { Sidebar } from './Sidebar';
import { SpawnDialog } from './SpawnDialog';

export function ProjectView({ me, project, channel }: { me: Me; project: string; channel: Channel }) {
  const connection = useProjectConnection(project);
  const name = useGrid((s) => s.projects.find((p) => p.id === project)?.name) ?? project.slice(0, 8);
  return <OpenProject me={me} connection={connection} name={name} channel={channel} />;
}

function OpenProject({ me, connection, name, channel }: { me: Me; connection: ProjectConnection; name: string; channel: Channel }) {
  const navigate = useDeskLayout((s) => s.navigate);
  const depth = useDeskLayout((s) => s.depth);
  const keyState = useKeyHolder((s) => s.state);
  const logState = useStore(connection.log.store);
  const status = useStore(connection.live, (s) => s.status);
  const audit = useStore(connection.live, (s) => s.audit);
  const unverified = useStore(connection.conversation.store, (s) => s.unverified);
  const { sessions, groups } = useDeskSessions(connection);
  const [spawning, setSpawning] = useState(false);
  const desk = { connection, member: me.member.id, sessions };
  const Depth = useSlot('depth');
  const locked = keyState !== 'unlocked';
  const failed = refused(logState);
  const selected = channel.kind === 'session' ? (sessions.get(channel.session) ?? null) : null;
  // A visible tab of the project holds back its member's pushes (DX3's `visibility`).
  useEffect(() => {
    const report = () => connection.client.setVisible(document.visibilityState === 'visible');
    report();
    document.addEventListener('visibilitychange', report);
    return () => {
      document.removeEventListener('visibilitychange', report);
      connection.client.setVisible(false);
    };
  }, [connection]);
  const select = (next: Channel) => navigate({ view: 'project', project: connection.project, channel: next });

  return (
    <DeskContext.Provider value={desk}>
    <div
      className="grid h-full min-h-0"
      style={{ gridTemplateColumns: `var(--sidebar-w) minmax(0, 1fr)${depth.open ? ` ${depth.width}px` : ''}` }}
      data-testid="project-view"
      data-connection={status}
    >
      <Sidebar name={name} channel={channel} groups={locked ? null : groups} locked={locked} onSelect={select} onSpawn={() => setSpawning(true)} />
      <div className="flex min-h-0 min-w-0 flex-col">
        {status === 'connecting' && (
          <div className="border-b border-border bg-bg-raised px-4 py-1.5 text-ui-sm text-fg-muted" role="status">
            Connecting to the hub…
          </div>
        )}
        {!locked && failed.length > 0 && (
          <div className="border-b border-border px-4 py-1.5 text-ui-sm text-danger" role="alert" data-testid="refused">
            {failed.length === 1 ? 'One event' : `${failed.length} events`} failed verification and {failed.length === 1 ? 'is' : 'are'} not shown:{' '}
            {failed.map((e) => `${typeof e.event?.writer === 'string' ? e.event.writer : '?'}:${typeof e.event?.seq === 'number' ? e.event.seq : '?'} (${e.verdict === 'bad-code' ? 'its code does not match' : 'not an event'})`).join(', ')}
          </div>
        )}
        {!locked && unverified.length > 0 && (
          <div className="border-b border-border px-4 py-1.5 text-ui-sm text-danger" role="alert" data-testid="refused-requests">
            {unverified.length === 1 ? 'One' : unverified.length} {unverified.length === 1 ? 'item' : 'items'} from the session plane failed verification and {unverified.length === 1 ? 'is' : 'are'} not shown:{' '}
            {unverified.map((u) => `${u.what === 'request' ? 'a request' : u.what === 'settlement' ? 'a settlement' : 'a delivery'} ${u.id}${u.machine ? ` from ${u.machine}` : ''}`).join(', ')}
          </div>
        )}
        {audit.length > 0 && <AuditNotice audit={audit} />}
        {locked ? (
          <Locked me={me} name={name} loading={keyState === 'loading'} />
        ) : (
          <ChannelView name={name} channel={channel} session={selected} events={drawable(logState)} />
        )}
      </div>
      {depth.open && (
        <aside className="min-h-0 overflow-y-auto border-l border-border bg-bg-raised" aria-label="Session depth">
          {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render (as MAWS's panes) */}
          <Depth project={connection.project} session={locked ? null : selected} plane={connection.client} />
        </aside>
      )}
      {spawning && !locked && (
        <SpawnDialog
          onClose={() => setSpawning(false)}
          onOpen={(session) => {
            setSpawning(false);
            select({ kind: 'session', session });
          }}
        />
      )}
    </div>
    </DeskContext.Provider>
  );
}

function Locked({ me, name, loading }: { me: Me; name: string; loading: boolean }) {
  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-6 pt-[10vh]" data-testid="locked">
      {loading ? null : (
        <div className="max-w-[440px]">
          <h2 className="m-0 text-center text-ui font-semibold">{name} is locked in this browser</h2>
          <p className="text-center text-ui-sm leading-5 text-fg-muted">This browser can't check who wrote {name}'s log until it holds your org key, so nothing is shown.</p>
          <UnlockForm me={me} />
        </div>
      )}
    </div>
  );
}

/** The project's audit record: what the hub refused, and what a machine refused of what it was sent (§6: refused, reported). */
function AuditNotice({ audit }: { audit: AuditItem[] }) {
  const line = (item: AuditItem) => {
    if (item.kind === 'refused') return `The hub refused ${item.entry.writer ? `${item.entry.writer}:${item.entry.seq ?? '?'}` : 'a request'} (${item.entry.reason}): ${item.entry.message}`;
    const what = item.entry.event ? `${item.entry.event.writer}:${item.entry.event.seq}` : 'an event';
    return `${item.entry.machine} refused ${what} (${item.entry.reason})${item.entry.message ? `: ${item.entry.message}` : ''}`;
  };
  return (
    <details className="border-b border-border px-4 py-1.5 text-ui-sm text-danger" data-testid="audit">
      <summary className="cursor-pointer">{audit.length === 1 ? 'One refusal' : `${audit.length} refusals`} in the project's audit record</summary>
      <ul className="m-0 list-none p-0 text-fg-muted">
        {audit.map((item) => (
          <li key={item.entry.id}>{line(item)}</li>
        ))}
      </ul>
    </details>
  );
}
