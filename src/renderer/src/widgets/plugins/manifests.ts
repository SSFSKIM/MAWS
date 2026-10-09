// The renderer's side of `plugins.manifest` (P2-B execution document §5.5): what each listed plugin says about itself
// and what it contains, read by the host from the files its own last listings name. The request derives from the
// `plugins.list` answer the caller holds (never from `plugins.changed`, which can arrive before the host listed again):
// asked when the list first renders and again whenever a new answer changes what is asked. A `read` view is kept (per
// query client) under its cwd, its key and the installation's `lastUpdated`, so an update reads it again, and for the
// marketplace listing it was read under: a view carries its marketplace's entry (`marketplaceVersion`, the overlay),
// which a marketplace's add, update or removal changes without moving `lastUpdated`, so each new `marketplaces.list`
// answer for the cwd (the one the host now reads under) reads the kept views again, drawing the kept ones meanwhile;
// none is asked while that listing's first answer is on its way. An `unknown`, `missing` or `partial` view is never
// kept. A read the host refuses, or whose call fails, settles with its words and `retry`, nonfatal: the caller keeps
// its rows, and nothing of the failure is kept, so a retry or the next open asks again. A harness mounting widgets
// passively issues no request.
import { skipToken, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { CommandOutput } from '@shared/ipc/schema';
import type { ManifestItemRef, PluginManifestView } from '@shared/ipc/schema/plugins';
import { ipc } from '../../ipc/client';
import { WidgetReadPolicyContext } from '../read';
import { manifestKeyOf } from './library';
import { pluginsReadKey } from './read';

// An item as the caller names it: the ref the host admits, and the installation's `lastUpdated` that versions its view.
export type ManifestRequest = ManifestItemRef & { lastUpdated?: string | null };

const BATCH = 256; // the command's bound
// a kept view and the marketplace listing it was read under (that answer's time; 0 when none was held)
type Kept = { listedAt: number; view: PluginManifestView };
const kept = new WeakMap<QueryClient, Map<string, Kept>>();
const keptBy = (client: QueryClient) => {
  let views = kept.get(client);
  if (!views) kept.set(client, (views = new Map()));
  return views;
};
const keepKey = (cwd: string, item: ManifestRequest) => `${cwd}\n${manifestKeyOf(item)}\n${item.lastUpdated ?? ''}`;
const refOf = (item: ManifestRequest): ManifestItemRef => (item.kind === 'installation' ? { kind: 'installation', id: item.id, scope: item.scope, projectPath: item.projectPath } : { kind: 'available', pluginId: item.pluginId });

export interface PluginManifests {
  views: ReadonlyMap<string, PluginManifestView>;
  loading: boolean;
  error: string | null; // the last attempt's refusal, in its words; the views it did get are kept as usual
  retry(): void;
}

const wordsOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function usePluginManifests(cwd: string | null, items: readonly ManifestRequest[]): PluginManifests {
  const active = useContext(WidgetReadPolicyContext).mode === 'active';
  const client = useQueryClient();
  // the marketplace listing the caller's reads hold for the cwd, followed without ever being asked from here
  const listing = useQuery<CommandOutput<'marketplaces.list'>>({ queryKey: pluginsReadKey('marketplaces.list', cwd), queryFn: skipToken });
  const listedAt = listing.dataUpdatedAt;
  const listingStatus = listing.status; // read so that a first listing that fails also renders (and asks) again
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // the views not kept, the refusal, and the request, listing and attempt they answered (which also says the kept views
  // gained its answers)
  const [answer, setAnswer] = useState<{ signature: string; listedAt: number; attempt: number; unkept: ReadonlyMap<string, PluginManifestView>; error: string | null }>({ signature: '', listedAt: 0, attempt: 0, unkept: new Map(), error: null });
  // the request as data: a new listing that asks for the same items is the same request
  const signature = JSON.stringify([cwd, items]);
  const asked = useMemo(() => (JSON.parse(signature) as [string | null, ManifestRequest[]])[1], [signature]);

  useEffect(() => {
    if (!active || cwd === null) return;
    // the listing's first answer on its way (the caller's read started in its own effect, after this render)
    const due = client.getQueryState(pluginsReadKey('marketplaces.list', cwd));
    if (due?.status === 'pending' && due.fetchStatus === 'fetching') return;
    const views = keptBy(client);
    const wanted = asked.filter((item) => views.get(keepKey(cwd, item))?.listedAt !== listedAt);
    if (wanted.length === 0) return;
    let live = true;
    void (async () => {
      const fresh = new Map<string, PluginManifestView>();
      let error: string | null = null;
      for (let at = 0; at < wanted.length; at += BATCH) {
        const batch = wanted.slice(at, at + BATCH);
        // a call that fails (the bridge's promise rejected) is refused like a read the host refused
        const result = await ipc.invoke('plugins.manifest', { cwd, items: batch.map(refOf) }).catch((thrown: unknown) => ({ ok: false as const, error: { message: wordsOf(thrown) } }));
        if (!result.ok) {
          error = result.error.message; // the rows keep the listing's own words; the caller says the read failed
          continue;
        }
        for (const view of result.value.manifests) {
          const key = manifestKeyOf(view.key);
          const item = batch.find((candidate) => manifestKeyOf(candidate) === key);
          if (!item) continue;
          const slot = keepKey(cwd, item);
          const prior = views.get(slot);
          if (prior && prior.listedAt > listedAt) continue; // a read under a newer listing answered first
          if (view.state === 'read' && !view.partial) views.set(slot, { listedAt, view });
          else {
            views.delete(slot); // the latest read says what is drawn; it is not kept
            fresh.set(key, view);
          }
        }
      }
      if (live) setAnswer({ signature, listedAt, attempt, unkept: fresh, error });
    })();
    return () => {
      live = false;
    };
  }, [active, client, cwd, listingStatus, listedAt, asked, signature, attempt]);

  const views = useMemo(() => {
    const out = new Map<string, PluginManifestView>();
    if (cwd === null) return out;
    const keptViews = keptBy(client);
    for (const item of asked) {
      const key = manifestKeyOf(item);
      const view = keptViews.get(keepKey(cwd, item))?.view ?? answer.unkept.get(key);
      if (view) out.set(key, view);
    }
    return out;
  }, [client, cwd, asked, answer]); // `answer` also says when the kept views gained one
  const answered = answer.signature === signature && answer.listedAt === listedAt && answer.attempt === attempt;
  const loading = active && cwd !== null && !answered && asked.some((item) => !views.has(manifestKeyOf(item)));
  return { views, loading, error: answered ? answer.error : null, retry };
}
