// P4-AGG M2: the catalog service over `catalog.*` (the Discover spec, M2 Decisions): the engine's reads are held per cwd
// until `plugins.changed`, which also tells the renderer `catalog.changed` once; Refresh reads the engine again; a cwd of
// null reads the user configuration in the engine's configuration directory; an engine that cannot be read leaves the
// network's items; the test-source seam makes the local test marketplace discoverable; a read an invalidation overtakes
// is read again. P5 O4 M3 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, D16): the engine's reads and the watch
// are the machine's half (src/services/catalog/machine.ts, whose own suite holds the watch's cases); here the person's
// half is composed over the machine's on the services bus, as either root composes them, and over a machine it cannot
// ask.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineViewWire } from '@shared/catalog/engine-view';
import { decodeJsonLine, encodeJsonLine } from '@shared/host/json-bytes';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import { commands } from '@shared/ipc/schema';
import { CATALOG_EGRESS, egressGet } from '@shared/net/egress';
import { NETWORK_FIXTURES, PROJECT_A, recordedEngine, SCRATCH, TEST_MARKETPLACE } from '../../../test/support/catalog-inputs';
import { fakeBus } from '../../../test/support/fake-bus';
import { startCatalogMachine } from '../../services/catalog/machine';
import type { PollFn, WatchFn } from '../../services/catalog/state-watch';
import { iconGet, type IconGet } from './fetch';
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
function service(call: HostCall, env: Record<string, string> = {}, { machine = true, icons, now }: { machine?: boolean; icons?: IconGet; now?: () => number } = {}) {
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
    iconGet: icons,
    now,
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
      { name: 'work-tracker', scope: 'user', path: '/x/.claude.json', transport: 'http', url: 'https://mcp.linear.app/mcp', revision: 'rev-tracker' }, // U11a M8: the engine host's
      { name: 'linear', scope: 'project', path: `${PROJECT_A}/.mcp.json`, transport: 'http', url: 'https://linear.internal.example/mcp' }, // an earlier host's: none
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
      { name: 'work-tracker', scope: 'user', path: '/x/.claude.json', authPosture: 'auth_required', fingerprint: tracker, revision: 'rev-tracker' },
      { name: 'linear', scope: 'project', path: `${PROJECT_A}/.mcp.json`, authPosture: null, fingerprint: project, revision: null }, // Linear's name, not its endpoint
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

// UX wave U11c M1 (docs/doperpowers/plans/2026-11-14-ux-wave-U11c-customize.md, §C; C7): the directory's icons on what is
// installed and configured. My items asks main for the icon URLs of its rows (`catalog.pluginIcons`, the postures'
// `iconUrl`), which come from the copy main holds and ask nothing; the bytes are `catalog.icon`'s, which asks the network
// only as its route keeps a copy. Every source here is invented, held on disk as an earlier run kept it, long enough ago
// that a read that refreshed would refresh it.
describe('the icons of installed plugins and configured connectors', () => {
  const PLUGIN_ICON = `https://api.anthropic.com/api/directory/plugin-icons/${'0a'.repeat(32)}/256.png`;
  const BUCKET = 'https://storage.googleapis.com/media-assets-299d7136-cb52-d546-ee02-34bc1307c35f/mcp-directory/icons';
  const VENDOR_ICON = 'https://cdn.tide-tables.example/icon.png';
  const BERTH = 'berth-notes@claude-plugins-official';
  const TIDE = 'tide-tables@claude-plugins-official'; // its record's icon is on its vendor's site
  const QUAY = 'quay-ledger@claude-plugins-official'; // the directory has no record of it
  const ELSEWHERE = 'berth-notes@harbour-market'; // a marketplace no seed is
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');

  const record = (name: string, icon: string | null) => ({
    id: `plugin_${name}`,
    name,
    summary: `${name}, an invented plugin`,
    surfaces: ['claude_code'],
    components: [],
    source: { repository: { url: 'https://github.com/anthropics/claude-plugins-official', path: `plugins/${name}`, reviewed_commit: 'b'.repeat(40) } },
    ...(icon === null ? {} : { media: { icons: [{ url: icon }] } }),
  });
  const server = (id: string, name: string, url: string, icon: string | null) => ({ id, type: 'remote', name, icon_url: icon, works_with: ['claude-code'], remote: { url, transport: 'streamable-http', auth_posture: 'oauth' } });
  const SOURCES = {
    'seed:claude-plugins-official': { name: 'claude-plugins-official', owner: { name: 'Anthropic' }, plugins: ['berth-notes', 'tide-tables', 'quay-ledger'].map((name) => ({ name, source: `./plugins/${name}`, description: `${name}, invented` })) },
    'directory:plugins': { data: [record('berth-notes', PLUGIN_ICON), record('tide-tables', VENDOR_ICON)] },
    'directory:servers': {
      servers: [
        server('srv-tides', 'Tides', 'https://mcp.tides.example/mcp', `${BUCKET}/tides.svg`),
        server('srv-moorings', 'Moorings', 'https://mcp.moorings.example/mcp', `${BUCKET}/moorings.png`),
        server('srv-moorings-mirror', 'Moorings Mirror', 'https://mcp.moorings.example/mcp', `${BUCKET}/moorings-mirror.png`), // the same address: two records
        server('srv-anchors', 'Anchors', 'https://mcp.anchors.example/mcp', 'https://anchors.example/logo.png'), // an icon off the routes
      ],
      next_cursor: null,
    },
  };
  const hold = () => {
    mkdirSync(join(userData, 'catalog'), { recursive: true });
    for (const [key, page] of Object.entries(SOURCES)) writeFileSync(join(userData, 'catalog', `${key}.json`), JSON.stringify({ key, fetchedAt: 0, pages: [page] }));
  };
  const at = (name: string, url: string): CommandOutput<'customization.serverEndpoints'>['servers'][number] => ({ name, scope: 'user', path: '/x/.claude.json', transport: 'http', url });

  // The network as the catalog rule reaches it: every request recorded, answered while `up`.
  function network() {
    const net = { asked: [] as string[], up: true };
    const get = iconGet({}, 'MAWS/test', egressGet(CATALOG_EGRESS, async (url) => {
      net.asked.push(url);
      if (!net.up) return new Response('no', { status: 503 });
      return new Response(url.endsWith('.svg') ? SVG : PNG, { headers: { 'content-type': url.endsWith('.svg') ? 'image/svg+xml' : 'image/png' } });
    }));
    return { net, get };
  }

  it('answers each installed plugin’s icon from the copy held, refreshing nothing and asking the machine nothing', async () => {
    hold();
    const engine = host(() => recordedEngine(PROJECT_A));
    const { invoke, emitted } = service(engine.call);
    expect(await invoke('catalog.pluginIcons', { ids: [BERTH, TIDE, QUAY, ELSEWHERE] })).toEqual({
      icons: [
        { id: BERTH, iconUrl: PLUGIN_ICON },
        { id: TIDE, iconUrl: null }, // off the directory's icon routes
        { id: QUAY, iconUrl: null },
        { id: ELSEWHERE, iconUrl: null }, // no route installs it
      ],
    });
    expect(engine.asked).toEqual([]); // no engine view, so no CLI read
    expect(emitted).toEqual([]);
    const held = Object.fromEntries((await invoke('catalog.sources', {})).filter((s) => s.fetchedAt !== null).map((s) => [s.key, [s.fetchedAt, s.state]]));
    expect(held).toEqual({ 'seed:claude-plugins-official': [new Date(0).toISOString(), 'stale'], 'directory:plugins': [new Date(0).toISOString(), 'stale'], 'directory:servers': [new Date(0).toISOString(), 'stale'] }); // not refreshed
  });

  it('answers no icon while no copy is held, and refuses more than 512 ids', async () => {
    const { invoke } = service(host(() => recordedEngine(PROJECT_A)).call);
    expect(await invoke('catalog.pluginIcons', { ids: [BERTH] })).toEqual({ icons: [{ id: BERTH, iconUrl: null }] });
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `plugin-${i}@harbour-market`);
    expect(commands['catalog.pluginIcons'].input.safeParse({ ids: ids(512) }).success).toBe(true);
    expect(commands['catalog.pluginIcons'].input.safeParse({ ids: ids(513) }).success).toBe(false);
  });

  it('gives a configured connector the icon of the one record its address matches: none for two, none for none, none off the routes', async () => {
    hold();
    endpoints = [at('tides', 'https://mcp.tides.example/mcp'), at('moorings', 'https://mcp.moorings.example/mcp'), at('buoy', 'https://buoy.internal.example/mcp'), at('anchors', 'https://mcp.anchors.example/mcp')];
    const { invoke } = service(host(() => recordedEngine(PROJECT_A)).call);
    expect((await invoke('catalog.postures', { cwd: PROJECT_A })).servers.map(({ name, iconUrl }) => ({ name, iconUrl }))).toEqual([
      { name: 'tides', iconUrl: `${BUCKET}/tides.svg` },
      { name: 'moorings', iconUrl: null },
      { name: 'buoy', iconUrl: null },
      { name: 'anchors', iconUrl: null },
    ]);
  });

  it('asks the network for the URLs they hand out only as the icon route keeps its copies', async () => {
    hold();
    endpoints = [at('tides', 'https://mcp.tides.example/mcp')];
    let now = 1_000_000;
    const { net, get } = network();
    const { invoke } = service(host(() => recordedEngine(PROJECT_A)).call, {}, { icons: get, now: () => now });
    const plugin = (await invoke('catalog.pluginIcons', { ids: [BERTH] })).icons[0]!.iconUrl!;
    const connector = (await invoke('catalog.postures', { cwd: PROJECT_A })).servers[0]!.iconUrl!;
    expect([plugin, connector]).toEqual([PLUGIN_ICON, `${BUCKET}/tides.svg`]);
    const draw = (url: string) => invoke('catalog.icon', { url });
    // no copy kept: one request per URL, however many rows ask together
    const [pluginData, , , connectorData] = await Promise.all([draw(plugin), draw(plugin), draw(plugin), draw(connector), draw(connector)]);
    expect(pluginData!.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(connectorData!.dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(net.asked).toEqual([plugin, connector]);
    // a copy younger than a day: none
    now += 23 * 60 * 60_000;
    await draw(plugin);
    await draw(connector);
    expect(net.asked).toHaveLength(2);
    // a plugin icon's copy, of any age: none
    now += 400 * 24 * 60 * 60_000;
    net.up = false;
    expect(await draw(plugin)).toEqual(pluginData);
    expect(net.asked).toHaveLength(2);
    // a connector icon's copy older than a day: one request; it fails, and the old copy is still drawn
    expect(await draw(connector)).toEqual(connectorData);
    expect(net.asked).toEqual([plugin, connector, connector]);
    // not asked again inside five minutes, the old copy drawn meanwhile; then once more
    now += 4 * 60_000;
    expect(await draw(connector)).toEqual(connectorData);
    expect(net.asked).toHaveLength(3);
    now += 60_000;
    net.up = true;
    await draw(connector);
    expect(net.asked).toHaveLength(4);
    // a URL off the two icon routes (what a record names on a vendor's site): no request, no icon
    expect(await draw(VENDOR_ICON)).toEqual({ dataUrl: null });
    expect(net.asked).toHaveLength(4);
  });
});
