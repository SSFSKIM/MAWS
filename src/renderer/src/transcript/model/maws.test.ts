// E1 (M3): the `maws` tool server's rows through the public reducer-to-rows pipeline. An `ask` call is a capsule whose
// state comes from its tool result, the `maws.ask.*` events and, for an async ask, the steer that carried its answers
// (residue 13); a `send_file` call is a delivery row; a `show_pane` call stays a standalone cell whose label reads what
// opened; the question row of an `AskUserQuestion` call the engine refused carries the refusal (A-17). The four recorded
// `p1-maws-*` fixtures and E0a's `p1-question-preview-html` pin the same rows over real journals.
import { describe, expect, it } from 'vitest';
import { askSteerText } from '@shared/maws/ask';
import type { AskAnswer, AskQuestion } from '@shared/maws/tools';
import { loadJournal } from '../../../../../test/support/fixtures';
import { journalToEvents } from '../dev/journal';
import { isPersistentRow, rowsOf, withAllExpanded } from './derive';
import { rowId } from './keys';
import { applyEvents, createState } from './reduce';
import type { Row } from './rows';
import { builder, request, tool, uuid, type Builder } from './test-events';

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;
const ofKind = <K extends Row['kind']>(rows: Row[], kind: K) => rows.filter((row): row is RowOf<K> => row.kind === kind);
const expandedRows = (events: Builder['events']) => rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
const foldedRows = (events: Builder['events']) => rowsOf(applyEvents(createState(null, null), events));
const capsule = (rows: Row[]) => ofKind(rows, 'ask')[0];

const ASK = 'mcp__maws__ask';
const SEND_FILE = 'mcp__maws__send_file';
const SHOW_PANE = 'mcp__maws__show_pane';
const QUESTIONS: AskQuestion[] = [
  { id: 'q1', question: 'Which colour?', modality: 'choice', options: [{ label: 'Red' }, { label: 'Blue' }] },
  { question: 'What title?', header: 'Title', modality: 'text' },
];
const FILLED: AskQuestion[] = [QUESTIONS[0], { ...QUESTIONS[1], id: 'q2' }];
const ANSWERS: AskAnswer[] = [
  { id: 'q1', question: 'Which colour?', status: 'answered', value: ['Blue'] },
  { id: 'q2', question: 'What title?', status: 'skipped' },
];
const json = (value: unknown) => [{ type: 'text', text: JSON.stringify(value, null, 2) }];

function askCall(b: Builder, id: string, input: Record<string, unknown> = { title: 'Setup', questions: QUESTIONS }) {
  b.toolUse(id, ASK, input);
}

