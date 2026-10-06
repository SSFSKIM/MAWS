import type { SessionEvent } from '@shared/graph/events';
import { afterEach, describe, expect, it } from 'vitest';
import { heldRow, rowsOf, turnSummary, withAllExpanded, withQueueTail } from './derive';
import { cellId, rowId, turnId } from './keys';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { api, BASH_RESULT, builder, task, tool, uuid } from './test-events';
import { configureTime } from './time';

const reduce = (events: SessionEvent[]) => applyEvents(createState(null, null), events);
const rows = (events: SessionEvent[]) => rowsOf(withAllExpanded(reduce(events)));
const kinds = (list: Row[]) => list.map((row) => row.kind);
const find = <K extends Row['kind']>(list: Row[], kind: K, n = 0) => list.filter((row): row is Extract<Row, { kind: K }> => row.kind === kind)[n];
const group = (list: Row[], n = 0) => find(list, 'group', n);

afterEach(() => configureTime(null));

describe('group state machine', () => {
  it('starts a group at the first groupable cell and folds consecutive groupable cells into it', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'pnpm test' });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.toolUse('t2', 'Bash', { command: 'pnpm lint' });
    b.result('t2', 'ok', { structured: BASH_RESULT('ok') });
    b.toolUse('t3', 'Grep', { pattern: 'TODO', path: 'src' });
    b.result('t3', 'src/a.ts:1: TODO');
    b.text('m9', 0, 'Done');
    b.end(['u1']);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'group', 'assistant_text']);
    const g = group(list);
    expect(g.id).toBe(rowId.group('cell:t1' as never));
    expect(g.cells.map((cell) => cell.id)).toEqual(['cell:t1', 'cell:t2', 'cell:t3']);
    expect(g.summary).toBe('Searched for `TODO`, ran 2 commands');
    expect(g.state).toBe('completed');
    expect(g.cells[0].classification.startsGroup).toBe(true);
    expect(g.cells[1].classification.startsGroup).toBe(false);
    expect(find(list, 'divider')).toMatchObject({ toolCalls: 3, state: 'completed' });
  });

  it('flushes the group on a standalone row and starts a new one after it', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'a' });
    b.result('t1', 'ok');
    b.toolUse('t2', 'Bash', { command: 'b' });
    b.result('t2', 'ok');
    b.toolUse('t3', 'Bash', { command: 'c' });
    b.result('t3', 'denied', { isError: true, denial: 'permission-rule' });
    b.toolUse('t4', 'Bash', { command: 'd' });
    b.result('t4', 'ok');
    b.toolUse('t5', 'Bash', { command: 'e' });
    b.result('t5', 'ok');
    b.end(['u1']);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'group', 'cell', 'group']);
    expect(group(list, 0).cells.map((c) => c.id)).toEqual(['cell:t1', 'cell:t2']);
    expect(find(list, 'cell')).toMatchObject({ id: 'cell:t3', status: 'denied' });
    expect(group(list, 1).cells.map((c) => c.id)).toEqual(['cell:t4', 'cell:t5']);
    expect(group(list, 1).cells[0].classification.startsGroup).toBe(true);
  });

  it('starts a new group after a commentary text row, a subagent row and a boundary', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'a' });
    b.result('t1', 'ok');
    b.toolUse('t2', 'Bash', { command: 'b' });
    b.result('t2', 'ok');
    b.text('m1', 0, 'Now the agent.');
    b.toolUse('t3', 'Bash', { command: 'c' });
    b.result('t3', 'ok');
    b.toolUse('t4', 'Bash', { command: 'd' });
    b.result('t4', 'ok');
    b.toolUse('a1', 'Agent', { description: 'Survey', prompt: 'p' });
    b.emit('subagent.started', { taskId: task('k1'), toolUseId: tool('a1'), description: 'Survey', subagentType: null, isBackground: false, spawnDepth: 1, prompt: null });
    b.emit('subagent.finished', { taskId: task('k1'), status: 'completed', summary: null, outputFile: null, reason: null });
    b.toolUse('t5', 'Bash', { command: 'e' });
    b.result('t5', 'ok');
    b.toolUse('t6', 'Bash', { command: 'f' });
    b.result('t6', 'ok');
    b.emit('boundary.reset', { newConversationId: 'c', trigger: null });
    b.toolUse('t7', 'Bash', { command: 'g' });
    b.result('t7', 'ok');
    b.toolUse('t8', 'Bash', { command: 'h' });
    b.result('t8', 'ok');
    b.text('m2', 0, 'Answer');
    b.end(['u1']);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'group', 'assistant_text', 'group', 'subagent', 'group', 'boundary', 'group', 'assistant_text']);
    expect(find(list, 'assistant_text', 0)).toMatchObject({ phase: 'commentary', markdown: 'Now the agent.' });
    expect(find(list, 'assistant_text', 1)).toMatchObject({ phase: 'answer', markdown: 'Answer' });
    expect(list.filter((row) => row.kind === 'group').map((row) => (row as Extract<Row, { kind: 'group' }>).cells.length)).toEqual([2, 2, 2, 2]);
  });

  it('thinking blocks become cells inside the open group and never start one; a thinking-only group is a thinking row', () => {
    const b = builder();
    b.turn('u1');
    b.thinking('m1', 0, 'Plan first');
    b.toolUse('t1', 'Bash', { command: 'a' }, 'm1', 1);
    b.result('t1', 'ok');
    b.thinking('m2', 0, 'Then');
    b.toolUse('t2', 'Bash', { command: 'b' }, 'm2', 1);
    b.result('t2', 'ok');
    b.thinking('m3', 0, 'Finally');
    b.text('m3', 1, 'Done');
    b.end(['u1']);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'group', 'thinking', 'assistant_text']);
    const g = group(list);
    expect(g.cells.map((c) => c.id)).toEqual(['cell:think:m1:0', 'cell:t1', 'cell:think:m2:0', 'cell:t2']);
    expect(g.id).toBe('group:cell:think:m1:0');
    expect(g.cells[0].detail.kind).toBe('thinking');
    expect(find(list, 'thinking')).toMatchObject({ id: rowId.think('m3' as never, 0), text: 'Finally', live: false });
  });

  it('a completed group with exactly one non-hidden cell unwraps to a standalone cell, with its thinking as a row before it', () => {
    const b = builder();
    b.turn('u1');
    b.thinking('m1', 0, 'Hmm');
    b.toolUse('t1', 'Bash', { command: 'git log' }, 'm1', 1);
    b.result('t1', '2299dcc seed', { structured: BASH_RESULT('2299dcc seed') });
    b.text('m2', 0, 'DONE');
    b.end(['u1']);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'thinking', 'cell', 'assistant_text']);
    expect(find(list, 'cell')).toMatchObject({ id: 'cell:t1', label: 'Ran `git log` in 0s', category: 'commands' });
    expect(find(list, 'cell').detail).toMatchObject({ kind: 'shell', command: 'git log', stdout: '2299dcc seed', exitCode: 0 });
  });

  it('a hidden bookkeeping cell exists in the expanded group but contributes no phrase, and does not count as the one visible cell', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'TodoWrite', { todos: [] });
    b.result('t1', 'Todos updated');
    b.toolUse('t2', 'Bash', { command: 'a' });
    b.result('t2', 'ok');
    b.end(['u1']);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'group']);
    const g = group(list);
    expect(g.cells.map((c) => c.id)).toEqual(['cell:t1', 'cell:t2']);
    expect(g.cells[0].classification.hidden).toBe(true);
    expect(g.summary).toBe('Ran `a`');
  });

  it('an active group never unwraps and labels what is running', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'pnpm test' });
    b.emit('tool.progress', { toolUseId: tool('t1'), toolName: 'Bash', elapsedSeconds: 3, taskId: null, heartbeat: true });
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'group']);
    expect(group(list)).toMatchObject({ state: 'active', activeLabel: 'Running `pnpm test` for 3s' });
    expect(group(list).cells[0].status).toBe('running');
    expect(find(list, 'divider')).toMatchObject({ state: 'working' });
  });

  it('consecutive reads merge into one read cell with every path', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Read', { file_path: '/p/a.ts' });
    b.result('t1', '1\tx');
    b.toolUse('t2', 'Read', { file_path: '/p/b.ts', offset: 10, limit: 20 });
    b.result('t2', '10\ty');
    b.toolUse('t3', 'Grep', { pattern: 'x' });
    b.result('t3', '');
    b.toolUse('t4', 'Read', { file_path: '/p/c.ts' });
    b.result('t4', '1\tz');
    b.end(['u1']);
    const g = group(rows(b.events));
    expect(g.cells.map((c) => c.id)).toEqual(['cell:reads:t1', 'cell:t3', 'cell:t4']);
    expect(g.cells[0]).toMatchObject({ label: 'Read 2 files', paths: ['/p/a.ts', '/p/b.ts'] });
    expect(g.cells[0].detail).toMatchObject({ kind: 'read', files: [{ path: '/p/a.ts', range: null }, { path: '/p/b.ts', range: [10, 29] }] });
    expect(g.summary).toBe('Read 3 files, searched for `x`');
  });

  it('a merged read cell expands under its own id', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Read', { file_path: '/p/a.ts' });
    b.result('t1', '1\tx');
    b.toolUse('t2', 'Read', { file_path: '/p/b.ts' });
    b.result('t2', '1\ty');
    b.end(['u1']);
    const state = reduce(b.events);
    const ui = { ...state.ui, expandedTurns: new Set(state.order), expandedCells: new Set([cellId.reads(tool('t1'))]), version: state.ui.version + 1 };
    const cell = rowsOf({ ...state, ui }).find((row) => row.kind === 'cell');
    expect(cell).toMatchObject({ id: 'cell:reads:t1', expanded: true });
  });

  it('an image result is a standalone image cell', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Read', { file_path: '/p/shot.png' });
    b.result('t1', [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }], { structured: { isImage: true } });
    b.end(['u1']);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'cell']);
    expect(find(list, 'cell').detail).toMatchObject({ kind: 'image', images: [{ dataUrl: 'data:image/png;base64,AAAA', mediaType: 'image/png' }] });
  });

  it('a grouped subagent row is terminal only when every child is: one failed while another works reads working, then finished with errors', () => {
    const b = builder();
    b.turn('u1');
    for (const [use, taskName, name, index] of [['a1', 'k1', 'A', 0], ['a2', 'k2', 'B', 1]] as const) {
      b.toolUse(use, 'Agent', { description: name, prompt: 'p' }, 'm1', index);
      b.emit('subagent.started', { taskId: task(taskName), toolUseId: tool(use), description: name, subagentType: null, isBackground: true, spawnDepth: 1, prompt: null });
    }
    b.emit('subagent.progress', { taskId: task('k2'), description: 'B', usage: { totalTokens: 1, toolUses: 1, durationMs: 1 }, lastToolName: 'Read', summary: null });
    b.emit('subagent.finished', { taskId: task('k1'), status: 'failed', summary: null, outputFile: null, reason: 'boom' });
    const mixed = find(rows(b.events), 'subagent');
    expect(mixed).toMatchObject({ status: 'working', sentence: 'A and B started working' });
    b.emit('subagent.finished', { taskId: task('k2'), status: 'completed', summary: null, outputFile: null, reason: null });
    expect(find(rows(b.events), 'subagent')).toMatchObject({ status: 'finished_with_errors', sentence: 'A and B finished with errors' });
  });

  it('two Agent calls of one message merge only when consecutive: a tool call between them makes two subagent rows', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('a1', 'Agent', { description: 'A', prompt: 'p' }, 'm1', 0);
    b.emit('subagent.started', { taskId: task('k1'), toolUseId: tool('a1'), description: 'A', subagentType: null, isBackground: true, spawnDepth: 1, prompt: null });
    b.toolUse('t1', 'Bash', { command: 'x' }, 'm1', 1);
    b.result('t1', 'ok');
    b.toolUse('a2', 'Agent', { description: 'B', prompt: 'p' }, 'm1', 2);
    b.emit('subagent.started', { taskId: task('k2'), toolUseId: tool('a2'), description: 'B', subagentType: null, isBackground: true, spawnDepth: 1, prompt: null });
    b.toolUse('a3', 'Agent', { description: 'C', prompt: 'p' }, 'm1', 3);
    b.emit('subagent.started', { taskId: task('k3'), toolUseId: tool('a3'), description: 'C', subagentType: null, isBackground: true, spawnDepth: 1, prompt: null });
    b.end(['u1']);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'subagent', 'cell', 'subagent']);
    expect(list.filter((row) => row.kind === 'subagent').map((row) => (row as Extract<Row, { kind: 'subagent' }>).agents.map((a) => a.name))).toEqual([['A'], ['B', 'C']]);
  });

  it('a work area collapses to nothing when the turn is collapsed; the answer stays', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'a' });
    b.result('t1', 'ok');
    b.text('m2', 0, 'Done');
    b.end(['u1']);
    const state = reduce(b.events);
    const list = rowsOf(state);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'assistant_text']);
    expect(find(list, 'divider').expanded).toBe(false);
  });

  // W4 (owner's ruling): what the human answered stays in view when the turn folds, at its place among the work; the
  // text before the question is still commentary, the text after it the answer.
  it('an answered question stays in view when its turn folds, and still marks where the answer starts', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Two things first.');
    b.toolUse('t1', 'Bash', { command: 'a' });
    b.result('t1', 'ok');
    b.toolUse('q1', 'AskUserQuestion', { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }] });
    b.result('q1', 'answered', { structured: { answers: { 'Which colour?': 'Red' } } });
    b.text('m2', 0, 'Red it is.');
    b.end(['u1']);
    const list = rowsOf(reduce(b.events));
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'question', 'assistant_text']);
    expect(find(list, 'assistant_text')).toMatchObject({ id: 'text:m2:0', phase: 'answer' }); // 'Red it is.'
    expect(kinds(rows(b.events))).toEqual(['time', 'user', 'divider', 'assistant_text', 'cell', 'question', 'assistant_text']);
  });
});

