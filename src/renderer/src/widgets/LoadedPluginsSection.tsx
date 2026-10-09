// P2-A (2026-10-09; the execution document §5.5 to §5.7, §10 Q2; the ledger's §6 exception): `/plugins`' "Loaded in
// this session" on whatever session it opens on. The list by precedence (`useLoadedPlugins`): the live engine's, "Loaded
// now"; else the last the engine reported, "Loaded last time, <relative>"; else "Not observed yet", never an empty list
// and never "not running". Refresh is the owner's gesture: it starts the session if it has no ready process, then
// reloads its plugins (branch Y), so the list reads "Loaded now"; opening the widget starts nothing. P2-B's library
// rewrite absorbs this section (its own Loaded view calls `useLoadedPlugins`).
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { availabilityIn, availabilityRefusal } from '../sessions/availability';
import { FRESHNESS, useLoadedPlugins } from '../sessions/observed';
import { useSessions } from '../stores/sessions';
import { FRAME } from './copy';
import { TextButton } from './parts';
import { PluginsBody, present } from './PluginsWidget';
import { useDormant } from './read';

export function LoadedPluginsSection({ appSessionId }: { appSessionId: AppSessionId }) {
  const loaded = useLoadedPlugins(appSessionId);
  const dormant = useDormant(appSessionId);
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    void loaded
      .refresh()
      .catch(() => undefined) // the words show through the session's read state
      .finally(() => setRefreshing(false));
  };
  const { freshness } = loaded;
  const line = freshness.kind === 'now' ? FRESHNESS.loadedNow : freshness.kind === 'last' ? FRESHNESS.loadedLast(freshness.at) : FRESHNESS.notObserved;
  const blocked = dormant?.state === 'unavailable' ? dormant.words : null;
  // a terminal or a job holding the session, or its archive, starts nothing: no Refresh (a refused one may be tried again)
  const startable = useSessions((s) => availabilityRefusal(availabilityIn(s, appSessionId), s.records.get(appSessionId)?.holder ?? null) === null);
  return (
    <>
      <div data-loaded-freshness={freshness.kind} className="mb-1 flex items-baseline gap-2 text-ui-sm text-fg-muted">
        <span className="min-w-0">{dormant?.state === 'starting' ? FRAME.starting : line}</span>
        {blocked !== null && (
          <span role="status" className="min-w-0">
            {blocked}
          </span>
        )}
        {startable && (
          <TextButton onClick={refresh} disabled={refreshing || dormant?.state === 'starting'}>
            {FRAME.refresh}
          </TextButton>
        )}
      </div>
      {freshness.kind !== 'unknown' && <PluginsBody view={present({ plugins: loaded.plugins, pluginErrors: loaded.errors, pluginWarnings: loaded.warnings })} />}
    </>
  );
}
