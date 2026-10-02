import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { AgentId, MessageUuid, ParentToolUseId, SessionId } from '@shared/graph/ids';
import { AgentMetaSchema, currentChain, parseTranscriptRecord, type TranscriptRecord } from '@shared/wire/transcript';
import { FIXTURE_DIR, loadTranscript, loadTranscriptFixture } from '../../../test/support/fixtures';
import { recordedReceiptRecord } from '../../../test/support/agents-events';
import { createBackfillContext, recordToEvents, SPILL_MARKER, startsTurn, type BackfillContext, type SubagentLookup } from './backfill';

const SESSION = 'S' as SessionId;
const SIDECAR_DIR = join(FIXTURE_DIR, 'subagent-sidecars');
const SIDECAR_IDS = ['ad286defbc77bc090', 'ae75ba6ce5d866acc'];

const rec = (record: Record<string, unknown>): TranscriptRecord => parseTranscriptRecord(record);
const at = (n: number) => `2026-09-28T10:00:${String(n).padStart(2, '0')}.000Z`;

function mapAll(records: TranscriptRecord[], ctx: BackfillContext = createBackfillContext({ sessionId: SESSION, agent: null })): SessionEvent[] {
  const events = records.flatMap((record) => recordToEvents(record, ctx));
  for (const event of events) expect(SessionEventSchema.parse(event)).toEqual(event);
  return events;
}

const kinds = (events: SessionEvent[]) => events.map((e) => e.kind);
const only = <K extends SessionEvent['kind']>(events: SessionEvent[], kind: K) => events.filter((e): e is Extract<SessionEvent, { kind: K }> => e.kind === kind);

// A lookup over the probe's sidecar fixtures, the shape M3's subagents reader will provide.
function fixtureSubagents(): SubagentLookup {
  const entries = SIDECAR_IDS.map((agentId) => {
    const meta = AgentMetaSchema.parse(JSON.parse(readFileSync(join(SIDECAR_DIR, `agent-${agentId}.meta.json`), 'utf8')));
    const first = loadTranscript(`subagent-sidecars/agent-${agentId}.jsonl`)[0];
    const prompt = (first.message as { content: unknown }).content;
    return { agentId: agentId as AgentId, meta, prompt: typeof prompt === 'string' ? prompt : null };
  });
  return { byToolUseId: (toolUseId) => entries.find((e) => e.meta.toolUseId === toolUseId) ?? null };
}

