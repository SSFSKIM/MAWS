import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { RequestId } from '@shared/graph/ids';
import { LaunchSpecSchema, type LaunchSpec } from '@shared/engine/launch-spec';
import { EngineSessionStatusSchema, type EngineSessionStatus } from '@shared/engine/status';
import type { StdinFrame } from '@shared/wire/frames';
import { loadEngineJournal } from '../../test/support/fixtures';
import { buildLaunch, ENGINE_VERSION, RELAY_URL } from './launch';
import { Normalizer } from './normalizer';
import { getUsage, rewindConversation } from './controls';
import { ProcessTable } from './process-table';
import { EngineSession, HostHookRegistry, type EngineSessionOptions } from './session';
import { MemoryJournal, scriptedTransport, type ScriptedTransport } from './conformance/scripted-transport';
import { replayedSession } from './conformance/session-harness';

const prelude = loadEngineJournal('replay-handshake');
const responseOf = (seq: number) => (prelude.find((r) => r.seq === seq)!.frame as { response: { response: Record<string, unknown> } }).response.response;
const INIT_RESPONSE = responseOf(3); // pass2/auto-routed seq 4: current_permission_mode auto
const ROUTED_STATUS = responseOf(5); // pass2/auto-routed seq 145: Anthropic base URL = the relay, Auto mode server Enabled
const DIRECT_STATUS = { sections: [{ title: 'Session', rows: [{ label: 'Login', value: 'Expired — log in again' }] }, { title: 'Environment', rows: [{ label: 'Auto mode server', value: 'Disabled' }] }] };

function spec(overrides: Partial<LaunchSpec> = {}): LaunchSpec {
  return LaunchSpecSchema.parse({
    appSessionId: 'app-s', cwd: '/tmp/maws-session', additionalDirectories: [], model: 'sonnet', effort: null, permissionMode: null, gateway: 'gateway', subagentModel: null,
    resume: null, sessionId: '33333333-3333-4333-8333-333333333333', trust: null, mcpConfig: null, extraSettings: null, maxBudgetUsd: null, replay: null, ...overrides,
  });
}

type Responder = Record<string, (request: Record<string, unknown>) => { response?: unknown; error?: string } | null>;
const defaultResponder = (overrides: Responder = {}): Responder => ({
  initialize: () => ({ response: INIT_RESPONSE }),
  get_status: () => ({ response: ROUTED_STATUS }),
  apply_flag_settings: () => ({}),
  set_permission_mode: (r) => ({ response: { mode: r.mode } }),
  ...overrides,
});

function autoResponder(responder: Responder) {
  return (frame: StdinFrame, t: ScriptedTransport) => {
    if (frame.type !== 'control_request') return;
    const answer = responder[frame.request.subtype]?.(frame.request);
    if (!answer) return;
    queueMicrotask(() => t.push({ type: 'control_response', response: answer.error === undefined ? { subtype: 'success', request_id: frame.request_id, ...(answer.response === undefined ? {} : { response: answer.response }) } : { subtype: 'error', request_id: frame.request_id, error: answer.error } }));
  };
}

