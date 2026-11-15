// The mirror's rule (UX wave U2b; the execution document, Interfaces §B and §C; Acceptance A13 by unit): every row of
// §B's table, one case each, named for the row; a stretch's edges and its key; the rows of no stretch (decision 11); a
// request's rows never inside a record (UC-3); one asynchronous answer stated once outside the record (R13). Rows are
// built by hand where only their kind and the fields the rule reads matter, and from events where the derivation's
// own shapes do. Every text is invented.
import { describe, expect, it } from 'vitest';
import { rowsOf } from '../../transcript/model/derive';
import { rowId } from '../../transcript/model/keys';
import { applyEvents, createState, withUi } from '../../transcript/model/reduce';
import type { Row, TurnId } from '../../transcript/model/rows';
import { BASH_RESULT, builder } from '../../transcript/model/test-events';
import { carriedKeys, holdsMessage, liveMarkedRowIds, liveMarksOf, mirrorRows, mirrorsView, reportViewOf, stretchesOf, stretchHolding, stretchKey } from './mirror';

const T1 = 'turn:u1' as TurnId;
const T2 = 'turn:u2' as TurnId;
const AT = '2026-09-28T10:00:00.000Z';
let n = 0;
const row = (kind: Row['kind'], fields: Record<string, unknown> = {}, turnId: TurnId | null = T1): Row => ({ id: `${kind}:${++n}`, turnId, at: AT, kind, ...fields }) as unknown as Row;
const prompt = (turnId: TurnId = T1) => row('user', { text: 'Go on.', steer: false }, turnId);
const text = (markdown: string, fields: Record<string, unknown> = {}) => row('assistant_text', { markdown, live: false, phase: 'commentary', blockIndex: 0, messageUuid: null, model: null, ...fields });
const cell = (toolUseId: string | null = `toolu_${++n}`, turnId: TurnId = T1) => row('cell', { toolUseId, toolName: 'Bash' }, turnId);
const divider = (turnId: TurnId, state: 'working' | 'completed' = 'completed') => ({ ...row('divider', { state }, turnId), id: rowId.divider(turnId) }) as Row;
const time = (turnId: TurnId | null = T1) => row('time', { label: 'Today' }, turnId);

/** What the view shows: each row's kind, a record line as its words, a closed head as `head`. */
const shown = (rows: readonly Row[]) => rows.map((r) => (r.kind === 'record_fold' ? (r.open ? '‹ fold' : '› record') : r.kind === 'assistant_text' && r.reportOnly ? 'head' : r.kind));
const closed = (rows: readonly Row[]) => shown(mirrorRows(rows, {}));
const opened = (rows: readonly Row[]) => shown(mirrorRows(rows, { openStretches: new Set(stretchesOf(rows).map((s) => s.key)) }));

/** A row between two prompts: in sight, or one record line in its place. */
const between = (subject: Row) => closed([prompt(), subject, prompt()])[1];

