// P5 O16 M3 (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D23, D24, D26, D32, D49): an
// EngineSession adopting a running process. The predecessor's journal is written as an old manager would have left it
// (rotated, with requests it never answered), the session's transport is a scripted stand-in for the session host's
// (adoptHosted's, attached at fence 2), and the ring's replay is pushed with its host sequences. What the adoption must do:
// fold the whole journal with nothing told, hold every replayed request but the `maws` protocol service, and at the
// catch-up dispose of what is outstanding by the table (an orphaned call answered with the exact text and never run, an
// ask raised again whose answer settles the engine's own call, an async ask restored, a retired or withdrawn ask left
// alone, a hook callback answered `{}`, a permission pending once), send the owed interrupt first and re-initialize under
// request ids named apart from the old manager's, whose late answer is dropped; and a gap's conversation reseeded from
// the engine's transcript. The real session host and a SIGKILLed manager are adoption.test.ts's.
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { HANDOVER_REINIT_FAILED } from '@shared/graph/enums';
import type { MessageUuid } from '@shared/graph/ids';
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { autoResponder, scriptedTransport, type Responder, type ScriptedTransport } from '../conformance/scripted-transport';
import { handshakeResponder, INIT_RESPONSE, launchSpec } from '../conformance/session-harness';
import { JournalWriter } from '../journal';
import { buildLaunch, RELAY_URL, spawnMeta, type LaunchPlan } from '../launch';
import { EngineSession, REINITIALIZE_SLOW, type AdoptedLaunch, type EngineSessionOptions } from '../session';
import { MemorySessionStateStore } from '../store/memory-session-state-store';
import { ORPHANED_CALL_TEXT } from '../tool-server/server';
import { launchRows } from './restore';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

