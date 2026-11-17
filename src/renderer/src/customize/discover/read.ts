// Discover's reads (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M3 Decisions: Discover reads only
// `catalog.*`, always with the Customize page's cwd, null for the user configuration). The home, a query's pages, one
// item, the sources' states and an icon are cached queries; `catalog.changed` (a refresh that changed the network data,
// or the engine's reads invalidated by an install, a marketplace change or an outside edit) reads every one of them
// again, and a query starts again from its first page, since its cursors belong to the catalog revision they came from.
// A page that answers `restarted` (its cursor's revision has gone) starts its query again the same way.
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CommandInput, CommandName, CommandOutput, InvokeRest, MawsBridge } from '@shared/ipc/schema';
import type { CatalogPage, CatalogQueryInput, CatalogSourceStatus, CatalogTab } from '@shared/ipc/schema/catalog';
import type { Marketplace } from '@shared/ipc/schema/marketplaces';
import { ipc } from '../../ipc/client';
import { IpcCommandError, queryClient } from '../../ipc/query';

const ROOT = ['maws', 'catalog'] as const;
// P5 O6 M4: Discover is this machine's, its directory one of this machine's, until the catalog spans machines (O4).
const LOCAL = () => ({ machine: ipc.localMachine });

async function invoke<N extends CommandName>(name: N, input: CommandInput<N>, ...opts: InvokeRest<N>): Promise<CommandOutput<N>> {
  const answer = await ipc.invoke(name, input, ...opts);
  if (!answer.ok) throw new IpcCommandError(answer.error);
  return answer.value;
}

// An icon main could not answer (null) is asked again after this, so main's own retry (5 min) reaches an open window;
// an icon it answered, after a day, as main refreshes the directory bucket's icons.
const ICON_MISS_MS = 5 * 60_000;
const ICON_HIT_MS = 24 * 60 * 60_000;

/** Every catalog read again, each query from its first page: shown reads at once, the others when next shown. */
export function catalogChanged(client: QueryClient = queryClient): void {
  void client.resetQueries({ queryKey: [...ROOT, 'query'] });
  void client.invalidateQueries({ queryKey: [...ROOT, 'home'] });
  void client.invalidateQueries({ queryKey: [...ROOT, 'item'] });
  void client.invalidateQueries({ queryKey: [...ROOT, 'sources'] });
  void client.invalidateQueries({ queryKey: [...ROOT, 'postures'] });
  void client.invalidateQueries({ queryKey: [...ROOT, 'pluginIcons'] });
  void client.invalidateQueries({ queryKey: [...ROOT, 'icon'], predicate: (query) => query.state.data === null }); // the misses
}

/** Hears `catalog.changed` for the window's life (App.tsx), so a change made while Discover is not shown (an uninstall in
 * My items, an outside edit) is read when it is shown again: never only while it is mounted. */
export function connectCatalogEvents(bridge: MawsBridge = ipc, client: QueryClient = queryClient): () => void {
  return bridge.on('catalog.changed', () => catalogChanged(client));
}

export const useCatalogHome = (tab: CatalogTab, cwd: string | null) =>
  useQuery<CommandOutput<'catalog.home'>, IpcCommandError>({ queryKey: [...ROOT, 'home', { tab, cwd }], queryFn: () => invoke('catalog.home', { tab, cwd }, LOCAL()), refetchOnWindowFocus: false, staleTime: Infinity });

export const useCatalogItem = (id: string | null, cwd: string | null) =>
  useQuery<CommandOutput<'catalog.item'>, IpcCommandError>({ queryKey: [...ROOT, 'item', { id, cwd }], queryFn: () => invoke('catalog.item', { id: id!, cwd }, LOCAL()), enabled: id !== null, refetchOnWindowFocus: false, staleTime: Infinity });

