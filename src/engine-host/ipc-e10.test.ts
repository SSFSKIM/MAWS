// E10's connect burst through the engine host's handlers (E10 execution document, §Design 3 "Connect", Task 2.1): the one
// hook the engine ipc registers with the runtime republishes every row in the table's order (status, queue, broker
// items, catalogue, then the events no client received), then the budget, `plugins.changed` and each running plugin
// operation's latest event. The fake client reports each emit written while connected and dropped while not, as the
// runtime's emit does.
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import type { CommandInput, CommandName, CommandOutput, EventName } from '@shared/ipc/schema';
import type { SupervisorStatus } from '@shared/ipc/schema/host';
import type { PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { ENGINE_BIN, ENGINE_VERSION } from '../../test/support/engine-pin';
import { TESTED_ENGINE_VERSION } from './engine-compat';
import { registerEngineIpc, type EngineIpcDeps } from './ipc';
import { RELAY_URL } from './launch';
import { KILL_GRACE_MS, SETTLE_MS } from './plugins/runner';
import { Supervision, type SupervisorExit } from './supervision';

const REPO_ROOT = resolve(__dirname, '../..');
const OK_RELAY = { url: RELAY_URL, ok: true, status: 200, latencyMs: 2, checkedAt: '2026-10-06T10:00:00.000Z', error: null };
const INIT = 'spikes/protocol-probe/fixtures/init.jsonl';

let root: string;
beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'maws-ipc-e10-')));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

const spec = (appSessionId: string): LaunchSpec =>
  LaunchSpecSchema.parse({
    appSessionId, cwd: REPO_ROOT, additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: INIT, inheritGrantsFrom: null,
  });

type Emitted = { name: EventName; payload: unknown };

