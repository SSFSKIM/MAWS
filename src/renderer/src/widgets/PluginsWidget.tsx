// `/plugins` (C11; E8 execution document, M2; P2-B execution document §5.2 to §5.9): the plugin library, Claude Desktop's
// grouped plugin library as its 2.16120.0 bundle ships it, over E8's management through the engine's own CLI. A
// library-sized dialog (X19) whose head carries the title and, at the left, Open Discover (P4-AGG Decision Log 10: new
// plugins are found in Customize › Plugins › Discover, which it opens for the session's directory) and, at the right, My
// items' Search, Show and Sort, and the Add menu (Add marketplace, Manage marketplaces). Customize's embedded library has
// the My items | Discover switch there instead. My items: the loaded line about this session, then one row per plugin in
// Desktop's source groups. Selecting a row opens its detail in place of the list (§5.7): the list stays mounted beneath
// it, hidden, so Back returns to it with its search, filter, scroll and focus as they were; the head's controls and the
// loaded line belong to the list and leave with it. The two marketplace dialogs are
// sheets beside the frame, as E8's confirm sheet is, which stacks above them; every change is E8's CLI run after that
// sheet. The CLI needs no engine process, so a session with no ready process still manages plugins: the frame's states
// never stand in for the list, and A's session states (its observed facts, availability and Refresh) reach `/plugins`
// only through the loaded line and the detail's "Loaded in this session".
import { useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandOutput } from '@shared/ipc/schema';
import type { PluginManifestView } from '@shared/ipc/schema/plugins';
import { useAvailability } from '../sessions/availability';
import { useLoadedPlugins } from '../sessions/observed';
import { useSessions } from '../stores/sessions';
import { LIBRARY as L, PLUGIN_MANAGEMENT, WIDGET_TITLE } from './copy';
import { AddMarketplaceDialog } from './plugins/AddMarketplaceDialog';
import { AddMenu, type MarketplaceDialog } from './plugins/AddMenu';
import type { EngineResolution } from './plugins/ConfirmSheet';
import { LibrarySwitch, PluginsToolbar, type LibraryTab } from './plugins/LibraryHeader';
import { identitiesOf, installationRef } from './plugins/library';
import { useLibraryStore } from './plugins/library-store';
import { LoadedLine } from './plugins/LoadedLine';
import { ManageProvider, useManageState } from './plugins/manage';
import { ManageMarketplaces } from './plugins/ManageMarketplaces';
import { usePluginManifests } from './plugins/manifests';
import { MyItems } from './plugins/MyItems';
import { PluginDetail } from './plugins/PluginDetail';
import { usePluginsEnv, usePluginsRead, type PluginsReadResult } from './plugins/read';
import { useReloads } from './plugins/reload';
import { SESSION_UNAVAILABLE, type PluginSession } from './plugins/session';
import { WidgetFrame } from './WidgetFrame';
import { pluginIdOf } from '../customize/discover/add';
import { DISCOVER } from '../customize/discover/copy';
import { DiscoverPane } from '../customize/discover/DiscoverPane';
import { DiscoverToolbar } from '../customize/discover/DiscoverToolbar';
import { openDiscover, takeDiscoverRequest, useDiscoverRequest } from '../customize/open';

// The sessions a change reloads: those with a ready process (the host's fan-out targets).
const readyCount = (engine: ReadonlyMap<AppSessionId, EngineSessionStatus>): number => {
  let n = 0;
  for (const status of engine.values()) if (status.process === 'ready') n += 1;
  return n;
};

