// P5 O4 M3 (docs/doperpowers/plans/2026-10-31-p5-o4-services.md, Interfaces §C; D16, D25): the catalog's machine half
// over the bus. `catalog.engine` answers one cwd's engine view as the wire's shape, held until an invalidation, with a
// serial new for every read and a generation that moves on `plugins.changed`, on the watch of the engine's plugin state
// (a project's settings, an MCP file whose configured servers moved, MAWS's own machine settings) and on
// `catalog.engineRefresh`, each with one `catalog.engineChanged`; the view crosses the socket's codec intact.
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJsonLine, encodeJsonLine } from '@shared/host/json-bytes';
import { commands, type CommandInput, type CommandName, type CommandOutput, type CommandResult } from '@shared/ipc/schema';
import { validateCommandOutput } from '@shared/ipc/validate';
import { PROJECT_A, recordedEngine } from '../../../test/support/catalog-inputs';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { startCatalogMachine } from './machine';
import type { PollFn, WatchFn } from './state-watch';

type EngineView = Awaited<ReturnType<typeof recordedEngine>>; // the join's view, with its Maps (main's normalize.ts)
const CONFIG_HOME = '/scratch-root/config';
let endpoints: CommandOutput<'customization.serverEndpoints'>['servers'];
let globalConfig: string;
let profile: string;
let stops: (() => void)[];

beforeEach(() => {
  endpoints = [];
  globalConfig = `${CONFIG_HOME}/.claude.json`;
  profile = mkdtempSync(join(tmpdir(), 'maws-catalog-machine-'));
  stops = [];
});
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.useRealTimers();
  rmSync(profile, { recursive: true, force: true });
});

// The engine host as the machine's reads ask it, answering from a recorded view (its answers held to the contract's
// shape), with its `plugins.changed` and the listeners the part holds on it.
function host(view: () => Promise<EngineView>) {
  const asked: { name: string; input: unknown }[] = [];
  const listeners = new Set<() => void>();
  const dispatch = async (_owner: string, name: CommandName, input: unknown): Promise<CommandResult<CommandName>> => {
    asked.push({ name, input });
    const v = await view();
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
    const checked = commands[name].output.safeParse(value);
    if (!checked.success) throw new Error(`${name}: ${checked.error.message}`);
    return { ok: true, value: checked.data } as CommandResult<CommandName>;
  };
  const hosts = {
    dispatch,
    onEvent: ((name: string, listener: () => void) => {
      if (name !== 'plugins.changed') throw new Error(`the catalog's machine half listens to ${name}`);
      listeners.add(listener);
      return () => void listeners.delete(listener);
    }) as never,
  };
  return { asked, hosts, listeners, pluginsChanged: () => listeners.forEach((listener) => listener()) };
}

function machine(engine: ReturnType<typeof host>, over: { watch?: WatchFn; poll?: PollFn } = {}): FakeBus {
  const bus = fakeBus();
  const part = startCatalogMachine({ hosts: engine.hosts as never, bus, machineSettings: join(profile, 'machine-settings.json'), log: () => {}, ...over });
  stops.push(part.stop);
  return bus;
}

const engineOf = async (bus: FakeBus, cwd: string | null) => {
  const answer = await bus.invoke('catalog.engine', { cwd });
  if (!answer.ok) throw new Error(answer.error.message);
  return answer.value;
};
const lists = (engine: ReturnType<typeof host>) => engine.asked.filter((a) => a.name === 'plugins.list').length;
// macOS serves every fs.watch from one FSEvents stream, rebuilt each time a folder is added; a write made while it is
// rebuilt can go unreported, so a test lets the watches it just made settle before writing.
const settled = () => new Promise((resolve) => setTimeout(resolve, 500));
const inert: { watch: WatchFn; poll: PollFn } = { watch: () => ({ close: () => {}, on: () => undefined }), poll: () => ({ close: () => {} }) };