describe('§B: what stays in sight and what folds, row by row', () => {
  it.each<[string, Row, 'stays' | 'folds']>([
    ['user: a prompt, a steer, a message still waiting in the queue’s tail', row('user', { steer: true, pending: 'held' }), 'stays'],
    ['bash: the person’s own `!` command (decided here, card 3)', row('bash', { command: 'ls' }), 'stays'],
    ['assistant_text whose words are all inside messages', text('<message>The plan is A.</message>'), 'stays'],
    ['assistant_text with no message: commentary', text('Looking at the files.'), 'folds'],
    ['assistant_text with no message: an unmarked answer', text('All done.', { phase: 'answer' }), 'folds'],
    ['assistant_text with no message: a reply an interrupt cut', text('Half an ans', { cut: true }), 'folds'],
    ['to_human: a message-tool call waiting for its result', row('to_human', { toolUseId: 'toolu_m', text: 'Starting.', pending: true }), 'stays'],
    ['to_human: a message-tool call sent', row('to_human', { toolUseId: 'toolu_m', text: 'Done.', pending: false }), 'stays'],
    ['cell: a message-tool call that sent nothing (refused, failed, interrupted)', row('cell', { toolUseId: 'toolu_r', toolName: 'mcp__to-human__message' }), 'folds'],
    ['group: a run of calls', row('group', { cells: [{ id: 'cell:toolu_g', toolUseId: 'toolu_g' }] }), 'folds'],
    ['cell: a single call', cell(), 'folds'],
    ['thinking: a thought, even one with nothing around it (card 5)', row('thinking', { text: 'Weighing it.', live: false }), 'folds'],
    ['subagent: an agent or a workflow spawned', row('subagent', { agents: [], status: 'finished' }), 'stays'],
    ['agent_message: to or from a subagent, between sessions, one the agent sent', row('agent_message', { direction: 'between', text: 'Ping.' }), 'folds'],
    ['notice: a task’s end', row('notice', { class: 'task', outcome: 'completed', toolUseId: null }), 'folds'],
    ['notice: a scheduled trigger', row('notice', { class: 'schedule', outcome: null, toolUseId: null }), 'folds'],
    ['notice: the bridge’s wake', row('notice', { class: 'wake', outcome: null, toolUseId: null }), 'folds'],
    ['notice: a failed task of a spawn the transcript does not show', row('notice', { class: 'task', outcome: 'failed', toolUseId: 'toolu_elsewhere' }), 'folds'],
    ['error: an API error', row('error', { severity: 'error', scope: 'api' }), 'stays'],
    ['error: a retry line (decided here, card 3)', row('error', { severity: 'transient', scope: 'api' }), 'stays'],
    ['error: a plugin’s notice (decided here, card 3)', row('error', { severity: 'notice', scope: 'plugin' }), 'stays'],
    ['boundary', row('boundary', { boundaryKind: 'compaction' }), 'stays'],
    ['gap', row('gap', { text: 'Earlier history isn’t available' }), 'stays'],
    ['local_command', row('local_command', { text: 'ok' }), 'stays'],
    ['artifact', row('artifact', { toolUseId: 'toolu_a' }), 'stays'],
    ['delivery', row('delivery', { toolUseId: 'toolu_d' }), 'stays'],
    ['side_thread', row('side_thread', { childAppSessionId: 'child' }), 'stays'],
    ['agent_list: an agent listing (decided here, card 3)', row('agent_list', { toolUseId: 'toolu_l' }), 'folds'],
    ['browser_action (decided here, card 3)', row('browser_action', { toolUseId: 'toolu_b' }), 'folds'],
    ['browser_activity with no call of this session behind it', row('browser_activity', { toolUseId: null }, null), 'stays'],
    ['browser_activity under a call', row('browser_activity', { toolUseId: 'toolu_js' }), 'folds'],
  ])('%s', (_name, subject, expected) => {
    expect(between(subject)).toBe(expected === 'stays' ? subject.kind : '› record');
  });

  it.each(['question', 'ask', 'plan', 'request_slot'] as const)('%s never inside a record, waiting or answered (UC-3)', (kind) => {
    const fields = { question: [{ answers: null, toolUseId: 'toolu_q' }, { answers: { a: 'b' }, toolUseId: 'toolu_q' }], ask: [{ state: 'asked', toolUseId: 'toolu_q' }, { state: 'answered', toolUseId: 'toolu_q' }], plan: [{ outcome: null }, { outcome: 'approved' }], request_slot: [{ requestId: 'r1' }, { requestId: 'r2' }] }[kind];
    for (const state of fields) {
      const request = row(kind, state);
      // between two runs of work it splits them: two records, the request in sight between them
      expect(closed([prompt(), cell(), request, cell(), prompt()])).toEqual(['user', '› record', kind, '› record', 'user']);
    }
  });

  it('a mixed text heads the stretch after it: closed, its messages and one line; opened, all of it, its run, then the fold line', () => {
    const mixed = text('Looking first. <message>The plan is A.</message>');
    const rows = [prompt(), mixed, cell(), cell(), prompt()];
    expect(closed(rows)).toEqual(['user', 'head', '› record', 'user']);
    expect(opened(rows)).toEqual(['user', 'assistant_text', 'cell', 'cell', '‹ fold', 'user']);
    expect(mirrorRows(rows, {})[1]).toEqual({ ...mixed, reportOnly: true }); // the mirror alone sets it, on a copy
    expect(mixed).not.toHaveProperty('reportOnly');
  });

  it('a mixed text with nothing folding after it is a stretch of its own', () => {
    const rows = [prompt(), text('Done. <message>It works.</message> Notes follow.'), prompt()];
    expect(closed(rows)).toEqual(['user', 'head', '› record', 'user']);
    expect(opened(rows)).toEqual(['user', 'assistant_text', '‹ fold', 'user']);
  });

  it('the older marks and both message tools read as messages (§H, row 2)', () => {
    for (const markdown of ['<to-human>Read me.</to-human>', '<essential>Mind the migration.</essential>', '<need-input>Which file?</need-input>', '<insight>The reason.</insight>']) expect(between(text(markdown))).toBe('assistant_text');
    for (const name of ['mcp__to-human__message', 'mcp__maws__message']) {
      const b = builder();
      b.turn('u1');
      b.toolUse('toolu_msg', name, { text: 'Stage one is done.' });
      b.result('toolu_msg', 'sent');
      const rows = rowsOf(applyEvents(createState(null, null), b.events));
      expect(rows.some((r) => r.kind === 'to_human'), name).toBe(true);
      expect(holdsMessage(rows, ''), name).toBe(true);
    }
  });
});