describe('transcript records map to X1 events', () => {
  it('starts the session at the first record carrying a cwd, once, with a deterministic id', () => {
    const ctx = createBackfillContext({ sessionId: SESSION, agent: null });
    const first = recordToEvents(rec({ type: 'attachment', uuid: 'x1', parentUuid: null, timestamp: at(0), attachment: { type: 'environment' } }), ctx);
    expect(first).toEqual([]); // no cwd yet, and attachments carry no events
    const second = recordToEvents(rec({ type: 'user', uuid: 'u1', parentUuid: 'x1', cwd: '/d', version: '2.1.283', forkedFrom: 'other', timestamp: at(1), message: { role: 'user', content: 'Hi' } }), ctx);
    expect(kinds(second)).toEqual(['session.started', 'turn.started', 'user.message']);
    expect(second[0]).toMatchObject({ id: 'session:S:started', kind: 'session.started', cwd: '/d', engineVersion: '2.1.283', resumedFrom: null, forked: true, at: at(1) });
    expect(second[1].id).toBe('u1');
    expect(second[2].id).toBe('u1#1');
    const third = recordToEvents(rec({ type: 'user', uuid: 'u2', parentUuid: 'u1', cwd: '/d', timestamp: at(2), message: { role: 'user', content: 'Again' } }), ctx);
    expect(kinds(third)).toEqual(['turn.started', 'user.message']);
    for (const event of [...first, ...second, ...third]) {
      expect(event.seq).toBeNull();
      expect(event.sessionId).toBe(SESSION);
      expect(event.agentId).toBeNull();
      expect(event.parentToolUseId).toBeNull();
    }
  });

  it('maps user text, meta text and bash-tagged text', () => {
    const events = mapAll([
      rec({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'Remember APPLE.' } }),
      rec({ type: 'user', uuid: 'u2', parentUuid: 'u1', isMeta: true, timestamp: at(1), message: { role: 'user', content: '<system-reminder>x</system-reminder>' } }),
      rec({ type: 'user', uuid: 'u3', parentUuid: 'u2', timestamp: at(2), message: { role: 'user', content: '<bash-input>printf OK</bash-input>' } }),
      rec({ type: 'user', uuid: 'u4', parentUuid: 'u3', timestamp: at(3), message: { role: 'user', content: '<bash-stdout>OK</bash-stdout><bash-stderr>warn</bash-stderr><bash-exit-code>3</bash-exit-code>' } }),
    ]);
    expect(kinds(events)).toEqual(['session.started', 'turn.started', 'user.message', 'user.message', 'turn.started', 'user.message', 'turn.started', 'user.message']);
    const messages = only(events, 'user.message');
    expect(messages[0]).toMatchObject({ messageUuid: 'u1', content: 'Remember APPLE.', isReplay: false, isSynthetic: false, origin: null, bash: null });
    expect(messages[1]).toMatchObject({ messageUuid: 'u2', isSynthetic: true });
    // C1's derivation rule: the tags are stripped from the content and `bash` is filled.
    expect(messages[2].bash).toEqual({ part: 'input', command: 'printf OK' });
    expect(messages[2].content).toBe('printf OK');
    expect(messages[3].bash).toEqual({ part: 'output', stdout: 'OK', stderr: 'warn', exitCode: 3 });
    expect(messages[3].content).toBe('OK\nwarn');
    expect(only(events, 'turn.started').map((e) => e.userMessageUuid)).toEqual(['u1', 'u3', 'u4']);
  });

  it('maps tool results with the spill path from the structured field, else the marker', () => {
    const spill = '/Users/new/.claude/projects/-x/e3ce/tool-results/b95u0622n.txt';
    const events = mapAll([
      rec({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'go' } }),
      rec({ type: 'user', uuid: 'r1', parentUuid: 'u1', timestamp: at(1), toolUseResult: { stdout: 'x', persistedOutputPath: spill },
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Output too large (29.7KB). Full output saved to: /elsewhere/other.txt', is_error: false }] } }),
      rec({ type: 'user', uuid: 'r2', parentUuid: 'r1', timestamp: at(2),
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: [{ type: 'text', text: 'Results were saved to /tmp/x/tool-results/toolu_2.json for later.' }], is_error: true }] } }),
      rec({ type: 'user', uuid: 'r3', parentUuid: 'r2', timestamp: at(3),
        message: { role: 'user', content: [{ type: 'text', text: 'and a note' }, { type: 'tool_result', tool_use_id: 'toolu_3', content: 'fine' }] } }),
    ]);
    const results = only(events, 'tool.result');
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ id: 'r1', toolUseId: 'toolu_1', isError: false, spillPath: spill, denial: null, safeguard: 'not_evaluated', messageUuid: 'r1' });
    expect(results[0].structured).toEqual({ stdout: 'x', persistedOutputPath: spill });
    expect(results[1]).toMatchObject({ toolUseId: 'toolu_2', isError: true, spillPath: '/tmp/x/tool-results/toolu_2.json', structured: null });
    expect(results[2]).toMatchObject({ toolUseId: 'toolu_3', spillPath: null });
    // A user record with text beside a tool result is also a message, and a turn.
    const tail = events.filter((e) => e.id.startsWith('r3'));
    expect(kinds(tail)).toEqual(['turn.started', 'user.message', 'tool.result']);
    expect(only(tail, 'user.message')[0].content).toEqual([{ type: 'text', text: 'and a note' }]);
    // A record that is only tool results is not a turn.
    expect(kinds(events.filter((e) => e.id.startsWith('r1')))).toEqual(['tool.result']);
  });

  it('matches the three engine spill strings and captures the path', () => {
    expect(SPILL_MARKER.exec('Output too large (29.7KB). Full output saved to: /a/b/tool-results/x.txt')?.[1]).toBe('/a/b/tool-results/x.txt');
    expect(SPILL_MARKER.exec('Results were saved to /tmp/x/r.json (12 KB)')?.[1]).toBe('/tmp/x/r.json');
    expect(SPILL_MARKER.exec('The full output was saved to: /tmp/x/out.txt.')?.[1]).toBe('/tmp/x/out.txt');
    expect(SPILL_MARKER.exec('nothing here')).toBeNull();
  });

  it('maps assistant blocks by apiBlockIndex, folding a multi-block record by index, with tool.use beside tool_use blocks', () => {
    const message = (content: unknown[]) => ({ id: 'msg_1', model: 'claude-sonnet-5', role: 'assistant', content });
    const events = mapAll([
      rec({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'go' } }),
      rec({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', apiBlockIndex: 0, timestamp: at(1), message: message([{ type: 'thinking', thinking: '…' }]) }),
      rec({ type: 'assistant', uuid: 'a2', parentUuid: 'a1', apiBlockIndex: 1, timestamp: at(2), message: message([{ type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/f' } }]) }),
      rec({ type: 'assistant', uuid: 'a3', parentUuid: 'a2', timestamp: at(3), message: message([{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }]) }),
      rec({ type: 'assistant', uuid: 'a4', parentUuid: 'a3', apiBlockIndex: 5, timestamp: at(4), message: message([{ type: 'text', text: 'five' }, { type: 'text', text: 'six' }]) }),
    ]);
    const blocks = only(events, 'assistant.block.complete');
    expect(blocks.map((b) => [b.messageUuid, b.blockIndex, b.block.type])).toEqual([
      ['a1', 0, 'thinking'], ['a2', 1, 'tool_use'], ['a3', 0, 'text'], ['a3', 1, 'text'], ['a4', 5, 'text'], ['a4', 6, 'text'],
    ]);
    expect(blocks[0]).toMatchObject({ apiMessageId: 'msg_1', model: 'claude-sonnet-5', supersedes: [], aborted: false, userMessageUuids: [] });
    expect(blocks.map((b) => b.id)).toEqual(['a1', 'a2', 'a3', 'a3#1', 'a4', 'a4#1']);
    const uses = only(events, 'tool.use');
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({ id: 'a2#1', toolUseId: 'toolu_1', toolName: 'Read', input: { file_path: '/f' }, apiMessageId: 'msg_1', messageUuid: 'a2' });
    expect(kinds(events.filter((e) => e.id.startsWith('a2')))).toEqual(['assistant.block.complete', 'tool.use']);
  });

  it('maps system records: compaction, turn duration, local commands, and the rest as unknown frames', () => {
    const events = mapAll([
      rec({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'go' } }),
      rec({ type: 'system', subtype: 'turn_duration', uuid: 's1', parentUuid: 'u1', durationMs: 1234, timestamp: at(1) }),
      rec({ type: 'system', subtype: 'local_command', uuid: 's2', parentUuid: 's1', content: '<command-name>/help</command-name>', timestamp: at(2) }),
      rec({ type: 'system', subtype: 'stop_hook_summary', uuid: 's3', parentUuid: 's2', timestamp: at(3) }),
      rec({ type: 'system', subtype: 'compact_boundary', uuid: 's4', parentUuid: null, logicalParentUuid: 's3', compactMetadata: { trigger: 'auto', preTokens: 150000 }, timestamp: at(4) }),
      rec({ type: 'system', subtype: 'compact_boundary', uuid: 's5', parentUuid: 's4', compactMetadata: { trigger: 'manual' } }),
      rec({ type: 'mystery', uuid: 'm1', parentUuid: 's5', timestamp: at(6) }),
      rec({ type: 'attachment', uuid: 'x1', parentUuid: 'm1', attachment: { type: 'model' }, timestamp: at(7) }),
    ]);
    expect(kinds(events)).toEqual([
      'session.started', 'turn.started', 'user.message', 'turn.ended', 'notice.posted', 'frame.unknown', 'boundary.compaction', 'boundary.compaction', 'frame.unknown',
    ]);
    const ended = only(events, 'turn.ended')[0];
    expect(ended).toMatchObject({
      id: 's1', result: 'success', isError: false, terminalReason: null, resultText: null, durationMs: 1234, numTurns: 1, costUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: null },
      permissionDenials: [], errors: [], userMessageUuids: ['u1'], origin: null, resultIndex: null, isEchoReceipt: false,
    });
    expect(only(events, 'notice.posted')[0]).toMatchObject({ level: 'info', text: '<command-name>/help</command-name>', key: 'local_command' });
    const unknown = only(events, 'frame.unknown');
    expect(unknown[0]).toMatchObject({ id: 's3', frameType: 'transcript:system', subtype: 'stop_hook_summary' });
    expect(unknown[1]).toMatchObject({ id: 'm1', frameType: 'transcript:mystery', subtype: null });
    const compactions = only(events, 'boundary.compaction');
    expect(compactions[0]).toMatchObject({ trigger: 'auto', preTokens: 150000, postTokens: null, logicalParentUuid: 's3', historical: true, at: at(4) });
    expect(compactions[1]).toMatchObject({ trigger: 'manual', preTokens: 0, logicalParentUuid: null, at: at(4) }); // no timestamp: the previous event's `at`
  });

  // C6's second whole-branch-review ask: the marker the engine writes after an interrupt is an ordinary `user` record on
  // disk; it belongs to the interrupted turn, as C3's normaliser tags it on the wire, and opens none.
  it('an interrupt marker, string or array form, is a user.message tagged interrupt-marker that opens no turn', () => {
    const events = mapAll([
      rec({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'go' } }),
      rec({ type: 'user', uuid: 'm1', parentUuid: 'u1', timestamp: at(1), message: { role: 'user', content: '[Request interrupted by user]' } }),
      rec({ type: 'user', uuid: 'm2', parentUuid: 'm1', timestamp: at(2), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }),
      rec({ type: 'user', uuid: 'm3', parentUuid: 'm2', timestamp: at(3), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'stopped', is_error: true }, { type: 'text', text: '[Request interrupted by user for tool use]' }] } }),
      rec({ type: 'user', uuid: 'u2', parentUuid: 'm3', timestamp: at(4), message: { role: 'user', content: 'Not a marker: [Request interrupted by user]' } }),
    ]);
    expect(only(events, 'turn.started').map((e) => e.userMessageUuid)).toEqual(['u1', 'u2']);
    expect(only(events, 'user.message').map((e) => [e.messageUuid, e.origin, e.isSynthetic])).toEqual([
      ['u1', null, false], ['m1', 'interrupt-marker', false], ['m2', 'interrupt-marker', false], ['m3', 'interrupt-marker', false], ['u2', null, false],
    ]);
    expect(only(events, 'tool.result').map((e) => e.toolUseId)).toEqual(['t1']);
    expect(startsTurn(rec({ type: 'user', uuid: 'm1', parentUuid: 'u1', message: { role: 'user', content: '[Request interrupted by user]' } }))).toBe(false);
  });

  it('the marker-carrying transcript from the owner\'s store: the turn count does not grow at the marker', () => {
    const records = currentChain(loadTranscriptFixture('interrupt-marker')).chain;
    const markerAt = records.findIndex((record) => JSON.stringify(record.message ?? null).includes('[Request interrupted by user]'));
    expect(records[markerAt].uuid).toMatch(/^ae320688/);
    const ctx = createBackfillContext({ sessionId: SESSION, agent: null });
    const before = mapAll(records.slice(0, markerAt), ctx);
    const atMarker = mapAll([records[markerAt]], ctx);
    expect(only(before, 'turn.started').map((e) => e.userMessageUuid?.slice(0, 8))).toEqual(['1354a3a3']);
    expect(kinds(atMarker)).toEqual(['user.message']);
    expect(atMarker[0]).toMatchObject({ origin: 'interrupt-marker', isSynthetic: false, content: [{ type: 'text', text: '[Request interrupted by user]' }] });
  });
});

