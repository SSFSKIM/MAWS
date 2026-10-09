// E8's engine-host surface (E8 execution document, M1; Interfaces "X2: plugins.*, marketplaces.*, session.reloadSkills"):
// the CLI reads and operations through the host's handlers against a fake engine binary, the reload fan-out over a ready
// session on a scripted transport, `session.reloadSkills`, and a successful reload applied to the session's status.
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import type { CommandInput, CommandName, CommandOutput, EventName } from '@shared/ipc/schema';
import type { PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { autoResponder, scriptedTransport, type ScriptedTransport } from './conformance/scripted-transport';
import { handshakeResponder } from './conformance/session-harness';
import { TESTED_ENGINE_VERSION } from './engine-compat';
import { registerEngineIpc, type EngineIpcDeps } from './ipc';
import { RELAY_URL } from './launch';
import { CLI_TIMEOUT_MS, KILL_GRACE_MS, SETTLE_MS, SHUTDOWN_KILL_GRACE_MS } from './plugins/runner';

const REPO_ROOT = resolve(__dirname, '../..');
const OK_RELAY = { url: RELAY_URL, ok: true, status: 200, latencyMs: 2, checkedAt: '2026-10-06T10:00:00.000Z', error: null };

let root: string;
let fake: string;
let project: string;
beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'maws-ipc-e8-')));
  fake = join(root, 'fake');
  project = join(root, 'project');
  mkdirSync(fake);
  mkdirSync(project);
  writeFileSync(join(fake, 'claude'), `#!/bin/sh\necho "$*" >> "${fake}/calls.log"\necho $$ > "${fake}/pid"\n. "${fake}/behaviour.sh"\n`);
  chmodSync(join(fake, 'claude'), 0o755);
  behave('');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

const behave = (script: string) => writeFileSync(join(fake, 'behaviour.sh'), script);
const calls = () => (existsSync(join(fake, 'calls.log')) ? readFileSync(join(fake, 'calls.log'), 'utf8').trim().split('\n') : []);
const RESULT = (fields: Record<string, unknown>) => `echo '${JSON.stringify(fields)}'`;
const reloadAnswer = (...names: string[]) => ({ commands: [], agents: [], plugins: names.map((name) => ({ name, path: `/p/${name}`, source: `${name}@e8-scratch`, version: '0.1.0' })), mcpServers: [], error_count: 0 });

const spec = (appSessionId: string, cwd: string): LaunchSpec =>
  LaunchSpecSchema.parse({
    appSessionId, cwd, additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: null, inheritGrantsFrom: null,
  });

const shortened = { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms === SETTLE_MS ? 5 : ms === KILL_GRACE_MS || ms === SHUTDOWN_KILL_GRACE_MS ? 100 : ms === CLI_TIMEOUT_MS ? 60_000 : ms), clearTimeout: (h: unknown) => clearTimeout(h as NodeJS.Timeout) };

