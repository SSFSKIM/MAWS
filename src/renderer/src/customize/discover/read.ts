// Discover's reads (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M3 Decisions: Discover reads only
// `catalog.*`, always with the Customize page's cwd, null for the user configuration). The home, a query's pages, one
// item, the sources' states and an icon are cached queries; `catalog.changed` (a refresh that changed the network data,
// or the engine's reads invalidated by an install, a marketplace change or an outside edit) reads every one of them
// again, and a query starts again from its first page, since its cursors belong to the catalog revision they came from.
// A page that answers `restarted` (its cursor's revision has gone) starts its query again the same way.
import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { CommandInput, CommandName, CommandOutput } from '@shared/ipc/schema';
import type { CatalogPage, CatalogQueryInput, CatalogSourceStatus, CatalogTab } from '@shared/ipc/schema/catalog';
import { ipc } from '../../ipc/client';
import { IpcCommandError } from '../../ipc/query';

const ROOT = ['maws', 'catalog'] as const;

async function invoke<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> {
  const answer = await ipc.invoke(name, input);
  if (!answer.ok) throw new IpcCommandError(answer.error);
  return answer.value;
}

/** Hears `catalog.changed` once for the page: every catalog read again, each query from its first page. */
export function useCatalogChanges(): void {
  const client = useQueryClient();
  useEffect(
    () =>
      ipc.on('catalog.changed', () => {
        void client.resetQueries({ queryKey: [...ROOT, 'query'] });
        void client.invalidateQueries({ queryKey: [...ROOT, 'home'] });
        void client.invalidateQueries({ queryKey: [...ROOT, 'item'] });
        void client.invalidateQueries({ queryKey: [...ROOT, 'sources'] });
      }),
    [client],
  );
}

export const useCatalogHome = (tab: CatalogTab, cwd: string | null) =>
  useQuery<CommandOutput<'catalog.home'>, IpcCommandError>({ queryKey: [...ROOT, 'home', { tab, cwd }], queryFn: () => invoke('catalog.home', { tab, cwd }), refetchOnWindowFocus: false, staleTime: Infinity });

export const useCatalogItem = (id: string | null, cwd: string | null) =>
  useQuery<CommandOutput<'catalog.item'>, IpcCommandError>({ queryKey: [...ROOT, 'item', { id, cwd }], queryFn: () => invoke('catalog.item', { id: id!, cwd }), enabled: id !== null, refetchOnWindowFocus: false, staleTime: Infinity });

/** A query's pages, the next one asked by `more()`; a page whose cursor's revision has gone starts the query again. */
export function useCatalogQuery(input: Omit<CatalogQueryInput, 'cursor'>) {
  const client = useQueryClient();
  const queryKey = [...ROOT, 'query', input] as const;
  const query = useInfiniteQuery<CatalogPage, IpcCommandError, InfiniteData<CatalogPage, string | null>, typeof queryKey, string | null>({
    queryKey,
    queryFn: ({ pageParam }) => invoke('catalog.query', { ...input, cursor: pageParam }),
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
      .then((statuses) => client.setQueryData([...ROOT, 'sources'], statuses))
      .catch(() => client.invalidateQueries({ queryKey: [...ROOT, 'sources'] }))
      .finally(() => setRunning(false));
  }, [client]);
  return { refresh, running };
}

/** A card's icon as data from main (null: a monogram), asked once per URL for the app run. */
export const useCatalogIcon = (url: string | null) =>
  useQuery<string | null, IpcCommandError>({ queryKey: [...ROOT, 'icon', url], queryFn: async () => (await invoke('catalog.icon', { url: url! })).dataUrl, enabled: url !== null, staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false });
