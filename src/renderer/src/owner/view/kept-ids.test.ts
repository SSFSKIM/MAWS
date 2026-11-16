// The ids the transcript keeps a row under (UX wave U2b; the execution document, Interfaces §M, "Where the ids and the
// inputs come from"; reported point 25 as ruled): `keptIdsOf` reads what each row's own ask reads, so a stored run's
// bounds (a call's tool-use id, a text's or a delivery's uuid, as the to-human mod's tracker names them) are placed on
// the row that asks under them. Where a row's ask names an id of its own making, the two differ, and each case says so:
// a run's ask, and a call that joins runs asking as its run (§E, "A call's ask never changes kind"), go under
// `group:<first call>`, which names no row of the transcript file; `keptIdsOf` answers the calls the ask carries.
// Then real events through the real derivation and the real mirror, with a stored-runs file in the mod's own form
// (`{"shape":2,"runs":[[first, last, summary], …]}`, as check 1's scratch run left it), read by MAWS's own reader. Every
// text is invented.
import { describe, expect, it } from 'vitest';
import { storedRunsOf } from '@shared/owner/folds';
import { mergeReads } from '../../transcript/model/cells';
import { rowsOf } from '../../transcript/model/derive';
import { applyEvents, createState, withUi, type TranscriptState, type TurnState } from '../../transcript/model/reduce';
import type { Cell, Row, TurnId } from '../../transcript/model/rows';
import { BASH_RESULT, builder, uuid } from '../../transcript/model/test-events';
import { arrivalInput, assistantInput, callInput, groupInput, questionInput, sentInput, standaloneRunInput, thinkingInput, toolInputs, userInput } from '../../transcript/surface/adapters';
import { keptIdsOf, labelsOf } from './label';
import { liveMarkedRowIds, mirrorRows } from './mirror';

// Every row kind, so a kind added to the rows fails to compile here until this test says what it is kept under.
const KINDS: Record<Row['kind'], true> = {
  time: true, user: true, assistant_text: true, divider: true, group: true, cell: true, receipt: true, subagent: true, agent_message: true, thinking: true, plan: true, question: true,
  request_slot: true, error: true, gap: true, boundary: true, bash: true, notice: true, local_command: true, ask: true, delivery: true, side_thread: true, agent_list: true, artifact: true,
  browser_action: true, browser_activity: true, record_fold: true, to_human: true, activity: true,
};

const lane = (state: TranscriptState) => withUi(state, { ...state.ui, ownerLane: true, noTurnFold: true, version: state.ui.version + 1, global: state.ui.global + 1 });
const derived = (b: ReturnType<typeof builder>) => {
  const state = lane(applyEvents(createState(null, null), b.events));
  return { state, rows: rowsOf(state) };
};
const turnOf = (state: TranscriptState, row: Row): TurnState | undefined => (row.turnId === null ? undefined : state.turns.get(row.turnId));

const INBOX = 'Another Claude session sent a message:\n<cross-session-message from-name="docs">\nthe index is stale\n</cross-session-message>';
const TASK = '<task-notification>\n<task-id>bt1</task-id>\n<tool-use-id>tu-bt1</tool-use-id>\n<status>completed</status>\n<summary>Background command "count files" completed</summary>\n</task-notification>';
const taskEnd = { class: 'task' as const, taskId: 'bt1', toolUseId: 'tu-bt1', runId: 'run-1', outcome: 'completed' as const, summary: 'Background command "count files" completed', durationMs: null, outputFile: null, detail: null };
const QUESTIONS = [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }];

