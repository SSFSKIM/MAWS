// P2-A (2026-10-09; the execution document §5.5 to §5.7, §10 Q2; the ledger's §6 exception): `/plugins`' "Loaded in
// this session" on whatever session it opens on. The list by precedence (`useLoadedPlugins`): the live engine's, "Loaded
// now"; else the last the engine reported, "Loaded last time, <relative>"; else "Not observed yet", never an empty list
// and never "not running". Refresh is the owner's gesture: it starts the session if it has no ready process, then
// reloads its plugins (branch Y), so the list reads "Loaded now"; opening the widget starts nothing. The line is every
// surface's (`DormantGesture`: Starting…, why it cannot start, a holder's actions in place of Refresh), and under it the
// reload's own line, its failure included (a refused invoke, or a failed operation after the start). P2-B's library
// rewrite absorbs this section (its own Loaded view calls `useLoadedPlugins`).
import { useState } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { FRESHNESS, useLoadedPlugins } from '../sessions/observed';
import { FRAME } from './copy';
import { DormantGesture } from './DormantGesture';
import { PluginsBody, present } from './PluginsWidget';

export function LoadedPluginsSection({ appSessionId }: { appSessionId: AppSessionId }) {
  const loaded = useLoadedPlugins(appSessionId);
  const [refreshing, setRefreshing] = useState(false);
  const [thrown, setThrown] = useState<string | null>(null); // the acquisition itself failed (main or the host unreachable)
  const refresh = () => {
    setRefreshing(true);
    setThrown(null);
    void loaded
      .refresh()
      .catch((error: unknown) => setThrown(error instanceof Error ? error.message : String(error)))
      .finally(() => setRefreshing(false));
  };
  const { freshness, reload } = loaded;
  const line = freshness.kind === 'now' ? FRESHNESS.loadedNow : freshness.kind === 'last' ? FRESHNESS.loadedLast(freshness.at) : FRESHNESS.notObserved;
  const failure = thrown ?? (reload.failed ? reload.line : null);
  return (
    <>
      <div data-loaded-freshness={freshness.kind}>
        <DormantGesture appSessionId={appSessionId} label={FRAME.refresh} lead={line} onGesture={refresh} busy={refreshing} />
      </div>
      {failure !== null ? (
        <p role="alert" data-loaded-reload="failed" className="m-0 mb-1 text-ui-sm text-danger">
          {failure}
        </p>
      ) : (
        reload.line !== null && (
          <p role="status" data-loaded-reload="" className="m-0 mb-1 text-ui-sm text-fg-muted">
            {reload.line}
          </p>
        )
      )}
      {freshness.kind !== 'unknown' && <PluginsBody view={present({ plugins: loaded.plugins, pluginErrors: loaded.errors, pluginWarnings: loaded.warnings })} />}
    </>
  );
}
