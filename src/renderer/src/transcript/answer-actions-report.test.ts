// The answer's action row in the to-human view (UX wave U3b, M3; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-
// transcript-rows-find.md, Interfaces §C, "The statements to read again", 13). Beside the placement's own tests in
// model/answer-actions.test.ts, here because the view's projection is the renderer's (the model's tests are also
// typechecked by the node project, which does not hold it). Since the chain merge of U1c's head the projection is U2b's
// mirror (`owner/view/mirror.ts`); every case goes through the real derivation, then the mirror, then the placement.
import { describe, expect, it } from 'vitest';
import { liveMarkedRowIds, mirrorRows, stretchesOf } from '../owner/view/mirror';
import { answerActionsOf } from './model/answer-actions';
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