let dir: string;
let configDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maws-adopt-'));
  configDir = mkdtempSync(join(tmpdir(), 'maws-adopt-config-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

const spec = launchSpec({ appSessionId: 'app-adopt' as never, cwd: '/tmp/maws-session' });
function planOf(): LaunchPlan {
  const plan = buildLaunch(spec, { PATH: '/usr/bin', HOME: '/Users/x' }, { relayUrl: RELAY_URL, bin: '/x/claude', engineVersion: '2.1.283', spawnerPid: 0, holder: { gateSocket: '/x/gate.sock' } });
  return { ...plan, env: { ...plan.env, CLAUDE_CONFIG_DIR: configDir } };
}

const mcp = (requestId: string, message: Record<string, unknown>) => ({ type: 'control_request', request_id: requestId, request: { subtype: 'mcp_message', server_name: 'maws', message: { jsonrpc: '2.0', ...message } } });
const call = (requestId: string, rpcId: number, name: string, args: unknown, toolUseId: string) => mcp(requestId, { id: rpcId, method: 'tools/call', params: { name, arguments: args, _meta: { 'claudecode/toolUseId': toolUseId } } });
const question = { id: 'q1', question: 'Proceed?', modality: 'choice', options: [{ label: 'Yes' }, { label: 'No' }] };
const mcpAnswer = (requestId: string, rpcId: number, text: string) => ({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { mcp_response: { jsonrpc: '2.0', id: rpcId, result: { content: [{ type: 'text', text }] } } } } });

// The old manager's journal: `write(writer)` appends what it did; rotated at `maxBytes`.
function predecessor(plan: LaunchPlan, write: (w: JournalWriter) => void, maxBytes = 1_000_000): number {
  const writer = new JournalWriter(dir, plan.launchId, { maxBytes });
  writer.row('meta', spawnMeta(plan, { appVersion: 'test', holder: { pid: 4100, holderId: plan.launchId, binary: '/x/maws-session-host' } }));
  writer.row('out', { type: 'control_request', request_id: `${plan.launchId}-1`, request: { subtype: 'initialize', hooks: {} } });
  writer.row('in', { type: 'control_response', response: { subtype: 'success', request_id: `${plan.launchId}-1`, response: { commands: [], models: [], account: {}, current_permission_mode: 'default' } } });
  write(writer);
  const last = writer.lastSeq;
  void writer.close();
  return last;
}

// `transport.onWrite` runs after the responder, as the write is recorded (before it resolves); `transport.holdWrite`
// holds a write as backpressure would
function adopter(plan: LaunchPlan, adopted: Partial<AdoptedLaunch> = {}, store = new MemorySessionStateStore(), opts: { responder?: Responder; session?: Partial<EngineSessionOptions>; transport?: { onWrite?: (frame: StdinFrame, t: ScriptedTransport) => void; holdWrite?: (frame: StdinFrame) => Promise<void> | null } } = {}) {
  const respond = autoResponder(handshakeResponder({ interrupt: () => ({ response: { still_queued: [] } }), ...opts.responder }));
  const transport = scriptedTransport({
    holder: { pid: 4100, holderId: plan.launchId, fence: 2 }, pid: 4101, holdWrite: opts.transport?.holdWrite,
    onWrite: (frame, t) => {
      respond(frame, t);
      opts.transport?.onWrite?.(frame, t);
    },
  });
  const journal = JournalWriter.resume(dir, plan.launchId, { maxBytes: 1_000_000 });
  const logs: string[] = [];
  const session = new EngineSession({
    spec, plan, spawn: () => transport, journal, store, log: (line) => logs.push(line),
    reconnect: true, reconnectTrigger: 'host_restart', launchKind: 'adopted',
    holder: { pid: 4100, holderId: plan.launchId, binary: '/x/maws-session-host' },
    adopted: { fence: 2, frontier: 0, owedInterrupt: false, observerSeen: false, ...adopted },
    ...opts.session,
  });
  const outcome: { settled: 'ready' | Error | null } = { settled: null };
  session.adoption.then(() => void (outcome.settled = 'ready'), (error: Error) => void (outcome.settled = error));
  const events: SessionEvent[] = [];
  let attention = 0;
  session.on('events', (batch) => events.push(...batch));
  session.on('brokerItems', () => void (attention += 1));
  const rows = (): JournalRow[] => [...launchRows(dir, plan.launchId)];
  const caughtUp = () => transport.pushProblem({ kind: 'host_caught_up', message: 'caught up', length: 0, typeGuess: null });
  return { session, transport, journal, events, logs, rows, attention: () => attention, outcome, caughtUp };
}

const responses = (t: ScriptedTransport) => t.writes.filter((w) => w.type === 'control_response') as { response: { request_id: string; response?: { mcp_response?: { result?: { isError?: boolean; content?: { text?: string }[] } } } } }[];
const requests = (t: ScriptedTransport) => t.writes.filter((w) => w.type === 'control_request') as { request_id: string; request: { subtype: string } }[];

describe('an adopted session', () => {
  it('folds the journal with nothing told, holds the replay, disposes of the outstanding requests by the table, then the owed interrupt and the handshake under its own ids', async () => {
    const plan = planOf();
    const L = plan.launchId;
    const last = predecessor(plan, (w) => {
      w.row('out', { type: 'user', uuid: 'u-1', message: { role: 'user', content: 'go' }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: 'now' });
      w.row('in', call('e-orphan', 7, 'artifact_publish', { artifactId: 'x' }, 'toolu_orphan')); // in the base file: found across the rotation
      for (let i = 0; i < 8; i += 1) w.row('in', { type: 'system', subtype: 'status', status: null, pad: 'x'.repeat(200) });
      w.row('in', call('e-ask', 8, 'ask', { questions: [question] }, 'toolu_ask'));
      w.row('in', call('e-async', 9, 'ask', { questions: [question], blocking: false }, 'toolu_async'));
      w.row('out', mcpAnswer('e-async', 9, JSON.stringify({ status: 'asked', askId: 'toolu_async' })));
      w.row('in', call('e-retired', 10, 'ask', { questions: [question] }, 'toolu_retired'));
      w.row('meta', { event: 'maws_ask_cancelled', askId: 'toolu_retired', toolUseId: 'toolu_retired', reason: 'withdrawn' });
      w.row('in', { type: 'control_request', request_id: 'e-hook', request: { subtype: 'hook_callback', callback_id: 'maws_Stop_1', input: { hook_event_name: 'Stop', session_crons: [], background_tasks: [] } } });
      w.row('in', { type: 'control_request', request_id: 'e-perm', request: { subtype: 'can_use_tool', tool_name: 'Bash', display_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_perm' } });
      w.row('out', { type: 'control_request', request_id: `${L}-2`, request: { subtype: 'interrupt', reason: 'user-cancel' } });
    }, 1_500);
    const a = adopter(plan, { owedInterrupt: true });
    expect(a.journal.currentPath).not.toBe(a.journal.path); // the predecessor's journal rotated
    await a.session.start();
    // the replay: a call that never reached the old manager, an ask its client withdrew in the ring, the old interrupt's
    // late answer; the barrier dispatches none of it but the protocol service
    a.transport.push(call('e-ring', 11, 'artifact_publish', { artifactId: 'y' }, 'toolu_ring'), 1);
    a.transport.push(call('e-ring-ask', 12, 'ask', { questions: [question] }, 'toolu_ring_ask'), 2);
    a.transport.push(mcp('e-ring-cancel', { method: 'notifications/cancelled', params: { requestId: 12 } }), 3);
    a.transport.push({ type: 'control_response', response: { subtype: 'success', request_id: `${L}-2`, response: { still_queued: [] } } }, 4);
    await until(() => a.transport.journaledSeqs.length === 4, 'the replay journaled');
    expect(responses(a.transport).map((r) => r.response.request_id)).toEqual(['e-ring-cancel']); // the protocol service only
    expect(requests(a.transport)).toEqual([]);
    a.transport.pushProblem({ kind: 'host_caught_up', message: 'caught up', length: 0, typeGuess: null });
    await until(() => a.session.lifecycle === 'ready', 'ready');

    const answered = responses(a.transport);
    expect(answered.map((r) => r.response.request_id)).toEqual(['e-ring-cancel', 'e-orphan', 'e-hook', 'e-ring']);
    for (const id of ['e-orphan', 'e-ring']) {
      const result = answered.find((r) => r.response.request_id === id)!.response.response!.mcp_response!.result!;
      expect(result).toMatchObject({ isError: true, content: [{ type: 'text', text: ORPHANED_CALL_TEXT }] });
    }
    expect(answered.find((r) => r.response.request_id === 'e-hook')!.response.response).toEqual({});
    // the owed interrupt first, then the handshake, every request named `${launchId}-${fence}-${n}`
    expect(requests(a.transport).slice(0, 2).map((r) => [r.request.subtype, r.request_id])).toEqual([['interrupt', `${L}-2-1`], ['initialize', `${L}-2-2`]]);
    expect(requests(a.transport).every((r) => r.request_id.startsWith(`${L}-2-`))).toBe(true);
    expect(a.logs.some((line) => line.includes(`${L}-2`) && line.includes('control_response'))).toBe(true); // the old interrupt's answer dropped
    expect(a.session.status().holder).toEqual({ pid: 4100, holderId: L, adopted: true });

    // the asks: the blocking one raised again, the async one restored; the retired and the withdrawn ones not
    expect(a.session.asks().map((ask) => [ask.askId, ask.requestId, ask.blocking])).toEqual([['toolu_ask', 'e-ask', true], ['toolu_async', 'e-async', false]]);
    expect(await a.session.answerAsk('toolu_ask', [{ id: 'q1', question: 'Proceed?', status: 'answered', value: ['Yes'] }])).toBe('delivered');
    const settled = responses(a.transport).at(-1)!.response;
    expect(settled.request_id).toBe('e-ask');
    expect(JSON.parse(settled.response!.mcp_response!.result!.content![0]!.text!)).toMatchObject({ status: 'answered', askId: 'toolu_ask' });
    // the permission, pending once; the engine's redelivery changes nothing
    expect(a.session.brokerItems().filter((item) => item.kind === 'permission').map((item) => [item.request.requestId, item.state])).toEqual([['e-perm', 'pending']]);
    a.transport.push({ type: 'control_request', request_id: 'e-perm', request: { subtype: 'can_use_tool', tool_name: 'Bash', display_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_perm' } }, 5);
    await until(() => a.transport.journaledSeqs.length === 5, 'the redelivery journaled');
    expect(a.session.brokerItems().filter((item) => item.kind === 'permission')).toHaveLength(1);
    // the fold's Stop: the crons and tasks known (D32)
    expect(a.session.status().work).toMatchObject({ crons: [], unknown: null });

    // the journal continues the predecessor's sequence: the reconnect, the replay, the attach, the answers
    const after = a.rows().filter((row) => row.seq > last);
    expect(after[0]).toMatchObject({ seq: last + 1, direction: 'meta', frame: { event: 'reconnect', phase: 'attempting', trigger: 'host_restart' } });
    expect(after.map((row) => row.seq)).toEqual(after.map((_, i) => last + 1 + i));
    expect(after.find((row) => (row.frame as { event?: string }).event === 'host_attach')!.frame).toEqual({ event: 'host_attach', holderId: L, fence: 2, frontier: 0, replayed: 'exact', firstSeq: null });
    expect(after.some((row) => (row.frame as { event?: string; phase?: string }).event === 'reconnect' && (row.frame as { phase?: string }).phase === 'reconnected')).toBe(true);
    // the fold told nothing: the first events are the replay's, numbered past the predecessor's rows
    expect(a.events.every((e) => e.seq !== null && e.seq > last)).toBe(true);
    a.transport.exit(0);
    await a.session.exited;
  });

  it('an engine-issued cancellation after the adoption cancels a restored ask; an exit before the re-initialize is no init failure', async () => {
    const plan = planOf();
    predecessor(plan, (w) => w.row('in', call('e-ask', 8, 'ask', { questions: [question] }, 'toolu_ask')));
    const a = adopter(plan);
    await a.session.start();
    a.transport.pushProblem({ kind: 'host_caught_up', message: 'caught up', length: 0, typeGuess: null });
    await until(() => a.session.lifecycle === 'ready', 'ready');
    expect(a.session.asks().map((ask) => ask.askId)).toEqual(['toolu_ask']);
    a.transport.push({ type: 'control_cancel_request', request_id: 'e-ask' }, 1);
    await until(() => a.session.asks().length === 0, 'the ask cancelled');
    a.transport.exit(0);
    await a.session.exited;

    const early = planOf();
    predecessor(early, () => {});
    const b = adopter(early);
    await b.session.start();
    b.transport.exit(0);
    const summary = await b.session.exited;
    expect(summary.reason).toBe('unknown');
    expect(b.rows().some((row) => (row.frame as { event?: string }).event === 'init_failed')).toBe(false);
  });

  it('a gap is journaled, its conversation reseeded from the transcript with reseeded events, the frontier passed, and the work unknown until the next Stop', async () => {
    const plan = planOf();
    predecessor(plan, (w) => {
      w.row('in', { type: 'control_request', request_id: 'e-hook', request: { subtype: 'hook_callback', callback_id: 'maws_Stop_1', input: { hook_event_name: 'Stop', session_crons: [], background_tasks: [] } } });
      w.row('out', { type: 'control_response', response: { subtype: 'success', request_id: 'e-hook', response: {} } });
      w.row('out', { type: 'user', uuid: 'u-1', message: { role: 'user', content: 'go' }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: 'now' });
    });
    // the engine's transcript: the prompt the journal holds, then what the ring lost
    const project = join(configDir, 'projects', '-tmp-maws-session');
    mkdirSync(project, { recursive: true });
    const assistant = (uuid: string, text: string) => ({ type: 'assistant', uuid, parentUuid: 'u-1', timestamp: '2026-10-31T10:00:02.000Z', sessionId: plan.sessionId, message: { id: `msg_${uuid}`, model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'text', text }] } });
    const records = [
      { type: 'user', uuid: 'u-1', parentUuid: null, timestamp: '2026-10-31T10:00:00.000Z', sessionId: plan.sessionId, message: { role: 'user', content: 'go' } },
      assistant('a-1', 'first part'),
      { ...assistant('a-side', 'a subagent'), isSidechain: true },
      assistant('a-2', 'second part'),
    ];
    writeFileSync(join(project, `${plan.sessionId}.jsonl`), `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
    const a = adopter(plan);
    await a.session.start();
    expect(a.session.status().work).toMatchObject({ unknown: null });
    a.transport.pushProblem({ kind: 'host_gap', message: 'lost', length: 0, typeGuess: null, gap: { holderId: plan.launchId, fence: 2, frontier: 0, firstSeq: 3, lostFrom: 1 } });
    // the stream's own copy of a reseeded message, read after the gap, yields nothing again
    a.transport.push({ type: 'assistant', uuid: 'a-2', session_id: plan.sessionId, parent_tool_use_id: null, message: { id: 'msg_a-2', model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'text', text: 'second part' }], stop_reason: 'end_turn', usage: {} } }, 3);
    a.transport.pushProblem({ kind: 'host_caught_up', message: 'caught up', length: 0, typeGuess: null });
    await until(() => a.session.lifecycle === 'ready', 'ready');

    const rows = a.rows();
    const at = (event: string) => rows.findIndex((row) => (row.frame as { event?: string }).event === event);
    expect(rows[at('host_attach')]!.frame).toMatchObject({ replayed: 'gap', firstSeq: 3 });
    expect(at('host_attach')).toBeLessThan(at('transcript_reseed'));
    expect((rows[at('transcript_reseed')]!.frame as { rows: { uuid: string }[] }).rows.map((r) => r.uuid)).toEqual(['a-1', 'a-2']);
    expect(rows.filter((row) => (row.frame as { event?: string }).event === 'host_attach')).toHaveLength(1); // the catch-up writes no second
    const reseeded = a.events.filter((e) => e.reseeded === true);
    expect(reseeded.filter((e) => e.kind === 'assistant.block.complete').map((e) => (e as Extract<SessionEvent, { kind: 'assistant.block.complete' }>).block)).toEqual([expect.objectContaining({ text: 'first part' }), expect.objectContaining({ text: 'second part' })]);
    expect(a.events.filter((e) => e.kind === 'assistant.block.complete' && e.reseeded !== true)).toEqual([]);
    expect(a.events.find((e) => e.kind === 'notice.posted' && e.key === 'holder:gap')).toMatchObject({ text: 'Some output was lost while the engine host was restarting; the conversation was restored from the transcript.' });
    expect(a.transport.journaledSeqs.slice(0, 2)).toEqual([1, 2]); // the lost range, passed by the frontier
    expect(readFileSync(join(dir, `${plan.launchId}.hseq`), 'utf8')).toContain('2 *\n');
    expect(a.session.status().work).toMatchObject({ unknown: 'host_gap' });
    a.transport.exit(0);
    await a.session.exited;
  });

  it('the queue is adopted as the old manager left it: a submission whose frame the journal never shows written is the uncertain head', async () => {
    const plan = planOf();
    predecessor(plan, () => {});
    const store = new MemorySessionStateStore();
    await store.saveQueue(spec.appSessionId, { paused: false, entries: [{ queueId: 'q-1', appSessionId: spec.appSessionId, content: 'next please', createdAt: '2026-10-31T10:00:00.000Z', state: 'submitting', messageUuid: 'u-unwritten' as MessageUuid, submittedAt: '2026-10-31T10:00:01.000Z', uncertain: false, steer: false }] });
    const a = adopter(plan, {}, store);
    await a.session.start();
    a.transport.pushProblem({ kind: 'host_caught_up', message: 'caught up', length: 0, typeGuess: null });
    await until(() => a.session.lifecycle === 'ready', 'ready');
    expect(a.session.queue.isPaused).toBe(true);
    expect(a.events.some((e) => e.kind === 'notice.posted' && e.key === 'queue:uncertain:q-1')).toBe(true);
    expect(a.transport.writes.filter((w) => w.type === 'user')).toEqual([]);
    a.transport.exit(0);
    await a.session.exited;
  });
});

// M3a fix wave 1 (the task review's findings 1 to 6 and 8; D49, D58)
const stopRows = (w: JournalWriter, id = 'e-stop') => {
  w.row('in', { type: 'control_request', request_id: id, request: { subtype: 'hook_callback', callback_id: 'maws_Stop_1', input: { hook_event_name: 'Stop', session_crons: [], background_tasks: [] } } });
  w.row('out', { type: 'control_response', response: { subtype: 'success', request_id: id, response: {} } });
};
const permission = (id: string) => ({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'Bash', display_name: 'Bash', input: { command: 'ls' }, tool_use_id: `toolu_${id}` } });
const initFailed = (rows: JournalRow[]) => rows.filter((row) => (row.frame as { event?: string }).event === 'init_failed').map((row) => (row.frame as { message: string }).message);
const ended = (a: ReturnType<typeof adopter>) => a.transport.calls.some((c) => c.startsWith('kill:'));

// P5 O16 M3c fix wave 1: every pending kind the broker restores keeps its originating event for `session.pendingRequest`
// (lane B's digest check reads it), though the fold told none of them
describe('an adopted session’s restored requests', () => {
  it('keeps the originating event of each request its fold read: a permission, a dialog, an elicitation', async () => {
    const plan = planOf();
    predecessor(plan, (w) => {
      w.row('out', { type: 'user', uuid: 'u-1', message: { role: 'user', content: 'go' }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: 'now' });
      w.row('in', { type: 'control_request', request_id: 'e-perm', request: { subtype: 'can_use_tool', tool_name: 'Bash', display_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_perm' } });
      w.row('in', { type: 'control_request', request_id: 'e-dialog', request: { subtype: 'request_user_dialog', dialog_kind: 'refusal_fallback_prompt', payload: { title: 'Model refused', options: ['retry'] } } });
      w.row('in', { type: 'control_request', request_id: 'e-elicit', request: { subtype: 'elicitation', mcp_server_name: 'srv', mode: 'form', message: 'pick' } });
    });
    const a = adopter(plan);
    await a.session.start();
    a.caughtUp();
    await until(() => a.session.lifecycle === 'ready', 'ready');
    const pending = a.session.brokerItems().filter((item) => item.state === 'pending').map((item) => item.request.requestId!);
    expect(pending.sort()).toEqual(['e-dialog', 'e-elicit', 'e-perm']);
    const kinds: Record<string, string> = { 'e-perm': 'permission.requested', 'e-dialog': 'dialog.requested', 'e-elicit': 'elicitation.requested' };
    expect(pending.map((id) => [id, a.session.restoredRequest(id)?.kind])).toEqual(pending.map((id) => [id, kinds[id]]));
    expect(a.events.filter((e) => e.kind.endsWith('.requested')), 'none told again').toEqual([]);
    a.transport.exit(0);
    await a.session.exited;
  });
});

describe('an adopted session, fix wave 1', () => {
  it('a journal the fold cannot read is a failed adoption: never served, nothing written, its host and engine left running', async () => {
    const plan = planOf();
    const last = predecessor(plan, (w) => w.row('in', call('e-ask', 8, 'ask', { questions: [question] }, 'toolu_ask')));
    appendFileSync(join(dir, `${plan.launchId}.jsonl`), `{broken\n${JSON.stringify({ seq: last + 2, at: new Date().toISOString(), direction: 'meta', frame: { event: 'tail' } })}\n`);
    const a = adopter(plan);
    await a.session.start();
    const summary = await a.session.exited;
    expect(a.outcome.settled).toBeInstanceOf(Error);
    expect((a.outcome.settled as Error).message).toMatch(/could not be folded/);
    expect(a.logs.some((line) => line.includes('the adoption failed') && line.includes('could not be folded') && line.includes('left running'))).toBe(true);
    expect(summary.reason).toBe('unknown');
    expect(a.session.lifecycle).not.toBe('ready');
    expect(a.transport.writes).toEqual([]);
    expect(a.transport.calls).toEqual(['detach']); // never endInput or a kill
    expect(readFileSync(join(dir, `${plan.launchId}.jsonl`), 'utf8').trim().split('\n').at(-1)).toContain('"event":"tail"'); // the journal is the old manager's still
  });

  it('a queue the adoption cannot restore is a failed adoption too', async () => {
    const plan = planOf();
    predecessor(plan, () => {});
    const store = new MemorySessionStateStore();
    store.loadQueue = () => Promise.reject(new Error('EIO: the state file could not be read'));
    const a = adopter(plan, {}, store);
    await a.session.start();
    await a.session.exited;
    expect((a.outcome.settled as Error).message).toMatch(/queue.*EIO/);
    expect(a.transport.writes).toEqual([]);
    expect(a.transport.calls).toEqual(['detach']);
  });

  it('a submission the journal already shows completed is settled at the adoption, never left live or resent', async () => {
    const plan = planOf();
    const uuid = '66666666-6666-4666-8666-666666666666' as MessageUuid;
    // the fixture's first turn's result, naming the prompt by the uuid this launch wrote it under
    const fixture = readFileSync(resolve(__dirname, '..', '..', '..', 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as JournalRow);
    const recorded = (fixture.find((row) => row.direction === 'out' && (row.frame as { type?: string }).type === 'user')!.frame as { uuid: string }).uuid;
    const result = JSON.parse(JSON.stringify(fixture.find((row) => (row.frame as { type?: string }).type === 'result')!.frame).replaceAll(recorded, uuid)) as Record<string, unknown>;
    predecessor(plan, (w) => {
      w.row('out', { type: 'user', uuid, message: { role: 'user', content: 'go' }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: 'now' });
      w.row('in', { ...result, session_id: plan.sessionId });
    });
    const store = new MemorySessionStateStore();
    await store.saveQueue(spec.appSessionId, { paused: false, entries: [{ queueId: 'q-done', appSessionId: spec.appSessionId, content: 'go', createdAt: '2026-10-31T10:00:00.000Z', state: 'released', messageUuid: uuid, submittedAt: '2026-10-31T10:00:01.000Z', uncertain: false, steer: false }] });
    const a = adopter(plan, {}, store);
    await a.session.start();
    a.caughtUp();
    await until(() => a.session.lifecycle === 'ready', 'ready');
    expect(a.session.queue.state.entries).toEqual([]);
    expect((await store.loadQueue(spec.appSessionId)).entries).toEqual([]);
    expect(a.transport.writes.filter((w) => w.type === 'user')).toEqual([]);
    a.transport.exit(0);
    await a.session.exited;
  });

  it('a gap an earlier adoption journaled keeps the work unknown until a later Stop', async () => {
    const plan = planOf();
    predecessor(plan, (w) => {
      stopRows(w);
      w.row('meta', { event: 'host_attach', holderId: plan.launchId, fence: 2, frontier: 2, replayed: 'gap', firstSeq: 3 });
    });
    const a = adopter(plan);
    await a.session.start();
    a.caughtUp();
    await until(() => a.session.lifecycle === 'ready', 'ready');
    expect(a.session.status().work!.unknown).toBe('host_gap');
    a.transport.push({ type: 'control_request', request_id: 'e-stop-2', request: { subtype: 'hook_callback', callback_id: 'maws_Stop_1', input: { hook_event_name: 'Stop', session_crons: [], background_tasks: [] } } }, 1);
    await until(() => a.session.status().work!.unknown === null, 'the later Stop');
    a.transport.exit(0);
    await a.session.exited;
  });

  it('a reseed an earlier adoption journaled is where the next gap reads the transcript from', async () => {
    const plan = planOf();
    const assistant = (uuid: string, text: string) => ({ type: 'assistant', uuid, parentUuid: 'u-1', timestamp: '2026-10-31T10:00:02.000Z', sessionId: plan.sessionId, message: { id: `msg_${uuid}`, model: 'claude-sonnet-5', role: 'assistant', content: [{ type: 'text', text }] } });
    predecessor(plan, (w) => {
      w.row('out', { type: 'user', uuid: 'u-1', message: { role: 'user', content: 'go' }, parent_tool_use_id: null, origin: { kind: 'human' }, priority: 'now' });
      w.row('meta', { event: 'transcript_reseed', rows: [assistant('a-1', 'first part')] });
    });
    const project = join(configDir, 'projects', '-tmp-maws-session');
    mkdirSync(project, { recursive: true });
    const records = [{ type: 'user', uuid: 'u-1', parentUuid: null, timestamp: '2026-10-31T10:00:00.000Z', sessionId: plan.sessionId, message: { role: 'user', content: 'go' } }, assistant('a-1', 'first part'), assistant('a-2', 'second part')];
    writeFileSync(join(project, `${plan.sessionId}.jsonl`), `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
    const a = adopter(plan);
    await a.session.start();
    a.transport.pushProblem({ kind: 'host_gap', message: 'lost', length: 0, typeGuess: null, gap: { holderId: plan.launchId, fence: 2, frontier: 0, firstSeq: 3, lostFrom: 1 } });
    a.caughtUp();
    await until(() => a.session.lifecycle === 'ready', 'ready');
    const reseeds = a.rows().filter((row) => (row.frame as { event?: string }).event === 'transcript_reseed');
    expect(reseeds.map((row) => (row.frame as { rows: { uuid: string }[] }).rows.map((r) => r.uuid))).toEqual([['a-1'], ['a-2']]);
    expect(a.events.filter((e) => e.kind === 'assistant.block.complete').map((e) => (e as Extract<SessionEvent, { kind: 'assistant.block.complete' }>).block)).toEqual([expect.objectContaining({ text: 'second part' })]);
    a.transport.exit(0);
    await a.session.exited;
  });

  it('dispatch stays held through the resume handshake; the protocol service and the answers pass, the held requests follow ready in order', async () => {
    const plan = planOf();
    predecessor(plan, () => {});
    const a = adopter(plan, {}, undefined, { responder: { initialize: () => null } });
    await a.session.start();
    a.caughtUp();
    await until(() => a.transport.requestsOf('initialize').length === 1, 'the re-initialize');
    a.transport.push(call('e-new', 3, 'ask', { questions: [question] }, 'toolu_new'), 1);
    a.transport.push({ type: 'control_request', request_id: 'e-hook', request: { subtype: 'hook_callback', callback_id: 'maws_Stop_1', input: { hook_event_name: 'Stop', session_crons: [], background_tasks: [] } } }, 2);
    a.transport.push(mcp('e-list', { id: 4, method: 'tools/list' }), 3);
    await until(() => a.transport.journaledSeqs.length === 3, 'the frames journaled');
    await sleep(20);
    expect(a.session.lifecycle).toBe('initializing');
    expect(a.session.asks()).toEqual([]);
    expect(responses(a.transport).map((r) => r.response.request_id)).toEqual(['e-list']);
    a.transport.answer('initialize', INIT_RESPONSE);
    await until(() => a.session.lifecycle === 'ready', 'ready');
    await until(() => responses(a.transport).some((r) => r.response.request_id === 'e-hook'), 'the held hook answered');
    expect(a.session.asks().map((ask) => ask.askId)).toEqual(['toolu_new']);
    expect(a.outcome.settled).toBe('ready');
    a.transport.exit(0);
    await a.session.exited;
  });

  it('D49: a restored card the re-initialize no longer lists clears on its answer; one it lists waits for the engine as any card does', async () => {
    const plan = planOf();
    predecessor(plan, (w) => {
      w.row('in', permission('e-stale'));
      w.row('in', permission('e-held'));
    });
    const a = adopter(plan, {}, undefined, { responder: { initialize: () => null } });
    await a.session.start();
    a.caughtUp();
    await until(() => a.transport.requestsOf('initialize').length === 1, 'the re-initialize');
    const initializeId = a.transport.requestsOf('initialize')[0]!.request_id;
    a.transport.push({ type: 'control_response', response: { subtype: 'success', request_id: initializeId, response: INIT_RESPONSE, pending_permission_requests: [permission('e-held')] } }, 1);
    await until(() => a.session.lifecycle === 'ready', 'ready');
    a.transport.push(permission('e-current'), 2);
    await until(() => a.session.brokerItems().length === 3, 'the live card');
    const state = (id: string) => a.session.brokerItems().find((item) => item.request.requestId === id)?.state ?? null;
    expect(await a.session.answer('e-stale' as never, { kind: 'permission', decision: 'allow', scope: 'once' } as never)).toBe('delivered');
    expect(responses(a.transport).at(-1)!.response.request_id).toBe('e-stale');
    expect(state('e-stale')).toBeNull(); // settled on the write: the engine drops an unknown id silently (D48 Q3)
    expect(state('e-current')).toBe('pending');
    expect(await a.session.answer('e-held' as never, { kind: 'permission', decision: 'allow', scope: 'once' } as never)).toBe('delivered');
    expect(responses(a.transport).at(-1)!.response.request_id).toBe('e-held');
    expect(state('e-held')).toBe('delivered'); // the engine's confirmation settles it
    a.transport.exit(0);
    await a.session.exited;
  });

  // P5 O16 M3b fix wave 1: a second handover freezes an adopted row whose handshake still waits (here on its gateway
  // read): no continuation of the handshake runs after the freeze; the row never becomes ready, the request its gate
  // held is never dispatched, and nothing is journaled after the detach
  it('a freeze during the adopted handshake ends it: never ready, its held request never dispatched, nothing after the detach', async () => {
    const plan = planOf();
    predecessor(plan, () => {});
    const a = adopter(plan, {}, undefined, { responder: { get_status: () => null } });
    const shows: unknown[] = [];
    a.session.on('paneShow', (request) => void shows.push(request));
    await a.session.start();
    a.caughtUp();
    await until(() => a.transport.requestsOf('get_status').length === 1, 'the gateway read, after the re-initialize');
    a.transport.push(call('e-held', 1, 'show_pane', { pane: 'terminal' }, 'toolu_held'), 1);
    await until(() => a.transport.journaledSeqs.includes(1), 'the held call journaled');
    a.session.freeze();
    await a.session.drained();
    await a.session.detach('handover');
    const rowsAtDetach = a.rows().length;
    await sleep(8_500); // the gateway read's deadline (read class, 8 s) passes
    expect(a.session.lifecycle).toBe('initializing');
    expect(shows).toEqual([]);
    expect(responses(a.transport).map((r) => r.response.request_id)).not.toContain('e-held');
    expect(a.rows().length).toBe(rowsAtDetach);
    expect(a.outcome.settled).toBeNull();
  }, 20_000);

  describe('D58: the re-initialize after the handover', () => {
    it('an error answer ends the session through the ladder, naming its cause', async () => {
      const plan = planOf();
      predecessor(plan, () => {});
      const a = adopter(plan, {}, undefined, { responder: { initialize: () => ({ error: 'no session to resume' }) } });
      await a.session.start();
      a.caughtUp();
      await until(() => ended(a), 'the ladder');
      a.transport.exit(null, 'SIGTERM');
      await a.session.exited;
      expect(initFailed(a.rows())).toEqual([expect.stringMatching(/^re-initialize after the handover failed: .*no session to resume/)]);
      expect(a.logs.some((line) => line.startsWith('re-initialize after the handover failed: '))).toBe(true);
      expect((a.outcome.settled as Error).message).toMatch(/re-initialize after the handover failed/);
    });

    // D58a: the end exists only because of the handover: its cause rides beside the exit's reason, and the transcript's
    // events tell it once, at the exit, with no process error or failed reconnect before it
    it('the end carries its own cause: on the exit row, the status and process.exited, with no error or failed reconnect told', async () => {
      const plan = planOf();
      predecessor(plan, () => {});
      const a = adopter(plan, {}, undefined, { responder: { initialize: () => ({ error: 'no session to resume' }) } });
      await a.session.start();
      a.caughtUp();
      await until(() => ended(a), 'the ladder');
      a.transport.exit(null, 'SIGTERM');
      await a.session.exited;
      const cause = { kind: HANDOVER_REINIT_FAILED, detail: expect.stringMatching(/^re-initialize after the handover failed: .*no session to resume/) };
      expect(a.rows().find((row) => (row.frame as { event?: string }).event === 'exit')?.frame).toMatchObject({ reason: 'crash', cause });
      expect(a.session.status().exit).toMatchObject({ reason: 'crash', cause });
      expect(a.events.filter((e) => e.kind === 'process.exited')).toEqual([expect.objectContaining({ reason: 'crash', cause })]);
      expect(a.events.filter((e) => e.kind === 'error.raised' && e.scope === 'process')).toEqual([]);
      expect(a.events.filter((e) => e.kind === 'session.reconnect' && e.phase === 'failed')).toEqual([]);
      expect(initFailed(a.rows())).toHaveLength(1); // still journaled, for the record
    });

    it('a closed stream ends it the same way', async () => {
      const plan = planOf();
      predecessor(plan, () => {});
      const a = adopter(plan, {}, undefined, { responder: { initialize: () => null } });
      await a.session.start();
      a.caughtUp();
      await until(() => a.transport.requestsOf('initialize').length === 1, 'the re-initialize');
      a.transport.endStdout();
      await until(() => ended(a), 'the ladder');
      a.transport.exit(null, 'SIGTERM');
      await a.session.exited;
      expect(initFailed(a.rows())).toEqual([expect.stringMatching(/^re-initialize after the handover failed: .*output closed/)]);
      expect(a.outcome.settled).toBeInstanceOf(Error);
    });

    it('the process gone before the answer is the failure, named', async () => {
      const plan = planOf();
      predecessor(plan, () => {});
      const a = adopter(plan, {}, undefined, { responder: { initialize: () => null } });
      await a.session.start();
      a.caughtUp();
      await until(() => a.transport.requestsOf('initialize').length === 1, 'the re-initialize');
      a.transport.exit(null, 'SIGKILL');
      const summary = await a.session.exited;
      expect(summary.reason).toBe('crash');
      expect(initFailed(a.rows())).toEqual([expect.stringMatching(/^re-initialize after the handover failed: .*exited/)]);
      expect(a.outcome.settled).toBeInstanceOf(Error);
    });

    // P5 O16 M3b (the architect's ruling on adopted-not-ready): past the bound with the engine alive, the session says so
    // once, in a notice; the owner's stop ends it through the ladder
    it('a slow answer past the bound is told once in a notice, and a stop ends the session through the ladder', async () => {
      const plan = planOf();
      predecessor(plan, () => {});
      const a = adopter(plan, {}, undefined, { responder: { initialize: () => null }, session: { reinitializeMs: 20 } });
      await a.session.start();
      a.caughtUp();
      await until(() => a.transport.requestsOf('initialize').length === 1, 'the re-initialize');
      await sleep(120); // several renewals
      expect(a.events.filter((e) => e.kind === 'notice.posted' && e.key === 'holder:reinitialize-slow').map((e) => e.kind === 'notice.posted' && e.text)).toEqual([REINITIALIZE_SLOW]);
      const stopped = a.session.stop('stop');
      await until(() => a.transport.calls.length > 0, 'the ladder');
      a.transport.exit(null, 'SIGTERM');
      await stopped;
      const summary = await a.session.exited;
      expect(summary.reason).toBe('stop');
      expect(initFailed(a.rows())).toEqual([]); // a stop, not a failure: no cause, nothing resumed
      expect(a.session.status().exit?.cause).toBeUndefined();
    });

    it('a slow answer is waited for past the bound with the process alive, never killed or cancelled', async () => {
      const plan = planOf();
      predecessor(plan, () => {});
      const a = adopter(plan, {}, undefined, { responder: { initialize: () => null }, session: { reinitializeMs: 20 } });
      await a.session.start();
      a.caughtUp();
      await until(() => a.transport.requestsOf('initialize').length === 1, 'the re-initialize');
      await sleep(120);
      expect(a.session.lifecycle).toBe('initializing');
      expect(a.transport.calls).toEqual([]);
      expect(a.transport.writes.filter((w) => w.type === 'control_cancel_request')).toEqual([]);
      expect(a.logs.some((line) => line.includes('re-initialize') && line.includes('still waiting'))).toBe(true);
      expect(a.outcome.settled).toBeNull();
      a.transport.answer('initialize', INIT_RESPONSE);
      await until(() => a.session.lifecycle === 'ready', 'ready');
      expect(initFailed(a.rows())).toEqual([]);
      expect(a.outcome.settled).toBe('ready');
      a.transport.exit(0);
      await a.session.exited;
    });
  });

  it('an environment rebuilt for the adoption is never attested: no connector launch context, and a bare MCP command is not matched through it', async () => {
    const plan = { ...planOf(), environmentRebuilt: true as const };
    predecessor(plan, () => {});
    const a = adopter(plan, {}, undefined, { responder: { mcp_status: () => ({ response: { mcpServers: [
      { name: 'bare', status: 'connected', config: { type: 'stdio', command: 'sh', args: ['-c', 'true'] } },
      { name: 'absolute', status: 'connected', config: { type: 'stdio', command: '/bin/sh', args: ['-c', 'true'] } },
    ] } }) } });
    await a.session.start();
    a.caughtUp();
    await until(() => a.session.lifecycle === 'ready', 'ready');
    expect(a.session.connectorLaunchContext()).toBeNull();
    await a.session.readMcpCommands();
    expect(a.session.mcpCommands()).toEqual([['/bin/sh', '-c', 'true']]);
    a.transport.exit(0);
    await a.session.exited;
  });

  // M3a fix wave 2 (the re-review's three ordering residuals)
  describe('fix wave 2', () => {
    it('D49 holds when the re-initialize is answered at once, before its write has resolved', async () => {
      const plan = planOf();
      predecessor(plan, (w) => {
        w.row('in', permission('e-stale'));
        w.row('in', permission('e-held'));
      });
      const a = adopter(plan, {}, undefined, {
        responder: { initialize: () => null },
        transport: {
          // the engine's answer read while the write is still in flight: the session holds it, then drains it at once
          onWrite: (frame, t) => {
            if (frame.type === 'control_request' && frame.request.subtype === 'initialize') t.push({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response: INIT_RESPONSE, pending_permission_requests: [permission('e-held')] } }, 1);
          },
        },
      });
      await a.session.start();
      a.caughtUp();
      await until(() => a.session.lifecycle === 'ready', 'ready');
      const state = (id: string) => a.session.brokerItems().find((item) => item.request.requestId === id)?.state ?? null;
      expect(await a.session.answer('e-stale' as never, { kind: 'permission', decision: 'allow', scope: 'once' } as never)).toBe('delivered');
      expect(state('e-stale')).toBeNull();
      expect(await a.session.answer('e-held' as never, { kind: 'permission', decision: 'allow', scope: 'once' } as never)).toBe('delivered');
      expect(state('e-held')).toBe('delivered');
      a.transport.exit(0);
      await a.session.exited;
    });

    it('a call withdrawn while the gate holds it, by notifications/cancelled or control_cancel_request, is never dispatched', async () => {
      const plan = planOf();
      predecessor(plan, () => {});
      const a = adopter(plan, {}, undefined, { responder: { initialize: () => null } });
      await a.session.start();
      a.caughtUp();
      await until(() => a.transport.requestsOf('initialize').length === 1, 'the re-initialize');
      a.transport.push(call('e-ask', 3, 'ask', { questions: [question] }, 'toolu_ask'), 1);
      a.transport.push(call('e-publish', 4, 'artifact_publish', { artifactId: 'x' }, 'toolu_publish'), 2);
      a.transport.push(call('e-keep', 5, 'ask', { questions: [question] }, 'toolu_keep'), 3);
      a.transport.push(mcp('e-cancel-ask', { method: 'notifications/cancelled', params: { requestId: 3 } }), 4);
      a.transport.push({ type: 'control_cancel_request', request_id: 'e-publish' }, 5);
      a.transport.push(mcp('e-cancel-other', { method: 'notifications/cancelled', params: { requestId: '5' } }), 6); // "5" is not 5
      await until(() => a.transport.journaledSeqs.length === 6, 'the frames journaled');
      a.transport.answer('initialize', INIT_RESPONSE);
      await until(() => a.session.lifecycle === 'ready', 'ready');
      await until(() => a.session.asks().length === 1, 'the kept ask');
      expect(a.session.asks().map((ask) => ask.askId)).toEqual(['toolu_keep']);
      await sleep(20);
      expect(responses(a.transport).map((r) => r.response.request_id).filter((id) => id === 'e-ask' || id === 'e-publish')).toEqual([]);
      a.transport.exit(0);
      await a.session.exited;
    });

    it('a re-initialize whose write is held past the bound is still waited for, never a failure', async () => {
      const plan = planOf();
      predecessor(plan, () => {});
      let release!: () => void;
      const blocked = new Promise<void>((done) => (release = done));
      const a = adopter(plan, {}, undefined, { session: { reinitializeMs: 20 }, transport: { holdWrite: (frame) => (frame.type === 'control_request' && frame.request.subtype === 'initialize' ? blocked : null) } });
      await a.session.start();
      a.caughtUp();
      await sleep(150);
      expect(a.session.lifecycle).toBe('initializing');
      expect(initFailed(a.rows())).toEqual([]);
      expect(a.transport.calls).toEqual([]);
      expect(a.logs.some((line) => line.includes('still waiting'))).toBe(true);
      release();
      await until(() => a.session.lifecycle === 'ready', 'ready');
      expect(a.outcome.settled).toBe('ready');
      a.transport.exit(0);
      await a.session.exited;
    });
  });
});
