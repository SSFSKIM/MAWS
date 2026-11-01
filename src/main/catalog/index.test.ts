// P4-AGG M2: the catalog service over `catalog.*` (the Discover spec, M2 Decisions): the engine's reads are held per cwd
// until `plugins.changed`, which also tells the renderer `catalog.changed` once; Refresh reads the engine again; a cwd of
// null reads the user configuration in the engine's configuration directory; an engine that cannot be read leaves the
// network's items; the test-source seam makes the local test marketplace discoverable; a read an invalidation overtakes
// is read again. P5 O4 M3 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, D16): the engine's reads and the watch
// are the machine's half (src/services/catalog/machine.ts, whose own suite holds the watch's cases); here the person's
// half is composed over the machine's on the services bus, as either root composes them, and over a machine it cannot
// ask.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineViewWire } from '@shared/catalog/engine-view';
import { decodeJsonLine, encodeJsonLine } from '@shared/host/json-bytes';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import { commands } from '@shared/ipc/schema';
import { NETWORK_FIXTURES, PROJECT_A, recordedEngine, SCRATCH, TEST_MARKETPLACE } from '../../../test/support/catalog-inputs';
import { fakeBus } from '../../../test/support/fake-bus';
import { startCatalogMachine } from '../../services/catalog/machine';
import type { PollFn, WatchFn } from '../../services/catalog/state-watch';
import { startCatalog, type CatalogDeps } from './index';
import { engineViewFromWire, type EngineView } from './normalize';

type HostCall = <N extends CommandName>(name: N, input: CommandInput<N>) => Promise<CommandResult<N>>;

let userData: string;
let stops: (() => void)[];
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-agg-service-'));
  stops = [];
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  rmSync(userData, { recursive: true, force: true });
});

const CONFIG_HOME = '/scratch-root/config';
let endpoints: CommandOutput<'customization.serverEndpoints'>['servers'] = [];
afterEach(() => { endpoints = []; });

// The engine host as the catalog asks it, answering from a recorded view; counts each command.
function host(view: (name: CommandName) => Promise<EngineView>, failing = false) {
  const asked: { name: string; input: unknown }[] = [];
  const call = (async (name: CommandName, input: unknown): Promise<CommandResult<CommandName>> => {
    asked.push({ name, input });
    if (failing) return { ok: false, error: { code: 'host_unavailable', message: 'the engine host is not running' } };
    const v = await view(name);
    const value = (() => {
      switch (name) {
        case 'plugins.env':
          return { binary: '/bin/claude', binaryError: null, configHome: CONFIG_HOME, globalConfig: `${CONFIG_HOME}/.claude.json` };
        case 'plugins.list':
          return { plugins: v.installed };
        case 'plugins.available':
          return { plugins: v.available };
        case 'marketplaces.list':
          return { marketplaces: v.marketplaces };
        case 'plugins.marketplaceManifest':
          return v.manifests.get((input as CommandInput<'plugins.marketplaceManifest'>).name) ?? { state: 'unknown', owner: null, plugins: [] };
        case 'customization.inventory':
          return { skills: [], servers: (v.servers ?? []).map((n) => ({ name: n, scope: 'user', path: '/x/.claude.json', transport: 'http' })), warnings: [], serversRead: true };
        case 'customization.serverEndpoints':
          return { servers: endpoints };
        case 'plugins.directoryProvenance':
          return { pluginsDir: `${CONFIG_HOME}/plugins`, entries: [...v.directoryInstalled].map(([name, repositoryKey]) => ({ name, repositoryKey })) };
        default:
          throw new Error(`unexpected ${name}`);
      }
    })();
    const checked = commands[name].output.safeParse(value); // the host's answers are the contract's shape
    if (!checked.success) throw new Error(`${name}: ${checked.error.message}`);
    return { ok: true, value: checked.data } as CommandResult<CommandName>;
  }) as HostCall;
  return { asked, call };
}

