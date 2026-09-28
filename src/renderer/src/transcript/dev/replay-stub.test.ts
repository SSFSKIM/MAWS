// The replay stub over the probe journals (C6 execution document, M2 pins): every event it emits validates against
// X1, and the fixture gates state counts read from the journals.
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import { describe, expect, it } from 'vitest';
import { listJournals, loadJournal, type FixturePass } from '../../../../../test/support/fixtures';
import { dividerCopy } from '../model/copy';
import { rowsOf, withAllExpanded } from '../model/derive';
import { applyEvents, createState } from '../model/reduce';
import type { Row } from '../model/rows';
import { journalToEvents } from './replay-stub';

const events = (pass: FixturePass, name: string) => journalToEvents(loadJournal(pass, name));
const stateOf = (pass: FixturePass, name: string) => applyEvents(createState(null, null), events(pass, name));
const rowsFor = (pass: FixturePass, name: string) => rowsOf(withAllExpanded(stateOf(pass, name)));
const ofKind = <K extends Row['kind']>(rows: Row[], kind: K) => rows.filter((row): row is Extract<Row, { kind: K }> => row.kind === kind);
const cellsOf = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));

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
    const starts = list.filter((e): e is Extract<SessionEvent, { kind: 'turn.started' }> => e.kind === 'turn.started');
    expect(starts.map((e) => [e.seq, e.origin])).toEqual([[4, 'human'], [94, 'human'], [192, 'human']]);
    const users = list.filter((e): e is Extract<SessionEvent, { kind: 'user.message' }> => e.kind === 'user.message');
    expect(users.map((e) => e.seq)).toEqual([4, 94, 192]);
    expect(users[0]).toMatchObject({ messageUuid: '6ffe2781-e332-43ac-b218-09fb29e670de', origin: 'human', isReplay: false, isSynthetic: false, bash: null });
    const ends = list.filter((e): e is Extract<SessionEvent, { kind: 'turn.ended' }> => e.kind === 'turn.ended');
    expect(ends.map((e) => [e.seq, e.origin, e.permissionDenials.length, e.resultIndex])).toEqual([[93, 'human', 0, 0], [191, 'human', 1, 1], [279, 'human', 0, 2]]);
    expect(list.filter((e) => e.kind === 'session.init')).toHaveLength(3);
    expect(list.at(-1)).toMatchObject({ kind: 'process.exited', code: 0, reason: 'quit', seq: 289 });
  });

  it('pass1/queue-and-interrupt: the in replay of the prompt is deduplicated and the bash frames become tagged messages', () => {
    const list = events('pass1', 'queue-and-interrupt');
    const users = list.filter((e): e is Extract<SessionEvent, { kind: 'user.message' }> => e.kind === 'user.message');
    expect(users.filter((e) => e.messageUuid === 'a5bf8381-f5c0-4394-88a8-4b04c12e4911')).toHaveLength(1);
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
    expect(at(16)).toEqual(['turn.started', 'user.message']);
    expect(at(21)).toEqual([]); // the engine's inbound replay of seq 16
  });

  it('pass1/subagent: a system/init with no turn open is an engine turn; task frames become subagent events', () => {
    const list = events('pass1', 'subagent');
    const starts = list.filter((e): e is Extract<SessionEvent, { kind: 'turn.started' }> => e.kind === 'turn.started');
    expect(starts.map((e) => [e.seq, e.origin])).toEqual([[4, 'human'], [355, 'engine'], [425, 'engine']]);
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
    expect(locals.every((e) => e.isReplay && typeof e.content === 'string' && e.content.startsWith('<local-command-stdout>'))).toBe(true);
    const marker = events('pass1', 'queue-and-interrupt').find((e) => e.seq === 197);
    expect(marker).toMatchObject({ kind: 'user.message', origin: 'interrupt-marker', content: [{ type: 'text', text: '[Request interrupted by user]' }] });
    expect(events('pass2', 'per-task-stop-on').find((e) => e.seq === 65)).toMatchObject({ kind: 'user.message', origin: 'interrupt-marker' });
  });

  it('streams deltas with the block type of their content_block_start and completes with the envelope-local index', () => {
    const list = events('pass1', 'permission-roundtrip');
    const deltas = list.filter((e): e is Extract<SessionEvent, { kind: 'assistant.block.delta' }> => e.kind === 'assistant.block.delta' && e.apiMessageId === 'msg_011CfVbJVKzQBxgf5S8iR6fF');
    expect(new Set(deltas.map((e) => `${e.blockIndex}:${e.blockType}`))).toEqual(new Set(['0:thinking', '1:text']));
    expect(list.find((e) => e.seq === 85)).toMatchObject({ kind: 'assistant.block.complete', blockIndex: 0, block: { type: 'thinking' } });
    expect(list.find((e) => e.seq === 89)).toMatchObject({ kind: 'assistant.block.complete', blockIndex: 0, block: { type: 'text', text: 'DONE' } });
  });
});