describe('a stretch’s edges', () => {
  it('a turn boundary does not end a stretch: an arrival that opens a turn folds into the work around it', () => {
    const rows = [prompt(), cell(), divider(T1), time(T2), row('notice', { class: 'task', outcome: 'completed', toolUseId: null }, T2), divider(T2), cell(undefined, T2), text('<message>Both done.</message>', { turnId: T2 })];
    expect(stretchesOf(rows)).toHaveLength(1);
    expect(closed(rows).filter((kind) => kind === '› record')).toHaveLength(1);
  });

  it('a waiting request splits it', () => {
    expect(stretchesOf([prompt(), cell(), row('request_slot', { requestId: 'r1' }), cell()])).toHaveLength(2);
  });

  it('every stretch starts closed, those before the first message included (in force by time, decision 6)', () => {
    const rows = [prompt(), cell(), prompt(), cell(), text('<message>Now.</message>')];
    expect(closed(rows)).toEqual(['user', '› record', 'user', '› record', 'assistant_text']);
  });
});

describe('a stretch’s key (decision 9)', () => {
  it('is the first tool-use id of its first row, so one call becoming a run keeps it', () => {
    const single = row('cell', { id: 'cell:toolu_k1', toolUseId: 'toolu_k1' });
    const run = row('group', { cells: [{ id: 'cell:toolu_k1', toolUseId: 'toolu_k1' }, { id: 'cell:toolu_k2', toolUseId: 'toolu_k2' }] });
    expect(stretchKey(single)).toBe('toolu_k1');
    expect(stretchKey(run)).toBe('toolu_k1');
    const open = { openStretches: new Set([stretchesOf([prompt(), single])[0].key]) };
    expect(shown(mirrorRows([prompt(), run], open))).toEqual(['user', 'group', '‹ fold']); // still open
  });

  it('a merged read keeps its first read; a run that opens on a thought keys by its first call', () => {
    expect(stretchKey(row('group', { cells: [{ id: 'cell:reads:toolu_r1', toolUseId: 'toolu_r1' }] }))).toBe('toolu_r1');
    expect(stretchKey(row('group', { cells: [{ id: 'cell:think:m:0', toolUseId: null }, { id: 'cell:toolu_c', toolUseId: 'toolu_c' }] }))).toBe('toolu_c');
  });

  it('is the row’s id where its first row holds no call, and the head’s where a mixed text heads it', () => {
    const thought = row('thinking', { text: 'Hm.', live: false });
    expect(stretchesOf([prompt(), thought])[0].key).toBe(thought.id);
    const mixed = text('First. <message>A.</message>');
    expect(stretchesOf([prompt(), mixed])[0].key).toBe(mixed.id);
    expect(stretchesOf([prompt(), mixed, cell()])[0].key).toBe(mixed.id); // the work after it joins under the same key
  });
});