// Debt wave 4: the relay's receipt in a live child's transcript (pass3/relay-to-child, R1's idle and busy cases).
describe("a coordinator's queued_command attachment in a child's transcript", () => {
  const child = (agentId: string) => createBackfillContext({ sessionId: SESSION, agent: { agentId: agentId as AgentId, parentToolUseId: 'toolu_019WWfE6Ry9diHmJymKAtX7Q' as ParentToolUseId } });

  it.each(['idle', 'busy'] as const)('the recorded %s receipt is a synthetic user.message with the relayed text, opening no turn', (kase) => {
    const record = recordedReceiptRecord(kase);
    const events = mapAll([rec(record)], child(record.agentId as string));
    const messages = only(events, 'user.message');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: `stand-in-receipt-${kase}`, messageUuid: `stand-in-receipt-${kase}`, content: kase === 'idle' ? 'Say PING in your next inbox line' : 'Say PONG in your next inbox line',
      isSynthetic: true, origin: 'coordinator', agentId: record.agentId, parentToolUseId: 'toolu_019WWfE6Ry9diHmJymKAtX7Q', seq: null, at: record.timestamp,
    });
    expect(only(events, 'turn.started')).toEqual([]);
  });

  it('stays unshown in the main transcript, and for any other attachment or origin', () => {
    const record = recordedReceiptRecord('idle');
    expect(only(mapAll([rec(record)]), 'user.message')).toEqual([]);
    const attachment = record.attachment as Record<string, unknown>;
    const variants = [{ ...attachment, origin: { kind: 'human' } }, { ...attachment, type: 'environment' }, { ...attachment, prompt: undefined }];
    for (const variant of variants) expect(only(mapAll([rec({ ...record, attachment: variant })], child(record.agentId as string)), 'user.message')).toEqual([]);
  });
});