describe('fixture gates through the model', () => {
  it('pass1/subagent: one human turn with a grouped subagent row, then two engine turns reading Continued', () => {
    const state = stateOf('pass1', 'subagent');
    expect(state.order.map((id) => state.turns.get(id)!.origin)).toEqual(['human', 'engine', 'engine']);
    const rows = rowsFor('pass1', 'subagent');
    const subagent = ofKind(rows, 'subagent');
    expect(subagent).toHaveLength(1);
    expect(subagent[0].agents.map((a) => a.taskId)).toEqual(['ad286defbc77bc090', 'ae75ba6ce5d866acc']);
    expect(subagent[0].sentence).toBe('Read and report one.txt content and Read and report two.txt content finished');
    expect(subagent[0].status).toBe('finished');
    expect(cellsOf(rows).some((cell) => cell.toolName === 'Agent')).toBe(false);
    expect(ofKind(rows, 'user')).toHaveLength(1);
    const dividers = ofKind(rows, 'divider');
    expect(dividers.map((d) => [d.origin, d.state])).toEqual([['human', 'completed'], ['engine', 'completed'], ['engine', 'completed']]); // each engine turn thinks, then answers
    expect(dividers.slice(1).map((d) => dividerCopy({ ...d, durationMs: d.summary.durationMs ?? 0 }).startsWith('Continued for '))).toEqual([true, true]);
    expect(ofKind(rows, 'assistant_text').filter((r) => r.turnId !== state.order[0])).toHaveLength(2);
    expect(dividers[0].summary.childAgents).toBe(2);
  });

  it('pass1/permission-roundtrip: three human turns of one Bash cell, the second denied', () => {
    const state = stateOf('pass1', 'permission-roundtrip');
    expect(state.order).toHaveLength(3);
    const rows = rowsFor('pass1', 'permission-roundtrip');
    expect(ofKind(rows, 'user')).toHaveLength(3);
    const dividers = ofKind(rows, 'divider');
    expect(dividers.map((d) => [d.toolCalls, d.denied, d.state])).toEqual([[1, 0, 'completed'], [1, 1, 'completed'], [1, 0, 'completed']]);
    expect(dividers[1].firstDeniedCell).toBe('cell:toolu_01WfZTvMV6147Psn1MBSesXw');
    const denied = ofKind(rows, 'cell').find((cell) => cell.id === 'cell:toolu_01WfZTvMV6147Psn1MBSesXw')!;
    expect(denied.classification.denial).toEqual({ kind: 'permission-rule', disposition: 'denied', interruption: false, reason: 'Probe denial: do not retry this command.' });
    expect(denied.label).toBe('Denied: `git branch --show-current` · Probe denial: do not retry this command.');
    expect(ofKind(rows, 'thinking').find((row) => row.id === 'think:msg_011CfVbJVKzQBxgf5S8iR6fF:0')).toBeDefined();
    expect(ofKind(rows, 'assistant_text').find((row) => row.id === 'text:msg_011CfVbJVKzQBxgf5S8iR6fF:1')).toMatchObject({ markdown: 'DONE', live: false, phase: 'answer' });
    expect(ofKind(rows, 'assistant_text').filter((row) => row.turnId === state.order[0])).toHaveLength(1);
  });

  it('pass1/question-roundtrip: a question row with two questions and the chosen answers', () => {
    const question = ofKind(rowsFor('pass1', 'question-roundtrip'), 'question');
    expect(question).toHaveLength(1);
    expect(question[0].questions).toHaveLength(2);
    expect(question[0].answers).toEqual({ 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Apple, Pear' });
    expect(ofKind(rowsFor('pass1', 'question-roundtrip'), 'request_slot')).toHaveLength(0);
  });

  it('pass1/queue-and-interrupt: one bash row with exit 0, a stopped divider, four stopped cells', () => {
    const rows = rowsFor('pass1', 'queue-and-interrupt');
    const bash = ofKind(rows, 'bash');
    expect(bash).toHaveLength(1);
    expect(bash[0]).toMatchObject({ command: 'printf BASH_MODE_OK', stdout: 'BASH_MODE_OK', exitCode: 0, turnId: null });
    const dividers = ofKind(rows, 'divider');
    expect(dividers[0]).toMatchObject({ state: 'stopped', denied: 0, autoDenied: 0, firstDeniedCell: null });
    expect(cellsOf(rows).filter((cell) => cell.status === 'stopped')).toHaveLength(4);
    expect(ofKind(rows, 'user').map((row) => row.text.slice(0, 8))).toEqual(['Count to', 'After co', 'Counting']);
  });

  it('pass2/workflow: a workflow subagent row and an engine turn', () => {
    const state = stateOf('pass2', 'workflow');
    expect(state.order.map((id) => state.turns.get(id)!.origin)).toEqual(['human', 'engine']);
    const rows = rowsFor('pass2', 'workflow');
    const subagent = ofKind(rows, 'subagent');
    expect(subagent).toHaveLength(1);
    expect(subagent[0].agents[0]).toMatchObject({ kind: 'workflow', taskId: 'wayue3on6', name: 'Two echo agents in one phase' });
    expect(subagent[0].status).toBe('finished');
  });

  it('pass2/rewind: a rewind boundary after the second turn hiding rows', () => {
    const state = stateOf('pass2', 'rewind');
    expect(state.order).toHaveLength(2);
    expect(state.hidden?.rows).toBeGreaterThan(0);
    const rows = rowsOf(state);
    const boundary = ofKind(rows, 'boundary');
    expect(boundary).toHaveLength(1);
    expect(boundary[0]).toMatchObject({ boundaryKind: 'rewind', revealed: false });
    expect(boundary[0].hiddenRows).toBeGreaterThan(0);
    expect(rows.indexOf(boundary[0])).toBeGreaterThan(rows.findIndex((row) => row.kind === 'assistant_text'));
  });

  it('pass2/bash-context-echoed: no turn before the prompt, one bash row, no echo row, one human turn', () => {
    const state = stateOf('pass2', 'bash-context-echoed');
    expect(state.order).toEqual(['turn:a37362a6-a117-4985-b0f9-cae7bfad6114']);
    expect(state.turns.get(state.order[0])!.origin).toBe('human');
    const rows = rowsFor('pass2', 'bash-context-echoed');
    expect(ofKind(rows, 'bash')).toHaveLength(1);
    expect(ofKind(rows, 'user')).toHaveLength(1);
    expect(ofKind(rows, 'user')[0].text.startsWith('I just ran a shell command')).toBe(true);
    expect(rows.map((row) => row.kind)).toEqual(['time', 'bash', 'user', 'assistant_text', 'error']); // the last row is the process exit
    expect(rows.at(-1)).toMatchObject({ scope: 'exit', severity: 'notice', text: 'Session process exited (quit)' });
  });

  it('pass2/auto-classifier: a shell cell whose classification carries the verdict and whose label has no auto-mode word', () => {
    const cells = cellsOf(rowsFor('pass2', 'auto-classifier'));
    expect(cells.length).toBe(2);
    for (const cell of cells) {
      expect(cell.detail.kind).toBe('shell');
      expect(cell.classification.safeguard).toBe('not_flagged');
      expect(cell.label.toLowerCase()).not.toContain('auto');
    }
  });

  it('pass2/hooks: a hook cell inside the turn’s group', () => {
    const rows = rowsFor('pass2', 'hooks');
    const groups = ofKind(rows, 'group');
    expect(groups).toHaveLength(1);
    expect(groups[0].cells.map((cell) => cell.id)).toEqual(['cell:toolu_01Pw5t8WFEWy8m7zrSCNnca1', 'cell:hook:2fb18f8d-6da2-4d27-b7c5-5e55be53e312']);
    expect(groups[0].cells[1].detail).toMatchObject({ kind: 'hook', outcome: 'success', stdout: 'MAWS_POSTHOOK\n' });
    expect(groups[0].summary).toBe('Ran `git status --short`, ran 1 hook');
  });

  it('pass2/auto-routed: four local_command rows and no user row for them; the interrupt markers yield no row', () => {
    const rows = rowsFor('pass2', 'auto-routed');
    const locals = ofKind(rows, 'local_command');
    expect(locals).toHaveLength(4);
    expect(locals.every((row) => row.text.startsWith('Set model to '))).toBe(true);
    expect(locals.every((row) => row.id.startsWith('local:'))).toBe(true);
    expect(ofKind(rows, 'user').some((row) => row.text.includes('local-command') || row.text.startsWith('Set model'))).toBe(false);
    const state = stateOf('pass2', 'auto-routed');
    expect(state.order.every((id) => !state.turns.get(id)!.events.some((e) => e.kind === 'turn.started' && e.userMessageUuid && e.userMessageUuid.startsWith('local')))).toBe(true);
    for (const [pass, name, seq] of [['pass1', 'queue-and-interrupt', 197], ['pass2', 'per-task-stop-on', 65]] as const) {
      const marker = events(pass, name).find((e) => e.seq === seq) as Extract<SessionEvent, { kind: 'user.message' }>;
      const all = rowsFor(pass, name);
      expect(all.some((row) => 'messageUuid' in row && row.messageUuid === marker.messageUuid)).toBe(false);
      expect(ofKind(all, 'user').some((row) => row.text.includes('interrupted by user'))).toBe(false);
    }
  });

  it('pass1/init: a thinking disclosure then the answer', () => {
    const rows = rowsFor('pass1', 'init');
    expect(rows.map((row) => row.kind)).toEqual(['time', 'user', 'divider', 'thinking', 'assistant_text', 'error']);
    expect(ofKind(rows, 'thinking')[0].durationMs).toBeGreaterThan(0);
    expect(ofKind(rows, 'thinking')[0].id).toBe('think:msg_011CfVbGCWehpRw3sXEAfrCv:0');
    expect(ofKind(rows, 'assistant_text')[0].id).toBe('text:msg_011CfVbGCWehpRw3sXEAfrCv:1');
  });
});