describe('receipt counts', () => {
  it('aggregates files cells, counting + and - lines of the structured patch', () => {
    const b = builder();
    b.turn('u1');
    const hunk = { oldStart: 1, oldLines: 3, newStart: 1, newLines: 4, lines: [' a', '-b', '+b2', '+c', ' d'] };
    b.toolUse('t1', 'Edit', { file_path: '/p/a.ts', old_string: 'b', new_string: 'b2\nc' });
    b.result('t1', 'ok', { structured: { filePath: '/p/a.ts', structuredPatch: [hunk], userModified: false } });
    b.toolUse('t2', 'Write', { file_path: '/p/new.ts', content: 'one\ntwo' });
    b.result('t2', 'ok', { structured: { type: 'create', filePath: '/p/new.ts', content: 'one\ntwo', structuredPatch: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+one', '+two'] }], originalFile: null, userModified: false } });
    b.toolUse('t3', 'Edit', { file_path: '/p/b.ts', old_string: 'x\ny', new_string: 'z' });
    b.result('t3', 'ok'); // no structured: fall back to line counts of the input strings
    b.text('m9', 0, 'Done');
    b.end(['u1']);
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'divider', 'group', 'assistant_text', 'receipt']);
    const receipt = find(list, 'receipt');
    expect(receipt).toMatchObject({ id: rowId.receipt(turnId.ofMessage(uuid('u1'))), added: 5, removed: 3, state: 'applied' });
    expect(receipt.files).toEqual([
      { path: '/p/a.ts', change: 'update', added: 2, removed: 1, cellId: 'cell:t1' },
      { path: '/p/new.ts', change: 'create', added: 2, removed: 0, cellId: 'cell:t2' },
      { path: '/p/b.ts', change: 'update', added: 1, removed: 2, cellId: 'cell:t3' },
    ]);
    const g = group(list);
    expect(g.summary).toBe('Edited 3 files');
    expect(g.cells[0]).toMatchObject({ label: 'Edited /p/a.ts +2 −1' });
    expect(g.cells[0].detail).toMatchObject({ kind: 'edit', hunks: [hunk], added: 2, removed: 1 });
    expect(g.cells[1]).toMatchObject({ label: 'Created /p/new.ts' });
  });
});

describe('receipts name each file once', () => {
  it('two edits of one file are one entry with their counts summed; a create stays a create', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Write', { file_path: '/p/new.ts', content: 'one\ntwo' });
    b.result('t1', 'ok', { structured: { type: 'create', filePath: '/p/new.ts', structuredPatch: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: ['+one', '+two'] }], originalFile: null } });
    b.toolUse('t2', 'Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'y' });
    b.result('t2', 'ok');
    b.toolUse('t3', 'Edit', { file_path: '/p/new.ts', old_string: 'two', new_string: 'two\nthree' });
    b.result('t3', 'ok');
    b.end(['u1']);
    const receipt = find(rows(b.events), 'receipt');
    expect(receipt.files).toEqual([
      { path: '/p/new.ts', change: 'create', added: 4, removed: 1, cellId: 'cell:t1' },
      { path: '/p/a.ts', change: 'update', added: 1, removed: 1, cellId: 'cell:t2' },
    ]);
    expect(receipt).toMatchObject({ added: 5, removed: 2 });
  });
});