// The machine's watch, inert: its own suite drives it (src/services/catalog/machine.test.ts)
const inert: { watch: WatchFn; poll: PollFn } = { watch: () => ({ close: () => {}, on: () => undefined }), poll: () => ({ close: () => {} }) };

// The person's half over the machine's, on one services bus (`invoke` as main's own route, the machine's
// `catalog.engineChanged` heard as main taps it); `machine: false` composes a machine that cannot be asked.
function service(call: HostCall, env: Record<string, string> = {}, { machine = true } = {}) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const emitted: string[] = [];
  const changedListeners = new Set<() => void>();
  const bus = fakeBus();
  const part = machine
    ? startCatalogMachine({
        hosts: {
          dispatch: (_owner, name, input) => call(name as CommandName, input as never) as never,
          onEvent: ((_name: string, listener: () => void) => (changedListeners.add(listener), () => void changedListeners.delete(listener))) as never,
        },
        bus,
        machineSettings: join(userData, 'machine-settings.json'),
        log: () => {},
        ...inert,
      })
    : null;
  const unreachable: CatalogDeps['invoke'] = async () => ({ ok: false, error: { code: 'host_unavailable', message: 'the machine host is not running' } });
  const catalog = startCatalog({
    register: ((name: string, handler: (input: unknown) => Promise<unknown>) => handlers.set(name, handler)) as never,
    emit: (name) => emitted.push(name),
    call,
    invoke: machine ? (name, input) => bus.invoke(name, input) : unreachable,
    onEngineChanged: (listener) => bus.onEmitted('catalog.engineChanged', listener),
    userData,
    env: { MAWS_CATALOG_FIXTURES: NETWORK_FIXTURES, ...env },
    userAgent: 'MAWS/test',
    log: () => {},
  });
  const stop = () => (catalog.stop(), part?.stop());
  stops.push(stop);
  const invoke = <N extends CommandName>(name: N, input: CommandInput<N>) => handlers.get(name)!(input) as Promise<CommandOutput<N>>;
  return { invoke, emitted, catalog, stop, bus, pluginsChanged: () => changedListeners.forEach((l) => l()), handlers };
}

