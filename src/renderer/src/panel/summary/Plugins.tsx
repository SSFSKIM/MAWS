// Plugins (R1; charter D-9 as amended 2026-10-01; E8 D-9): shown whenever the session's status lists a loaded plugin or
// a plugin pins a status line. The header row, while the status lists any, counts the plugins the session loaded
// (`system/init`, or the last `reload_plugins` answer) beside Reload plugins and Reload skills for a running session, with
// one operation line (the `/plugins` widget's controls); beneath, each plugin's pinned status line, the engine's
// `ui_status`, as "<plugin> · <text>" by plugin name, from the session's transcript entry as Sources reads its activity
// (the card never attaches a source of its own). An empty text clears a line.
// P2-A (X17): the count is the loaded plugins' by precedence (`useLoadedPlugins`): the live session's once its launch
// reported them, else the last list the engine host kept, each with its freshness ("Loaded now", "Loaded last time, 2
// days ago"); an unknown list shows no header. It mounts on a session switch, so it reads and never starts anything.
import { useMemo } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { FRESHNESS, useLoadedPlugins, type Freshness } from '../../sessions/observed'; // P2-A
import { useSessions } from '../../stores/sessions';
import { useTranscriptStore } from '../../stores/transcript';
import { PLUGIN, pluginLines } from '../../transcript';
import { ReloadControls, useReloads } from '../../widgets/plugins/reload';
import { SUMMARY_COPY } from '../copy';
import { Row, Section } from './Section';

function Header({ appSessionId, loaded, freshness }: { appSessionId: AppSessionId; loaded: number; freshness: Freshness }) {
  const reloads = useReloads(appSessionId);
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  return (
    <Row>
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="shrink-0">{SUMMARY_COPY.pluginsLoaded(loaded)}</span>
        {freshness.kind !== 'unknown' && <span className="shrink-0 text-fg-muted">{freshness.kind === 'now' ? FRESHNESS.loadedNow : FRESHNESS.loadedLast(freshness.at)}</span>}
        {ready && <ReloadControls reloads={reloads} />}
      </span>
    </Row>
  );
}

export function Plugins({ appSessionId }: { appSessionId: AppSessionId }) {
  const status = useTranscriptStore((s) => s.entries[appSessionId]?.state.pluginStatus);
  const lines = useMemo(() => (status ? pluginLines(status) : []), [status]);
  const { plugins, freshness } = useLoadedPlugins(appSessionId); // P2-A
  const loaded = plugins.length;
  if (lines.length === 0 && loaded === 0) return null;
  return (
    <Section id="plugins">
      {loaded > 0 && <Header appSessionId={appSessionId} loaded={loaded} freshness={freshness} />}
      {lines.map(({ plugin, text }) => {
        const line = PLUGIN.status(plugin, text);
        return (
          <Row key={plugin}>
            <span data-plugin={plugin} className="block truncate text-fg-muted" title={line}>
              {line}
            </span>
          </Row>
        );
      })}
    </Section>
  );
}
