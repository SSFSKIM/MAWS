// Lane B's operation ledger in the engine host (O10 M7; RL §4.7; Interfaces §H): `host.op` claims an action's opId
// before it runs the named engine-host command through the host's own handlers, rechecks the action's context and an
// answer's digest against the session now, and keeps the result; a known id answers what the ledger holds and runs
// nothing. `host.opQuery` answers RL4's states with the stored binding and tombstones an absent id when asked.
// The first block drives the commands over a stand-in handler table; the second through registerEngineIpc's own handlers
// and a replayed engine session, so a reseal shows one effect in a real session.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { LaunchSpecSchema } from '@shared/engine/launch-spec';
import type { HandlerContext } from '@shared/ipc/client';
import type { HostEmit, HostOn } from '@shared/host/runtime';
import { toWire } from '@shared/host/json-bytes';
import { OpLedger } from '@shared/host/op-ledger';
import { requestDigestOf } from '@shared/host/request-digest';
import type { CommandName, CommandOutput } from '@shared/ipc/schema';
import { gradeOf } from '@shared/ipc/grades';
import { commands } from '@shared/ipc/schema';
import { ARTIFACT_OP_COMMANDS } from '@shared/ipc/schema/host';
import { validateCommandInput, validateCommandOutput, validateEventPayload } from '@shared/ipc/validate';
import type { BinaryCheck } from './binary-info';
import { registerEngineIpc } from './ipc';
import { RELAY_URL } from './launch';
import { openDocuments } from './documents';
import { registerArtifacts } from './documents/register';
import { keepArtifactWrites, opCommands, type OpsDeps } from './ops';
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

const ARTIFACT_ID = '11111111-1111-4111-8111-111111111111';
const ASSET_ID = '22222222-2222-4222-8222-222222222222';
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
    // P5 O7 M5a: artifact writes, keyed by `artifactId` and naming no session
    ['artifacts.saveVersion', async (input) => (ran.push({ name: 'artifacts.saveVersion', input }), { versionId: ran.length })],
    ['artifacts.uploadAsset', async (input) => (ran.push({ name: 'artifacts.uploadAsset', input }), { assetId: ASSET_ID, ref: 'assets/logo.png' })],
    ['artifacts.testWrite', async (input) => (ran.push({ name: 'artifacts.testWrite', input }), { revision: 1 })],
    ['session.applyFlagSettings', async (input) => void ran.push({ name: 'session.applyFlagSettings', input })], // a free-form record
    // commands that are no artifact write: a session named inside the input, a session under another key, a read
    ['session.launch', async (input) => (ran.push({ name: 'session.launch', input }), { status: 'refused', reason: 'already_live', message: 'stand-in' })],
    ['fs.sessionText', async (input) => (ran.push({ name: 'fs.sessionText', input }), { text: 'a transcript', cursor: null, size: 12, mtimeMs: 0 })],
    ['artifacts.versionState', async (input) => (ran.push({ name: 'artifacts.versionState', input }), { bytes: new Uint8Array([0, 1, 255]) })],
  ]);
  const statusReads: string[] = [];
  const deps: OpsDeps = {
    ledger: OpLedger.open(dir, 'ops.jsonl'),
    handler: (name) => handlers.get(name),
    status: (id) => (statusReads.push(id), id === 'app-1' ? status : null),
    pending: (id, requestId) => (id === 'app-1' && requestId === 'rq-1' ? PENDING : null),
    ...edit,
  };
  return { ...opCommands(deps), ran, status, statusReads, deps };
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

