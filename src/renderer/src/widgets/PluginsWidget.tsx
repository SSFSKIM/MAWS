// `/plugins` (C11; E8 execution document, M2; P2-B execution document §5.2 to §5.9): the plugin library, Claude Desktop's
// grouped plugin library as its 2.16120.0 bundle ships it, over E8's management through the engine's own CLI. A
// library-sized dialog (X19) whose head carries the title and, at the left, Open Discover (P4-AGG Decision Log 10: new
// plugins are found in Customize's Discover, which it opens for the session's directory) and, at the right, My items'
// Search, Filter and Sort, and the Add menu (Add marketplace, Manage marketplaces). My items: the loaded line about this
// session, then one row per plugin in Desktop's source groups. Selecting a row opens its detail in place of the list
// (§5.7): the list stays mounted beneath it, hidden, so Back returns to it with its search, filter, scroll and focus as
// they were; the head's controls and the loaded line belong to the list and leave with it. The two marketplace dialogs
// are sheets beside the frame, as E8's confirm sheet is, which stacks above them; every change is E8's CLI run after that
// sheet. The CLI needs no engine process, so a session with no ready process still manages plugins: the frame's states
// never stand in for the list, and A's session states (its observed facts, availability and Refresh) reach `/plugins`
// only through the loaded line and the detail's "Loaded in this session".
// UX wave U11c (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, M2, "The move, not a rewrite"): Customize
// draws its own head and holds its own operations and sheets (customize/place.tsx), so what both draw is cut out of the
// dialog here: the reads (`usePluginsLibrary`), the detail's selection (`useLibrarySelection`) and the list with its
// detail (`PluginsList`); `LibraryBody` is the dialog that only the session uses.
import { useQueryClient } from '@tanstack/react-query';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandOutput } from '@shared/ipc/schema';
import type { PluginManifestView } from '@shared/ipc/schema/plugins';
import { useAvailability } from '../sessions/availability';
import { useLoadedPlugins } from '../sessions/observed';
import { useSessions } from '../stores/sessions';
import { BEFORE_START, LIBRARY as L, PLUGIN_MANAGEMENT, WIDGET_TITLE } from './copy';
import { AddMarketplaceDialog } from './plugins/AddMarketplaceDialog';
import { AddMenu, type MarketplaceDialog } from './plugins/AddMenu';
import type { EngineResolution } from './plugins/ConfirmSheet';
import { PluginsToolbar } from './plugins/LibraryHeader';
import { identitiesOf, installationRef, type PluginIdentity } from './plugins/library';
import { useLibraryStore } from './plugins/library-store';
import { LoadedLine, NotObservedLine } from './plugins/LoadedLine';
import { ManageProvider, useManageState } from './plugins/manage';
import { ManageMarketplaces } from './plugins/ManageMarketplaces';
import { usePluginManifests, type PluginManifests } from './plugins/manifests';
import { MyItems } from './plugins/MyItems';
import { PluginDetail } from './plugins/PluginDetail';
import { usePluginsEnv, usePluginsRead, type PluginsReadResult } from './plugins/read';
import { useReloads } from './plugins/reload';
import { SESSION_UNAVAILABLE, type PluginSession } from './plugins/session';
import { WidgetFrame } from './WidgetFrame';
import { DISCOVER } from '../customize/discover/copy';
import { openDiscover } from '../customize/open';
import { machineOf } from '@shared/machine/address';
import { ipc } from '../ipc/client';
import { useCloseOnLeavingForRemote, useTabPlace } from './tab-place';