describe('the ask capsule', () => {
  it('reads pending from its call, asked once the host opened it non-blocking, and keeps the call’s questions with ids filled', () => {
    const b = builder();
    b.turn('u1');
    askCall(b, 'toolu_a');
    const pending = capsule(expandedRows(b.events));
    expect(pending).toMatchObject({
      id: rowId.ask(tool('toolu_a')), kind: 'ask', toolUseId: 'toolu_a', askId: 'toolu_a', title: 'Setup', context: null, blocking: true, state: 'pending', answers: null, error: null,
    });
    expect(pending.questions).toEqual(FILLED);

    const c = builder();
    c.turn('u1');
    askCall(c, 'toolu_b', { blocking: false, questions: QUESTIONS });
    c.emit('maws.ask.opened', { askId: 'toolu_b', toolUseId: tool('toolu_b'), requestId: request('r1'), blocking: false, title: null, context: null, questions: FILLED });
    expect(capsule(expandedRows(c.events))).toMatchObject({ state: 'asked', blocking: false });
  });

  it('from events alone: opened then answered, with the event’s answers', () => {
    const b = builder();
    b.turn('u1');
    askCall(b, 'toolu_a');
    b.emit('maws.ask.opened', { askId: 'toolu_a', toolUseId: tool('toolu_a'), requestId: request('r1'), blocking: true, title: 'Setup', context: 'Why', questions: FILLED });
    expect(capsule(expandedRows(b.events))).toMatchObject({ state: 'pending', context: 'Why' });
    b.emit('maws.ask.answered', { askId: 'toolu_a', toolUseId: tool('toolu_a'), answers: ANSWERS, delivery: 'result' });
    expect(capsule(expandedRows(b.events))).toMatchObject({ state: 'answered', answers: ANSWERS });
  });

  it('from the tool result alone: answered, asked, or the error text', () => {
    const answered = builder();
    answered.turn('u1');
    askCall(answered, 'toolu_a');
    answered.result('toolu_a', json({ status: 'answered', askId: 'toolu_a', answers: ANSWERS }));
    expect(capsule(expandedRows(answered.events))).toMatchObject({ state: 'answered', answers: ANSWERS });

    const asked = builder();
    asked.turn('u1');
    askCall(asked, 'toolu_b', { blocking: false, questions: QUESTIONS });
    asked.result('toolu_b', json({ status: 'asked', askId: 'toolu_b' }));
    expect(capsule(expandedRows(asked.events))).toMatchObject({ state: 'asked', askId: 'toolu_b' });

    const refused = builder();
    refused.turn('u1');
    askCall(refused, 'toolu_c', { questions: [] });
    refused.result('toolu_c', 'ask: invalid arguments: questions: Too small', { isError: true });
    expect(capsule(expandedRows(refused.events))).toMatchObject({ state: 'error', error: 'ask: invalid arguments: questions: Too small', questions: [] });
  });

  it('an answered event after the capsule’s turn closed and another turn ran turns the capsule answered, in its own turn', () => {
    const b = builder();
    b.turn('u1');
    askCall(b, 'toolu_a', { blocking: false, questions: QUESTIONS });
    b.result('toolu_a', json({ status: 'asked', askId: 'toolu_a' }));
    b.end(['u1']);
    b.turn('u2', 'something else');
    b.text('m2', 0, 'Done.');
    b.end(['u2']);
    let state = applyEvents(createState(null, null), b.events);
    const before = rowsOf(state);
    expect(capsule(before)).toMatchObject({ state: 'asked', turnId: 'turn:u1' });
    const later = builder(new Date(b.at).toISOString());
    later.emit('maws.ask.answered', { askId: 'toolu_a', toolUseId: tool('toolu_a'), answers: ANSWERS, delivery: 'steer' }, { id: 'late-1' });
    state = applyEvents(state, later.events);
    const after = rowsOf(state);
    expect(capsule(after)).toMatchObject({ state: 'answered', answers: ANSWERS, turnId: 'turn:u1' });
    expect(after.indexOf(capsule(after))).toBeLessThan(after.findIndex((row) => row.kind === 'user' && row.text === 'something else'));
  });

  it('a recognised steer after the turn closed and another turn ran answers the capsule; its bubble stays a user row of its own turn', () => {
    const b = builder();
    b.turn('u1');
    askCall(b, 'toolu_a', { blocking: false, questions: QUESTIONS });
    b.result('toolu_a', json({ status: 'asked', askId: 'toolu_a' }));
    b.end(['u1']);
    b.turn('u2', 'something else');
    b.end(['u2']);
    let state = applyEvents(createState(null, null), b.events);
    const steer = askSteerText('toolu_a', FILLED, ANSWERS);
    const later = builder(new Date(b.at).toISOString());
    later.emit('turn.started', { userMessageUuid: uuid('u3'), origin: 'human' }, { id: 'late-1' });
    later.emit('user.message', { messageUuid: uuid('u3'), content: steer, isReplay: false, isSynthetic: false, origin: 'human', bash: null }, { id: 'late-2' });
    state = applyEvents(state, later.events);
    const rows = rowsOf(state);
    expect(capsule(rows)).toMatchObject({ state: 'answered', answers: ANSWERS, turnId: 'turn:u1' });
    expect(ofKind(rows, 'user').find((row) => row.turnId === 'turn:u3')).toMatchObject({ text: steer, steer: false });
  });

  it('a steer applied to the latest state leaves an earlier snapshot readable as it was: asked there, answered in the latest', () => {
    const b = builder();
    b.turn('u1');
    askCall(b, 'toolu_a', { blocking: false, questions: QUESTIONS });
    b.result('toolu_a', json({ status: 'asked', askId: 'toolu_a' }));
    b.end(['u1']);
    const before = applyEvents(createState(null, null), b.events);
    expect(capsule(rowsOf(before))).toMatchObject({ state: 'asked' }); // derived (and memoised) before the steer
    const later = builder(new Date(b.at).toISOString());
    later.emit('turn.started', { userMessageUuid: uuid('u2'), origin: 'human' }, { id: 'late-1' });
    later.emit('user.message', { messageUuid: uuid('u2'), content: askSteerText('toolu_a', FILLED, ANSWERS), isReplay: false, isSynthetic: false, origin: 'human', bash: null }, { id: 'late-2' });
    const after = applyEvents(before, later.events);
    expect(capsule(rowsOf(after))).toMatchObject({ state: 'answered', answers: ANSWERS });
    expect(capsule(rowsOf(before))).toMatchObject({ state: 'asked', answers: null });
    expect(capsule(rowsOf(withAllExpanded(before)))).toMatchObject({ state: 'asked', answers: null }); // a fresh derivation of the old snapshot too
  });

  it('a steer naming another ask, or carrying no answered block, answers nothing', () => {
    const b = builder();
    b.turn('u1');
    askCall(b, 'toolu_a', { blocking: false, questions: QUESTIONS });
    b.result('toolu_a', json({ status: 'asked', askId: 'toolu_a' }));
    b.end(['u1']);
    b.turn('u2', askSteerText('toolu_other', FILLED, ANSWERS));
    b.end(['u2']);
    b.turn('u3', '[MAWS ask toolu_a] The user answered the questions you asked:\n1. Which colour? — Blue');
    b.end(['u3']);
    expect(capsule(rowsOf(applyEvents(createState(null, null), b.events)))).toMatchObject({ state: 'asked', answers: null });
  });

  it('a cancellation arriving after the turn closed reads cancelled; an answer wins over it', () => {
    const b = builder();
    b.turn('u1');
    askCall(b, 'toolu_a', { blocking: false, questions: QUESTIONS });
    b.result('toolu_a', json({ status: 'asked', askId: 'toolu_a' }));
    b.end(['u1']);
    b.turn('u2');
    b.end(['u2']);
    b.emit('maws.ask.cancelled', { askId: 'toolu_a', toolUseId: tool('toolu_a'), reason: 'exit' });
    expect(capsule(rowsOf(applyEvents(createState(null, null), b.events)))).toMatchObject({ state: 'cancelled', cancelReason: 'exit', turnId: 'turn:u1' });
    b.emit('maws.ask.answered', { askId: 'toolu_a', toolUseId: tool('toolu_a'), answers: ANSWERS, delivery: 'steer' });
    expect(capsule(rowsOf(applyEvents(createState(null, null), b.events)))).toMatchObject({ state: 'answered', cancelReason: null });
  });

  // E1 review: an interrupted turn withdraws a blocking ask while the session lives on; the row says why it was cancelled
  it('a withdrawn ask carries its reason onto the row; only a cancelled ask has one', () => {
    const b = builder();
    b.turn('u1');
    askCall(b, 'toolu_a');
    expect(capsule(rowsOf(applyEvents(createState(null, null), b.events)))).toMatchObject({ state: 'pending', cancelReason: null });
    b.emit('maws.ask.cancelled', { askId: 'toolu_a', toolUseId: tool('toolu_a'), reason: 'withdrawn' });
    expect(capsule(rowsOf(applyEvents(createState(null, null), b.events)))).toMatchObject({ state: 'cancelled', cancelReason: 'withdrawn' });
  });

  it('a blocking ask whose turn closed with no answer and no result reads cancelled (a disk session that ended mid-ask)', () => {
    const b = builder();
    b.turn('u1');
    askCall(b, 'toolu_a');
    b.emit('process.exited', { code: 0, signal: null, reason: 'stop', lostAttentionCount: 0, budget: null });
    expect(capsule(rowsOf(applyEvents(createState(null, null), b.events)))).toMatchObject({ state: 'cancelled', cancelReason: null }); // no event says why
  });

  // M5 fix: a blocking ask lost at the exit is named a question on the exit row, beside any approval lost with it
  it('names the blocking asks the exit lost as questions on the exit row; approvals alone keep their wording', () => {
    const exitText = (lostAttentionCount: number, lostAskCount?: number) => {
      const b = builder();
      b.turn('u1');
      askCall(b, 'toolu_a');
      b.emit('process.exited', { code: 1, signal: null, reason: 'crash', lostAttentionCount, ...(lostAskCount === undefined ? {} : { lostAskCount }), budget: null });
      return ofKind(foldedRows(b.events), 'error').find((row) => row.scope === 'exit')?.text;
    };
    expect(exitText(1, 1)).toBe('Session process exited (crash) · 1 question lost');
    expect(exitText(3, 2)).toBe('Session process exited (crash) · 1 approval and 2 questions lost');
    expect(exitText(2)).toBe('Session process exited (crash) · 2 approvals lost');
  });

  it('stays in view when its turn folds, and counts as work for where the answer starts', () => {
    const b = builder();
    b.turn('u1');
    b.text('m0', 0, 'I will ask first.');
    askCall(b, 'toolu_a');
    b.result('toolu_a', json({ status: 'answered', askId: 'toolu_a', answers: ANSWERS }));
    b.text('m1', 0, 'Blue it is.');
    b.end(['u1']);
    const rows = foldedRows(b.events);
    expect(rows.filter((row) => row.kind !== 'time').map((row) => row.kind)).toEqual(['user', 'divider', 'ask', 'assistant_text']);
    expect(ofKind(rows, 'assistant_text').map((row) => [row.markdown, row.phase])).toEqual([['Blue it is.', 'answer']]);
    expect(isPersistentRow(capsule(rows))).toBe(true);
  });
});

