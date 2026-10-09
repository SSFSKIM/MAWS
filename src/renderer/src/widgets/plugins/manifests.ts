// The renderer's side of `plugins.manifest` (P2-B execution document §5.5): what each listed plugin says about itself
// and what it contains, read by the host from the files its own last listings name. The request derives from the
// `plugins.list` answer the caller holds (never from `plugins.changed`, which can arrive before the host listed again):
// asked when the list first renders and again whenever a new answer changes what is asked. A `read` view is kept for the
// app run (per query client) under its cwd, its key and the installation's `lastUpdated`, so an update reads it again;
// an `unknown`, `missing` or `partial` view is never kept. A harness mounting widgets passively issues no request.
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useMemo, useState } from 'react';
import type { ManifestItemRef, PluginManifestView } from '@shared/ipc/schema/plugins';
import { ipc } from '../../ipc/client';
import { WidgetReadPolicyContext } from '../read';
import { manifestKeyOf } from './library';

// An item as the caller names it: the ref the host admits, and the installation's `lastUpdated` that versions its view.
export type ManifestRequest = ManifestItemRef & { lastUpdated?: string | null };

const BATCH = 256; // the command's bound
const kept = new WeakMap<QueryClient, Map<string, PluginManifestView>>();
const keptBy = (client: QueryClient) => {
  let views = kept.get(client);
  if (!views) kept.set(client, (views = new Map()));
  return views;
};
const keepKey = (cwd: string, item: ManifestRequest) => `${cwd}\n${manifestKeyOf(item)}\n${item.lastUpdated ?? ''}`;
const refOf = (item: ManifestRequest): ManifestItemRef => (item.kind === 'installation' ? { kind: 'installation', id: item.id, scope: item.scope, projectPath: item.projectPath } : { kind: 'available', pluginId: item.pluginId });

export function usePluginManifests(cwd: string | null, items: readonly ManifestRequest[]): { views: ReadonlyMap<string, PluginManifestView>; loading: boolean } {
  const active = useContext(WidgetReadPolicyContext).mode === 'active';
  const client = useQueryClient();
  // the views not kept, and the request they answered (which also says the kept views gained its answers)
  const [answer, setAnswer] = useState<{ signature: string; unkept: ReadonlyMap<string, PluginManifestView> }>({ signature: '', unkept: new Map() });
  // the request as data: a new listing that asks for the same items is the same request
  const signature = JSON.stringify([cwd, items]);
  const asked = useMemo(() => (JSON.parse(signature) as [string | null, ManifestRequest[]])[1], [signature]);

  useEffect(() => {
    if (!active || cwd === null) return;
    const views = keptBy(client);
    const wanted = asked.filter((item) => !views.has(keepKey(cwd, item)));
    if (wanted.length === 0) return;
    let live = true;
    void (async () => {
      const fresh = new Map<string, PluginManifestView>();
      for (let at = 0; at < wanted.length; at += BATCH) {
        const batch = wanted.slice(at, at + BATCH);
        const result = await ipc.invoke('plugins.manifest', { cwd, items: batch.map(refOf) });
        if (!result.ok) continue; // a refused read leaves the rows to the listing's own words
        for (const view of result.value.manifests) {
          const key = manifestKeyOf(view.key);
          const item = batch.find((candidate) => manifestKeyOf(candidate) === key);
          if (item && view.state === 'read' && !view.partial) views.set(keepKey(cwd, item), view);
          else fresh.set(key, view);
        }
      }
      if (live) setAnswer({ signature, unkept: fresh });
    })();
    return () => {
      live = false;
    };
  }, [active, client, cwd, asked, signature]);

  const views = useMemo(() => {
    const out = new Map<string, PluginManifestView>();
    if (cwd === null) return out;
    const keptViews = keptBy(client);
    for (const item of asked) {
      const key = manifestKeyOf(item);
      const view = keptViews.get(keepKey(cwd, item)) ?? answer.unkept.get(key);
      if (view) out.set(key, view);
    }
    return out;
  }, [client, cwd, asked, answer]); // `answer` also says when the kept views gained one
  const loading = active && cwd !== null && answer.signature !== signature && asked.some((item) => !views.has(manifestKeyOf(item)));
  return { views, loading };
}