// The sessions a change reloads: those with a ready process (the host's fan-out targets). P5 O6 M4: this machine's, whose
// plugin CLI the change runs (another machine's sessions are not reloaded by it).
export const readyCount = (engine: ReadonlyMap<AppSessionId, EngineSessionStatus>): number => {
  let n = 0;
  for (const status of engine.values()) if (status.process === 'ready' && machineOf(status.appSessionId) === ipc.localMachine) n += 1;
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

type LibraryPresentation = { variant: 'modal'; appSessionId: AppSessionId; close(): void };

// Customize's attached session (customize/place.tsx): only the runtime reader follows the attachment, never acquiring a
// process. Memo keeps publishing its facts from rerendering the reader itself; reload hooks return new callbacks on each
// render. The cwd-based body, operations and sheets remain mounted beside it.
export const ReadySession = memo(function ReadySession({ appSessionId, onChange }: { appSessionId: AppSessionId; onChange(session: PluginSession): void }) {
  const session = usePluginSession(appSessionId, false);
  useLayoutEffect(() => onChange(session), [onChange, session]);
  return null;
});

export function PluginsWidget({ appSessionId, close }: { appSessionId: AppSessionId; args: string; close(): void }) {
  // UX wave U11a (§D "Plugins"): before the first message the library manages the tab's folder; a tab set to another
  // machine reads nothing of this Mac's
  const place = useTabPlace(appSessionId);
  useCloseOnLeavingForRemote(place, close);
  // the CLI's cwd: the launch's directory (which the host compares for project and local scope), else the record's
  const cwd = useSessions((s) => s.engine.get(appSessionId)?.cwd ?? s.records.get(appSessionId)?.directory ?? null);
  if (place.kind === 'remote') {
    return (
      <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.plugins} command="plugins" state="ready" error={null} close={close}>
        <p className="m-0 text-fg-muted">{BEFORE_START.remote(place.machine)}</p>
      </WidgetFrame>
    );
  }
  if (place.kind === 'local') return <LibraryBeforeStart appSessionId={appSessionId} folder={place.folder} close={close} />;
  // P5 O6 M4: the plugin CLI runs on this machine until O4 spans machines, so another machine's session's directory is
  // never read or changed here as if it were this machine's.
  if (machineOf(appSessionId) !== ipc.localMachine) {
    return (
      <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.plugins} command="plugins" state="ready" error={null} close={close}>
        <p className="m-0 text-fg-muted">{PLUGIN_MANAGEMENT.otherMachine}</p>
      </WidgetFrame>
    );
  }
  return <SessionLibrary cwd={cwd} appSessionId={appSessionId} presentation={{ variant: 'modal', appSessionId, close }} />;
}

// UX wave U11a (§D "Plugins"): an unstarted tab's library, over its folder (the engine's config home when none is chosen,
// as Customize reads the user configuration), with no session: its loaded line says "Not observed yet" alone, and Open
// Discover opens Customize for the same page (the user configuration's with no folder).
function LibraryBeforeStart({ appSessionId, folder, close }: { appSessionId: AppSessionId; folder: string | null; close(): void }) {
  const env = usePluginsEnv();
  const directory = folder ?? env.data?.configHome ?? null;
  if (directory === null) return <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.plugins} command="plugins" state={env.state === 'error' ? 'error' : 'loading'} error={env.error ?? null} size="library" close={close} />;
  return <LibraryBody key={directory} cwd={directory} session={null} presentation={{ variant: 'modal', appSessionId, close }} beforeStart={{ discoverAt: folder }} />;
}

// The session modal alone keeps dormant-session Refresh. Customize's page exposes ready-process reloads only.
function SessionLibrary({ cwd, appSessionId, presentation }: { cwd: string | null; appSessionId: AppSessionId; presentation: LibraryPresentation }) {
  const session = usePluginSession(appSessionId, true);
  return <LibraryBody cwd={cwd} session={session} presentation={presentation} />;
}

function usePluginSession(appSessionId: AppSessionId, allowAcquire: boolean): PluginSession {
  const ready = useSessions((s) => s.engine.get(appSessionId)?.process === 'ready');
  const reloads = useReloads(appSessionId);
  const loaded = useLoadedPlugins(appSessionId);
  const availability = useAvailability(appSessionId);
  return { appSessionId, loaded, availability, reloads: ready ? reloads : null, allowAcquire };
}

/** What the session's `/plugins` and Customize's My items both read: the installed list, the marketplaces, what each
 * plugin says about itself, and the plugins the session loaded. */
export interface PluginsLibraryReads {
  installed: PluginsReadResult<CommandOutput<'plugins.list'>>;
  marketplaces: PluginsReadResult<CommandOutput<'marketplaces.list'>>;
  identities: readonly PluginIdentity[];
  manifests: PluginManifests;
  loadedIds: ReadonlySet<string> | null;
  retryList(): void;
}