// One session whose rows hold every kind that asks a site: a prompt, a thought, a note, a run, a lone call, a message
// tool's call, a question, an agent listing, a message sent to another session, a marked text; a task's end in a turn
// it opened; a peer's message in a turn it opened.
function session() {
  const b = builder();
  b.turn('u1', 'Tidy the notes');
  b.thinking('k1', 0, 'Where are the notes kept?');
  b.text('c1', 0, 'Looking at the folder first.');
  b.toolUse('t1', 'Bash', { command: 'ls notes', description: 'List the notes' });
  b.result('t1', 'a.md b.md', { structured: BASH_RESULT('a.md b.md') });
  b.toolUse('t2', 'Bash', { command: 'wc -l notes/*', description: 'Count their lines' });
  b.result('t2', '12', { structured: BASH_RESULT('12') });
  b.toolUse('m1', 'mcp__to-human__message', { text: 'Two notes, twelve lines.' });
  b.result('m1', 'sent');
  b.toolUse('q1', 'AskUserQuestion', { questions: QUESTIONS });
  b.result('q1', 'answered', { structured: { answers: { 'Which colour?': 'Red' } } });
  b.toolUse('l1', 'ListAgents', {});
  b.result('l1', 'No agents.');
  b.toolUse('s1', 'SendMessage', { to: 'uds:/tmp/socks/docs.sock', message: 'The notes are tidy.', summary: 'tidy' });
  b.result('s1', 'sent');
  b.text('f1', 0, '<message>Done.</message>');
  b.end(['u1']);
  b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
  b.emit('user.message', { messageUuid: uuid('n1'), content: TASK, isReplay: true, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [taskEnd] });
  b.text('f2', 0, '<message>The count finished.</message>');
  b.end([], { origin: 'task-notification' });
  b.emit('turn.started', { userMessageUuid: null, origin: 'peer' });
  b.emit('user.message', { messageUuid: uuid('p1'), content: INBOX, isReplay: true, isSynthetic: true, origin: 'peer', bash: null });
  b.emit('peer.message', { messageUuid: uuid('p1'), from: 'uds:/tmp/socks/docs.sock', fromSession: null, fromName: 'docs', fromMode: null, fromPlugin: null, hopChain: [], text: 'the index is stale', midTurn: false, lineage: 'peer', replyable: true });
  return derived(b);
}

/** The ids the row's own ask names, read from its `…Input`: for a run, the calls it carries, as `group:` names none. */
function askedIds(row: Row, state: TranscriptState): string[] | null {
  const turn = turnOf(state, row);
  switch (row.kind) {
    case 'user': return [userInput(row, turn)!.instanceId];
    case 'assistant_text': return [assistantInput(row, turn)!.instanceId];
    case 'thinking': return [thinkingInput(row)!.instanceId];
    case 'group': return groupInput(row, turn, state.pending)!.props.calls.map((call) => call.tool_use_id);
    case 'cell': return toolInputs(row, turn).map((input) => input.instanceId);
    case 'to_human': case 'agent_list': return [callInput(row, turn)!.instanceId];
    case 'question': return [questionInput(row, turn)!.instanceId];
    case 'agent_message': return [(sentInput(row, turn, undefined) ?? arrivalInput(row, turn, { revealed: undefined, expanded: false }))!.instanceId];
    case 'notice': return [arrivalInput(row, turn, { revealed: undefined, expanded: false })!.instanceId];
    default: return null;
  }
}

