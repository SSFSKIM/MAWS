// A project (§4): the channels on the left, the selected channel in the center, the selected session's depth on the
// right (DX8's `depth` slot, DC6's). Nothing from the log is drawn until it verifies; locked, nothing is drawn at all,
// and the view says why. Events whose code fails are reported, never drawn.
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { useKeyHolder } from '../../key/holder';
import { drawable, refused } from '../../log/project-log';
import { useProjectConnection } from '../../project/registry';
import type { AuditItem, ProjectConnection } from '../../project/connection';
import { useDeskLayout, type Channel } from '../../shell/layout';
import { useDeskSessions } from '../../shell/sessions';
import { useSlot } from '../../shell/slots';
import { useGrid } from '../../state/grid';
import { ChannelView } from './ChannelView';
import { Sidebar } from './Sidebar';

export function ProjectView({ project, channel }: { project: string; channel: Channel }) {
  const connection = useProjectConnection(project);
  const name = useGrid((s) => s.projects.find((p) => p.id === project)?.name) ?? project.slice(0, 8);
  return <OpenProject connection={connection} name={name} channel={channel} />;
}

function OpenProject({ connection, name, channel }: { connection: ProjectConnection; name: string; channel: Channel }) {
  const navigate = useDeskLayout((s) => s.navigate);
  const depth = useDeskLayout((s) => s.depth);
  const keyState = useKeyHolder((s) => s.state);
  const logState = useStore(connection.log.store);
  const status = useStore(connection.live, (s) => s.status);
  const audit = useStore(connection.live, (s) => s.audit);
  const { sessions, groups } = useDeskSessions(connection);
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
    <div
      className="grid h-full min-h-0"
      style={{ gridTemplateColumns: `var(--sidebar-w) minmax(0, 1fr)${depth.open ? ` ${depth.width}px` : ''}` }}
      data-testid="project-view"
      data-connection={status}
    >
      <Sidebar name={name} channel={channel} groups={locked ? null : groups} locked={locked} onSelect={select} />
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
        {audit.length > 0 && <AuditNotice audit={audit} />}
        {locked ? (
          <Locked loading={keyState === 'loading'} />
        ) : (
          <ChannelView name={name} channel={channel} session={selected} events={drawable(logState)} sessions={sessions} />
        )}
      </div>
      {depth.open && (
        <aside className="min-h-0 overflow-y-auto border-l border-border bg-bg-raised" aria-label="Session depth">
          {/* eslint-disable-next-line react-hooks/static-components -- registered once at composition, not created in render (as MAWS's panes) */}
          <Depth project={connection.project} session={locked ? null : selected} plane={connection.client} />
        </aside>
      )}
    </div>
  );
}

function Locked({ loading }: { loading: boolean }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6" data-testid="locked">
      {loading ? null : (
        <div className="max-w-[440px] text-center">
          <h2 className="m-0 text-ui font-semibold">This browser is locked</h2>
          <p className="text-ui-sm leading-5 text-fg-muted">
            It holds no key for the org. Every event in a project's log is checked with that key before it is shown, so nothing from the log is drawn until the browser is unlocked.
          </p>
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
