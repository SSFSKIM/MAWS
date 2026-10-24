import type { AppSessionId } from '@shared/graph/ids';
import { openComposerWidget, useComposerStore } from '../../stores/composer';
import { useSessions } from '../../stores/sessions';
import { FloatingCard } from './FloatingCard';
import { Plugins } from './Plugins';
import { actionClass } from './Section';

export function Connectors({ appSessionId }: { appSessionId: AppSessionId }) {
  const status = useSessions((s) => s.engine.get(appSessionId));
  const hasComposer = useComposerStore((s) => !!s.focusTargets.get(appSessionId)?.openWidget);
  const servers = status?.mcpServers ?? [];
  const live = status?.process === 'ready';
  // Empty metadata remains unknown without an explicit MCP observation marker.
  const reported = servers.length > 0;
  const connected = servers.filter((s) => s.status === 'connected').length;
  const summary = !reported ? 'Not reported' : live ? `${connected} connected` : `${servers.length} last reported`;
  return (
    <FloatingCard title="Connectors" summary={summary}>
      {!reported ? <p className="text-ui-sm text-fg-muted">Connector status not reported</p> : (
        <>
          {!live && <p className="text-ui-sm text-fg-muted">Last reported by this session</p>}
          <ul className="flex flex-col gap-1">
            {servers.map((server) => <li key={server.name} className="flex min-w-0 items-baseline justify-between gap-2 py-1" title={server.source ?? undefined}>
              <span className="min-w-0 truncate">{server.name}</span>
              <span className="shrink-0 text-ui-sm text-fg-muted">{server.status}</span>
            </li>)}
          </ul>
        </>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={actionClass} disabled={!hasComposer} title={hasComposer ? 'Manage this session’s MCP servers' : 'Open the session to manage its connectors'} onClick={() => openComposerWidget(appSessionId, 'mcp', '')}>Manage connectors…</button>
        <button type="button" className={actionClass} disabled={!hasComposer} title={hasComposer ? 'Manage plugins and skills' : 'Open the session to manage its plugins'} onClick={() => openComposerWidget(appSessionId, 'plugins', '')}>Plugins…</button>
      </div>
      {/* Keep pinned plugin lines and the existing reload controls; they have no equivalent in MCP status. */}
      <Plugins appSessionId={appSessionId} embedded />
    </FloatingCard>
  );
}