/** A query's pages, the next one asked by `more()`; a page whose cursor's revision has gone starts the query again. */
export function useCatalogQuery(input: Omit<CatalogQueryInput, 'cursor'>) {
  const client = useQueryClient();
  const queryKey = [...ROOT, 'query', input] as const;
  const query = useInfiniteQuery<CatalogPage, IpcCommandError, InfiniteData<CatalogPage, string | null>, typeof queryKey, string | null>({
    queryKey,
    queryFn: ({ pageParam }) => invoke('catalog.query', { ...input, cursor: pageParam }, LOCAL()),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const inputKey = JSON.stringify(input);
  const [restartedFor, setRestartedFor] = useState<string | null>(null); // the input whose list started again
  const pages = query.data?.pages;
  const stale = pages?.some((page) => page.restarted) ?? false;
  useEffect(() => {
    if (!stale) return;
    void client.resetQueries({ queryKey }).then(() => setRestartedFor(inputKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the input's, compared by value
  }, [stale, client, inputKey]);
  const items = pages && !stale ? pages.flatMap((page) => page.items) : undefined;
  return { query, items, total: pages?.[0]?.total ?? null, restarted: restartedFor === inputKey, more: query.fetchNextPage };
}

export const useCatalogSources = () =>
  useQuery<CatalogSourceStatus[], IpcCommandError>({ queryKey: [...ROOT, 'sources'], queryFn: () => invoke('catalog.sources', {}), refetchOnWindowFocus: false, staleTime: Infinity });

/** Refresh: every source fetched again (main serialises it), then the sources' states as it answered them. */
export function useCatalogRefresh(): { refresh(): void; running: boolean } {
  const client = useQueryClient();
  const [running, setRunning] = useState(false);
  const refresh = useCallback(() => {
    setRunning(true);
    void invoke('catalog.refresh', {})
      .then((statuses) => {
        client.setQueryData([...ROOT, 'sources'], statuses);
        void client.invalidateQueries({ queryKey: [...ROOT, 'icon'] }); // every icon asked again: main answers from its cache, a miss retried
      })
      .catch(() => client.invalidateQueries({ queryKey: [...ROOT, 'sources'] }))
      .finally(() => setRunning(false));
  }, [client]);
  return { refresh, running };
}

/** An item's icon as data from main (null: its letter tile). A miss stays fresh for five minutes, an icon for a day; Refresh and
 * `catalog.changed` ask the misses again. */
export const useCatalogIcon = (url: string | null) =>
  useQuery<string | null, IpcCommandError>({
    queryKey: [...ROOT, 'icon', url],
    queryFn: async () => (await invoke('catalog.icon', { url: url! })).dataUrl,
    enabled: url !== null,
    staleTime: (query) => (query.state.data === null ? ICON_MISS_MS : ICON_HIT_MS),
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });

const NO_ICONS: ReadonlyMap<string, string | null> = new Map();
const ICON_IDS_MAX = 512; // the command's bound: a row past it keeps its tile

/** UX wave U11c M1 (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §C): the directory's icon URL of each
 * installed plugin a list draws, by its id, in one read for the list (main's `catalog.pluginIcons`, from the directory
 * copy it holds: it asks the network nothing and reads no catalog of the engine). Each plugin is asked with its
 * marketplace's locator as the engine lists it (`marketplaces`, the list's own read), so that main hands a seed's icon
 * only to a plugin of the seed's own repository; asked once that list has answered. Empty while it is out or failed, so
 * every row keeps its tile; read again on `catalog.changed`. */
export function usePluginIcons(plugins: readonly { id: string; marketplace: string }[], marketplaces: readonly Marketplace[] | undefined): ReadonlyMap<string, string | null> {
  const asked = useMemo(() => {
    if (marketplaces === undefined) return [];
    const locators = new Map(marketplaces.map((m) => [m.name, m.locator]));
    const byId = new Map(plugins.map((p) => [p.id, locators.get(p.marketplace) ?? null]));
    return [...byId.keys()].sort().slice(0, ICON_IDS_MAX).map((id) => ({ id, marketplaceLocator: byId.get(id)! }));
  }, [plugins, marketplaces]);
  const read = useQuery<CommandOutput<'catalog.pluginIcons'>, IpcCommandError>({
    queryKey: [...ROOT, 'pluginIcons', asked],
    queryFn: () => invoke('catalog.pluginIcons', { plugins: asked }, LOCAL()),
    enabled: asked.length > 0,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const icons = read.data?.icons;
  return useMemo(() => (icons ? new Map(icons.map(({ id, iconUrl }) => [id, iconUrl])) : NO_ICONS), [icons]);
}

/** P4-AGG M4: each configured server's sign-in posture, by the directory record its endpoint matches, and its
 * configuration's fingerprint (main's `catalog.postures`, from the directory copy it holds: My items never reaches the
 * network to show its list). Read again with every read of what is configured (`readAt`: an endpoint can change under
 * the same name and scope), and on `catalog.changed`. UX wave U11h: also a plugin's connector's, so read where the
 * folder holds a configured server or a plugin's connector. */
export const useCatalogPostures = (cwd: string | null, configured: { servers: readonly unknown[]; pluginServers?: readonly unknown[] } | undefined, readAt: number) =>
  useQuery<CommandOutput<'catalog.postures'>, IpcCommandError>({
    queryKey: [...ROOT, 'postures', { cwd, readAt }],
    queryFn: () => invoke('catalog.postures', { cwd }, LOCAL()),
    enabled: configured !== undefined && (configured.servers.length > 0 || (configured.pluginServers?.length ?? 0) > 0),
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
