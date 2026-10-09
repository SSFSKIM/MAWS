// `/plugins` (C11; E8 execution document, M2; P2-B execution document §5.2 to §5.6): the plugin library, Claude Desktop's
// grouped plugin library as its 2.16120.0 bundle ships it, over E8's management through the engine's own CLI. A
// library-sized dialog (X19) whose head carries the title and, at the right, Search, Show and Sort; under it the loaded
// line about this session; then My items, one row per plugin in Desktop's source groups, each change through E8's
// confirm sheet. E8's Marketplaces and Available sections stay mounted beneath My items until Browse and the
// marketplace dialogs replace them (M5). The CLI needs no engine process, so a session that is not running still manages
// plugins: the frame's states never stand in for the list, which says its own read's states, and A's session states
// reach `/plugins` only through the loaded line.
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandOutput } from '@shared/ipc/schema';
import type { PluginManifestView } from '@shared/ipc/schema/plugins';
import { useSessions } from '../stores/sessions';
import { PLUGIN_MANAGEMENT, WIDGET_TITLE } from './copy';
import { AvailableSection } from './plugins/Available';
import type { EngineResolution } from './plugins/ConfirmSheet';
import { PluginsToolbar } from './plugins/LibraryHeader';
import { identitiesOf, installationRef } from './plugins/library';
import { useLibraryStore } from './plugins/library-store';
import { useAvailability, useLoadedPlugins } from './plugins/loaded';
import { LoadedLine } from './plugins/LoadedLine';
import { ManageProvider, useManageState } from './plugins/manage';
import { usePluginManifests } from './plugins/manifests';
import { MarketplacesSection } from './plugins/Marketplaces';
import { MyItems } from './plugins/MyItems';
import { usePluginsEnv, usePluginsRead, type PluginsReadResult } from './plugins/read';
import { useReloads } from './plugins/reload';
import { WidgetFrame } from './WidgetFrame';

// The sessions a change reloads: those with a ready process (the host's fan-out targets).
const readyCount = (engine: ReadonlyMap<AppSessionId, EngineSessionStatus>): number => {
  let n = 0;
  for (const status of engine.values()) if (status.process === 'ready') n += 1;
  return n;
};

// `plugins.env`'s read as the sheet takes it: resolved only by an answer that names a binary; an answer
// without one is the probe's refusal in its own words (`binaryError`), and a failed read is the read's refusal.
function resolutionOf(env: PluginsReadResult<CommandOutput<'plugins.env'>>): EngineResolution {
  if (env.data) {
    const { binary, binaryError, configHome, globalConfig } = env.data;
    return binary !== null ? { state: 'ready', env: { binary, configHome, globalConfig } } : { state: 'error', error: binaryError ?? PLUGIN_MANAGEMENT.unresolved };
  }
  return env.state === 'error' ? { state: 'error', error: env.error ?? PLUGIN_MANAGEMENT.unresolved } : { state: 'loading' };
}

const NO_VIEWS: ReadonlyMap<string, PluginManifestView> = new Map();

export function PluginsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  // the CLI's cwd: the launch's directory (which the host compares for project and local scope), else the record's
  const cwd = useSessions((s) => s.engine.get(appSessionId)?.cwd ?? s.records.get(appSessionId)?.directory ?? null);
  const readySessions = useSessions((s) => readyCount(s.engine));
  const env = usePluginsEnv();
  const { reread } = env;
  const installed = usePluginsRead('plugins.list', cwd);
  const marketplaces = usePluginsRead('marketplaces.list', cwd);
  const reloads = useReloads(appSessionId);
  const loaded = useLoadedPlugins(appSessionId);
  const availability = useAvailability(appSessionId);
  const client = useQueryClient();
  // the binary and the paths are the host's answer, never a guess: every sheet reads it again and confirms nothing until
  // it names a binary (M2 review; E8 whole-branch review); the sheet names what the change writes (E11 §2.2)
  const resolveEngine = useCallback(async () => resolutionOf(await reread()), [reread]);
  const { manage, sheet } = useManageState({ cwd: cwd ?? '', readySessions }, ready ? reloads.reloadMods : null, resolveEngine);

  const plugins = installed.data?.plugins;
  const markets = marketplaces.data?.marketplaces;
  const loadedIds = useMemo(() => (loaded.freshness.kind === 'unknown' ? null : new Set(loaded.plugins.flatMap((p) => (p.source === null ? [] : [p.source])))), [loaded]);
  // the manifest request derives from the listing held, never from the change event (§5.5)
  const requests = useMemo(() => identitiesOf(plugins ?? [], markets ?? [], NO_VIEWS, null).map(({ representative }) => ({ ...installationRef(representative), lastUpdated: representative.lastUpdated })), [plugins, markets]);
  const { views } = usePluginManifests(cwd, requests);
  const identities = useMemo(() => identitiesOf(plugins ?? [], markets ?? [], views, loadedIds), [plugins, markets, views, loadedIds]);

  return (
    <ManageProvider value={manage}>
      <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.plugins} command="plugins" state="ready" error={null} close={close} size="library" toolbar={<PluginsToolbar />}>
        <LoadedLine
          appSessionId={appSessionId}
          availability={availability}
          loaded={loaded}
          refresh={null}
          reloads={ready ? reloads : null}
          onShowLoaded={() => useLibraryStore.setState((s) => ({ plugins: { ...s.plugins, filter: 'loaded' } }))}
        />
        <div data-library-pane className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          <MyItems appSessionId={appSessionId} installed={installed} identities={identities} loaded={loaded} loadedIds={loadedIds} onRetry={() => void client.refetchQueries({ queryKey: ['maws', 'plugins.list', { cwd }] })} />
          {cwd !== null && (
            <div className="mt-4 border-t border-border px-1 pt-2">
              <MarketplacesSection cwd={cwd} installed={plugins ?? []} />
              <AvailableSection cwd={cwd} />
            </div>
          )}
        </div>
      </WidgetFrame>
      {sheet}
    </ManageProvider>
  );
}
