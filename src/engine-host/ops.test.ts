// Lane B's operation ledger in the engine host (O10 M7; RL §4.7; Interfaces §H): `host.op` claims an action's opId
// before it runs the named engine-host command through the host's own handlers, rechecks the action's context and an
// answer's digest against the session now, and keeps the result; a known id answers what the ledger holds and runs
// nothing. `host.opQuery` answers RL4's states with the stored binding and tombstones an absent id when asked.
// The first block drives the commands over a stand-in handler table; the second through registerEngineIpc's own handlers
// and a replayed engine session, so a reseal shows one effect in a real session.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { HandlerContext } from '@shared/ipc/client';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import { OpLedger } from '@shared/host/op-ledger';
import { requestDigestOf } from '@shared/host/request-digest';
import type { CommandName, CommandOutput } from '@shared/ipc/schema';
import { validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import type { BinaryCheck } from './binary-info';
import { registerEngineIpc } from './ipc';
import { RELAY_URL } from './launch';
import { opCommands, type OpsDeps } from './ops';
import { SUPERVISOR_FILES } from './supervisor-files';
import { ENGINE_BIN, ENGINE_VERSION } from '../../test/support/engine-pin';
import { TESTED_ENGINE_VERSION } from './engine-compat';

const REPO_ROOT = resolve(__dirname, '../..');
const CTX = { client: {} } as HandlerContext;
const iso = (ms: number) => new Date(ms).toISOString();
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-ops-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

// ---- Over a stand-in handler table ----------------------------------------------------------------------------------

const PENDING = { kind: 'permission.requested', requestId: 'rq-1', toolName: 'Bash', input: { command: 'ls' } } as unknown as SessionEvent;

function ops(edit: Partial<OpsDeps> = {}) {
  const ran: { name: string; input: unknown }[] = [];
  const status = { launchId: 'launch-1', engineSessionId: 'eng-1' };
  const handlers = new Map<string, (input: unknown, ctx: HandlerContext) => Promise<unknown>>([
    ['session.send', async (input) => (ran.push({ name: 'session.send', input }), { messageUuid: null, disposition: 'queued', queueId: `q${ran.length}` })],
    ['session.answer', async (input) => (ran.push({ name: 'session.answer', input }), { outcome: 'delivered' })],
    ['session.interrupt', async () => new Promise(() => {})], // a run the host dies in the middle of
    ['session.steer', async () => {
      throw new Error('session app-1 is not ready (exited)');
    }],
  ]);
  const deps: OpsDeps = {
    ledger: OpLedger.open(dir, 'ops.jsonl'),
    handler: (name) => handlers.get(name),
    status: (id) => (id === 'app-1' ? status : null),
    pending: (id, requestId) => (id === 'app-1' && requestId === 'rq-1' ? PENDING : null),
    ...edit,
  };
  return { ...opCommands(deps), ran, status, deps };
}

const op = (fields: Record<string, unknown> = {}) => ({
  opId: 'op-000000000000001',
  opCreated: iso(Date.now()),
  member: 'm-a',
  device: 'd-a',
  fingerprint: 'fp-1',
  name: 'session.send',
  input: { appSessionId: 'app-1', content: 'hello' },
  context: { launchId: 'launch-1', engineSessionId: 'eng-1' },
  ...fields,
});

describe('host.op', () => {
  it('runs the command once and answers a reseal from the ledger, running nothing', async () => {
    const h = ops();
    const first = await h.op(op(), CTX);
    expect(first).toEqual({ state: 'done', result: { ok: true, value: { messageUuid: null, disposition: 'queued', queueId: 'q1' } } });
    expect(await h.op(op(), CTX)).toEqual(first);
    expect(h.ran).toHaveLength(1);
  });

  it('refuses a known opId under another fingerprint or member `op-conflict`', async () => {
    const h = ops();
    await h.op(op(), CTX);
    expect(await h.op(op({ fingerprint: 'fp-2', input: { appSessionId: 'app-1', content: 'other' } }), CTX)).toEqual({ state: 'refused', reason: 'op-conflict' });
    expect(await h.op(op({ member: 'm-b' }), CTX)).toEqual({ state: 'refused', reason: 'op-conflict' });
    expect(h.ran).toHaveLength(1);
  });

  it('refuses an action sealed for another launch or engine session `context` (a resume, a /clear), and one for no session', async () => {
    const h = ops();
    expect(await h.op(op({ context: { launchId: 'launch-0', engineSessionId: 'eng-1' } }), CTX)).toEqual({ state: 'refused', reason: 'context' });
    expect(await h.op(op({ opId: 'op-000000000000002', context: { launchId: 'launch-1', engineSessionId: 'eng-0' } }), CTX)).toEqual({ state: 'refused', reason: 'context' });
    expect(await h.op(op({ opId: 'op-000000000000003', input: { appSessionId: 'app-none', content: 'x' } }), CTX)).toEqual({ state: 'refused', reason: 'context' });
    expect(h.ran).toHaveLength(0);
    // Nothing was claimed for them: each is `not-received`.
    expect(h.opQuery({ opId: 'op-000000000000001', opCreated: iso(Date.now()), tombstoneIfAbsent: false })).toEqual({ state: 'not-received' });
  });

  it('checks an answer’s request digest against the broker’s pending item (`digest-mismatch`), a missing one too', async () => {
    const h = ops();
    const answer = { appSessionId: 'app-1', requestId: 'rq-1', answer: { kind: 'permission', decision: 'allow', scope: 'once' } };
    const digest = requestDigestOf('app-1', PENDING)!;
    expect(await h.op(op({ opId: 'op-answer-0000001', name: 'session.answer', input: answer, requestDigest: { ...digest, input_sha256: '0'.repeat(64) } }), CTX)).toEqual({ state: 'refused', reason: 'digest-mismatch' });
    expect(await h.op(op({ opId: 'op-answer-0000002', name: 'session.answer', input: answer }), CTX)).toEqual({ state: 'refused', reason: 'digest-mismatch' });
    expect(await h.op(op({ opId: 'op-answer-0000003', name: 'session.answer', input: { ...answer, requestId: 'rq-gone' }, requestDigest: { ...digest, request: 'rq-gone' } }), CTX)).toEqual({ state: 'refused', reason: 'digest-mismatch' });
    expect(h.ran).toHaveLength(0);
    expect(await h.op(op({ opId: 'op-answer-0000004', name: 'session.answer', input: answer, requestDigest: digest }), CTX)).toEqual({ state: 'done', result: { ok: true, value: { outcome: 'delivered' } } });
  });

  it('runs only an engine-host command on a session it has a handler for (`unavailable`), with an input its schema takes (`malformed`)', async () => {
    const h = ops();
    expect(await h.op(op({ name: 'session.update', input: { appSessionId: 'app-1', patch: {} } }), CTX)).toEqual({ state: 'refused', reason: 'unavailable' }); // main's
    expect(await h.op(op({ name: 'session.queue.edit', input: { appSessionId: 'app-1', queueId: 'q1', content: 'x' } }), CTX)).toEqual({ state: 'refused', reason: 'unavailable' }); // no handler here
    expect(await h.op(op({ name: 'host.op', input: { appSessionId: 'app-1' } }), CTX)).toEqual({ state: 'refused', reason: 'unavailable' });
    expect(await h.op(op({ name: 'engine.sessions', input: undefined }), CTX)).toEqual({ state: 'refused', reason: 'unavailable' }); // on no session
    expect(await h.op(op({ input: { appSessionId: 'app-1', content: 'x', extra: 1 } }), CTX)).toEqual({ state: 'refused', reason: 'malformed' });
  });

  it('keeps a command that throws as its result: it was tried, and a reseal does not try it again', async () => {
    const h = ops();
    const steer = op({ name: 'session.steer', input: { appSessionId: 'app-1', content: 'x', priority: 'now' } });
    const done = await h.op(steer, CTX);
    expect(done).toMatchObject({ state: 'done', result: { ok: false, error: { code: 'internal', message: expect.stringContaining('not ready') } } });
    expect(await h.op(steer, CTX)).toEqual(done);
  });

  it('answers `in-progress` for an op claimed by a host that died before its result, until KEPT_S', async () => {
    const h = ops();
    const interrupt = op({ name: 'session.interrupt', input: { appSessionId: 'app-1', cancelEngineQueued: false } });
    void h.op(interrupt, CTX);
    expect(h.opQuery({ opId: 'op-000000000000001', opCreated: iso(Date.now()), tombstoneIfAbsent: false }).state).toBe('in-progress');
    // The restarted host reads the claim from disk.
    const again = ops({ ledger: OpLedger.open(dir, 'ops.jsonl') });
    expect(again.opQuery({ opId: 'op-000000000000001', opCreated: iso(Date.now()), tombstoneIfAbsent: true })).toEqual({ state: 'in-progress', member: 'm-a', device: 'd-a', fingerprint: 'fp-1', target: 'app-1', name: 'session.interrupt' });
    expect(await again.op(interrupt, CTX)).toEqual({ state: 'in-progress' });
  });

  it('answers every op `unavailable` when its ledger is closed, saying why (`ledger`) so the endpoint can show it', async () => {
    const h = ops({ ledger: { readable: false, closed: 'write-failed', begin: () => ({ kind: 'answered', answer: { state: 'refused', reason: 'unavailable' } }), finish: () => {}, query: () => ({ state: 'unavailable' }) } as unknown as OpLedger });
    expect(await h.op(op(), CTX)).toEqual({ state: 'refused', reason: 'unavailable', ledger: 'write-failed' });
    expect(h.opQuery({ opId: 'op-000000000000001', opCreated: iso(Date.now()), tombstoneIfAbsent: true })).toEqual({ state: 'unavailable', ledger: 'write-failed' });
  });

  it('says its ledger closed on every answer while it is, `done` included: a run that ended after the ledger closed, or whose result could not be kept', async () => {
    // Claimed while the ledger was open; closed while the command ran (another op's claim failed), or by its own finish.
    for (const closedAt of ['run', 'finish'] as const) {
      const ledger = { closed: null as string | null, begin: () => ({ kind: 'claimed' }), finish: () => void (ledger.closed = 'write-failed'), query: () => ({ state: 'unavailable' }) };
      const h = ops({ ledger: ledger as unknown as OpLedger, handler: () => async () => (closedAt === 'run' && (ledger.closed = 'write-failed'), { messageUuid: null, disposition: 'queued', queueId: 'q1' }) });
      expect(await h.op(op(), CTX)).toEqual({ state: 'done', result: { ok: true, value: { messageUuid: null, disposition: 'queued', queueId: 'q1' } }, ledger: 'write-failed' });
    }
    const open = ops({ ledger: { closed: null, begin: () => ({ kind: 'claimed' }), finish: () => {}, query: () => ({ state: 'not-received' }) } as unknown as OpLedger });
    expect(await open.op(op(), CTX)).not.toHaveProperty('ledger');
    expect(open.opQuery({ opId: 'op-000000000000001', opCreated: iso(Date.now()), tombstoneIfAbsent: false })).toEqual({ state: 'not-received' });
  });
});

describe('host.opQuery', () => {
  it('answers `done` with the outcome and the binding the claim stored', async () => {
    const h = ops();
    await h.op(op(), CTX);
    expect(h.opQuery({ opId: 'op-000000000000001', opCreated: iso(Date.now()), tombstoneIfAbsent: true })).toEqual({
      state: 'done',
      outcome: { ok: true, value: { messageUuid: null, disposition: 'queued', queueId: 'q1' } },
      member: 'm-a',
      device: 'd-a',
      fingerprint: 'fp-1',
      target: 'app-1',
      name: 'session.send',
    });
  });

  it('tombstones an absent id, so the original arriving later is refused and never runs', async () => {
    const h = ops();
    expect(h.opQuery({ opId: 'op-000000000000001', opCreated: iso(Date.now()), tombstoneIfAbsent: true })).toEqual({ state: 'not-received' });
    expect(await h.op(op(), CTX)).toEqual({ state: 'refused', reason: 'tombstoned' });
    expect(h.ran).toHaveLength(0);
  });
});

// ---- Through the engine host's own handlers -------------------------------------------------------------------------

const OK_BINARY: BinaryCheck = { path: ENGINE_BIN, testedVersion: TESTED_ENGINE_VERSION, version: ENGINE_VERSION, ok: true, error: null };
const OK_RELAY = { url: RELAY_URL, ok: true, status: 200, latencyMs: 2, checkedAt: '2026-10-27T10:00:00.000Z', error: null };

function engineHost() {
  const handlers = new Map<string, (input: unknown, ctx: HandlerContext) => Promise<unknown>>();
  const emitted: { name: string; payload: unknown }[] = [];
  const on: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown, ctx: HandlerContext) => Promise<unknown>);
  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}`);
    emitted.push({ name, payload });
    return true;
  };
  const ipc = registerEngineIpc(on, emit, { userData: dir, replayEnabled: true, cwd: REPO_ROOT, binaryProbe: async () => OK_BINARY, checkRelay: async () => OK_RELAY });
  const call = async <N extends CommandName>(name: N, input: unknown): Promise<CommandOutput<N>> => {
    const checked = validateCommandOutput(name, await handlers.get(name)!(input, CTX));
    if (!checked.ok) throw new Error(`invalid output of ${name}: ${checked.error.message}`);
    return checked.value;
  };
  const events = (id: string) => emitted.filter((e) => e.name === 'session.eventBatch' && (e.payload as { appSessionId: string }).appSessionId === id).flatMap((e) => (e.payload as { events: SessionEvent[] }).events);
  return { handlers, ipc, call, events };
}

describe('through the engine host’s handlers (a replayed session)', () => {
  it('registers both commands; an answer is bound to its request and its context, and resealed shows one effect', async () => {
    const host = engineHost();
    expect(host.handlers.has('host.op') && host.handlers.has('host.opQuery')).toBe(true);
    const id = 'app-op' as AppSessionId;
    const spec = LaunchSpecSchema.parse({
      appSessionId: id, cwd: '/tmp/maws-ops', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
      resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl',
    });
    await host.call('session.launch', { spec });
    await vi.waitFor(async () => expect((await host.call('session.status', { appSessionId: id })).process).toBe('ready'), { timeout: 5_000 });
    // The engine says its session id with its first turn, so the prompt goes as a local send would.
    await host.call('session.send', { appSessionId: id, content: 'Use Bash to run exactly git log --oneline. Then say DONE.' });
    await vi.waitFor(() => expect(host.events(id).some((e) => e.kind === 'permission.requested')).toBe(true), { timeout: 5_000 });
    const status = await host.call('session.status', { appSessionId: id });
    const context = { launchId: status.launchId, engineSessionId: status.engineSessionId! };
    expect(context.engineSessionId).toEqual(expect.any(String));
    const requested = host.events(id).find((e) => e.kind === 'permission.requested')!;
    const input = { appSessionId: id, requestId: (requested as { requestId: string }).requestId, answer: { kind: 'permission', decision: 'allow', scope: 'once' } };
    const digest = requestDigestOf(id, requested)!;
    const answer = (opId: string, edit: Record<string, unknown> = {}) => op({ opId, name: 'session.answer', input, context, requestDigest: digest, ...edit });
    expect(await host.call('host.op', answer('op-answer-00000001', { requestDigest: { ...digest, tool: 'Read' } }))).toEqual({ state: 'refused', reason: 'digest-mismatch' });
    expect(await host.call('host.op', answer('op-answer-00000002', { context: { ...context, launchId: 'an-earlier-launch' } }))).toEqual({ state: 'refused', reason: 'context' });
    expect(await host.call('host.op', answer('op-answer-00000003', { context: { ...context, engineSessionId: 'before-a-clear' } }))).toEqual({ state: 'refused', reason: 'context' });
    const delivered = await host.call('host.op', answer('op-answer-00000004'));
    expect(delivered).toEqual({ state: 'done', result: { ok: true, value: { outcome: 'delivered' } } });
    // The reseal is answered from the ledger: run again, the broker would say `not_pending`.
    expect(await host.call('host.op', answer('op-answer-00000004'))).toEqual(delivered);
    await vi.waitFor(() => expect(host.events(id).some((e) => e.kind === 'turn.ended')).toBe(true), { timeout: 5_000 });
    expect(host.events(id).filter((e) => e.kind === 'permission.resolved')).toHaveLength(1);
    expect(await host.call('host.opQuery', { opId: 'op-answer-00000004', opCreated: iso(Date.now()), tombstoneIfAbsent: true })).toMatchObject({ state: 'done', member: 'm-a', target: id, name: 'session.answer' });
    expect(OpLedger.open(join(dir, 'supervisor'), SUPERVISOR_FILES.ops).query('op-answer-00000004', iso(Date.now()), false)).toMatchObject({ state: 'done' });
    await host.call('session.stop', { appSessionId: id, reason: 'stop' });
  });
});
