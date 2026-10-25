// Discover's catalog in main (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M2): the network sources
// (store.ts), the engine's reads per cwd (engine-reads.ts) and the test sources joined into one list per cwd, served over
// `catalog.*`. The catalog is the person's: no engine tool, prompt or session context carries it.
// - `catalog.changed` fires once per refresh that changed anything and once per engine-read invalidation
//   (`plugins.changed`, and Refresh, which reads the engine again).
// - A cwd's built catalog is kept until the network data or the engine's reads move.
import { dirname, join } from 'node:path';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { ipcError } from '@shared/ipc/errors';
import type { EventPayload } from '@shared/ipc/schema';
import { readMarketplaceManifest } from '../../engine-host/plugins/manifest';
import { CommandFailure, type registerMainHandler } from '../ipc/router';
import { EngineReads, type HostCall } from './engine-reads';
import { catalogPages, NETWORK_KEYS } from './fetch';
import { buildCatalog } from './join';
import type { TestSourceData } from './normalize';
import { homeOf, queryOf } from './query';
import { testSources } from './sources';
import { CatalogStore } from './store';

export interface CatalogDeps {
  register: typeof registerMainHandler;
  emit(name: 'catalog.changed', payload: EventPayload<'catalog.changed'>): unknown;
  call: HostCall; // the engine host's commands
  onPluginsChanged(listener: () => void): () => void; // the host's `plugins.changed`
  userData: string;
  env: Record<string, string | undefined>;
  userAgent: string; // MAWS and its version
  log?: (line: string) => void;
}

export interface Catalog {
  /** One cwd's catalog now (null: the user configuration). */
  items(cwd: string | null): Promise<CatalogItem[]>;
  stop(): void;
}

export function startCatalog(deps: CatalogDeps): Catalog {
  const log = deps.log ?? ((line: string) => console.log(`[catalog] ${line}`));
  const store = new CatalogStore({ dir: join(deps.userData, 'catalog'), keys: NETWORK_KEYS, pages: catalogPages(deps.env, deps.userAgent), log });
  const reads = new EngineReads(deps.call, log);
  const built = new Map<string, { revision: string; items: CatalogItem[] }>();
  const revision = () => `${store.revision}.${reads.generation}`;
  let tests: Promise<TestSourceData[]> | null = null;
  const testData = () =>
    (tests ??= Promise.all(testSources(deps.env).map(async (source) => ({ source, manifest: await readMarketplaceManifest(dirname(dirname(source.manifestPath))) }))));

  async function items(cwd: string | null): Promise<CatalogItem[]> {
    await store.ready();
    const [engine, test] = await Promise.all([reads.view(cwd), testData()]);
    const key = cwd ?? '';
    const now = revision();
    const kept = built.get(key);
    if (kept?.revision === now) return kept.items;
    const fresh = buildCatalog({ network: store.data(), engine, tests: test });
    built.set(key, { revision: now, items: fresh });
    return fresh;
  }

  const changed = () => void deps.emit('catalog.changed', {});
  const offStore = store.onChange(changed);
  const offPlugins = deps.onPluginsChanged(() => {
    reads.invalidate();
    changed();
  });

  deps.register('catalog.home', async ({ tab, cwd }) => homeOf(await items(cwd), tab));
  deps.register('catalog.query', async (input) => {
    const all = await items(input.cwd);
    return queryOf(all, input, revision());
  });
  deps.register('catalog.item', async ({ id, cwd }) => {
    const item = (await items(cwd)).find((i) => i.id === id);
    if (!item) throw new CommandFailure(ipcError('invalid_input', `the catalog has no item ${id}`));
    return item;
  });
  deps.register('catalog.refresh', async () => {
    reads.invalidate();
    const before = store.revision;
    const statuses = await store.refresh();
    if (store.revision === before) changed(); // the engine's reads moved; a network change has already said so
    return statuses;
  });
  deps.register('catalog.sources', async () => {
    await store.loaded();
    return store.statuses();
  });

  return {
    items,
    stop() {
      offStore();
      offPlugins();
    },
  };
}