export function usePluginsLibrary(cwd: string | null, session: PluginSession | null): PluginsLibraryReads {
  const installed = usePluginsRead('plugins.list', cwd);
  const marketplaces = usePluginsRead('marketplaces.list', cwd);
  const loaded = session?.loaded ?? null;
  const client = useQueryClient();
  const plugins = installed.data?.plugins;
  const markets = marketplaces.data?.marketplaces;
  // the plugins the session loaded, as last observed; none observed is not "loaded none"
  const loadedIds = useMemo(() => (loaded === null || loaded.freshness.kind === 'unknown' ? null : new Set(loaded.plugins.flatMap((p) => (p.source === null ? [] : [p.source])))), [loaded]);
  // the manifest request derives from the listing held, never from the change event (§5.5)
  const requests = useMemo(() => identitiesOf(plugins ?? [], markets ?? [], NO_VIEWS, null).map(({ representative }) => ({ ...installationRef(representative), lastUpdated: representative.lastUpdated })), [plugins, markets]);
  const manifests = usePluginManifests(cwd, requests);
  const { views } = manifests;
  const identities = useMemo(() => identitiesOf(plugins ?? [], markets ?? [], views, loadedIds), [plugins, markets, views, loadedIds]);
  const retryList = useCallback(() => void client.refetchQueries({ queryKey: ['maws', 'plugins.list', { cwd }] }), [client, cwd]);
  return { installed, marketplaces, identities, manifests, loadedIds, retryList };
}

/** My items' detail: the plugin selected while it is listed (one uninstalled everywhere returns to the list); its leaving
 * restores the list's scroll and puts the keyboard back on the row it was opened from, else on `fallback`. */
export interface LibrarySelection {
  detail: PluginIdentity | null;
  open(id: string): void;
  close(): void;
  pane: RefObject<HTMLDivElement | null>;
}

export function useLibrarySelection(identities: readonly PluginIdentity[], fallback: string): LibrarySelection {
  const [selected, setSelected] = useState<string | null>(null);
  const detail = selected === null ? null : (identities.find((i) => i.id === selected) ?? null);
  const pane = useRef<HTMLDivElement>(null);
  const left = useRef<{ id: string; scrollTop: number } | null>(null);
  const open = useCallback((id: string) => {
    left.current = { id, scrollTop: pane.current?.scrollTop ?? 0 };
    setSelected(id);
  }, []);
  const close = useCallback(() => setSelected(null), []);
  const showing = detail !== null;
  useLayoutEffect(() => {
    const from = left.current;
    if (showing || from === null || pane.current === null) return;
    left.current = null;
    setSelected(null); // a plugin that left the list is not selected again by its return
    pane.current.scrollTop = from.scrollTop;
    // the keyboard back on the row it left from, else (the row left the list) on the frame or the page
    const target = pane.current.querySelector<HTMLElement>(`[data-plugin-row="${CSS.escape(from.id)}"] [data-row-open]`) ?? pane.current.closest<HTMLElement>(fallback);
    target?.focus();
  }, [showing, fallback]);
  return useMemo(() => ({ detail, open, close, pane }), [detail, open, close]);
}

