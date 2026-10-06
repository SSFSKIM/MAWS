// E10's connect burst through the engine host's handlers (E10 execution document, §Design 3 "Connect", Task 2.1): the one
// hook the engine ipc registers with the runtime republishes every row in the table's order (status, queue, broker
// items, catalogue, then the events no client received), then the budget, `plugins.changed` and each running plugin
// operation's latest event. The fake client reports each emit written while connected and dropped while not, as the
// runtime's emit does.
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import type { CommandInput, CommandName, CommandOutput, EventName } from '@shared/ipc/schema';
import type { PluginsOperationEvent } from '@shared/ipc/schema/plugins';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { ENGINE_BIN, ENGINE_VERSION } from '../../test/support/engine-pin';
import { TESTED_ENGINE_VERSION } from './engine-compat';
import { registerEngineIpc, type EngineIpcDeps } from './ipc';
import { RELAY_URL } from './launch';
import { KILL_GRACE_MS, SETTLE_MS } from './plugins/runner';

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