function engineHost(deps: Partial<EngineIpcDeps> = {}) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const emitted: { name: EventName; payload: unknown }[] = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues).slice(0, 400)}`);
    emitted.push({ name, payload });
    return true;
  };
  const ipc = registerEngineIpc(on, emit, {
    userData: root, replayEnabled: true, cwd: REPO_ROOT,
    binaryProbe: async () => ({ path: join(fake, 'claude'), testedVersion: TESTED_ENGINE_VERSION, version: TESTED_ENGINE_VERSION, ok: true, error: null }),
    checkRelay: async () => OK_RELAY,
    captureEnv: async () => ({ PATH: '/usr/bin:/bin', HOME: join(root, 'home'), CLAUDE_CONFIG_DIR: join(root, 'config'), CLAUDECODE: '1' }),
    pluginsTimers: shortened,
    ...deps,
  });
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const value = await handlers.get(name)!(input);
    const checked = validateCommandOutput(name, value);
    if (!checked.ok) throw new Error(`invalid output of ${name}: ${checked.error.message}`);
    return checked.value;
  };
  const operations = () => emitted.filter((e) => e.name === 'plugins.operation').map((e) => e.payload as PluginsOperationEvent);
  const done = (opId: string) => until(() => operations().find((e) => e.opId === opId && e.phase === 'done'), `${opId} done`);
  return { handlers, emitted, ipc, call, operations, done };
}

async function until<T>(check: () => T | undefined | false, what: string, ms = 5_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

// A ready session on a scripted transport whose reload_plugins answers come from `reloads` in turn.
async function readySession(host: ReturnType<typeof engineHost>, transport: ScriptedTransport, id: string, cwd: string) {
  await host.call('session.launch', { spec: spec(id, cwd) });
  await until(() => host.ipc.table.get(id as AppSessionId)?.lifecycle === 'ready', `${id} ready`);
  return id as AppSessionId;
}
const statusOf = (host: ReturnType<typeof engineHost>, id: AppSessionId): EngineSessionStatus => host.ipc.table.get(id)!.status();

describe('E8 reads', () => {
  it('plugins.env names the engine binary, the config home the CLI writes and its global config file', async () => {
    // under CLAUDE_CONFIG_DIR the global config lives inside the override
    expect(await engineHost().call('plugins.env', {})).toEqual({ binary: join(fake, 'claude'), binaryError: null, configHome: join(root, 'config'), globalConfig: join(root, 'config', '.claude.json') });
    // without it, `~/.claude.json` sits beside `~/.claude`, not inside it; a failed probe answers its refusal
    const home = engineHost({ captureEnv: async () => ({ HOME: '/Users/x' }), binaryProbe: async () => ({ path: '', testedVersion: TESTED_ENGINE_VERSION, version: null, ok: false, error: 'not installed' }) });
    expect(await home.call('plugins.env', {})).toEqual({ binary: null, binaryError: 'not installed', configHome: '/Users/x/.claude', globalConfig: '/Users/x/.claude.json' });
  });

  it('answers the three listings reduced, each from its own argv in the asked directory', async () => {
    behave(`case "$*" in
  "plugin list --json") printf '[\\n  {"id": "e8-probe@e8-scratch", "version": "0.1.0", "scope": "user", "enabled": true, "installPath": "/c"}\\n]\\n';;
  "plugin list --json --available") echo '{"installed": [], "available": [{"pluginId": "e8-probe@e8-scratch", "name": "e8-probe", "marketplaceName": "e8-scratch", "description": "d", "source": "./p"}]}';;
  "plugin marketplace list --json") echo '[{"name": "e8-scratch", "source": "directory", "path": "/m", "installLocation": "/m"}]';;