describe('receipts aggregate successful edits only', () => {
  it('a failed edit cell contributes no receipt entry', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Edit', { file_path: '/p/a.ts', old_string: 'x', new_string: 'y' });
    b.result('t1', 'String to replace not found in file.', { isError: true });
    b.end(['u1']);
    expect(kinds(rows(b.events))).toEqual(['time', 'user', 'divider', 'cell']);
    b.toolUse('t2', 'Edit', { file_path: '/p/b.ts', old_string: 'x', new_string: 'y' });
    b.result('t2', 'ok');
    const list = rows(b.events);
    expect(find(list, 'receipt').files.map((f) => f.path)).toEqual(['/p/b.ts']);
  });
});

describe('time separators', () => {
  it('separate human turns after an hour and engine turns after ten minutes, labelled', () => {
    configureTime({ now: '2026-09-28T15:00:00.000Z', locale: 'en-US', timeZone: 'UTC' });
    const b = builder('2026-09-28T10:00:00.000Z');
    b.turn('u1');
    b.text('m1', 0, 'One');
    b.end(['u1']);
    b.tick(30 * 60_000);
    b.turn('u2');
    b.text('m2', 0, 'Two');
    b.end(['u2']);
    b.tick(61 * 60_000);
    b.turn('u3');
    b.text('m3', 0, 'Three');
    b.end(['u3']);
    b.tick(11 * 60_000);
    b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
    b.text('m4', 0, 'Four');
    b.end([], { origin: 'task-notification' });
    const list = rows(b.events);
    expect(kinds(list)).toEqual(['time', 'user', 'assistant_text', 'user', 'assistant_text', 'time', 'user', 'assistant_text', 'time', 'divider', 'assistant_text']); // the engine turn's divider
    expect(find(list, 'time', 0)).toMatchObject({ id: rowId.time(turnId.ofMessage(uuid('u1'))), label: 'Today 10:00 AM' });
    expect(find(list, 'time', 1).label).toBe('Today 11:31 AM');
  });
});