describe('the catalog service', () => {
  it('registers exactly the catalog commands but the machine’s', () => {
    const { handlers, bus } = service(host(() => recordedEngine(PROJECT_A)).call);
    expect([...handlers.keys()].sort()).toEqual(Object.keys(commands).filter((n) => n.startsWith('catalog.') && !bus.registered().includes(n as CommandName)).sort());
    expect(bus.registered().sort()).toEqual(['catalog.engine', 'catalog.engineRefresh']);
  });

  it('holds the engine’s reads per cwd until plugins.changed, then reads again and says catalog.changed once', async () => {
    const engine = host(() => recordedEngine(PROJECT_A));
    const { invoke, emitted, pluginsChanged } = service(engine.call);
    const home = await invoke('catalog.home', { tab: 'plugins', cwd: PROJECT_A });
    expect(home.featured?.name).toBe('frontend-design');
    await invoke('catalog.query', { tab: 'plugins', cwd: PROJECT_A, text: 'legal' });
    const lists = () => engine.asked.filter((a) => a.name === 'plugins.list').length;
    expect(lists()).toBe(1);
    expect(emitted).toEqual(['catalog.changed']); // the first fetch of the sources changed the catalog
    emitted.length = 0;
    expect(engine.asked.filter((a) => a.name === 'plugins.marketplaceManifest').map((a) => a.input)).toEqual([{ cwd: PROJECT_A, name: 'maws-discover-test' }, { cwd: PROJECT_A, name: 'maws-recorded-pins' }]);
    pluginsChanged();
    expect(emitted).toEqual(['catalog.changed']);
    await invoke('catalog.home', { tab: 'plugins', cwd: PROJECT_A });
    expect(lists()).toBe(2);
  });

  it('restarts a page whose cursor predates an invalidation', async () => {
    const { invoke, pluginsChanged } = service(host(() => recordedEngine(PROJECT_A)).call);
    const first = await invoke('catalog.query', { tab: 'plugins', cwd: PROJECT_A, limit: 10 });
    expect((await invoke('catalog.query', { tab: 'plugins', cwd: PROJECT_A, limit: 10, cursor: first.nextCursor })).restarted).toBe(false);
    pluginsChanged();
    expect(await invoke('catalog.query', { tab: 'plugins', cwd: PROJECT_A, limit: 10, cursor: first.nextCursor })).toMatchObject({ restarted: true, items: first.items });
  });

  it('reads the user configuration in the engine’s configuration directory', async () => {
    const engine = host(() => recordedEngine(CONFIG_HOME));
    const { invoke } = service(engine.call);
    await invoke('catalog.home', { tab: 'plugins', cwd: null });
    expect(engine.asked.find((a) => a.name === 'plugins.list')?.input).toEqual({ cwd: CONFIG_HOME });
    expect(engine.asked.find((a) => a.name === 'customization.inventory')?.input).toEqual({ cwd: null });
  });

  it('Refresh reads the network sources and the engine again, saying catalog.changed once', async () => {
    const engine = host(() => recordedEngine(PROJECT_A));
    const { invoke, emitted } = service(engine.call);
    await invoke('catalog.home', { tab: 'plugins', cwd: PROJECT_A });
    emitted.length = 0;
    const statuses = await invoke('catalog.refresh', {});
    expect(statuses).toHaveLength(15);
    expect(statuses.every((s) => s.state === 'fresh' && s.fetchedAt !== null)).toBe(true);
    expect(emitted).toEqual(['catalog.changed']); // the recordings did not change: the engine's reads did
    await invoke('catalog.home', { tab: 'plugins', cwd: PROJECT_A });
    expect(engine.asked.filter((a) => a.name === 'plugins.list')).toHaveLength(2);
  });

  it('answers the sources’ states, a missing recording unavailable and the rest standing', async () => {
    const fixtures = mkdtempSync(join(tmpdir(), 'maws-agg-partial-'));
    try {
      for (const key of ['seed:claude-plugins-official', 'directory:servers']) writeFileSync(join(fixtures, `${key}.json`), JSON.stringify((await import(join(NETWORK_FIXTURES, `${key}.json`), { with: { type: 'json' } })).default));
      const { invoke } = service(host(() => recordedEngine(PROJECT_A)).call, { MAWS_CATALOG_FIXTURES: fixtures });
      expect((await invoke('catalog.home', { tab: 'connectors', cwd: PROJECT_A })).total).toBe(10);
      const states = Object.fromEntries((await invoke('catalog.sources', {})).map((s) => [s.key, s.state]));
      expect(states).toMatchObject({ 'seed:claude-plugins-official': 'fresh', 'directory:servers': 'fresh', 'directory:plugins': 'unavailable', 'plugin-details': 'unavailable' });
    } finally {
      rmSync(fixtures, { recursive: true, force: true });
    }
  });

  it('with the engine host down, still answers the network’s items; an unknown id is refused', async () => {
    const { invoke } = service(host(() => recordedEngine(PROJECT_A), true).call);
    const page = await invoke('catalog.query', { tab: 'plugins', cwd: PROJECT_A, limit: 200 });
    expect(page.total).toBeGreaterThan(60);
    expect(page.items.find((i) => i.name === 'agentmail' || i.name === 'AgentMail')?.install).toMatchObject({ kind: 'manual', reason: 'Not installable by this engine: its listing could not be read' });
    await expect(invoke('catalog.item', { id: 'nothing', cwd: PROJECT_A })).rejects.toMatchObject({ error: { code: 'invalid_input' } });
  });

  // P5 O4 M3 (D25): the view crosses the socket as entry arrays, read back once per read into the join's Maps
  it('reads the machine’s view, as it crossed the socket, back into the Maps the join reads', async () => {
    const view = await recordedEngine(PROJECT_A, { directoryInstalled: new Map([['frontend-design', 'github.com/anthropics/claude-code#plugins/frontend-design']]) });
    const wire: EngineViewWire = { ...view, servers: view.servers && [...view.servers], manifests: [...view.manifests], directoryInstalled: [...view.directoryInstalled] };
    expect(engineViewFromWire(decodeJsonLine(encodeJsonLine(wire)) as EngineViewWire)).toEqual(view);
    expect(engineViewFromWire(null)).toBeNull();
  });

  // P5 O4 M3: the machine half unreachable (a refused spine, a daemon gone) is an engine that could not be read
  // (the task review) the network unchanged, a Refresh the machine missed still tells the renderer to read again: its
  // queries never go stale on their own, so without it Discover would keep the engine view it showed before
  it('with the machine unreachable, answers the network’s items, still refreshes the network and says the catalog changed', async () => {
    const engine = host(() => recordedEngine(PROJECT_A));
    const { invoke, emitted } = service(engine.call, {}, { machine: false });
    const page = await invoke('catalog.query', { tab: 'plugins', cwd: PROJECT_A, limit: 200 });
    expect(page.total).toBeGreaterThan(60);
    expect(page.items.find((i) => i.name === 'agentmail' || i.name === 'AgentMail')?.install).toMatchObject({ kind: 'manual' });
    emitted.length = 0;
    expect(await invoke('catalog.refresh', {})).toHaveLength(15);
    expect(emitted).toEqual(['catalog.changed']); // the recordings did not change: the machine's refresh failed
    expect(engine.asked).toEqual([]);
  });

  it('reads again a view an invalidation overtook, and never keeps the old one under the new revision', async () => {
    let current = await recordedEngine(PROJECT_A, { installed: [] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const engine = host(async (name) => {
      const snapshot = current; // what the engine holds when the read starts
      if (name !== 'plugins.env') await gate;
      return snapshot;
    });
    const { invoke, pluginsChanged } = service(engine.call);
    const skillsOnly = `local:${SCRATCH}/maws-discover-test#plugins/skills-only`;
    const pending = invoke('catalog.item', { id: skillsOnly, cwd: PROJECT_A });
    await vi.waitFor(() => expect(engine.asked.some((a) => a.name === 'plugins.list')).toBe(true)); // the read has started
    current = await recordedEngine(PROJECT_A); // skills-only installed at user scope, outside the pending read
    pluginsChanged();
    release();
    expect((await pending).installed).toBe('here');
    const lists = engine.asked.filter((a) => a.name === 'plugins.list').length;
    expect((await invoke('catalog.item', { id: skillsOnly, cwd: PROJECT_A })).installed).toBe('here');
    expect(engine.asked.filter((a) => a.name === 'plugins.list')).toHaveLength(lists); // kept, under the current revision
  });

  it('builds a cwd again when its held view was evicted and read anew, and restarts that cwd’s old cursors', async () => {
    let current = await recordedEngine(PROJECT_A, { installed: [] });
    const { invoke } = service(host(async () => current).call);
    const skillsOnly = `local:${SCRATCH}/maws-discover-test#plugins/skills-only`;
    expect((await invoke('catalog.item', { id: skillsOnly, cwd: PROJECT_A })).installed).toBe('no');
    const page = await invoke('catalog.query', { tab: 'plugins', cwd: PROJECT_A, limit: 10 });
    for (let i = 0; i < 16; i += 1) await invoke('catalog.home', { tab: 'plugins', cwd: `${SCRATCH}/other-${i}` }); // A's view is evicted
    current = await recordedEngine(PROJECT_A); // and the engine changed meanwhile, with no event MAWS saw
    expect((await invoke('catalog.item', { id: skillsOnly, cwd: PROJECT_A })).installed).toBe('here');
    expect((await invoke('catalog.query', { tab: 'plugins', cwd: PROJECT_A, limit: 10, cursor: page.nextCursor })).restarted).toBe(true);
  });

  it('answers each configured server’s posture from the directory record its endpoint matches, from the copy held', async () => {
    endpoints = [
      { name: 'work-tracker', scope: 'user', path: '/x/.claude.json', transport: 'http', url: 'https://mcp.linear.app/mcp' },
      { name: 'linear', scope: 'project', path: `${PROJECT_A}/.mcp.json`, transport: 'http', url: 'https://linear.internal.example/mcp' },
    ];
    const engine = host(() => recordedEngine(PROJECT_A));
    const { invoke } = service(engine.call);
    // nothing held yet: no record is read, so nothing is known; each configuration's fingerprint is opaque and its own
    const before = await invoke('catalog.postures', { cwd: PROJECT_A });
    expect(before.servers.map(({ name, scope, authPosture }) => ({ name, scope, authPosture }))).toEqual([
      { name: 'work-tracker', scope: 'user', authPosture: null },
      { name: 'linear', scope: 'project', authPosture: null },
    ]);
    const [tracker, project] = before.servers.map((s) => s.fingerprint);
    expect(tracker).toMatch(/^[0-9a-f]{32}$/);
    expect(project).not.toBe(tracker);
    expect(JSON.stringify(before)).not.toMatch(/linear\.app|internal\.example/);
    await invoke('catalog.home', { tab: 'connectors', cwd: PROJECT_A }); // the directory read once
    expect(await invoke('catalog.postures', { cwd: PROJECT_A })).toEqual({ servers: [
      { name: 'work-tracker', scope: 'user', path: '/x/.claude.json', authPosture: 'auth_required', fingerprint: tracker },
      { name: 'linear', scope: 'project', path: `${PROJECT_A}/.mcp.json`, authPosture: null, fingerprint: project }, // Linear's name, not its endpoint
    ] });
    // each postures call asked, and the view's read asked once beside it (the baseline an MCP change is compared with)
    expect(engine.asked.filter((a) => a.name === 'customization.serverEndpoints').map((a) => a.input)).toEqual([{ cwd: PROJECT_A }, { cwd: PROJECT_A }, { cwd: PROJECT_A }]);
  });

  it('refuses postures while the engine host cannot list the configured servers', async () => {
    const { invoke } = service(host(() => recordedEngine(PROJECT_A), true).call);
    await expect(invoke('catalog.postures', { cwd: null })).rejects.toThrow(/not running/);
  });

  it('makes the test source discoverable before the engine has its marketplace', async () => {
    const descriptor = join(userData, 'catalog-test-sources.json');
    writeFileSync(descriptor, JSON.stringify([{ key: 'test:maws-discover-test', label: 'MAWS Discover test marketplace', ownership: 'added', marketplaceName: 'maws-discover-test', marketplaceSource: TEST_MARKETPLACE, manifestPath: join(TEST_MARKETPLACE, '.claude-plugin/marketplace.json') }]));
    const bare = host(() => recordedEngine(PROJECT_A, { marketplaces: [], available: [], installed: [], manifests: new Map() }));
    const { invoke } = service(bare.call, { MAWS_CATALOG_TEST_SOURCES: descriptor });
    const added = (await invoke('catalog.home', { tab: 'plugins', cwd: PROJECT_A })).shelves[0]!;
    expect(added).toMatchObject({ key: 'added', title: 'Your sources', total: 4 });
    const hooked = await invoke('catalog.item', { id: `local:${TEST_MARKETPLACE}#plugins/hooked`, cwd: PROJECT_A });
    expect(hooked).toMatchObject({ publisher: 'MAWS e2e hooks', runsOnYourComputer: true, install: { marketplaceSource: TEST_MARKETPLACE, present: false } });
  });
});
