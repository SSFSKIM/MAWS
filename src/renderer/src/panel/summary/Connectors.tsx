import type { AppSessionId } from '@shared/graph/ids';
import { openComposerWidget, useComposerStore } from '../../stores/composer';
import { useSessions } from '../../stores/sessions';
import { UNAVAILABLE_LOOK, UnavailableButton } from '../../ui/tip';
import { SUMMARY_COPY } from '../copy';
import { FloatingCard, type CardFold } from './FloatingCard';
import { Plugins } from './Plugins';
import { actionClass } from './Section';

// The word cut: a session that reported nothing leaves the heading's summary empty and says nothing more (P52, P62), and
// one not running says nothing beyond the heading's "N last reported" (P62). The two buttons read "Manage…" and
// "Plugins…", "Manage connectors…" still the first's name, with no tooltip while they work; greyed, each is a focusable
// `UnavailableButton` whose reason the keyboard reaches (P63).
const BUTTON = `${actionClass} ${UNAVAILABLE_LOOK} aria-disabled:border-transparent`;

export function Connectors({ appSessionId, fold }: { appSessionId: AppSessionId; fold: CardFold }) {
  const status = useSessions((s) => s.engine.get(appSessionId));
  const hasComposer = useComposerStore((s) => !!s.focusTargets.get(appSessionId)?.openWidget);
  const servers = status?.mcpServers ?? [];
  const live = status?.process === 'ready';
  // Empty metadata remains unknown without an explicit MCP observation marker.
  const reported = servers.length > 0;
  const connected = servers.filter((s) => s.status === 'connected').length;
  const summary = !reported ? null : live ? `${connected} connected` : `${servers.length} last reported`;
  return (
    <FloatingCard title="Connectors" summary={summary} {...fold}>
      {reported && (
        <ul className="flex flex-col gap-1">
          {servers.map((server) => <li key={server.name} className="flex min-w-0 items-baseline justify-between gap-2 py-1" title={server.source ?? undefined}>
            <span className="min-w-0 truncate">{server.name}</span>
            <span className="shrink-0 text-ui-sm text-fg-muted">{server.status}</span>
          </li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5">
        <UnavailableButton reason={hasComposer ? null : SUMMARY_COPY.manageUnavailable}>
          <button type="button" className={BUTTON} aria-label={SUMMARY_COPY.manageName} onClick={() => openComposerWidget(appSessionId, 'mcp', '')}>{SUMMARY_COPY.manage}</button>
        </UnavailableButton>
        <UnavailableButton reason={hasComposer ? null : SUMMARY_COPY.pluginsUnavailable}>
          <button type="button" className={BUTTON} onClick={() => openComposerWidget(appSessionId, 'plugins', '')}>{SUMMARY_COPY.pluginsButton}</button>
        </UnavailableButton>
      </div>
      {/* Keep pinned plugin lines and the existing reload controls; they have no equivalent in MCP status. */}
      <Plugins appSessionId={appSessionId} embedded />
    </FloatingCard>
  );
}