function engineHost(deps: Partial<EngineIpcDeps> = {}) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const emitted: Emitted[] = [];
  const client = { connected: true };
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues).slice(0, 400)}`);
    if (!client.connected) return false;
    emitted.push({ name, payload });
    return true;
  };
  const hooks: (() => void)[] = [];
  const ipc = registerEngineIpc(on, emit, {
    userData: root, replayEnabled: true, cwd: REPO_ROOT,
    binaryProbe: async () => ({ path: ENGINE_BIN, testedVersion: TESTED_ENGINE_VERSION, version: ENGINE_VERSION, ok: true, error: null }),
    checkRelay: async () => OK_RELAY,
    onConnect: (hook) => void hooks.push(hook),
    ...deps,
  });
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const value = await handlers.get(name)!(input);
    const checked = validateCommandOutput(name, value);
    if (!checked.ok) throw new Error(`invalid output of ${name}: ${checked.error.message}`);
    return checked.value;
  };
  const of = (appSessionId: string) => (e: Emitted) => (e.payload as { appSessionId?: string }).appSessionId === appSessionId;
  const events = (appSessionId: string): SessionEvent[] => emitted.filter((e) => e.name === 'session.eventBatch' && of(appSessionId)(e)).flatMap((e) => (e.payload as { events: SessionEvent[] }).events);
  const statuses = (appSessionId: string): EngineSessionStatus[] => emitted.filter((e) => e.name === 'session.status' && of(appSessionId)(e)).map((e) => (e.payload as { status: EngineSessionStatus }).status);
  return { emitted, client, hooks, ipc, call, events, statuses };
}

async function until(check: () => unknown, what: string, ms = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('the engine host’s connect burst (E10)', () => {
  it('registers one connect hook; with no rows it sends the budget and plugins.changed', () => {
    const host = engineHost();
    expect(host.hooks).toHaveLength(1);
    host.hooks[0]!();
    expect(host.emitted.map((e) => e.name)).toEqual(['engine.budget', 'plugins.changed']);
    expect(host.emitted[0]!.payload).toEqual(host.ipc.table.budgetState());
  });

  it('republishes every row in the table’s order with the events no client received, once, then the host’s state', async () => {
    const host = engineHost();
    for (const id of ['app-burst-a', 'app-burst-b']) {
      await host.call('session.launch', { spec: spec(id) });
      await until(() => host.statuses(id).some((s) => s.process === 'ready'), `${id} ready`);
    }
    await new Promise((r) => setTimeout(r, 40)); // every pending batch written
    const before = host.events('app-burst-a').length;

    host.client.connected = false; // the app quits, keeping its sessions
    await host.call('session.stop', { appSessionId: 'app-burst-a' as AppSessionId, reason: 'stop' });
    await new Promise((r) => setTimeout(r, 40));
    host.emitted.length = 0;
    host.client.connected = true; // a client connects and says ready
    host.hooks[0]!();

    const rowOf = (e: Emitted) => (e.payload as { appSessionId?: string }).appSessionId ?? null;
    expect(host.emitted.map((e) => `${rowOf(e) ?? '-'} ${e.name}`)).toEqual([
      'app-burst-a session.status', 'app-burst-a session.queue', 'app-burst-a session.brokerItems', 'app-burst-a session.catalogChanged', 'app-burst-a session.eventBatch',
      'app-burst-b session.status', 'app-burst-b session.queue', 'app-burst-b session.brokerItems', 'app-burst-b session.catalogChanged',
      '- engine.budget', '- plugins.changed',
    ]);
    expect(host.statuses('app-burst-a')).toMatchObject([{ process: 'exited', exit: { reason: 'stop' } }]);
    const tail = host.events('app-burst-a');
    expect(tail.map((e) => e.kind)).toContain('process.exited');
    // the tail is exactly what streamed while no client was connected: with what was delivered before, the launch whole
    const whole = (await host.call('session.events', { appSessionId: 'app-burst-a' as AppSessionId, afterSeq: null, limit: null })).events;
    expect(whole.slice(before).map((e) => e.id)).toEqual(tail.map((e) => e.id));

    host.emitted.length = 0;
    host.hooks[0]!(); // a second connect: the state again, no event twice
    expect(host.emitted.filter((e) => e.name === 'session.eventBatch')).toEqual([]);
    expect(host.emitted.filter((e) => e.name === 'session.status')).toHaveLength(2);
    await host.ipc.table.shutdown({ graceMs: 0 });
  });

  // Task 2.1's review: one row whose republish throws must not cost the others, the budget or the plugin events
  it('a row whose republish throws is logged and skipped; the rest of the burst still goes', async () => {
    const lines: string[] = [];
    const host = engineHost({ log: (line) => void lines.push(line) });
    for (const id of ['app-throw-a', 'app-throw-b']) {
      await host.call('session.launch', { spec: spec(id) });
      await until(() => host.statuses(id).some((s) => s.process === 'ready'), `${id} ready`);
    }
    const [a] = host.ipc.table.list();
    vi.spyOn(a!, 'catalog').mockImplementation(() => {
      throw new Error('boom');
    });
    host.emitted.length = 0;
    host.hooks[0]!();
    const rowOf = (e: Emitted) => (e.payload as { appSessionId?: string }).appSessionId ?? '-';
    expect(host.emitted.map((e) => `${rowOf(e)} ${e.name}`)).toEqual([
      'app-throw-b session.status', 'app-throw-b session.queue', 'app-throw-b session.brokerItems', 'app-throw-b session.catalogChanged',
      '- engine.budget', '- plugins.changed',
    ]);
    expect(lines).toContainEqual(expect.stringContaining('the connect burst skipped app-throw-a: boom'));
    await host.ipc.table.shutdown({ graceMs: 0 });
  });

  it('ends with the latest event of each running plugin operation', async () => {
    const fake = join(root, 'fake');
    mkdirSync(fake);
    writeFileSync(join(fake, 'claude'), `#!/bin/sh\necho "Cloning" >&2\nwhile [ ! -f "${fake}/go" ]; do sleep 0.02; done\necho '{"command":"install","outcome":"ok","message":"done"}'\n`);
    chmodSync(join(fake, 'claude'), 0o755);
    const host = engineHost({
      binaryProbe: async () => ({ path: join(fake, 'claude'), testedVersion: TESTED_ENGINE_VERSION, version: TESTED_ENGINE_VERSION, ok: true, error: null }),
      captureEnv: async () => ({ PATH: '/usr/bin:/bin', HOME: root }),
      pluginsTimers: { setTimeout: (fn, ms) => setTimeout(fn, ms === SETTLE_MS ? 5 : ms === KILL_GRACE_MS ? 100 : ms), clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout) },
    });
    const { opId } = await host.call('plugins.install', { cwd: root, binary: join(fake, 'claude'), plugin: 'p@m' });
    await until(() => host.emitted.some((e) => e.name === 'plugins.operation' && (e.payload as PluginsOperationEvent).line === 'Cloning'), 'the output line');
    host.emitted.length = 0;
    host.hooks[0]!();
    expect(host.emitted.map((e) => e.name)).toEqual(['engine.budget', 'plugins.changed', 'plugins.operation']);
    expect(host.emitted[2]!.payload).toEqual({ opId, action: 'install', target: 'p@m', phase: 'output', line: 'Cloning' });
    writeFileSync(join(fake, 'go'), '');
    await until(() => host.emitted.some((e) => e.name === 'plugins.operation' && (e.payload as PluginsOperationEvent).phase === 'done'), 'done');
    await host.ipc.plugins.stop(100);
  });
});