// W1: a prompt the engine took into the running turn is only a `queued_command` attachment in the main transcript
// (w1-steer-next-disk line 32, a stream-json `next` steer; w1-terminal-queued line 26, a prompt the terminal queued).
describe('a human queued_command attachment in the main transcript is a steer', () => {
  const steerOf = (name: string) => loadTranscriptFixture(name).find((record) => record.type === 'attachment' && (record.attachment as { type?: string }).type === 'queued_command')!;

  it.each([['w1-steer-next-disk', 'Reply NEXT_OK'], ['w1-terminal-queued', 'Reply TERMINAL_QUEUED']])('%s: the prompt under its own uuid, then the engine’s started for it, and no turn of its own', (name, text) => {
    const record = steerOf(name);
    const sourceUuid = (record.attachment as { source_uuid: string }).source_uuid;
    const events = mapAll([record]);
    expect(kinds(events)).toEqual(['session.started', 'user.message', 'command.lifecycle']);
    expect(only(events, 'user.message')[0]).toMatchObject({ id: record.uuid, messageUuid: sourceUuid, content: text, isSynthetic: false, origin: null, bash: null, seq: null });
    expect(only(events, 'command.lifecycle')[0]).toMatchObject({ id: `${record.uuid as string}#1`, commandUuid: sourceUuid, state: 'started' });
    expect(only(events, 'turn.started')).toEqual([]);
  });

  it('a meta one, or one of another origin or mode, stays a context injection', () => {
    const record = steerOf('w1-steer-next-disk');
    const attachment = record.attachment as Record<string, unknown>;
    for (const variant of [{ ...attachment, isMeta: true }, { ...attachment, origin: { kind: 'task-notification' } }, { ...attachment, commandMode: 'bash' }, { ...attachment, source_uuid: undefined }]) {
      expect(only(mapAll([rec({ ...record, attachment: variant })]), 'user.message')).toEqual([]);
    }
  });
});