describe('API diagnostics outside the work fold', () => {
  it.each([false, true])('keeps a fatal envelope visible but folds transient retries (streamed %s)', (streamed) => {
    const b = builder();
    b.turn('u1');
    b.emit('api.retry', { attempt: 1, maxRetries: 3, retryDelayMs: 500, errorStatus: 529, error: 'overloaded' });
    if (streamed) b.emit('assistant.block.delta', { apiMessageId: api('failure'), blockIndex: 0, blockType: 'text', textDelta: 'Authentication', thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
    b.text('failure', 0, 'Authentication unavailable.', { isApiErrorMessage: true, error: 'authentication_failed', model: '<synthetic>' });
    b.end(['u1'], { result: 'error_during_execution', isError: true });

    const state = reduce(b.events);
    const folded = rowsOf(state);
    expect(folded.filter((row) => row.kind === 'error')).toEqual([
      expect.objectContaining({ turnId: state.order[0], scope: 'api', severity: 'error', text: 'Authentication unavailable.' }),
    ]);
    expect(find(folded, 'divider')).toMatchObject({ state: 'failed', expanded: false });
    expect(folded.some((row) => row.kind === 'assistant_text')).toBe(false);
    expect(rowsOf(withAllExpanded(state)).filter((row) => row.kind === 'error').map((row) => row.severity)).toEqual(['transient', 'error']);
  });
});

describe('turn summary', () => {
  it('counts by category, denials, safeguard verdicts and the child agents', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'a' });
    b.result('t1', 'ok', { safeguard: 'not_flagged' });
    b.toolUse('t2', 'Edit', { file_path: '/x', old_string: 'a', new_string: 'b' });
    b.result('t2', 'ok', { safeguard: 'flagged' });
    b.toolUse('t3', 'Bash', { command: 'c' });
    b.result('t3', 'no', { isError: true, denial: 'permission-rule' });
    b.toolUse('a1', 'Agent', { description: 'Survey', prompt: 'p' });
    b.emit('subagent.started', { taskId: task('k1'), toolUseId: tool('a1'), description: 'Survey', subagentType: null, isBackground: false, spawnDepth: 1, prompt: null });
    b.end(['u1'], { costUsd: 0.25, durationMs: 134_000 });
    const state = reduce(b.events);
    const summary = turnSummary(state.turns.get(state.order[0])!);
    expect(summary).toMatchObject({
      durationMs: 134_000, toolCalls: 3, byCategory: { mcp: 0, skills: 0, files: 1, exploration: 0, commands: 2, web: 0, other: 0 },
      autoDenied: 0, safeguard: { reviewed: 2, flagged: 1, notEvaluated: 1 }, costUsd: 0.25, model: 'claude-test', childAgents: 1, terminalReason: 'completed',
    });
    expect(summary.denials).toEqual([{ kind: 'permission-rule', cellId: 'cell:t3', disposition: 'denied', interruption: false }]);
  });
});

