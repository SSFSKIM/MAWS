// The probe-journal fixture gates through the model (C6 execution document, M2 "Proves"): counts read from the
// journals, over C3's normaliser output (the replay stub's until the rebase). The synthetic-journal pins live in
// fixtures.test.ts.
import type { SessionEvent } from '@shared/graph/events';
import { describe, expect, it } from 'vitest';
import { loadJournal, type FixturePass } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { dividerCopy } from './copy';
import { rowsOf, withAllExpanded } from './derive';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';

const events = (pass: FixturePass, name: string) => journalToEvents(loadJournal(pass, name));
const stateOf = (pass: FixturePass, name: string) => applyEvents(createState(null, null), events(pass, name));
const journalState = (pass: FixturePass, name: string, throughSeq: number) =>
  applyEvents(createState(null, null), events(pass, name).filter((event) => event.seq !== null && event.seq <= throughSeq));
const rowsFor = (pass: FixturePass, name: string) => rowsOf(withAllExpanded(stateOf(pass, name)));
const ofKind = <K extends Row['kind']>(rows: Row[], kind: K) => rows.filter((row): row is Extract<Row, { kind: K }> => row.kind === kind);
const cellsOf = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));

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

  it('pass1/queue-and-interrupt: one bash row with exit 0, a stopped divider, four stopped cells, and three turns, the queued prompt pending then dropped', () => {
    const state = stateOf('pass1', 'queue-and-interrupt');
    const QUEUED = 'turn:99662785-5122-45a7-a68f-d734959a0c52';
    expect(state.order).toEqual(['turn:a5bf8381-f5c0-4394-88a8-4b04c12e4911', QUEUED, 'turn:e88214f8-3ba3-4b4c-8e64-3be1595fcac0']);
    expect(state.order.map((id) => state.turns.get(id)!.origin)).toEqual(['human', 'human', 'human']);
    expect(state.order.map((id) => state.turns.get(id)!.state)).toEqual(['closed', 'closed', 'closed']);
    const rows = rowsFor('pass1', 'queue-and-interrupt');
    const bash = ofKind(rows, 'bash');
    expect(bash).toHaveLength(1);
    expect(bash[0]).toMatchObject({ command: 'printf BASH_MODE_OK', stdout: 'BASH_MODE_OK', exitCode: 0, turnId: null });
    const dividers = ofKind(rows, 'divider');
    expect(dividers.map((row) => row.turnId)).toEqual([state.order[0], state.order[2]]); // the dropped prompt did no work
    expect(dividers[0]).toMatchObject({ state: 'stopped', denied: 0, autoDenied: 0, firstDeniedCell: null });
    expect(cellsOf(rows).filter((cell) => cell.status === 'stopped')).toHaveLength(4);
    const users = ofKind(rows, 'user');
    expect(users.map((row) => row.text.slice(0, 8))).toEqual(['Count to', 'After co', 'Counting']);
    expect(users[1]).toMatchObject({ id: 'user:99662785-5122-45a7-a68f-d734959a0c52', turnId: QUEUED, steer: false, dropped: true });
    expect(users[0]).toMatchObject({ steer: false, dropped: false });
    expect(users[2]).toMatchObject({ turnId: state.order[2], steer: false, dropped: false });
    // Pending then dropped: after the queue write (seq 146) the prompt is a turn of its own with its bubble and no
    // divider while the first turn still runs.
    const pending = rowsOf(journalState('pass1', 'queue-and-interrupt', 146));
    expect(pending.filter((row) => row.turnId === QUEUED).map((row) => row.kind)).toEqual(['user']);
    expect(ofKind(pending, 'user').find((row) => row.turnId === QUEUED)).toMatchObject({ dropped: false });
  });

  it('pass2/workflow: a workflow subagent row and an engine turn', () => {
    const state = stateOf('pass2', 'workflow');
    expect(state.order.map((id) => state.turns.get(id)!.origin)).toEqual(['human', 'engine']);
    const rows = rowsFor('pass2', 'workflow');
    const subagent = ofKind(rows, 'subagent');
    expect(subagent).toHaveLength(1);
    expect(subagent[0].agents[0]).toMatchObject({ kind: 'workflow', taskId: 'wayue3on6', name: 'Two echo agents in one phase' });
    expect(subagent[0].status).toBe('finished');
    // The engine turn is a single answer with no work area; its divider still says the engine continued (M6).
    expect(ofKind(rows, 'divider').map((row) => [row.turnId, row.origin, row.toolCalls])).toEqual([[state.order[0], 'human', 0], [state.order[1], 'engine', 0]]);
    expect(ofKind(rows, 'user').map((row) => row.turnId)).toEqual([state.order[0]]);
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
    expect(rows.at(-1)).toMatchObject({ scope: 'exit', severity: 'notice', text: 'Session process exited (unknown)' });
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

  it('pass2/hooks: the successful PostToolUse hook shows nothing; the lone Bash call stands alone (W1)', () => {
    const rows = rowsFor('pass2', 'hooks');
    expect(ofKind(rows, 'group')).toHaveLength(0);
    expect(cellsOf(rows).map((cell) => cell.id)).toEqual(['cell:toolu_01Pw5t8WFEWy8m7zrSCNnca1']);
    expect(rows.some((row) => row.kind === 'error' && row.scope === 'hook')).toBe(false);
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
    const unrouted = rowsFor('pass2', 'auto-unrouted');
    const unroutedLocals = ofKind(unrouted, 'local_command');
    expect(unroutedLocals).toHaveLength(3);
    expect(events('pass2', 'auto-unrouted').filter((e) => e.kind === 'user.message' && e.origin === 'local-command').map((e) => e.seq)).toEqual([43, 52, 65]);
    expect(ofKind(unrouted, 'user').some((row) => row.text.startsWith('Set model'))).toBe(false);
    expect(ofKind(unrouted, 'user')).toHaveLength(3);
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

  // Pass 3 (C3's live recordings, on master since the rebase).
  it('pass3/steer-next: the next prompt’s started inside the running turn (seq 71) folds it there as a steer; one turn, one divider', () => {
    const state = stateOf('pass3', 'steer-next');
    const RUNNING = 'turn:fe091b0d-b28b-41a8-aed3-39585769623d';
    expect(state.order).toEqual([RUNNING]);
    const rows = rowsOf(state); // closed and collapsed: the steer stays outside the work area
    expect(ofKind(rows, 'divider').map((row) => [row.turnId, row.state])).toEqual([[RUNNING, 'completed']]);
    expect(ofKind(rows, 'user').map((row) => [row.id, row.turnId, row.steer, row.dropped])).toEqual([
      ['user:fe091b0d-b28b-41a8-aed3-39585769623d', RUNNING, false, false],
      ['user:42a15931-3c9a-4267-a6b2-09fa5697735d', RUNNING, true, false],
    ]);
  });

  it('pass3/steer-next: COUNTED, followed by a MessageDisplay and a Stop hook (seq 230-237), is the answer, visible when the turn collapses (W1)', () => {
    const state = stateOf('pass3', 'steer-next');
    const answer = ofKind(rowsOf(state), 'assistant_text');
    expect(answer.map((row) => [row.markdown, row.phase])).toEqual([['COUNTED', 'answer']]);
    const expanded = ofKind(rowsFor('pass3', 'steer-next'), 'assistant_text');
    expect(expanded.find((row) => row.markdown === 'COUNTED')).toMatchObject({ phase: 'answer' });
  });

  it('pass3/steer-now: the now prompt preempts the running turn (stopped) and runs as its own turn', () => {
    const state = stateOf('pass3', 'steer-now');
    expect(state.order).toHaveLength(3);
    expect(state.order.map((id) => state.turns.get(id)!.state)).toEqual(['closed', 'closed', 'closed']);
    // The two answer-only turns did no work (their hook runs show nothing since W1), so only the stopped turn has a divider.
    expect(ofKind(rowsFor('pass3', 'steer-now'), 'divider').map((row) => [row.turnId, row.state])).toEqual([[state.order[0], 'stopped']]);
    expect(ofKind(rowsFor('pass3', 'steer-now'), 'assistant_text').filter((row) => row.turnId !== state.order[0]).map((row) => row.phase)).toEqual(['answer', 'answer']);
    expect(ofKind(rowsFor('pass3', 'steer-now'), 'user').every((row) => !row.steer)).toBe(true);
  });

  // W1 (A4): a Stop hook answering decision: block (seq 30) and a UserPromptSubmit hook exiting 2 (seq 57), recorded live
  // under a scratch config home. The engine's terminal words for both (seq 32, 59) give way to the hook's notice row.
  it('pass3/hooks-blocking: Hook re-prompted Claude between the two answers; A hook blocked your prompt with Edit prompt; no divider, no engine notice', () => {
    const rows = rowsOf(stateOf('pass3', 'hooks-blocking'));
    expect(rows.filter((row) => row.kind !== 'time').map((row) => (row.kind === 'error' ? `${row.scope}:${row.text}` : row.kind === 'assistant_text' ? `${row.phase}:${row.markdown}` : `${row.kind}:${row.kind === 'user' ? row.text : ''}`))).toEqual([
      'user:Reply ONE',
      'answer:ONE',
      'hook:Hook re-prompted Claude · Say REPROMPTED and stop',
      'answer:REPROMPTED',
      'user:BLOCKME please reply TWO',
      'hook:A hook blocked your prompt · BLOCKED_BY_TEST_HOOK',
      'exit:Session process exited (quit)',
    ]);
    expect(ofKind(rows, 'error').find((row) => row.scope === 'hook' && row.text.startsWith('A hook blocked'))?.action).toBe('edit_prompt');
  });

  it('pass3/plan-outcomes: MAWS’s clear-and-implement (a deny with its fixed message) reads as such, beside the other two outcomes', () => {
    const plans = ofKind(rowsFor('pass3', 'plan-outcomes'), 'plan');
    expect(plans.map((row) => row.outcome)).toEqual(['keep_planning', 'implement', 'clear_and_implement']);
    expect(plans[2].feedback).toBeNull();
  });
});