describe('the delivery row', () => {
  it('reads the call’s files with no ids until the result names them; caption and urgency from the call', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_d', SEND_FILE, { files: ['out/report.pdf'], caption: 'the report', urgency: 'high' });
    const before = ofKind(expandedRows(b.events), 'delivery')[0];
    expect(before).toEqual({
      id: rowId.delivery(tool('toolu_d')), turnId: 'turn:u1', at: before.at, kind: 'delivery', toolUseId: 'toolu_d',
      files: [{ path: 'out/report.pdf', name: 'report.pdf', id: null }], caption: 'the report', urgency: 'high', error: null,
    });
    b.result('toolu_d', json({ status: 'delivered', deliverables: [{ id: 'd-1', path: '/repo/out/report.pdf', name: 'report.pdf' }] }));
    expect(ofKind(expandedRows(b.events), 'delivery')[0]).toMatchObject({ files: [{ path: '/repo/out/report.pdf', name: 'report.pdf', id: 'd-1' }], caption: 'the report', urgency: 'high', error: null });
  });

  it('takes the files from maws.delivery.file when present, and the error text of a refused call', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_d', SEND_FILE, { files: ['a.txt'] });
    b.emit('maws.delivery.file', { toolUseId: tool('toolu_d'), requestId: request('r1'), deliverables: [{ id: 'd-1', path: '/repo/a.txt', name: 'a.txt' }], caption: null, urgency: 'normal' });
    expect(ofKind(expandedRows(b.events), 'delivery')[0]).toMatchObject({ files: [{ path: '/repo/a.txt', name: 'a.txt', id: 'd-1' }], caption: null, urgency: 'normal' });

    const refused = builder();
    refused.turn('u1');
    refused.toolUse('toolu_e', SEND_FILE, { files: ['missing.txt'] });
    refused.result('toolu_e', 'send_file: not a file: /repo/missing.txt', { isError: true });
    expect(ofKind(expandedRows(refused.events), 'delivery')[0]).toMatchObject({ files: [{ path: 'missing.txt', name: 'missing.txt', id: null }], error: 'send_file: not a file: /repo/missing.txt' });
  });

  it('stays in view when its turn folds', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_d', SEND_FILE, { files: ['a.txt'] });
    b.result('toolu_d', json({ status: 'delivered', deliverables: [{ id: 'd-1', path: '/repo/a.txt', name: 'a.txt' }] }));
    b.text('m1', 0, 'Delivered.');
    b.end(['u1']);
    expect(foldedRows(b.events).filter((row) => row.kind !== 'time').map((row) => row.kind)).toEqual(['user', 'delivery', 'assistant_text']); // a persistent row alone is no work area: no divider
  });
});

