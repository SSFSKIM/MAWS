// An asynchronous ask's answer in landing 1's readers (UX wave U3b, at the cascade of the coming master; board ticket
// 711's security fix). The message that carries an ask's answers holds no text the model wrote: a question by its
// number, a picked option as `option <k>`, the block's `question` empty (`askSteerText`); a session read now may still
// hold an earlier build's message (`earlierAskSteerText`). Every reader of landing 1 that takes a person's message reads
// either form alike: never the person's own words, never a turn-opening prompt of theirs, never an answer block. Each case
// goes through the real derivation, the envelope written by the real writer; questions and answers are invented.
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { ownWordsOf } from '@shared/engine/arrival';
import { askSteerText } from '@shared/maws/ask';
import type { AskAnswer, AskQuestion } from '@shared/maws/tools';
import { earlierAskSteerText } from '../../../../test/support/ask-steer';
import { liveMarkedRowIds, mirrorRows } from '../owner/view/mirror';
import { answerActionsOf, answerMarkdownOf } from './model/answer-actions';
import { rowsOf, withAllExpanded } from './model/derive';
import { turnId as turnIdOf } from './model/keys';
import { applyEvents, createState, withUi, type TranscriptState } from './model/reduce';
import type { Row } from './model/rows';
import { builder, uuid, type Builder } from './model/test-events';

type Writer = (askId: string, questions: readonly AskQuestion[], answers: readonly AskAnswer[]) => string;
const FORMS: [string, Writer][] = [['this build’s form', askSteerText], ['an earlier build’s form', earlierAskSteerText]];
const LAYOUT: AskQuestion = { id: 'q1', question: 'Which layout should the page use?', header: 'Layout', modality: 'choice', options: [{ label: 'Grid' }, { label: 'List' }] };
const ASK = 'toolu_ask_layout';
const envelope = (write: Writer) => write(ASK, [LAYOUT], [{ id: 'q1', question: LAYOUT.question, status: 'answered', value: ['Grid'] }]);
const REPLY = '<message>Grid it is: the page now lays its cards out in a grid.</message>';

const stateOf = (events: SessionEvent[], lane = false): TranscriptState => {
  const state = withAllExpanded(applyEvents(createState(null, null), events));
  return lane ? withUi(state, { ...state.ui, ownerLane: true, noTurnFold: true, version: state.ui.version + 1, global: state.ui.global + 1 }) : state;
};
const users = (rows: readonly Row[]) => rows.filter((row): row is Extract<Row, { kind: 'user' }> => row.kind === 'user');

/** The ask raised in the person's first turn, without a wait; its answers then open the next turn, which replies. With
 *  `asked: false` the session holds no call for the ask (an orphan envelope). */
function answeredSession(write: Writer, { asked = true, then }: { asked?: boolean; then?: (b: Builder) => void } = {}): SessionEvent[] {
  const b = builder();
  b.turn('u0', 'Plan the landing page.');
  if (asked) {
    b.toolUse(ASK, 'mcp__maws__ask', { blocking: false, questions: [LAYOUT] });
    b.result(ASK, [{ type: 'text', text: JSON.stringify({ status: 'asked', askId: ASK }) }]);
  }
  b.text('m0', 0, '<message>I asked which layout the page should use.</message>');
  b.end(['u0']);
  b.turn('u1', envelope(write));
  b.text('m1', 0, REPLY);
  then?.(b);
  b.end(['u1']);
  return b.events;
}

describe.each(FORMS)('an ask’s answers, %s', (_, write) => {
  it('open a turn with no prompt of the person’s: no bubble, no prompt stop, the action row under the reply, Copy the reply alone', () => {
    const state = stateOf(answeredSession(write));
    const rows = rowsOf(state);
    expect(users(rows).map((row) => row.text)).toEqual(['Plan the landing page.']);
    expect([...answerActionsOf(rows).values()]).toEqual([{ turnId: turnIdOf.ofMessage(uuid('u1')), rewindTo: null, fork: true }]);
    expect(answerActionsOf(rows).has(rows.find((row) => row.kind === 'assistant_text' && row.markdown.includes('I asked'))!.id)).toBe(false);
    expect(answerMarkdownOf(state, turnIdOf.ofMessage(uuid('u1')))).toBe(REPLY);
  });

  it('place the same action row in the to-human view, told the rows before its fold', () => {
    const state = stateOf(answeredSession(write), true);
    const rows = rowsOf(state);
    const drawn = mirrorRows(rows, state.ui, liveMarkedRowIds(state));
    expect(users(drawn)).toHaveLength(1);
    expect([...answerActionsOf(drawn, [], rows)]).toEqual([...answerActionsOf(rows)]);
  });

  it('are never the person’s own words: ownWordsOf of the envelope alone is empty, beside words it is those words', () => {
    expect(ownWordsOf(envelope(write))).toBe('');
    expect(ownWordsOf(`${envelope(write)}\nAlso fix the footer.`)).toBe('Also fix the footer.');
    expect(ownWordsOf(`Also fix the footer.\n${envelope(write)}`)).toBe('Also fix the footer.');
  });

  it('rewound to, give the boundary no words of the person’s', () => {
    const events = answeredSession(write, {
      then: (b) => void b.emit('boundary.rewind', { targetMessageUuid: uuid('u1'), precedingAssistantUuid: uuid('m0-u0'), prefillText: envelope(write) }),
    });
    const boundary = rowsOf(stateOf(events)).find((row) => row.kind === 'boundary' && row.boundaryKind === 'rewind');
    expect(boundary).toMatchObject({ detail: '' });
  });

  it('opening a turn whose command output follows them, leave that output standing alone: they are no command’s bubble', () => {
    const events = answeredSession(write, {
      asked: false,
      then: (b) => void b.emit('user.message', { messageUuid: uuid('o1'), content: '<local-command-stdout>Total cost: $0.01</local-command-stdout>', isReplay: false, isSynthetic: false, origin: 'local-command', bash: null }),
    });
    expect(rowsOf(stateOf(events)).filter((row) => row.kind === 'local_command').map((row) => (row as Extract<Row, { kind: 'local_command' }>).lone)).toEqual([true]);
  });
});

describe('the two forms read alike', () => {
  const [[, fresh], [, earlier]] = FORMS;
  const placement = (write: Writer, asked: boolean) => [...answerActionsOf(rowsOf(stateOf(answeredSession(write, { asked }))))];

  it('the same placement with the ask answered here, and with an orphan envelope (no call for its ask)', () => {
    expect(placement(fresh, true)).toEqual(placement(earlier, true));
    expect(placement(fresh, false)).toEqual(placement(earlier, false));
  });
});
