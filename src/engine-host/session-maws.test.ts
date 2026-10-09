// E1 M1 (E1 execution document, Plan of Work M1, "What it proves"): the `maws` server on a real EngineSession. Scripted:
// the handshake, the tool list, `send_file` writing its record and yielding `maws.delivery.file`, `show_pane` through
// the pane bridge (answered, refused, silent), the withdrawn and exited calls, and every event reproduced by a journal
// rebuild. Replayed: E0a's pass3/p1-sdk-mcp-roundtrip through the app's own handshake, up to the probe's own writes.
// E1 M2 (Plan of Work M2, "What it proves"): the `ask` lifecycle on the same scripted session (blocking and async, the
// claim-write-commit rule with its failures, the withdrawn and exit cancellations, every event on rebuild).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AttentionId, RequestId, SessionId, ToolUseId } from '@shared/graph/ids';
import { PANE_ANSWER_MS } from '@shared/maws/panes';
import { askSteerText } from '@shared/maws/ask';
import { MAWS_TOOL_ANNOTATIONS, mawsToolList, TOOL_ERRORS, type AskAnswer } from '@shared/maws/tools';
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { loadJournal } from '../../test/support/fixtures';
import { ENGINE_BIN, FIXTURE_ENGINE_VERSION } from '../../test/support/engine-pin';
import { handshakePrelude } from './conformance/harness';
import { MemoryJournal } from './conformance/scripted-transport';
import { launchSpec, scriptedSession } from './conformance/session-harness';
import { FileDeliverableStore } from './deliverables/store';
import { buildLaunch, RELAY_URL } from './launch';
import { appReplayHandshake } from './replay-handshake';
import { replayEngine, type ReplayTransport } from './replay-transport';
import { EngineSession } from './session';
import { SessionStream } from './session-stream';
import { AskAnswerMismatch } from './tool-server/ask';

async function until(check: () => boolean, what: string, ms = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

let userData: string;
let cwd: string;
beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'maws-e1-session-'));
  cwd = mkdtempSync(join(tmpdir(), 'maws-e1-cwd-'));
  writeFileSync(join(cwd, 'hello.txt'), 'HELLO_E1');
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(userData, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

type Rpc = { jsonrpc: string; id: unknown; result?: { content?: { text: string }[]; isError?: boolean; tools?: unknown[] } & Record<string, unknown>; error?: { code: number; message: string } };

// A scripted session whose engine sends the `maws` server JSON-RPC messages, as 2.1.290 does (E0a Q1).
async function mawsSession(transport: NonNullable<Parameters<typeof scriptedSession>[0]>['transport'] = {}) {
  const run = scriptedSession({ spec: { cwd }, session: { deliverables: (onWritten) => new FileDeliverableStore(userData, { onWritten }), appVersion: '0.9.0' }, transport });
  const shows: unknown[] = [];
  run.session.on('paneShow', (request) => shows.push(request));
  // E2: the store's announcements and the capture requests
  const changes: unknown[] = [];
  run.session.on('deliverableChanged', (change) => changes.push(change));
  const captures: unknown[] = [];
  run.session.on('artifactCapture', (request) => captures.push(request));
  await run.session.start();
  let n = 0;
  const mcp = (message: Record<string, unknown>, server = 'maws'): RequestId => {
    const id = `mcp-${++n}` as RequestId;
    run.transport.push({ type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: server, message: { jsonrpc: '2.0', ...message } } });
    return id;
  };
  const call = (name: string, args: unknown, toolUseId = `toolu_${n + 1}`) => mcp({ id: n + 10, method: 'tools/call', params: { name, arguments: args, _meta: { 'claudecode/toolUseId': toolUseId, progressToken: n + 10 } } });
  const answerOf = (id: RequestId): Rpc | undefined =>
    (run.transport.writes.find((w) => w.type === 'control_response' && (w as { response: { request_id: string } }).response.request_id === id) as { response: { response: { mcp_response: Rpc } } } | undefined)?.response.response.mcp_response;
  const answered = async (id: RequestId) => {
    await until(() => answerOf(id) !== undefined, `the answer to ${id}`);
    return answerOf(id)!;
  };
  const maws = () => run.events.filter((e) => e.kind.startsWith('maws.'));
  return { ...run, shows, changes, captures, mcp, call, answerOf, answered, maws };
}