// E10 Task 2.3: the supervisor's life over the real engine ipc and process table (supervision.ts), as the detached
// entry composes them: with no client, a replay row that holds nothing is released as `idle` after the idle time, and
// the supervisor then idles out; its status follows each step.
describe('the supervisor’s clocks over the engine host (E10)', () => {
  // Real timers under a loaded suite: each clock is asserted by a lower bound (it never fires early) and waited for in a
  // window far above its time, so a slow machine delays the test rather than failing it.
  it('releases an idle kept row as idle with no client, then exits after the idle time', { timeout: 30_000 }, async () => {
    const IDLE_MS = 200;
    const host = engineHost();
    const identity = { pid: process.pid, startedAt: '2026-10-06T10:00:00.000Z', buildId: 'b', protocol: 1, wire: 'w', socketPath: '/s', logPath: '/l' };
    const statuses: SupervisorStatus[] = [];
    const supervision = new Supervision({
      mode: 'detached', identity, table: host.ipc.table, plugins: host.ipc.plugins, shutdown: host.ipc.shutdown,
      emit: (status) => statuses.push(status) > 0, log: () => {},
    });
    const commands = new Map<string, (input: unknown) => Promise<unknown>>();
    supervision.register((name, handler) => void commands.set(name, handler as (input: unknown) => Promise<unknown>), { onConnect: () => {} });
    const exits: { reason: SupervisorExit; at: number }[] = [];
    supervision.started(identity, (reason) => void exits.push({ reason, at: Date.now() }));
    supervision.clientChanged(true);
    await commands.get('host.configure')!({ idleExitMs: IDLE_MS }); // main's push
    await host.call('session.launch', { spec: spec('app-idle') });
    await until(() => host.statuses('app-idle').some((s) => s.process === 'ready'), 'ready', 10_000);
    await new Promise((r) => setTimeout(r, 3 * IDLE_MS)); // past the idle time, however late the timer runs
    expect(host.ipc.table.get('app-idle' as AppSessionId)!.lifecycle).toBe('ready'); // a client is connected: kept
    expect(statuses.at(-1)).toMatchObject({ liveSessions: 1, rows: 1, idleExitMs: IDLE_MS, idleExitAt: null });

    const left = Date.now();
    supervision.clientChanged(false); // the app quits, keeping its session
    await until(() => host.ipc.table.get('app-idle' as AppSessionId)!.lifecycle === 'exited', 'the idle release', 10_000);
    const exited = host.ipc.table.get('app-idle' as AppSessionId)!.status();
    expect(exited.exit).toMatchObject({ reason: 'idle', release: null });
    expect(Date.parse(exited.exit!.at) - left).toBeGreaterThanOrEqual(IDLE_MS - 5);
    // the clock armed at the release (the exit itself is checked by its lower bound below, not by its absence here)
    expect(statuses).toContainEqual(expect.objectContaining({ liveSessions: 0, rows: 1, idleExitAt: expect.any(String) }));
    await until(() => exits.length === 1, 'the idle exit', 10_000);
    expect(exits[0]!.reason).toBe('idle');
    expect(exits[0]!.at - Date.parse(exited.exit!.at)).toBeGreaterThanOrEqual(IDLE_MS - 5);
  });
});