type TransportOpts = Omit<Parameters<typeof scriptedTransport>[0] & object, 'onWrite'>;
function setup(opts: { spec?: Partial<LaunchSpec>; responder?: Responder; session?: Partial<EngineSessionOptions>; transport?: TransportOpts } = {}) {
  const launchSpec = spec(opts.spec);
  const plan = buildLaunch(launchSpec, { PATH: '/usr/bin', HOME: '/Users/x', ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5' }, { relayUrl: RELAY_URL, engineVersion: ENGINE_VERSION });
  const transport = scriptedTransport({ ...opts.transport, onWrite: autoResponder(opts.responder ?? defaultResponder()) });
  const journal = new MemoryJournal();
  const logs: string[] = [];
  const session = new EngineSession({ spec: launchSpec, plan, spawn: () => transport, journal, log: (m) => logs.push(m), ...opts.session });
  const events: SessionEvent[] = [];
  const lists: AttentionItem[][] = [];
  session.on('events', (batch) => {
    for (const e of batch) SessionEventSchema.parse(e);
    events.push(...batch);
  });
  session.on('brokerItems', (items) => lists.push(items));
  return { session, transport, journal, events, lists, logs, plan };
}

const flush = () => new Promise((r) => setImmediate(r));
const metaEvents = (journal: MemoryJournal) => journal.rows.filter((r) => r.direction === 'meta').map((r) => (r.frame as { event: string }).event);
const shape = (journal: MemoryJournal) =>
  journal.rows.map((r) => {
    const f = r.frame as { type?: string; event?: string; request?: { subtype: string }; response?: { request_id: string } };
    return `${r.direction}:${r.direction === 'meta' ? f.event : f.type === 'control_request' ? `control_request/${f.request!.subtype}` : f.type}`;
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('EngineSession: the handshake, journal-before-normalise and the gateway read', () => {
  it('spawn → initialize → get_status → ready, journaling every row before it is normalised', async () => {
    const { session, transport, journal, events } = setup({ spec: { trust: { accepted: true, directory: '/tmp/maws-session' } } });
    expect(session.status()).toMatchObject({ process: 'starting', cwd: '/tmp/maws-session', pendingPlan: null }); // from the reservation onward
    await session.start();
    expect(shape(journal)).toEqual(['meta:spawn', 'out:control_request/initialize', 'in:control_response', 'meta:initialize', 'out:control_request/get_status', 'in:control_response', 'meta:status_check']);
    expect(transport.requestsOf('initialize')[0]!.request).toEqual({
      subtype: 'initialize', supportedDialogKinds: ['auto_mode_server_fallback', 'refusal_fallback_prompt'], perTaskStopAffordance: true, workspaceTrust: { accepted: true, directory: '/tmp/maws-session' },
    });
    expect(journal.rows[3]!.frame).toEqual({ event: 'initialize', current_permission_mode: 'auto', session_state: 'idle', hooks_applied: null, workspace_trust_recorded: null });
    expect(journal.rows[6]!.frame).toEqual({ event: 'status_check', baseUrl: RELAY_URL, autoModeServer: 'enabled', verified: 'routed' });
    const status = EngineSessionStatusSchema.parse(session.status());
    expect(status).toMatchObject({
      process: 'ready', engineSessionId: '33333333-3333-4333-8333-333333333333', pid: 4242, permissionMode: { requested: 'auto', effective: 'auto', refusal: null },
      gateway: { mode: 'gateway', baseUrl: RELAY_URL, verified: 'routed', autoModeServer: 'enabled', localLane: null }, modelOverrides: { ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5' },
      fileCheckpointing: true, journalPath: '/memory/journal.jsonl', model: { requested: 'sonnet', resolved: null }, pendingRequests: 0, grants: [],
    });
    expect(events).toEqual([]); // the handshake yields no events

    // a send is journaled then normalised: the bubble derives from the out row
    const { messageUuid } = await session.send('hi');
    const row = journal.rows.at(-1)!;
    expect(row).toMatchObject({ direction: 'out', frame: { type: 'user', uuid: messageUuid, origin: { kind: 'human' }, parent_tool_use_id: null, message: { role: 'user', content: 'hi' } } });
    expect(events.map((e) => [e.kind, e.seq])).toEqual([['turn.started', row.seq], ['user.message', row.seq]]);
    expect(session.status().turn).toMatchObject({ origin: 'human', acceptedAt: null, userMessageUuids: [messageUuid] });
  });

  it('every event carries the seq of a journal row it derives from, and normaliser warnings become meta rows', async () => {
    const { session, transport, journal, events } = setup();
    await session.start();
    transport.push({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } }, session_id: 's', parent_tool_use_id: null, uuid: 'se-1' });
    transport.push({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }, session_id: 's', parent_tool_use_id: null, uuid: 'se-2' });
    transport.push({ type: 'assistant', message: { id: 'msg_1', model: 'm', role: 'assistant', content: [{ type: 'text', text: 'x' }] }, parent_tool_use_id: null, session_id: 's', uuid: 'a-1' });
    await flush();
    const complete = events.find((e) => e.kind === 'assistant.block.complete')!;
    expect(journal.rows.find((r) => r.seq === complete.seq)).toMatchObject({ direction: 'in', frame: { type: 'assistant' } });
    expect(journal.rows.at(-1)!.frame).toEqual({ event: 'block_pairing', rowSeq: complete.seq, detail: { apiMessageId: 'msg_1', blockIndex: 0, started: 'thinking', completed: 'text' } });
    for (const e of events) expect(journal.rows.some((r) => r.seq === e.seq)).toBe(true);
  });

  it('verifies direct as direct and flags a mismatch with a warning notice', async () => {
    const direct = setup({ spec: { gateway: 'direct' }, responder: defaultResponder({ get_status: () => ({ response: DIRECT_STATUS }) }) });
    await direct.session.start();
    expect(direct.session.status().gateway).toEqual({ mode: 'direct', baseUrl: null, verified: 'direct', autoModeServer: 'disabled', localLane: null });
    const mismatch = setup({ responder: defaultResponder({ get_status: () => ({ response: DIRECT_STATUS }) }) });
    await mismatch.session.start();
    expect(mismatch.session.status().gateway.verified).toBe('mismatch');
    expect(mismatch.events).toMatchObject([{ kind: 'notice.posted', level: 'warning', key: 'gateway:mismatch' }]);
  });

  it('re-reads get_status after each human turn\'s result', async () => {
    const { session, transport } = setup();
    await session.start();
    await session.send('hi');
    transport.push({ type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed', origin: { kind: 'human' } });
    await flush();
    expect(transport.requestsOf('get_status')).toHaveLength(2);
  });

  it('a resume journals reconnect rows, re-applies the grant snapshot before ready, and reports the grants', async () => {
    const { session, journal, transport, events } = setup({ spec: { resume: { sessionId: '44444444-4444-4444-8444-444444444444' as LaunchSpec['sessionId'] & string, fork: false }, sessionId: null }, session: { grants: { allow: ['Bash(touch granted.txt)'] } } });
    await session.start();
    expect(shape(journal)).toEqual(['meta:reconnect', 'meta:spawn', 'out:control_request/initialize', 'in:control_response', 'meta:initialize', 'meta:reconnect', 'out:control_request/get_status', 'in:control_response', 'meta:status_check', 'out:control_request/apply_flag_settings', 'in:control_response']);
    expect(transport.requestsOf('apply_flag_settings')[0]!.request).toEqual({ subtype: 'apply_flag_settings', settings: { permissions: { allow: ['Bash(touch granted.txt)'] } } });
    expect(events.map((e) => e.kind === 'session.reconnect' && e.phase)).toEqual(['attempting', 'reconnected']);
    expect(session.status()).toMatchObject({ process: 'ready', grants: ['Bash(touch granted.txt)'], keepAlive: ['grants'] });
  });

  it('retains the command catalogue: initialize commands and agents, system/init skills and terminal commands, commands_changed', async () => {
    const { session, transport } = setup();
    expect(session.catalog()).toEqual({ commands: [], agents: [], skills: [], terminalSlashCommands: [], revision: 0 });
    await session.start();
    const afterInit = session.catalog();
    expect(afterInit.commands).toEqual(INIT_RESPONSE.commands);
    expect(afterInit.agents).toEqual(INIT_RESPONSE.agents);
    expect(afterInit.revision).toBe(1);
    transport.push({ type: 'system', subtype: 'init', cwd: '/w', session_id: 's', model: 'claude-sonnet-5', permissionMode: 'auto', tools: [], slash_commands: [], mcp_servers: [{ name: 'gh', status: 'connected' }], claude_code_version: '2.1.283', skills: ['dataviz'], terminal_slash_commands: ['doctor'] });
    transport.push({ type: 'system', subtype: 'commands_changed', session_id: 's', commands: [{ name: 'x', description: 'X' }] });
    await flush();
    expect(session.catalog()).toEqual({ commands: [{ name: 'x', description: 'X' }], agents: INIT_RESPONSE.agents, skills: ['dataviz'], terminalSlashCommands: ['doctor'], revision: 3 });
    // a system/init with no turn open is an engine-initiated turn: the turn keeps the process alive too
    expect(session.status()).toMatchObject({ model: { resolved: 'claude-sonnet-5' }, mcpServers: [{ name: 'gh', status: 'connected', source: null }], keepAlive: ['turn', 'mcp_connected'] });
  });
});

describe('EngineSession: inbound requests, host hooks and exit', () => {
  it('routes permission requests to the broker and answers through it; the attention list follows', async () => {
    const { session, transport, lists, events } = setup();
    await session.start();
    transport.push({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_1' } });
    await flush();
    expect(lists.at(-1)).toMatchObject([{ kind: 'permission', state: 'pending' }]);
    expect(session.status().pendingRequests).toBe(1);
    expect(await session.answer('r1' as RequestId, { kind: 'permission', decision: 'allow', scope: 'session' })).toBe('delivered');
    expect(transport.writes.at(-1)).toMatchObject({ type: 'control_response', response: { request_id: 'r1', response: { behavior: 'allow' } } });
    expect(session.status().grants).toEqual(['Bash(ls)']);
    expect(events.map((e) => e.kind)).toEqual(['permission.requested', 'permission.resolved']);
  });

  it('an answer whose write rejects leaves no resolution in the graph: write_failed, item pending, error.raised; the retry resolves exactly once', async () => {
    let failures = 1;
    const { session, transport, journal, events, lists, plan } = setup({ transport: { failWrite: (f) => f.type === 'control_response' && failures-- > 0 } });
    await session.start();
    transport.push({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_1' } });
    await flush();
    expect(await session.answer('r1' as RequestId, { kind: 'permission', decision: 'allow', scope: 'once' })).toBe('write_failed');
    expect(events.map((e) => e.kind)).toEqual(['permission.requested', 'error.raised']);
    expect(events[1]).toMatchObject({ scope: 'transport', code: 'write_failed', requestId: 'r1' });
    expect(journal.rows.filter((r) => r.direction === 'out' && (r.frame as { type: string }).type === 'control_response')).toEqual([]);
    expect(lists.at(-1)).toMatchObject([{ state: 'pending' }]);
    expect(await session.answer('r1' as RequestId, { kind: 'permission', decision: 'allow', scope: 'once' })).toBe('delivered');
    expect(events.filter((e) => e.kind === 'permission.resolved')).toHaveLength(1);
    expect(lists.at(-1)).toMatchObject([{ state: 'delivered' }]);
    const rebuilt = new Normalizer({ appSessionId: spec().appSessionId, launchId: plan.launchId, sessionId: plan.sessionId });
    expect(journal.rows.flatMap((row) => rebuilt.push(row))).toEqual(session.events());
  });

  it('inbound frames read while an answer\'s write is in flight wait for it: pending until the flush, then delivered, then confirmed', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { session, transport, journal, lists, plan } = setup({ transport: { holdWrite: (f) => (f.type === 'control_response' ? gate : null) } });
    await session.start();
    transport.push({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_1' } });
    await flush();
    const answering = session.answer('r1' as RequestId, { kind: 'permission', decision: 'allow', scope: 'once' });
    await flush();
    transport.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }] }, parent_tool_use_id: null, session_id: 's' });
    await flush();
    expect(lists.at(-1)).toMatchObject([{ state: 'pending' }]);
    expect(journal.rows.some((r) => r.direction === 'in' && (r.frame as { type: string }).type === 'user')).toBe(false); // held
    release();
    expect(await answering).toBe('delivered');
    await flush();
    expect(lists.slice(-2).map((l) => l[0]!.state)).toEqual(['delivered', 'confirmed']);
    const order = journal.rows.filter((r) => r.direction !== 'meta').slice(-2).map((r) => `${r.direction}:${(r.frame as { type: string }).type}`);
    expect(order).toEqual(['out:control_response', 'in:user']);
    const rebuilt = new Normalizer({ appSessionId: spec().appSessionId, launchId: plan.launchId, sessionId: plan.sessionId });
    expect(journal.rows.flatMap((row) => rebuilt.push(row))).toEqual(session.events());
  });

  it('when that held write rejects: the item stays pending, write_failed is journaled before the held frame, and the exit counts it lost', async () => {
    let fail!: (e: Error) => void;
    const gate = new Promise<void>((_, reject) => (fail = reject));
    gate.catch(() => {});
    const { session, transport, journal, lists } = setup({ transport: { holdWrite: (f) => (f.type === 'control_response' ? gate : null) } });
    await session.start();
    transport.push({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_1' } });
    await flush();
    const answering = session.answer('r1' as RequestId, { kind: 'permission', decision: 'allow', scope: 'once' });
    await flush();
    transport.push({ type: 'system', subtype: 'status', status: 'requesting', session_id: 's' });
    await flush();
    fail(new Error('EPIPE'));
    expect(await answering).toBe('write_failed');
    await flush();
    const order = journal.rows.slice(-2).map((r) => (r.direction === 'meta' ? `meta:${(r.frame as { event: string }).event}` : `${r.direction}:${(r.frame as { type: string }).type}`));
    expect(order).toEqual(['meta:write_failed', 'in:system']);
    expect(lists.at(-1)).toMatchObject([{ state: 'pending' }]);
    transport.exit(1);
    expect((await session.exited).lostAttentionCount).toBe(1);
  });

  it('a request whose success response arrives while its write is held is journaled first, so boundary.rewind derives (pass2/rewind seq 41-42 correlation)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let requestId = '';
    const { session, transport, journal, events, plan } = setup({
      transport: {
        holdWrite: (f) => {
          if (f.type !== 'control_request' || f.request.subtype !== 'rewind_conversation') return null;
          requestId = f.request_id;
          return gate;
        },
      },
    });
    await session.start();
    const rewinding = rewindConversation(session.control!, { target_message_uuid: 'u-2', last_seen_user_message_uuid: 'u-2', interrupt_if_running: false });
    await flush();
    transport.push({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { rewound: true, targetMessageUuid: 'u-2', prefillText: 'Also BANANA', precedingAssistantUuid: 'a-1' } } });
    await flush();
    release();
    expect(await rewinding).toMatchObject({ rewound: true });
    const rows = journal.rows.filter((r) => r.direction !== 'meta').slice(-2);
    expect(rows.map((r) => r.direction)).toEqual(['out', 'in']);
    expect(events.filter((e) => e.kind === 'boundary.rewind')).toMatchObject([{ targetMessageUuid: 'u-2', prefillText: 'Also BANANA', precedingAssistantUuid: 'a-1', seq: rows[1]!.seq }]);
    const rebuilt = new Normalizer({ appSessionId: spec().appSessionId, launchId: plan.launchId, sessionId: plan.sessionId });
    expect(journal.rows.flatMap((row) => rebuilt.push(row))).toEqual(session.events());
  });

  it('at stdout EOF a held request write settles before the response that arrived during it is journaled; the exit row comes last', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let requestId = '';
    const hold = (f: StdinFrame) => (f.type === 'control_request' && f.request.subtype === 'get_usage' ? ((requestId = f.request_id), gate) : null);
    const { session, transport, journal } = setup({ transport: { holdWrite: hold } });
    await session.start();
    const usage = getUsage(session.control!, {}).catch((e: unknown) => e);
    await flush();
    transport.push({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error: 'no usage here' } });
    transport.endStdout();
    await flush();
    expect(journal.rows.some((r) => r.direction === 'in' && (r.frame as { response?: { request_id?: string } }).response?.request_id === requestId)).toBe(false);
    release();
    await usage;
    await flush();
    transport.exit(0);
    await session.exited;
    expect(shape(journal).slice(-3)).toEqual(['out:control_request/get_usage', 'in:control_response', 'meta:exit']);
  });

  it('at EOF and exit with a write that never settled: write_failed precedes the held response and nothing follows the exit row', async () => {
    let requestId = '';
    const never = new Promise<void>(() => {});
    const hold = (f: StdinFrame) => (f.type === 'control_request' && f.request.subtype === 'get_usage' ? ((requestId = f.request_id), never) : null);
    const { session, transport, journal } = setup({ transport: { holdWrite: hold } });
    await session.start();
    const usage = getUsage(session.control!, {}).catch((e: unknown) => e);
    await flush();
    transport.push({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error: 'no usage here' } });
    transport.exit(0);
    await session.exited;
    expect(((await usage) as { code: string }).code).toBe('write_failed');
    await flush();
    expect(shape(journal).slice(-3)).toEqual(['meta:write_failed', 'in:control_response', 'meta:exit']);
    expect(journal.rows.at(-1)!.frame).toMatchObject({ event: 'exit' });
  });

  it('a journal write that fails while live surfaces: journal_failed row, the answer is write_failed, and the process is ended through the ladder', async () => {
    const { session, transport, journal, events } = setup();
    await session.start();
    transport.push({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_1' } });
    await flush();
    journal.failOnce = (direction, frame) => direction === 'out' && (frame as { type: string }).type === 'control_response';
    expect(await session.answer('r1' as RequestId, { kind: 'permission', decision: 'allow', scope: 'once' })).toBe('write_failed');
    expect(journal.rows.at(-1)!.frame).toEqual({ event: 'transport_error', code: 'journal_failed', message: 'journal write failed: ENOSPC: no space left on device' });
    expect(events.at(-1)).toMatchObject({ kind: 'error.raised', scope: 'transport', code: 'journal_failed' });
    expect(events.some((e) => e.kind === 'permission.resolved')).toBe(false);
    expect(session.status().process).toBe('exiting');
    expect(transport.calls).toEqual(['endInput', 'kill:SIGTERM']);
    transport.exit(null, 'SIGTERM');
    expect((await session.exited).reason).toBe('crash');
  });

  it('a failed session-scope allow on an ask-rule prompt leaves no note behind: the retried deny resolves without it', async () => {
    let failures = 1;
    const { session, transport, journal, events } = setup({ transport: { failWrite: (f) => f.type === 'control_response' && failures-- > 0 } });
    await session.start();
    transport.push({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls -la' }, tool_use_id: 'toolu_1', decision_reason_type: 'rule' } });
    await flush();
    expect(await session.answer('r1' as RequestId, { kind: 'permission', decision: 'allow', scope: 'session' })).toBe('write_failed');
    expect(journal.rows.some((r) => (r.frame as { event?: string }).event === 'answer_note')).toBe(false);
    expect(await session.answer('r1' as RequestId, { kind: 'permission', decision: 'deny' })).toBe('delivered');
    expect(events.filter((e) => e.kind === 'permission.resolved')).toMatchObject([{ behavior: 'deny', message: 'Denied by the user in MAWS.' }]);
  });

  it('a user frame whose write rejects is journaled as write_failed, not as a sent prompt; the entry goes back to the paused queue (M4)', async () => {
    const { session, journal, events } = setup({ transport: { failWrite: (f) => f.type === 'user' } });
    await session.start();
    const sent = await session.send('hi');
    expect(sent).toMatchObject({ disposition: 'queued', messageUuid: null, entry: { state: 'queued', content: 'hi' } });
    expect(journal.rows.at(-2)!.frame).toMatchObject({ event: 'write_failed', frameType: 'user', subtype: null, requestId: null });
    expect(journal.rows.at(-1)!.frame).toEqual({ event: 'queue', action: 'pause', reason: 'write_failed' });
    expect(events.map((e) => e.kind)).toEqual(['error.raised']);
    expect(session.status().turn).toBeNull();
    expect(session.status().queue).toEqual({ length: 1, paused: true });
  });

  it('an initialize response carrying one pending_permission_requests entry re-accepts it (event and broker item)', async () => {
    const { session, transport, lists, events } = setup({ responder: defaultResponder({ initialize: () => null }) });
    const started = session.start();
    await flush();
    const [init] = transport.requestsOf('initialize');
    const pending = { type: 'control_request', request_id: 'old-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_old' } };
    transport.push({ type: 'control_response', response: { subtype: 'success', request_id: init!.request_id, response: INIT_RESPONSE, pending_permission_requests: [pending], pending_user_dialog_requests: [] } });
    await started;
    expect(lists.at(-1)).toMatchObject([{ id: 'app-s:old-1', kind: 'permission', state: 'pending', request: { toolUseId: 'toolu_old' } }]);
    expect(events).toMatchObject([{ kind: 'permission.requested', requestId: 'old-1' }]);
    expect(session.status()).toMatchObject({ process: 'ready', pendingRequests: 1 });
  });

  it('a hook_callback for a registered id runs the function and answers its return value; an unknown id answers {}', async () => {
    const hooks = new HostHookRegistry();
    const seen: unknown[] = [];
    const id = hooks.register('PreToolUse', 'Bash', (input) => {
      seen.push(input);
      return { continue: true, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'MAWS host hook saw this call.' } };
    }, 15);
    expect(id).toBe('maws_PreToolUse_1');
    const { session, transport, events, logs } = setup({ session: { hooks } });
    await session.start();
    expect(transport.requestsOf('initialize')[0]!.request.hooks).toEqual({ PreToolUse: [{ matcher: 'Bash', hookCallbackIds: ['maws_PreToolUse_1'], timeout: 15 }] });
    expect(session.status().hostHooks).toEqual(['maws_PreToolUse_1']);
    transport.push({ type: 'control_request', request_id: 'h1', request: { subtype: 'hook_callback', callback_id: 'maws_PreToolUse_1', tool_use_id: 'toolu_1', input: { hook_event_name: 'PreToolUse', tool_name: 'Bash' } } });
    transport.push({ type: 'control_request', request_id: 'h2', request: { subtype: 'hook_callback', callback_id: 'maws_unknown', input: { hook_event_name: 'PostToolUse' } } });
    await flush();
    await flush();
    expect(seen).toEqual([{ hook_event_name: 'PreToolUse', tool_name: 'Bash' }]);
    const responses = transport.writes.filter((w) => w.type === 'control_response').map((w) => (w as { response: unknown }).response);
    expect(responses).toEqual([
      { subtype: 'success', request_id: 'h1', response: { continue: true, hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'MAWS host hook saw this call.' } } },
      { subtype: 'success', request_id: 'h2', response: {} },
    ]);
    const order = events.map((e) => `${e.kind}:${(e as { requestId?: string }).requestId}`);
    expect([...order].sort()).toEqual(['hook.callback_requested:h1', 'hook.callback_requested:h2', 'hook.callback_resolved:h1', 'hook.callback_resolved:h2']);
    for (const id of ['h1', 'h2']) expect(order.indexOf(`hook.callback_requested:${id}`)).toBeLessThan(order.indexOf(`hook.callback_resolved:${id}`));
    expect(logs.some((l) => l.includes('maws_unknown'))).toBe(true);
  });

  it('an unexpected exit retires the broker\'s items, journals the exit row with the lost count, and classifies crash and unknown', async () => {
    const { session, transport, journal, events, lists } = setup();
    await session.start();
    transport.push({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_1' } });
    transport.push({ type: 'control_request', request_id: 'r2', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'pwd' }, tool_use_id: 'toolu_2' } });
    await flush();
    transport.exit(1);
    await session.exited;
    expect(journal.rows.at(-1)!.frame).toEqual({ event: 'exit', code: 1, signal: null, reason: 'crash', lostAttentionCount: 2, peakTreeRssKiB: null });
    expect(events.at(-1)).toMatchObject({ kind: 'process.exited', code: 1, reason: 'crash', lostAttentionCount: 2, seq: journal.rows.at(-1)!.seq });
    expect(lists.at(-1)).toEqual([]);
    expect(session.status()).toMatchObject({ process: 'exited', exit: { code: 1, signal: null, reason: 'crash' }, pendingRequests: 0 });
    expect(journal.closed).toBe(true);

    const clean = setup();
    await clean.session.start();
    clean.transport.exit(0);
    await clean.session.exited;
    expect(clean.session.status().exit?.reason).toBe('unknown');
  });

  it('stop writes end_session and reports the exit as stop', async () => {
    const { session, transport } = setup({ responder: defaultResponder({ end_session: () => null }) });
    await session.start();
    const stopping = session.stop('stop');
    await flush();
    expect(transport.requestsOf('end_session')).toHaveLength(1);
    expect(session.status().process).toBe('exiting');
    transport.exit(0);
    expect(await stopping).toEqual({ exited: true, code: 0, signal: null });
    expect(session.status().exit?.reason).toBe('stop');
  });
});

describe('failed initialize terminates the process', () => {
  it('an initialize that never answers: exiting at the long deadline, SIGTERM with stdin closed, SIGKILL 3 s later, exited only at the real exit; the reservation holds until then', async () => {
    vi.useFakeTimers();
    const table = new ProcessTable();
    let first!: ReturnType<typeof setup>;
    const reserved = table.reserve(spec().appSessionId, () => {
      first = setup({ responder: defaultResponder({ initialize: () => null }) });
      first.transport.pushStderr('warming up');
      return first.session;
    });
    expect(reserved.status).toBe('launching');
    await vi.advanceTimersByTimeAsync(119_999);
    expect(first.session.status().process).toBe('initializing');
    await vi.advanceTimersByTimeAsync(1);
    expect(first.session.status().process).toBe('exiting');
    expect(first.events.filter((e) => e.kind === 'error.raised')).toMatchObject([{ scope: 'process', code: 'timeout' }]);
    expect((first.events.find((e) => e.kind === 'error.raised') as { message: string }).message).toContain('warming up');
    expect(first.transport.calls).toEqual(['endInput', 'kill:SIGTERM']);
    expect(first.transport.requestsOf('end_session')).toHaveLength(0); // the handshake never completed: no end_session rung
    await vi.advanceTimersByTimeAsync(2_999);
    expect(first.transport.calls).toEqual(['endInput', 'kill:SIGTERM']);
    await vi.advanceTimersByTimeAsync(1);
    expect(first.transport.calls).toEqual(['endInput', 'kill:SIGTERM', 'kill:SIGKILL']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(first.session.status().process).toBe('exiting');
    expect(table.reserve(spec().appSessionId, () => setup().session)).toEqual({ status: 'refused', reason: 'already_live', message: 'process is exiting' });

    first.transport.exit(null, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(0);
    expect(first.session.status()).toMatchObject({ process: 'exited', exit: { reason: 'crash', signal: 'SIGKILL' } });
    expect(metaEvents(first.journal)).toEqual(['spawn', 'init_failed', 'exit']);
    const again = table.reserve(spec().appSessionId, () => setup().session);
    expect(again.status).toBe('launching');
  });

  it('an initialize answered with an error takes the same ladder and ends crash even when the process exits 0 on stdin end', async () => {
    const { session, transport, journal, events } = setup({ responder: defaultResponder({ initialize: () => ({ error: 'No conversation found with session ID: x' }) }) });
    transport.pushStderr('No conversation found with session ID: x');
    const started = session.start();
    await flush();
    await started;
    expect(session.status().process).toBe('exiting');
    expect(transport.calls).toEqual(['endInput', 'kill:SIGTERM']);
    const failed = journal.rows.find((r) => (r.frame as { event?: string }).event === 'init_failed')!;
    expect(failed.frame).toMatchObject({ event: 'init_failed', message: expect.stringContaining('No conversation found') });
    transport.exit(0);
    await session.exited;
    expect(session.status().exit?.reason).toBe('crash');
    expect(events.map((e) => e.kind)).toEqual(['error.raised', 'process.exited']);
  });

  it('an exit before the initialize response is crash at once, the init_failed and reconnect failed rows before the exit row', async () => {
    const { session, transport, journal, events } = setup({
      spec: { resume: { sessionId: '44444444-4444-4444-8444-444444444444' as LaunchSpec['sessionId'] & string, fork: false }, sessionId: null },
      responder: defaultResponder({ initialize: () => null }),
    });
    transport.pushStderr('Error: Session 44444444 is running as a background session');
    const started = session.start();
    await flush();
    transport.exit(1);
    await started;
    await session.exited;
    expect(metaEvents(journal)).toEqual(['reconnect', 'spawn', 'init_failed', 'reconnect', 'exit']);
    expect(transport.calls).toEqual([]);
    expect(session.status().exit).toMatchObject({ code: 1, reason: 'crash' });
    const reconnects = events.filter((e) => e.kind === 'session.reconnect');
    expect(reconnects.map((e) => (e as { phase: string }).phase)).toEqual(['attempting', 'failed']);
    expect((reconnects[1] as { reason: string }).reason).toContain('running as a background session');
  });
});

describe('plan outcomes map to the wire', () => {
  it('clear_and_implement: after the turn\'s result, set_permission_mode to the pre-plan mode, /clear, then the plan once /clear\'s turn ends', async () => {
    const { session, transport, journal } = setup();
    await session.start();
    transport.push({ type: 'system', subtype: 'status', status: null, permissionMode: 'plan', session_id: 's' });
    await flush();
    expect(session.status()).toMatchObject({ permissionMode: { effective: 'plan' }, prePlanMode: 'auto' });
    await session.send('plan it');
    transport.push({ type: 'control_request', request_id: 'p1', request: { subtype: 'can_use_tool', tool_name: 'ExitPlanMode', input: { plan: '# Plan\n1. do it' }, tool_use_id: 'toolu_p' } });
    await flush();
    expect(await session.answer('p1' as RequestId, { kind: 'plan', outcome: 'clear_and_implement', feedback: null })).toBe('delivered');
    const before = transport.writes.length;
    transport.push({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_p', content: 'denied' }] }, parent_tool_use_id: null, session_id: 's' });
    await flush();
    expect(transport.writes.length).toBe(before);
    transport.push({ type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed', origin: { kind: 'human' } });
    await flush();
    await flush();
    const after = transport.writes.slice(before).filter((w) => !(w.type === 'control_request' && w.request.subtype === 'get_status'));
    expect(after).toMatchObject([
      { type: 'control_request', request: { subtype: 'set_permission_mode', mode: 'auto' } },
      { type: 'user', message: { content: '/clear' }, origin: { kind: 'human' } },
    ]);
    const clearUuid = (after[1] as { uuid: string }).uuid;
    transport.push({ type: 'conversation_reset', new_conversation_id: 'c2', session_id: 's' });
    transport.push({ type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 0, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed', user_message_uuids: [clearUuid] });
    await flush();
    const implement = transport.writes.filter((w) => w.type === 'user').at(-1) as { message: { content: string }; origin: unknown };
    expect(implement.message.content).toBe('Implement this plan:\n\n# Plan\n1. do it');
    expect(implement.origin).toEqual({ kind: 'human' });
    const userRows = journal.rows.filter((r) => r.direction === 'out' && (r.frame as { type: string }).type === 'user').map((r) => (r.frame as { message: { content: string } }).message.content);
    expect(userRows).toEqual(['plan it', '/clear', 'Implement this plan:\n\n# Plan\n1. do it']);
  });

  it('clear_and_implement is staged before the deny is written: a result that arrives while the write is in flight still runs the sequence', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { session, transport } = setup({ transport: { holdWrite: (f) => (f.type === 'control_response' ? gate : null) } });
    await session.start();
    transport.push({ type: 'system', subtype: 'status', status: null, permissionMode: 'plan', session_id: 's' });
    await session.send('plan it');
    transport.push({ type: 'control_request', request_id: 'p1', request: { subtype: 'can_use_tool', tool_name: 'ExitPlanMode', input: { plan: '# P' }, tool_use_id: 'toolu_p' } });
    await flush();
    const answering = session.answer('p1' as RequestId, { kind: 'plan', outcome: 'clear_and_implement', feedback: null });
    await flush();
    transport.push({ type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed', origin: { kind: 'human' } });
    await flush();
    expect(transport.requestsOf('set_permission_mode')).toHaveLength(0); // nothing is sent before the deny reached the pipe
    release();
    expect(await answering).toBe('delivered');
    await flush();
    await flush();
    expect(transport.requestsOf('set_permission_mode').map((r) => r.request.mode)).toEqual(['auto']);
    expect(transport.writes.filter((w) => w.type === 'user').map((w) => (w as { message: { content: string } }).message.content)).toEqual(['plan it', '/clear']);
  });

  it('a clear_and_implement whose deny write fails is rolled back: the turn\'s result sends nothing', async () => {
    const { session, transport } = setup({ transport: { failWrite: (f) => f.type === 'control_response' } });
    await session.start();
    transport.push({ type: 'system', subtype: 'status', status: null, permissionMode: 'plan', session_id: 's' });
    await session.send('plan it');
    transport.push({ type: 'control_request', request_id: 'p1', request: { subtype: 'can_use_tool', tool_name: 'ExitPlanMode', input: { plan: '# P' }, tool_use_id: 'toolu_p' } });
    await flush();
    expect(await session.answer('p1' as RequestId, { kind: 'plan', outcome: 'clear_and_implement', feedback: null })).toBe('write_failed');
    transport.push({ type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed', origin: { kind: 'human' } });
    await flush();
    await flush();
    expect(transport.requestsOf('set_permission_mode')).toHaveLength(0);
    expect(transport.writes.filter((w) => w.type === 'user')).toHaveLength(1);
  });

  it('when the pre-plan mode cannot be restored the sequence stops: a notice, the plan kept as pendingPlan, neither /clear nor the plan sent', async () => {
    const { session, transport, events } = setup({ responder: defaultResponder({ set_permission_mode: () => ({ error: 'Cannot set permission mode to auto' }) }) });
    await session.start();
    transport.push({ type: 'system', subtype: 'status', status: null, permissionMode: 'plan', session_id: 's' });
    await session.send('plan it');
    transport.push({ type: 'control_request', request_id: 'p1', request: { subtype: 'can_use_tool', tool_name: 'ExitPlanMode', input: { plan: '# Plan\n1. do it' }, tool_use_id: 'toolu_p' } });
    await flush();
    await session.answer('p1' as RequestId, { kind: 'plan', outcome: 'clear_and_implement', feedback: null });
    transport.push({ type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed', origin: { kind: 'human' } });
    await flush();
    await flush();
    expect(transport.requestsOf('set_permission_mode')).toHaveLength(1);
    expect(transport.writes.filter((w) => w.type === 'user')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'notice.posted')).toMatchObject([{ level: 'warning', key: 'plan:mode_restore_failed' }]);
    expect(EngineSessionStatusSchema.parse(session.status()).pendingPlan).toBe('# Plan\n1. do it');
  });

  it('the pre-plan mode is captured on a transition into plan from any source; a process that starts in plan has none', async () => {
    const planInit = setup({ responder: defaultResponder({ initialize: () => ({ response: { ...INIT_RESPONSE, current_permission_mode: 'plan' } }) }) });
    await planInit.session.start();
    expect(planInit.session.status()).toMatchObject({ permissionMode: { effective: 'plan' }, prePlanMode: null });
    const { session, transport } = setup();
    await session.start();
    transport.push({ type: 'system', subtype: 'init', cwd: '/w', session_id: 's', model: 'm', permissionMode: 'acceptEdits', tools: [], slash_commands: [], mcp_servers: [], claude_code_version: '2.1.283' });
    transport.push({ type: 'system', subtype: 'init', cwd: '/w', session_id: 's', model: 'm', permissionMode: 'plan', tools: [], slash_commands: [], mcp_servers: [], claude_code_version: '2.1.283' });
    await flush();
    expect(session.status().prePlanMode).toBe('acceptEdits');
  });
});

describe('EngineSession (M4): the termination ladder, stdout EOF, held frames, the local lane and C11\'s fields', () => {
  it('stop with a process that never exits: end_session, then stdin closed and SIGTERM at 3 s, SIGKILL at 6 s, exited: false at 7 s; exiting from the first rung', async () => {
    vi.useFakeTimers();
    const { session, transport } = setup({ responder: defaultResponder({ end_session: () => null }) });
    await session.start();
    let answer: unknown = null;
    void session.stop('stop').then((r) => (answer = r));
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.requestsOf('end_session')[0]!.request).toEqual({ subtype: 'end_session', reason: 'stop' });
    expect(session.status().process).toBe('exiting');
    await vi.advanceTimersByTimeAsync(2_999);
    expect(transport.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.calls).toEqual(['endInput', 'kill:SIGTERM']);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(transport.calls).toEqual(['endInput', 'kill:SIGTERM', 'kill:SIGKILL']);
    expect(answer).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(answer).toEqual({ exited: false, code: null, signal: null });
    expect(session.status().process).toBe('exiting'); // exited only when the OS reports it
    expect(session.forcedKill).toBe(true);
    transport.exit(null, 'SIGKILL');
    await session.exited;
    expect(session.status()).toMatchObject({ process: 'exited', exit: { reason: 'stop', signal: 'SIGKILL' } });
  });

  it('stop with a process that exits on end_session answers exited: true at once, with no signal sent', async () => {
    vi.useFakeTimers();
    const { session, transport } = setup({ responder: defaultResponder({ end_session: () => null }) });
    await session.start();
    const stopping = session.stop('archive');
    await vi.advanceTimersByTimeAsync(0);
    transport.exit(0);
    expect(await stopping).toEqual({ exited: true, code: 0, signal: null });
    expect(transport.calls).toEqual([]);
    expect(session.status().exit).toMatchObject({ reason: 'archive' });
  });

  it('a stop over a replay ends it as the engine would: end_session journaled, exit 0, reason stop, no mismatch', async () => {
    const run = await replayedSession('pass2', 'rewind', (row, { session, ready, fixture }) => {
      if (row.seq === 5) void ready().then(() => session.send((fixture.find((r) => r.seq === 5)!.frame as { message: { content: string } }).message.content));
      else void session.stop('stop');
    });
    expect(run.journal.rows.filter((r) => (r.frame as { event?: string }).event === 'replay_mismatch')).toEqual([]);
    const rows = run.journal.rows.map((r) => `${r.direction}:${(r.frame as { request?: { subtype: string }; event?: string; type?: string }).request?.subtype ?? (r.frame as { event?: string }).event ?? (r.frame as { type?: string }).type}`);
    const endSession = rows.indexOf('out:end_session');
    expect(endSession).toBeGreaterThan(0);
    expect(rows.at(-1)).toBe('meta:exit');
    expect(rows.slice(endSession + 1).filter((r) => r.startsWith('out:'))).toEqual([]);
    expect(run.session.status().exit).toMatchObject({ reason: 'stop', code: 0 });
  });

  it('stdout EOF with a write that never settles: after 3 s the write fails, the held frames follow its write_failed row, and the child is ended through the ladder', async () => {
    vi.useFakeTimers();
    let requestId = '';
    const never = new Promise<void>(() => {});
    const hold = (f: StdinFrame) => (f.type === 'control_request' && f.request.subtype === 'get_usage' ? ((requestId = f.request_id), never) : null);
    const { session, transport, journal } = setup({ transport: { holdWrite: hold } });
    await session.start();
    const usage = getUsage(session.control!, {}).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    transport.push({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error: 'late' } });
    transport.endStdout(); // stdout closed, the process still alive and wedged
    await vi.advanceTimersByTimeAsync(2_999);
    expect(journal.rows.some((r) => (r.frame as { event?: string }).event === 'write_failed')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(((await usage) as { code: string }).code).toBe('write_failed');
    expect(shape(journal).slice(-2)).toEqual(['meta:write_failed', 'in:control_response']);
    expect(transport.calls).toEqual(['endInput', 'kill:SIGTERM']);
    expect(session.status().process).toBe('exiting');
    transport.exit(null, 'SIGTERM');
    await session.exited;
    expect(session.status().exit).toMatchObject({ reason: 'crash', signal: 'SIGTERM' });
  });

  it('while an out write is in flight the read loop keeps consuming stdout into memory, and everything drains in order after the write settles', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { session, transport, journal } = setup({ transport: { holdWrite: (f) => (f.type === 'control_request' && f.request.subtype === 'get_usage' ? gate : null) } });
    await session.start();
    void getUsage(session.control!, {}).catch(() => {});
    await flush();
    for (let i = 1; i <= 3; i += 1) transport.push({ type: 'system', subtype: 'status', status: null, uuid: `st-${i}`, session_id: 's' });
    await flush();
    const held = (session as unknown as { held: unknown[] }).held;
    expect(held).toHaveLength(3); // consumed from the transport (never left in the pipe), not yet journaled
    expect(journal.rows.some((r) => (r.frame as { uuid?: string }).uuid === 'st-1')).toBe(false);
    release();
    await flush();
    expect(held).toHaveLength(0);
    const tail = journal.rows.slice(-4).map((r) => (r.frame as { uuid?: string; request?: { subtype: string } }).uuid ?? (r.frame as { request: { subtype: string } }).request.subtype);
    expect(tail).toEqual(['get_usage', 'st-1', 'st-2', 'st-3']);
  });

  it('the local lane belongs to the turn it was observed in: set during turn A, null once turn B starts', async () => {
    const { session, transport, events } = setup();
    await session.start();
    const a = await session.send('turn A');
    const turnA = events.find((e) => e.kind === 'turn.started')!;
    transport.push({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn', safeguard_results: [{ type: 'dangerous_tool_use', status: { type: 'unavailable', reason: 'provider_not_anthropic' } }] } }, session_id: 's', parent_tool_use_id: null, uuid: 'se-9', timestamp: '2026-09-28T10:00:05.000Z' });
    await flush();
    expect(session.status().gateway.localLane).toEqual({ observedInTurn: turnA.id, at: '2026-09-28T10:00:05.000Z' });
    transport.push({ type: 'result', subtype: 'success', session_id: 's', is_error: false, duration_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {}, permission_denials: [], terminal_reason: 'completed', origin: { kind: 'human' }, user_message_uuids: [a.messageUuid] });
    await flush();
    expect(session.status().gateway.localLane).toMatchObject({ observedInTurn: turnA.id }); // still turn A's until the next turn starts
    await session.send('turn B');
    expect(session.status().gateway.localLane).toBeNull();
    const turnB = events.filter((e) => e.kind === 'turn.started')[1]!;
    transport.push({ type: 'system', subtype: 'informational', content: 'Auto mode is using the local classifier for this model; classifier requests are charged as usage.', level: 'warning', uuid: 'inf-1', session_id: 's' });
    await flush();
    expect(session.status().gateway.localLane).toMatchObject({ observedInTurn: turnB.id });
  });

  it('pass2/real-settings: fast mode from initialize and system/init, the eleven plugins, empty plugin errors and warnings', async () => {
    const seen: EngineSessionStatus[] = [];
    const run = await replayedSession('pass2', 'real-settings', (row, { session, transport, ready, fixture }) => {
      if (row.seq === 12) {
        void ready().then(() => {
          seen.push(session.status());
          return session.send((fixture.find((r) => r.seq === 12)!.frame as { message: { content: string } }).message.content);
        });
      } else transport.kill('SIGTERM');
    });
    expect(seen[0]).toMatchObject({ fastMode: { state: 'off', disabledReason: 'sdk_opt_in_required' }, plugins: [] }); // from the initialize response (seq 10)
    const status = run.session.status();
    expect(status.fastMode).toEqual({ state: 'off', disabledReason: 'sdk_opt_in_required' });
    expect(status.plugins).toHaveLength(11);
    expect(status.plugins[0]).toEqual({ name: 'designer', path: '/Users/new/.claude/plugins/cache/designer/designer/2.1.0', source: 'designer@designer', version: '2.1.0' });
    expect(status.pluginErrors).toEqual([]);
    expect(status.pluginWarnings).toEqual([]);
    EngineSessionStatusSchema.parse(status);
  });
});
