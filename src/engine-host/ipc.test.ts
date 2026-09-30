import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import { OPERATION_COMMANDS } from '@shared/engine/operations';
import type { EngineSessionStatus } from '@shared/engine/status';
import { createHostRuntime, HostCommandError, type HostEmit, type HostOn, type HostPort } from '@shared/host/runtime';
import { commands, type CommandInput, type CommandName, type CommandOutput, type EventName } from '@shared/ipc/schema';
import { C3_ENGINE_COMMANDS } from '@shared/ipc/schema/engine';
import { C3_SESSION_COMMANDS } from '@shared/ipc/schema/session';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import type { BinaryCheck } from './binary-info';
import { autoResponder, scriptedTransport, type ScriptedTransport } from './conformance/scripted-transport';
import { handshakeResponder, INIT_RESPONSE } from './conformance/session-harness';
import { REQUEST_TIMEOUT_MS } from './controls';
import { bounded, DEADLINE_SHAPES, PRE_SPAWN_BOUND_MS, registerEngineIpc, type EngineIpcDeps } from './ipc';
import { MemoryAppendBudgetSpent } from './memory-append';
import { ENGINE_BIN, ENGINE_VERSION, RELAY_URL } from './launch';
// C11 start
import { createBinaryProbe } from './binary-info';
import { getBinaryConfig, setBinaryConfig, type LaunchPlan } from './launch';
// C11 end
import { LADDER_MS } from './session';
// C12 start
import { readFileSync } from 'node:fs';
import { ProcessTable } from './process-table';
// C12 end
import { FileSessionStateStore } from './store/file-session-state-store';
import { MemorySessionStateStore } from './store/memory-session-state-store';

const REPO_ROOT = resolve(__dirname, '../..');
const ROUTER_TIMEOUT_MS = 10_000; // C1's supervisor (src/main/hosts/supervisor.ts REQUEST_TIMEOUT_MS), which imports electron
const OK_BINARY: BinaryCheck = { path: ENGINE_BIN, expectedVersion: ENGINE_VERSION, version: ENGINE_VERSION, ok: true, error: null, problem: null };
const OK_RELAY = { url: RELAY_URL, ok: true, status: 200, latencyMs: 2, checkedAt: '2026-09-28T10:00:00.000Z', error: null };

let userData: string;
beforeEach(async () => {
  userData = await mkdtemp(join(tmpdir(), 'maws-ipc-'));
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(userData, { recursive: true, force: true, maxRetries: 10 }); // a queue save settling after the exit may still be renaming
});

function spec(overrides: Partial<LaunchSpec> = {}): LaunchSpec {
  return LaunchSpecSchema.parse({
    appSessionId: 'app-ipc', cwd: '/tmp/maws-ipc', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null /* C10 */, replay: null, ...overrides,
  });
}