// W1 (A5): `/compact` on disk (w1-compact.jsonl lines 28-32): the boundary with both token counts, the summary as a
// synthetic message opening no turn, the caveat as meta, the command's record opening its turn, and its output
// joining that turn.
describe('a /compact on disk', () => {
  it('maps the five records the way the live stream shows them', () => {
    const records = loadTranscriptFixture('w1-compact');
    const at = records.findIndex((record) => record.type === 'system' && record.subtype === 'compact_boundary');
    const events = mapAll(records.slice(at, at + 5));
    expect(only(events, 'boundary.compaction')[0]).toMatchObject({ trigger: 'manual', preTokens: 28986, postTokens: 1237, historical: true });
    const messages = only(events, 'user.message');
    expect(messages.map((m) => [m.isSynthetic, String(typeof m.content === 'string' ? m.content : '').slice(0, 24)])).toEqual([
      [true, 'This session is being co'], [true, '<local-command-caveat>Ca'], [false, '<command-name>/compact</'], [false, '<local-command-stdout>Co'],
    ]);
    expect(only(events, 'turn.started').map((e) => e.userMessageUuid)).toEqual([messages[2].messageUuid]); // the command's turn only
    expect(records.slice(at, at + 5).map((record) => startsTurn(record))).toEqual([false, false, false, true, false]);
  });
});