// P5 O16 M3c (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3): an engine host leaving (a handover's exit, any
// exit order) waits, within the exit order's own bound, for the runs claimed so far, so a run in flight when the rows
// froze keeps its result in this host's ledger before the process exits; a run that outlasts the bound is left open,
// and the successor, which reopens the ledger with O7 M4's `orphanAtOpen`, answers it `expired` and runs nothing.
describe('the runs in flight when the engine host leaves', () => {
  const lines = () => readFileSync(join(dir, 'ops.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { opId: string; result?: unknown });

  it('settles once each run claimed so far has kept its result on disk', async () => {
    let finish!: () => void;
    const h = ops({ handler: (name) => (name === 'session.send' ? async () => (await new Promise<void>((resolve) => (finish = resolve)), { messageUuid: null, disposition: 'queued', queueId: 'q1' }) : undefined) });
    const answer = h.op(op(), CTX);
    let settled = false;
    const leaving = h.settled().then(() => void (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled, 'the exit waits for the run').toBe(false);
    expect(lines().filter((line) => 'result' in line), 'nothing kept yet').toEqual([]);
    finish();
    await leaving;
    expect(lines().filter((line) => 'result' in line), 'the result on disk before the exit goes on').toEqual([{ opId: 'op-000000000000001', result: { ok: true, value: { messageUuid: null, disposition: 'queued', queueId: 'q1' } } }]);
    expect(await answer).toMatchObject({ state: 'done' });
    await h.settled(); // nothing in flight: at once
  });

  it('keeps a run that never ends waiting, so the exit order’s bound leaves its claim open: the successor answers it expired and runs nothing', async () => {
    const h = ops();
    const interrupt = op({ name: 'session.interrupt', input: { appSessionId: 'app-1', cancelEngineQueued: false } });
    void h.op(interrupt, CTX);
    const bound = new Promise<'bound'>((resolve) => setTimeout(() => resolve('bound'), 50));
    expect(await Promise.race([h.settled().then(() => 'settled' as const), bound])).toBe('bound');
    // the engine host's ledger opens with `orphanAtOpen` (ipc.ts; O7 M4's option): a claim the last host left is expired
    const ran = vi.fn(async () => undefined);
    const successor = ops({ ledger: OpLedger.open(dir, 'ops.jsonl', { orphanAtOpen: true }), handler: () => ran });
    expect(successor.opQuery({ opId: 'op-000000000000001', opCreated: iso(Date.now()), tombstoneIfAbsent: false })).toEqual({ state: 'expired' });
    expect(await successor.op(interrupt, CTX), 'a replay is answered, never run').toEqual({ state: 'in-progress' });
    expect(ran).not.toHaveBeenCalled();
  });
});

// P5 O7 M5a (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "Artifact writes are engine-host acts with
// no session", Interfaces §O): an artifact write names no session, so the endpoint claims it through `host.artifactOp`,
// with no context and the artifact it resolved as the claim's `target`, which a query answers as the binding's target
describe('host.artifactOp (an act on no session)', () => {
  const save = (fields: Record<string, unknown> = {}) => {
    const claim: Record<string, unknown> = op({ name: 'artifacts.saveVersion', input: { artifactId: ARTIFACT_ID, label: 'Draft' }, target: `artifact:${ARTIFACT_ID}`, ...fields });
    delete claim.context; // an act on no session carries none
    return claim as Parameters<ReturnType<typeof opCommands>['artifactOp']>[0];
  };

  it('runs a command whose input names no session once, with no status check, and answers a reseal from the ledger', async () => {
    const h = ops();
    expect(validateCommandInput('host.artifactOp', save()).ok).toBe(true);
    const first = await h.artifactOp(save(), CTX);
    expect(first).toEqual({ state: 'done', result: { ok: true, value: { versionId: 1 } } });
    expect(await h.artifactOp(save(), CTX)).toEqual(first);
    expect(await ops({ ledger: OpLedger.open(dir, 'ops.jsonl') }).artifactOp(save(), CTX)).toEqual(first); // after a restart too
    expect(h.ran).toEqual([{ name: 'artifacts.saveVersion', input: { artifactId: ARTIFACT_ID, label: 'Draft' } }]);
    expect(h.statusReads).toEqual([]);
  });

  // P5 O16 M3c: the exit order's settle waits for an artifact write's run as for host.op's, so its claim is kept first
  it('keeps the engine host’s exit waiting for an artifact write in flight until its result is kept', async () => {
    let finish!: () => void;
    const h = ops({ artifactWrite: (name) => (name === 'artifacts.saveVersion' ? async () => (await new Promise<void>((resolve) => (finish = resolve)), { versionId: 7 }) : undefined) });
    const answer = h.artifactOp(save(), CTX);
    let settled = false;
    const leaving = h.settled().then(() => void (settled = true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled, 'the exit waits for the artifact write').toBe(false);
    finish();
    await leaving;
    expect(await answer).toEqual({ state: 'done', result: { ok: true, value: { versionId: 7 } } });
  });

  it('answers the claim’s target from a query, across a reopen; the orphan form too', async () => {
    const h = ops();
    await h.artifactOp(save(), CTX);
    await h.artifactOp(save({ opId: 'op-000000000000002', target: 'artifact:' }), CTX);
    const created = iso(Date.now());
    const binding = { member: 'm-a', device: 'd-a', fingerprint: 'fp-1', name: 'artifacts.saveVersion' };
    expect(h.opQuery({ opId: 'op-000000000000001', opCreated: created, tombstoneIfAbsent: false })).toEqual({ state: 'done', outcome: { ok: true, value: { versionId: 1 } }, ...binding, target: `artifact:${ARTIFACT_ID}` });
    const again = ops({ ledger: OpLedger.open(dir, 'ops.jsonl') });
    expect(again.opQuery({ opId: 'op-000000000000001', opCreated: created, tombstoneIfAbsent: false })).toMatchObject({ state: 'done', target: `artifact:${ARTIFACT_ID}` });
    expect(again.opQuery({ opId: 'op-000000000000002', opCreated: created, tombstoneIfAbsent: false })).toMatchObject({ state: 'done', target: 'artifact:' });
  });

  it('runs only the artifact writes it names, refusing anything else `unavailable`, running nothing and reading no status', async () => {
    const h = ops();
    const spec = LaunchSpecSchema.parse({
      appSessionId: 'app-1', cwd: '/tmp', additionalDirectories: [], model: null, effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
      resume: null, sessionId: null, trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, inheritGrantsFrom: null, replay: null,
    });
    // each a well-formed input of its own command, refused for its name alone
    const others: [CommandName, unknown][] = [
      ['session.launch', { spec }], // its session nested in the spec
      ['fs.sessionText', { sessionId: 'engine-session' }], // a session under another key
      ['session.send', { appSessionId: 'app-1', content: 'hello' }],
      ['artifacts.testWrite', { artifactId: ARTIFACT_ID, opId: 'w1', ops: [{ op: 'insertText', index: 0, text: 'x' }] }],
      ['artifacts.versionState', { artifactId: ARTIFACT_ID, versionId: 1 }], // an artifact read: a call, never an act
    ];
    for (const [name, input] of others) {
      expect(validateCommandInput(name, input).ok, name).toBe(true);
      expect(await h.artifactOp(save({ name, input }), CTX), name).toEqual({ state: 'refused', reason: 'unavailable' });
    }
    for (const name of ['host.op', 'artifacts.nonesuch']) expect(await h.artifactOp(save({ name, input: {} }), CTX), name).toEqual({ state: 'refused', reason: 'unavailable' });
    expect(await h.artifactOp(save({ input: { artifactId: ARTIFACT_ID, label: 'Draft', extra: 1 } }), CTX)).toEqual({ state: 'refused', reason: 'malformed' });
    expect(h.ran).toEqual([]);
    expect(h.statusReads).toEqual([]);
    expect(h.opQuery({ opId: 'op-000000000000001', opCreated: iso(Date.now()), tombstoneIfAbsent: false })).toEqual({ state: 'not-received' });
    // and host.op still runs an artifact command only on a session: with a context it is `unavailable`, as before
    expect(await h.op(op({ name: 'artifacts.saveVersion', input: { artifactId: ARTIFACT_ID, label: 'Draft' } }), CTX)).toEqual({ state: 'refused', reason: 'unavailable' });
  });

  it('names the thirteen artifact writes of §L, each an engine-host command graded manage that names no session', () => {
    expect([...ARTIFACT_OP_COMMANDS].sort()).toEqual([
      'artifacts.acceptSuggestion', 'artifacts.copyAsset', 'artifacts.create', 'artifacts.delete', 'artifacts.duplicate', 'artifacts.nameVersion', 'artifacts.pruneVersions',
      'artifacts.rejectSuggestion', 'artifacts.rereadDatasetFile', 'artifacts.restore', 'artifacts.saveVersion', 'artifacts.update', 'artifacts.uploadAsset',
    ]);
    for (const name of ARTIFACT_OP_COMMANDS) {
      expect(commands[name].owner, name).toBe('engine-host');
      const grade = gradeOf(name);
      expect(typeof grade === 'object' ? grade.floor : grade, name).toBe('manage');
      expect(Object.keys((commands[name].input as unknown as { shape: Record<string, unknown> }).shape), name).not.toContain('appSessionId');
    }
  });

  it('answers an op id the other command claimed from the ledger, running nothing', async () => {
    const h = ops();
    const sent = await h.op(op(), CTX);
    expect(await h.artifactOp(save({ opId: 'op-000000000000001' }), CTX)).toEqual(sent);
    expect(h.ran).toHaveLength(1);
  });

  // P5 O7 M5a1 fix wave 1: one ledger for both commands, faithful across a reopen (op-ledger.test.ts holds an answer's
  // bytes; no command either runs answers any)
  it('answers both commands’ ops from the ledger after a reopen, a reseal and a query alike', async () => {
    const h = ops();
    const viaOp = await h.op(op({ opId: 'op-000000000000010' }), CTX);
    const viaArtifact = await h.artifactOp(save({ opId: 'op-000000000000011' }), CTX);
    const again = ops({ ledger: OpLedger.open(dir, 'ops.jsonl') });
    expect(await again.artifactOp(save({ opId: 'op-000000000000010' }), CTX)).toEqual(viaOp);
    expect(await again.op(op({ opId: 'op-000000000000011' }), CTX)).toEqual(viaArtifact);
    const created = iso(Date.now());
    expect(again.opQuery({ opId: 'op-000000000000010', opCreated: created, tombstoneIfAbsent: false })).toMatchObject({ state: 'done', outcome: viaOp.state === 'done' ? viaOp.result : null, target: 'app-1', name: 'session.send' });
    expect(again.opQuery({ opId: 'op-000000000000011', opCreated: created, tombstoneIfAbsent: false })).toMatchObject({ state: 'done', outcome: viaArtifact.state === 'done' ? viaArtifact.result : null, target: `artifact:${ARTIFACT_ID}`, name: 'artifacts.saveVersion' });
    expect(again.ran).toEqual([]);
  });

  it('refuses a claim with no target, or one that names no artifact, at the schema', () => {
    const bare: Record<string, unknown> = { ...save() };
    delete bare.target;
    expect(validateCommandInput('host.artifactOp', bare).ok).toBe(false);
    for (const target of ['app-1', 'artifact:not-a-uuid', `artifact:${ARTIFACT_ID}/x`, '']) expect(validateCommandInput('host.artifactOp', save({ target })).ok, target).toBe(false);
    expect(validateCommandInput('host.artifactOp', { ...save(), context: { launchId: 'launch-1', engineSessionId: 'eng-1' } }).ok).toBe(false);
  });

  // Bytes cross RL2 in json-bytes' tagged form (M5 "What crosses, as what"): the op's `input` is a JSON value, decoded by
  // the ledger before its own validation, and nothing it keeps holds a decoded byte
  it('runs an uploadAsset whose tagged bytes pass the real schema, decoded before the command’s validation, and keeps JSON', async () => {
    const h = ops();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255]);
    const tagged = toWire({ artifactId: ARTIFACT_ID, name: 'logo.png', mime: 'image/png', bytes }) as Record<string, unknown>;
    expect(tagged.bytes).toEqual({ $bytes: Buffer.from(bytes).toString('base64') });
    const upload = save({ name: 'artifacts.uploadAsset', input: tagged });
    expect(validateCommandInput('host.artifactOp', upload).ok).toBe(true);
    const done = await h.artifactOp(upload, CTX);
    expect(done).toEqual({ state: 'done', result: { ok: true, value: { assetId: ASSET_ID, ref: 'assets/logo.png' } } });
    const given = (h.ran[0]?.input as { bytes: unknown }).bytes;
    expect(given).toBeInstanceOf(Uint8Array);
    expect([...(given as Uint8Array)]).toEqual([...bytes]);
    expect(tagged.bytes).toEqual({ $bytes: Buffer.from(bytes).toString('base64') }); // the copy was decoded, not the input
    // the ledger holds JSON, and a reopened ledger answers the reseal from it, running nothing
    const lines = readFileSync(join(dir, 'ops.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toEqual([
      { opId: 'op-000000000000001', opCreated: upload.opCreated, at: expect.any(Number), claim: { member: 'm-a', device: 'd-a', fingerprint: 'fp-1', target: `artifact:${ARTIFACT_ID}`, name: 'artifacts.uploadAsset' } },
      { opId: 'op-000000000000001', result: { ok: true, value: { assetId: ASSET_ID, ref: 'assets/logo.png' } } },
    ]);
    const again = ops({ ledger: OpLedger.open(dir, 'ops.jsonl') });
    expect(await again.artifactOp(upload, CTX)).toEqual(done);
    expect(again.ran).toEqual([]);
    // a tagged value that is not base64 stays the object it was, which the command's schema refuses
    expect(await h.artifactOp(save({ opId: 'op-000000000000002', name: 'artifacts.uploadAsset', input: { ...tagged, bytes: { $bytes: 'not base64!' } } }), CTX)).toEqual({ state: 'refused', reason: 'malformed' });
  });
});

// P5 O7 M5a: host.op decodes its input as host.artifactOp does (the endpoint forwards every act's args tagged), so a
// plain value that looks like the tagged form, which the device's encode escapes, arrives as it was sent
describe('host.op’s tagged input', () => {
  it('validates and runs a decoded copy: a look-alike arrives as it was sent', async () => {
    const h = ops();
    const settings = { look: { $bytes: 'AA==' }, raw: new Uint8Array([1, 2]) };
    const tagged = toWire({ appSessionId: 'app-1', settings }) as Record<string, unknown>;
    expect(tagged.settings).toEqual({ look: { $plain: { $bytes: 'AA==' } }, raw: { $bytes: 'AQI=' } });
    expect(await h.op(op({ name: 'session.applyFlagSettings', input: tagged }), CTX)).toEqual({ state: 'done', result: { ok: true } });
    expect(h.ran).toEqual([{ name: 'session.applyFlagSettings', input: { appSessionId: 'app-1', settings } }]);
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
  // P5 O16 M3c: an engine host killed, or handed over, between a claim and its result leaves the claim with no result;
  // its successor opens the same ledger with `orphanAtOpen`, so the claim answers `expired` and a replay runs nothing
  it('answers a claim the last engine host left without a result expired', async () => {
    const left = OpLedger.open(join(dir, 'supervisor'), SUPERVISOR_FILES.ops);
    expect(left.begin('op-left-000000001', iso(Date.now()), { member: 'm-a', device: 'd-a', fingerprint: 'fp-1', target: 'app-gone', name: 'session.send', context: { launchId: 'launch-1', engineSessionId: 'eng-1' } }, () => null)).toEqual({ kind: 'claimed' });
    const host = engineHost();
    expect(await host.call('host.opQuery', { opId: 'op-left-000000001', opCreated: iso(Date.now()), tombstoneIfAbsent: false })).toEqual({ state: 'expired' });
    expect(await host.call('host.op', op({ opId: 'op-left-000000001', input: { appSessionId: 'app-gone', content: 'hello' } }))).toEqual({ state: 'in-progress' });
  });

  it('registers both commands; an answer is bound to its request and its context, and resealed shows one effect', async () => {
    const host = engineHost();
    expect(host.handlers.has('host.op') && host.handlers.has('host.artifactOp') && host.handlers.has('host.opQuery')).toBe(true);
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

// P5 O7 M5a (the hosted e2e:remote's finding): the artifact writes are registered by the artifacts surface, before and
// beside registerEngineIpc, whose own table (host.op's) never holds them. host.artifactOp's lookup is the host's
// collection of ARTIFACT_OP_COMMANDS, kept by the `on` every registration goes through, as src/engine-host/index.ts wires it:
// the real artifacts surface over a real store, then the engine ipc, both registering through that `on`.
describe('host.artifactOp over the host’s own registration', () => {
  it('finds every artifact write the artifacts surface registers, and runs a real update once', async () => {
    const handlers = new Map<string, (input: unknown, ctx: HandlerContext) => Promise<unknown>>();
    const hostOn: HostOn = (name, handler) => void handlers.set(name, handler as (input: unknown, ctx: HandlerContext) => Promise<unknown>);
    const emit: HostEmit = () => true;
    const writes = keepArtifactWrites(hostOn);
    const documents = openDocuments(dir, () => {});
    const surface = registerArtifacts(writes.on, emit, { onDocPort: () => {} }, { documents, env: {} });
    registerEngineIpc(writes.on, emit, { userData: dir, replayEnabled: false, cwd: REPO_ROOT, binaryProbe: async () => OK_BINARY, checkRelay: async () => OK_RELAY, artifactWrite: writes.handler });
    try {
      for (const name of ARTIFACT_OP_COMMANDS) expect(writes.handler(name), name).toBe(handlers.get(name));
      expect(writes.handler('artifacts.get')).toBeUndefined(); // the lookup holds the writes alone
      const call = async (name: string, input: unknown) => handlers.get(name)!(input, CTX);
      const { artifact } = (await call('artifacts.create', { kind: 'html', title: 'Draft', content: { bytes: new TextEncoder().encode('<p>x</p>') } })) as { artifact: { id: string } };
      const update = { opId: 'op-real-update-001', opCreated: iso(Date.now()), member: 'm-a', device: 'd-a', fingerprint: 'fp-1', target: `artifact:${artifact.id}`, name: 'artifacts.update', input: { artifactId: artifact.id, title: 'Renamed' } };
      const done = await call('host.artifactOp', update);
      expect(done).toMatchObject({ state: 'done', result: { ok: true, value: { artifact: { id: artifact.id, title: 'Renamed' } } } });
      await call('artifacts.update', { artifactId: artifact.id, title: 'Changed here' }); // a local edit after it
      expect(await call('host.artifactOp', update)).toEqual(done); // the reseal is the ledger's, run nowhere
      expect(await call('artifacts.get', { artifactId: artifact.id })).toMatchObject({ artifact: { title: 'Changed here' } });
      expect(await call('host.opQuery', { opId: update.opId, opCreated: update.opCreated, tombstoneIfAbsent: false })).toMatchObject({ state: 'done', target: `artifact:${artifact.id}`, name: 'artifacts.update' });
    } finally {
      surface.close();
      documents?.close();
    }
  });
});

