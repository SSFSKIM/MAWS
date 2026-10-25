// Discover's catalog in main (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M2): the network sources
// (store.ts), the engine's reads per cwd (engine-reads.ts) and the test sources joined into one list per cwd, served over
// `catalog.*`. The catalog is the person's: no engine tool, prompt or session context carries it.
// - `catalog.changed` fires once per refresh that changed anything and once per engine-read invalidation
//   (`plugins.changed`; a change the watch of the engine's plugin state sees, state-watch.ts; and Refresh, which reads
//   the engine again).
// - A cwd's built catalog is kept until the network data or the engine's reads move, under the revision of the reads it
//   was built from: a read that an invalidation overtook is read again, never kept under the newer revision.
import { dirname, join } from 'node:path';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { ipcError } from '@shared/ipc/errors';
import type { EventPayload } from '@shared/ipc/schema';
import { readMarketplaceManifest } from '../../engine-host/plugins/manifest';
import { CommandFailure, type registerMainHandler } from '../ipc/router';
import { EngineReads, type HostCall } from './engine-reads';
import { StateWatch, type PollFn, type WatchFn } from './state-watch';
import { catalogPages, iconGet, NETWORK_KEYS, type IconGet } from './fetch';
import { CatalogIcons } from './icons';
import { buildCatalog } from './join';
import { connectorRoute, type TestSourceData } from './normalize';
import { configurationFingerprint, posturesOf } from './postures';
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
  watch?: WatchFn; // the engine state watch's fs.watch (tests)
  poll?: PollFn; // and its file polls (tests)
  iconGet?: IconGet; // how icons are read (tests); by default the environment's (fetch.ts)
}

const READ_ATTEMPTS = 3; // a read overtaken by an invalidation this many times in a row answers what it has, uncached

export interface Catalog {
  /** One cwd's catalog now (null: the user configuration). */
  items(cwd: string | null): Promise<CatalogItem[]>;
  stop(): void;
}

export function startCatalog(deps: CatalogDeps): Catalog {
  const log = deps.log ?? ((line: string) => console.log(`[catalog] ${line}`));
  const store = new CatalogStore({ dir: join(deps.userData, 'catalog'), keys: NETWORK_KEYS, pages: catalogPages(deps.env, deps.userAgent), log });
  const reads = new EngineReads(deps.call, log);
  const icons = new CatalogIcons({ dir: join(deps.userData, 'catalog', 'icons'), get: deps.iconGet ?? iconGet(deps.env, deps.userAgent), log });
  const built = new Map<string, { revision: string; items: CatalogItem[] }>();
  let tests: Promise<TestSourceData[]> | null = null;
  const testData = () =>
    (tests ??= Promise.all(testSources(deps.env).map(async (source) => ({ source, manifest: await readMarketplaceManifest(dirname(dirname(source.manifestPath))) }))));

  const fingerprint = configurationFingerprint(); // M4: one key for main's life
  const changed = () => void deps.emit('catalog.changed', {});
  const offStore = store.onChange(changed);
  const offPlugins = deps.onPluginsChanged(() => {
    reads.invalidate();
    changed();
  });
  // an outside change to the engine's plugin state: the configuration's forgets every view, a project's its own
  const watch = new StateWatch({
    onChange: (scope, kind) => {
      if (kind === 'mcp') {
        void reads.recheckServers().then((moved) => moved && changed());
        return;
      }
      reads.invalidate(scope === 'all' ? undefined : scope);
      changed();
    },
    watch: deps.watch,
    poll: deps.poll,
    appSettings: join(deps.userData, 'settings.json'),
  });

  // One cwd's catalog and the revision it was built under: the store's revision, the engine reads' generation at the time
  // the view was asked for, and the serial of the read behind the view (a cwd whose view was evicted and read anew is
  // built anew, and its old cursors restart). A view an invalidation overtook while it was read is read again. Built
  // catalogs go with their views.
  async function catalogOf(cwd: string | null): Promise<{ revision: string; items: CatalogItem[] }> {
    await store.ready();
    const key = cwd ?? '';
    for (let attempt = 1; ; attempt += 1) {
      const generation = reads.generation;
      const snapshot = reads.snapshot(cwd);
      const [engine, test] = await Promise.all([snapshot.view, testData()]);
      const current = generation === reads.generation;
      if (!current && attempt < READ_ATTEMPTS) continue;
      watch.sync(reads.places());
      for (const held of built.keys()) if (!reads.holds(held === '' ? null : held)) built.delete(held);
      const revision = `${store.revision}.${generation}.${snapshot.serial}`; // the store's data is read now, synchronously, under this revision
      const kept = built.get(key);
      if (kept?.revision === revision) return kept;
      const fresh = { revision, items: buildCatalog({ network: store.data(), engine, tests: test }) };
      if (current) built.set(key, fresh);
      return fresh;
    }
  }
  const items = async (cwd: string | null) => (await catalogOf(cwd)).items;

  deps.register('catalog.home', async ({ tab, cwd }) => homeOf(await items(cwd), tab));
  deps.register('catalog.query', async (input) => {
    const { revision, items: all } = await catalogOf(input.cwd);
    return queryOf(all, input, revision);
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
  deps.register('catalog.icon', async ({ url }) => ({ dataUrl: await icons.dataUrl(url) }));
  // M4: from the copy held (no fetch: a posture is not worth a network read), against the configured servers' endpoints
  deps.register('catalog.postures', async ({ cwd }) => {
    await store.loaded();
    const endpoints = await deps.call('customization.serverEndpoints', { cwd });
    if (!endpoints.ok) throw new CommandFailure(endpoints.error);
    const routes = (store.data().servers ?? []).flatMap((server) => connectorRoute(server) ?? []);
    return { servers: posturesOf(endpoints.value.servers, routes, fingerprint) };
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
      watch.close();
      store.stop();
    },
  };
}
