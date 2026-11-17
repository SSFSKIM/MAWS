// The answer's action row in the to-human view (UX wave U3b, M3; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-
// transcript-rows-find.md, Interfaces §C, "The statements to read again", 13). Beside the placement's own tests in
// model/answer-actions.test.ts, here because the view's projection is the renderer's (the model's tests are also
// typechecked by the node project, which does not hold it). Since the chain merge of U1c's head the projection is U2b's
// mirror (`owner/view/mirror.ts`); every case goes through the real derivation, then the mirror, then the placement.
import { describe, expect, it } from 'vitest';
import { liveMarkedRowIds, mirrorRows, stretchesOf } from '../owner/view/mirror';
import { answerActionsOf, answerMarkdownOf } from './model/answer-actions';
import { rowsOf } from './model/derive';
import { turnId as turnIdOf } from './model/keys';
import { applyEvents, createState, withUi, type TranscriptState } from './model/reduce';
import type { Row, RowId, TurnId } from './model/rows';
import { BASH_RESULT, builder, uuid } from './model/test-events';

type Builder = ReturnType<typeof builder>;

/** The session with its lane on and a message in it: the to-human view in force, no turn folding (U2b's flag). */
function toHuman(script: (b: Builder) => void): TranscriptState {
  const b = builder();
  script(b);
  const state = applyEvents(createState(null, null), b.events);
  return withUi(state, { ...state.ui, ownerLane: true, noTurnFold: true, version: state.ui.version + 1, global: state.ui.global + 1 });
}

/** What the view draws: every stretch closed, or every stretch the reader could open opened. */
function drawn(state: TranscriptState, open = false): Row[] {
  const rows = rowsOf(state);
  const openStretches = open ? new Set(stretchesOf(rows, liveMarkedRowIds(state)).map((stretch) => stretch.key)) : undefined;
  return mirrorRows(rows, { openStretches }, liveMarkedRowIds(state));
}

/** The session with every stretch the reader could open opened (the store's `openStretches`), as a press leaves it. */
function opened(state: TranscriptState): TranscriptState {
  const openStretches = new Set(stretchesOf(rowsOf(state), liveMarkedRowIds(state)).map((stretch) => stretch.key));
  return withUi(state, { ...state.ui, openStretches, version: state.ui.version + 1, global: state.ui.global + 1 });
}

/** Where the action rows stand in what the view draws, as the view places them: by the drawn rows, told the rows
 *  before the view's fold. Each entry: the row's markdown and what its Copy takes, read from the store at the press. */
function placed(state: TranscriptState): { on: string; copies: string }[] {
  const rows = mirrorRows(rowsOf(state), state.ui, liveMarkedRowIds(state));
  return [...answerActionsOf(rows, [], rowsOf(state))].map(([id, action]) => {
    const row = rows.find((candidate) => candidate.id === id)!;
    return { on: row.kind === 'assistant_text' ? row.markdown : row.kind, copies: answerMarkdownOf(state, action.turnId) };
  });
}

const T1 = turnIdOf.ofMessage(uuid('u1'));

// The branch panel's finding 5 (ruled 2026-11-15 (UTC)): an answer of a turn that has not ended gets no action row on
// any projection of the rows. In U2b's view the running turn's line is always drawn, working, in its place or directly
// after the record line that covers it (the view's ruling 5), and each record line carries a turn of the rows it folds.
describe('a turn that has not ended, in the to-human view (the branch panel’s finding 5)', () => {
  const running = (b: Builder) => {
    b.turn('u1', 'Check the gauges.');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.text('m2', 0, '<message>All five stations are inside the limit.</message>'); // a completed, marked answer; no turn.ended
  };

  it('the view draws the running turn’s work as a record line, its line working, and its marked answer', () => {
    const rows = drawn(toHuman(running));
    expect(rows.find((row) => row.kind === 'record_fold')).toMatchObject({ turnId: T1, open: false });
    expect(rows.find((row) => row.kind === 'divider')).toMatchObject({ turnId: T1, state: 'working' });
    expect(rows.find((row) => row.kind === 'assistant_text')).toMatchObject({ phase: 'answer', live: false });
  });

  it('gives that answer no action row, its record closed or open: no Copy, no Fork, before the turn ends', () => {
    const state = toHuman(running);
    expect([...answerActionsOf(drawn(state)).entries()]).toEqual([]);
    expect([...answerActionsOf(drawn(state, true)).entries()]).toEqual([]);
  });

  it('once the turn ends, the answer has its row', () => {
    const state = toHuman((b) => {
      running(b);
      b.end(['u1']);
    });
    expect([...answerActionsOf(drawn(state)).values()]).toEqual([{ turnId: T1, rewindTo: null, fork: true }]);
  });

  it('a running turn’s record line and line below an ended turn’s answer hold that answer back; a record line of a turn that ended does not', () => {
    const AT = '2026-11-15T10:00:00.000Z';
    const T2 = 'turn:arrival' as TurnId;
    const rows = [
      { id: 'user:u1' as RowId, turnId: T1, at: AT, kind: 'user', messageUuid: uuid('u1'), text: 'Check the gauges.', attachments: [], placeholders: [], steer: false, dropped: false },
      { id: 'text:m2' as RowId, turnId: T1, at: AT, kind: 'assistant_text', messageUuid: null, blockIndex: 0, markdown: '<message>All five are fine.</message>', live: false, phase: 'answer', model: null },
      { id: 'record:a' as RowId, turnId: T2, at: AT, kind: 'record_fold', stretch: 'toolu_a', open: false },
    ] as unknown as Row[];
    const runningDivider = { id: 'divider:arrival' as RowId, turnId: T2, at: AT, kind: 'divider', state: 'working' } as unknown as Row;
    expect([...answerActionsOf(rows).keys()]).toEqual(['text:m2']);
    expect([...answerActionsOf([...rows, runningDivider]).keys()]).toEqual([]);
  });
});