/** My items as both draw it: the loaded line and the list, or a plugin's detail in its place (the list kept beneath). */
export function PluginsList({ library, session, selection, beforeStart = false, search }: {
  library: PluginsLibraryReads;
  session: PluginSession | null;
  selection: LibrarySelection;
  beforeStart?: boolean; // an unstarted tab's: its loaded line says "Not observed yet" alone
  search?: { text: string; clear(): void }; // Customize's one text, in the library store's place (UX wave U11c)
}) {
  const { installed, identities, manifests, loadedIds, retryList } = library;
  const marketplaces = library.marketplaces.data?.marketplaces;
  const loaded = session?.loaded ?? null;
  const reloads = session?.reloads ?? null;
  const appSessionId = session?.appSessionId ?? null;
  const { detail, open, close, pane } = selection;
  return (
    <>
      {detail && (
        <PluginDetail key={detail.id} appSessionId={appSessionId} availability={session?.availability ?? null} identity={detail} loaded={loaded} loadedIds={loadedIds} reloads={reloads} allowAcquire={session?.allowAcquire ?? false} listManifests={manifests} marketplaces={marketplaces} listError={installed.error} backTo={L.myItems} onBack={close} />
      )}
      <div className={detail !== null ? 'hidden' : 'contents'}>
        {session ? (
          <LoadedLine
            appSessionId={session.appSessionId}
            availability={session.availability}
            loaded={session.loaded}
            reloads={session.reloads}
            allowAcquire={session.allowAcquire}
            onShowLoaded={() => useLibraryStore.setState((s) => ({ plugins: { ...s.plugins, filter: 'loaded' } }))}
          />
        ) : beforeStart ? (
          <NotObservedLine />
        ) : (
          <p data-plugins-session-unavailable className="m-0 border-b border-border px-2 pb-2 text-ui-sm text-fg-muted">{SESSION_UNAVAILABLE}</p>
        )}
        <div ref={pane} data-library-pane className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          <MyItems appSessionId={appSessionId} installed={installed} identities={identities} marketplaces={marketplaces} loaded={loaded} loadedIds={loadedIds} onRetry={retryList} manifestError={manifests.error} onRetryManifests={manifests.retry} onOpen={open} search={search} />
        </div>
      </div>
    </>
  );
}

// The session's dialog. `beforeStart`: an unstarted tab's library (U11a), with the page Open Discover opens.
function LibraryBody({ cwd, session, presentation, beforeStart }: { cwd: string | null; session: PluginSession | null; presentation: LibraryPresentation; beforeStart?: { discoverAt: string | null } }) {
  const readySessions = useSessions((s) => readyCount(s.engine));
  const env = usePluginsEnv();
  const { reread } = env;
  const library = usePluginsLibrary(cwd, session);
  const reloads = session?.reloads ?? null;
  // the binary and the paths are the host's answer, never a guess: every sheet reads it again and confirms nothing until
  // it names a binary (M2 review; E8 whole-branch review); the sheet names what the change writes (E11 §2.2)
  const resolveEngine = useCallback(async () => resolutionOf(await reread()), [reread]);
  const { manage, sheet } = useManageState({ cwd: cwd ?? '', readySessions }, reloads?.reloadMods ?? null, resolveEngine);
  const [dialog, setDialog] = useState<MarketplaceDialog | null>(null);
  const selection = useLibrarySelection(library.identities, '[data-widget]');
  const showing = selection.detail !== null;

  const add = <AddMenu onOpen={setDialog} />;
  const toolbar = showing ? null : <PluginsToolbar add={add} />;
  // the session's `/plugins` finds new plugins in Discover (Decision Log 10): Customize's Discover, Plugins, for the
  // session's own directory (the CLI's cwd here), the modal closed; with no directory known there is nothing to open
  const discoverAt = beforeStart ? beforeStart.discoverAt : cwd;
  const heading = (
    <button
      type="button"
      data-open-discover
      disabled={discoverAt === null && !beforeStart}
      onClick={() => {
        if (discoverAt === null && !beforeStart) return;
        presentation.close();
        openDiscover(discoverAt);
      }}
      className="inline-flex h-7 shrink-0 items-center rounded-md border border-border px-2.5 text-ui text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2 disabled:text-fg-faint"
    >
      {DISCOVER.openDiscover}
    </button>
  );

  return (
    <ManageProvider value={manage}>
      <WidgetFrame {...presentation} title={WIDGET_TITLE.plugins} command="plugins" state="ready" error={null} size="library" heading={heading} toolbar={toolbar}>
        <PluginsList library={library} session={session} selection={selection} beforeStart={beforeStart !== undefined} />
      </WidgetFrame>
      {dialog === 'manage' && <ManageMarketplaces marketplaces={library.marketplaces} installed={library.installed.data?.plugins ?? []} onClose={() => setDialog(null)} />}
      {dialog === 'add' && <AddMarketplaceDialog onClose={() => setDialog(null)} />}
      {sheet}
    </ManageProvider>
  );
}