// Debt wave 7: a hook that got in the way, read back from disk as the hook events the live stream has for it. Two
// recorded runs: W1's (a Stop hook blocking by JSON, a UserPromptSubmit hook exiting 2) and the same hooks with the forms
// flipped (a Stop hook exiting 2, UserPromptSubmit hooks blocking by JSON, once with `suppressOriginalPrompt`).
describe('a hook that got in the way, from disk', () => {
  const hookEvents = (events: SessionEvent[]) =>
    events.filter((e) => e.kind === 'hook.started' || e.kind === 'hook.finished').map((e) => (e.kind === 'hook.finished' ? [e.kind, e.hookId, e.hookEvent, e.outcome, e.exitCode, e.stdout, e.stderr] : [e.kind, e.hookId, e.hookEvent]));
  const blockedTurn = (events: SessionEvent[], uuid: string) => events.filter((e) => e.id === uuid || e.id.startsWith(`${uuid}#`)).map((e) => e.kind);

  it('w1-hooks-blocking: the Stop hook’s feedback and the blocked prompt’s informational record carry the blocking hooks', () => {
    const records = loadTranscriptFixture('w1-hooks-blocking');
    const events = mapAll(currentChain(records).chain);
    const FEEDBACK = '3f29bb18-ea4f-4eb4-a015-49679d4e10c8'; // line 24, the meta "Stop hook feedback:" record
    const BLOCKED = 'f2dd3a2b-d9d4-488b-b222-3498876dab20'; // line 31, the system informational record
    expect(hookEvents(events)).toEqual([
      ['hook.started', FEEDBACK, 'Stop'],
      ['hook.finished', FEEDBACK, 'Stop', 'error', 2, '', 'Say REPROMPTED and stop'], // a JSON reason, as it is
      ['hook.started', BLOCKED, 'UserPromptSubmit'],
      ['hook.finished', BLOCKED, 'UserPromptSubmit', 'error', 2, '', 'BLOCKED_BY_TEST_HOOK\n'], // `[<command>]: ` dropped
    ]);
    expect(only(events, 'user.message').find((e) => e.messageUuid === FEEDBACK)).toMatchObject({ isSynthetic: true }); // still no bubble
    expect(blockedTurn(events, BLOCKED)).toEqual(['turn.started', 'user.message', 'hook.started', 'hook.finished', 'turn.ended']);
    expect(only(events, 'user.message').find((e) => e.messageUuid === BLOCKED)).toMatchObject({ content: 'BLOCKME please reply TWO', isSynthetic: false, origin: null });
    expect(only(events, 'turn.ended').find((e) => e.userMessageUuids.includes(BLOCKED as MessageUuid))).toMatchObject({ numTurns: 0, terminalReason: null, isError: false });
    expect(records.filter((record) => startsTurn(record)).map((record) => record.uuid)).not.toContain(BLOCKED);
  });

  it('dw7-hooks-flipped: an exit-2 Stop block loses its command prefix, a JSON prompt block keeps its reason, a suppressed prompt shows none', () => {
    const records = loadTranscriptFixture('dw7-hooks-flipped');
    const events = mapAll(currentChain(records).chain);
    const FEEDBACK = '5b8e4920-0aa4-4bb7-b298-11b6e56e06b4'; // line 24
    const BLOCKED = '8b14220a-e8e9-49f7-a532-94409b48642b'; // line 31
    const QUIET = '110096ee-942e-4117-8ce1-8a874b0e86ce'; // line 35, `suppressOriginalPrompt`
    expect(hookEvents(events).filter(([kind]) => kind === 'hook.finished')).toEqual([
      ['hook.finished', FEEDBACK, 'Stop', 'error', 2, '', 'REPROMPT_BY_EXIT_2\n'],
      ['hook.finished', BLOCKED, 'UserPromptSubmit', 'error', 2, '', 'BLOCKED_BY_JSON_HOOK'],
      ['hook.finished', QUIET, 'UserPromptSubmit', 'error', 2, '', 'QUIET_BLOCK'],
    ]);
    expect(blockedTurn(events, QUIET)).toEqual(['turn.started', 'hook.started', 'hook.finished', 'turn.ended']); // nothing on disk names the prompt
    expect(only(events, 'turn.started').map((e) => e.userMessageUuid)).toEqual(['60842001-6fbc-4b9d-988d-035e5f61b3c8', BLOCKED, QUIET, '185c31b3-7310-4148-899e-fd576ad53957']);
  });

  it('leaves every other meta record and informational record as before', () => {
    const user = (content: string, isMeta: boolean) => rec({ type: 'user', uuid: 'm1', parentUuid: null, isMeta, timestamp: at(0), message: { role: 'user', content } });
    const info = (content: string) => rec({ type: 'system', subtype: 'informational', uuid: 'i1', parentUuid: null, timestamp: at(0), content, level: 'warning' });
    expect(kinds(mapAll([user('Stop hook feedback:\nnot meta', false)]))).toEqual(['turn.started', 'user.message']);
    expect(kinds(mapAll([user('Some other reminder', true)]))).toEqual(['user.message']);
    expect(kinds(mapAll([info('Operation stopped by hook: no')]))).toEqual(['frame.unknown']);
    expect(kinds(mapAll([info('UserPromptExpansion operation blocked by hook:\n[x]: no\n\nOriginal prompt: /cmd')]))).toEqual(['frame.unknown']);
  });

  // The engine writes the same informational record for a queued `next` steer the hook rejects at the mid-turn fold,
  // after the tool results and before the model call, and the turn runs on (2.1.283, from the bundle; not recorded).
  const prompt = rec({ type: 'user', uuid: 'p1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'Count to 1' } });
  const toolUse = rec({ type: 'assistant', uuid: 'a1', parentUuid: 'p1', timestamp: at(1), message: { id: 'msg_1', model: 'x', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'echo 1' } }] } });
  const toolResult = (extra: unknown[] = []) => rec({ type: 'user', uuid: 'r1', parentUuid: 'a1', timestamp: at(2), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '1' }, ...extra] } });
  const blocked = (uuid: string, parentUuid: string, content: string) => rec({ type: 'system', subtype: 'informational', uuid, parentUuid, timestamp: at(3), content, level: 'warning' });
  const STEER = 'UserPromptSubmit operation blocked by hook:\nNO_STEERS\n\nOriginal prompt: Reply STEER';
  const answer = rec({ type: 'assistant', uuid: 'a2', parentUuid: 'b2', timestamp: at(4), message: { id: 'msg_2', model: 'x', content: [{ type: 'text', text: 'COUNTED' }] } });

  it('a steer the hook rejected at the mid-turn fold joins the running turn, which it neither starts nor ends', () => {
    const events = mapAll([prompt, toolUse, toolResult(), blocked('b1', 'r1', STEER), blocked('b2', 'b1', 'UserPromptSubmit operation blocked by hook:\nQUIET'), answer]);
    expect(blockedTurn(events, 'b1')).toEqual(['user.message', 'command.lifecycle', 'hook.started', 'hook.finished']); // steeredPrompt's shape, then the hook
    expect(blockedTurn(events, 'b2')).toEqual(['command.lifecycle', 'hook.started', 'hook.finished']); // suppressed: no bubble
    expect(only(events, 'user.message').find((e) => e.messageUuid === 'b1')).toMatchObject({ content: 'Reply STEER', isSynthetic: false, origin: null });
    expect(only(events, 'command.lifecycle').map((e) => [e.commandUuid, e.state])).toEqual([['b1', 'started'], ['b2', 'started']]);
    expect(only(events, 'hook.finished').map((e) => [e.hookId, e.hookEvent, e.stderr])).toEqual([['b1', 'UserPromptSubmit', 'NO_STEERS'], ['b2', 'UserPromptSubmit', 'QUIET']]);
    expect(only(events, 'turn.started').map((e) => e.userMessageUuid)).toEqual(['p1']);
    expect(only(events, 'turn.ended')).toEqual([]);
  });

  it('a blocked prompt after an interrupted tool loop is a turn of its own: the marker ends the loop', () => {
    const MARKER = { type: 'text', text: '[Request interrupted by user for tool use]' };
    const standalone = ['turn.started', 'user.message', 'hook.started', 'hook.finished', 'turn.ended'];
    // the marker carried with the tool result
    expect(blockedTurn(mapAll([prompt, toolUse, toolResult([MARKER]), blocked('b1', 'r1', STEER)]), 'b1')).toEqual(standalone);
    // the marker in a record of its own after the rejected tool's result, as 2.1.283 writes it (w1-steer-next-interrupted.jsonl lines 23 and 25)
    const marker = rec({ type: 'user', uuid: 'm1', parentUuid: 'r1', timestamp: at(3), message: { role: 'user', content: [MARKER] } });
    expect(blockedTurn(mapAll([prompt, toolUse, toolResult(), marker, blocked('b1', 'm1', STEER)]), 'b1')).toEqual(standalone);
  });
});

