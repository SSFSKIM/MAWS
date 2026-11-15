import { describe, expect, it } from 'vitest';
import { SessionEventSchema } from '@shared/graph/events';
import type { ToolUseId } from '@shared/graph/ids';
import { applyEvents, createState, withUi } from '../transcript/model/reduce';
import { rowsOf } from '../transcript/model/derive';
import type { Row } from '../transcript/model/rows';
import { questionsFixture } from './questions';

type QuestionRow = Extract<Row, { kind: 'question' }>;
const questionRows = (rows: Row[]) => rows.filter((row): row is QuestionRow => row.kind === 'question');

// UX wave U1b (Proof 3, ruling A2): the transcript harness's `synthetic/questions`, which the far-row scene and the
// dismissed receipt's scene of e2e/transcript.spec.ts stand on.
describe('the harness’s synthetic/questions', () => {
  const { events, streamFrom } = questionsFixture();

  it('is X1 events in order, all released at load', () => {
    expect(streamFrom).toBeNull();
    for (const event of events) expect(SessionEventSchema.safeParse(event).success, `${event.kind} at ${event.seq}`).toBe(true);
    expect(events.map((event) => event.seq)).toEqual(events.map((_, i) => i));
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
  });

  it('draws a question row for each of its three calls among several hundred rows: two waiting for an answer, a hundred turns apart, and one dismissed whole', () => {
    const state = applyEvents(createState(null, null), events);
    const rows = rowsOf(state);
    expect(rows.length).toBeGreaterThan(500);
    const questions = questionRows(rows);
    expect(questions.map((row) => [row.toolUseId, row.answers])).toEqual([
      ['toolu_question_far_1', null],
      ['toolu_question_far_2', null],
      ['toolu_question_dismissed', {}],
    ]);
    const turnOf = (call: string) => state.order.indexOf(state.index.toolUses.get(call as ToolUseId)!) + 1;
    expect([turnOf('toolu_question_far_1'), turnOf('toolu_question_far_2'), turnOf('toolu_question_dismissed')]).toEqual([81, 162, 243]);
    expect(questions[2].questions[0].header).toHaveLength(14); // ruling A2: a header of about fourteen characters
  });

  it('marks a call’s row waiting once the transcript is told it holds a waiting form', () => {
    const state = applyEvents(createState(null, null), events);
    const told = withUi(state, { ...state.ui, waitingForms: new Set(['toolu_question_far_1' as ToolUseId]), version: state.ui.version + 1 });
    expect(questionRows(rowsOf(told)).map((row) => row.waiting === true)).toEqual([true, false, false]);
  });
});
