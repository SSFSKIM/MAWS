// C10's engine-host commands (C10 execution document, X2 additions): `engine.models` over the catalogue cache and
// `session.forget`, the whole erase behind delete conversation.
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import { HostCommandError, type HostEmit, type HostOn } from '@shared/host/runtime';
import { type CommandInput, type CommandName, type CommandOutput, type EventName } from '@shared/ipc/schema';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import { C10_ENGINE_HOST_DEADLINES, registerEngineIpc } from './ipc';

const REPO_ROOT = resolve(__dirname, '../..');

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-ipc-c10-'));
});
afterEach(async () => {
  await rm(userData, { recursive: true, force: true, maxRetries: 10 });
});

const spec = (appSessionId: string, replay: string): LaunchSpec =>
  LaunchSpecSchema.parse({
    appSessionId, cwd: '/tmp/maws-ipc-c10', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay, inheritGrantsFrom: null,
  });

function engineHost() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const emitted: { name: EventName; payload: unknown }[] = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}`);
    emitted.push({ name, payload });
  };
  const ipc = registerEngineIpc(on, emit, { userData, replayEnabled: true, cwd: REPO_ROOT });
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const value = await handlers.get(name)!(input);
    const checked = validateCommandOutput(name, value);
    if (!checked.ok) throw new Error(`invalid output of ${name}: ${checked.error.message}`);
    return checked.value;
  };
  return { handlers, emitted, ipc, call };
}

async function until(check: () => boolean, what: string, ms = 3_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('engine.models', () => {
  it('answers builtin with no cache, cached after an initialize response was observed, live after refresh against a ready session', async () => {
    const host = engineHost();
    expect(C10_ENGINE_HOST_DEADLINES).toEqual({ 'engine.models': 'bounded', 'session.forget': 'immediate' });
    expect(await host.call('engine.models', { refresh: false })).toMatchObject({ source: 'builtin', at: null });
    expect(await host.call('engine.models', { refresh: true })).toMatchObject({ source: 'builtin' }); // nothing ready to ask

    const reads = 'app-models-reads' as AppSessionId;
    await host.call('session.launch', { spec: spec(reads, 'spikes/protocol-probe/fixtures/reads.jsonl') });
    await until(() => host.ipc.table.get(reads)?.lifecycle === 'ready', 'ready');
    const cached = await host.call('engine.models', { refresh: false });
    expect(cached.source).toBe('cached');
    expect(cached.models.map((m) => m.value)).toContain('claude/astra'); // the routed launch's aliases arrive with its initialize
    await host.call('session.stop', { appSessionId: reads, reason: 'stop' });

    const live = 'app-models-live' as AppSessionId;
    await host.call('session.launch', { spec: spec(live, 'test/fixtures/engine/list-models.jsonl') });
    await until(() => host.ipc.table.get(live)?.lifecycle === 'ready', 'ready');
    const answered = await host.call('engine.models', { refresh: true });
    expect(answered.source).toBe('live');
    expect(answered.models.map((m) => m.value)).toContain('claude/sol');
    expect((await host.call('engine.models', { refresh: false })).source).toBe('cached'); // the live answer is the cache now
    await host.ipc.table.shutdown({ graceMs: 0 });
  });
});

describe('session.forget', () => {
  it('removes the state file and the journal directory, emits session.forgotten, and refuses already_live', async () => {
    const host = engineHost();
    const id = 'app-forget' as AppSessionId;
    await host.call('session.launch', { spec: spec(id, 'spikes/protocol-probe/fixtures/reads.jsonl') });
    await until(() => host.ipc.table.get(id)?.lifecycle === 'ready', 'ready');
    await expect(host.handlers.get('session.forget')!({ appSessionId: id })).rejects.toEqual(new HostCommandError({ code: 'internal', message: 'already_live: process is ready' }));

    await host.call('session.stop', { appSessionId: id, reason: 'stop' });
    const state = join(userData, 'engine-host', 'state', `${id}.json`);
    const journal = join(userData, 'engine-host', 'journal', id);
    await until(() => existsSync(state), 'the state file');
    expect(existsSync(journal)).toBe(true);
    await host.call('session.forget', { appSessionId: id });
    expect(existsSync(state)).toBe(false);
    expect(existsSync(journal)).toBe(false);
    expect(host.emitted.filter((e) => e.name === 'session.forgotten').map((e) => e.payload)).toEqual([{ appSessionId: id }]);
    expect(host.ipc.table.get(id)).toBeUndefined(); // the host keeps nothing of a forgotten session
    await expect(host.handlers.get('session.status')!({ appSessionId: id })).rejects.toEqual(new HostCommandError({ code: 'internal', message: `unknown session ${id}` }));

    await host.call('session.forget', { appSessionId: 'app-never-launched' }); // nothing to erase is not an error
    await expect(host.handlers.get('session.forget')!({ appSessionId: '../escape' })).rejects.toBeInstanceOf(HostCommandError);
  });
});