// The engine host's handlers, called directly (the runtime's input validation is C1's and tested there); every emitted
// event is validated against X2 as the runtime would.
function engineHost(deps: Partial<EngineIpcDeps> = {}) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const emitted: { name: EventName; payload: unknown }[] = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues).slice(0, 400)}`);
    emitted.push({ name, payload });
  };
  const ipc = registerEngineIpc(on, emit, { userData, replayEnabled: true, cwd: REPO_ROOT, ...deps });
  const call = async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandOutput<N>> => {
    const value = await handlers.get(name)!(input);
    const checked = validateCommandOutput(name, value);
    if (!checked.ok) throw new Error(`invalid output of ${name}: ${checked.error.message}`);
    return checked.value;
  };
  const events = (appSessionId: string): SessionEvent[] =>
    emitted.filter((e) => e.name === 'session.eventBatch' && (e.payload as { appSessionId: string }).appSessionId === appSessionId).flatMap((e) => (e.payload as { events: SessionEvent[] }).events);
  const statuses = (appSessionId: string): EngineSessionStatus[] =>
    emitted.filter((e) => e.name === 'session.status' && (e.payload as { appSessionId: string }).appSessionId === appSessionId).map((e) => (e.payload as { status: EngineSessionStatus }).status);
  return { handlers, emitted, ipc, call, events, statuses };
}

async function until(check: () => boolean, what: string, ms = 3_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

const replaySpec = (appSessionId: string, replay: string) => spec({ appSessionId: appSessionId as AppSessionId, replay });

describe('x2 deadlines fit the bridge', () => {
  it('every C3 engine-host command has a handler and exactly one deadline shape; operations are the five long ones', () => {
    const { handlers } = engineHost();
    const c3 = [...C3_SESSION_COMMANDS, ...C3_ENGINE_COMMANDS];
    expect(Object.keys(DEADLINE_SHAPES).sort()).toEqual([...c3].sort());
    for (const name of c3) expect(handlers.has(name), name).toBe(true);
    for (const name of handlers.keys()) expect(commands[name as CommandName].owner, name).toBe('engine-host');
    expect(Object.entries(DEADLINE_SHAPES).filter(([, shape]) => shape === 'operation').map(([name]) => name).sort()).toEqual([...OPERATION_COMMANDS].sort());
    expect(DEADLINE_SHAPES).toMatchObject({ 'session.launch': 'immediate', 'session.send': 'immediate', 'session.answer': 'immediate', 'session.bash': 'immediate', 'session.getUsage': 'bounded', 'session.stop': 'bounded', 'engine.shutdown': 'bounded', 'session.interrupt': 'bounded' });
  });

  it('every bounded wait fits under the router\'s 10 s with the two IPC hops to spare', () => {
    for (const klass of ['read', 'mutate', 'interrupt'] as const) expect(REQUEST_TIMEOUT_MS[klass]).toBeLessThanOrEqual(8_000);
    expect(LADDER_MS.endSession + LADDER_MS.term + LADDER_MS.kill).toBeLessThanOrEqual(8_000);
    expect(PRE_SPAWN_BOUND_MS).toBeLessThanOrEqual(8_000); // session.launch's checks run in parallel before the spawn
    expect(REQUEST_TIMEOUT_MS.long).toBeGreaterThan(ROUTER_TIMEOUT_MS); // which is why the long subtypes are operations
  });

  it('an unanswered read answers the host\'s typed timeout at 8 s through the host runtime, not the router\'s', async () => {
    const posted: unknown[] = [];
    let deliver!: (data: unknown) => void;
    const port: HostPort = { postMessage: (m) => void posted.push(m), start: () => {}, on: (_e, l) => void (deliver = (data) => l({ data })) };
    let ipc!: ReturnType<typeof registerEngineIpc>;
    createHostRuntime((on, emit) => (ipc = registerEngineIpc(on, emit, { userData, replayEnabled: true, cwd: REPO_ROOT }))).serve(port);
    deliver({ t: 'req', id: '1', name: 'session.launch', input: { spec: replaySpec('app-unanswered', 'test/fixtures/engine/unanswered-read.jsonl') } });
    await until(() => ipc.table.get('app-unanswered' as AppSessionId)?.lifecycle === 'ready', 'ready');
    expect(posted[0]).toMatchObject({ t: 'res', id: '1', ok: true, value: { status: 'launching' } });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    deliver({ t: 'req', id: '2', name: 'session.getUsage', input: { appSessionId: 'app-unanswered' } });
    await vi.advanceTimersByTimeAsync(7_999);
    expect(posted.filter((m) => (m as { id?: string }).id === '2')).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(posted.filter((m) => (m as { id?: string }).id === '2')).toEqual([{ t: 'res', id: '2', ok: false, error: { code: 'timeout', message: 'get_usage unanswered after 8 s' } }]);
    vi.useRealTimers();
    await ipc.table.shutdown({ graceMs: 0 });
  });

  it('a # append refused for its spent budget answers the typed timeout, like a control deadline', async () => {
    await expect(bounded(async () => Promise.reject(new MemoryAppendBudgetSpent(8_000)))).rejects.toEqual(new HostCommandError({ code: 'timeout', message: '# ran past its 8 s budget; nothing was written' }));
  });

  it('a command for an unknown session throws the typed internal error naming it', async () => {
    const { handlers } = engineHost();
    await expect(handlers.get('session.status')!({ appSessionId: 'nobody' })).rejects.toEqual(new HostCommandError({ code: 'internal', message: 'unknown session nobody' }));
    await expect(handlers.get('session.getUsage')!({ appSessionId: 'nobody' })).rejects.toBeInstanceOf(HostCommandError);
  });
});

describe('engine host X2 surface', () => {
  // M5 review (Critical): appSessionId becomes a path component and archive deletes recursively, so a traversal-shaped id
  // is refused before any filesystem access.
  it('refuses a traversal-shaped appSessionId on launch, archive and queue.list with invalid_input, touching nothing on disk', async () => {
    const { mkdirSync, readdirSync, writeFileSync, existsSync } = await import('node:fs');
    const inside = join(userData, 'profile');
    mkdirSync(inside);
    writeFileSync(join(userData, 'victim.txt'), 'keep');
    const spawn = vi.fn();
    const host = engineHost({ userData: inside, spawn, binaryProbe: async () => OK_BINARY, checkRelay: async () => OK_RELAY, captureEnv: async () => ({ PATH: '/usr/bin' }) });
    const invalid = new HostCommandError({ code: 'invalid_input', message: 'invalid appSessionId' });
    // (an empty id never gets here: X1's schema refuses it at the router)
    for (const bad of ['../..', '..', '.', '../victim', 'a/b', '.hidden', 'x'.repeat(129)]) {
      await expect(host.handlers.get('session.launch')!({ spec: spec({ appSessionId: bad as AppSessionId }) }), bad).rejects.toEqual(invalid);
      await expect(host.handlers.get('session.launch')!({ spec: replaySpec(bad, 'spikes/protocol-probe/fixtures/reads.jsonl') }), bad).rejects.toEqual(invalid);
      await expect(host.handlers.get('session.stop')!({ appSessionId: bad, reason: 'archive' }), bad).rejects.toEqual(invalid);
      await expect(host.handlers.get('session.queue.list')!({ appSessionId: bad }), bad).rejects.toEqual(invalid);
    }
    expect(spawn).not.toHaveBeenCalled();
    expect(readdirSync(inside)).toEqual([]); // no journal, no state directory was created
    expect(existsSync(join(userData, 'victim.txt'))).toBe(true);
    // the store refuses on its own too (defence in depth)
    const store = new FileSessionStateStore(inside);
    await expect(store.forget('../..' as AppSessionId)).rejects.toEqual(invalid);
    await expect(store.forgetJournal('../..' as AppSessionId)).rejects.toEqual(invalid);
    await expect(store.saveQueue('../x' as AppSessionId, { entries: [], paused: false })).rejects.toEqual(invalid);
    expect(readdirSync(userData).sort()).toEqual(['profile', 'victim.txt']);
    // an ordinary id with dots, dashes and underscores is fine
    expect(await host.call('session.launch', { spec: replaySpec('app.v2_x-1', 'spikes/protocol-probe/fixtures/reads.jsonl') })).toMatchObject({ status: 'launching' });
    await until(() => host.statuses('app.v2_x-1').some((st) => st.process === 'ready'), 'ready');
    await host.ipc.table.shutdown({ graceMs: 0 });
  });

  it('session.launch refuses a replay without MAWS_ENGINE_REPLAY, a protected settings key and a pinned id on a plain resume, without spawning', async () => {
    const spawn = vi.fn();
    const off = engineHost({ replayEnabled: false, spawn });
    expect(await off.call('session.launch', { spec: replaySpec('app-r', 'spikes/protocol-probe/fixtures/init.jsonl') })).toEqual({ status: 'refused', reason: 'replay_disabled', message: expect.stringContaining('MAWS_ENGINE_REPLAY') });
    const on = engineHost({ spawn, binaryProbe: async () => OK_BINARY, checkRelay: async () => OK_RELAY, captureEnv: async () => ({ PATH: '/usr/bin' }) });
    expect(await on.call('session.launch', { spec: spec({ extraSettings: { dialogExpiry: '5m' } }) })).toEqual({ status: 'refused', reason: 'settings_conflict', message: expect.stringContaining('dialogExpiry') });
    const resume = spec({ resume: { sessionId: '44444444-4444-4444-8444-444444444444' as never, fork: false }, sessionId: '33333333-3333-4333-8333-333333333333' as never });
    expect(await on.call('session.launch', { spec: resume })).toEqual({ status: 'refused', reason: 'settings_conflict', message: expect.stringContaining('sessionId') });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('session.launch refuses a missing binary and a wrong version, and answers relay_unreachable for a gateway launch, without spawning', async () => {
    const spawn = vi.fn();
    const base = { spawn, captureEnv: async () => ({ PATH: '/usr/bin' }), checkRelay: async () => OK_RELAY };
    const missing = engineHost({ ...base, binaryProbe: async () => ({ ...OK_BINARY, ok: false, version: null, error: `no executable engine binary at ${ENGINE_BIN}`, problem: 'missing' }) });
    expect(await missing.call('session.launch', { spec: spec() })).toEqual({ status: 'refused', reason: 'binary_missing', message: `no executable engine binary at ${ENGINE_BIN}` });
    const old = engineHost({ ...base, binaryProbe: async () => ({ ...OK_BINARY, ok: false, version: '2.1.200', error: 'wrong', problem: 'version' }) });
    expect(await old.call('session.launch', { spec: spec() })).toMatchObject({ status: 'refused', reason: 'binary_version' });
    const down = { ...OK_RELAY, ok: false, status: null, latencyMs: null, error: 'connect ECONNREFUSED 127.0.0.1:8641' };
    const relay = engineHost({ ...base, binaryProbe: async () => OK_BINARY, checkRelay: async () => down });
    expect(await relay.call('session.launch', { spec: spec() })).toEqual({ status: 'relay_unreachable', health: down });
    expect(spawn).not.toHaveBeenCalled();
    // a direct launch never asks the relay
    const checkRelay = vi.fn(async () => down);
    const transport = scriptedTransport({ onWrite: autoResponder(handshakeResponder()) });
    const direct = engineHost({ ...base, binaryProbe: async () => OK_BINARY, checkRelay, spawn: () => transport });
    expect(await direct.call('session.launch', { spec: spec({ gateway: 'direct' }) })).toMatchObject({ status: 'launching', session: { appSessionId: 'app-ipc', process: 'starting', cwd: '/tmp/maws-ipc' } });
    expect(checkRelay).not.toHaveBeenCalled();
    transport.exit(0);
    await direct.ipc.table.get('app-ipc' as AppSessionId)!.exited;
  });

  it('a replayed permission round trip through the handlers: ready and routed, the request, the answer, the turn, the snapshot, stop', async () => {
    const host = engineHost();
    const id = 'app-perm';
    const launched = await host.call('session.launch', { spec: replaySpec(id, 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl') });
    expect(launched).toMatchObject({ status: 'launching' });
    expect(await host.call('session.launch', { spec: replaySpec(id, 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl') })).toEqual({ status: 'refused', reason: 'already_live', message: expect.stringMatching(/^process is /) });
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    expect((await host.call('engine.sessions', undefined)).find((s) => s.appSessionId === id)).toMatchObject({ process: 'ready', gateway: { verified: 'routed', baseUrl: RELAY_URL } });

    expect(await host.call('session.send', { appSessionId: id as AppSessionId, content: 'Use Bash to run exactly git log --oneline. Then say DONE.' })).toMatchObject({ disposition: 'sent', messageUuid: expect.any(String), queueId: expect.any(String) });
    await until(() => host.events(id).some((e) => e.kind === 'permission.requested'), 'permission.requested');
    const requested = host.events(id).find((e) => e.kind === 'permission.requested') as Extract<SessionEvent, { kind: 'permission.requested' }>;
    expect(requested).toMatchObject({ decisionReasonType: 'rule', toolUseId: 'toolu_01RWDevVWYVi2Tn3y58pxRS3' });
    const items = host.emitted.filter((e) => e.name === 'session.brokerItems').at(-1)!.payload as { items: { kind: string; state: string }[] };
    expect(items.items).toMatchObject([{ kind: 'permission', state: 'pending' }]);
    expect(await host.call('session.pendingRequest', { appSessionId: id as AppSessionId, requestId: requested.requestId })).toEqual({ event: requested });
    expect(await host.call('session.answer', { appSessionId: id as AppSessionId, requestId: 'no-such-request' as never, answer: { kind: 'permission', decision: 'deny' } })).toEqual({ outcome: 'not_pending' });
    expect(await host.call('session.answer', { appSessionId: id as AppSessionId, requestId: requested.requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } })).toEqual({ outcome: 'delivered' });
    await until(() => host.events(id).some((e) => e.kind === 'turn.ended'), 'turn.ended');
    const ended = host.events(id).find((e) => e.kind === 'turn.ended') as Extract<SessionEvent, { kind: 'turn.ended' }>;
    expect(ended).toMatchObject({ terminalReason: 'completed', origin: 'human' });
    await until(() => host.ipc.table.get(id as AppSessionId)!.status().turn === null && host.statuses(id).at(-1)?.gateway.verified === 'routed', 'the post-turn re-read');

    // a status never runs ahead of the events that caused it
    let seen = 0;
    for (const { name, payload } of host.emitted) {
      if (name === 'session.eventBatch' && (payload as { appSessionId: string }).appSessionId === id) seen = Math.max(seen, ...(payload as { events: SessionEvent[] }).events.map((e) => e.seq ?? 0));
      if (name === 'session.status' && (payload as { appSessionId: string }).appSessionId === id) expect((payload as { status: EngineSessionStatus }).status.lastEventSeq).toBeLessThanOrEqual(seen);
    }

    const live = host.events(id);
    expect(await host.call('session.events', { appSessionId: id as AppSessionId, afterSeq: null, limit: null })).toEqual({ events: live, lastSeq: live.at(-1)!.seq, complete: true });
    const mid = requested.seq!;
    expect((await host.call('session.events', { appSessionId: id as AppSessionId, afterSeq: mid, limit: null })).events).toEqual(live.filter((e) => e.seq! > mid));

    expect(await host.call('session.stop', { appSessionId: id as AppSessionId, reason: 'stop' })).toEqual({ exited: true, code: 0, signal: null });
    expect((await host.call('engine.sessions', undefined)).find((s) => s.appSessionId === id)).toMatchObject({ process: 'exited', exit: { reason: 'stop' } });
    await until(() => host.events(id).some((e) => e.kind === 'process.exited'), 'process.exited batch');
  });

  it('a replay of pass1/init that writes a user frame the fixture did not record ends as a mismatch and a crash, never a silently advanced graph', async () => {
    const host = engineHost();
    const id = 'app-mismatch';
    await host.call('session.launch', { spec: replaySpec(id, 'spikes/protocol-probe/fixtures/init.jsonl') });
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    await host.call('session.send', { appSessionId: id as AppSessionId, content: 'Reply with exactly OK' });
    await until(() => host.events(id).some((e) => e.kind === 'turn.ended') && host.statuses(id).at(-1)?.turn === null, 'turn.ended');
    await host.call('session.send', { appSessionId: id as AppSessionId, content: 'A prompt the probe never sent' }).catch(() => undefined);
    await until(() => host.events(id).some((e) => e.kind === 'process.exited'), 'process.exited');
    expect(host.events(id).find((e) => e.kind === 'process.exited')).toMatchObject({ reason: 'crash', code: null, signal: null });
    const journal = host.ipc.table.get(id as AppSessionId)!.status().journalPath;
    const { readFileSync } = await import('node:fs');
    const rows = readFileSync(journal, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { direction: string; frame: { event?: string } });
    expect(rows.filter((r) => r.direction === 'meta' && r.frame.event === 'replay_mismatch')).toHaveLength(1);
  });

  it('session.queue.list: the live queue, the stored queue verbatim for an unreserved id with a state file, unknown otherwise', async () => {
    const store = new FileSessionStateStore(userData);
    const stored = { entries: [{ queueId: 'q1', appSessionId: 'app-stored' as AppSessionId, content: 'first', createdAt: '2026-09-28T10:00:00.000Z', state: 'submitting' as const, messageUuid: '55555555-5555-4555-8555-555555555555' as never, submittedAt: '2026-09-28T10:00:01.000Z', uncertain: false, steer: false }], paused: false };
    await store.saveQueue('app-stored' as AppSessionId, stored);
    const host = engineHost({ store });
    expect(await host.call('session.queue.list', { appSessionId: 'app-stored' as AppSessionId })).toEqual(stored); // no recovery transition: still submitting, not paused
    await expect(host.call('session.queue.list', { appSessionId: 'app-none' as AppSessionId })).rejects.toThrow('unknown session app-none');
  });

  it('archive stops the process and forgets the session\'s journal, keeping its state', async () => {
    const store = new MemorySessionStateStore();
    const forget = vi.spyOn(store, 'forget');
    const forgetJournal = vi.spyOn(store, 'forgetJournal');
    const host = engineHost({ store });
    const id = 'app-archive';
    await host.call('session.launch', { spec: replaySpec(id, 'spikes/protocol-probe/fixtures/reads.jsonl') });
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    expect(await host.call('session.catalog', { appSessionId: id as AppSessionId })).toMatchObject({ commands: expect.any(Array), revision: expect.any(Number) });
    expect(await host.call('session.stop', { appSessionId: id as AppSessionId, reason: 'archive' })).toMatchObject({ exited: true });
    expect(forgetJournal).toHaveBeenCalledExactlyOnceWith(id);
    expect(forget).not.toHaveBeenCalled(); // archive keeps the store file, delete forgets it (charter §12 C10)
    expect(store.specs.has(id as AppSessionId)).toBe(true);
    expect(host.statuses(id).at(-1)!.exit).toMatchObject({ reason: 'archive' });
    // released (whole-branch review): no table row, no stream, so the host keeps nothing of an archived session
    expect((await host.call('engine.sessions', undefined)).some((s) => s.appSessionId === id)).toBe(false);
    expect(host.ipc.table.get(id as AppSessionId)).toBeUndefined();
    await expect(host.call('session.events', { appSessionId: id as AppSessionId, afterSeq: null, limit: null })).rejects.toThrow(`unknown session ${id}`);
    await expect(host.call('session.status', { appSessionId: id as AppSessionId })).rejects.toThrow(`unknown session ${id}`);
    // the internal event main's attention service retires the session on (M5 review), after the session's last batch
    const names = host.emitted.filter((e) => (e.payload as { appSessionId?: string }).appSessionId === id).map((e) => e.name);
    expect(names.at(-1)).toBe('session.forgotten');
    expect(host.emitted.at(-1)).toEqual({ name: 'session.forgotten', payload: { appSessionId: id } });

    // an already-exited session: archive still forgets it and says so
    const ended = 'app-archive-exited';
    await host.call('session.launch', { spec: replaySpec(ended, 'spikes/protocol-probe/fixtures/init.jsonl') });
    await until(() => host.statuses(ended).some((s) => s.process === 'ready'), 'ready');
    await host.call('session.stop', { appSessionId: ended as AppSessionId, reason: 'stop' });
    expect(host.emitted.some((e) => e.name === 'session.forgotten' && (e.payload as { appSessionId: string }).appSessionId === ended)).toBe(false);
    expect(await host.call('session.stop', { appSessionId: ended as AppSessionId, reason: 'archive' })).toMatchObject({ exited: true });
    expect(forgetJournal).toHaveBeenLastCalledWith(ended);
    expect(forget).not.toHaveBeenCalled();
    expect(host.emitted.at(-1)).toEqual({ name: 'session.forgotten', payload: { appSessionId: ended } });
    expect((await host.call('engine.sessions', undefined)).map((s) => s.appSessionId)).toEqual([]);
    await expect(host.call('session.events', { appSessionId: ended as AppSessionId, afterSeq: null, limit: null })).rejects.toThrow(`unknown session ${ended}`);
  });

  it('archive with a released entry outstanding: once session.stop resolves, the journal directory is gone and nothing written at the exit brings it back, while the state file is kept (charter §12 C10)', async () => {
    const store = new FileSessionStateStore(userData);
    const host = engineHost({ store });
    const id = 'app-archive-released';
    await host.call('session.launch', { spec: replaySpec(id, 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl') });
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    await host.call('session.send', { appSessionId: id as AppSessionId, content: 'Use Bash to run exactly git log --oneline. Then say DONE.' });
    await until(() => host.events(id).some((e) => e.kind === 'permission.requested'), 'permission.requested');
    await until(() => host.emitted.some((e) => e.name === 'session.queue' && (e.payload as { entries: { state: string }[] }).entries.some((q) => q.state === 'released')), 'the entry released');
    const stateFile = join(userData, 'engine-host', 'state', `${id}.json`);
    const journalDir = join(userData, 'engine-host', 'journal', id);
    expect(existsSync(stateFile)).toBe(true);
    expect(existsSync(journalDir)).toBe(true);
    await host.call('session.stop', { appSessionId: id as AppSessionId, reason: 'archive' });
    expect(existsSync(stateFile)).toBe(true);
    expect(existsSync(journalDir)).toBe(false);
    for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 10)); // every write the exit started has had its turn
    expect(existsSync(stateFile)).toBe(true);
    expect(existsSync(journalDir)).toBe(false);
    expect((await store.loadLaunchSpec(id as AppSessionId))?.appSessionId).toBe(id);
  });

  it('a relaunch replaces the exited launch\'s row and stream: engine.sessions lists the id once, session.events answers the new launch only', async () => {
    const host = engineHost();
    const id = 'app-relaunch';
    const first = await host.call('session.launch', { spec: replaySpec(id, 'spikes/protocol-probe/fixtures/init.jsonl') });
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    await host.call('session.stop', { appSessionId: id as AppSessionId, reason: 'stop' });
    const firstLaunch = (first as { session: EngineSessionStatus }).session.launchId;
    const ofLaunch = async (launchId: string) => (await host.call('session.events', { appSessionId: id as AppSessionId, afterSeq: null, limit: null })).events.filter((e) => e.id.includes(`:${launchId}:`));
    expect(await ofLaunch(firstLaunch)).toMatchObject([{ kind: 'process.exited', reason: 'stop' }]); // an exited session keeps its row and stream
    const second = await host.call('session.launch', { spec: replaySpec(id, 'spikes/protocol-probe/fixtures/init.jsonl') });
    const secondLaunch = (second as { session: EngineSessionStatus }).session.launchId;
    expect(secondLaunch).not.toBe(firstLaunch);
    await until(() => host.statuses(id).some((s) => s.launchId === secondLaunch && s.process === 'ready'), 'the second launch ready');
    expect((await host.call('engine.sessions', undefined)).filter((s) => s.appSessionId === id).map((s) => s.launchId)).toEqual([secondLaunch]);
    expect(await ofLaunch(firstLaunch)).toEqual([]);
    await host.call('session.stop', { appSessionId: id as AppSessionId, reason: 'stop' });
    expect((await ofLaunch(secondLaunch)).map((e) => e.kind)).toEqual(['process.exited']);
  });

  it('mutations report what the engine said: a refused mode with its code and the status requested/refusal, a model error, void setters', async () => {
    const transport: ScriptedTransport = scriptedTransport({
      onWrite: (frame, t) => {
        if (frame.type !== 'control_request') return;
        const reply = (response: object) => queueMicrotask(() => t.push({ type: 'control_response', response: { request_id: frame.request_id, ...response } }));
        const r = frame.request as { subtype: string; mode?: string };
        if (r.subtype === 'set_permission_mode' && r.mode === 'auto') reply({ subtype: 'error', error: 'auto mode is unavailable for this model', error_code: 'auto_mode_model' });
        else if (r.subtype === 'set_permission_mode') reply({ subtype: 'success', response: { mode: r.mode } });
        else if (r.subtype === 'set_model') reply({ subtype: 'error', error: 'unknown model', error_code: 'bad_model' });
        else if (r.subtype === 'apply_flag_settings' || r.subtype === 'set_max_thinking_tokens' || r.subtype === 'rename_session' || r.subtype === 'stop_task') reply({ subtype: 'success' });
        else autoResponder(handshakeResponder({ initialize: () => ({ response: { ...INIT_RESPONSE, current_permission_mode: 'default' } }) }))(frame, t);
      },
    });
    const host = engineHost({ spawn: () => transport, binaryProbe: async () => OK_BINARY, checkRelay: async () => OK_RELAY, captureEnv: async () => ({ PATH: '/usr/bin' }) });
    const id = 'app-ipc' as AppSessionId;
    await host.call('session.launch', { spec: spec({ permissionMode: 'default', effort: 'high' }) });
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    const { readFileSync } = await import('node:fs');
    const journalRows = readFileSync(host.ipc.table.get(id)!.status().journalPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { direction: string; frame: Record<string, unknown> });
    expect(journalRows.slice(0, 2).map((r) => r.frame.event)).toEqual(['spawn', 'relay_health']); // the check that let a gateway launch spawn
    expect(journalRows[1]!.frame).toEqual({ event: 'relay_health', ...OK_RELAY });

    expect(await host.call('session.setPermissionMode', { appSessionId: id, mode: 'auto' })).toEqual({ effective: 'default', refusal: 'auto_mode_model', error: 'auto mode is unavailable for this model' });
    expect(host.ipc.table.get(id)!.status().permissionMode).toEqual({ requested: 'auto', effective: 'default', refusal: 'auto_mode_model' });
    expect(await host.call('session.setPermissionMode', { appSessionId: id, mode: 'acceptEdits' })).toEqual({ effective: 'acceptEdits', refusal: null, error: null });
    expect(host.ipc.table.get(id)!.status().permissionMode).toEqual({ requested: 'acceptEdits', effective: 'acceptEdits', refusal: null });
    expect(await host.call('session.setModel', { appSessionId: id, model: 'nonesuch' })).toEqual({ ok: false, error: 'unknown model', code: 'bad_model' });
    await host.call('session.setEffort', { appSessionId: id, effort: 'low' });
    expect(transport.requestsOf('apply_flag_settings').at(-1)!.request).toEqual({ subtype: 'apply_flag_settings', settings: { effortLevel: 'low' } });
    expect(host.ipc.table.get(id)!.status().effort).toBe('low');
    await host.call('session.setThinking', { appSessionId: id, maxThinkingTokens: 4096, display: 'summarized' });
    expect(transport.requestsOf('set_max_thinking_tokens').at(-1)!.request).toEqual({ subtype: 'set_max_thinking_tokens', max_thinking_tokens: 4096, display: 'summarized' });
    await host.call('session.renameSession', { appSessionId: id, title: 'Named' });
    expect(transport.requestsOf('rename_session').at(-1)!.request).toEqual({ subtype: 'rename_session', title: 'Named', source: 'host' });
    await expect(host.call('session.applyFlagSettings', { appSessionId: id, settings: { dialogExpiry: '5m' } })).rejects.toThrow(/dialogExpiry/);
    await host.call('session.applyFlagSettings', { appSessionId: id, settings: { fastMode: true } });
    expect(transport.requestsOf('apply_flag_settings').at(-1)!.request).toEqual({ subtype: 'apply_flag_settings', settings: { fastMode: true } });

    const { opId } = await host.call('session.generateTitle', { appSessionId: id, description: 'd', persist: false });
    transport.answer('generate_session_title', { title: 'Generated' });
    await until(() => host.emitted.some((e) => e.name === 'session.operation'), 'session.operation');
    expect(host.emitted.find((e) => e.name === 'session.operation')!.payload).toEqual({ appSessionId: id, opId, command: 'session.generateTitle', late: false, outcome: { ok: true, value: { title: 'Generated' } } });

    const stopping = host.call('engine.shutdown', { graceMs: 5_000 });
    await until(() => transport.requestsOf('end_session').length === 1, 'end_session');
    transport.exit(0);
    expect(await stopping).toEqual({ stopped: 1, forced: 0 });
  });

  // C12 start
  it('a mode, model, effort or thinking change marks the session used, whatever the engine answers (the budget\'s least-recently-used order, C12)', async () => {
    const transport: ScriptedTransport = scriptedTransport({
      onWrite: (frame, t) => {
        if (frame.type !== 'control_request') return;
        const reply = (response: object) => queueMicrotask(() => t.push({ type: 'control_response', response: { request_id: frame.request_id, ...response } }));
        const r = frame.request as { subtype: string; mode?: string };
        if (r.subtype === 'set_permission_mode') reply({ subtype: 'success', response: { mode: r.mode } });
        else if (r.subtype === 'set_model') reply({ subtype: 'error', error: 'unknown model', error_code: 'bad_model' });
        else if (r.subtype === 'apply_flag_settings' || r.subtype === 'set_max_thinking_tokens') reply({ subtype: 'success' });
        else autoResponder(handshakeResponder())(frame, t);
      },
    });
    const host = engineHost({ spawn: () => transport, binaryProbe: async () => OK_BINARY, checkRelay: async () => OK_RELAY, captureEnv: async () => ({ PATH: '/usr/bin' }) });
    const id = 'app-ipc' as AppSessionId;
    await host.call('session.launch', { spec: spec() });
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    const used = vi.spyOn(host.ipc.table.get(id)!, 'markUsed');
    await host.call('session.setPermissionMode', { appSessionId: id, mode: 'acceptEdits' });
    await host.call('session.setModel', { appSessionId: id, model: 'nonesuch' });
    await host.call('session.setEffort', { appSessionId: id, effort: 'low' });
    await host.call('session.setThinking', { appSessionId: id, maxThinkingTokens: 4096, display: 'summarized' });
    expect(used).toHaveBeenCalledTimes(4);
    const stopping = host.call('session.stop', { appSessionId: id, reason: 'stop' });
    await until(() => transport.requestsOf('end_session').length === 1, 'end_session');
    transport.exit(0);
    await stopping;
  });
  // C12 end
});

// C4 start: the one seam into C4's filesystem state service (C4 execution document, Architecture and Cross-child
// reconciliation): `session.events` for an app session with no stream in this host (never launched in this run, or
// archived and released) answers from disk through FsService.eventsSnapshot, `lastSeq: 0` (disk events carry no seq).
describe('session.events for an app session with no process here answers from disk (C4)', () => {
  const diskEvent = (text: string): SessionEvent => ({
    id: `disk:${text}` as never, sessionId: 'S' as never, at: '2026-09-28T10:00:00.000Z', seq: null, agentId: null, parentToolUseId: null,
    kind: 'notice.posted', level: 'info', text, key: null,
  });

  it('delegates with lastSeq 0 and the snapshot\'s completeness, passes a refusal through, and leaves a live stream to C3', async () => {
    const diskEvents = vi.fn(async (appSessionId: AppSessionId) => {
      if (appSessionId === 'app-unbound') throw new Error(`unknown app session: ${appSessionId}`);
      return { events: [diskEvent(appSessionId)], complete: appSessionId !== 'app-backfilling' };
    });
    const host = engineHost({ diskEvents });
    expect(await host.call('session.events', { appSessionId: 'app-disk' as AppSessionId, afterSeq: 3, limit: 10 })).toEqual({ events: [diskEvent('app-disk')], lastSeq: 0, complete: true });
    expect(await host.call('session.events', { appSessionId: 'app-backfilling' as AppSessionId, afterSeq: null, limit: null })).toMatchObject({ lastSeq: 0, complete: false });
    await expect(host.call('session.events', { appSessionId: 'app-unbound' as AppSessionId, afterSeq: null, limit: null })).rejects.toThrow('unknown app session: app-unbound');

    const id = 'app-live-c4';
    await host.call('session.launch', { spec: replaySpec(id, 'spikes/protocol-probe/fixtures/init.jsonl') });
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    diskEvents.mockClear();
    const live = await host.call('session.events', { appSessionId: id as AppSessionId, afterSeq: null, limit: null });
    expect(live.events).toEqual(host.events(id));
    expect(diskEvents).not.toHaveBeenCalled();
    // Archived and released, the session has no stream here any more: its history is the transcript's.
    await host.call('session.stop', { appSessionId: id as AppSessionId, reason: 'archive' });
    expect(await host.call('session.events', { appSessionId: id as AppSessionId, afterSeq: null, limit: null })).toEqual({ events: [diskEvent(id)], lastSeq: 0, complete: true });
  });
});
// C4 end

// C7 start: the catalogue's publication and the queue's pause reason through the host's handlers (C7 M1)
describe('catalog answers and publishes from handshake state through the host (C7)', () => {
  type Changed = { appSessionId: string; launchId: string; catalog: { revision: number; commands: unknown[] } };
  const changes = (host: ReturnType<typeof engineHost>, id: string) =>
    host.emitted.filter((e) => e.name === 'session.catalogChanged' && (e.payload as Changed).appSessionId === id).map((e) => e.payload as Changed);

  it('session.catalog is refused internal before any process, and published whole per launch, restarting at revision 1 with the new launchId', async () => {
    const host = engineHost();
    const id = 'app-catalog';
    await expect(host.handlers.get('session.catalog')!({ appSessionId: id })).rejects.toEqual(new HostCommandError({ code: 'internal', message: `unknown session ${id}` }));
    const first = (await host.call('session.launch', { spec: replaySpec(id, 'spikes/protocol-probe/fixtures/init.jsonl') })) as { session: EngineSessionStatus };
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    expect(changes(host, id).map((c) => [c.launchId, c.catalog.revision])).toEqual([[first.session.launchId, 1]]);
    expect(changes(host, id)[0]!.catalog).toEqual(await host.call('session.catalog', { appSessionId: id as AppSessionId }));
    expect(changes(host, id)[0]!.catalog.commands).toHaveLength((INIT_RESPONSE.commands as unknown[]).length);
    // the publication follows the events that caused it, like every per-session event
    const names = host.emitted.filter((e) => (e.payload as { appSessionId?: string }).appSessionId === id).map((e) => e.name);
    expect(names.indexOf('session.catalogChanged')).toBeGreaterThan(names.indexOf('session.eventBatch'));
    await host.call('session.stop', { appSessionId: id as AppSessionId, reason: 'stop' });

    const second = (await host.call('session.launch', { spec: replaySpec(id, 'spikes/protocol-probe/fixtures/init.jsonl') })) as { session: EngineSessionStatus };
    await until(() => changes(host, id).length === 2, 'the second launch\'s catalogue');
    expect(changes(host, id).map((c) => [c.launchId, c.catalog.revision])).toEqual([[first.session.launchId, 1], [second.session.launchId, 1]]);
    expect(second.session.launchId).not.toBe(first.session.launchId);
    await host.call('session.stop', { appSessionId: id as AppSessionId, reason: 'stop' });
  });

  it("session.queue and session.queue.list carry the pause reason; a state file older than the field lists none", async () => {
    const store = new FileSessionStateStore(userData);
    await store.saveQueue('app-legacy' as AppSessionId, { entries: [], paused: true });
    const host = engineHost({ store });
    expect(await host.call('session.queue.list', { appSessionId: 'app-legacy' as AppSessionId })).toEqual({ entries: [], paused: true });
    const id = 'app-pause';
    await host.call('session.launch', { spec: replaySpec(id, 'spikes/protocol-probe/fixtures/init.jsonl') });
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    await host.call('session.queue.setPaused', { appSessionId: id as AppSessionId, paused: true });
    expect(await host.call('session.queue.list', { appSessionId: id as AppSessionId })).toEqual({ entries: [], paused: true, pauseReason: 'user' });
    const last = host.emitted.filter((e) => e.name === 'session.queue' && (e.payload as { appSessionId: string }).appSessionId === id).at(-1)!.payload;
    expect(last).toEqual({ appSessionId: id, entries: [], paused: true, pauseReason: 'user' });
    await host.call('session.queue.setPaused', { appSessionId: id as AppSessionId, paused: false });
    expect(await host.call('session.queue.list', { appSessionId: id as AppSessionId })).toEqual({ entries: [], paused: false, pauseReason: null });
    await host.call('session.stop', { appSessionId: id as AppSessionId, reason: 'stop' });
  });
});
// C7 end

// C11 start: the host's binary configuration through `engine.configure` (C11 execution document, M1; C3's BinaryConfig)
describe('engine.configure answers binaryInfo and buildLaunch uses the configured path', () => {
  const CONFIGURED = '/opt/maws-test/claude-2.1.283';
  // The real probe over a fake file system: only ENGINE_BIN and CONFIGURED exist, and both print the pinned version.
  const probe = () =>
    createBinaryProbe({
      access: async (path) => {
        if (path !== ENGINE_BIN && path !== CONFIGURED) throw new Error('ENOENT');
      },
      run: async () => `${ENGINE_VERSION} (Claude Code)\n`,
    });
  afterEach(() => setBinaryConfig({ binaryPath: null, expectedVersion: ENGINE_VERSION })); // the host's configuration is module state

  it('a missing path answers ok: false with the missing-binary error, and the next launch is refused binary_missing', async () => {
    const spawn = vi.fn();
    const host = engineHost({ spawn, binaryProbe: probe(), checkRelay: async () => OK_RELAY, captureEnv: async () => ({ PATH: '/usr/bin' }) });
    const info = await host.call('engine.configure', { binaryPath: '/nonexistent', expectedVersion: ENGINE_VERSION });
    expect(info).toEqual({ path: '/nonexistent', expectedVersion: ENGINE_VERSION, version: null, ok: false, error: expect.stringContaining('no executable engine binary at /nonexistent') });
    expect(await host.call('engine.binaryInfo', undefined)).toEqual(info);
    expect(await host.call('session.launch', { spec: spec() })).toEqual({ status: 'refused', reason: 'binary_missing', message: expect.stringContaining('/nonexistent') });
    expect(spawn).not.toHaveBeenCalled();
  });

  it('null restores the default binary and answers its version; a version other than the pin is binary_version', async () => {
    const host = engineHost({ binaryProbe: probe() });
    await host.call('engine.configure', { binaryPath: '/nonexistent', expectedVersion: ENGINE_VERSION });
    expect(await host.call('engine.configure', { binaryPath: null, expectedVersion: ENGINE_VERSION })).toEqual({ path: ENGINE_BIN, expectedVersion: ENGINE_VERSION, version: ENGINE_VERSION, ok: true, error: null });
    expect(await host.call('engine.configure', { binaryPath: null, expectedVersion: '2.1.300' })).toMatchObject({ path: ENGINE_BIN, version: ENGINE_VERSION, ok: false, error: expect.stringContaining('MAWS expects 2.1.300') });
    expect(getBinaryConfig()).toEqual({ binaryPath: null, expectedVersion: '2.1.300' });
  });

  it('a configured path is the bin of the next launch plan; an unconfigured host launches ENGINE_BIN as before', async () => {
    const plans: LaunchPlan[] = [];
    let transport: ScriptedTransport;
    const spawn = (plan: LaunchPlan) => {
      plans.push(plan);
      return transport;
    };
    const host = engineHost({ spawn, binaryProbe: probe(), checkRelay: async () => OK_RELAY, captureEnv: async () => ({ PATH: '/usr/bin' }) });
    const run = async (appSessionId: string) => {
      transport = scriptedTransport({ onWrite: autoResponder(handshakeResponder()) });
      expect(await host.call('session.launch', { spec: spec({ appSessionId: appSessionId as AppSessionId, gateway: 'direct' }) })).toMatchObject({ status: 'launching' });
      transport.exit(0);
      await host.ipc.table.get(appSessionId as AppSessionId)!.exited;
    };
    await run('app-default');
    expect(await host.call('engine.configure', { binaryPath: CONFIGURED, expectedVersion: ENGINE_VERSION })).toMatchObject({ path: CONFIGURED, ok: true });
    await run('app-configured');
    expect(plans.map((p) => [p.bin, p.engineVersion])).toEqual([[ENGINE_BIN, ENGINE_VERSION], [CONFIGURED, ENGINE_VERSION]]);
  });

  it('refuses a relative path as invalid_input (the validator refuses it first) before touching the configuration', async () => {
    const host = engineHost({ binaryProbe: probe() });
    await expect(host.handlers.get('engine.configure')!({ binaryPath: 'claude', expectedVersion: ENGINE_VERSION })).rejects.toMatchObject({ ipcError: { code: 'invalid_input' } });
    expect(getBinaryConfig()).toEqual({ binaryPath: null, expectedVersion: ENGINE_VERSION });
  });
});
// C11 end

// C12 start: the memory budget's host commands (C12 execution document, Interfaces "X2 additions"; M1 task 4)
describe('engine.policy.set and engine.budget (C12)', () => {
  const idle = { type: 'system', subtype: 'session_state_changed', state: 'idle', uuid: 'idle-1', session_id: 's' };
  const reconnectTriggers = (journalPath: string) =>
    readFileSync(journalPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { frame: { event?: string; trigger?: string } }).filter((r) => r.frame.event === 'reconnect').map((r) => r.frame.trigger);

  it('engine.policy.set evaluates at once and answers the budget state; engine.budget answers it; the event carries each change and each release; the next launch after a release reconnects with process_exit', async () => {
    const transports: ScriptedTransport[] = [];
    const nextTransport = () => {
      const t = scriptedTransport({ pid: 4242, onWrite: autoResponder(handshakeResponder({ end_session: () => null })) });
      transports.push(t);
      return t;
    };
    const table = new ProcessTable({ ps: async () => '  4242     1   400\n' });
    const host = engineHost({ table, spawn: () => nextTransport(), binaryProbe: async () => OK_BINARY, checkRelay: async () => OK_RELAY, captureEnv: async () => ({ PATH: '/usr/bin' }) });
    const id = 'app-ipc' as AppSessionId;
    const budgetEvents = () => host.emitted.filter((e) => e.name === 'engine.budget').map((e) => e.payload as { releasing: string | null; limitKiB: number });

    await host.call('session.launch', { spec: spec() });
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    transports[0]!.push(idle);
    await until(() => table.get(id)!.status().engineState === 'idle', 'idle');
    await table.sampleMemory(); // records the row's lastEventSeq
    await table.sampleMemory(); // finds it unmoved: quiet from here
    expect(await host.call('engine.budget', undefined)).toMatchObject({ totalKiB: 400, over: false, releasing: null });

    const state = await host.call('engine.policy.set', { limitKiB: 100, statefulMcpServers: ['c12-kernel'] });
    expect(state).toMatchObject({ limitKiB: 100, totalKiB: 400, over: true, candidates: 1, releasing: id, lastRelease: { appSessionId: id, totalKiB: 400 } });
    expect(budgetEvents().at(-1)).toMatchObject({ limitKiB: 100, releasing: id });
    expect(transports[0]!.requestsOf('end_session').map((r) => r.request.reason)).toEqual(['stop']);
    transports[0]!.exit(0);
    await until(() => host.statuses(id).some((s) => s.process === 'exited'), 'exited');
    expect(host.statuses(id).at(-1)!.exit).toMatchObject({ reason: 'budget', release: { limitKiB: 100, totalKiB: 400 } });
    expect(await host.call('engine.budget', undefined)).toMatchObject({ releasing: null });
    expect(budgetEvents().at(-1)).toMatchObject({ releasing: null });

    // the resume after the release: its reconnect rows name process_exit; the launch after that one is the owner's again
    const resume = spec({ resume: { sessionId: '33333333-3333-4333-8333-333333333333' as never, fork: false } });
    await host.call('engine.policy.set', { limitKiB: 1_000_000, statefulMcpServers: [] }); // no further release
    await host.call('session.launch', { spec: resume });
    await until(() => host.statuses(id).at(-1)?.process === 'ready', 'resumed');
    expect(reconnectTriggers(table.get(id)!.status().journalPath)).toEqual(['process_exit', 'process_exit']);
    const stopping = host.call('session.stop', { appSessionId: id, reason: 'stop' });
    await until(() => transports[1]!.requestsOf('end_session').length === 1, 'end_session');
    transports[1]!.exit(0);
    await stopping;
    await host.call('session.launch', { spec: resume });
    await until(() => host.statuses(id).at(-1)?.process === 'ready', 'resumed again');
    expect(reconnectTriggers(table.get(id)!.status().journalPath)).toEqual(['user', 'user']);
    const last = host.call('session.stop', { appSessionId: id, reason: 'stop' });
    await until(() => transports[2]!.requestsOf('end_session').length === 1, 'end_session');
    transports[2]!.exit(0);
    await last;
  });

  // M2: an archive of a released session drops its released id with the row, so the unarchived session's next launch
  // is a fresh one (trigger user), not a resume after a release
  it('an archive of a released session drops the released id: the next launch reconnects as the owner’s', async () => {
    const transports: ScriptedTransport[] = [];
    const nextTransport = () => {
      const t = scriptedTransport({ pid: 4242, onWrite: autoResponder(handshakeResponder({ end_session: () => null })) });
      transports.push(t);
      return t;
    };
    const table = new ProcessTable({ ps: async () => '  4242     1   400\n' });
    const host = engineHost({ table, spawn: () => nextTransport(), binaryProbe: async () => OK_BINARY, checkRelay: async () => OK_RELAY, captureEnv: async () => ({ PATH: '/usr/bin' }) });
    const id = 'app-ipc' as AppSessionId;
    await host.call('session.launch', { spec: spec() });
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    transports[0]!.push(idle);
    await until(() => table.get(id)!.status().engineState === 'idle', 'idle');
    await table.sampleMemory();
    await host.call('engine.policy.set', { limitKiB: 100, statefulMcpServers: [] });
    transports[0]!.exit(0);
    await until(() => host.statuses(id).some((s) => s.process === 'exited'), 'released');
    expect(await host.call('session.stop', { appSessionId: id, reason: 'archive' })).toMatchObject({ exited: true });
    expect(table.get(id)).toBeUndefined(); // the archive released the row
    expect(table.takeReleased(id)).toBe(false);
    await host.call('engine.policy.set', { limitKiB: 1_000_000, statefulMcpServers: [] });
    await host.call('session.launch', { spec: spec({ resume: { sessionId: '33333333-3333-4333-8333-333333333333' as never, fork: false } }) });
    await until(() => host.statuses(id).at(-1)?.process === 'ready', 'resumed');
    expect(reconnectTriggers(table.get(id)!.status().journalPath)).toEqual(['user', 'user']);
    const last = host.call('session.stop', { appSessionId: id, reason: 'stop' });
    await until(() => transports[1]!.requestsOf('end_session').length === 1, 'end_session');
    transports[1]!.exit(0);
    await last;
  });

  it('the launched session reads the stateful servers of the policy in force', async () => {
    const table = new ProcessTable({ ps: async () => '' });
    const transport = scriptedTransport({ onWrite: autoResponder(handshakeResponder({ end_session: () => null })) });
    const host = engineHost({ table, spawn: () => transport, binaryProbe: async () => OK_BINARY, checkRelay: async () => OK_RELAY, captureEnv: async () => ({ PATH: '/usr/bin' }) });
    const id = 'app-ipc' as AppSessionId;
    await host.call('session.launch', { spec: spec() });
    await until(() => host.statuses(id).some((s) => s.process === 'ready'), 'ready');
    transport.push({ type: 'system', subtype: 'init', cwd: '/w', session_id: 's', tools: [], mcp_servers: [{ name: 'c12-kernel', status: 'connected', source: 'project' }], model: 'm', permissionMode: 'auto', slash_commands: [], claude_code_version: '2.1.283', output_style: 'default', uuid: 'i-1' });
    transport.push({ type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 0, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed' });
    await until(() => table.get(id)!.status().mcpServers.length === 1 && table.get(id)!.status().turn === null, 'init');
    expect(table.get(id)!.status().keepAlive).toEqual([]);
    await host.call('engine.policy.set', { limitKiB: 1_000_000, statefulMcpServers: ['c12-kernel'] });
    expect(host.statuses(id).at(-1)!.keepAlive).toEqual(['stateful_mcp']);
    const stopping = host.call('session.stop', { appSessionId: id, reason: 'stop' });
    await until(() => transport.requestsOf('end_session').length === 1, 'end_session');
    transport.exit(0);
    await stopping;
  });
});
// C12 end

// C12 start: a dropped exited row (C12 execution document, M1 task 5)
describe('exited rows beyond the cap leave the host (C12)', () => {
  it('drops the oldest exited row, its stream and its spec without session.forgotten, keeps its state file, and session.events answers it from disk', async () => {
    const transports: ScriptedTransport[] = [];
    const table = new ProcessTable({ ps: async () => '', exitedRowsMax: 1 });
    const disk = vi.fn(async () => ({ events: [] as SessionEvent[], complete: true }));
    const host = engineHost({
      table, diskEvents: disk, binaryProbe: async () => OK_BINARY, checkRelay: async () => OK_RELAY, captureEnv: async () => ({ PATH: '/usr/bin' }),
      spawn: () => {
        const t = scriptedTransport({ onWrite: autoResponder(handshakeResponder({ end_session: () => null })) });
        transports.push(t);
        return t;
      },
    });
    for (const [i, id] of (['app-one', 'app-two'] as AppSessionId[]).entries()) {
      await host.call('session.launch', { spec: spec({ appSessionId: id }) });
      await until(() => host.statuses(id).some((s) => s.process === 'ready'), `${id} ready`);
      const stopping = host.call('session.stop', { appSessionId: id, reason: 'stop' });
      await until(() => transports[i]!.requestsOf('end_session').length === 1, 'end_session');
      transports[i]!.exit(0);
      await stopping;
    }
    expect(table.get('app-one' as AppSessionId)).toBeUndefined();
    expect(host.emitted.some((e) => e.name === 'session.forgotten')).toBe(false);
    expect(existsSync(join(userData, 'engine-host', 'state', 'app-one.json'))).toBe(true);
    expect(await host.call('session.events', { appSessionId: 'app-one', afterSeq: null, limit: null })).toEqual({ events: [], complete: true, lastSeq: 0 });
    expect(disk).toHaveBeenCalledWith('app-one');
    const two = await host.call('session.events', { appSessionId: 'app-two', afterSeq: null, limit: null });
    expect(two.events.length).toBeGreaterThan(0); // still this host's stream
    expect(disk).toHaveBeenCalledTimes(1);
  });
});
// C12 end