// `plugins.env`'s read as the sheet takes it: resolved only by an answer that names a binary; an answer
// without one is the probe's refusal in its own words (`binaryError`), and a failed read is the read's refusal.
export function resolutionOf(env: PluginsReadResult<CommandOutput<'plugins.env'>>): EngineResolution {
  if (env.data) {
    const { binary, binaryError, configHome, globalConfig } = env.data;
    return binary !== null ? { state: 'ready', env: { binary, configHome, globalConfig } } : { state: 'error', error: binaryError ?? PLUGIN_MANAGEMENT.unresolved };
  }
  return env.state === 'error' ? { state: 'error', error: env.error ?? PLUGIN_MANAGEMENT.unresolved } : { state: 'loading' };
}

const NO_VIEWS: ReadonlyMap<string, PluginManifestView> = new Map();

type LibraryPresentation = { variant: 'embedded'; scope?: ReactNode } | { variant: 'modal'; appSessionId: AppSessionId; close(): void };

// P4-AGG M3: Customize's library shows Discover (the catalog over `catalog.*`, Discover's page cwd: null for the user
// configuration) beside My items; the session's `/plugins` keeps My items and opens Discover there (Decision Log 10).
export interface DiscoverOption {
  cwd: string | null;
}

export interface PluginsLibraryProps {
  cwd: string;
  appSessionId: AppSessionId | null;
  scope?: ReactNode;
  discover?: DiscoverOption;
}

// Customize supplies a real directory and, optionally, a ready session. Runtime hooks are mounted only while that
// attachment is actually ready; an exit never turns Customize into an engine-start surface. A project change resets
// details and confirmations, so an old request cannot silently become a change in a different project.
export function PluginsLibrary({ cwd, appSessionId, scope, discover }: PluginsLibraryProps) {
  const ready = useSessions((s) => appSessionId !== null && s.engine.get(appSessionId)?.process === 'ready');
  return <EmbeddedLibrary key={cwd} cwd={cwd} appSessionId={ready ? appSessionId : null} scope={scope} discover={discover} />;
}

function EmbeddedLibrary({ cwd, appSessionId, scope, discover }: PluginsLibraryProps) {
  const [session, setSession] = useState<PluginSession | null>(null);
  return (
    <>
      {appSessionId !== null && <ReadySession key={appSessionId} appSessionId={appSessionId} onChange={setSession} />}
      <LibraryBody cwd={cwd} session={session?.appSessionId === appSessionId ? session : null} presentation={{ variant: 'embedded', scope }} discover={discover} />
    </>
  );
}

// Only the runtime reader follows the attachment. Memo keeps publishing its facts from rerendering the reader itself;
// reload hooks return new callbacks on each render. The cwd-based body, operations and sheets remain mounted beside it.
const ReadySession = memo(function ReadySession({ appSessionId, onChange }: { appSessionId: AppSessionId; onChange(session: PluginSession): void }) {
  const session = usePluginSession(appSessionId, false);
  useLayoutEffect(() => onChange(session), [onChange, session]);
  return null;
});

export function PluginsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  // the CLI's cwd: the launch's directory (which the host compares for project and local scope), else the record's
  const cwd = useSessions((s) => s.engine.get(appSessionId)?.cwd ?? s.records.get(appSessionId)?.directory ?? null);
  return <SessionLibrary cwd={cwd} appSessionId={appSessionId} presentation={{ variant: 'modal', appSessionId, close }} />;
}

// The session modal alone keeps dormant-session Refresh. The embedded library exposes ready-process reloads only.
function SessionLibrary({ cwd, appSessionId, presentation }: { cwd: string | null; appSessionId: AppSessionId; presentation: LibraryPresentation }) {
  const session = usePluginSession(appSessionId, presentation.variant === 'modal');
  return <LibraryBody cwd={cwd} session={session} presentation={presentation} />;
}

function usePluginSession(appSessionId: AppSessionId, allowAcquire: boolean): PluginSession {
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const reloads = useReloads(appSessionId);
  const loaded = useLoadedPlugins(appSessionId);
  const availability = useAvailability(appSessionId);
  return { appSessionId, loaded, availability, reloads: ready ? reloads : null, allowAcquire };
}