// A child's own slice carries no turn.ended; the parent's finish event naming the child, delivered into the slice by
// the child source, closes the child's open turn so its divider settles (Child source provenance, M5 fix round 1).
describe('child turn closure', () => {
  const AGENT = 'ad286defbc77bc090';
  function child(status: 'completed' | 'failed' | 'stopped', end: 'subagent.finished' | 'task.notification') {
    const b = builder();
    b.toolUse('c1', 'Read', { file_path: '/p/one.txt' }, 'c1', 0);
    b.result('c1', 'ONE');
    b.text('c2', 0, 'ONE');
    b.tick(2000);
    if (end === 'subagent.finished') b.emit('subagent.finished', { taskId: task(AGENT), status, summary: 'ONE', outputFile: null, reason: null });
    else b.emit('task.notification', { taskId: task(AGENT), toolUseId: tool('t1'), status, summary: 'ONE', outputFile: null, reason: null });
    return b.events;
  }
  const childRows = (events: SessionEvent[]) => rowsOf(withAllExpanded(applyEvents(createState(null, AGENT as never), events)));

  it('is working until the parent reports the child finished, then reads the finish', () => {
    const events = child('completed', 'subagent.finished');
    expect(find(childRows(events.slice(0, -1)), 'divider').state).toBe('working');
    const list = childRows(events);
    expect(find(list, 'divider')).toMatchObject({ state: 'completed', origin: 'human', endedAt: events.at(-1)!.at });
    expect(kinds(list)).not.toContain('subagent'); // the finish event is no row of the child's own
  });

  it.each([
    ['completed', 'task.notification', 'completed'],
    ['failed', 'subagent.finished', 'failed'],
    ['stopped', 'task.notification', 'stopped'],
  ] as const)('%s via %s settles the divider as %s', (status, end, state) => {
    expect(find(childRows(child(status, end)), 'divider').state).toBe(state);
  });

  it('the parent’s process.exited closes the child’s open turn as stopped, and is no row of the child’s', () => {
    const events = child('completed', 'subagent.finished').slice(0, -1);
    const exit = builder('2026-09-28T10:00:09.000Z').emit('process.exited', { code: null, signal: 'SIGKILL', reason: 'crash', lostAttentionCount: 0, budget: null /* C12 */ }, { id: 'exit' });
    const list = childRows([...events, exit]);
    expect(find(list, 'divider')).toMatchObject({ state: 'stopped', endedAt: exit.at });
    expect(kinds(list)).not.toContain('error');
  });

  it('another agent’s finish closes nothing', () => {
    const events = child('completed', 'subagent.finished').map((event) => (event.kind === 'subagent.finished' ? { ...event, taskId: task('another') } : event));
    expect(find(childRows(events), 'divider').state).toBe('working');
  });
});

