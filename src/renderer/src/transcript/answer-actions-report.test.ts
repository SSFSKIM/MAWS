// The answer's action row over the report projection (UX wave U3b, M3; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-
// transcript-rows-find.md, Interfaces §C). Beside the placement's own tests in model/answer-actions.test.ts, here because
// the projection is the renderer's (the model's tests are also typechecked by the node project, which does not hold it).
import { describe, expect, it } from 'vitest';
import { reportRows } from '../owner/report/project';
import { answerActionsOf } from './model/answer-actions';
import { rowsOf } from './model/derive';
import { turnId as turnIdOf } from './model/keys';
import { applyEvents, createState, withUi, type TranscriptState } from './model/reduce';
import { BASH_RESULT, builder, uuid } from './model/test-events';

// The branch panel's finding 5 (ruled 2026-11-15 (UTC)): an answer of a turn that has not ended gets no action row on
// any projection of the rows; the report projection's record that says working is a running turn. Through the real
// projection, then the placement.
describe('a turn that has not ended, in the report projection (the branch panel’s finding 5)', () => {
  function runningMarkedTurn(): TranscriptState {
    const b = builder();
    b.turn('u1', 'Check the gauges.');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.text('m2', 0, '<essential>All five stations are inside the limit.</essential>'); // a completed, marked answer; no turn.ended
    const state = applyEvents(createState(null, null), b.events);
    return withUi(state, { ...state.ui, ownerLane: true, version: state.ui.version + 1, global: state.ui.global + 1 });
  }

  it('the projection draws the running turn as a working record and its marked answer, with no turn line', () => {
    const state = runningMarkedTurn();
    const rows = reportRows(rowsOf(state), state, state.ui);
    expect(rows.map((row) => row.kind)).toEqual(['time', 'user', 'owner_record', 'assistant_text']);
    expect(rows.find((row) => row.kind === 'owner_record')).toMatchObject({ working: true });
    expect(rows.find((row) => row.kind === 'assistant_text')).toMatchObject({ phase: 'answer', live: false });
  });

  it('gives that answer no action row: no Copy, no Fork, before the turn ends', () => {
    const state = runningMarkedTurn();
    expect([...answerActionsOf(reportRows(rowsOf(state), state, state.ui)).entries()]).toEqual([]);
    expect([...answerActionsOf(rowsOf(state)).entries()]).toEqual([]); // the full transcript already holds it back, by its turn line
  });

  it('a record that does not say working leaves the answer its row once the turn ends', () => {
    const b = builder();
    b.turn('u1', 'Check the gauges.');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.text('m2', 0, '<essential>All five stations are inside the limit.</essential>');
    b.end(['u1']);
    const ended = applyEvents(createState(null, null), b.events);
    const state = withUi(ended, { ...ended.ui, ownerLane: true, version: ended.ui.version + 1, global: ended.ui.global + 1 });
    const rows = reportRows(rowsOf(state), state, state.ui);
    expect(rows.find((row) => row.kind === 'owner_record')).toMatchObject({ working: false });
    expect([...answerActionsOf(rows).values()]).toEqual([{ turnId: turnIdOf.ofMessage(uuid('u1')), rewindTo: null, fork: true }]);
  });
});
