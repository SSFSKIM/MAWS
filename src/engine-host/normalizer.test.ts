import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { JournalRow } from '@shared/wire/journal';
import { loadEngineJournal, loadJournal } from '../../test/support/fixtures';
import { Normalizer, type NormalizerWarning } from './normalizer';
import { spillPathOf } from './normalizer-support';

const APP = 'app-1' as AppSessionId;
const SESSION = 'sess-1' as SessionId;
const AT = '2026-09-28T10:00:00.000Z';

function make(opts: { sessionId?: SessionId | null; warn?: (w: NormalizerWarning) => void } = {}) {
  return new Normalizer({ appSessionId: APP, launchId: 'LAUNCH01', sessionId: opts.sessionId === undefined ? SESSION : opts.sessionId, warn: opts.warn });
}

// Feeds rows with consecutive seqs and validates every event against X1.
function feed(n: Normalizer, rows: { direction: JournalRow['direction']; frame: unknown; at?: string }[], startSeq = 1): SessionEvent[] {
  const out: SessionEvent[] = [];
  rows.forEach((r, i) => {
    const events = n.push({ seq: startSeq + i, direction: r.direction, at: r.at ?? AT, frame: r.frame });
    for (const e of events) SessionEventSchema.parse(e);
    out.push(...events);
  });
  return out;
}

const inRow = (frame: unknown, at?: string) => ({ direction: 'in' as const, frame, at });
const outRow = (frame: unknown) => ({ direction: 'out' as const, frame });
const metaRow = (frame: unknown) => ({ direction: 'meta' as const, frame });
const kinds = (events: SessionEvent[]) => events.map((e) => e.kind);
const only = <K extends SessionEvent['kind']>(events: SessionEvent[], kind: K) => events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);

const initFrame = {
  type: 'system', subtype: 'init', cwd: '/w', session_id: 'sess-1', tools: ['Bash'], mcp_servers: [], model: 'claude-sonnet-5', permissionMode: 'auto',
  slash_commands: ['clear'], claude_code_version: '2.1.283', output_style: 'default', uuid: 'i-1',
};
const result = (extra: Record<string, unknown> = {}) => ({
  type: 'result', subtype: 'success', session_id: 'sess-1', is_error: false, duration_ms: 10, duration_api_ms: 8, num_turns: 1, total_cost_usd: 0.01,
  usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, output_tokens_details: { thinking_tokens: 5 } },
  modelUsage: { m: {} }, permission_denials: [], result: 'OK', terminal_reason: 'completed', origin: { kind: 'human' }, user_message_uuids: ['u-1'], result_index: 0, uuid: 'r-1', ...extra,
});
const startedIn = (uuid: string) => ({ direction: 'in' as const, frame: { type: 'command_lifecycle', command_uuid: uuid, state: 'started', uuid: `s-${uuid}`, session_id: 'sess-1' } });
const userOut = (uuid: string, extra: Record<string, unknown> = {}) => ({ type: 'user', uuid, message: { role: 'user', content: 'hi' }, parent_tool_use_id: null, origin: { kind: 'human' }, ...extra });