// "The statements to read again", 13 (ruled F4): Copy takes the same rows in either view, every answer block of the
// answer's turn from its complete projection, marked or not, folded or not. The action row stands under the last drawn
// row of that turn that is one of those answer blocks or the stretch's head text; a turn that draws neither has no action
// row until its record is opened.
describe('an answer in the to-human view (statement 13)', () => {
  const MARKED = '<message>All five stations are inside the limit.</message>';

  it('an answer of two blocks, the second unmarked: under the marked block closed, under the second open, the same text', () => {
    const closed = toHuman((b) => {
      b.turn('u1', 'Check the gauges.');
      b.toolUse('t1', 'Bash', { command: 'ls' });
      b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
      b.text('m2', 0, MARKED);
      b.text('m2', 1, 'Station four ran close to its bound.');
      b.end(['u1']);
    });
    const both = `${MARKED}\n\nStation four ran close to its bound.`;
    expect(placed(closed)).toEqual([{ on: MARKED, copies: both }]);
    expect(placed(opened(closed))).toEqual([{ on: 'Station four ran close to its bound.', copies: both }]);
  });

  it('an answer folded whole under a stretch’s head: under the head text closed, under the answer open, the same text', () => {
    const head = '<message>Checking the gauges now.</message>\n\nReading the log first.';
    const closed = toHuman((b) => {
      b.turn('u1', 'Check the gauges.');
      b.text('m1', 0, head); // the stretch's head: words inside a message and words outside it, before the work
      b.toolUse('t1', 'Bash', { command: 'ls' }, 'm1', 1);
      b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
      b.text('m2', 0, 'All five stations are inside the limit.');
      b.end(['u1']);
    });
    expect(drawn(closed).map((row) => (row.kind === 'assistant_text' && row.reportOnly ? 'head' : row.kind))).toEqual(['time', 'user', 'head', 'record_fold']);
    expect(placed(closed)).toEqual([{ on: head, copies: 'All five stations are inside the limit.' }]);
    expect(placed(opened(closed))).toEqual([{ on: 'All five stations are inside the limit.', copies: 'All five stations are inside the limit.' }]);
  });

  it('a turn that draws neither an answer block nor a head: no action row until its record is opened', () => {
    const closed = toHuman((b) => {
      b.turn('u1', 'Check the gauges.');
      b.toolUse('t1', 'Bash', { command: 'ls' });
      b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
      b.text('m2', 0, 'All five stations are inside the limit.');
      b.end(['u1']);
    });
    expect(placed(closed)).toEqual([]);
    expect(placed(opened(closed))).toEqual([{ on: 'All five stations are inside the limit.', copies: 'All five stations are inside the limit.' }]);
  });

  it('a head text of a turn with no answer block carries none, closed or open', () => {
    const closed = toHuman((b) => {
      b.turn('u1', 'Check the gauges.');
      b.text('m1', 0, '<message>Checking the gauges now.</message>\n\nReading the log first.');
      b.toolUse('t1', 'Bash', { command: 'ls' }, 'm1', 1);
      b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
      b.end(['u1']);
    });
    expect(placed(closed)).toEqual([]);
    expect(placed(opened(closed))).toEqual([]);
  });
});
