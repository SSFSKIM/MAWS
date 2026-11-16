// The labels' work on a change of the rows (UX wave U2b, M7; the architect's ruling on batch 0): a change touches one
// turn, the newest, so the labels redo the work of that turn alone and keep every other turn's (its rows' ids, its
// events' calls, its rows' places) by the turn's own identity. Counted, never timed. Real events through the real
// derivation and the real mirror; every text is invented.
import { describe, expect, it } from 'vitest';
import type { StoredRun } from '@shared/owner/folds';
import { rowsOf } from '../../transcript/model/derive';
import { applyEvents, createState, withUi, type TranscriptState } from '../../transcript/model/reduce';
import type { Row } from '../../transcript/model/rows';
import { BASH_RESULT, builder } from '../../transcript/model/test-events';
import { labelsOf, labelWork } from './label';
import { liveMarkedRowIds, mirrorRows } from './mirror';

const lane = (state: TranscriptState) => withUi(state, { ...state.ui, ownerLane: true, noTurnFold: true, version: state.ui.version + 1, global: state.ui.global + 1 });
const run = (first: string, last: string, summary: string): StoredRun => ({ first, last, summary });

// Five turns, each a call and its message; the fifth still running. `next` is one more call in the fifth turn.
function session() {
  const b = builder();
  for (let n = 1; n <= 5; n += 1) {
    b.turn(`u${n}`, `Look at part ${n}`);
    b.toolUse(`t${n}`, 'Bash', { command: `ls part${n}`, description: `List part ${n}` });
    b.result(`t${n}`, 'a.md', { structured: BASH_RESULT('a.md') });
    b.text(`f${n}`, 0, `<message>Part ${n} holds one note.</message>`);
    if (n < 5) b.end([`u${n}`]);
  }
  const history = b.events.length;
  b.toolUse('t6', 'Bash', { command: 'wc -l part5/a.md', description: 'Count the note’s lines' });
  return { events: b.events.slice(0, history), next: b.events.slice(history) };
}

const STORED = [1, 2, 3, 4, 5].map((n) => run(`t${n}`, `t${n}`, `Listed part ${n}`));
const linesOf = (state: TranscriptState, rows: readonly Row[]) =>
  mirrorRows(rows, {}, liveMarkedRowIds(state), labelsOf(rows, { stored: STORED, running: state.current !== null, turns: state.turns })).flatMap((row) =>
    row.kind === 'record_fold' ? [row.label ?? 'working record'] : [],
  );

describe('the labels’ work on a change of the rows', () => {
  it('a change in the newest turn places, reads and indexes that turn alone, and the lines read as before it', () => {
    const { events, next } = session();
    let state = lane(applyEvents(createState(null, null), events));
    let rows = rowsOf(state);
    expect(linesOf(state, rows)).toEqual(['Listed part 1', 'Listed part 2', 'Listed part 3', 'Listed part 4', 'Listed part 5']);
    const before = labelWork();
    state = applyEvents(state, next);
    rows = rowsOf(state);
    expect(linesOf(state, rows)).toEqual(['Listed part 1', 'Listed part 2', 'Listed part 3', 'Listed part 4', 'Listed part 5', 'Count the note’s lines']);
    const after = labelWork();
    expect(after.turnsPlaced - before.turnsPlaced).toBe(1);
    expect(after.turnsIndexed - before.turnsIndexed).toBe(1);
    const newest = rows.filter((row) => row.turnId === rows.at(-1)!.turnId).length;
    expect(after.rowsRead - before.rowsRead).toBeLessThanOrEqual(newest);
  });

  it('the rows read again with nothing changed: nothing is placed, read or indexed', () => {
    const { events } = session();
    const state = lane(applyEvents(createState(null, null), events));
    const rows = rowsOf(state);
    linesOf(state, rows);
    const before = labelWork();
    expect(linesOf(state, [...rows])).toEqual(['Listed part 1', 'Listed part 2', 'Listed part 3', 'Listed part 4', 'Listed part 5']);
    expect(labelWork()).toEqual(before);
  });
});
