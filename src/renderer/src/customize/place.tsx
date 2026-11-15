// Customize's one place that holds what a person started (UX wave U11c, docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md,
// §D), above every body of both views and above the head, for the page's place (its folder, or the user configuration):
// - one kept book, `customize:<folder>` or `customize:user`, for plugins, skills and connectors alike, so a line outlives
//   a change of view, of Show and of project, for connectors now as for plugins before;
// - one `Manage`: `ask` opens the connector sheet for `mcp-add` and `mcp-remove` and the install sheet for every other
//   action; `askIn` is the connector sheet's, for a removal in its own folder;
// - the sheets and the two marketplace dialogs, drawn once, over the page; a change of project closes them;
// - the attached session's plugin facts (its loaded list and reloads), read without ever acquiring a process;
// - the read at a custom connector sheet's opening (U11g's, `useConnectorManage`).
// The page is not remounted when its project changes (its head keeps the keyboard), so what is asked is held for the
// place it was asked on (`usePlaceHeld`), and the bodies below are keyed by the place.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { isMcpAction } from '@shared/plugins/cli';
import { useSessions } from '../stores/sessions';
import { readyCount, ReadySession, resolutionOf } from '../widgets/PluginsWidget';
import { AddMarketplaceDialog } from '../widgets/plugins/AddMarketplaceDialog';
import type { MarketplaceDialog } from '../widgets/plugins/AddMenu';
import { ManageMarketplaces } from '../widgets/plugins/ManageMarketplaces';
import { ManageProvider, usePlaceHeld, useManageState, type Manage } from '../widgets/plugins/manage';
import { usePluginsEnv, usePluginsRead } from '../widgets/plugins/read';
import type { PluginSession } from '../widgets/plugins/session';
import { useConnectorManage, type AskIn } from './connectors/manage';
import { configuredOf } from './connectors/present';
import { useCustomizationInventory } from './inventory';

export interface Place {
  cwd: string | null; // the page's folder; null for the user configuration
  directory: string | null; // where the CLI runs: the folder, else the engine's configuration directory once known
  name: string | null; // the page's name for its place ("Open a session in <place>", the custom sheet's "Add to")
  attached: AppSessionId | null; // the ready session MAWS runs on this Mac in exactly this folder, as picked
  session: PluginSession | null; // its plugin facts, once read
  inventory: ReturnType<typeof useCustomizationInventory>;
  askIn: AskIn;
  openDialog(dialog: MarketplaceDialog): void;
}

const PlaceContext = createContext<Place | null>(null);

export function usePlace(): Place {
  const place = useContext(PlaceContext);
  if (place === null) throw new Error('usePlace outside Customize’s page');
  return place;
}

/** The book a page's place keeps its operations in, found again by this name after its views have gone. */
export const bookOf = (cwd: string | null): string => `customize:${cwd ?? 'user'}`;

export function CustomizePlace({ cwd, name, attached, children }: { cwd: string | null; name: string | null; attached: AppSessionId | null; children: ReactNode }) {
  const book = bookOf(cwd);
  const env = usePluginsEnv();
  const { reread } = env;
  const directory = cwd ?? env.data?.configHome ?? null;
  const readySessions = useSessions((s) => readyCount(s.engine));
  const [read, setRead] = useState<PluginSession | null>(null);
  const session = read !== null && read.appSessionId === attached ? read : null;
  const inventory = useCustomizationInventory(cwd);
  const { refetch } = inventory;
  const retryServers = useCallback(() => void refetch(), [refetch]);
  const resolveEngine = useCallback(async () => resolutionOf(await reread()), [reread]);
  const plugins = useManageState({ cwd: directory ?? '', readySessions, keep: book }, session?.reloads?.reloadMods ?? null, resolveEngine);
  const connectors = useConnectorManage(cwd, name, configuredOf(inventory), retryServers, book);
  const [dialog, setDialog] = usePlaceHeld<MarketplaceDialog>(book);
  const pluginManage = plugins.manage;
  const connectorAsk = connectors.manage.ask;
  const manage = useMemo<Manage>(
    () => ({ cwd: pluginManage.cwd, ops: pluginManage.ops, reloadMods: pluginManage.reloadMods, ask: (key, request) => (isMcpAction(request.action) ? connectorAsk(key, request) : pluginManage.ask(key, request)) }),
    [pluginManage, connectorAsk],
  );
  const place = useMemo<Place>(() => ({ cwd, directory, name, attached, session, inventory, askIn: connectors.askIn, openDialog: setDialog }), [cwd, directory, name, attached, session, inventory, connectors.askIn, setDialog]);
  return (
    <PlaceContext.Provider value={place}>
      <ManageProvider value={manage}>
        {attached !== null && <ReadySession key={attached} appSessionId={attached} onChange={setRead} />}
        {children}
        {dialog === 'manage' && directory !== null && <Marketplaces directory={directory} onClose={() => setDialog(null)} />}
        {dialog === 'add' && <AddMarketplaceDialog onClose={() => setDialog(null)} />}
        {plugins.sheet}
        {connectors.sheet}
      </ManageProvider>
    </PlaceContext.Provider>
  );
}

// Manage marketplaces over the place's listings (the plugin body's reads, shared by their keys).
function Marketplaces({ directory, onClose }: { directory: string; onClose(): void }) {
  const marketplaces = usePluginsRead('marketplaces.list', directory);
  const installed = usePluginsRead('plugins.list', directory);
  return <ManageMarketplaces marketplaces={marketplaces} installed={installed.data?.plugins ?? []} onClose={onClose} />;
}