describe('show_pane cells', () => {
  it('are standalone cells reading what opened, or why nothing did', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('toolu_1', SHOW_PANE, { pane: 'terminal' });
    b.result('toolu_1', json({ status: 'shown', pane: 'terminal', opened: { kind: 'panel-tool', toolId: 'terminal', tabId: 'terminal:1', title: 'Terminal' } }));
    b.toolUse('toolu_2', SHOW_PANE, { pane: 'file', target: 'src/a.ts', line: 3 });
    b.result('toolu_2', json({ status: 'shown', pane: 'file', opened: { kind: 'main-tab', tabId: 'file:/repo/src/a.ts', path: '/repo/src/a.ts', line: 3 } }));
    b.toolUse('toolu_3', SHOW_PANE, { pane: 'deliverable', target: 'none' });
    b.result('toolu_3', 'show_pane: the deliverable pane is not available in this build of MAWS', { isError: true });
    b.toolUse('toolu_4', SHOW_PANE, { pane: 'diff' });
    const cells = ofKind(expandedRows(b.events), 'cell');
    expect(cells.map((cell) => [cell.toolUseId, cell.status, cell.label, cell.category])).toEqual([
      ['toolu_1', 'done', 'Opened Terminal', 'other'],
      ['toolu_2', 'done', 'Opened a.ts', 'other'],
      ['toolu_3', 'error', 'Could not open pane: the deliverable pane is not available in this build of MAWS', 'other'],
      ['toolu_4', 'running', 'Opening the diff pane', 'other'],
    ]);
  });
});

