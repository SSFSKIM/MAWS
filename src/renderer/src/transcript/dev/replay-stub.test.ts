// The replay stub over the probe journals (C6 execution document, M2 pins): every event it emits validates against
// X1, and its querying-user mapping. The fixture gates through the model read C3's output (model/journals.test.ts).
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import { describe, expect, it } from 'vitest';
import { listJournals, loadJournal, type FixturePass } from '../../../../../test/support/fixtures';
import { journalToEvents } from './replay-stub';

const events = (pass: FixturePass, name: string) => journalToEvents(loadJournal(pass, name));

describe('replay stub: every journal of both passes yields valid X1 events', () => {
  for (const pass of ['pass1', 'pass2'] as const) {
    for (const name of listJournals(pass)) {
      it(`${pass}/${name}`, () => {
        const list = events(pass, name);
        expect(list.length).toBeGreaterThan(0);
        const failures: string[] = [];
        const ids = new Set<string>();
        list.forEach((event, i) => {
          const parsed = SessionEventSchema.safeParse(event);
          if (!parsed.success) failures.push(`${i} (${event.kind}, seq ${event.seq}): ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
          if (ids.has(event.id)) failures.push(`${i}: duplicate id ${event.id}`);
          ids.add(event.id);
          if (i > 0 && (list[i - 1].seq ?? 0) > (event.seq ?? 0)) failures.push(`${i}: seq ${event.seq} after ${list[i - 1].seq}`);
        });
        expect(failures).toEqual([]);
      });
    }
  }
});

describe('replay stub: the querying-user mapping', () => {
  it('pass1/permission-roundtrip: three human turns from the out frames, each with its bubble, no replay duplicates', () => {
    const list = events('pass1', 'permission-roundtrip');
    const users0Uuid = '6ffe2781-e332-43ac-b218-09fb29e670de';
    const starts = list.filter((e): e is Extract<SessionEvent, { kind: 'turn.started' }> => e.kind === 'turn.started');
    // The bubble at the out frame, the turn at the engine's `command_lifecycle started` for that uuid (C3's mapping).
    expect(starts.map((e) => [e.seq, e.origin, e.userMessageUuid])).toEqual([[6, 'human', users0Uuid], [97, 'human', expect.any(String)], [195, 'human', expect.any(String)]]);
    const users = list.filter((e): e is Extract<SessionEvent, { kind: 'user.message' }> => e.kind === 'user.message');
    expect(users.map((e) => e.seq)).toEqual([4, 94, 192]);
    expect(users[0]).toMatchObject({ messageUuid: '6ffe2781-e332-43ac-b218-09fb29e670de', origin: 'human', isReplay: false, isSynthetic: false, bash: null });
    const ends = list.filter((e): e is Extract<SessionEvent, { kind: 'turn.ended' }> => e.kind === 'turn.ended');
    expect(ends.map((e) => [e.seq, e.origin, e.permissionDenials.length, e.resultIndex])).toEqual([[93, 'human', 0, 0], [191, 'human', 1, 1], [279, 'human', 0, 2]]);
    expect(list.filter((e) => e.kind === 'session.init')).toHaveLength(3);
    expect(list.at(-1)).toMatchObject({ kind: 'process.exited', code: 0, reason: 'unknown', seq: 289 }); // a clean exit the host did not ask for (C3)
  });

  it('pass1/queue-and-interrupt: the in replay of the prompt is deduplicated and the bash frames become tagged messages', () => {
    const list = events('pass1', 'queue-and-interrupt');
    const users = list.filter((e): e is Extract<SessionEvent, { kind: 'user.message' }> => e.kind === 'user.message');
    expect(users.filter((e) => e.messageUuid === 'a5bf8381-f5c0-4394-88a8-4b04c12e4911')).toHaveLength(1);
    // Each turn starts at its prompt's `command_lifecycle started` (seq 6 and 202); the prompt queued at seq 146 never
    // starts (cancelled at seq 191), so it is a user.message with no turn.started.
    expect(list.filter((e) => e.kind === 'turn.started').map((e) => e.seq)).toEqual([6, 202]);
    expect(list.filter((e) => e.seq === 146).map((e) => e.kind)).toEqual(['user.message']);
    expect(list.filter((e) => e.kind === 'turn.ended').every((e) => e.kind === 'turn.ended' && e.terminalReason !== 'cancelled')).toBe(true);
    expect(list.find((e) => e.seq === 191)).toMatchObject({ kind: 'command.lifecycle', state: 'cancelled', commandUuid: '99662785-5122-45a7-a68f-d734959a0c52' });
    expect(users.find((e) => e.seq === 235)).toMatchObject({ bash: { part: 'input', command: 'printf BASH_MODE_OK' }, isReplay: true });
    expect(users.find((e) => e.seq === 236)).toMatchObject({ bash: { part: 'output', stdout: 'BASH_MODE_OK', stderr: '', exitCode: 0 } });
    const denials = list.filter((e): e is Extract<SessionEvent, { kind: 'tool.result' }> => e.kind === 'tool.result' && e.denial !== null);
    expect(denials.map((e) => e.denial)).toEqual(['user-rejected', 'user-rejected', 'user-rejected', 'user-rejected']);
    expect(list.find((e) => e.kind === 'turn.ended')).toMatchObject({ terminalReason: 'aborted_streaming', isError: true });
  });

  it('pass2/bash-context-echoed: the echo is a bash_echo message, its init opens nothing and its result is the echo receipt', () => {
    const list = events('pass2', 'bash-context-echoed');
    const at = (seq: number) => list.filter((e) => e.seq === seq).map((e) => e.kind);
    expect(at(9)).toEqual(['user.message']);
    expect(list.find((e) => e.seq === 9)).toMatchObject({ origin: 'bash_echo', isSynthetic: true, isReplay: false, bash: null, messageUuid: '36328998-c3a9-46c4-af5c-79c755aa1f39' });
    expect(at(12)).toEqual(['session.init']);
    expect(list.find((e) => e.seq === 13)).toMatchObject({ kind: 'turn.ended', isEchoReceipt: true });
    expect(at(11)).toEqual(['command.lifecycle']); // the echo's own started opens nothing
    expect(at(16)).toEqual(['user.message']);
    expect(at(18)).toEqual(['command.lifecycle', 'turn.started']);
    expect(at(21)).toEqual([]); // the engine's inbound replay of seq 16
  });

  it('pass1/subagent: a system/init with no turn open is an engine turn; task frames become subagent events', () => {
    const list = events('pass1', 'subagent');
    const starts = list.filter((e): e is Extract<SessionEvent, { kind: 'turn.started' }> => e.kind === 'turn.started');
    expect(starts.map((e) => [e.seq, e.origin])).toEqual([[6, 'human'], [355, 'engine'], [425, 'engine']]);
    expect(list.filter((e) => e.kind === 'subagent.started').map((e) => e.seq)).toEqual([172, 217]);
    expect(list.filter((e) => e.kind === 'subagent.finished').map((e) => e.seq)).toEqual([335, 365]);
    expect(list.find((e) => e.seq === 335)).toMatchObject({ kind: 'subagent.finished', taskId: 'ad286defbc77bc090', status: 'completed', summary: 'ONE' });
    expect(list.filter((e) => e.kind === 'turn.ended').map((e) => (e as Extract<SessionEvent, { kind: 'turn.ended' }>).origin)).toEqual(['human', 'task-notification', 'task-notification']);
    const child = list.filter((e) => e.parentToolUseId !== null);
    expect(child.length).toBeGreaterThan(0);
    expect(child.every((e) => e.agentId !== null)).toBe(true);
  });

  it('pass2/workflow: the workflow task yields task.started and workflow.progress, and a second engine turn', () => {
    const list = events('pass2', 'workflow');
    expect(list.find((e) => e.seq === 77)).toMatchObject({ kind: 'task.started', taskType: 'local_workflow', workflowName: 'maws-probe' });
    expect(list.filter((e) => e.kind === 'workflow.progress').map((e) => e.seq)).toEqual([82, 92, 93]);
    expect(list.find((e) => e.seq === 96)).toMatchObject({ kind: 'task.notification', status: 'completed' });
    expect(list.filter((e) => e.kind === 'turn.started').map((e) => (e as Extract<SessionEvent, { kind: 'turn.started' }>).origin)).toEqual(['human', 'engine']);
  });

  it('pass1/question-roundtrip: the can_use_tool for AskUserQuestion is a question request and the response its answer', () => {
    const list = events('pass1', 'question-roundtrip');
    expect(list.find((e) => e.seq === 137)).toMatchObject({ kind: 'question.requested', toolUseId: 'toolu_01SwshrZ4QjaJT8nymMQo7AG' });
    expect(list.find((e) => e.seq === 138)).toMatchObject({ kind: 'question.answered', answers: { 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Apple, Pear' } });
  });

  it('pass2/auto-classifier: the safeguard verdict lands on tool.safeguard and on the result', () => {
    const list = events('pass2', 'auto-classifier');
    expect(list.find((e) => e.seq === 34)).toMatchObject({ kind: 'tool.safeguard', verdict: 'not_flagged', lane: 'server' });
    expect(list.find((e) => e.seq === 36)).toMatchObject({ kind: 'tool.result', safeguard: 'not_flagged' });
  });

  it('pass2/rewind, hooks, dialogs: rewind, hook lifecycle and hook callback, elicitation', () => {
    expect(events('pass2', 'rewind').find((e) => e.seq === 42)).toMatchObject({ kind: 'boundary.rewind', targetMessageUuid: '36a2aa44-9ae9-455e-b52b-e70b27eecde5', precedingAssistantUuid: 'edf0f954-1b18-4bca-a53f-d3212ef6dbaa' });
    expect(events('pass2', 'rewind').some((e) => e.seq === 40 && e.kind === 'boundary.rewind')).toBe(false); // rewound: false
    const hooks = events('pass2', 'hooks');
    expect(hooks.find((e) => e.seq === 26)).toMatchObject({ kind: 'hook.callback_requested', callbackId: 'maws_pre_bash', hookEvent: 'PreToolUse' });
    expect(hooks.find((e) => e.seq === 29)).toMatchObject({ kind: 'hook.callback_resolved' });
    expect(hooks.find((e) => e.seq === 32)).toMatchObject({ kind: 'hook.started', hookEvent: 'PostToolUse' });
    expect(hooks.find((e) => e.seq === 33)).toMatchObject({ kind: 'hook.finished', outcome: 'success', exitCode: 0, stdout: 'MAWS_POSTHOOK\n' });
    const dialogs = events('pass2', 'dialogs');
    expect(dialogs.find((e) => e.seq === 41)).toMatchObject({ kind: 'elicitation.requested', mcpServerName: 'maws-elicit', mode: 'form' });
    expect(dialogs.find((e) => e.seq === 43)).toMatchObject({ kind: 'elicitation.resolved', action: 'accept', content: { color: 'teal' } });
  });

  it('tags the local-command echo and the interrupt marker from the wire', () => {
    const routed = events('pass2', 'auto-routed');
    const locals = routed.filter((e): e is Extract<SessionEvent, { kind: 'user.message' }> => e.kind === 'user.message' && e.origin === 'local-command');
    expect(locals.map((e) => e.seq)).toEqual([153, 162, 173, 186]);
    expect(locals.every((e) => e.isReplay && typeof e.content === 'string' && e.content.startsWith('Set model to'))).toBe(true); // C3 carries the tag's inner text
    const marker = events('pass1', 'queue-and-interrupt').find((e) => e.seq === 197);
    expect(marker).toMatchObject({ kind: 'user.message', origin: 'interrupt-marker', content: [{ type: 'text', text: '[Request interrupted by user]' }] });
    expect(events('pass2', 'per-task-stop-on').find((e) => e.seq === 65)).toMatchObject({ kind: 'user.message', origin: 'interrupt-marker' });
  });

  it('streams deltas with the block type of their content_block_start and completes with the stream index (C3)', () => {
    const list = events('pass1', 'permission-roundtrip');
    const deltas = list.filter((e): e is Extract<SessionEvent, { kind: 'assistant.block.delta' }> => e.kind === 'assistant.block.delta' && e.apiMessageId === 'msg_011CfVbJVKzQBxgf5S8iR6fF');
    expect(new Set(deltas.map((e) => `${e.blockIndex}:${e.blockType}`))).toEqual(new Set(['0:thinking', '1:text']));
    expect(list.find((e) => e.seq === 85)).toMatchObject({ kind: 'assistant.block.complete', blockIndex: 0, block: { type: 'thinking' } });
    expect(list.find((e) => e.seq === 89)).toMatchObject({ kind: 'assistant.block.complete', blockIndex: 1, block: { type: 'text', text: 'DONE' } });
  });
});