describe('normaliser: ids, turns and the human prompt bubble', () => {
  it('derives ids from the journal row, at from the frame timestamp when present, and sessionId from the frames', () => {
    const n = make({ sessionId: null });
    const events = feed(n, [outRow(userOut('u-1')), startedIn('u-1'), inRow({ ...initFrame }, '2026-09-28T11:00:00.000Z'), inRow({ type: 'user', uuid: 'e-1', session_id: 'sess-1', timestamp: '2026-09-28T12:00:00.000Z', message: { role: 'user', content: '[Request interrupted by user]' } })]);
    expect(events.map((e) => e.id)).toEqual(['app-1:LAUNCH01:1:0', 'app-1:LAUNCH01:2:0', 'app-1:LAUNCH01:2:1', 'app-1:LAUNCH01:3:0', 'app-1:LAUNCH01:4:0']);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 2, 3, 4]);
    expect(events[0]!.at).toBe(AT);
    expect(events[4]!.at).toBe('2026-09-28T12:00:00.000Z');
    expect(events[3]!.sessionId).toBe('sess-1');
    expect(n.state.sessionId).toBe('sess-1');
  });

  it("shows the prompt at the write, opens its human turn at the engine's started lifecycle, adds nothing at system/init, and closes at result", () => {
    const n = make();
    const events = feed(n, [outRow(userOut('u-1')), startedIn('u-1'), inRow(initFrame), inRow(result())]);
    expect(kinds(events)).toEqual(['user.message', 'command.lifecycle', 'turn.started', 'session.init', 'turn.ended', 'usage.sample']);
    expect(events[0]).toMatchObject({ kind: 'user.message', seq: 1, messageUuid: 'u-1', origin: 'human', isReplay: false, isSynthetic: false, bash: null, content: 'hi' });
    expect(events[2]).toMatchObject({ kind: 'turn.started', seq: 2, userMessageUuid: 'u-1', origin: 'human' });
    expect(events[4]).toMatchObject({ kind: 'turn.ended', isEchoReceipt: false, origin: 'human', terminalReason: 'completed', resultText: 'OK', userMessageUuids: ['u-1'], usage: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, thinkingTokens: 5 } });
    expect(events[5]).toMatchObject({ kind: 'usage.sample', source: 'result', costUsd: 0.01, modelUsage: { m: {} } });
    expect(n.state.currentTurn).toBeNull();
    expect(n.state.unstartedPrompts.size).toBe(0);
  });

  it('a written prompt waits unstarted (no turn) until its started lifecycle; startedAt equals acceptedAt', () => {
    const n = make();
    feed(n, [outRow(userOut('u-1'))]);
    expect(n.state.currentTurn).toBeNull();
    expect([...n.state.unstartedPrompts]).toEqual(['u-1']);
    feed(n, [inRow({ type: 'command_lifecycle', command_uuid: 'u-1', state: 'queued', uuid: 'q', session_id: 'sess-1' })], 2);
    expect(n.state.currentTurn).toBeNull();
    feed(n, [startedIn('u-1')], 3);
    expect(n.state.currentTurn).toMatchObject({ origin: 'human', userMessageUuids: ['u-1'], startedAt: AT, acceptedAt: AT });
    expect(n.state.unstartedPrompts.size).toBe(0);
  });

  it("a now steer that preempts the running turn opens its own turn at its own started (live 3.7 shape); the engine's replay of a prompt is suppressed once", () => {
    const n = make();
    const events = feed(n, [
      outRow(userOut('u-1')), startedIn('u-1'), inRow(initFrame), outRow(userOut('u-2', { priority: 'now' })),
      inRow({ type: 'user', uuid: 'u-1', session_id: 'sess-1', isReplay: true, origin: { kind: 'human' }, message: { role: 'user', content: 'hi' } }),
      inRow({ type: 'user', uuid: 'u-1', session_id: 'sess-1', isReplay: true, origin: { kind: 'human' }, message: { role: 'user', content: 'hi' } }),
      inRow(result({ terminal_reason: 'aborted_streaming', result: '', user_message_uuids: ['u-1'] })), // the preempted turn
      inRow({ type: 'command_lifecycle', command_uuid: 'u-1', state: 'cancelled', uuid: 'l-c', session_id: 'sess-1' }),
      startedIn('u-2'), inRow(initFrame), inRow(result({ result: 'STEERED', user_message_uuids: ['u-2'] })),
    ]);
    const turns = events.filter((e) => e.kind === 'turn.started' || e.kind === 'turn.ended').map((e) => (e.kind === 'turn.started' ? `start ${e.seq} ${e.userMessageUuid}` : `end ${e.seq} ${(e as { userMessageUuids: string[] }).userMessageUuids.join(',')}`));
    expect(turns).toEqual(['start 2 u-1', 'end 7 u-1', 'start 9 u-2', 'end 11 u-2']);
    expect(only(events, 'user.message').map((e) => [e.seq, e.messageUuid, e.isReplay])).toEqual([[1, 'u-1', false], [4, 'u-2', false], [6, 'u-1', true]]); // the second replay is not ours to suppress
  });

  it('a prompt cancelled, discarded or refused before it started has no turn to close: only its command.lifecycle marks it', () => {
    for (const state of ['cancelled', 'discarded', 'refused'] as const) {
      const n = make();
      const events = feed(n, [outRow(userOut('u-1')), inRow({ type: 'command_lifecycle', command_uuid: 'u-1', state, uuid: 'l-1', session_id: 'sess-1' })]);
      expect(kinds(events)).toEqual(['user.message', 'command.lifecycle']);
      expect(n.state.currentTurn).toBeNull();
      expect(n.state.unstartedPrompts.size).toBe(0);
    }
  });

  it('a steer cancelled inside a running turn (pass1/queue-and-interrupt 146/191) and a cancel after the result close nothing; two prompts drained together share one turn', () => {
    const lifecycleIn = (uuid: string, state = 'cancelled') => inRow({ type: 'command_lifecycle', command_uuid: uuid, state, uuid: `l-${uuid}`, session_id: 'sess-1' });
    const steer = make();
    expect(kinds(feed(steer, [outRow(userOut('u-1')), startedIn('u-1'), inRow(initFrame), outRow(userOut('u-2')), lifecycleIn('u-2')]))).toEqual(['user.message', 'command.lifecycle', 'turn.started', 'session.init', 'user.message', 'command.lifecycle']);
    expect(steer.state.currentTurn?.userMessageUuids).toEqual(['u-1']);
    const accepted = make(); // a started prompt's own result closes it (pass2/per-task-stop-on 66 → 67)
    expect(kinds(feed(accepted, [outRow(userOut('u-1')), startedIn('u-1'), inRow(initFrame), lifecycleIn('u-1')])).slice(-1)).toEqual(['command.lifecycle']);
    expect(accepted.state.currentTurn).not.toBeNull();
    const after = make(); // pass1/queue-and-interrupt seq 200, pass2/auto-unrouted 14: after the result, a no-op
    expect(kinds(feed(after, [outRow(userOut('u-1')), startedIn('u-1'), inRow(initFrame), inRow(result()), lifecycleIn('u-1')])).slice(-1)).toEqual(['command.lifecycle']);
    const drained = make();
    feed(drained, [outRow(userOut('u-1')), outRow(userOut('u-2')), startedIn('u-1'), startedIn('u-2')]);
    expect(drained.state.currentTurn?.userMessageUuids).toEqual(['u-1', 'u-2']);
  });

  it.each(['local_agent', 'local_bash'])('a live %s task notification preserves the running human turn', (taskType) => {
    const n = make();
    feed(n, [outRow(userOut('u-1')), startedIn('u-1'), inRow(initFrame)]);
    const events = feed(n, [
      inRow({ type: 'system', subtype: 'task_started', task_id: 'task-1', tool_use_id: 'toolu_1', task_type: taskType, description: 'Sample task', is_backgrounded: true }),
      inRow({ type: 'system', subtype: 'task_notification', task_id: 'task-1', tool_use_id: 'toolu_1', status: 'completed', summary: 'Done', output_file: '/tmp/task.output' }),
    ], 4);
    expect(kinds(events)).toEqual(taskType === 'local_agent' ? ['subagent.started', 'subagent.finished'] : ['task.started', 'task.notification']);
    expect(events[1]).toMatchObject({ taskId: 'task-1', status: 'completed', summary: 'Done', outputFile: '/tmp/task.output' });
    expect(n.state.currentTurn).toMatchObject({ origin: 'human', userMessageUuids: ['u-1'] });
    const ended = feed(n, [inRow(result())], 6);
    expect(only(ended, 'turn.ended')[0]).toMatchObject({ userMessageUuids: ['u-1'], origin: 'human' });
    expect(n.state.currentTurn).toBeNull();
  });

  it('system/init with no open turn opens an engine-initiated one, closed by a task-notification result', () => {
    const n = make();
    const events = feed(n, [inRow(initFrame), inRow(result({ origin: { kind: 'task-notification' }, user_message_uuids: [] }))]);
    expect(events[0]).toMatchObject({ kind: 'session.init', cwd: '/w', model: 'claude-sonnet-5', permissionMode: 'auto', engineVersion: '2.1.283', outputStyle: 'default', agents: [], skills: [], plugins: [], capabilities: [] });
    expect(events[1]).toMatchObject({ kind: 'turn.started', userMessageUuid: null, origin: 'engine' });
    expect(events[2]).toMatchObject({ kind: 'turn.ended', origin: 'task-notification' });
  });

  it('the ! echo opens no turn, its system/init opens nothing, and its empty result is the receipt', () => {
    const n = make();
    const echo = { type: 'user', uuid: 'e-1', shouldQuery: false, parent_tool_use_id: null, origin: { kind: 'human' }, message: { role: 'user', content: '<bash-input>ls</bash-input>\n<bash-stdout>a</bash-stdout>' } };
    const events = feed(n, [outRow(echo), inRow(initFrame), inRow(result({ num_turns: 0, terminal_reason: null, result: undefined, user_message_uuids: ['e-1'] })), outRow(userOut('u-9')), startedIn('u-9')]);
    expect(kinds(events)).toEqual(['user.message', 'session.init', 'turn.ended', 'usage.sample', 'user.message', 'command.lifecycle', 'turn.started']);
    expect(events[0]).toMatchObject({ kind: 'user.message', messageUuid: 'e-1', origin: 'bash_echo', isSynthetic: true, isReplay: false, bash: null });
    expect(events[2]).toMatchObject({ kind: 'turn.ended', isEchoReceipt: true });
    expect(n.state.pendingEcho).toBeNull();
    expect(events[6]).toMatchObject({ kind: 'turn.started', origin: 'human', userMessageUuid: 'u-9' });
  });

  // C7 start: the C7 M6 live run (a `!` sent while a turn ran, then `/compact`): the engine folds the echo into the
  // running turn, whose result names it, and sends no receipt of its own; the next empty result is a local command's.
  it('a ! echo written during a turn joins that turn, so a later empty result closes its own turn and is no receipt', () => {
    const n = make();
    const echo = { type: 'user', uuid: 'e-1', shouldQuery: false, parent_tool_use_id: null, origin: { kind: 'human' }, message: { role: 'user', content: '<bash-input>echo X</bash-input>\n<bash-stdout>X</bash-stdout>' } };
    const events = feed(n, [
      outRow(userOut('u-1')), startedIn('u-1'), inRow(initFrame), outRow(echo), startedIn('e-1'),
      inRow(result({ num_turns: 6, user_message_uuids: ['u-1', 'e-1'] })), // the turn the echo joined
      outRow(userOut('u-2', { message: { role: 'user', content: '/compact' } })), startedIn('u-2'), inRow(initFrame),
      inRow(result({ num_turns: 0, terminal_reason: null, result: undefined, user_message_uuids: ['u-2'] })), // /compact's own result
    ]);
    expect(n.state.pendingEcho).toBeNull();
    expect(only(events, 'turn.ended').map((e) => [e.userMessageUuids, e.isEchoReceipt])).toEqual([[['u-1', 'e-1'], false], [['u-2'], false]]);
    expect(n.state.currentTurn).toBeNull();
  });

  it("an empty result naming the pending echo and another prompt closes that prompt's turn and is no receipt", () => {
    const n = make();
    const echo = { type: 'user', uuid: 'e-1', shouldQuery: false, parent_tool_use_id: null, origin: { kind: 'human' }, message: { role: 'user', content: '<bash-input>echo X</bash-input>\n<bash-stdout>X</bash-stdout>' } };
    const events = feed(n, [
      outRow(echo),
      outRow(userOut('u-2', { message: { role: 'user', content: '/compact' } })), startedIn('u-2'),
      inRow(result({ num_turns: 0, terminal_reason: null, result: undefined, user_message_uuids: ['e-1', 'u-2'] })),
    ]);
    expect(only(events, 'turn.ended').map((e) => [e.userMessageUuids, e.isEchoReceipt])).toEqual([[['e-1', 'u-2'], false]]);
    expect(n.state.currentTurn).toBeNull(); // /compact's turn closed
    expect(n.state.pendingEcho).toBeNull(); // and the echo it named waits no longer
  });
  // C7 end

  it('bash-tagged replayed user frames fill the bash field with the tags stripped', () => {
    const n = make();
    const events = feed(n, [
      inRow({ type: 'user', uuid: 'b-1', session_id: 'sess-1', isReplay: true, message: { role: 'user', content: '<bash-input>printf X</bash-input>' } }),
      inRow({ type: 'user', uuid: 'b-2', session_id: 'sess-1', isReplay: true, message: { role: 'user', content: '<bash-stdout>X</bash-stdout><bash-stderr>e</bash-stderr><bash-exit-code>3</bash-exit-code>' } }),
    ]);
    expect(events[0]).toMatchObject({ kind: 'user.message', bash: { part: 'input', command: 'printf X' }, content: 'printf X', isReplay: true });
    expect(events[1]).toMatchObject({ kind: 'user.message', bash: { part: 'output', stdout: 'X', stderr: 'e', exitCode: 3 }, content: 'X' });
  });

  it('engine-authored local-command output and interrupt markers carry their own origins and open nothing', () => {
    const n = make();
    const events = feed(n, [
      inRow({ type: 'user', uuid: 'l-1', session_id: 'sess-1', isReplay: true, message: { role: 'user', content: '<local-command-stdout>Set model to `haiku`</local-command-stdout>' } }),
      inRow({ type: 'user', uuid: 'm-1', session_id: 'sess-1', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
      inRow({ type: 'user', uuid: 'm-2', session_id: 'sess-1', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }),
    ]);
    expect(kinds(events)).toEqual(['user.message', 'user.message', 'user.message']);
    expect(events[0]).toMatchObject({ messageUuid: 'l-1', origin: 'local-command', content: 'Set model to `haiku`', isReplay: true, bash: null });
    expect(events[1]).toMatchObject({ messageUuid: 'm-1', origin: 'interrupt-marker', content: [{ type: 'text', text: '[Request interrupted by user]' }], bash: null });
    expect(events[2]).toMatchObject({ messageUuid: 'm-2', origin: 'interrupt-marker' });
    expect(n.state.currentTurn).toBeNull();
  });
});

