// `/plugins` (C11; E8 execution document, M2; P2-B execution document §5.2 to §5.9): the plugin library, Claude Desktop's
// grouped plugin library as its 2.16120.0 bundle ships it, over E8's management through the engine's own CLI. A
// library-sized dialog (X19) whose head carries the title and the My items | Browse switch at the left and, at the right,
// the open view's Search, Show or Filter, and Sort, and the Add menu (Add marketplace, Manage marketplaces). Every open
// starts on My items with no selection, so Browse's catalogue read runs only on the click that opens it (E8 D-7: the
// listing refreshes the engine's catalogue caches), and is kept while the dialog stays open. My items: the loaded line
// about this session, then one row per plugin in Desktop's source groups. Selecting a row or a card opens its detail in
// place of its list (§5.7, §5.8): the list stays mounted beneath it, hidden, so Back returns to it with its search,
// filter, scroll and focus as they were; the head's controls and the loaded line belong to the list and leave with it.
// An installed card opens the plugin's My items detail, whose Back returns to Browse. The two marketplace dialogs are
// sheets beside the frame, as E8's confirm sheet is, which stacks above them; every change is E8's CLI run after that
// sheet. The CLI needs no engine process, so a session with no ready process still manages plugins: the frame's states
// never stand in for the list, and A's session states (its observed facts, availability and Refresh) reach `/plugins`
// only through the loaded line and the detail's "Loaded in this session".
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { BrowsePane } from './plugins/BrowsePane';
import { browseCards, browseView, isInstalledHere, type BrowseCard } from './plugins/browse';
import { BrowseDetail } from './plugins/BrowseDetail';
import type { EngineResolution } from './plugins/ConfirmSheet';
import { BrowseToolbar, LibrarySwitch, PluginsToolbar, type LibraryTab } from './plugins/LibraryHeader';
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
  // the plugins the session loaded, as last observed; none observed is not "loaded none"
  const loadedIds = useMemo(() => (loaded.freshness.kind === 'unknown' ? null : new Set(loaded.plugins.flatMap((p) => (p.source === null ? [] : [p.source])))), [loaded]);
  // the manifest request derives from the listing held, never from the change event (§5.5)
  const requests = useMemo(() => identitiesOf(plugins ?? [], markets ?? [], NO_VIEWS, null).map(({ representative }) => ({ ...installationRef(representative), lastUpdated: representative.lastUpdated })), [plugins, markets]);
  const manifests = usePluginManifests(cwd, requests);
  const { views } = manifests;
  const identities = useMemo(() => identitiesOf(plugins ?? [], markets ?? [], views, loadedIds), [plugins, markets, views, loadedIds]);

  // the view: My items or Browse, this open's own; Browse's catalogue is read from its first click until the dialog closes
  const [tab, setTab] = useState<LibraryTab>('myItems');
  const [browsed, setBrowsed] = useState(false);
  const available = usePluginsRead('plugins.available', cwd, browsed, tab === 'browse');
  const offers = available.data?.plugins;
  const cards = useMemo(() => browseCards(offers ?? [], identities, markets ?? []), [offers, identities, markets]);
  const choices = useLibraryStore((s) => s.browse);
  const shown = useMemo(() => browseView(cards, choices), [cards, choices]);
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

  // Browse's detail. A card's detail shows the card as last read, refreshed whenever the reads list it, and leaves only by
  // Back, the switch or closing the dialog: never because the card is missing from the latest reads. A change's reads
  // answer one by one (an install's catalogue leaves the plugin out before the installed list adds it back, and a change
  // during a listing is reread after it), so a missing card says nothing about whether it left; and the detail offers
  // only Install, so nothing done in it can make it leave. A card installed for the user or here opens its My items
  // detail instead, which follows the installed list as My items' does (its Uninstall… returns to the grid).
  const [picked, setPicked] = useState<{ installed: boolean; card: BrowseCard } | null>(null);
  const fresh = picked === null ? undefined : cards.find((c) => c.pluginId === picked.card.pluginId);
  if (picked !== null && fresh !== undefined && fresh !== picked.card) setPicked({ ...picked, card: fresh }); // keep the card as last read
  const card: BrowseCard | null = picked === null || picked.installed ? null : (fresh ?? picked.card);
  const pickedIdentity = picked?.installed ? (identities.find((i) => i.id === picked.card.pluginId) ?? null) : null;
  const browseDetail = picked === null ? null : picked.installed ? pickedIdentity : card;
  const pick = useCallback((c: BrowseCard) => setPicked({ installed: isInstalledHere(c), card: c }), []);
  if (picked?.installed && pickedIdentity === null) setPicked(null); // its installed list answered without it: back to the grid

  // a view's switch: to the other view, or (the view already shown) back to its list
  const switchTo = (next: LibraryTab) => {
    if (next === 'browse') setBrowsed(true);
    if (next === tab) {
      if (next === 'myItems') setSelected(null);
      else setPicked(null);
    }
    setTab(next);
  };

  const inDetail = tab === 'myItems' ? showing : browseDetail !== null;
  const add = <AddMenu onOpen={setDialog} />;
  const toolbar = inDetail ? null : tab === 'myItems' ? <PluginsToolbar add={add} /> : <BrowseToolbar sources={shown.sources} hasCounts={shown.hasCounts} sort={shown.sort} add={add} />;
  const pluginDetail = (identity: NonNullable<typeof detail>, backTo: string, onBack: () => void) => (
    <PluginDetail key={identity.id} appSessionId={appSessionId} availability={availability} identity={identity} loaded={loaded} loadedIds={loadedIds} reloads={ready ? reloads : null} listManifests={manifests} listError={installed.error} backTo={backTo} onBack={onBack} />
  );

  return (
    <ManageProvider value={manage}>
      <WidgetFrame appSessionId={appSessionId} title={WIDGET_TITLE.plugins} command="plugins" state="ready" error={null} close={close} size="library" heading={<LibrarySwitch tab={tab} onChange={switchTo} />} toolbar={toolbar}>
        {tab === 'myItems' && (
          <>
            {detail && pluginDetail(detail, L.myItems, () => setSelected(null))}
            <div className={showing ? 'hidden' : 'contents'}>
              <LoadedLine
                appSessionId={appSessionId}
                availability={availability}
                loaded={loaded}
                reloads={ready ? reloads : null}
                onShowLoaded={() => useLibraryStore.setState((s) => ({ plugins: { ...s.plugins, filter: 'loaded' } }))}
              />
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
        {tab === 'browse' && (
          <>
            {picked !== null && pickedIdentity !== null && pluginDetail(pickedIdentity, L.browse, () => setPicked(null))}
            {picked !== null && !picked.installed && card !== null && <BrowseDetail key={card.pluginId} card={card} onBack={() => setPicked(null)} />}
            <BrowsePane
              read={available}
              cards={cards}
              installed={plugins}
              joins={[
                { key: 'installed', read: installed, onRetry: installed.retry },
                { key: 'marketplaces', read: marketplaces, onRetry: marketplaces.retry },
              ]}
              view={shown}
              hidden={browseDetail !== null}
              onOpen={pick}
              onRetry={() => void client.refetchQueries({ queryKey: ['maws', 'plugins.available', { cwd }] })}
            />
          </>
        )}
      </WidgetFrame>
      {dialog === 'manage' && <ManageMarketplaces marketplaces={marketplaces} installed={plugins ?? []} onClose={() => setDialog(null)} />}
      {dialog === 'add' && <AddMarketplaceDialog onClose={() => setDialog(null)} />}
      {sheet}
    </ManageProvider>
  );
}
