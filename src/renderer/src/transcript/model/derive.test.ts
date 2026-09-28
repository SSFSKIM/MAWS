import type { SessionEvent } from '@shared/graph/events';
import { afterEach, describe, expect, it } from 'vitest';
import { rowsOf, turnSummary, withAllExpanded } from './derive';
import { cellId, rowId, turnId } from './keys';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { BASH_RESULT, builder, task, tool, uuid } from './test-events';
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
    expect(kinds(list)).toEqual(['time', 'user', 'assistant_text', 'user', 'assistant_text', 'time', 'user', 'assistant_text', 'time', 'assistant_text']);
    expect(find(list, 'time', 0)).toMatchObject({ id: rowId.time(turnId.ofMessage(uuid('u1'))), label: 'Today 10:00 AM' });
    expect(find(list, 'time', 1).label).toBe('Today 11:31 AM');
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