describe('normaliser: tools, blocks and safeguards', () => {
  const start = (index: number, type: string, extra: Record<string, unknown> = {}) => inRow({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type, ...extra } }, session_id: 'sess-1', parent_tool_use_id: null, uuid: `s-${index}` });
  const messageStart = inRow({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1', model: 'm' } }, session_id: 'sess-1', parent_tool_use_id: null, uuid: 'ms', user_message_uuid: 'u-1' });
  const assistant = (id: string, content: unknown[], extra: Record<string, unknown> = {}) => inRow({ type: 'assistant', message: { id, role: 'assistant', model: 'm', content }, parent_tool_use_id: null, session_id: 'sess-1', uuid: `a-${content.length}`, ...extra });

  it('pairs deltas and completes by the stream index per message id; a signature delta yields nothing', () => {
    const n = make();
    const events = feed(n, [
      outRow(userOut('u-1')), startedIn('u-1'), messageStart, start(0, 'thinking'),
      inRow({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } }, session_id: 'sess-1', parent_tool_use_id: null, uuid: 'd0' }),
      inRow({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }, session_id: 'sess-1', parent_tool_use_id: null, uuid: 'd0s' }),
      assistant('msg_1', [{ type: 'thinking', thinking: 'hm', signature: 'sig' }]),
      start(1, 'tool_use', { id: 'toolu_1', name: 'Bash', input: {} }),
      inRow({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"c":1}' } }, session_id: 'sess-1', parent_tool_use_id: null, uuid: 'd1' }),
      assistant('msg_1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { c: 1 } }]),
    ]);
    const deltas = only(events, 'assistant.block.delta');
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ apiMessageId: 'msg_1', blockIndex: 0, blockType: 'thinking', thinkingDelta: 'hm', textDelta: null, inputJsonDelta: null, userMessageUuid: 'u-1' });
    expect(deltas[1]).toMatchObject({ apiMessageId: 'msg_1', blockIndex: 1, blockType: 'tool_use', inputJsonDelta: '{"c":1}' });
    const completes = only(events, 'assistant.block.complete');
    expect(completes.map((c) => [c.apiMessageId, c.blockIndex, c.block.type])).toEqual([['msg_1', 0, 'thinking'], ['msg_1', 1, 'tool_use']]);
    expect(completes[0]).toMatchObject({ messageUuid: 'a-1', model: 'm', supersedes: [], aborted: false, userMessageUuids: ['u-1'] });
    expect(only(events, 'tool.use')[0]).toMatchObject({ toolUseId: 'toolu_1', toolName: 'Bash', input: { c: 1 }, apiMessageId: 'msg_1', messageUuid: 'a-1' });
  });

  it('a message with no stream events counts block indices per message id; a type mismatch warns and still assigns', () => {
    const warn = vi.fn();
    const n = make({ warn });
    const child = { parent_tool_use_id: 'toolu_parent' };
    const events = feed(n, [
      assistant('msg_c', [{ type: 'text', text: 'a' }], child),
      assistant('msg_c', [{ type: 'tool_use', id: 'toolu_c', name: 'Read', input: {} }], child),
      assistant('msg_d', [{ type: 'text', text: 'b' }], child),
      messageStart, start(0, 'text'),
      assistant('msg_1', [{ type: 'tool_use', id: 'toolu_x', name: 'Bash', input: {} }]),
    ]);
    const completes = only(events, 'assistant.block.complete');
    expect(completes.map((c) => [c.apiMessageId, c.blockIndex, c.parentToolUseId])).toEqual([['msg_c', 0, 'toolu_parent'], ['msg_c', 1, 'toolu_parent'], ['msg_d', 0, 'toolu_parent'], ['msg_1', 0, null]]);
    expect(completes[0]!.userMessageUuids).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'block_pairing', seq: 6 }));
  });

  it('tool results carry denial, safeguard, spillPath and the agent map from an Agent launch result', () => {
    const n = make();
    const events = feed(n, [
      inRow({ type: 'stream_event', event: { type: 'message_delta', delta: { safeguard_results: [{ type: 'dangerous_tool_use', status: { type: 'available', tool_uses: { toolu_1: { type: 'evaluated', outcome: 'not_flagged' }, toolu_2: { type: 'evaluated', outcome: 'flagged' } } } }] } }, session_id: 'sess-1', parent_tool_use_id: null, uuid: 'md' }),
      inRow({ type: 'user', uuid: 'r-1', session_id: 'sess-1', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'denied', is_error: true }] }, tool_result_meta: [{ id: 'toolu_1', non_execution_kind: 'permission-rule' }] }),
      inRow({ type: 'user', uuid: 'r-2', session_id: 'sess-1', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_3', content: [{ type: 'text', text: 'Output too large (12 KB). Full output saved to: /tmp/x/tool-results/toolu_1.txt\n\npreview' }] }] } }),
      inRow({ type: 'user', uuid: 'r-3', session_id: 'sess-1', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_4', content: 'ok' }] }, tool_use_result: { persistedOutputPath: '/tmp/y/toolu_4.txt', persistedOutputSize: 9 } }),
      inRow({ type: 'user', uuid: 'r-4', session_id: 'sess-1', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_5', content: 'launched' }] }, tool_use_result: { isAsync: true, agentId: 'agent-9' } }),
      assistant('msg_k', [{ type: 'text', text: 'child' }], { parent_tool_use_id: 'toolu_5' }),
    ]);
    const safeguards = only(events, 'tool.safeguard');
    expect(safeguards.map((s) => [s.toolUseId, s.verdict, s.lane])).toEqual([['toolu_1', 'not_flagged', 'server'], ['toolu_2', 'flagged', 'server']]);
    const results = only(events, 'tool.result');
    expect(results[0]).toMatchObject({ toolUseId: 'toolu_1', denial: 'permission-rule', safeguard: 'not_flagged', isError: true, spillPath: null, content: 'denied', messageUuid: 'r-1' });
    expect(results[1]).toMatchObject({ toolUseId: 'toolu_3', denial: null, safeguard: 'not_evaluated', spillPath: '/tmp/x/tool-results/toolu_1.txt' });
    expect(results[2]).toMatchObject({ toolUseId: 'toolu_4', spillPath: '/tmp/y/toolu_4.txt', structured: { persistedOutputPath: '/tmp/y/toolu_4.txt', persistedOutputSize: 9 } });
    expect(n.state.toolUseToAgent.get('toolu_5' as never)).toBe('agent-9');
    expect(only(events, 'assistant.block.complete')[0]).toMatchObject({ parentToolUseId: 'toolu_5', agentId: 'agent-9' });
  });

  it('spillPathOf reads the Bash key first, then the notice prefix, else null', () => {
    expect(spillPathOf({ persistedOutputPath: '/a' }, 'Output too large (1 KB). Full output saved to: /b')).toBe('/a');
    expect(spillPathOf(null, [{ type: 'text', text: 'Output too large (1 KB). Full output saved to: /b\n\nrest' }])).toBe('/b');
    expect(spillPathOf('Error', 'plain')).toBeNull();
  });
});

describe('normaliser: requests, responses and boundaries', () => {
  const canUseTool = (request_id: string, extra: Record<string, unknown> = {}) => inRow({ type: 'control_request', request_id, request: { subtype: 'can_use_tool', tool_name: 'Bash', display_name: 'Bash', input: { command: 'ls' }, description: 'List', tool_use_id: 'toolu_1', decision_reason_type: 'rule', ...extra } });

  it('permission.requested carries the six optional fields and agentId only when the wire does', () => {
    const n = make();
    const full = feed(n, [canUseTool('r-1', {
      decision_reason: 'matched ask rule', suppress_always_allow_rule: true, default_to_no: false,
      matched_ask_rule: { source: 'projectSettings', toolName: 'Bash', ruleContent: 'git log:*', extra: 1 }, requires_user_interaction: true,
      mcp_server: { name: 'maws-elicit', source: 'dynamic', tools: [] }, agent_id: 'agent-7',
    })])[0] as Extract<SessionEvent, { kind: 'permission.requested' }>;
    expect(full).toMatchObject({
      kind: 'permission.requested', requestId: 'r-1', toolUseId: 'toolu_1', toolName: 'Bash', displayName: 'Bash', description: 'List', decisionReasonType: 'rule', suggestions: [], blockedPath: null,
      decisionReason: 'matched ask rule', suppressAlwaysAllow: true, defaultToNo: false, matchedAskRule: { source: 'projectSettings', toolName: 'Bash', ruleContent: 'git log:*' }, requiresUserInteraction: true, mcpServer: { name: 'maws-elicit', source: 'dynamic' }, agentId: 'agent-7',
    });
    const bare = feed(make(), [canUseTool('r-2')])[0]!;
    for (const key of ['decisionReason', 'suppressAlwaysAllow', 'defaultToNo', 'matchedAskRule', 'requiresUserInteraction', 'mcpServer']) expect(key in bare).toBe(false);
    expect(bare.agentId).toBeNull();
    for (const [pass, name, seq] of [['pass2', 'grant-reapply-start', 30], ['pass2', 'grant-askrule-start', 27]] as const) {
      const row = loadJournal(pass, name).find((r) => r.seq === seq)!;
      const [event] = make().push(row);
      expect(event!.kind).toBe('permission.requested');
      for (const key of ['decisionReason', 'suppressAlwaysAllow', 'defaultToNo', 'matchedAskRule', 'requiresUserInteraction', 'mcpServer']) expect(key in event!).toBe(false);
    }
  });

  it('routes can_use_tool by tool name and resolves each kind from our control_response', () => {
    const n = make();
    const questions = [{ question: 'Color?', header: 'Color', options: [{ label: 'Red', description: 'warm' }], multiSelect: false }];
    const events = feed(n, [
      canUseTool('q-1', { tool_name: 'AskUserQuestion', input: { questions } }),
      outRow({ type: 'control_response', response: { subtype: 'success', request_id: 'q-1', response: { behavior: 'allow', updatedInput: { questions, answers: { 'Color?': 'Red' } } } } }),
      canUseTool('p-1', { tool_name: 'ExitPlanMode', input: { plan: 'do it' } }),
      outRow({ type: 'control_response', response: { subtype: 'success', request_id: 'p-1', response: { behavior: 'deny', message: 'Keep planning.' } } }),
      canUseTool('p-2', { tool_name: 'ExitPlanMode', input: { plan: 'do it' } }),
      outRow({ type: 'control_response', response: { subtype: 'success', request_id: 'p-2', response: { behavior: 'allow', updatedInput: { plan: 'do it' } } } }),
      canUseTool('b-1'),
      outRow({ type: 'control_response', response: { subtype: 'success', request_id: 'b-1', response: { behavior: 'allow', updatedInput: { command: 'ls' }, updatedPermissions: [{ type: 'addRules' }] } } }),
      inRow({ type: 'control_request', request_id: 'h-1', request: { subtype: 'hook_callback', callback_id: 'maws_pre_bash', tool_use_id: 'toolu_1', input: { hook_event_name: 'PreToolUse' } } }),
      outRow({ type: 'control_response', response: { subtype: 'success', request_id: 'h-1', response: { continue: true } } }),
      inRow({ type: 'control_request', request_id: 'e-1', request: { subtype: 'elicitation', mcp_server_name: 'srv', mode: 'form', message: 'pick' } }),
      outRow({ type: 'control_response', response: { subtype: 'success', request_id: 'e-1', response: { action: 'accept', content: { color: 'teal' } } } }),
      inRow({ type: 'control_request', request_id: 'd-1', request: { subtype: 'request_user_dialog', dialog_kind: 'refusal_fallback_prompt', payload: { title: 'Model refused', options: ['retry'] } } }),
      outRow({ type: 'control_response', response: { subtype: 'success', request_id: 'd-1', response: { behavior: 'completed', result: { choice: 1 } } } }),
    ]);
    expect(kinds(events)).toEqual([
      'question.requested', 'question.answered', 'plan.requested', 'plan.resolved', 'plan.requested', 'plan.resolved', 'permission.requested', 'permission.resolved',
      'hook.callback_requested', 'hook.callback_resolved', 'elicitation.requested', 'elicitation.resolved', 'dialog.requested', 'dialog.resolved',
    ]);
    expect(events[0]).toMatchObject({ questions: [{ question: 'Color?', header: 'Color', options: [{ label: 'Red', description: 'warm', preview: null }], multiSelect: false }] });
    expect(events[1]).toMatchObject({ answers: { 'Color?': 'Red' }, toolUseId: 'toolu_1' });
    expect(events[2]).toMatchObject({ plan: 'do it' });
    expect(events[3]).toMatchObject({ outcome: 'keep_planning', feedback: 'Keep planning.' });
    expect(events[5]).toMatchObject({ outcome: 'implement', feedback: null });
    expect(events[7]).toMatchObject({ behavior: 'allow', resolvedBy: 'user', updatedPermissions: [{ type: 'addRules' }], message: null });
    expect(events[8]).toMatchObject({ callbackId: 'maws_pre_bash', hookEvent: 'PreToolUse', toolUseId: 'toolu_1' });
    expect(events[9]).toMatchObject({ callbackId: 'maws_pre_bash', response: { continue: true } });
    expect(events[10]).toMatchObject({ mcpServerName: 'srv', mode: 'form', elicitationId: null });
    expect(events[11]).toMatchObject({ action: 'accept', content: { color: 'teal' } });
    expect(events[12]).toMatchObject({ dialogKind: 'refusal_fallback_prompt', toolUseId: null });
    // C7 validates the payload against the declared kind's own schema: it is the wire `payload` value, never the whole request
    expect((events[12] as Extract<SessionEvent, { kind: 'dialog.requested' }>).payload).toEqual({ title: 'Model refused', options: ['retry'] });
    expect(events[13]).toMatchObject({ behavior: 'completed', result: { choice: 1 } });
    expect(n.state.inbound.size).toBe(0);
  });

  it('an inbound cancellation retires a pending permission with abort; the plan message names clear_and_implement', () => {
    const events = feed(make(), [
      canUseTool('b-1'),
      inRow({ type: 'control_cancel_request', request_id: 'b-1' }),
      inRow({ type: 'control_cancel_request', request_id: 'never' }),
      canUseTool('p-1', { tool_name: 'ExitPlanMode', input: { plan: 'x' } }),
      outRow({ type: 'control_response', response: { subtype: 'success', request_id: 'p-1', response: { behavior: 'deny', message: 'Plan approved; MAWS is clearing context and will restart with the plan.' } } }),
    ]);
    expect(kinds(events)).toEqual(['permission.requested', 'permission.resolved', 'plan.requested', 'plan.resolved']);
    expect(events[1]).toMatchObject({ behavior: 'deny', resolvedBy: 'abort', toolUseId: 'toolu_1' });
    expect(events[3]).toMatchObject({ outcome: 'clear_and_implement' });
  });

  it('the broker\'s answer note (a meta row before our response) folds into permission.resolved.message', () => {
    const n = make();
    const events = feed(n, [
      canUseTool('r-1'),
      metaRow({ event: 'answer_note', requestId: 'r-1', note: 'scope downgraded: ask rule' }),
      outRow({ type: 'control_response', response: { subtype: 'success', request_id: 'r-1', response: { behavior: 'allow', updatedInput: { command: 'ls' }, decisionClassification: 'user_temporary' } } }),
      canUseTool('r-2'),
      outRow({ type: 'control_response', response: { subtype: 'success', request_id: 'r-2', response: { behavior: 'allow', updatedInput: { command: 'ls' } } } }),
    ]);
    expect(kinds(events)).toEqual(['permission.requested', 'permission.resolved', 'permission.requested', 'permission.resolved']);
    expect(events[1]).toMatchObject({ kind: 'permission.resolved', requestId: 'r-1', behavior: 'allow', message: 'scope downgraded: ask rule', updatedPermissions: [] });
    expect(events[3]).toMatchObject({ kind: 'permission.resolved', requestId: 'r-2', message: null });
    expect(n.state.answerNotes.size).toBe(0);
  });

  it('requests a response envelope re-delivers (pending_permission_requests / pending_user_dialog_requests) yield their *.requested events once', () => {
    const n = make();
    const pending = { type: 'control_request', request_id: 'r-9', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' }, tool_use_id: 'toolu_9' } };
    const dialog = { type: 'control_request', request_id: 'd-9', request: { subtype: 'request_user_dialog', dialog_kind: 'refusal_fallback_prompt', payload: {} } };
    const envelope = { type: 'control_response', response: { subtype: 'success', request_id: 'L-1', response: { commands: [], current_permission_mode: 'auto' }, pending_permission_requests: [pending], pending_user_dialog_requests: [dialog] } };
    const events = feed(n, [outRow({ type: 'control_request', request_id: 'L-1', request: { subtype: 'initialize' } }), inRow(envelope), inRow(envelope)]);
    expect(kinds(events)).toEqual(['permission.requested', 'dialog.requested']);
    expect(events[0]).toMatchObject({ requestId: 'r-9', toolUseId: 'toolu_9', seq: 2 });
  });

  it('boundary.rewind derives from the correlated rewind_conversation response; a refusal yields nothing', () => {
    const n = make();
    const request = (request_id: string) => outRow({ type: 'control_request', request_id, request: { subtype: 'rewind_conversation', target_message_uuid: 'u-2' } });
    const response = (request_id: string, payload: unknown) => inRow({ type: 'control_response', response: { subtype: 'success', request_id, response: payload } });
    const events = feed(n, [
      request('L-1'), response('L-1', { rewound: false, prefillText: null, precedingAssistantUuid: null, error: 'stale target', reason: 'stale_target' }),
      request('L-2'), response('L-2', { rewound: true, targetMessageUuid: 'u-2', prefillText: 'Also BANANA', precedingAssistantUuid: 'a-1' }),
      outRow({ type: 'control_request', request_id: 'L-3', request: { subtype: 'get_usage' } }), response('L-3', {}),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'boundary.rewind', seq: 4, id: 'app-1:LAUNCH01:4:0', targetMessageUuid: 'u-2', precedingAssistantUuid: 'a-1', prefillText: 'Also BANANA' });
    expect(n.state.outbound.size).toBe(0);
  });
});

describe('normaliser: meta rows, system subtypes and the unknown', () => {
  it('a write_failed meta row yields error.raised { scope: transport } naming the request', () => {
    const events = feed(make(), [metaRow({ event: 'write_failed', frameType: 'control_response', subtype: null, requestId: 'r-1', message: 'EPIPE' })]);
    expect(events).toMatchObject([{ kind: 'error.raised', scope: 'transport', code: 'write_failed', message: 'control_response not written: EPIPE', requestId: 'r-1', toolUseId: null, taskId: null }]);
  });

  it('a host notice meta row yields notice.posted; the normaliser warning rows yield nothing', () => {
    const events = feed(make(), [
      metaRow({ event: 'notice', level: 'warning', key: 'dialog:undeclared:d-1', text: 'undeclared dialog' }),
      metaRow({ event: 'notice', level: 'info', key: null, text: 'fyi' }),
      metaRow({ event: 'block_pairing', rowSeq: 4, detail: {} }),
    ]);
    expect(kinds(events)).toEqual(['notice.posted', 'notice.posted']);
    expect(events[0]).toMatchObject({ level: 'warning', key: 'dialog:undeclared:d-1', text: 'undeclared dialog', seq: 1 });
    expect(events[1]).toMatchObject({ level: 'info', key: null, text: 'fyi' });
  });

  it('maps the host\'s meta rows and tolerates the probe\'s exit row shape', () => {
    const events = feed(make(), [
      metaRow({ event: 'spawn', bin: '/x' }),
      metaRow({ event: 'reconnect', phase: 'attempting', attempt: 1, maxAttempts: 1, trigger: 'user', reason: null }),
      metaRow({ event: 'parse_error', message: 'bad json', length: 3, typeGuess: null }),
      metaRow({ event: 'transport_error', message: 'line budget', code: 'line_budget' }),
      metaRow({ event: 'init_failed', message: 'No conversation found' }),
      metaRow({ event: 'replay_mismatch', message: 'expected seq 2 user, got x', expected: 'seq 2 user', got: 'x' }),
      metaRow({ event: 'exit', code: 0, signal: null, reason: 'stop', lostAttentionCount: 2 }),
      metaRow({ event: 'exit', code: 0, signal: null, peakRSSKiB: 1 }),
      metaRow({ event: 'exit', code: 1, signal: null }),
      metaRow({ event: 'exit', code: null, signal: 'SIGKILL' }),
      { direction: 'stderr' as const, frame: { text: 'noise' } },
    ]);
    expect(kinds(events)).toEqual(['session.reconnect', 'error.raised', 'error.raised', 'error.raised', 'error.raised', 'process.exited', 'process.exited', 'process.exited', 'process.exited']);
    expect(events[0]).toMatchObject({ phase: 'attempting', attempt: 1, maxAttempts: 1, trigger: 'user', reason: null });
    expect(events[1]).toMatchObject({ scope: 'transport', code: 'parse_error', message: 'bad json', requestId: null, toolUseId: null, taskId: null });
    expect(events[2]).toMatchObject({ scope: 'transport', code: 'line_budget' });
    expect(events[3]).toMatchObject({ scope: 'process', code: 'init_failed' });
    expect(events[4]).toMatchObject({ scope: 'transport', code: 'replay_mismatch' });
    expect(events[5]).toMatchObject({ code: 0, signal: null, reason: 'stop', lostAttentionCount: 2, seq: 7 });
    expect(events[6]).toMatchObject({ reason: 'unknown', lostAttentionCount: 0 });
    expect(events[7]).toMatchObject({ reason: 'crash' });
    expect(events[8]).toMatchObject({ reason: 'crash', signal: 'SIGKILL' });
  });

  // C12 start
  it("a release's exit row yields process.exited { reason: budget } with its budget and sum; every other exit carries budget null (C12)", () => {
    const events = feed(make(), [
      metaRow({ event: 'exit', code: 0, signal: null, reason: 'budget', lostAttentionCount: 0, budget: { limitKiB: 8_388_608, totalKiB: 9_000_000 } }),
      metaRow({ event: 'exit', code: 0, signal: null, reason: 'stop', lostAttentionCount: 0, budget: null }),
      metaRow({ event: 'exit', code: 0, signal: null, reason: 'stop', lostAttentionCount: 0 }),
    ]);
    expect(only(events, 'process.exited').map((e) => [e.reason, e.budget])).toEqual([
      ['budget', { limitKiB: 8_388_608, totalKiB: 9_000_000 }],
      ['stop', null],
      ['stop', null],
    ]);
  });

  it('the reconnect trigger is the one the host recorded (process_exit after a release); a row without one, or with a trigger X1 does not name, reads user (C12)', () => {
    const events = feed(make(), [
      metaRow({ event: 'reconnect', phase: 'attempting', attempt: 1, maxAttempts: 1, trigger: 'process_exit', reason: null }),
      metaRow({ event: 'reconnect', phase: 'reconnected', attempt: 1, maxAttempts: 1, trigger: 'process_exit', reason: null }),
      metaRow({ event: 'reconnect', phase: 'attempting', attempt: 1, maxAttempts: 1, reason: null }),
      metaRow({ event: 'reconnect', phase: 'attempting', attempt: 1, maxAttempts: 1, trigger: 'meteor', reason: null }),
    ]);
    expect(only(events, 'session.reconnect').map((e) => e.trigger)).toEqual(['process_exit', 'process_exit', 'user', 'user']);
  });
  // C12 end

  it('maps every named system subtype and the other top-level frames', () => {
    const sys = (subtype: string, extra: Record<string, unknown>) => inRow({ type: 'system', subtype, session_id: 'sess-1', uuid: `s-${subtype}`, ...extra });
    const events = feed(make(), [
      sys('session_state_changed', { state: 'running' }),
      sys('commands_changed', { commands: [{ name: 'clear', description: 'Reset' }] }),
      sys('compact_boundary', { compact_metadata: { trigger: 'auto', pre_tokens: 100 } }),
      inRow({ type: 'conversation_reset', new_conversation_id: 'c-2', trigger: 'clear' }),
      sys('model_refusal_fallback', { original_model: 'a', fallback_model: 'b', retracted_message_uuids: ['m-1'], content: 'refused' }),
      sys('model_refusal_no_fallback', { original_model: 'a' }),
      sys('api_retry', { attempt: 1, max_retries: 3, retry_delay_ms: 500, error_status: 529, error: 'overloaded' }),
      sys('informational', { content: 'classifier usage charged', level: 'warning' }),
      sys('notification', { key: 'k', text: 'hello', priority: 'high' }),
      sys('notification', { key: 'k2', text: 'hi' }),
      sys('permission_denied', { tool_name: 'Bash', tool_use_id: 'toolu_1', message: 'denied' }),
      sys('hook_started', { hook_id: 'h', hook_name: 'PostToolUse:Bash', hook_event: 'PostToolUse' }),
      sys('hook_progress', { hook_id: 'h', hook_name: 'PostToolUse:Bash', hook_event: 'PostToolUse', stdout: 'x' }),
      sys('hook_response', { hook_id: 'h', hook_name: 'PostToolUse:Bash', hook_event: 'PostToolUse', outcome: 'success', exit_code: 0, stdout: 'out' }),
      sys('task_started', { task_id: 'ag-1', tool_use_id: 'toolu_1', description: 'Read', subagent_type: 'general-purpose', is_backgrounded: true, spawn_depth: 1, task_type: 'local_agent', prompt: 'p' }),
      sys('task_started', { task_id: 'wf-1', tool_use_id: 'toolu_2', description: 'Flow', task_type: 'local_workflow', workflow_name: 'probe' }),
      sys('task_progress', { task_id: 'ag-1', tool_use_id: 'toolu_1', description: 'Reading', usage: { total_tokens: 1, tool_uses: 1, duration_ms: 2 }, last_tool_name: 'Read' }),
      sys('task_progress', { task_id: 'wf-1', tool_use_id: 'toolu_2', description: 'Wait', usage: { total_tokens: 0, tool_uses: 0, duration_ms: 1 }, workflow_progress: [{ type: 'workflow_phase', index: 1 }] }),
      sys('task_updated', { task_id: 'ag-1', patch: { status: 'completed', end_time: 5 } }),
      sys('task_notification', { task_id: 'ag-1', tool_use_id: 'toolu_1', status: 'completed', summary: 'ONE', output_file: '/o' }),
      sys('task_notification', { task_id: 'wf-1', tool_use_id: 'toolu_2', status: 'stopped', summary: 'Flow', output_file: '' }),
      sys('background_tasks_changed', { tasks: [{ task_id: 'ag-1', task_type: 'local_agent', description: 'Read' }] }),
      sys('peer_message_hold', { state: 'held' }),
      sys('thinking_tokens', { estimated_tokens: 1, estimated_tokens_delta: 1 }),
      sys('elicitation_complete', { mcp_server_name: 's', elicitation_id: 'e' }),
      sys('local_command_output', { content: 'Set model to haiku' }), // table: journaled, no event
      sys('turn_starting', {}),
      inRow({ type: 'command_lifecycle', command_uuid: 'u-1', state: 'queued' }),
      inRow({ type: 'tool_progress', tool_use_id: 'toolu_1', tool_name: 'Bash', elapsed_time_seconds: 2.5 }),
      inRow({ type: 'tool_use_summary', summary: 's', preceding_tool_use_ids: [] }),
      inRow({ type: 'rate_limit_event', rate_limit_info: {} }),
      inRow({ type: 'brand_new_frame', x: 1 }),
      inRow({ type: 'system', subtype: 'init', session_id: 'sess-1' }), // a known subtype failing its schema
    ]);
    expect(kinds(events)).toEqual([
      'session.state', 'session.commands', 'boundary.compaction', 'boundary.reset', 'boundary.retraction', 'boundary.retraction', 'api.retry', 'notice.posted', 'notice.posted', 'notice.posted', 'notice.posted',
      'hook.started', 'hook.finished', 'subagent.started', 'task.started', 'subagent.progress', 'workflow.progress', 'task.updated', 'subagent.finished', 'task.notification', 'tasks.snapshot',
      'frame.unknown', 'command.lifecycle', 'tool.progress', 'frame.unknown', 'error.raised',
    ]);
    expect(events[1]).toMatchObject({ commands: [{ name: 'clear', description: 'Reset', argumentHint: null, builtin: false }] });
    expect(events[2]).toMatchObject({ trigger: 'auto', preTokens: 100, postTokens: null, logicalParentUuid: null, historical: false });
    expect(events[4]).toMatchObject({ retractedMessageUuids: ['m-1'], fallbackModel: 'b', reason: 'refused' });
    expect(events[5]).toMatchObject({ retractedMessageUuids: [], fallbackModel: null });
    expect(events[7]).toMatchObject({ level: 'warning', text: 'classifier usage charged', key: null });
    expect(events[8]).toMatchObject({ level: 'warning', key: 'k' });
    expect(events[9]).toMatchObject({ level: 'info', key: 'k2' });
    expect(events[10]).toMatchObject({ level: 'info', key: 'permission_denied:toolu_1', text: 'denied' });
    expect(events[12]).toMatchObject({ outcome: 'success', exitCode: 0, stdout: 'out', stderr: '' });
    expect(events[13]).toMatchObject({ taskId: 'ag-1', toolUseId: 'toolu_1', subagentType: 'general-purpose', isBackground: true, spawnDepth: 1, prompt: 'p', agentId: 'ag-1' });
    expect(events[14]).toMatchObject({ taskId: 'wf-1', taskType: 'local_workflow', workflowName: 'probe', isBackground: false });
    expect(events[15]).toMatchObject({ usage: { totalTokens: 1, toolUses: 1, durationMs: 2 }, lastToolName: 'Read', summary: null });
    expect(events[16]).toMatchObject({ taskId: 'wf-1', workflowName: 'probe', progress: [{ type: 'workflow_phase', index: 1 }] });
    expect(events[17]).toMatchObject({ patch: { status: 'completed', endTime: 5 } });
    expect(events[18]).toMatchObject({ status: 'completed', summary: 'ONE', outputFile: '/o', reason: null });
    expect(events[19]).toMatchObject({ status: 'stopped', outputFile: null, toolUseId: 'toolu_2' });
    expect(events[20]).toMatchObject({ tasks: [{ taskId: 'ag-1', taskType: 'local_agent', description: 'Read', ambient: false }] });
    expect(events[21]).toMatchObject({ frameType: 'system', subtype: 'turn_starting' });
    expect(events[23]).toMatchObject({ toolUseId: 'toolu_1', elapsedSeconds: 2.5, taskId: null, heartbeat: false });
    expect(events[24]).toMatchObject({ frameType: 'brand_new_frame', subtype: null });
    expect(events[25]).toMatchObject({ scope: 'transport', code: 'invalid_frame' });
  });

  it('an unknown denial kind maps to null with a warning', () => {
    const warn = vi.fn();
    const events = feed(make({ warn }), [inRow({ type: 'user', uuid: 'r', session_id: 'sess-1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] }, tool_result_meta: [{ id: 't', non_execution_kind: 'novel-kind' }] })]);
    expect(events[0]).toMatchObject({ kind: 'tool.result', denial: null });
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'unknown_denial_kind' }));
  });
});

describe('normaliser: aborted and supersedes on assistant.block.complete (debt wave 3)', () => {
  const assistantFrame = (extra: Record<string, unknown>) => ({
    type: 'assistant', uuid: 'a-1', session_id: 'sess-1', parent_tool_use_id: null,
    message: { id: 'msg_1', model: 'm', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'partial' }] }, ...extra,
  });

  it("carries the wire's aborted flag, and false when the frame has none", () => {
    expect(feed(make(), [inRow(assistantFrame({ aborted: true }))])[0]).toMatchObject({ kind: 'assistant.block.complete', aborted: true });
    expect(feed(make(), [inRow(assistantFrame({}))])[0]).toMatchObject({ kind: 'assistant.block.complete', aborted: false });
  });

  // synthetic until a live refusal fallback is recorded (debt wave 4): the wire names every block frame of the refused
  // attempt on the replacement's first frame only (SPEC 45)
  it("carries the wire's supersedes list as sent, and an empty list when the frame has none", () => {
    const events = feed(make(), [inRow(assistantFrame({ supersedes: ['old-1', 'old-2'] })), inRow(assistantFrame({ uuid: 'a-2' }))]);
    expect(events[0]).toMatchObject({ kind: 'assistant.block.complete', messageUuid: 'a-1', supersedes: ['old-1', 'old-2'] });
    expect(events[1]).toMatchObject({ kind: 'assistant.block.complete', messageUuid: 'a-2', supersedes: [] });
  });
});

describe('normaliser: context.sample (debt wave 3)', () => {
  // pass3/context-sample seq 51 and 53: the read C3's session issues at a turn's end, and the engine's answer
  const journal = loadJournal('pass3', 'context-sample');
  const request = journal.find((r) => r.seq === 51)!.frame as { request_id: string; request: { subtype: string } };
  const recorded = (journal.find((r) => r.seq === 53)!.frame as { response: { response: Record<string, unknown> } }).response.response;
  const answer = (payload: unknown, requestId = request.request_id) => inRow({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: payload } });

  it("turns a get_context_usage answer into context.sample with the engine's figures, the total from the measured input when the estimate swallows the messages", () => {
    expect(request.request.subtype).toBe('get_context_usage');
    const events = feed(make(), [outRow(request), answer(recorded)]);
    expect(events).toHaveLength(1);
    // the engine answered 30,304 (15 %) with `Messages` at 1; the last response read 10 + 9,232 + 12,252 input-side tokens
    expect(recorded).toMatchObject({ totalTokens: 30304, percentage: 15, apiUsage: { input_tokens: 10, cache_creation_input_tokens: 9232, cache_read_input_tokens: 12252 } });
    expect(events[0]).toMatchObject({
      kind: 'context.sample', seq: 2, parentToolUseId: null, agentId: null,
      totalTokens: 21495, maxTokens: 200000, percentage: 11, autoCompactThreshold: 167000, isAutoCompactEnabled: true, model: 'claude-haiku-4-5-20251001',
    });
  });

  it("keeps the engine's total before any response (no apiUsage) and once the measured input passes its estimate", () => {
    const noResponse = { ...recorded, apiUsage: null };
    expect(feed(make(), [outRow(request), answer(noResponse)])[0]).toMatchObject({ totalTokens: 30304, percentage: 15 });
    // pass3/context-full seq 311: 41,880 with `Messages` at 11,576 over a measured 41,878, so the engine's total stands
    const later = loadJournal('pass3', 'context-full').find((r) => r.seq === 311)!.frame as { response: { response: Record<string, unknown> } };
    expect(feed(make(), [outRow(request), answer(later.response.response)])[0]).toMatchObject({ totalTokens: 41880, percentage: 21 });
  });

  // Synthetic (no fixture reaches the window): the engine clamps the Messages row to the window, never its total
  // (SPEC 13.18.2), so the floor's excess comes from the non-message categories, not from total less Messages.
  it('a clamped Messages row keeps the appended estimate: the total less the floor excess, past 100 %', () => {
    const categories = [
      { name: 'System prompt', tokens: 8000, kind: 'used' }, { name: 'System tools', tokens: 22000, kind: 'used' },
      { name: 'System tools (deferred)', tokens: 23000, kind: 'deferred' }, { name: 'Messages', tokens: 170000, kind: 'used' }, { name: 'Free space', tokens: 0, kind: 'free' },
    ];
    // non-message 30,000, measured 21,000, 185,000 appended since: the engine reports 215,000 with Messages at 170,000
    const clamped = { ...recorded, categories, totalTokens: 215000, percentage: 108, apiUsage: { input_tokens: 0, cache_creation_input_tokens: 1000, cache_read_input_tokens: 20000, output_tokens: 10 } };
    expect(feed(make(), [outRow(request), answer(clamped)])[0]).toMatchObject({ totalTokens: 206000, percentage: 103 });
  });

  it('samples nothing from an error, an answer without the figures, or an answer to another read', () => {
    expect(feed(make(), [outRow(request), inRow({ type: 'control_response', response: { subtype: 'error', request_id: request.request_id, error: 'boom' } })])).toEqual([]);
    expect(feed(make(), [outRow(request), answer({})])).toEqual([]); // a replay's empty answer to a read it never recorded
    const usage = { type: 'control_request', request_id: 'r-usage', request: { subtype: 'get_usage' } };
    expect(feed(make(), [outRow(usage), answer(recorded, 'r-usage')])).toEqual([]);
  });

  it('a missing auto-compact threshold samples as null', () => {
    const rest: Record<string, unknown> = { ...recorded };
    delete rest.autoCompactThreshold;
    expect(feed(make(), [outRow(request), answer(rest)])[0]).toMatchObject({ kind: 'context.sample', autoCompactThreshold: null });
  });
});

