// P4-AGG M2: the catalog service over `catalog.*` (the Discover spec, M2 Decisions): the engine's reads go through the
// host and are held per cwd until `plugins.changed`, which also tells the renderer `catalog.changed` once; Refresh reads
// the engine again; a cwd of null reads the user configuration in the engine's configuration directory; an engine that
// cannot be read leaves the network's items; the test-source seam makes the local test marketplace discoverable; a read
// an invalidation overtakes is read again; an outside change to a project's settings invalidates without Refresh.
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import { commands } from '@shared/ipc/schema';
import { NETWORK_FIXTURES, PROJECT_A, recordedEngine, SCRATCH, TEST_MARKETPLACE } from '../../../test/support/catalog-inputs';
import type { HostCall } from './engine-reads';
import type { PollFn, WatchFn } from './state-watch';
import { startCatalog } from './index';
import type { EngineView } from './normalize';

let userData: string;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-agg-service-'));
});
afterEach(() => rmSync(userData, { recursive: true, force: true }));

const CONFIG_HOME = '/scratch-root/config';
let endpoints: CommandOutput<'customization.serverEndpoints'>['servers'] = [];
let globalConfig = `${CONFIG_HOME}/.claude.json`;
afterEach(() => { endpoints = []; globalConfig = `${CONFIG_HOME}/.claude.json`; });

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
          return { binary: '/bin/claude', binaryError: null, configHome: CONFIG_HOME, globalConfig };
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

// macOS serves every fs.watch from one FSEvents stream, rebuilt each time a folder is added; a write made while it is
// rebuilt can go unreported, so a test lets the watches it just made settle before writing.
const settled = () => new Promise((resolve) => setTimeout(resolve, 500));

function service(call: HostCall, env: Record<string, string> = {}, watch?: WatchFn, poll?: PollFn) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const emitted: string[] = [];
  const changedListeners = new Set<() => void>();
  const catalog = startCatalog({
    register: ((name: string, handler: (input: unknown) => Promise<unknown>) => handlers.set(name, handler)) as never,
    emit: (name) => emitted.push(name),
    call,
    onPluginsChanged: (listener) => (changedListeners.add(listener), () => changedListeners.delete(listener)),
    userData,
    env: { MAWS_CATALOG_FIXTURES: NETWORK_FIXTURES, ...env },
    userAgent: 'MAWS/test',
    log: () => {},
    watch,
    poll,
  });
  const invoke = <N extends CommandName>(name: N, input: CommandInput<N>) => handlers.get(name)!(input) as Promise<CommandOutput<N>>;
  return { invoke, emitted, catalog, pluginsChanged: () => changedListeners.forEach((l) => l()), handlers };
}