// W1 (A2): what the session view shows around the derived rows: the held messages at the tail, dimmed with their
// caption, and no bubble for a steer held back into MAWS's queue (the engine reports it cancelled).
describe('the queue tail', () => {
  it('appends held messages as dimmed tail bubbles and hides a withdrawn steer’s dropped bubble, nothing else', () => {
    const b = builder();
    b.turn('u1', 'count slowly');
    b.emit('user.message', { messageUuid: uuid('s1'), content: 'look at b too', isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    b.emit('command.lifecycle', { commandUuid: uuid('s1'), state: 'cancelled' });
    const rows = rowsOf(applyEvents(createState(null, null), b.events));
    const dropped = rows.find((row) => row.kind === 'user' && row.messageUuid === 's1');
    expect(dropped).toMatchObject({ dropped: true });
    const held = heldRow({ queueId: 'q-1', content: 'look at b too', createdAt: '2026-09-28T10:00:09.000Z' });
    expect(held).toMatchObject({ id: 'held:q-1', kind: 'user', turnId: null, pending: 'held', editable: false, text: 'look at b too', messageUuid: null });
    const shown = withQueueTail(rows, new Set(['s1']), [held]);
    expect(shown.filter((row) => row.kind === 'user').map((row) => row.id)).toEqual(['user:u1', 'held:q-1']);
    expect(withQueueTail(rows, new Set(['u1']), [])).toEqual(rows); // a prompt that ran is never hidden
    expect(withQueueTail(rows, new Set(), [])).toBe(rows);
  });
});

// R1 (charter D-9 as amended 2026-10-01): what a plugin says through the engine.
describe('plugins: log lines, load issues and pinned status lines', () => {
  const errors = (list: Row[]) => list.filter((row): row is Extract<Row, { kind: 'error' }> => row.kind === 'error');

  it('a log line is a dim notice under the plugin’s name at its arrival position, in view when its turn folds, and no work of the turn', () => {
    const b = builder();
    b.emit('plugin.log', { plugin: 'mods-probe', text: 'before any turn' });
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'a', { structured: BASH_RESULT('a') });
    b.emit('plugin.log', { plugin: 'mods-probe', text: 'during the work' });
    b.text('m1', 0, 'Done');
    b.end(['u1']);
    b.emit('plugin.log', { plugin: 'mods-probe', text: 'after the turn' });
    const expanded = rows(b.events);
    expect(kinds(expanded)).toEqual(['time', 'error', 'user', 'divider', 'cell', 'error', 'assistant_text', 'error']);
    expect(errors(expanded).map(({ text, severity, scope, turnId: turn }) => ({ text, severity, scope, turn }))).toEqual([
      { text: 'mods-probe: before any turn', severity: 'notice', scope: 'plugin', turn: null },
      { text: 'mods-probe: during the work', severity: 'notice', scope: 'plugin', turn: turnId.ofMessage(uuid('u1')) },
      { text: 'mods-probe: after the turn', severity: 'notice', scope: 'plugin', turn: null },
    ]);
    expect(find(expanded, 'assistant_text')).toMatchObject({ phase: 'answer' }); // the log line after the work is not work
    const folded = rowsOf(reduce(b.events)); // the completed turn folds its work area; the plugin's line stays
    expect(kinds(folded)).toEqual(['time', 'error', 'user', 'divider', 'error', 'assistant_text', 'error']);
  });

  it('a turn whose only rows are a plugin’s gets no work divider', () => {
    const b = builder();
    b.turn('u1');
    b.emit('plugin.log', { plugin: 'p', text: 'prompt seen' });
    b.text('m1', 0, 'Hi');
    b.end(['u1']);
    expect(kinds(rows(b.events))).toEqual(['time', 'user', 'error', 'assistant_text']);
  });

  it('a load issue every init repeats is one notice per session, named by the plugin: an error, or a dim notice for a warning', () => {
    const b = builder();
    const issues = () => {
      b.emit('plugin.load_issue', { plugin: 'broken@market', level: 'error', message: 'hooks module failed to compile' });
      b.emit('plugin.load_issue', { plugin: 'shadowed@market', level: 'warning', message: 'commands/ shadowed by the manifest' });
    };
    b.turn('u1');
    issues();
    b.text('m1', 0, 'One');
    b.end(['u1']);
    b.turn('u2');
    issues();
    b.emit('plugin.load_issue', { plugin: 'broken@market', level: 'error', message: 'a different failure' });
    b.text('m2', 0, 'Two');
    b.end(['u2']);
    expect(errors(rows(b.events)).map(({ text, severity, turnId: turn }) => [text, severity, turn])).toEqual([
      ['Plugin broken@market failed to load · hooks module failed to compile', 'error', turnId.ofMessage(uuid('u1'))],
      ['Plugin shadowed@market warned while loading · commands/ shadowed by the manifest', 'notice', turnId.ofMessage(uuid('u1'))],
      ['Plugin broken@market failed to load · a different failure', 'error', turnId.ofMessage(uuid('u2'))],
    ]);
  });

  it('a status line is state, never a row: the most recent last, \'\' clears it, the process exiting clears them all, and the rows keep their identity', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Hi');
    b.end(['u1']);
    let state = reduce(b.events);
    const before = rowsOf(state);
    const more = builder('2026-09-28T10:01:00.000Z');
    const status = (plugin: string, text: string) => more.emit('plugin.status', { plugin, text }, { id: `s-${more.events.length}` });
    status('alpha', 'one');
    status('beta', 'two');
    status('alpha', 'three');
    state = applyEvents(state, more.events);
    expect(rowsOf(state)).toBe(before);
    expect([...state.pluginStatus].map(([plugin, line]) => [plugin, line.text])).toEqual([['beta', 'two'], ['alpha', 'three']]);
    state = applyEvents(state, [{ ...more.events[0]!, id: 's-clear' as never, text: '' } as SessionEvent]);
    expect([...state.pluginStatus.keys()]).toEqual(['beta']);
    state = applyEvents(state, [{ ...more.events[0]!, id: 'exit' as never, kind: 'process.exited', code: 0, signal: null, reason: 'stop', lostAttentionCount: 0, budget: null } as unknown as SessionEvent]);
    expect(state.pluginStatus.size).toBe(0);
  });
});