describe('the question row’s refusal (A-17)', () => {
  it('carries the engine’s refusal text, tags stripped, when the engine refused the call before any request', () => {
    const rows = expandedRows(journalToEvents(loadJournal('pass3', 'p1-question-preview-html')));
    expect(ofKind(rows, 'question')[0].error).toBe('Option "A" in question "Which layout?": preview must contain HTML (previewFormat is set to "html"). Wrap content in a tag like <div> or <pre>.');
  });

  it('a question the human declined is no refusal', () => {
    const rows = expandedRows(journalToEvents(loadJournal('pass3', 'question-deny')));
    expect(ofKind(rows, 'question').map((row) => row.error)).toEqual([null]);
  });
});

describe('the recorded maws fixtures', () => {
  const fixture = (name: string) => expandedRows(journalToEvents(loadJournal('pass3', name)));

  it('p1-maws-ask-blocking: one capsule of five questions, pending at the opened event, answered at the end', () => {
    const events = journalToEvents(loadJournal('pass3', 'p1-maws-ask-blocking'));
    const opened = events.findIndex((event) => event.kind === 'maws.ask.opened');
    const pending = capsule(rowsOf(applyEvents(createState(null, null), events.slice(0, opened + 1))));
    expect(pending).toMatchObject({ state: 'pending', blocking: true });
    expect(pending.questions.map((q) => [q.id, q.modality])).toEqual([['q1', 'choice'], ['q2', 'choice'], ['q3', 'text'], ['q4', 'folder'], ['q5', 'repository']]);
    const done = capsule(fixture('p1-maws-ask-blocking'));
    expect(done.state).toBe('answered');
    expect(done.answers?.map((a) => [a.id, a.status])).toEqual([['q1', 'answered'], ['q2', 'answered'], ['q3', 'skipped'], ['q4', 'answered'], ['q5', 'decide_for_me']]);
  });

  it('p1-maws-ask-async: the capsule asked then answered across two main turns; the steer is the second turn’s prompt', () => {
    const rows = fixture('p1-maws-ask-async');
    const users = ofKind(rows, 'user');
    expect(users).toHaveLength(2);
    expect(users[1].text.startsWith('[MAWS ask toolu_016zBCDTWVXbAqbGdLyd1Zzj] ')).toBe(true);
    expect(ofKind(rows, 'divider')).toHaveLength(2);
    expect(capsule(rows)).toMatchObject({ state: 'answered', blocking: false, turnId: users[0].turnId, answers: [{ id: 'q1', question: 'Proceed?', status: 'answered', value: ['Yes'] }] });
  });

  it('p1-maws-send-file: a delivery row for hello.txt with the caption', () => {
    const [row] = ofKind(fixture('p1-maws-send-file'), 'delivery');
    expect(row).toMatchObject({ caption: 'the greeting', urgency: 'normal', error: null, files: [{ name: 'hello.txt', path: '/private/tmp/maws-e1-repo-G8SYJD/hello.txt', id: 'd7649bfe-f476-44bc-b238-10c5c7ab4aa2' }] });
  });

  it('p1-maws-show-pane: Terminal opened, the absent pane and the unknown pane as error cells', () => {
    const cells = ofKind(fixture('p1-maws-show-pane'), 'cell').filter((cell) => cell.toolName === SHOW_PANE);
    expect(cells.map((cell) => [cell.status, cell.label])).toEqual([
      ['done', 'Opened Terminal'],
      ['error', 'Could not open pane: the deliverable pane is not available in this build of MAWS'],
      ['error', 'Could not open pane: unknown pane "nope"; known panes: diff, file, terminal, tasks, deliverable, browser, source-control'],
    ]);
  });
});