describe('subagent sidecars map to the X1 graph', () => {
  it('produces subagent.started and subagent.finished for both Agent tool uses of the parent transcript', () => {
    const records = loadTranscriptFixture('subagent-parent');
    const { chain, gap } = currentChain(records);
    expect(gap).toBeNull();
    const ctx = createBackfillContext({ sessionId: '9a1d4262-0b43-46ad-acb9-5982f31d209c' as SessionId, agent: null, subagents: fixtureSubagents() });
    const events = mapAll(chain, ctx);
    expect(events[0].kind).toBe('session.started');
    expect(events[0]).toMatchObject({ cwd: '/private/tmp/maws-probe-WmHZ2j', engineVersion: '2.1.283', forked: false });

    const started = only(events, 'subagent.started');
    expect(started.map((e) => [e.taskId, e.toolUseId])).toEqual([
      ['ad286defbc77bc090', 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB'],
      ['ae75ba6ce5d866acc', 'toolu_01A8AmiXuRTeJwjQEsaPE2DM'],
    ]);
    expect(started[0]).toMatchObject({ description: 'Read and report one.txt content', subagentType: 'general-purpose', isBackground: true, spawnDepth: 1 });
    expect(started[0].prompt).toMatch(/^Read the file \/private\/tmp\/maws-probe-WmHZ2j\/one\.txt/);
    // Both agents launched asynchronously: the tool_result is the launch acknowledgement, the <task-notification>
    // user record later in the file is the completion.
    const finished = only(events, 'subagent.finished');
    expect(finished.map((e) => [e.taskId, e.status])).toEqual([['ad286defbc77bc090', 'completed'], ['ae75ba6ce5d866acc', 'completed']]);
    expect(finished[0]).toMatchObject({
      id: '937c424f-3731-4c6c-8d8d-8f70030cc243#2',
      summary: 'ONE',
      outputFile: '/private/tmp/claude-501/-private-tmp-maws-probe-WmHZ2j/9a1d4262-0b43-46ad-acb9-5982f31d209c/tasks/ad286defbc77bc090.output',
      reason: null,
    });
    expect(finished[1].summary).toBe('TWO');
    const notifications = only(events, 'user.message').filter((e) => e.origin === 'task-notification');
    expect(notifications.map((e) => e.messageUuid?.slice(0, 8))).toEqual(['937c424f', 'f8189f73']);
    expect(only(events, 'turn.started').filter((e) => e.origin === 'task-notification')).toHaveLength(2);
    const uses = only(events, 'tool.use');
    expect(uses.map((e) => e.toolName)).toEqual(['Agent', 'Agent']);
    const sequence = events.filter((e) => ['tool.use', 'subagent.started', 'tool.result', 'subagent.finished'].includes(e.kind)).map((e) => e.kind);
    expect(sequence).toEqual(['tool.use', 'subagent.started', 'tool.result', 'tool.use', 'subagent.started', 'tool.result', 'subagent.finished', 'subagent.finished']);
    for (const event of events) expect(event.seq).toBeNull();

    // A transcript ending right after the launch acknowledgements has both agents still unfinished.
    const launchOnly = createBackfillContext({ sessionId: '9a1d4262-0b43-46ad-acb9-5982f31d209c' as SessionId, agent: null, subagents: fixtureSubagents() });
    const truncated = mapAll(chain.slice(0, chain.findIndex((r) => r.uuid?.startsWith('d199932b')) + 1), launchOnly);
    expect(only(truncated, 'subagent.started')).toHaveLength(2);
    expect(only(truncated, 'subagent.finished')).toEqual([]);
  });

  it('a task notification finishes the agent its tool-use id names, with the status mapped and the result as summary', () => {
    const notification = (status: string, extra = '') =>
      `<task-notification>\n<task-id>agent-1</task-id>\n<tool-use-id>toolu_a</tool-use-id>\n<output-file>/tmp/x/tasks/agent-1.output</output-file>\n<status>${status}</status>\n<summary>Agent "d" finished</summary>${extra}\n</task-notification>`;
    const subagents: SubagentLookup = {
      byToolUseId: (id) => (id === 'toolu_a' ? { agentId: 'agent-1' as AgentId, meta: { agentType: 'general-purpose', description: 'd', toolUseId: 'toolu_a', spawnDepth: 1, requestShape: 'background' }, prompt: null } : null),
    };
    const run = (status: string, extra?: string) => {
      const ctx = createBackfillContext({ sessionId: SESSION, agent: null, subagents });
      return mapAll([
        rec({ type: 'user', uuid: 'u1', parentUuid: null, cwd: '/d', timestamp: at(0), message: { role: 'user', content: 'go' } }),
        rec({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: at(1), message: { id: 'm', model: 'x', content: [{ type: 'tool_use', id: 'toolu_a', name: 'Agent', input: {} }] } }),
        rec({ type: 'user', uuid: 'r1', parentUuid: 'a1', timestamp: at(2), toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'agent-1' },
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'Async agent launched successfully.' }] } }),
        rec({ type: 'user', uuid: 'n1', parentUuid: 'r1', timestamp: at(3), message: { role: 'user', content: notification(status, extra) } }),
        rec({ type: 'user', uuid: 'n2', parentUuid: 'n1', timestamp: at(4), message: { role: 'user', content: notification(status).replace('toolu_a', 'toolu_unknown') } }),
      ], ctx);
    };
    const completed = run('completed', '\n<result>ALPHA</result>');
    expect(only(completed, 'subagent.finished')).toHaveLength(1);
    expect(only(completed, 'subagent.finished')[0]).toMatchObject({ id: 'n1#2', taskId: 'agent-1', status: 'completed', summary: 'ALPHA', outputFile: '/tmp/x/tasks/agent-1.output', reason: null });
    expect(only(completed, 'user.message').map((e) => e.origin)).toEqual([null, 'task-notification', 'task-notification']);
    expect(only(completed, 'turn.started').map((e) => e.origin)).toEqual([null, 'task-notification', 'task-notification']);
    // A notification for a tool use nobody started is a message and a turn, nothing more.
    expect(only(completed, 'user.message')[2].content).toContain('toolu_unknown');

    const failed = run('failed');
    expect(only(failed, 'subagent.finished')[0]).toMatchObject({ status: 'failed', summary: 'Agent "d" finished' }); // no <result>: the summary element
    expect(only(run('killed'), 'subagent.finished')[0].status).toBe('stopped');
    expect(only(run('something-new'), 'subagent.finished')[0].status).toBe('completed');
  });

  it('starts an agent whose meta was written after its Agent tool use was read, at the tool use\'s result (live tailing)', () => {
    // The engine appends the assistant record before it runs the tool, and the tool writes agent-<id>.meta.json when
    // it spawns the child, so a tailer reads the tool use before the meta exists.
    const records = currentChain(loadTranscriptFixture('subagent-parent')).chain;
    const full = fixtureSubagents();
    let metasWritten = false;
    const ctx = createBackfillContext({
      sessionId: '9a1d4262-0b43-46ad-acb9-5982f31d209c' as SessionId,
      agent: null,
      subagents: { byToolUseId: (id) => (metasWritten ? full.byToolUseId(id) : null) },
    });
    const events: SessionEvent[] = [];
    for (const record of records) {
      const isResult = Array.isArray((record.message as { content?: unknown } | undefined)?.content) && JSON.stringify(record.message).includes('"tool_result"');
      if (isResult) metasWritten = true;
      events.push(...mapAll([record], ctx));
    }
    const sequence = events.filter((e) => ['tool.use', 'subagent.started', 'tool.result', 'subagent.finished'].includes(e.kind)).map((e) => e.kind);
    expect(sequence).toEqual(['tool.use', 'subagent.started', 'tool.result', 'tool.use', 'subagent.started', 'tool.result', 'subagent.finished', 'subagent.finished']);
    const started = only(events, 'subagent.started');
    expect(started.map((e) => [e.taskId, e.toolUseId])).toEqual([
      ['ad286defbc77bc090', 'toolu_01CYiK6ncgQLFUQ2iqC1b4oB'],
      ['ae75ba6ce5d866acc', 'toolu_01A8AmiXuRTeJwjQEsaPE2DM'],
    ]);
    expect(started[0]).toMatchObject({ description: 'Read and report one.txt content', isBackground: true });
    expect(only(events, 'subagent.finished').map((e) => e.summary)).toEqual(['ONE', 'TWO']);
    // An Agent tool use whose meta never appears starts nothing and finishes nothing.
    const never = createBackfillContext({ sessionId: '9a1d4262-0b43-46ad-acb9-5982f31d209c' as SessionId, agent: null, subagents: { byToolUseId: () => null } });
    const without = mapAll(records, never);
    expect(only(without, 'subagent.started')).toEqual([]);
    expect(only(without, 'subagent.finished')).toEqual([]);
  });

  it('attributes every sidecar event to its agent and the parent tool use', () => {
    const subagents = fixtureSubagents();
    for (const agentId of SIDECAR_IDS) {
      const records = loadTranscript(`subagent-sidecars/agent-${agentId}.jsonl`);
      const meta = AgentMetaSchema.parse(JSON.parse(readFileSync(join(SIDECAR_DIR, `agent-${agentId}.meta.json`), 'utf8')));
      const { chain, gap } = currentChain(records);
      expect(gap).toBeNull();
      const ctx = createBackfillContext({
        sessionId: '9a1d4262-0b43-46ad-acb9-5982f31d209c' as SessionId,
        agent: { agentId: agentId as AgentId, parentToolUseId: meta.toolUseId as ParentToolUseId },
        subagents,
      });
      const events = mapAll(chain, ctx);
      expect(events.length).toBeGreaterThan(5);
      for (const event of events) {
        expect(event.agentId, event.id).toBe(agentId);
        expect(event.parentToolUseId, event.id).toBe(meta.toolUseId);
        expect(event.seq).toBeNull();
      }
      expect(kinds(events)).toContain('tool.use');
      expect(kinds(events)).toContain('tool.result');
      expect(only(events, 'tool.use')[0].toolName).toBe('Read');
      expect(only(events, 'user.message')[0].content).toMatch(/^Read the file/);
      // A child's start never collides with the parent's `session:<id>:started` under dedup by id.
      expect(only(events, 'session.started')[0].id).toBe(`session:9a1d4262-0b43-46ad-acb9-5982f31d209c:agent:${agentId}:started`);
    }
  });
});