describe('keptIdsOf: the id the row asks its site under, kind by kind', () => {
  const covered = new Set<Row['kind']>();

  it('through the derivation: each asking row is kept under the ids its own ask names', () => {
    const { state, rows } = session();
    for (const row of rows) {
      const asked = askedIds(row, state);
      if (asked === null) continue;
      expect(keptIdsOf(row, turnOf(state, row)), `${row.kind} ${row.id}`).toEqual(asked);
      covered.add(row.kind);
    }
    expect([...covered].sort()).toEqual(['agent_message', 'assistant_text', 'group', 'notice', 'question', 'thinking', 'to_human', 'user', 'agent_list'].sort());
    // the ids, by name: the tracker's step ids (a call's tool-use id; a text's, a thought's and a delivery's uuid)
    const ids = rows.flatMap((row) => keptIdsOf(row, turnOf(state, row)));
    expect(ids).toEqual(expect.arrayContaining(['u1', 'k1-u0', 'c1-u0', 't1', 't2', 'm1', 'q1', 'l1', 's1', 'f1-u0', 'n1', 'f2-u0', 'p1']));
  });

  it('a run asks under `group:<first call>`, an id of its own making; it is kept under the calls its ask carries', () => {
    const { state, rows } = session();
    const run = rows.find((row): row is Extract<Row, { kind: 'group' }> => row.kind === 'group')!;
    expect(groupInput(run, turnOf(state, run), state.pending)!.instanceId).toBe('group:t1');
    expect(keptIdsOf(run, turnOf(state, run))).toEqual(['t1', 't2']);
  });

  it('a lone call whose tool joins runs asks as its run, under `group:<call>`; one that never joins asks `ToolUse` under its id; both are kept under the call’s id', () => {
    const b = builder();
    b.turn('u1', 'Read it');
    b.toolUse('r1', 'Read', { file_path: '/notes/a.md' });
    b.result('r1', 'text');
    b.text('f1', 0, '<message>Read.</message>');
    b.end(['u1']);
    const { state, rows } = derived(b);
    const lone = rows.find((row): row is Extract<Row, { kind: 'cell' }> => row.kind === 'cell')!;
    expect(standaloneRunInput(lone, turnOf(state, lone), state)!.instanceId).toBe('group:r1');
    expect(keptIdsOf(lone, turnOf(state, lone))).toEqual(['r1']);
    expect(toolInputs(lone, turnOf(state, lone)).map((input) => input.instanceId)).toEqual(['r1']);
    covered.add('cell');
  });

  it('a merged read is kept under every member read’s id, the ids its ask carries', () => {
    const b = builder();
    b.turn('u1', 'Read them');
    b.toolUse('r1', 'Read', { file_path: '/notes/a.md' });
    b.result('r1', 'a');
    b.toolUse('r2', 'Read', { file_path: '/notes/b.md' });
    b.result('r2', 'b');
    b.toolUse('r3', 'Read', { file_path: '/notes/c.md' });
    b.result('r3', 'c');
    b.end(['u1']);
    const { state, rows } = derived(b);
    const cells = rows.flatMap((row): Cell[] => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));
    const merged = mergeReads(mergeReads(cells[0]!, cells[1]!), cells[2]!);
    const cell = { ...merged, kind: 'cell', turnId: rows[0]!.turnId, at: rows[0]!.at } as unknown as Extract<Row, { kind: 'cell' }>;
    expect(keptIdsOf(cell, turnOf(state, cell))).toEqual(['r1', 'r2', 'r3']);
    expect(toolInputs(cell, turnOf(state, cell)).map((input) => input.instanceId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('a browser action asks `ToolUse` under its call’s id and is kept under it', () => {
    const b = builder();
    b.turn('u1', 'Open the page');
    b.toolUse('w1', 'mcp__maws__browser_navigate', { url: 'https://example.com' });
    const { state } = derived(b);
    const row = { id: 'browser:w1', turnId: 'turn:u1' as TurnId, at: '2026-09-28T10:00:00.000Z', kind: 'browser_action', toolUseId: 'w1' } as unknown as Extract<Row, { kind: 'browser_action' }>;
    expect(keptIdsOf(row, turnOf(state, row))).toEqual([callInput(row, turnOf(state, row))!.instanceId]);
    covered.add('browser_action');
  });

  // Rows that ask no site: kept under the id the transcript file holds of them (a call's tool-use id, a record's uuid),
  // or under none where it holds none; no stored run names one, but a run that passes over such a row keeps its place.
  it.each<[Row['kind'], Record<string, unknown>, string[]]>([
    ['subagent', { agents: [{ toolUseId: 'a1' }, { toolUseId: null }] }, ['a1']],
    ['ask', { toolUseId: 'k1' }, ['k1']],
    ['plan', { toolUseId: 'p1' }, ['p1']],
    ['delivery', { toolUseId: 'd1' }, ['d1']],
    ['artifact', { toolUseId: 'x1' }, ['x1']],
    ['local_command', { messageUuid: 'lc1' }, ['lc1']],
    ['time', {}, []], ['divider', {}, []], ['receipt', {}, []], ['record_fold', { stretch: 't1', open: false }, []], ['activity', {}, []],
    ['gap', {}, []], ['boundary', {}, []], ['error', {}, []], ['side_thread', {}, []], ['request_slot', { toolUseId: 't1' }, []],
    ['browser_activity', { toolUseId: 't1' }, []], ['bash', { command: 'ls' }, []],
  ])('%s asks no site of its own', (kind, fields, ids) => {
    const row = { id: `${kind}:1`, turnId: null, at: '2026-09-28T10:00:00.000Z', kind, ...fields } as unknown as Row;
    expect(keptIdsOf(row, undefined)).toEqual(ids);
    covered.add(kind);
  });

  it('covers every row kind', () => {
    expect([...covered].sort()).toEqual(Object.keys(KINDS).sort());
  });
});

// The mod's own form of the file: one JSON object on a line, its runs as [first, last, summary].
const fileOf = (runs: [string, string, string][]) => `${JSON.stringify({ shape: 2, runs })}\n`;
/** The record lines the view draws, closed: a line's words, as `RecordFold` draws them. */
const lines = (b: ReturnType<typeof builder>, file: string) => {
  const { state, rows } = derived(b);
  const stored = storedRunsOf(file)!;
  const drawn = mirrorRows(rows, {}, liveMarkedRowIds(state), labelsOf(rows, { stored, running: false, turns: state.turns }));
  return drawn.flatMap((row) => (row.kind === 'record_fold' ? [row.label ?? 'working record'] : []));
};

describe('a stored run’s bounds, through the real derivation and the real mirror', () => {
  const reads = () => {
    const b = builder();
    b.turn('u1', 'Read the notes');
    b.toolUse('r1', 'Read', { file_path: '/notes/a.md' });
    b.result('r1', 'a');
    b.toolUse('r2', 'Read', { file_path: '/notes/b.md' });
    b.result('r2', 'b');
    b.toolUse('r3', 'Read', { file_path: '/notes/c.md' });
    b.result('r3', 'c');
    b.text('f1', 0, '<message>Three notes read.</message>');
    b.end(['u1']);
    return b;
  };

  it('a run whose last is a later read of a run of reads reads its summary (the derivation keeps each read its own call)', () => {
    expect(lines(reads(), fileOf([['r1', 'r3', 'Read the three notes']]))).toEqual(['Read the three notes']);
    expect(lines(reads(), fileOf([['r1', 'r2', 'Read the first two notes']]))).toEqual(['Read the first two notes']);
  });

  it('a run bounded by an arrival’s carrier is placed', () => {
    const b = builder();
    b.turn('u1', 'Count the files in the background');
    b.text('f1', 0, '<message>Started.</message>');
    b.end(['u1']);
    b.emit('turn.started', { userMessageUuid: null, origin: 'engine' });
    b.emit('user.message', { messageUuid: uuid('n1'), content: TASK, isReplay: true, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [taskEnd] });
    b.toolUse('t1', 'Bash', { command: 'cat count.txt', description: 'Read the count' });
    b.result('t1', '42', { structured: BASH_RESULT('42') });
    b.text('f2', 0, '<message>There are 42 files.</message>');
    b.end([], { origin: 'task-notification' });
    expect(lines(b, fileOf([['n1', 't1', 'Read the finished count: 42 files']]))).toEqual(['Read the finished count: 42 files']);
  });

  it('a bound that names nothing MAWS keeps reads working record', () => {
    expect(lines(reads(), fileOf([['toolu_elsewhere', 'r3', 'Read notes this window never held']]))).toEqual(['working record']);
    expect(lines(reads(), fileOf([['r1', 'toolu_elsewhere', 'Read notes this window never held']]))).toEqual(['working record']);
  });
});