describe('the rows of no stretch (decision 11)', () => {
  it('a closed turn’s line is drawn in its place only while a stretch that holds a row of that turn is open', () => {
    const rows = [prompt(), divider(T1), cell(), text('<message>Done.</message>')];
    expect(closed(rows)).toEqual(['user', '› record', 'assistant_text']);
    expect(opened(rows)).toEqual(['user', 'divider', 'cell', '‹ fold', 'assistant_text']);
  });

  it('the running turn’s line is always drawn, directly after the record line that covers its place (ruling 5)', () => {
    const rows = [prompt(), divider(T1, 'working'), cell(), cell()];
    expect(closed(rows)).toEqual(['user', '› record', 'divider']);
    expect(opened(rows)).toEqual(['user', 'divider', 'cell', 'cell', '‹ fold']);
    expect(closed([prompt(), divider(T1, 'working')])).toEqual(['user', 'divider']); // nothing folded yet: in its place
  });

  it('a turn’s line whose place a closed stretch covers is drawn after that record line while another record of its turn is open', () => {
    const notice = row('notice', { class: 'task', outcome: 'completed', toolUseId: null }, T2);
    const later = cell(undefined, T2);
    const rows = [prompt(), cell(), notice, divider(T2), cell(undefined, T2), text('<message>Half.</message>', { turnId: T2 }), later];
    const second = stretchesOf(rows)[1].key;
    expect(shown(mirrorRows(rows, { openStretches: new Set([second]) }))).toEqual(['user', '› record', 'divider', 'assistant_text', 'cell', '‹ fold']);
  });

  it('a separator is drawn when the row after it is, a record line counting for its stretch’s first row', () => {
    expect(closed([time(), prompt(), cell(), time(T2), cell(undefined, T2)])).toEqual(['time', 'user', '› record']);
    expect(closed([prompt(), time(T2), cell(undefined, T2)])).toEqual(['user', 'time', '› record']);
  });
});

describe('one asynchronous answer is stated once outside the record (R13)', () => {
  const answerNotice = () => row('notice', { class: 'answer', outcome: null, toolUseId: 'toolu_q', text: 'The answer: B.' });
  const states = (rows: readonly Row[]) => rows.filter((r) => r.kind === 'notice' || (r.kind === 'question' && r.answers !== null)).length;

  it('with the receipt on the question’s row, the row states it and the notice folds with the record', () => {
    const rows = [prompt(), row('question', { toolUseId: 'toolu_q', answers: { 'Which?': 'B' } }), cell(), answerNotice(), cell()];
    const view = mirrorRows(rows, {});
    expect(states(view)).toBe(1);
    expect(shown(view)).toEqual(['user', 'question', '› record']);
    const open = mirrorRows(rows, { openStretches: new Set(stretchesOf(rows).map((s) => s.key)) });
    expect(open.map((r) => r.kind)).toEqual(['user', 'question', 'cell', 'notice', 'cell', 'record_fold']); // both rows inside the opened record's span
  });

  it('with no receipt on the question’s row, the notice is the one statement and stays', () => {
    const rows = [prompt(), row('question', { toolUseId: 'toolu_q', answers: null }), cell(), answerNotice(), cell()];
    const view = mirrorRows(rows, {});
    expect(states(view)).toBe(1);
    expect(shown(view)).toEqual(['user', 'question', '› record', 'notice', '› record']);
  });

  it('an answered or cancelled ask carries the receipt as an answered question does', () => {
    for (const state of ['answered', 'cancelled']) expect(closed([prompt(), row('ask', { toolUseId: 'toolu_q', state }), answerNotice()])).toEqual(['user', 'ask', '› record']);
    expect(closed([prompt(), row('ask', { toolUseId: 'toolu_q', state: 'asked' }), answerNotice()])).toEqual(['user', 'ask', 'notice']);
  });
});

