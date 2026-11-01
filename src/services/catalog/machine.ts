// Discover's catalog, the machine's half (P5 O4 M3, docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §C;
// D16, D25): the engine's reads per cwd (./engine-reads.ts) and the watch over the engine's plugin state
// (./state-watch.ts), composed with the spine, so they load, settle and stop with it wherever it runs. The person's half
// (the network sources, their cache, the icons and the join: src/main/catalog/) asks `catalog.engine {cwd}` for one cwd's
// view and keeps what it built under the view's generation and serial; `catalog.engineChanged` tells it a view it holds
// may be stale.
// - `catalog.engine` answers the view held for the cwd, else reads it, with the generation of the reads when it was asked
//   for and the serial of the read behind it, then watches what the reads name.
// - An invalidation moves the generation and emits one `catalog.engineChanged`: `plugins.changed` (every plugin and
//   marketplace mutation, and each time the host connects) and `catalog.engineRefresh` forget every view (`all`); the
//   watch forgets every view for the configuration's files, a project's own for its settings (`cwd`), and for an MCP file
//   only the views whose configured servers moved (`all`, when any did).
// Nothing here is written to disk, so it composes in a run refused the spine too.
import type { ServicesBus } from '@shared/spine/bus';
import type { SpineHosts } from '../spine-root';
import { EngineReads, type HostCall } from './engine-reads';
import { StateWatch, type PollFn, type WatchFn } from './state-watch';

export interface CatalogMachineDeps {
  hosts: Pick<SpineHosts, 'dispatch' | 'onEvent'>; // the engine host's reads and its `plugins.changed`
  bus: Pick<ServicesBus, 'register' | 'emit'>;
  machineSettings: string; // settingsPaths(profile).machine: MAWS's own MCP servers, which the engine is given (P5 O3-A)
  log?: (line: string) => void;
  watch?: WatchFn; // the state watch's fs.watch (tests)
  poll?: PollFn; // and its file polls (tests)
}

export function startCatalogMachine(deps: CatalogMachineDeps): { stop(): void } {
  const log = deps.log ?? ((line: string) => console.log(`[catalog] ${line}`));
  const call: HostCall = (name, input) => deps.hosts.dispatch('engine-host', name, input) as never;
  const reads = new EngineReads(call, log);
  let stopped = false;

  const changed = (scope: string | null) => {
    if (stopped) return;
    deps.bus.emit('catalog.engineChanged', scope === null ? { scope: 'all' } : { scope: 'cwd', cwd: scope });
  };
  const offPlugins = deps.hosts.onEvent('plugins.changed', () => {
    reads.invalidate();
    changed(null);
  });
  // an outside change to the engine's plugin state: the configuration's forgets every view, a project's its own
  const watch = new StateWatch({
    onChange: (scope, kind) => {
      if (kind === 'mcp') {
        void reads.recheckServers().then((moved) => moved && changed(null));
        return;
      }
      reads.invalidate(scope === 'all' ? undefined : scope);
      changed(scope === 'all' ? null : scope);
    },
    watch: deps.watch,
    poll: deps.poll,
    appSettings: deps.machineSettings,
  });

  deps.bus.register('catalog.engine', async ({ cwd }) => {
    const generation = reads.generation;
    const snapshot = reads.snapshot(cwd);
    const view = await snapshot.view;
    if (!stopped) watch.sync(reads.places()); // a read answered after the stop starts no watch
    return { generation, serial: snapshot.serial, view };
  });
  deps.bus.register('catalog.engineRefresh', () => {
    reads.invalidate();
    changed(null);
    return { ok: true as const };
  });

  return {
    stop() {
      stopped = true;
      offPlugins();
      watch.close();
    },
  };
}