describe('the catalog service', () => {
  it('registers exactly the catalog commands', () => {
    const { handlers } = service(host(() => recordedEngine(PROJECT_A)).call);
    expect([...handlers.keys()].sort()).toEqual(Object.keys(commands).filter((n) => n.startsWith('catalog.')).sort());
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

  it('sees an outside change to a project’s settings and reads that project again without Refresh', async () => {
    const project = mkdtempSync(join(tmpdir(), 'maws-agg-project-'));
    try {
      mkdirSync(join(project, '.claude'));
      writeFileSync(join(project, '.claude', 'settings.json'), '{}');
      let current = await recordedEngine(project, { installed: [] });
      const { invoke, emitted, catalog } = service(host(async () => current).call);
      const skillsOnly = `local:${SCRATCH}/maws-discover-test#plugins/skills-only`;
      expect((await invoke('catalog.item', { id: skillsOnly, cwd: project })).installed).toBe('no');
      current = await recordedEngine(project); // an agent installed it from a terminal
      await settled();
      emitted.length = 0;
      writeFileSync(join(project, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'skills-only@maws-discover-test': true } }));
      await vi.waitFor(async () => expect((await invoke('catalog.item', { id: skillsOnly, cwd: project })).installed).toBe('here'), { timeout: 10_000, interval: 100 });
      expect(emitted).toContain('catalog.changed');
      catalog.stop();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }, 15_000); // the file system's change notice, under load

  it('sees an outside change to a project’s .mcp.json and reads the connectors again without Refresh (scalpel-3#1)', async () => {
    const project = mkdtempSync(join(tmpdir(), 'maws-agg-mcp-'));
    try {
      let current = await recordedEngine(project, { servers: [] });
      const { invoke, emitted, catalog } = service(host(async () => current).call);
      const linear = async () => (await invoke('catalog.query', { tab: 'connectors', cwd: project, limit: 200 })).items.find((i) => i.name === 'Linear')!;
      expect((await linear()).installed).toBe('no');
      const added = { name: 'linear', scope: 'project' as const, path: join(project, '.mcp.json'), transport: 'http' as const, url: 'https://mcp.linear.app/mcp' };
      current = await recordedEngine(project, { servers: ['linear'] }); // an agent ran `claude mcp add` in a terminal
      endpoints = [added];
      await settled();
      emitted.length = 0;
      writeFileSync(join(project, '.mcp.json'), JSON.stringify({ mcpServers: { linear: { type: 'http', url: added.url } } }));
      await vi.waitFor(async () => expect((await linear()).installed).toBe('here'), { timeout: 10_000, interval: 100 });
      expect(emitted).toContain('catalog.changed'); // the postures read again too (the renderer's postures are a catalog query)
      catalog.stop();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }, 15_000);

  it('sees an outside change to the engine’s global .claude.json and reads the connectors again without Refresh (scalpel-3#1)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'maws-agg-home-'));
    try {
      globalConfig = join(home, '.claude.json');
      writeFileSync(globalConfig, JSON.stringify({ numStartups: 1 }));
      let current = await recordedEngine(PROJECT_A, { servers: [] });
      const { invoke, emitted, catalog } = service(host(async () => current).call);
      const linear = async () => (await invoke('catalog.query', { tab: 'connectors', cwd: PROJECT_A, limit: 200 })).items.find((i) => i.name === 'Linear')!;
      expect((await linear()).installed).toBe('no');
      current = await recordedEngine(PROJECT_A, { servers: ['linear'] }); // `claude mcp add --scope user` in a terminal
      endpoints = [{ name: 'linear', scope: 'user', path: globalConfig, transport: 'http', url: 'https://mcp.linear.app/mcp' }];
      await settled();
      emitted.length = 0;
      writeFileSync(`${globalConfig}.tmp`, JSON.stringify({ numStartups: 1, mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } } }));
      renameSync(`${globalConfig}.tmp`, globalConfig); // the engine writes it by renaming a new file over it
      await vi.waitFor(async () => expect((await linear()).installed).toBe('here'), { timeout: 10_000, interval: 100 });
      expect(emitted).toContain('catalog.changed');
      catalog.stop();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 15_000);

  it('reads nothing again when an MCP file changed but the configured servers did not (scalpel-3#1)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const polled = new Map<string, () => void>();
      const poll: PollFn = (path, listener) => (polled.set(path, listener), { close: () => void polled.delete(path) });
      const watch: WatchFn = () => ({ close: () => {}, on: () => undefined });
      const engine = host(() => recordedEngine(PROJECT_A));
      const { invoke, emitted } = service(engine.call, {}, watch, poll);
      await invoke('catalog.home', { tab: 'connectors', cwd: PROJECT_A });
      const reads = () => engine.asked.filter((a) => a.name === 'customization.inventory').length;
      const before = reads();
      emitted.length = 0;
      polled.get(`${CONFIG_HOME}/.claude.json`)!(); // the engine rewrote its global file: stats, not servers
      await vi.advanceTimersByTimeAsync(1_100);
      expect(emitted).toEqual([]);
      await invoke('catalog.home', { tab: 'connectors', cwd: PROJECT_A });
      expect(reads()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
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