describe('the maws server on an EngineSession (scripted)', () => {
  it('answers the handshake and lists the seven tools with their annotations', async () => {
    const run = await mawsSession();
    const init = await run.answered(run.mcp({ id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code', version: '2.1.290' } } }));
    expect(init.result).toEqual({ protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'maws', version: '0.9.0' } });
    expect(await run.answered(run.mcp({ method: 'notifications/initialized' }))).toEqual({ jsonrpc: '2.0', result: {}, id: 0 });
    const list = await run.answered(run.mcp({ id: 1, method: 'tools/list' }));
    expect(list.result!.tools).toEqual(mawsToolList());
    expect((list.result!.tools as { name: string; annotations: unknown }[]).map((t) => [t.name, t.annotations])).toEqual([
      ['send_file', { ...MAWS_TOOL_ANNOTATIONS, title: 'Send file' }], ['ask', { ...MAWS_TOOL_ANNOTATIONS, title: 'Ask questions' }], ['show_pane', { ...MAWS_TOOL_ANNOTATIONS, title: 'Show pane' }],
      // E2 (Decision Log 4): the two writers are not read-only
      ['artifact_create', { readOnlyHint: false, openWorldHint: false, title: 'Create artifact' }], ['artifact_update', { readOnlyHint: false, openWorldHint: false, title: 'Update artifact' }],
      ['artifact_list', { ...MAWS_TOOL_ANNOTATIONS, title: 'List artifacts' }], ['artifact_screenshot', { ...MAWS_TOOL_ANNOTATIONS, title: 'Screenshot artifact' }],
      // E4c's six browser tools left on 2026-10-08 (P1 A-54): nothing after the artifact tools
    ]);
    expect((await run.answered(run.mcp({ id: 2, method: 'resources/list' }))).error).toEqual({ code: -32601, message: 'Method not found: resources/list' });
    expect((await run.answered(run.mcp({ id: 0, method: 'initialize' }, 'maws2'))).error!.code).toBe(-32601);
    // handshake traffic is protocol, never an unknown frame or an event of its own
    expect(run.events.filter((e) => e.kind === 'frame.unknown' || e.kind.startsWith('maws.'))).toEqual([]);
    expect(run.transport.requestsOf('initialize')[0]!.request.sdkMcpServers).toEqual(['maws']);
    run.transport.exit(0);
    await run.session.exited;
  });

  it('send_file writes the X12 record and yields maws.delivery.file, live and on rebuild', async () => {
    const run = await mawsSession();
    const id = run.call('send_file', { files: ['hello.txt'], caption: 'the greeting' }, 'toolu_send');
    const rpc = await run.answered(id);
    const result = JSON.parse(rpc.result!.content![0]!.text) as { status: string; deliverables: { id: string; path: string; name: string }[] };
    expect(result).toMatchObject({ status: 'delivered', deliverables: [{ path: join(cwd, 'hello.txt'), name: 'hello.txt' }] });
    const dir = join(userData, 'deliverables', run.session.status().appSessionId);
    expect(await readdir(dir)).toEqual([`${result.deliverables[0]!.id}.json`]);
    expect(await new FileDeliverableStore(userData).list(run.session.status().appSessionId)).toMatchObject([{ id: result.deliverables[0]!.id, kind: 'file', path: join(cwd, 'hello.txt'), title: 'hello.txt', caption: 'the greeting', toolUseId: 'toolu_send' }]);
    await until(() => run.maws().length > 0, 'the delivery event');
    expect(run.maws()).toMatchObject([{ kind: 'maws.delivery.file', toolUseId: 'toolu_send', requestId: id, deliverables: result.deliverables, caption: 'the greeting', urgency: 'normal' }]);
    // E2: the store announces the record it wrote (deliverables.changed), send_file untouched
    expect(run.changes).toEqual([{ appSessionId: run.session.status().appSessionId, id: result.deliverables[0]!.id, change: 'created' }]);
    // a refused call: an error result and no event (residue 1's admission rule)
    const refused = await run.answered(run.call('send_file', { files: ['gone.txt'] }));
    expect(refused.result).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.notAFile(join(cwd, 'gone.txt')) }], isError: true });
    const invalid = await run.answered(run.call('send_file', { files: [] }));
    expect(invalid.result!.isError).toBe(true);
    expect(run.maws()).toHaveLength(1);
    run.transport.exit(0);
    await run.session.exited;
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('show_pane asks the windows, answers what opened and yields maws.pane.shown; a refusal and an unknown pane too', async () => {
    const run = await mawsSession();
    const terminal = run.call('show_pane', { pane: 'terminal' }, 'toolu_term');
    await until(() => run.shows.length === 1, 'the pane request');
    expect(run.shows).toEqual([{ appSessionId: run.session.status().appSessionId, requestId: terminal, pane: 'terminal', target: null, line: null }]);
    expect(run.session.status().pendingRequests).toBe(1); // the call in flight
    const opened = { kind: 'panel-tool', toolId: 'terminal', tabId: 'terminal:1', title: 'Terminal' } as const;
    expect(run.session.answerPane(terminal, { ok: true, opened })).toBe('delivered');
    expect(run.session.answerPane(terminal, { ok: true, opened })).toBe('not_pending'); // a second window
    expect(JSON.parse((await run.answered(terminal)).result!.content![0]!.text)).toEqual({ status: 'shown', pane: 'terminal', opened });
    expect(run.session.status().pendingRequests).toBe(0);

    const deliverable = run.call('show_pane', { pane: 'deliverable', target: 'none' }, 'toolu_deliv');
    await until(() => run.shows.length === 2, 'the second pane request');
    run.session.answerPane(deliverable, { ok: false, error: TOOL_ERRORS.paneUnavailable('deliverable') });
    expect((await run.answered(deliverable)).result).toEqual({ content: [{ type: 'text', text: 'show_pane: the deliverable pane is not available in this build of MAWS' }], isError: true });

    const nope = await run.answered(run.call('show_pane', { pane: 'nope' }, 'toolu_nope'));
    expect(nope.result!.content![0]!.text).toBe(TOOL_ERRORS.unknownPane('nope'));
    const noTarget = await run.answered(run.call('show_pane', { pane: 'file' }, 'toolu_file'));
    expect(noTarget.result!.content![0]!.text).toBe(TOOL_ERRORS.targetRequired('file'));
    expect(run.shows).toHaveLength(2); // neither refusal reached a window

    await until(() => run.maws().length === 3, 'the pane events');
    expect(run.maws()).toMatchObject([
      { kind: 'maws.pane.shown', toolUseId: 'toolu_term', requestId: terminal, pane: 'terminal', target: null, opened, error: null },
      { kind: 'maws.pane.shown', toolUseId: 'toolu_deliv', pane: 'deliverable', target: 'none', opened: null, error: TOOL_ERRORS.paneUnavailable('deliverable') },
      { kind: 'maws.pane.shown', toolUseId: 'toolu_file', pane: 'file', target: null, opened: null, error: TOOL_ERRORS.targetRequired('file') }, // admitted, refused by the host after
    ]);
    run.transport.exit(0);
    await run.session.exited;
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('a show_pane no window answers fails with the timeout error after PANE_ANSWER_MS', async () => {
    const run = await mawsSession();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const id = run.call('show_pane', { pane: 'terminal' });
    for (let i = 0; i < 1000 && run.shows.length === 0; i++) await vi.advanceTimersByTimeAsync(0); // the frame's way in, at no time
    expect(run.shows).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PANE_ANSWER_MS - 1);
    expect(run.answerOf(id)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    expect((await run.answered(id)).result).toEqual({ content: [{ type: 'text', text: 'show_pane: no MAWS window answered within 8 s' }], isError: true });
    await until(() => run.maws().length === 1, 'the pane event');
    expect(run.maws()[0]).toMatchObject({ kind: 'maws.pane.shown', opened: null, error: TOOL_ERRORS.paneTimeout });
    run.transport.exit(0);
    await run.session.exited;
  });

  it('a call the engine withdrew, and one in flight at exit, are answered with nothing', async () => {
    const run = await mawsSession();
    const withdrawn = run.call('show_pane', { pane: 'terminal' });
    const atExit = run.call('show_pane', { pane: 'terminal' });
    await until(() => run.shows.length === 2, 'both pane requests');
    run.transport.push({ type: 'control_cancel_request', request_id: withdrawn });
    await until(() => run.session.status().pendingRequests === 1, 'the withdrawal');
    expect(run.session.answerPane(withdrawn, { ok: true, opened: { kind: 'panel-tool', toolId: 'terminal', tabId: 't', title: 'Terminal' } })).toBe('not_pending');
    run.transport.exit(1);
    await run.session.exited;
    await new Promise((r) => setTimeout(r, 10));
    expect(run.answerOf(withdrawn)).toBeUndefined();
    expect(run.answerOf(atExit)).toBeUndefined();
    expect(run.maws()).toEqual([]);
    expect(run.session.status().pendingRequests).toBe(0);
  });

  // E1 review: an interrupted turn abandons the call through MCP's `notifications/cancelled` (the engine's MCP client,
  // the official SDK's request abort handler), naming the call's JSON-RPC id; no fixture records it, so the frame is
  // built in the envelope pass3/p1-sdk-mcp-roundtrip records for every notification (seq 10)
  it('a show_pane the engine abandoned with notifications/cancelled settles at once, answered with nothing', async () => {
    const run = await mawsSession();
    const id = run.mcp({ id: 42, method: 'tools/call', params: { name: 'show_pane', arguments: { pane: 'terminal' }, _meta: { 'claudecode/toolUseId': 'toolu_pane', progressToken: 42 } } });
    await until(() => run.shows.length === 1, 'the pane request');
    expect(run.session.status().pendingRequests).toBe(1);
    const note = run.mcp({ method: 'notifications/cancelled', params: { requestId: 42, reason: 'AbortError: This operation was aborted' } });
    await until(() => run.session.status().pendingRequests === 0, 'the abandoned call settled', PANE_ANSWER_MS / 8); // not the 8 s timeout
    expect(run.session.answerPane(id, { ok: true, opened: { kind: 'panel-tool', toolId: 'terminal', tabId: 't', title: 'Terminal' } })).toBe('not_pending');
    expect(JSON.stringify(await run.answered(note))).toBe('{"jsonrpc":"2.0","result":{},"id":0}');
    run.transport.exit(0);
    await run.session.exited;
    expect(run.answerOf(id)).toBeUndefined();
    expect(run.maws()).toEqual([]);
    expect(run.rebuilt()).toEqual(run.events);
  });
});

// E1 M2: the ask lifecycle (residue 12's claim, write, commit; G6's table in host memory)
describe('ask on an EngineSession (scripted)', () => {
  const QUESTIONS = [
    { question: 'Which colour?', header: 'Colour', modality: 'choice', options: [{ label: 'Red' }, { label: 'Blue' }] },
    { id: 'title', question: 'What should the title be?', modality: 'text' },
    { question: 'Which folder?', modality: 'folder' },
  ];
  const HELD = [{ ...QUESTIONS[0], id: 'q1' }, QUESTIONS[1], { ...QUESTIONS[2], id: 'q3' }];
  const ANSWERS: AskAnswer[] = [
    { id: 'q1', question: 'Which colour?', status: 'answered', value: ['Blue'] },
    { id: 'title', question: 'What should the title be?', status: 'skipped' },
    { id: 'q3', question: 'Which folder?', status: 'decide_for_me' },
  ];
  const isAnswerTo = (id: RequestId) => (frame: StdinFrame) => frame.type === 'control_response' && (frame as { response: { request_id: string } }).response.request_id === id;
  const metaOf = (rows: JournalRow[], event: string) => rows.filter((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === event);

  it('a blocking ask holds its call until answered, then answers the AskResult (a skip has no value) and yields opened, answered', async () => {
    const run = await mawsSession();
    const id = run.call('ask', { title: 'Setup', questions: QUESTIONS }, 'toolu_ask');
    await until(() => run.session.asks().length === 1, 'the pending ask');
    expect(run.session.asks()).toEqual([{ askId: 'toolu_ask', toolUseId: 'toolu_ask', requestId: id, blocking: true, title: 'Setup', context: null, questions: HELD, openedAt: expect.any(String) }]);
    expect(run.session.status().pendingRequests).toBe(1); // the call in flight, counted once
    expect(run.answerOf(id)).toBeUndefined();
    expect(run.maws()).toMatchObject([{ kind: 'maws.ask.opened', askId: 'toolu_ask', toolUseId: 'toolu_ask', requestId: id, blocking: true, title: 'Setup', context: null, questions: HELD }]);

    expect(await run.session.answerAsk('nope', ANSWERS)).toBe('not_pending');
    expect(await run.session.answerAsk('toolu_ask', ANSWERS)).toBe('delivered');
    const rpc = await run.answered(id);
    expect(rpc).toEqual({ jsonrpc: '2.0', id: expect.any(Number), result: { content: [{ type: 'text', text: JSON.stringify({ status: 'answered', askId: 'toolu_ask', answers: ANSWERS }, null, 2) }] } });
    expect(await run.session.answerAsk('toolu_ask', ANSWERS)).toBe('not_pending'); // answered once
    expect(run.session.asks()).toEqual([]);
    await until(() => run.session.status().pendingRequests === 0, 'the call settled');
    await until(() => run.maws().length === 2, 'the answered event');
    expect(run.maws()[1]).toMatchObject({ kind: 'maws.ask.answered', askId: 'toolu_ask', toolUseId: 'toolu_ask', answers: ANSWERS, delivery: 'result' });
    expect(run.transport.writes.filter(isAnswerTo(id))).toHaveLength(1); // the call's own settling wrote nothing more
    run.transport.exit(0);
    await run.session.exited;
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('an async ask answers {status: asked} at once; its answers go as a next steer, then maws_ask_answered', async () => {
    const run = await mawsSession();
    const id = run.call('ask', { blocking: false, questions: [QUESTIONS[0]] }, 'toolu_async');
    const ack = await run.answered(id);
    expect(JSON.parse(ack.result!.content![0]!.text)).toEqual({ status: 'asked', askId: 'toolu_async' });
    expect(run.session.asks()).toMatchObject([{ askId: 'toolu_async', blocking: false }]);
    await until(() => run.session.status().pendingRequests === 1, 'the async ask counted');
    const answers = [ANSWERS[0]!];
    expect(await run.session.answerAsk('toolu_async', answers)).toBe('delivered');
    const steer = run.transport.writes.find((w) => w.type === 'user') as { message: { content: string }; priority: string; uuid: string };
    expect(steer.priority).toBe('next');
    expect(steer.message.content).toBe(askSteerText('toolu_async', [HELD[0]!] as never, answers));
    const rows = run.journal.rows;
    const steerRow = rows.find((r) => r.direction === 'out' && (r.frame as { type?: string }).type === 'user')!;
    const [meta] = metaOf(rows, 'maws_ask_answered');
    expect(meta!.frame).toEqual({ event: 'maws_ask_answered', askId: 'toolu_async', toolUseId: 'toolu_async', answers });
    expect(meta!.seq).toBe(steerRow.seq - 1); // the steer write's preface: journaled only with a successful write, just before its row
    expect(run.session.asks()).toEqual([]);
    expect(run.session.status().pendingRequests).toBe(0);
    expect(run.maws().map((e) => e.kind)).toEqual(['maws.ask.opened', 'maws.ask.answered']);
    expect(run.maws()[1]).toMatchObject({ askId: 'toolu_async', answers, delivery: 'steer' });
    run.transport.exit(0);
    await run.session.exited;
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('refuses answers that do not fit the questions before any claim, writing nothing', async () => {
    const run = await mawsSession();
    run.call('ask', { questions: QUESTIONS }, 'toolu_bad');
    await until(() => run.session.asks().length === 1, 'the pending ask');
    await expect(run.session.answerAsk('toolu_bad', ANSWERS.slice(1))).rejects.toThrow(AskAnswerMismatch);
    await expect(run.session.answerAsk('toolu_bad', ANSWERS.slice(1))).rejects.toThrow('ask toolu_bad: no answer for question q1');
    expect(run.transport.writes.filter((w) => w.type === 'control_response')).toEqual([]);
    expect(await run.session.answerAsk('toolu_bad', ANSWERS)).toBe('delivered'); // still pending, still answerable
    run.transport.exit(0);
    await run.session.exited;
  });

  it('a second submit while the first is being written is not_pending', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding: RequestId | null = null;
    const run = await mawsSession({ holdWrite: (frame) => (holding !== null && isAnswerTo(holding)(frame) ? held : null) });
    holding = run.call('ask', { questions: QUESTIONS }, 'toolu_twice');
    await until(() => run.session.asks().length === 1, 'the pending ask');
    const first = run.session.answerAsk('toolu_twice', ANSWERS);
    expect(await run.session.answerAsk('toolu_twice', ANSWERS)).toBe('not_pending');
    expect(run.session.asks()).toHaveLength(1); // listed while being answered
    release();
    expect(await first).toBe('delivered');
    run.transport.exit(0);
    await run.session.exited;
  });

  it.each([true, false])('a refused write (blocking %s) is write_failed with the ask still listed and no answered row; a retry delivers', async (blocking) => {
    let failing = true;
    let askRequest: RequestId | null = null;
    const isAnswerWrite = (frame: StdinFrame) => (blocking ? askRequest !== null && isAnswerTo(askRequest)(frame) : frame.type === 'user');
    const run = await mawsSession({ failWrite: (frame) => failing && isAnswerWrite(frame) });
    askRequest = run.call('ask', { blocking, questions: QUESTIONS }, 'toolu_retry');
    await until(() => run.session.asks().length === 1, 'the pending ask');
    expect(await run.session.answerAsk('toolu_retry', ANSWERS)).toBe('write_failed');
    expect(run.session.asks()).toMatchObject([{ askId: 'toolu_retry' }]);
    expect(metaOf(run.journal.rows, 'maws_ask_answered')).toEqual([]);
    expect(run.maws().map((e) => e.kind)).toEqual(['maws.ask.opened']);
    failing = false;
    expect(await run.session.answerAsk('toolu_retry', ANSWERS)).toBe('delivered');
    await until(() => run.maws().length === 2, 'the answered event');
    expect(run.maws()[1]).toMatchObject({ kind: 'maws.ask.answered', delivery: blocking ? 'result' : 'steer' });
    run.transport.exit(0);
    await run.session.exited;
    expect(run.rebuilt()).toEqual(run.events);
  });

  // M2 fix wave: the answer reached the engine but its journal row could not be written (disk full): never `delivered`,
  // never retryable (a retry would deliver the answers twice); the session ends the process through its journal-failure
  // path, and the exit cancels the ask
  it.each([true, false])('a live journal failure on the answer (blocking %s) is write_failed, not retryable, and the session ends', async (blocking) => {
    const run = await mawsSession();
    const askRequest = run.call('ask', { blocking, questions: QUESTIONS }, 'toolu_disk');
    await until(() => run.session.asks().length === 1, 'the pending ask');
    run.journal.failOnce = (direction, frame) =>
      blocking ? direction === 'out' && isAnswerTo(askRequest)(frame as StdinFrame) : direction === 'meta' && (frame as { event?: string }).event === 'maws_ask_answered';
    expect(await run.session.answerAsk('toolu_disk', ANSWERS)).toBe('write_failed');
    expect(await run.session.answerAsk('toolu_disk', ANSWERS)).toBe('not_pending'); // claimed: no second delivery
    expect(metaOf(run.journal.rows, 'transport_error').map((r) => r.frame)).toContainEqual({ event: 'transport_error', code: 'journal_failed', message: 'journal write failed: ENOSPC: no space left on device' });
    expect(metaOf(run.journal.rows, 'maws_ask_answered')).toEqual([]);
    expect(run.logs.some((m) => m.includes('journal write failed') && m.includes('ending the process'))).toBe(true);
    run.transport.exit(0);
    await run.session.exited;
    expect(run.session.asks()).toEqual([]);
    expect(run.maws().map((e) => e.kind)).toEqual(['maws.ask.opened', 'maws.ask.cancelled']); // never answered
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('an exit during an answer is write_failed, then every pending ask is cancelled before the exit row', async () => {
    let holding: RequestId | null = null;
    let reached = false;
    const run = await mawsSession({ holdWrite: (frame) => (holding !== null && isAnswerTo(holding)(frame) ? ((reached = true), new Promise<void>(() => {})) : null) });
    holding = run.call('ask', { questions: QUESTIONS }, 'toolu_exit');
    run.call('ask', { blocking: false, questions: QUESTIONS }, 'toolu_later');
    await until(() => run.session.asks().length === 2, 'both asks');
    const answering = run.session.answerAsk('toolu_exit', ANSWERS);
    await until(() => reached, 'the answer on its way to the pipe');
    run.transport.exit(1);
    await run.session.exited;
    expect(await answering).toBe('write_failed');
    expect(run.session.asks()).toEqual([]);
    const rows = run.journal.rows;
    const cancelled = metaOf(rows, 'maws_ask_cancelled');
    expect(cancelled.map((r) => r.frame)).toEqual([
      { event: 'maws_ask_cancelled', askId: 'toolu_exit', toolUseId: 'toolu_exit', reason: 'exit' },
      { event: 'maws_ask_cancelled', askId: 'toolu_later', toolUseId: 'toolu_later', reason: 'exit' },
    ]);
    const exitRow = metaOf(rows, 'exit')[0]!;
    expect(cancelled.every((r) => r.seq < exitRow.seq)).toBe(true);
    expect(run.maws().filter((e) => e.kind === 'maws.ask.cancelled')).toMatchObject([{ askId: 'toolu_exit', reason: 'exit' }, { askId: 'toolu_later', reason: 'exit' }]);
    expect(run.answerOf(holding)).toBeUndefined();
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('an ask the engine withdrew is cancelled (withdrawn) and answered with nothing', async () => {
    const run = await mawsSession();
    const id = run.call('ask', { questions: QUESTIONS }, 'toolu_gone');
    await until(() => run.session.asks().length === 1, 'the pending ask');
    run.transport.push({ type: 'control_cancel_request', request_id: id });
    await until(() => run.session.asks().length === 0, 'the withdrawal');
    expect(await run.session.answerAsk('toolu_gone', ANSWERS)).toBe('not_pending');
    expect(metaOf(run.journal.rows, 'maws_ask_cancelled').map((r) => r.frame)).toEqual([{ event: 'maws_ask_cancelled', askId: 'toolu_gone', toolUseId: 'toolu_gone', reason: 'withdrawn' }]);
    await until(() => run.maws().length === 2, 'the cancelled event');
    expect(run.maws()[1]).toMatchObject({ kind: 'maws.ask.cancelled', askId: 'toolu_gone', reason: 'withdrawn' });
    run.transport.exit(0);
    await run.session.exited;
    expect(run.answerOf(id)).toBeUndefined();
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('a refused ask call answers an error, holds nothing and yields no maws event; without _meta the askId is the request id', async () => {
    const run = await mawsSession();
    const refused = await run.answered(run.call('ask', { questions: [{ question: 'Q?', modality: 'choice' }] }));
    expect(refused.result!.isError).toBe(true);
    expect(refused.result!.content![0]!.text).toMatch(/^ask: invalid arguments: /);
    expect(run.session.asks()).toEqual([]);
    expect(run.maws()).toEqual([]);
    const bare = run.mcp({ id: 99, method: 'tools/call', params: { name: 'ask', arguments: { blocking: false, questions: [QUESTIONS[1]] } } });
    expect(JSON.parse((await run.answered(bare)).result!.content![0]!.text)).toEqual({ status: 'asked', askId: bare });
    expect(run.maws()).toMatchObject([{ kind: 'maws.ask.opened', askId: bare, toolUseId: null }]);
    run.transport.exit(0);
    await run.session.exited;
    expect(run.rebuilt()).toEqual(run.events);
  });
});

// E1 M4b (the architect's ruling 1): a blocking ask waits on the human as an AskUserQuestion does, so it is a `question`
// attention item published with the broker's list (Overview card, Needs-you, notifier) until it is answered or
// cancelled, and `session.pendingRequest` answers its `maws.ask.opened` event for the card; an async ask is none.
describe('a blocking ask as a question attention item (scripted)', () => {
  const QUESTIONS = [{ question: 'Which colour?', modality: 'choice', options: [{ label: 'Red' }, { label: 'Blue' }] }];
  const ANSWERS: AskAnswer[] = [{ id: 'q1', question: 'Which colour?', status: 'answered', value: ['Blue'] }];

  // The session wired to a SessionStream as `registerEngineIpc` wires it, with every published list kept.
  async function attended() {
    const run = await mawsSession();
    const published: AttentionItem[][] = [];
    const stream = new SessionStream({ appSessionId: run.session.status().appSessionId, launchId: 'L', sessionId: null, journalPath: join(userData, 'L.jsonl'), emit: () => true });
    run.session.on('events', (events) => stream.events(events));
    run.session.on('brokerItems', (items) => {
      published.push(items);
      stream.brokerItems(items);
    });
    return { ...run, published, stream, last: () => published.at(-1) ?? [] };
  }

  it('is pending while the ask waits, with its summary and request, and retires once answered', async () => {
    const run = await attended();
    const id = run.call('ask', { title: 'Setup', questions: QUESTIONS }, 'toolu_att');
    await until(() => run.session.asks().length === 1, 'the pending ask');
    const { appSessionId } = run.session.status();
    const openedAt = run.session.asks()[0]!.openedAt;
    const item: AttentionItem = {
      id: `${appSessionId}:${id}` as AttentionId, appSessionId, sessionId: run.session.status().engineSessionId as SessionId, kind: 'question',
      request: { requestId: id, toolUseId: 'toolu_att' as ToolUseId, taskId: null, agentId: null }, summary: 'Setup', createdAt: openedAt, state: 'pending', stateChangedAt: openedAt, expiresAt: null,
    };
    expect(run.last()).toEqual([item]);
    expect(run.session.brokerItems()).toEqual([item]); // what a reload reads
    const opened = run.maws().find((e) => e.kind === 'maws.ask.opened');
    expect(run.stream.pendingRequest(id)).toEqual(opened);

    expect(await run.session.answerAsk('toolu_att', ANSWERS)).toBe('delivered');
    expect(run.last()).toEqual([]);
    expect(run.session.brokerItems()).toEqual([]);
    expect(run.stream.pendingRequest(id)).toBeNull();
    run.transport.exit(0);
    await run.session.exited;
  });

  it('summarises an untitled ask by its first question, and retires when the engine withdraws it or the process ends', async () => {
    const run = await attended();
    const gone = run.call('ask', { questions: QUESTIONS }, 'toolu_gone');
    run.call('ask', { questions: QUESTIONS }, 'toolu_exit');
    await until(() => run.session.asks().length === 2, 'both asks');
    expect(run.last().map((i) => [i.request.toolUseId, i.summary, i.state])).toEqual([['toolu_gone', 'Which colour?', 'pending'], ['toolu_exit', 'Which colour?', 'pending']]);
    run.transport.push({ type: 'control_cancel_request', request_id: gone });
    await until(() => run.session.asks().length === 1, 'the withdrawal');
    expect(run.last().map((i) => i.request.toolUseId)).toEqual(['toolu_exit']);
    expect(run.stream.pendingRequest(gone)).toBeNull();
    run.transport.exit(1);
    await run.session.exited;
    expect(run.last()).toEqual([]);
    expect(run.session.brokerItems()).toEqual([]);
  });

  // E1 review: the user interrupts the turn while a blocking ask waits. The engine's MCP client drops the call and says
  // so with `notifications/cancelled` naming its JSON-RPC id (no control_cancel_request); the ask is withdrawn exactly as
  // a withdrawn control request withdraws it, so nobody can answer it and no one sees an answer the model never got.
  it('a blocking ask abandoned by notifications/cancelled is cancelled (withdrawn): item gone, nothing written, rebuild equal', async () => {
    const run = await attended();
    const id = run.mcp({ id: 7, method: 'tools/call', params: { name: 'ask', arguments: { title: 'Setup', questions: QUESTIONS }, _meta: { 'claudecode/toolUseId': 'toolu_int', progressToken: 7 } } });
    await until(() => run.session.asks().length === 1, 'the pending ask');
    expect(run.last().map((i) => [i.kind, i.request.toolUseId])).toEqual([['question', 'toolu_int']]);
    expect(run.session.status().pendingRequests).toBe(1);
    run.mcp({ method: 'notifications/cancelled', params: { requestId: 999, reason: 'not a call' } }); // names no call: nothing
    const note = run.mcp({ method: 'notifications/cancelled', params: { requestId: 7, reason: 'AbortError: This operation was aborted' } });
    await until(() => run.session.asks().length === 0, 'the withdrawal');
    expect(run.last()).toEqual([]);
    expect(run.session.brokerItems()).toEqual([]);
    expect(run.stream.pendingRequest(id)).toBeNull();
    await until(() => run.session.status().pendingRequests === 0, 'the call settled');
    const writes = run.transport.writes.length;
    expect(await run.session.answerAsk('toolu_int', ANSWERS)).toBe('not_pending');
    expect(run.transport.writes.length).toBe(writes); // a later Submit writes nothing
    const cancelled = run.journal.rows.filter((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'maws_ask_cancelled');
    expect(cancelled.map((r) => r.frame)).toEqual([{ event: 'maws_ask_cancelled', askId: 'toolu_int', toolUseId: 'toolu_int', reason: 'withdrawn' }]);
    expect(JSON.stringify(await run.answered(note))).toBe('{"jsonrpc":"2.0","result":{},"id":0}'); // the notification's own request
    run.transport.exit(0);
    await run.session.exited;
    expect(run.answerOf(id)).toBeUndefined();
    expect(run.maws().map((e) => e.kind)).toEqual(['maws.ask.opened', 'maws.ask.cancelled']);
    expect(run.maws()[1]).toMatchObject({ kind: 'maws.ask.cancelled', askId: 'toolu_int', toolUseId: 'toolu_int', reason: 'withdrawn' });
    expect(run.rebuilt()).toEqual(run.events);
  });

  // M5 fix: exit parity with an AskUserQuestion. The broker confirmed the ask's permission at its tools/call, so it is
  // no longer the broker's loss; the blocking ask, still published, is counted (and named) as a question lost. An async
  // ask, never an attention item, is not counted.
  it('a blocking ask pending at the exit is lost attention on the exit row and the process.exited event; an async one is not', async () => {
    const run = await attended();
    run.transport.push({ type: 'control_request', request_id: 'perm-1', request: { subtype: 'can_use_tool', tool_name: 'mcp__maws__ask', input: { questions: QUESTIONS }, tool_use_id: 'toolu_lost' } });
    await until(() => run.last().length === 1, 'the permission');
    expect(await run.session.answer('perm-1' as RequestId, { kind: 'permission', decision: 'allow', scope: 'once' })).toBe('delivered');
    run.call('ask', { questions: QUESTIONS }, 'toolu_lost');
    run.call('ask', { blocking: false, questions: QUESTIONS }, 'toolu_async');
    await until(() => run.session.asks().length === 2, 'both asks');
    expect(run.last().map((i) => [i.kind, i.state])).toEqual([['permission', 'confirmed'], ['question', 'pending']]);
    run.transport.exit(1);
    expect((await run.session.exited).lostAttentionCount).toBe(1);
    const exitRow = run.journal.rows.find((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'exit')!;
    expect(exitRow.frame).toMatchObject({ event: 'exit', reason: 'crash', lostAttentionCount: 1, lostAskCount: 1 });
    expect(run.events.at(-1)).toMatchObject({ kind: 'process.exited', reason: 'crash', lostAttentionCount: 1, lostAskCount: 1 });
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('an exit with no blocking ask pending writes no lostAskCount', async () => {
    const run = await attended();
    await run.answered(run.call('ask', { blocking: false, questions: QUESTIONS }, 'toolu_async'));
    run.transport.exit(1);
    expect((await run.session.exited).lostAttentionCount).toBe(0);
    const exitRow = run.journal.rows.find((r) => r.direction === 'meta' && (r.frame as { event?: string }).event === 'exit')!;
    expect(exitRow.frame).not.toHaveProperty('lostAskCount');
    expect(run.events.at(-1)).not.toHaveProperty('lostAskCount');
  });

  it('an async ask is no attention item, and publishes nothing', async () => {
    const run = await attended();
    const before = run.published.length;
    const id = run.call('ask', { blocking: false, questions: QUESTIONS }, 'toolu_async');
    await run.answered(id);
    expect(run.session.asks()).toHaveLength(1);
    expect(await run.session.answerAsk('toolu_async', ANSWERS)).toBe('delivered');
    expect(run.published.slice(before)).toEqual([]);
    expect(run.session.brokerItems()).toEqual([]);
    expect(run.stream.pendingRequest(id)).toBeNull();
    run.transport.exit(0);
    await run.session.exited;
  });
});

// E2 start (E2 execution document, M1 step 5): the artifact tools on the same scripted session: the store's copy and
// record, `deliverables.changed`, `maws.delivery.artifact` live and on rebuild, the refusals, the capture bridge
describe('the artifact tools on an EngineSession (scripted)', () => {
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const json = (rpc: Rpc) => JSON.parse(rpc.result!.content!.find((b) => (b as { type?: string }).type === 'text')!.text) as Record<string, unknown>;

  it('create and update copy versions, write the record, announce it and yield maws.delivery.artifact, live and on rebuild; a refusal yields nothing', async () => {
    writeFileSync(join(cwd, 'dashboard.html'), '<h1 style="color:red">HELLO_E2</h1>');
    const run = await mawsSession();
    const appSessionId = run.session.status().appSessionId;
    const create = run.call('artifact_create', { id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' }, 'toolu_create');
    const created = json(await run.answered(create));
    expect(created).toMatchObject({ status: 'created', id: 'dash', version: 1, title: 'Dashboard', externalReferences: 0 });
    const deliverableId = created.deliverableId as string;
    const dir = join(userData, 'deliverables', appSessionId);
    expect((await readdir(join(dir, deliverableId)))).toEqual(['v1.html']);
    expect(run.changes).toEqual([{ appSessionId, id: deliverableId, change: 'created' }]);

    writeFileSync(join(cwd, 'dashboard.html'), '<h1 style="color:blue">HELLO_E2</h1>');
    const update = run.call('artifact_update', { id: 'dash', html_path: 'dashboard.html' }, 'toolu_update');
    expect(json(await run.answered(update))).toEqual({ status: 'updated', id: 'dash', deliverableId, version: 2, title: 'Dashboard', externalReferences: 0 });
    expect((await readdir(join(dir, deliverableId))).sort()).toEqual(['v1.html', 'v2.html']);
    expect(await new FileDeliverableStore(userData).get(appSessionId, deliverableId)).toMatchObject({ kind: 'artifact', artifactId: 'dash', path: join(dir, deliverableId, 'v2.html'), versions: [{ toolUseId: 'toolu_create' }, { toolUseId: 'toolu_update' }] });
    expect(run.changes).toEqual([{ appSessionId, id: deliverableId, change: 'created' }, { appSessionId, id: deliverableId, change: 'updated' }]);

    const listed = json(await run.answered(run.call('artifact_list', {}, 'toolu_list')));
    expect(listed).toMatchObject({ status: 'listed', artifacts: [{ id: 'dash', deliverableId, title: 'Dashboard', versions: 2 }] });
    const refused = await run.answered(run.call('artifact_update', { id: 'nope', html_path: 'dashboard.html' }, 'toolu_nope'));
    expect(refused.result).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.noArtifact('artifact_update', 'nope') }], isError: true });
    const invalid = await run.answered(run.call('artifact_create', { id: 'dash', html_path: 'dashboard.html' }, 'toolu_invalid'));
    expect(invalid.result!.isError).toBe(true);

    await until(() => run.maws().length === 2, 'the artifact events');
    await new Promise((r) => setTimeout(r, 20)); // nothing more arrives for the list, the refusal or the invalid call
    expect(run.maws()).toMatchObject([
      { kind: 'maws.delivery.artifact', toolUseId: 'toolu_create', requestId: create, action: 'create', artifactId: 'dash', deliverableId, version: 1, title: 'Dashboard' },
      { kind: 'maws.delivery.artifact', toolUseId: 'toolu_update', requestId: update, action: 'update', artifactId: 'dash', deliverableId, version: 2, title: 'Dashboard' },
    ]);
    expect(run.changes).toHaveLength(2);
    run.transport.exit(0);
    await run.session.exited;
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('artifact_screenshot asks main through maws.artifact.capture and answers the image block first; a second answer is not_pending', async () => {
    writeFileSync(join(cwd, 'dashboard.html'), '<h1>HELLO_E2</h1>');
    const run = await mawsSession();
    const appSessionId = run.session.status().appSessionId;
    const deliverableId = json(await run.answered(run.call('artifact_create', { id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' }))).deliverableId;
    const shot = run.call('artifact_screenshot', { id: 'dash' }, 'toolu_shot');
    await until(() => run.captures.length === 1, 'the capture request');
    expect(run.captures).toEqual([{ appSessionId, requestId: shot, deliverableId, version: 1, width: 1280, height: 800 }]);
    expect(run.session.status().pendingRequests).toBe(1);
    expect(run.session.answerCapture(shot, { ok: true, png: PNG, width: 1280, height: 800, consoleErrors: [] })).toBe('delivered');
    expect(run.session.answerCapture(shot, { ok: true, png: PNG, width: 1280, height: 800, consoleErrors: [] })).toBe('not_pending');
    const rpc = await run.answered(shot);
    expect(rpc.result!.content![0]).toEqual({ type: 'image', data: PNG, mimeType: 'image/png' });
    expect(json(rpc)).toMatchObject({ status: 'captured', id: 'dash', deliverableId, title: 'Dashboard', version: 1, width: 1280, height: 800, consoleErrors: [] });
    // a refusal from main
    const failed = run.call('artifact_screenshot', { id: 'dash' });
    await until(() => run.captures.length === 2, 'the second capture request');
    run.session.answerCapture(failed, { ok: false, error: 'screenshot too large (5000000 bytes); ask for a smaller size' });
    expect((await run.answered(failed)).result).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.captureFailed('screenshot too large (5000000 bytes); ask for a smaller size') }], isError: true });
    expect(run.maws()).toMatchObject([{ kind: 'maws.delivery.artifact', action: 'create' }]); // a screenshot makes no event
    run.transport.exit(0);
    await run.session.exited;
    expect(run.rebuilt()).toEqual(run.events);
  });

  it('a screenshot the engine withdrew, and one pending at exit, are answered with nothing', async () => {
    writeFileSync(join(cwd, 'dashboard.html'), '<h1>HELLO_E2</h1>');
    const run = await mawsSession();
    await run.answered(run.call('artifact_create', { id: 'dash', html_path: 'dashboard.html', title: 'Dashboard' }));
    const withdrawn = run.call('artifact_screenshot', { id: 'dash' });
    const atExit = run.call('artifact_screenshot', { id: 'dash' });
    await until(() => run.captures.length === 2, 'both capture requests');
    run.transport.push({ type: 'control_cancel_request', request_id: withdrawn });
    await until(() => run.session.status().pendingRequests === 1, 'the withdrawal');
    expect(run.session.answerCapture(withdrawn, { ok: true, png: PNG, width: 1, height: 1, consoleErrors: [] })).toBe('not_pending');
    run.transport.exit(1);
    await run.session.exited;
    await new Promise((r) => setTimeout(r, 10));
    expect(run.answerOf(withdrawn)).toBeUndefined();
    expect(run.answerOf(atExit)).toBeUndefined();
    expect(run.session.answerCapture(atExit, { ok: true, png: PNG, width: 1, height: 1, consoleErrors: [] })).toBe('not_pending');
  });
});
// E2 end

// The app-replay pattern (surface-replay.test.ts): the app's own handshake through the replay transport, surface reads
// on, the recorded prompt sent and the recorded permission allowed through the session, ended where the probe's own
// writes begin (seq 96, its notifications/tools/list_changed), which the app never makes.
describe('an app replay of pass3/p1-sdk-mcp-roundtrip (E0a Q1)', () => {
  it('handshakes the maws server, lists every maws tool and answers the probe-only echo_file as an unknown tool', async () => {
    const fixture = loadJournal('pass3', 'p1-sdk-mcp-roundtrip');
    const spec = launchSpec({ appSessionId: 'replay-p1-sdk-mcp' as never, sessionId: null, model: null, replay: 'pass3/p1-sdk-mcp-roundtrip' });
    const plan = buildLaunch(spec, { PATH: '/usr/bin', HOME: '/Users/x' }, { relayUrl: RELAY_URL, bin: ENGINE_BIN, engineVersion: FIXTURE_ENGINE_VERSION });
    const journal = new MemoryJournal();
    const events: SessionEvent[] = [];
    const recorded = (seq: number) => fixture.find((r) => r.seq === seq)!.frame as { request_id: string; request: { message: { id?: number } }; message: { content: string } };
    let transport!: ReplayTransport;
    const session: EngineSession = new EngineSession({
      spec, plan, journal, log: () => {},
      spawn: () =>
        (transport = replayEngine(appReplayHandshake(fixture, spec.trust), {
          prelude: handshakePrelude(),
          surfaceReads: true,
          onHold: (row: JournalRow) => {
            if (row.seq === 17) void session.start().then(() => session.send(recorded(17).message.content));
            else if (row.seq === 65) void session.answer(recorded(63).request_id as RequestId, { kind: 'permission', decision: 'allow', scope: 'once' });
            else if (row.seq === 96) transport.kill('SIGTERM'); // the probe's own notification: E0a's, not the app's
          },
        })),
    });
    session.on('events', (batch) => events.push(...batch));
    await session.start();
    await session.exited;

    const meta = journal.rows.filter((r) => r.direction === 'meta').map((r) => r.frame as { event: string });
    expect(meta.filter((m) => m.event === 'replay_mismatch')).toEqual([]);
    expect(journal.rows.some((r) => r.direction === 'meta' && (r.frame as { event: string }).event === 'exit')).toBe(true);
    // the host's initialize matched seq 4 (the projection put the app's own sdkMcpServers in the recording's place)
    const initOut = journal.rows.find((r) => r.direction === 'out' && (r.frame as StdinFrame & { request?: { subtype?: string } }).request?.subtype === 'initialize')!;
    expect((initOut.frame as { request: Record<string, unknown> }).request.sdkMcpServers).toEqual(['maws']);
    // the host's own answers to seqs 5, 10, 13 and 71 (the replay matched each against seqs 6, 11, 14 and 72)
    const answerTo = (seq: number) => (journal.rows.find((r) => r.direction === 'out' && (r.frame as { type: string; response?: { request_id?: string } }).response?.request_id === recorded(seq).request_id)?.frame as { response: { response: { mcp_response: Rpc } } } | undefined)?.response.response.mcp_response;
    expect(answerTo(5)).toEqual({ jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'maws', version: 'unknown' } } });
    expect(answerTo(10)).toEqual({ jsonrpc: '2.0', result: {}, id: 0 });
    expect(answerTo(13)).toEqual({ jsonrpc: '2.0', id: 1, result: { tools: mawsToolList() } });
    expect(answerTo(71)).toEqual({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: TOOL_ERRORS.unknownTool('echo_file') }], isError: true } });
    // the engine's init, as recorded: its own tool and the sdk server; no mcp_message frame is unknown any more
    const init = events.find((e): e is Extract<SessionEvent, { kind: 'session.init' }> => e.kind === 'session.init')!;
    expect(init.tools).toContain('mcp__maws__echo_file');
    expect(init.mcpServers).toContainEqual({ name: 'maws', status: 'connected', source: 'sdk' });
    expect(events.filter((e) => e.kind === 'frame.unknown')).toEqual([]);
    expect(events.filter((e) => e.kind.startsWith('maws.'))).toEqual([]); // echo_file is not a maws tool
    // the model saw the host's refusal as its tool result (the recording's own text: the replay returns recorded frames)
    expect(events.some((e) => e.kind === 'tool.result' && e.toolUseId === 'toolu_01EThqbUucMRpM9sLzabT5Vs')).toBe(true);
  });
});

// E4c start: the six browser tools left the `maws` server on 2026-10-08 (P1 A-54; the in-app browser spec's acceptance 12):
// the session lists none of them, and a call naming one is the server's unknown tool, with nothing asked of main.
describe('the removed browser tools on an EngineSession (scripted)', () => {
  it('lists no browser_* tool, and answers a call to one as an unknown tool without asking main', async () => {
    const run = await mawsSession();
    const listed = await run.answered(run.mcp({ id: 1, method: 'tools/list' }));
    expect((listed.result!.tools as { name: string }[]).filter((tool) => tool.name.startsWith('browser_'))).toEqual([]);
    const act = await run.answered(run.call('browser_act', { tabId: 'b_0123456789ab', action: 'click', target: 'e12' }, 'toolu_click'));
    expect(act.result).toEqual({ content: [{ type: 'text', text: TOOL_ERRORS.unknownTool('browser_act') }], isError: true });
    expect(run.shows).toEqual([]);
    expect(run.captures).toEqual([]);
    run.transport.exit(0);
    await run.session.exited;
  });
});
// E4c end
