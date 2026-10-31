// Discover's catalog in main (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, M2): the network sources
// (store.ts), the engine's reads per cwd and the test sources joined into one list per cwd, served over `catalog.*`. The
// catalog is the person's: no engine tool, prompt or session context carries it.
// P5 O4 M3 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §C; D16, D25): the catalog splits by the
// fact's owner. The engine's reads and the watch of the engine's plugin state are the machine's (src/services/catalog/,
// composed with the spine: `mawsd` on the daemon shape, main's embedded root on the other); this half, the person's,
// keeps the network sources, their cache under `<userData>/catalog/`, the icons and the join, and asks the machine
// `catalog.engine {cwd}` for a cwd's view.
// - `catalog.changed` fires once per refresh that changed anything and once per engine-read invalidation (each
//   `catalog.engineChanged` the machine emits: `plugins.changed`, a change its watch sees, and Refresh, which forgets
//   its reads through `catalog.engineRefresh`).
// - A cwd's built catalog is kept until the network data or the engine's reads move, under the revision of the reads it
//   was built from (the store's, and the generation and serial the machine answered): a read that an invalidation
//   overtook (a `catalog.engineChanged` heard while it was asked) is read again, never kept under the newer revision.
import { dirname, join } from 'node:path';
import type { CatalogItem } from '@shared/ipc/schema/catalog';
import { ipcError } from '@shared/ipc/errors';
import type { CommandInput, CommandName, CommandResult, EventPayload } from '@shared/ipc/schema';
import { readMarketplaceManifest } from '../../engine-host/plugins/manifest';
import { CommandFailure, type registerMainHandler } from '../ipc/router';
import { catalogPages, iconGet, NETWORK_KEYS, type IconGet } from './fetch';
import { CatalogIcons } from './icons';
import { buildCatalog } from './join';
import { connectorRoute, engineViewFromWire, type EngineView, type TestSourceData } from './normalize';
import { configurationFingerprint, posturesOf } from './postures';
import { homeOf, queryOf } from './query';
import { testSources } from './sources';
import { CatalogStore } from './store';

type Call<N extends CommandName> = (name: N, input: CommandInput<N>) => Promise<CommandResult<N>>;

export interface CatalogDeps {
  register: typeof registerMainHandler;
  emit(name: 'catalog.changed', payload: EventPayload<'catalog.changed'>): unknown;
  call: Call<'customization.serverEndpoints'>; // the engine host's configured servers, for the postures
  invoke: <N extends 'catalog.engine' | 'catalog.engineRefresh'>(name: N, input: CommandInput<N>) => Promise<CommandResult<N>>; // the machine's half, as main asks it
  onEngineChanged(listener: (payload: EventPayload<'catalog.engineChanged'>) => void): () => void; // the machine's `catalog.engineChanged`
  userData: string;
  env: Record<string, string | undefined>;
  userAgent: string; // MAWS and its version
  log?: (line: string) => void;
  iconGet?: IconGet; // how icons are read (tests); by default the environment's (fetch.ts)
}

const READ_ATTEMPTS = 3; // a read overtaken by an invalidation this many times in a row answers what it has, uncached
const KEPT_CATALOGS = 16; // the built catalogs held, the most recently asked last: as many as the machine holds views

export interface Catalog {
  /** One cwd's catalog now (null: the user configuration). */
  items(cwd: string | null): Promise<CatalogItem[]>;
  stop(): void;
}

export function startCatalog(deps: CatalogDeps): Catalog {
  const log = deps.log ?? ((line: string) => console.log(`[catalog] ${line}`));
  const store = new CatalogStore({ dir: join(deps.userData, 'catalog'), keys: NETWORK_KEYS, pages: catalogPages(deps.env, deps.userAgent), log });
  const icons = new CatalogIcons({ dir: join(deps.userData, 'catalog', 'icons'), get: deps.iconGet ?? iconGet(deps.env, deps.userAgent), log });
  const built = new Map<string, { revision: string; items: CatalogItem[] }>();
  let tests: Promise<TestSourceData[]> | null = null;
  const testData = () =>
    (tests ??= Promise.all(testSources(deps.env).map(async (source) => ({ source, manifest: await readMarketplaceManifest(dirname(dirname(source.manifestPath))) }))));

  const fingerprint = configurationFingerprint(); // M4: one key for main's life
  const changed = () => void deps.emit('catalog.changed', {});
  const offStore = store.onChange(changed);
  // The machine's reads moved: a catalog built from a view it forgot goes (every one, or the project's), and a read in
  // flight is read again (`heard`)
  let heard = 0;
  const offEngine = deps.onEngineChanged((change) => {
    heard += 1;
    if (change.scope === 'all') built.clear();
    else built.delete(change.cwd);
    changed();
  });

  // One cwd's engine view as the machine answers it, with the revision part it was read under; null when the machine
  // could not be asked (its spine refused, its daemon unreachable), which the catalog shows as an engine that could not
  // be read: the network's items stand.
  async function engineOf(cwd: string | null): Promise<{ view: EngineView | null; read: string } | null> {
    const answer = await deps.invoke('catalog.engine', { cwd }).catch((error: unknown) => ({ ok: false as const, error: ipcError('internal', error instanceof Error ? error.message : String(error)) }));
    if (!answer.ok) {
      log(`catalog.engine failed: ${answer.error.message}`);
      return null;
    }
    return { view: engineViewFromWire(answer.value.view), read: `${answer.value.generation}.${answer.value.serial}` };
  }

  // One cwd's catalog and the revision it was built under: the store's revision, the generation of the machine's reads
  // at the time the view was asked for, and the serial of the read behind the view (a cwd whose view was evicted and read
  // anew is built anew, and its old cursors restart). A view an invalidation overtook while it was read is read again.
  async function catalogOf(cwd: string | null): Promise<{ revision: string; items: CatalogItem[] }> {
    await store.ready();
    const key = cwd ?? '';
    for (let attempt = 1; ; attempt += 1) {
      const before = heard;
      const [engine, test] = await Promise.all([engineOf(cwd), testData()]);
      const current = engine !== null && before === heard;
      if (engine !== null && !current && attempt < READ_ATTEMPTS) continue;
      const revision = `${store.revision}.${engine?.read ?? 'unread'}`; // the store's data is read now, synchronously, under this revision
      const kept = built.get(key);
      if (kept?.revision === revision) {
        built.delete(key); // the most recently asked last
        built.set(key, kept);
        return kept;
      }
      const fresh = { revision, items: buildCatalog({ network: store.data(), engine: engine?.view ?? null, tests: test }) };
      if (current) {
        built.delete(key);
        built.set(key, fresh);
        for (const oldest of built.keys()) {
          if (built.size <= KEPT_CATALOGS) break;
          built.delete(oldest);
        }
      }
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
  // The machine's reads forgotten (its `catalog.engineChanged` says catalog.changed), then the network read again (a
  // change there says it too); a machine that cannot be asked leaves the network's refresh to go on
  deps.register('catalog.refresh', async () => {
    const refreshed = await deps.invoke('catalog.engineRefresh', undefined).catch((error: unknown) => ({ ok: false as const, error: ipcError('internal', error instanceof Error ? error.message : String(error)) }));
    if (!refreshed.ok) log(`catalog.engineRefresh failed: ${refreshed.error.message}`);
    return store.refresh();
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
      offEngine();
      store.stop();
    },
  };
}