// R1 (charter D-9 as amended 2026-10-01): the engine's remote-surface pushes and init's plugin load issues, over the R0
// fixtures recorded on the installed 2.1.287 (pass3/mods-*), and over a synthetic init (no fixture loads a broken plugin).
describe('normaliser: plugin pushes and load issues (R1)', () => {
  const pluginEvents = (events: SessionEvent[]) => events.filter((e) => e.kind.startsWith('plugin.'));
  const replay = (name: string) => {
    const n = make({ sessionId: null });
    const events: SessionEvent[] = [];
    for (const row of loadJournal('pass3', name)) for (const e of n.push(row)) events.push(SessionEventSchema.parse(e));
    return events;
  };

  it('pass3/mods-pushes: the session.start pushes before the initialize answer, the turn.complete pair after the result, in arrival order', () => {
    const events = replay('mods-pushes');
    expect(pluginEvents(events).map((e) => [e.seq, e.kind, 'text' in e ? e.text : null])).toEqual([
      [4, 'plugin.log', 'MODS_PROBE_LOG start surface=null interactive=false'],
      [5, 'plugin.status', 'MODS_PROBE_STATUS start'],
      [6, 'plugin.toast', 'MODS_PROBE_TOAST start'],
      [30, 'plugin.log', 'MODS_PROBE_LOG turn'],
      [31, 'plugin.status', 'MODS_PROBE_STATUS turn'],
    ]);
    expect(pluginEvents(events).every((e) => 'plugin' in e && e.plugin === 'mods-probe' && e.sessionId === '43dea5ed-a8db-41ca-8424-75ab7a3450a6' && e.parentToolUseId === null)).toBe(true);
    expect(only(events, 'plugin.toast')).toMatchObject([{ timeoutMs: 4000 }]);
    // the turn's log and status arrive after its result: the turn has ended, so they sit after it, not in it
    expect(kinds(events).indexOf('turn.ended')).toBeLessThan(events.findIndex((e) => e.seq === 30));
    expect(only(events, 'frame.unknown')).toEqual([]);
  });

  it('pass3/mods-consent: the invalidate a mod load sends carries its render event; the turn toast arrives too', () => {
    const events = replay('mods-consent');
    expect(only(events, 'plugin.invalidate').map((e) => [e.seq, e.event])).toEqual([[12, 'ui.render']]);
    expect(only(events, 'plugin.toast').map((e) => e.text)).toEqual(expect.arrayContaining(['MODS_PROBE_TOAST start', 'MODS_PROBE_TOAST turn']));
    expect(only(events, 'plugin.log').map((e) => e.text)).toContain("loaded from this session's mods folder");
  });

  it("a status of null or '' is the plugin's line removed; a toast without a time takes the engine's default", () => {
    const sys = (subtype: string, extra: Record<string, unknown>) => inRow({ type: 'system', subtype, plugin: 'p', session_id: 'sess-1', uuid: `u-${subtype}`, ...extra });
    const events = feed(make(), [sys('ui_status', { text: null }), sys('ui_status', {}), sys('ui_status', { text: '' }), sys('ui_toast', { text: 'hey' }), sys('ui_invalidate', {})]);
    expect(events.map((e) => [e.kind, 'text' in e ? e.text : null])).toEqual([['plugin.status', ''], ['plugin.status', ''], ['plugin.status', ''], ['plugin.toast', 'hey'], ['plugin.invalidate', null]]);
    expect(only(events, 'plugin.toast')[0]).toMatchObject({ timeoutMs: 4000 });
    expect(only(events, 'plugin.invalidate')[0]).toMatchObject({ event: null });
  });

  it("a push without its plugin is not understood: the transport's invalid_frame, never a nameless plugin line", () => {
    const events = feed(make(), [inRow({ type: 'system', subtype: 'ui_log', text: 'x', session_id: 'sess-1' })]);
    expect(events).toMatchObject([{ kind: 'error.raised', code: 'invalid_frame' }]);
  });

  it("init's plugin errors then warnings become plugin.load_issue inside the turn the init opens; 2.1.287's nulls and a child's init make none", () => {
    const issues = {
      plugin_errors: [{ plugin: 'broken@market', type: 'hook-load-failed', message: 'hooks module failed to compile' }, { plugin: 'inline[0]', type: 'path-not-found', message: 'missing', path: '/x' }],
      plugin_warnings: [{ plugin: 'shadowed@market', type: 'shadowed-folder', message: 'commands/ shadowed by the manifest' }],
    };
    const events = feed(make(), [inRow({ ...initFrame, ...issues })]);
    expect(kinds(events)).toEqual(['session.init', 'turn.started', 'plugin.load_issue', 'plugin.load_issue', 'plugin.load_issue']);
    expect(only(events, 'plugin.load_issue').map(({ plugin, level, message }) => ({ plugin, level, message }))).toEqual([
      { plugin: 'broken@market', level: 'error', message: 'hooks module failed to compile' },
      { plugin: 'inline[0]', level: 'error', message: 'missing' },
      { plugin: 'shadowed@market', level: 'warning', message: 'commands/ shadowed by the manifest' },
    ]);
    expect(kinds(feed(make(), [inRow({ ...initFrame, plugin_errors: null, plugin_warnings: null })]))).toEqual(['session.init', 'turn.started']);
    const child = feed(make(), [inRow({ ...initFrame, ...issues, parent_tool_use_id: 'toolu_parent' })]);
    expect(kinds(child)).toEqual(['session.init']);
  });

  it("a human turn's init carries its issues into that turn, after the turn opened", () => {
    const events = feed(make(), [outRow(userOut('u-1')), startedIn('u-1'), inRow({ ...initFrame, plugin_warnings: [{ plugin: 'p', type: 't', message: 'm' }] })]);
    expect(kinds(events)).toEqual(['user.message', 'command.lifecycle', 'turn.started', 'session.init', 'plugin.load_issue']);
  });
});

