import { afterEach, describe, expect, it } from 'vitest';
import { SessionEventSchema } from '@shared/graph/events';
import type { AppSessionId, ToolUseId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { selectWaitingByCall, selectWaitingForms, useAttention } from '../stores/attention';
import { installFakeMain, ok } from '../test-support/code';
import { resetShellStores } from '../test-support/shell-stores';
import { applyEvents, createState, withUi } from '../transcript/model/reduce';
import { rowsOf } from '../transcript/model/derive';
import type { Row } from '../transcript/model/rows';
import { ASK_MOD_TOOL, lowerQuestion, questionCalls, questionsFixture, raiseQuestion } from './questions';

type QuestionRow = Extract<Row, { kind: 'question' }>;
const questionRows = (rows: Row[]) => rows.filter((row): row is QuestionRow => row.kind === 'question');

// UX wave U1b (Proof 3, ruling A2): the transcript harness's `synthetic/questions`, which the far-row, pill and dismissed
// receipt scenes of e2e/transcript.spec.ts stand on: two asynchronous questions a terminal session's agent asked and went
// on past (the state the product reaches), and the engine's own question dismissed whole.
describe('the harness’s synthetic/questions', () => {
  const { events, streamFrom } = questionsFixture();
  afterEach(() => resetShellStores());

  it('is X1 events in order, all released at load', () => {
    expect(streamFrom).toBeNull();
    for (const event of events) expect(SessionEventSchema.safeParse(event).success, `${event.kind} at ${event.seq}`).toBe(true);
    expect(events.map((event) => event.seq)).toEqual(events.map((_, i) => i));
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
  });

  it('asks two questions through the ask mod, each answered at once with the sentence that it waits and followed by later turns, and no request event for them; the engine’s own is dismissed whole', () => {
    expect(questionCalls(events).map(({ call, how }) => [call, how])).toEqual([
      ['toolu_question_far_1', 'async'],
      ['toolu_question_far_2', 'async'],
      ['toolu_question_dismissed', 'dismissed'],
    ]);
    for (const call of ['toolu_question_far_1', 'toolu_question_far_2']) {
      expect(events.find((event) => event.kind === 'tool.use' && event.toolUseId === call)).toMatchObject({ toolName: ASK_MOD_TOOL });
      expect(events.find((event) => event.kind === 'tool.result' && event.toolUseId === call)).toMatchObject({ isError: false, content: expect.stringMatching(/^Your questions are waiting for the human; this call does not wait for them\./) });
      expect(events.some((event) => (event.kind === 'question.requested' || event.kind === 'question.answered') && event.toolUseId === call), 'an asynchronous ask raises no engine request').toBe(false);
    }
    const last = events.findIndex((event) => event.kind === 'tool.use' && event.toolUseId === 'toolu_question_far_2');
    expect(events.slice(last).filter((event) => event.kind === 'turn.ended').length, 'turns run on after the second').toBeGreaterThan(50);
  });

  it('draws a question row for each of its three calls among several hundred rows: two open, a hundred turns apart, and one dismissed whole', () => {
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

  it('raises an asynchronous question as its bridge does: an async_input item named by the call, its question view cached, the call a waiting form; lowered, it waits no more', () => {
    installFakeMain(() => ok());
    const session = addressOf(TEST_MACHINE, 'harness') as AppSessionId;
    const [first] = questionCalls(events);
    const id = raiseQuestion(session, first.call, first.questions);
    const item = selectWaitingByCall(useAttention.getState(), session).get(first.call);
    expect(item).toMatchObject({ id, kind: 'async_input', state: 'pending', request: { requestId: first.call, toolUseId: first.call } });
    expect(useAttention.getState().requests.get(id)).toMatchObject({ kind: 'question.requested', toolUseId: first.call, questions: [{ header: 'Release day' }, { header: 'Channel' }] });
    expect([...selectWaitingForms(useAttention.getState(), session)]).toEqual([first.call]);
    lowerQuestion(session, id);
    expect(selectWaitingByCall(useAttention.getState(), session).size).toBe(0);
  });
});
