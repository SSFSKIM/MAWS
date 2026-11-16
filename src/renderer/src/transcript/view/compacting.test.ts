// The compaction's row (UX wave U3b, M4; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md,
// decisions 16 and 17, Interfaces §E): placed by the view at the drawn list's end, never derived, never copied, and no
// answer's action row moves for it.
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import { describe, expect, it } from 'vitest';
import { mirrorRows, stretchesOf } from '../../owner/view/mirror';
import { answerActionsOf } from '../model/answer-actions';
import { END_ROW, endRequestId } from '../model/keys';
import { RowSchema } from '../model/schema';
import { serializeRows } from '../model/serialize';
import type { Row, RowId, TurnId } from '../model/rows';
import { COMPACTING_ROW, compactingRow } from './compacting';

const AT = '2026-11-15T10:00:00.000Z';
const SINCE = Date.parse('2026-11-15T10:05:00.000Z');
const prompt = (of: string): Row => ({ id: `user:${of}` as RowId, turnId: `turn:${of}` as TurnId, at: AT, kind: 'user', messageUuid: `m-${of}` as MessageUuid, text: `Check part ${of}.`, attachments: [], placeholders: [], lines: 1, editable: true, steer: false, dropped: false });
const answer = (of: string): Row => ({ id: `text:${of}` as RowId, turnId: `turn:${of}` as TurnId, at: AT, kind: 'assistant_text', messageUuid: `a-${of}` as MessageUuid, blockIndex: 0, markdown: `Part ${of} is fine.`, live: false, phase: 'answer', model: null });

describe('compactingRow', () => {
  const rows = [prompt('1'), answer('1'), prompt('2'), answer('2')];

  it('is the list itself while nothing compacts', () => {
    expect(compactingRow(rows, null)).toBe(rows);
  });

  it('appends one `activity` row, with no turn, carrying when the compaction began', () => {
    const drawn = compactingRow(rows, SINCE);
    expect(drawn.slice(0, -1)).toEqual(rows);
    expect(drawn.at(-1)).toEqual({ id: COMPACTING_ROW, turnId: null, at: '2026-11-15T10:05:00.000Z', kind: 'activity', activity: 'compacting', since: '2026-11-15T10:05:00.000Z' });
    expect(RowSchema.safeParse(drawn.at(-1)).success).toBe(true);
    expect(rows).toHaveLength(4); // the list it was given is not changed
  });

  // The chain merge of U1c's head (U1b's end row on this tree): the row that must stay last stays last, the compaction's
  // row directly before it
  it('stands before U1b’s end row, the last row before it, when the list ends with one', () => {
    const end: Row = { id: END_ROW, kind: 'request_slot', turnId: null, at: '', requestId: endRequestId('app-1' as AppSessionId, null), toolUseId: null, requestKind: 'permission', toolName: null, requestedAt: '' };
    expect(compactingRow([...rows, end], SINCE).map((row) => row.id)).toEqual([...rows.map((row) => row.id), COMPACTING_ROW, END_ROW]);
    expect(compactingRow([end], SINCE).map((row) => row.id)).toEqual([COMPACTING_ROW, END_ROW]);
  });

  it('stands at the end of an empty list too (a session whose rows are still on their way)', () => {
    expect(compactingRow([], SINCE).map((row) => row.kind)).toEqual(['activity']);
  });

  it('is never copied', () => {
    expect(serializeRows([...compactingRow([answer('1')], SINCE)])).toBe(serializeRows([answer('1')]));
  });

  it('takes no action row, and the list’s last answer keeps its own under it', () => {
    const drawn = compactingRow(rows, SINCE);
    expect([...answerActionsOf(drawn)]).toEqual([...answerActionsOf(rows)]);
    expect(answerActionsOf(drawn).has(COMPACTING_ROW)).toBe(false);
    expect(answerActionsOf(drawn).get('text:2' as RowId)?.rewindTo).toBeNull();
  });

  // The chain merge of U1c's head (U2b's to-human view on this tree): the mirror classes the row as one that stays, so it
  // is drawn in sight after a closed record and never taken into a stretch
  it('stays in sight in the to-human view, after a closed record, in no stretch', () => {
    const work: Row = { id: 'cell:toolu_1' as RowId, turnId: 'turn:2' as TurnId, at: AT, kind: 'cell', toolUseId: 'toolu_1', toolName: 'Bash' } as unknown as Row;
    const drawn = compactingRow([prompt('2'), work], SINCE);
    expect(mirrorRows(drawn, {}).map((row) => row.kind)).toEqual(['user', 'record_fold', 'activity']);
    expect(stretchesOf(drawn).flatMap((stretch) => stretch.rows.map((row) => row.id))).toEqual(['cell:toolu_1']);
  });
});