// E7 start (E7 execution document, Design §4; Decision Log 17, 28 and 29): the messages between sessions and agents, and
// the listing. The fixture-level proof, live and from disk, is fixtures.test.ts's `cross-session rows (E7)`.
describe('cross-session rows (E7)', () => {
  const B = 'uds:/tmp/cc-socks/1.sock';
  const ENVELOPE = `Another Claude session sent a message:\n<cross-session-message from="${B}" from-name="repo-b" from-mode="prompting">\nhello from B\n</cross-session-message>\n\nThis came from another Claude session.`;
  const peerTurn = (b: ReturnType<typeof builder>, text: string, payload: Partial<Extract<SessionEvent, { kind: 'peer.message' }>> = {}, synthetic = true) => {
    b.emit('turn.started', { userMessageUuid: null, origin: 'peer' });
    b.emit('user.message', { messageUuid: uuid('p1'), content: ENVELOPE, isReplay: true, isSynthetic: synthetic, origin: 'peer', bash: null });
    b.emit('peer.message', { messageUuid: uuid('p1'), from: B, fromSession: null, fromName: 'repo-b', fromMode: 'prompting', fromPlugin: null, hopChain: [], text, midTurn: false, lineage: 'peer', replyable: true, ...payload });
  };
  const messages = (list: Row[]) => list.filter((row): row is Extract<Row, { kind: 'agent_message' }> => row.kind === 'agent_message');
  const agentTurn = (b: ReturnType<typeof builder>) => {
    b.turn('u1');
    b.toolUse('ag1', 'Agent', { description: 'Survey src', name: 'scout', subagent_type: 'general-purpose', prompt: 'go' });
    b.result('ag1', 'Async agent launched', { structured: { status: 'async_launched', agentId: 'a1' } });
    b.emit('subagent.started', { taskId: task('a1'), toolUseId: tool('ag1'), description: 'Survey src', subagentType: 'general-purpose', isBackground: true, spawnDepth: 1, prompt: 'go' });
    b.end(['u1']);
  };

  it('draws a message from another session as a between row with its sender, preview and reply address, and no bubble', () => {
    const b = builder();
    peerTurn(b, 'hello from B');
    b.text('m1', 0, 'Got it');
    b.end([], { origin: 'peer' });
    const list = rows(b.events);
    expect(list.filter((row) => row.kind === 'user')).toEqual([]);
    const [row] = messages(list);
    expect(row).toMatchObject({
      direction: 'between', from: null, to: null, text: 'Message from repo-b: hello from B',
      peer: { sender: { name: 'repo-b', address: B, session: null }, recipient: null, body: 'hello from B', preview: 'hello from B', replyTo: B, toolUseId: null, messageUuid: 'p1', result: null, resultText: null, summary: null },
    });
    expect(find(list, 'assistant_text')).toMatchObject({ phase: 'answer', markdown: 'Got it' });
  });

  it('keeps the inbound row in view once its turn folds, cuts the preview to the first line, and names an unnamed sender from its address', () => {
    const long = `${'x'.repeat(130)}\nsecond line`;
    const b = builder();
    peerTurn(b, long, { fromName: null, replyable: false });
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'a', { structured: BASH_RESULT('a') });
    b.end([], { origin: 'peer' });
    const folded = rowsOf(reduce(b.events));
    expect(folded.map((row) => row.kind)).toEqual(['time', 'divider', 'agent_message']);
    const [row] = messages(folded);
    expect(row!.peer).toMatchObject({ sender: { name: null, address: B }, body: long, preview: `${'x'.repeat(119)}…`, replyTo: null });
    expect(row!.text).toBe(`Message from 1: ${'x'.repeat(119)}…`);
  });

  it('draws a non-synthetic envelope as its row and no bubble; a peer text the parser refuses keeps its bubble', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.emit('user.message', { messageUuid: uuid('p1'), content: ENVELOPE, isReplay: true, isSynthetic: false, origin: 'peer', bash: null });
    b.emit('peer.message', { messageUuid: uuid('p1'), from: B, fromSession: null, fromName: 'repo-b', fromMode: null, fromPlugin: null, hopChain: [], text: 'hello from B', midTurn: true, lineage: 'peer', replyable: true });
    b.emit('user.message', { messageUuid: uuid('p2'), content: 'a peer text in no envelope', isReplay: true, isSynthetic: false, origin: 'peer', bash: null });
    b.end(['u1']);
    const list = rows(b.events);
    expect(list.filter((row) => row.kind === 'user').map((row) => row.kind === 'user' && row.text)).toEqual(['prompt u1', 'a peer text in no envelope']);
    expect(messages(list).map((row) => row.text)).toEqual(['Message from repo-b: hello from B']);
  });

  it('draws a SendMessage to another session between, naming a sender this transcript heard from, pending until its result, failed on `success: false` or an error', () => {
    const b = builder();
    peerTurn(b, 'hello from B');
    b.end([], { origin: 'peer' });
    b.turn('u2');
    b.toolUse('s1', 'SendMessage', { to: B, message: 'reply\nmore', summary: 'Answer B' });
    b.result('s1', '{"success":true}', { structured: { success: true, message: 'delivered' } });
    b.toolUse('s2', 'SendMessage', { to: 'nobody', message: 'hi' });
    b.result('s2', '{"success":false}', { structured: { success: false, message: "No agent named 'nobody' is reachable." } });
    b.toolUse('s3', 'SendMessage', { to: 'peer-c', message: 'x' });
    b.result('s3', '<tool_use_error>InputValidationError: bad</tool_use_error>', { isError: true });
    b.toolUse('s4', 'SendMessage', { to: 'peer-d', message: 'waiting' });
    b.toolUse('s5', 'SendMessage', { to: 'uds:/tmp/cc-socks/2.sock', message: 'unnamed' }); // labelled as the view labels it
    b.end(['u2']);
    const outbound = messages(rows(b.events)).slice(1);
    expect(outbound.map((row) => [row.direction, row.text, row.peer?.recipient, row.peer?.result, row.peer?.resultText, row.peer?.summary, row.peer?.toolUseId])).toEqual([
      ['between', 'Sent to repo-b: reply', { name: 'repo-b', address: B }, 'sent', null, 'Answer B', 's1'],
      ['between', 'Sent to nobody: hi', { name: null, address: 'nobody' }, 'failed', "No agent named 'nobody' is reachable.", null, 's2'],
      ['between', 'Sent to peer-c: x', { name: null, address: 'peer-c' }, 'failed', 'InputValidationError: bad', null, 's3'],
      ['between', 'Sent to peer-d: waiting', { name: null, address: 'peer-d' }, 'pending', null, null, 's4'],
      ['between', 'Sent to 2: unnamed', { name: null, address: 'uds:/tmp/cc-socks/2.sock' }, 'pending', null, null, 's5'],
    ]);
    expect(outbound[0]!.peer).toMatchObject({ sender: null, body: 'reply\nmore', preview: 'reply', replyTo: null });
    const folded = messages(rowsOf(reduce(b.events)));
    expect(folded.map((row) => row.text)).toEqual(['Message from repo-b: hello from B']); // outbound rows are work
  });

  it('keeps a SendMessage to a subagent this transcript knows to_child with the agent as `to` (task id, agent id or real name); main and parent are from_child', () => {
    const b = builder();
    agentTurn(b);
    b.turn('u2');
    b.toolUse('s1', 'SendMessage', { to: 'a1', message: 'by id' });
    b.toolUse('s2', 'SendMessage', { to: 'scout', message: 'by name' });
    b.toolUse('s3', 'SendMessage', { to: 'main', message: 'up' });
    b.toolUse('s4', 'SendMessage', { to: 'parent', message: 'up too' });
    b.end(['u2']);
    const list = messages(rows(b.events));
    expect(list.map((row) => [row.direction, row.text, row.to?.taskId ?? null, row.peer])).toEqual([
      ['to_child', 'Sent message to a1: by id', 'a1', undefined],
      ['to_child', 'Sent message to scout: by name', 'a1', undefined],
      ['from_child', 'Message from main: up', null, undefined],
      ['from_child', 'Message from parent: up too', null, undefined],
    ]);
    expect(list[0]!.to).toEqual({ taskId: 'a1', agentId: 'a1', toolUseId: 'ag1', name: 'Survey src', glyph: list[0]!.to!.glyph, kind: 'agent', subagentType: 'general-purpose' });
  });

  it('reads a hand-back as Report from the agent with its report, kept in view; a plain message from an agent names it and stays work', () => {
    const report = '[Subagent hand-back] The text below is the final report of a subagent. The report follows:\n  line one\n  \n  line two';
    const b = builder();
    agentTurn(b);
    b.emit('turn.started', { userMessageUuid: null, origin: 'peer' });
    b.emit('subagent.message', { direction: 'from_child', fromAgentId: 'a1' as never, toAgentId: null, text: report });
    b.emit('subagent.message', { direction: 'from_child', fromAgentId: 'a1' as never, toAgentId: null, text: 'a plain note' });
    b.emit('subagent.message', { direction: 'from_child', fromAgentId: 'a9' as never, toAgentId: null, text: 'from a stranger' });
    b.emit('subagent.message', { direction: 'from_child', fromAgentId: 'a1' as never, toAgentId: null, text: 'first line\nsecond line' });
    b.end([], { origin: 'peer' });
    const list = messages(rows(b.events));
    expect(list.map((row) => [row.direction, row.text, row.from?.taskId ?? null, row.report, row.body])).toEqual([
      ['from_child', 'Report from Survey src', 'a1', 'line one\n\nline two', undefined],
      ['from_child', 'Message from Survey src: a plain note', 'a1', undefined, undefined],
      ['from_child', 'Message from a9: from a stranger', null, undefined, undefined],
      ['from_child', 'Message from Survey src: first line', 'a1', undefined, 'first line\nsecond line'], // the preview, the body behind it
    ]);
    expect(messages(rowsOf(reduce(b.events))).map((row) => row.text)).toEqual(['Report from Survey src']);
  });

  it('draws ListAgents as a listing row: pending, then the self line, sections and notes; an unknown text is notes', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('l1', 'ListAgents', {});
    expect(find(rows(b.events), 'agent_list')).toMatchObject({ id: 'agents:l1', toolUseId: 'l1', self: null, sections: [], notes: [], raw: '', pending: true });
    const text = 'This session is repo-a [804260] — the name other sessions use to message it.\n\nSubagents (1):\n  scout [15083b]  ·  general-purpose  ·  running\n\nPeer sessions (2):\n  repo-b [61303a]  ·  interactive  ·  idle\n  (… 1 more not shown)';
    b.result('l1', text);
    b.toolUse('l2', 'ListAgents', {});
    b.result('l2', 'Messaging is off in this session.');
    b.text('m9', 0, 'Done');
    b.end(['u1']);
    const list = rows(b.events);
    expect(list.filter((row) => row.kind === 'agent_list').map((row) => row.kind === 'agent_list' && { self: row.self, sections: row.sections, notes: row.notes, raw: row.raw, pending: row.pending })).toEqual([
      {
        self: 'repo-a [804260]', raw: text, pending: false, notes: ['(… 1 more not shown)'],
        sections: [
          { title: 'Subagents', count: 1, rows: [{ name: 'scout', ref: '15083b', extras: ['general-purpose', 'running'] }] },
          { title: 'Peer sessions', count: 2, rows: [{ name: 'repo-b', ref: '61303a', extras: ['interactive', 'idle'] }] },
        ],
      },
      { self: null, sections: [], notes: ['Messaging is off in this session.'], raw: 'Messaging is off in this session.', pending: false },
    ]);
    expect(list.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : [])).map((cell) => cell.toolName)).not.toContain('ListAgents');
    expect(find(list, 'assistant_text')).toMatchObject({ phase: 'answer' }); // the listing is work, before the answer
    expect(rowsOf(reduce(b.events)).some((row) => row.kind === 'agent_list')).toBe(false); // folded with the work
  });
});
// E7 end