esac
`);
    const host = engineHost();
    expect(await host.call('plugins.list', { cwd: project })).toEqual({ plugins: [{ id: 'e8-probe@e8-scratch', name: 'e8-probe', marketplace: 'e8-scratch', version: '0.1.0', scope: 'user', enabled: true, projectPath: null, installPath: '/c', errors: [], notes: [], installedAt: null, lastUpdated: null, projectEnabled: false, here: false, coversHere: false }] });
    expect(await host.call('plugins.available', { cwd: project })).toEqual({ plugins: [{ pluginId: 'e8-probe@e8-scratch', name: 'e8-probe', marketplaceName: 'e8-scratch', description: 'd', version: null, source: './p', installCount: null }] });
    expect(await host.call('marketplaces.list', { cwd: project })).toEqual({ marketplaces: [{ name: 'e8-scratch', source: 'directory', locator: '/m', installLocation: '/m' }] });
    expect(calls()).toEqual(['plugin list --json', 'plugin list --json --available', 'plugin marketplace list --json']);
  });

  it('a listing that fails answers the CLI’s own last words', async () => {
    behave(`echo "Error: settings.json is not valid JSON" >&2\nexit 1\n`);
    await expect(engineHost().call('plugins.list', { cwd: project })).rejects.toThrow('Error: settings.json is not valid JSON');
  });
});

describe('E8 operations', () => {
  it('an install answers a receipt, runs the CLI, reloads the ready session after the settle, applies its answer and reports reflected', async () => {
    behave(RESULT({ command: 'install', outcome: 'ok', plugin: 'e8-probe@e8-scratch', pluginId: 'e8-probe@e8-scratch', scope: 'user', message: 'Successfully installed plugin: e8-probe@e8-scratch (scope: user)' }));
    const transport = scriptedTransport({ onWrite: autoResponder(handshakeResponder({ reload_plugins: () => ({ response: reloadAnswer('e8-probe') }), end_session: () => null })) });
    const host = engineHost({ spawn: () => transport });
    const id = await readySession(host, transport, 'app-e8', project);
    expect(statusOf(host, id).plugins).toEqual([]);

    const { opId } = await host.call('plugins.install', { cwd: project, binary: join(fake, 'claude'), plugin: 'e8-probe@e8-scratch' });
    const done = await host.done(opId);
    expect(calls()).toEqual(['plugin install e8-probe@e8-scratch --json']);
    expect(host.operations().filter((e) => e.opId === opId).map((e) => e.phase)).toEqual(['started', 'reloading', 'done']);
    expect(done).toMatchObject({ action: 'install', target: 'e8-probe@e8-scratch', outcome: { ok: true, result: { message: 'Successfully installed plugin: e8-probe@e8-scratch (scope: user)' } }, reload: { sessions: [{ appSessionId: id, outcome: 'reflected', error: null }] } });
    expect(transport.requestsOf('reload_plugins')).toHaveLength(1);
    expect(statusOf(host, id).plugins).toEqual([{ name: 'e8-probe', path: '/p/e8-probe', source: 'e8-probe@e8-scratch', version: '0.1.0' }]); // before any new turn
    expect(host.emitted.some((e) => e.name === 'plugins.changed')).toBe(true);
    const published = host.emitted.filter((e) => e.name === 'session.status').map((e) => (e.payload as { status: EngineSessionStatus }).status);
    expect(published.at(-1)!.plugins.map((p) => p.name)).toEqual(['e8-probe']);

    const stopping = host.call('engine.shutdown', { graceMs: 5_000 });
    await until(() => transport.requestsOf('end_session').length === 1, 'end_session');
    transport.exit(0);
    await stopping;
  });

  it('marketplace verbs and the remaining plugin verbs run their argv; cancel answers whether it stopped anything', async () => {
    behave(`case "$2" in marketplace) ${RESULT({ command: 'marketplace-add', outcome: 'ok', message: 'ok' })};; *) sleep 30;; esac\n`);
    const host = engineHost();
    const added = await host.call('marketplaces.add', { cwd: project, binary: join(fake, 'claude'), source: '/m', scope: 'user' });
    expect((await host.done(added.opId)).reload).toBeUndefined();
    const updating = await host.call('plugins.update', { cwd: project, binary: join(fake, 'claude'), plugin: 'p@m', scope: 'project' });
    await until(() => calls().length === 2, 'the update');
    expect(await host.call('plugins.cancel', { opId: updating.opId })).toEqual({ cancelled: true });
    expect((await host.done(updating.opId)).outcome).toMatchObject({ ok: false, error: { code: 'cancelled' } });
    expect(await host.call('plugins.cancel', { opId: updating.opId })).toEqual({ cancelled: false });
    behave(RESULT({ command: 'x', outcome: 'ok', message: 'ok' }));
    for (const [name, input] of [
      ['plugins.uninstall', { cwd: project, binary: join(fake, 'claude'), plugin: 'p@m', keepData: true }],
      ['plugins.enable', { cwd: project, binary: join(fake, 'claude'), plugin: 'p@m', scope: 'local' }],
      ['plugins.disable', { cwd: project, binary: join(fake, 'claude'), plugin: 'p@m' }],
      ['marketplaces.update', { cwd: project, binary: join(fake, 'claude'), name: 'm' }],
      ['marketplaces.remove', { cwd: project, binary: join(fake, 'claude'), name: 'm', scope: 'project' }],
    ] as const) await host.done((await host.call(name, input as never)).opId);
    expect(calls()).toEqual([
      'plugin marketplace add /m --scope user --json',
      'plugin update p@m --scope project --json',
      'plugin uninstall p@m --keep-data --json',
      'plugin enable p@m --scope local --json',
      'plugin disable p@m --json',
      'plugin marketplace update m --json',
      'plugin marketplace remove m --scope project --json',
    ]);
  });

  it('engine.shutdown with no session answers only once a TERM-ignoring CLI is dead', async () => {
    behave(`trap '' TERM\nsleep 30\n`);
    const host = engineHost();
    const { opId } = await host.call('plugins.install', { cwd: project, binary: join(fake, 'claude'), plugin: 'p@m' });
    await until(() => existsSync(join(fake, 'pid')) && readFileSync(join(fake, 'pid'), 'utf8').trim(), 'the pid');
    const pid = Number(readFileSync(join(fake, 'pid'), 'utf8'));
    expect(await host.call('engine.shutdown', { graceMs: 5_000 })).toEqual({ stopped: 0, forced: 0 });
    expect(() => process.kill(pid, 0)).toThrow(); // gone when shutdown answers
    expect((await host.done(opId)).outcome).toMatchObject({ ok: false, error: { code: 'cancelled', message: 'stopped with the engine host' } });
  });

  it('engine.shutdown stops a running CLI with the host', async () => {
    behave('sleep 30\n');
    const host = engineHost();
    const { opId } = await host.call('plugins.install', { cwd: project, binary: join(fake, 'claude'), plugin: 'p@m' });
    await until(() => existsSync(join(fake, 'pid')) && readFileSync(join(fake, 'pid'), 'utf8').trim(), 'the pid');
    await host.call('engine.shutdown', { graceMs: 0 });
    expect((await host.done(opId)).outcome).toMatchObject({ ok: false, error: { code: 'cancelled', message: 'stopped with the engine host' } });
  });
});

describe('the session reloads', () => {
  it('session.reloadPlugins applies a successful answer to the status; session.reloadSkills completes with the skills', async () => {
    const skills = { skills: [{ name: 'e8-probe:e8-hello', description: '(e8-probe) Says hello from the E8 probe plugin.', argumentHint: '', aliases: ['e8-hello'] }] };
    const transport = scriptedTransport({ onWrite: autoResponder(handshakeResponder({ end_session: () => null })) });
    const host = engineHost({ spawn: () => transport });
    const id = await readySession(host, transport, 'app-reloads', project);

    const reload = await host.call('session.reloadPlugins', { appSessionId: id });
    transport.answer('reload_plugins', reloadAnswer('e8-probe', 'other'));
    await until(() => host.emitted.some((e) => e.name === 'session.operation' && (e.payload as { opId: string }).opId === reload.opId), 'the reload');
    expect(statusOf(host, id).plugins.map((p) => p.name)).toEqual(['e8-probe', 'other']);

    const { opId } = await host.call('session.reloadSkills', { appSessionId: id });
    expect(transport.requestsOf('reload_skills').at(-1)!.request).toEqual({ subtype: 'reload_skills' });
    transport.answer('reload_skills', skills);
    const completion = await until(() => host.emitted.find((e) => e.name === 'session.operation' && (e.payload as { opId: string }).opId === opId), 'the skills reload');
    expect(completion.payload).toEqual({ appSessionId: id, opId, command: 'session.reloadSkills', late: false, outcome: { ok: true, value: skills } });

    const stopping = host.call('engine.shutdown', { graceMs: 5_000 });
    await until(() => transport.requestsOf('end_session').length === 1, 'end_session');
    transport.exit(0);
    await stopping;
  });
});

// P2-B start (2026-10-09): `plugins.manifest` through the host's handlers (P2-B execution document §5.5): the views read
// only under the folders this host's own last listings for the cwd named, one more listing for an item they do not name
describe('plugins.manifest (P2-B)', () => {
  const listingFrom = () =>
    behave(`case "$*" in
  "plugin list --json") cat "${fake}/rows.json";;
  "plugin marketplace list --json") cat "${fake}/markets.json";;