describe('the catalog’s machine half', () => {
  it('registers exactly catalog.engine and catalog.engineRefresh', () => {
    const bus = machine(host(() => recordedEngine(PROJECT_A)), inert);
    expect(bus.registered().sort()).toEqual(['catalog.engine', 'catalog.engineRefresh']);
  });

  it('answers a cwd’s view held until plugins.changed, a serial new per read and a generation that moves, with one catalog.engineChanged', async () => {
    const engine = host(() => recordedEngine(PROJECT_A));
    const bus = machine(engine, inert);
    const first = await engineOf(bus, PROJECT_A);
    // each listed marketplace's manifest, in the listing's order (the recording's second has no clone: `unknown`)
    expect(first.view).toMatchObject({ cwd: PROJECT_A, manifests: [['maws-discover-test', expect.objectContaining({ state: 'read' })], ['maws-recorded-pins', expect.objectContaining({ state: 'unknown' })]], directoryInstalled: [] });
    expect(validateCommandOutput('catalog.engine', first).ok).toBe(true);
    const held = await engineOf(bus, PROJECT_A);
    expect(held).toEqual(first); // the same read, under the same generation
    expect(lists(engine)).toBe(1);
    engine.pluginsChanged();
    expect(bus.emittedOf('catalog.engineChanged')).toEqual([{ scope: 'all' }]);
    const again = await engineOf(bus, PROJECT_A);
    expect(again.generation).toBe(first.generation + 1);
    expect(again.serial).toBeGreaterThan(first.serial);
    expect(lists(engine)).toBe(2);
  });

  it('never answers a serial an earlier part answered: a second load’s reads go on past the first’s', async () => {
    const first = await engineOf(machine(host(() => recordedEngine(PROJECT_A)), inert), PROJECT_A);
    for (const stop of stops.splice(0)) stop();
    const second = await engineOf(machine(host(() => recordedEngine(PROJECT_A)), inert), PROJECT_A);
    expect(second.generation).toBe(first.generation); // a new part's reads begin again
    expect(second.serial).toBeGreaterThan(first.serial); // so the serial alone tells its view from the first's
  });

  it('reads the user configuration in the engine’s configuration directory', async () => {
    const engine = host(() => recordedEngine(CONFIG_HOME));
    const bus = machine(engine, inert);
    expect((await engineOf(bus, null)).view?.cwd).toBe(CONFIG_HOME);
    expect(engine.asked.find((a) => a.name === 'plugins.list')?.input).toEqual({ cwd: CONFIG_HOME });
    expect(engine.asked.find((a) => a.name === 'customization.inventory')?.input).toEqual({ cwd: null });
  });

  it('forgets every view at catalog.engineRefresh, with one catalog.engineChanged', async () => {
    const engine = host(() => recordedEngine(PROJECT_A));
    const bus = machine(engine, inert);
    const before = await engineOf(bus, PROJECT_A);
    expect(await bus.invoke('catalog.engineRefresh', undefined)).toEqual({ ok: true, value: { ok: true } });
    expect(bus.emittedOf('catalog.engineChanged')).toEqual([{ scope: 'all' }]);
    const after = await engineOf(bus, PROJECT_A);
    expect(after.generation).toBe(before.generation + 1);
    expect(lists(engine)).toBe(2);
  });

  it('crosses the socket’s codec with its marketplace manifests and installed-directory provenance intact', async () => {
    const view = await recordedEngine(PROJECT_A, { directoryInstalled: new Map([['frontend-design', 'github.com/anthropics/claude-code#plugins/frontend-design']]) });
    const answer = await engineOf(machine(host(async () => view), inert), PROJECT_A);
    const crossed = decodeJsonLine(encodeJsonLine(answer));
    expect(crossed).toEqual(answer);
    const checked = validateCommandOutput('catalog.engine', crossed);
    expect(checked.ok && checked.value).toEqual(answer);
    expect(answer.view?.manifests[0]).toEqual([...view.manifests][0]);
    expect(answer.view?.directoryInstalled).toEqual([['frontend-design', 'github.com/anthropics/claude-code#plugins/frontend-design']]);
  });

  it('sees an outside change to a project’s settings: that project’s view is read again, with one catalog.engineChanged naming it', async () => {
    const project = mkdtempSync(join(tmpdir(), 'maws-catalog-project-'));
    try {
      mkdirSync(join(project, '.claude'));
      writeFileSync(join(project, '.claude', 'settings.json'), '{}');
      const engine = host(() => recordedEngine(project, { installed: [] }));
      const bus = machine(engine);
      const before = await engineOf(bus, project);
      await settled();
      writeFileSync(join(project, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'skills-only@maws-discover-test': true } }));
      await vi.waitFor(() => expect(bus.emittedOf('catalog.engineChanged')).toEqual([{ scope: 'cwd', cwd: project }]), { timeout: 10_000, interval: 100 });
      const after = await engineOf(bus, project);
      expect(after.generation).toBe(before.generation + 1);
      expect(after.serial).toBeGreaterThan(before.serial);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  }, 15_000); // the file system's change notice, under load

  it('sees an outside change to the engine’s global .claude.json that moves the configured servers, and reads again', async () => {
    globalConfig = join(profile, '.claude.json');
    writeFileSync(globalConfig, JSON.stringify({ numStartups: 1 }));
    const engine = host(() => recordedEngine(PROJECT_A, { servers: [] }));
    const bus = machine(engine);
    const before = await engineOf(bus, PROJECT_A);
    endpoints = [{ name: 'linear', scope: 'user', path: globalConfig, transport: 'http', url: 'https://mcp.linear.app/mcp' }]; // `claude mcp add --scope user`
    await settled();
    writeFileSync(`${globalConfig}.tmp`, JSON.stringify({ numStartups: 1, mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp' } } }));
    renameSync(`${globalConfig}.tmp`, globalConfig); // the engine writes it by renaming a new file over it
    await vi.waitFor(() => expect(bus.emittedOf('catalog.engineChanged')).toEqual([{ scope: 'all' }]), { timeout: 10_000, interval: 100 });
    expect((await engineOf(bus, PROJECT_A)).serial).toBeGreaterThan(before.serial);
  }, 15_000);

  it('says nothing and reads nothing again when an MCP file changed but the configured servers did not', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const polled = new Map<string, () => void>();
    const poll: PollFn = (path, listener) => (polled.set(path, listener), { close: () => void polled.delete(path) });
    const engine = host(() => recordedEngine(PROJECT_A));
    const bus = machine(engine, { watch: inert.watch, poll });
    const before = await engineOf(bus, PROJECT_A);
    polled.get(`${CONFIG_HOME}/.claude.json`)!(); // the engine rewrote its global file: stats, not servers
    await vi.advanceTimersByTimeAsync(1_100);
    expect(bus.emittedOf('catalog.engineChanged')).toEqual([]);
    expect(await engineOf(bus, PROJECT_A)).toEqual(before);
  });

  // P5 O3-A (O3-A acceptance 4): MAWS's own servers are the machine's, in its machine settings
  it('watches the machine settings for MAWS’s own servers, not the client’s settings.json, and asks for the servers again on its change', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const polled = new Map<string, () => void>();
    const poll: PollFn = (path, listener) => (polled.set(path, listener), { close: () => void polled.delete(path) });
    const engine = host(() => recordedEngine(PROJECT_A));
    const bus = machine(engine, { watch: inert.watch, poll });
    await engineOf(bus, PROJECT_A);
    expect(polled.has(join(profile, 'machine-settings.json'))).toBe(true);
    expect(polled.has(join(profile, 'settings.json'))).toBe(false);
    const asks = () => engine.asked.filter((a) => a.name === 'customization.serverEndpoints').length;
    const before = asks();
    polled.get(join(profile, 'machine-settings.json'))!();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(asks()).toBeGreaterThan(before);
  });

  it('stops: its listener on the host released, its watches closed, and a read answered after the stop watches nothing', async () => {
    const polled = new Map<string, () => void>();
    const poll: PollFn = (path, listener) => (polled.set(path, listener), { close: () => void polled.delete(path) });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const engine = host(async () => (await gate, recordedEngine(PROJECT_A)));
    const bus = machine(engine, { watch: inert.watch, poll });
    const pending = bus.invoke('catalog.engine', { cwd: PROJECT_A });
    for (const stop of stops.splice(0)) stop();
    expect(engine.listeners.size).toBe(0);
    release();
    await pending;
    expect(polled.size).toBe(0);
    engine.pluginsChanged();
    expect(bus.emittedOf('catalog.engineChanged')).toEqual([]);
  });
});