describe('a failed task of a spawn the transcript shows stays (`promptRow`’s first clause)', () => {
  it('stays when a subagent row shows the spawn, folds when none does', () => {
    const failed = row('notice', { class: 'task', outcome: 'failed', toolUseId: 'toolu_spawn' });
    const spawn = row('subagent', { agents: [{ toolUseId: 'toolu_spawn' }], status: 'finished_with_errors' });
    expect(closed([prompt(), spawn, cell(), failed])).toEqual(['user', 'subagent', '› record', 'notice']);
  });
});

describe('the jump’s stretch, the live marks, the flag’s reading', () => {
  it('stretchHolding names the closed record that holds a row or a cell of a run, and nothing for a row in sight', () => {
    const run = row('group', { cells: [{ id: 'cell:toolu_j1', toolUseId: 'toolu_j1' }, { id: 'cell:toolu_j2', toolUseId: 'toolu_j2' }] });
    const mixed = text('First. <message>A.</message>');
    const rows = [prompt(), mixed, run, text('<message>B.</message>')];
    expect(stretchHolding(rows, 'cell:toolu_j2' as never)).toBe(mixed.id);
    expect(stretchHolding(rows, run.id)).toBe(mixed.id);
    expect(stretchHolding(rows, mixed.id)).toBeNull(); // the head is in sight
    expect(stretchHolding(rows, rows[3].id)).toBeNull();
    expect(stretchHolding(rows, 'nowhere' as never)).toBeNull();
  });

  it('a live row is marked by the live marks given, its stale markdown aside; with none given, by its own text', () => {
    const live = text('<message>Open', { live: true });
    expect(holdsMessage([live], '')).toBe(false); // a native row's first delta is not its buffer
    expect(holdsMessage([live], live.id)).toBe(true);
    expect(holdsMessage([live])).toBe(true); // a row handed in from outside carries its text
    expect(holdsMessage([text('<mess', { live: true })])).toBe(false); // a partial tag is no mark
    expect(holdsMessage([text('Plain.'), cell()])).toBe(false);
    expect(liveMarksOf('a', [live, text('Plain', { live: true })])).toBe(`a\n${live.id}`);
    expect(liveMarksOf('', [live])).toBe(live.id);
    expect(liveMarksOf('a', [])).toBe('a');
  });

  it('liveMarkedRowIds reads the store’s streaming blocks by their buffers', () => {
    const b = builder();
    b.turn('u1');
    b.emit('assistant.block.delta', { apiMessageId: 'm1' as never, blockIndex: 0, blockType: 'text', textDelta: 'Checked. <message>Both', thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
    const state = applyEvents(createState(null, null), b.events);
    expect(liveMarkedRowIds(state)).toBe(rowId.text('m1' as never, 0));
    expect(liveMarkedRowIds(undefined)).toBe('');
  });

  it('the mirror applies only while the view is in force, is the report and MAWS draws it', () => {
    const ui = { ownerLane: true, noTurnFold: true };
    expect(mirrorsView(ui)).toBe(true);
    expect(mirrorsView({ ...ui, view: 'transcript' })).toBe(false);
    expect(mirrorsView({ ...ui, noTurnFold: false })).toBe(false);
    expect(mirrorsView({ ...ui, modDraws: true })).toBe(false);
    expect(mirrorsView({ ...ui, ownerLane: false })).toBe(false);
    expect(mirrorsView(undefined)).toBe(false);
    expect(reportViewOf({ ownerLane: true })).toBe(true);
    expect(reportViewOf({ ownerLane: true, view: 'transcript' })).toBe(false);
  });
});

describe('over a derived session', () => {
  it('a lane-on session with no turn fold: one record per stretch between the prompts and messages, work opened in place', () => {
    const b = builder();
    b.turn('u1', 'Plan the table');
    b.text('m1', 0, 'Checking the tree. <message>The plan is to add the table.</message>');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.text('m2', 0, 'Unmarked closing words.');
    b.end(['u1']);
    b.turn('u2', 'And now?');
    b.toolUse('t2', 'Bash', { command: 'pwd' });
    b.result('t2', 'ok', { structured: BASH_RESULT('ok') });
    b.text('m3', 0, '<message>Done.</message>');
    b.end(['u2']);
    const state = applyEvents(createState(null, null), b.events);
    const flat = withUi(state, { ...state.ui, ownerLane: true, noTurnFold: true, version: state.ui.version + 1, global: state.ui.global + 1 });
    const rows = rowsOf(flat);
    expect(closed(rows)).toEqual(['time', 'user', 'head', '› record', 'user', '› record', 'assistant_text']);
    expect(opened(rows)).toEqual(['time', 'user', 'divider', 'assistant_text', 'cell', 'assistant_text', '‹ fold', 'user', 'divider', 'cell', '‹ fold', 'assistant_text']);
  });
});

// The whole-branch review's finding 4 (2026-11-15): a stretch the reader opened stays open while it holds a row its key
// names, whatever row now heads it. The key a press writes is the closed record line's (decision 9's key of the stretch
// as drawn then); MAWS's own derivation can then fold that row into another (a thought into the run its first call
// starts), unwrap it again (a run of one call, completed), or page older rows in above it. The session: an earlier turn
// with its own stretch, then a turn that streams an unmarked commentary, a thought, then one call, then its completion.
// The window first holds the rows from the thought on; paging up adds the turn's prompt, its commentary and all before.
describe('a stretch stays the one the reader opened', () => {
  const STEPS = ['the thought', 'the call', 'the completion'] as const;
  const COMMENTARY = rowId.text('m1' as never, 0);
  function rowsAt(step: number, textless = false): Row[] {
    const b = builder();
    b.turn('u0', 'Set it up');
    b.toolUse('t0', 'Bash', { command: 'ls' });
    b.result('t0', 'ok', { structured: BASH_RESULT('ok') });
    b.text('m0', 0, '<message>Ready.</message>');
    b.end(['u0']);
    b.turn('u1', 'Read the second file');
    b.text('m1', 0, 'Looking at the second file first.');
    if (!textless) b.thinking('m2', 0, 'Which of the two holds the answer?');
    // a thought with no text: streaming alone it has a row; finished, the derivation keeps it only inside a run
    else if (step === 0) b.emit('assistant.block.delta', { apiMessageId: 'm2' as never, blockIndex: 0, blockType: 'thinking', textDelta: null, thinkingDelta: '', inputJsonDelta: null, userMessageUuid: null });
    else b.thinking('m2', 0, '');
    if (step >= 1) b.toolUse('t1', 'Bash', { command: 'cat second.txt' }, 'm2', 1);
    if (step >= 2) {
      b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
      b.end(['u1']);
    }
    const state = applyEvents(createState(null, null), b.events);
    return rowsOf(withUi(state, { ...state.ui, ownerLane: true, noTurnFold: true, version: state.ui.version + 1, global: state.ui.global + 1 }));
  }
  const windowAt = (step: number, paged: boolean, textless = false): Row[] => {
    const rows = rowsAt(step, textless);
    return paged ? rows : rows.slice(rows.findIndex((r) => r.id === COMMENTARY) + 1);
  };
  const lines = (rows: readonly Row[]) => rows.filter((r): r is Extract<Row, { kind: 'record_fold' }> => r.kind === 'record_fold');

  it('the derivation’s own shapes: the thought alone, then inside its call’s run, then beside its one call', () => {
    expect(windowAt(0, false).map((r) => r.kind)).toEqual(['thinking']);
    expect(windowAt(1, false).map((r) => r.kind)).toEqual(['group']);
    expect(windowAt(2, false).map((r) => r.kind)).toEqual(['thinking', 'cell']);
    expect(stretchesOf(windowAt(0, false))[0].key).not.toBe(stretchesOf(windowAt(1, false))[0].key); // the key as drawn moves
    expect(stretchesOf(windowAt(2, true)).at(-1)!.key).toBe(COMMENTARY);
  });

  // Each row: the step the reader opens the stretch at, and when the window is paged up: before the opening (it opened
  // in the paged window), at a step from the opening on (right after what that step drew), or never. The reader looks
  // at every step from the opening to the end, before and after each paging.
  type Paging = 'before' | 0 | 1 | 2 | 'never';
  const timelines = STEPS.flatMap((_, opensAt) => (['before', 0, 1, 2, 'never'] as const).filter((at) => typeof at !== 'number' || at >= opensAt).map((at) => [opensAt, at] as const));
  const named = ([opensAt, paging]: readonly [number, Paging]) =>
    `opened at ${STEPS[opensAt]}, ${paging === 'before' ? 'paged up before' : paging === 'never' ? 'never paged up' : `paged up at ${STEPS[paging]}`}`;
  it.each(timelines.map((timeline) => [named(timeline), ...timeline] as const))('%s: open at every look after, and one press folds it', (_name, opensAt, paging) => {
    const looks: { step: number; paged: boolean }[] = [];
    for (let step = opensAt; step < STEPS.length; step += 1) {
      const pagedBy = paging === 'before' || (typeof paging === 'number' && paging < step);
      looks.push({ step, paged: pagedBy });
      if (paging === step) looks.push({ step, paged: true });
    }
    const first = looks[0];
    const pressed = lines(mirrorRows(windowAt(first.step, first.paged), {})).at(-1)!;
    expect(pressed.open).toBe(false);
    const openStretches = new Set([pressed.stretch]);
    for (const { step, paged } of looks) {
      const drawn = mirrorRows(windowAt(step, paged), { openStretches });
      const at = `at ${STEPS[step]}${paged ? ', paged' : ''}`;
      expect(lines(drawn).map((line) => line.open), at).toEqual(paged ? [false, true] : [true]); // the earlier turn's stays closed
      expect(drawn.at(-1)?.kind, at).toBe('record_fold'); // `‹ fold to report` under the stretch's last row
      expect(drawn.some((r) => r.kind === 'thinking' || r.kind === 'group'), at).toBe(true); // its rows in sight
    }
    // the press on `‹ fold to report` takes the key the line carries, and the stretch folds
    const last = looks.at(-1)!;
    const window = windowAt(last.step, last.paged);
    const folding = lines(mirrorRows(window, { openStretches })).at(-1)!;
    expect(folding.open).toBe(true);
    const after = new Set(openStretches);
    after.delete(folding.stretch);
    expect(lines(mirrorRows(window, { openStretches: after })).every((line) => !line.open)).toBe(true);
  });
  // The thirteenth timeline: a thought with no text, opened while it streams alone (its row's id is the key the press
  // writes), taken into its call's run, then gone when the run of one call unwraps; the opening passes to the call.
  it('a thought with no text, opened while it streams alone: open in its call’s run, and still open once the run unwraps without it', () => {
    expect(windowAt(0, false, true).map((r) => r.kind)).toEqual(['thinking']);
    expect(windowAt(2, false, true).map((r) => r.kind)).toEqual(['cell']); // the thought is gone
    const pressed = lines(mirrorRows(windowAt(0, false, true), {})).at(-1)!;
    const openStretches = new Set([pressed.stretch]);
    let before = windowAt(0, false, true);
    for (const step of [0, 1, 2]) {
      const window = windowAt(step, false, true);
      for (const key of carriedKeys(before, window, openStretches)) openStretches.add(key); // as the store's update does
      before = window;
      expect(lines(mirrorRows(window, { openStretches })).map((line) => line.open), `at ${STEPS[step]}`).toEqual([true]);
    }
  });
});