esac
`);
  const rows = (value: unknown) => writeFileSync(join(fake, 'rows.json'), JSON.stringify(value));
  let plugin: string;
  let market: string;
  beforeEach(() => {
    plugin = join(root, 'cache', 'p', '1.0.0');
    market = join(root, 'market');
    mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
    mkdirSync(join(plugin, 'commands'));
    writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'p', version: '1.0.0', description: 'Read from its folder' }));
    writeFileSync(join(plugin, 'commands', 'hi.md'), '---\ndescription: Says hi\n---\n');
    writeFileSync(join(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { s: { command: 'node', env: { TOKEN: 'sk-secret-ipc' } } } }));
    mkdirSync(join(market, '.claude-plugin'), { recursive: true });
    writeFileSync(join(market, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'm', plugins: [{ name: 'p', source: './p', version: '1.1.0' }, { name: 'q', source: './q', description: 'Offered' }] }));
    writeFileSync(join(fake, 'markets.json'), JSON.stringify([{ name: 'm', source: 'directory', path: market, installLocation: market }]));
    rows([{ id: 'p@m', version: '1.0.0', scope: 'user', enabled: true, installPath: plugin, mcpServers: { s: { env: { TOKEN: 'sk-secret-row' } } } }]);
    listingFrom();
  });
  const P = { kind: 'installation', id: 'p@m', scope: 'user', projectPath: null } as const;

  it('answers views of what the last listings named, and lists once more for an item they do not name', async () => {
    const host = engineHost();
    await host.call('plugins.list', { cwd: project });
    await host.call('marketplaces.list', { cwd: project });
    const before = calls().length;
    const { manifests } = await host.call('plugins.manifest', { cwd: project, items: [P, { kind: 'installation', id: 'nope@m', scope: 'user', projectPath: null }, { kind: 'available', pluginId: 'q@m' }] });
    expect(manifests.map((m) => m.state)).toEqual(['read', 'unknown', 'read']);
    expect(manifests[0]).toMatchObject({ key: P, name: 'p', version: '1.0.0', marketplaceVersion: '1.1.0', description: 'Read from its folder', components: { commands: [{ name: 'hi', description: 'Says hi' }], mcpServers: [{ name: 's', transport: 'stdio' }] } });
    expect(manifests[2]).toMatchObject({ name: 'q', description: 'Offered' });
    expect(calls().slice(before)).toEqual(['plugin list --json']); // one more plugin listing for the whole call, none of the marketplaces
    expect(JSON.stringify(manifests)).not.toContain('sk-secret');
  });

  it('the next listing replaces the memory: an uninstalled plugin’s folder is no longer read', async () => {
    const host = engineHost();
    await host.call('plugins.list', { cwd: project });
    expect((await host.call('plugins.manifest', { cwd: project, items: [P] })).manifests[0].state).toBe('read');
    rows([]);
    await host.call('plugins.list', { cwd: project });
    expect((await host.call('plugins.manifest', { cwd: project, items: [P] })).manifests[0].state).toBe('unknown');
    // and the memory is the cwd's: another directory's listing admits nothing here
    rows([{ id: 'p@m', version: '1.0.0', scope: 'user', enabled: true, installPath: plugin }]);
    const other = join(root, 'other');
    mkdirSync(other);
    await host.call('plugins.list', { cwd: other });
    rows([]);
    expect((await host.call('plugins.manifest', { cwd: project, items: [P] })).manifests[0].state).toBe('unknown');
  });

  it('a cwd never listed is listed first', async () => {
    const host = engineHost();
    const { manifests } = await host.call('plugins.manifest', { cwd: project, items: [P] });
    expect(manifests[0]).toMatchObject({ state: 'read', marketplaceVersion: '1.1.0' });
    expect(calls()).toEqual(['plugin list --json', 'plugin marketplace list --json']);
  });
});
// P2-B end