it('preserves API-error envelope identity and code on completed blocks', () => {
  const events = feed(make(), [inRow({
    type: 'assistant', session_id: SESSION, uuid: 'api-error-envelope', parent_tool_use_id: null,
    isApiErrorMessage: true, error: 'authentication_failed',
    message: { id: 'msg-api-error', type: 'message', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'Authentication unavailable.' }], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
  })]);
  expect(only(events, 'assistant.block.complete')).toEqual([
    expect.objectContaining({ isApiErrorMessage: true, error: 'authentication_failed', block: { type: 'text', text: 'Authentication unavailable.' } }),
  ]);
});

// E1 (residue 1's admission rule, M2 fix wave): a `maws` tools/call is mapped only when the server would serve it, on
// the same reading of the envelope (src/shared/maws/rpc.ts): a message that is not JSON-RPC 2.0 is answered -32600 and
// one whose id is neither a string nor a number is taken as a notification, so neither opens an ask nor records a
// delivery or a pane, whatever the arguments.
describe('maws tools/call admission follows the server envelope (E1)', () => {
  const ASK = { questions: [{ question: 'Proceed?', modality: 'choice', options: [{ label: 'Yes' }] }] };
  const call = (requestId: string, message: Record<string, unknown>) => inRow({ type: 'control_request', request_id: requestId, request: { subtype: 'mcp_message', server_name: 'maws', message } });
  const answer = (requestId: string, id: unknown, result: unknown) => outRow({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { mcp_response: { jsonrpc: '2.0', id, result } } } });
  const meta = { 'claudecode/toolUseId': 'toolu_a' };

  it('opens a well-formed ask', () => {
    const events = feed(make(), [call('r1', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ask', arguments: ASK, _meta: meta } })]);
    expect(kinds(events)).toEqual(['maws.ask.opened']);
  });

  it('opens no ask for a message that is not JSON-RPC 2.0, nor for an id that is neither a string nor a number', () => {
    const events = feed(make(), [
      call('r1', { jsonrpc: '1.0', id: 1, method: 'tools/call', params: { name: 'ask', arguments: ASK, _meta: meta } }),
      call('r2', { jsonrpc: '2.0', id: { n: 2 }, method: 'tools/call', params: { name: 'ask', arguments: ASK, _meta: meta } }),
      call('r3', { jsonrpc: '2.0', id: null, method: 'tools/call', params: { name: 'ask', arguments: { ...ASK, blocking: false }, _meta: meta } }),
      metaRow({ event: 'maws_ask_cancelled', askId: 'toolu_a', toolUseId: 'toolu_a', reason: 'exit' }),
    ]);
    expect(events.filter((e) => e.kind.startsWith('maws.'))).toEqual([]);
  });

  it('records no delivery and no pane for a send_file or show_pane outside the envelope, even when an answer follows', () => {
    const delivered = { content: [{ type: 'text', text: JSON.stringify({ status: 'delivered', deliverables: [{ id: 'd1', path: '/w/a.txt', name: 'a.txt' }] }) }] };
    const shown = { content: [{ type: 'text', text: JSON.stringify({ status: 'shown', pane: 'terminal', opened: { kind: 'panel-tool', toolId: 'terminal', tabId: 't', title: 'Terminal' } }) }] };
    const events = feed(make(), [
      call('r1', { jsonrpc: '1.0', id: 1, method: 'tools/call', params: { name: 'send_file', arguments: { files: ['a.txt'] } } }),
      answer('r1', 1, delivered),
      call('r2', { jsonrpc: '2.0', id: true, method: 'tools/call', params: { name: 'show_pane', arguments: { pane: 'terminal' } } }),
      answer('r2', 0, shown),
      call('r3', { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'show_pane', arguments: { pane: 'terminal' } } }),
      answer('r3', 3, shown),
    ]);
    expect(kinds(events.filter((e) => e.kind.startsWith('maws.')))).toEqual(['maws.pane.shown']); // the well-formed one alone
  });
});

// E7 start: a message from another session, beside the user.message that carries it (E7 execution document, Design §4,
// over M0's recorded frames: pass3/e7-peer-a and e7-peer-b; C8b's hand-back: test/fixtures/engine/handback-pointer)
describe('peer messages (E7)', () => {
  const replay = (rows: JournalRow[]) => {
    const n = make({ sessionId: null });
    return rows.flatMap((row) => n.push(row).map((event) => SessionEventSchema.parse(event)));
  };
  const peerA = replay(loadJournal('pass3', 'e7-peer-a'));

  it('emits peer.message right after the peer user.message of an idle delivery, the same row and uuid', () => {
    const at = peerA.findIndex((e) => e.kind === 'user.message' && e.seq === 73);
    expect(peerA[at]).toMatchObject({ kind: 'user.message', origin: 'peer', isSynthetic: true });
    expect(peerA[at + 1]).toMatchObject({
      kind: 'peer.message', seq: 73, agentId: null, parentToolUseId: null, messageUuid: 'c2291cea-3cc9-4f6d-bdec-321a085cc0f7', from: 'uds:/tmp/cc-socks/10562.sock',
      fromSession: null, fromName: 'repo-b-gen1il-79', fromMode: 'prompting', fromPlugin: null, hopChain: [], text: 'E7 probe: hello from B', midTurn: false, lineage: 'peer', replyable: true,
    });
  });

  it('emits it for the bare envelope delivered mid-turn, and nowhere else in the session', () => {
    expect(only(peerA, 'peer.message').map((e) => [e.seq, e.midTurn, e.text])).toEqual([[73, false, 'E7 probe: hello from B'], [258, true, 'E7 probe: second message while you work']]);
    expect(only(peerA, 'subagent.message')).toEqual([]);
  });

  it("fills the hop chain from the frame's origin", () => {
    const peerB = replay(loadJournal('pass3', 'e7-peer-b'));
    expect(only(peerB, 'peer.message').map((e) => [e.seq, e.hopChain])).toEqual([[106, ['b4a75fd9e01cdb83eea3f9ee']], [142, []]]);
  });

  it("emits subagent.message for an in-process agent's hand-back", () => {
    const events = replay(loadEngineJournal('handback-pointer'));
    const at = events.findIndex((e) => e.kind === 'user.message' && e.seq === 207);
    expect(events[at + 1]).toMatchObject({ kind: 'subagent.message', seq: 207, direction: 'from_child', fromAgentId: 'a6a89722837fede78', toAgentId: null });
    expect(only(events, 'peer.message')).toEqual([]);
  });

  it('emits nothing beside a peer frame whose text is no envelope', () => {
    const frame = { type: 'user', uuid: 'p-1', session_id: 'sess-1', isReplay: true, isSynthetic: true, message: { role: 'user', content: 'plain words' }, origin: { kind: 'peer', from: 'uds:/x.sock' } };
    expect(kinds(feed(make(), [inRow(frame)]))).toEqual(['user.message']);
  });
});
// E7 end