function LibraryBody({ cwd, session, presentation, discover }: { cwd: string | null; session: PluginSession | null; presentation: LibraryPresentation; discover?: DiscoverOption }) {
  const readySessions = useSessions((s) => readyCount(s.engine));
  const env = usePluginsEnv();
  const { reread } = env;
  const installed = usePluginsRead('plugins.list', cwd);
  const marketplaces = usePluginsRead('marketplaces.list', cwd);
  const loaded = session?.loaded ?? null;
  const reloads = session?.reloads ?? null;
  const appSessionId = session?.appSessionId ?? null;
  const client = useQueryClient();
  // the binary and the paths are the host's answer, never a guess: every sheet reads it again and confirms nothing until
  // it names a binary (M2 review; E8 whole-branch review); the sheet names what the change writes (E11 §2.2)
  const resolveEngine = useCallback(async () => resolutionOf(await reread()), [reread]);
  const { manage, sheet } = useManageState({ cwd: cwd ?? '', readySessions, keep: discover ? `customize:plugins:${discover.cwd ?? 'user'}` : undefined }, reloads?.reloadMods ?? null, resolveEngine); // Customize's page keeps its operations past its views

  const plugins = installed.data?.plugins;
  const markets = marketplaces.data?.marketplaces;
  // the plugins the session loaded, as last observed; none observed is not "loaded none"
  const loadedIds = useMemo(() => (loaded === null || loaded.freshness.kind === 'unknown' ? null : new Set(loaded.plugins.flatMap((p) => (p.source === null ? [] : [p.source])))), [loaded]);
  // the manifest request derives from the listing held, never from the change event (§5.5)
  const requests = useMemo(() => identitiesOf(plugins ?? [], markets ?? [], NO_VIEWS, null).map(({ representative }) => ({ ...installationRef(representative), lastUpdated: representative.lastUpdated })), [plugins, markets]);
  const manifests = usePluginManifests(cwd, requests);
  const { views } = manifests;
  const identities = useMemo(() => identitiesOf(plugins ?? [], markets ?? [], views, loadedIds), [plugins, markets, views, loadedIds]);

  // the view: My items, or (in Customize) Discover; a request from the session's `/plugins` (Open Discover, Decision Log
  // 10) for this library's page opens it on Discover, whether it is mounted already or mounts for it
  const [tab, setTab] = useState<LibraryTab>(() => (discover && takeDiscoverRequest(discover.cwd) ? 'discover' : 'myItems'));
  useEffect(() => {
    if (!discover) return;
    return useDiscoverRequest.subscribe(() => {
      if (takeDiscoverRequest(discover.cwd)) setTab('discover');
    });
  }, [discover]);
  const [dialog, setDialog] = useState<MarketplaceDialog | null>(null);

  // My items' detail: the plugin selected in this open, while it is listed (one uninstalled everywhere returns to the list)
  const [selected, setSelected] = useState<string | null>(null);
  const detail = selected === null ? null : (identities.find((i) => i.id === selected) ?? null);
  const pane = useRef<HTMLDivElement>(null);
  const left = useRef<{ id: string; scrollTop: number } | null>(null);
  const open = useCallback((id: string) => {
    left.current = { id, scrollTop: pane.current?.scrollTop ?? 0 };
    setSelected(id);
  }, []);
  const showing = detail !== null;
  useLayoutEffect(() => {
    const from = left.current;
    if (showing || from === null || pane.current === null) return;
    left.current = null;
    setSelected(null); // a plugin that left the list is not selected again by its return
    pane.current.scrollTop = from.scrollTop;
    // the keyboard back on the row it left from, else (the row left the list) on the frame
    const target = pane.current.querySelector<HTMLElement>(`[data-plugin-row="${CSS.escape(from.id)}"] [data-row-open]`) ?? pane.current.closest<HTMLElement>('[data-widget]');
    target?.focus();
  }, [showing]);

  // a view's switch: to the other view, or (the view already shown) back to its list
  const switchTo = (next: LibraryTab) => {
    if (next === tab && next === 'myItems') setSelected(null);
    setTab(next);
  };

  const add = <AddMenu onOpen={setDialog} />;
  const toolbar = discover && tab === 'discover' ? <DiscoverToolbar tab="plugins" add={add} /> : showing ? null : <PluginsToolbar add={add} />;
  // the session's `/plugins` finds new plugins in Discover (Decision Log 10): Customize › Plugins › Discover for the
  // session's own directory (the CLI's cwd here), the modal closed; with no directory known there is nothing to open
  const heading = discover ? (
    <LibrarySwitch tab={tab} onChange={switchTo} second={DISCOVER.discover} />
  ) : (
    <button
      type="button"
      data-open-discover
      disabled={cwd === null}
      onClick={() => {
        if (cwd === null) return;
        if (presentation.variant === 'modal') presentation.close();
        openDiscover(cwd);
      }}
      className="inline-flex h-7 shrink-0 items-center rounded-md border border-border px-2.5 text-ui text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint"
    >
      {DISCOVER.openDiscover}
    </button>
  );
  // an item Discover shows installed here opens in My items, its detail when My items lists it under that id
  const openInstalled = (item: Parameters<typeof pluginIdOf>[0]) => {
    const id = pluginIdOf(item);
    setTab('myItems');
    if (id !== null && identities.some((identity) => identity.id === id)) open(id);
  };
  const pluginDetail = (identity: NonNullable<typeof detail>, backTo: string, onBack: () => void) => (
    <PluginDetail key={identity.id} appSessionId={appSessionId} availability={session?.availability ?? null} identity={identity} loaded={loaded} loadedIds={loadedIds} reloads={reloads} allowAcquire={session?.allowAcquire ?? false} listManifests={manifests} listError={installed.error} backTo={backTo} onBack={onBack} />
  );

  return (
    <ManageProvider value={manage}>
      <WidgetFrame {...presentation} title={WIDGET_TITLE.plugins} command="plugins" state="ready" error={null} size="library" heading={heading} toolbar={toolbar}>
        {tab === 'myItems' && (
          <>
            {detail && pluginDetail(detail, L.myItems, () => setSelected(null))}
            <div className={showing ? 'hidden' : 'contents'}>
              {session ? (
                <LoadedLine
                  appSessionId={session.appSessionId}
                  availability={session.availability}
                  loaded={session.loaded}
                  reloads={session.reloads}
                  allowAcquire={session.allowAcquire}
                  onShowLoaded={() => useLibraryStore.setState((s) => ({ plugins: { ...s.plugins, filter: 'loaded' } }))}
                />
              ) : (
                <p data-plugins-session-unavailable className="m-0 border-b border-border px-2 pb-2 text-ui-sm text-fg-muted">{SESSION_UNAVAILABLE}</p>
              )}
              <div ref={pane} data-library-pane className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
                <MyItems
                  appSessionId={appSessionId}
                  installed={installed}
                  identities={identities}
                  loaded={loaded}
                  loadedIds={loadedIds}
                  onRetry={() => void client.refetchQueries({ queryKey: ['maws', 'plugins.list', { cwd }] })}
                  manifestError={manifests.error}
                  onRetryManifests={manifests.retry}
                  onOpen={open}
                />
              </div>
            </div>
          </>
        )}
        {tab === 'discover' && discover && <DiscoverPane tab="plugins" cwd={discover.cwd} onOpenInstalled={openInstalled} />}
      </WidgetFrame>
      {dialog === 'manage' && <ManageMarketplaces marketplaces={marketplaces} installed={plugins ?? []} onClose={() => setDialog(null)} />}
      {dialog === 'add' && <AddMarketplaceDialog onClose={() => setDialog(null)} />}
      {sheet}
    </ManageProvider>
  );
}
