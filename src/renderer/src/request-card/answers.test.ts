import { describe, expect, it } from 'vitest';
import { RequestAnswerSchema } from '@shared/engine/answers';
import { loadJournal } from '../../../../test/support/fixtures';
import { questionAnswers, toAnswer, type VariantState } from './answers';
import { fixtureRequest } from './test-requests';

const question = fixtureRequest('pass1', 'question-roundtrip', 137);
if (question.kind !== 'question.requested') throw new Error('seq 137 is the AskUserQuestion request');
const [color, fruits] = question.questions;

// The answers the fixture's own control_response carried at seq 138.
const recorded = (() => {
  const row = loadJournal('pass1', 'question-roundtrip').find((r) => r.seq === 138)!;
  return (row.frame as { response: { response: { updatedInput: { answers: Record<string, string> } } } }).response.response.updatedInput.answers;
})();

describe('toAnswer validates against RequestAnswerSchema for every variant', () => {
  const states: [VariantState, unknown][] = [
    [{ kind: 'permission', decision: 'allow', scope: 'once' }, { kind: 'permission', decision: 'allow', scope: 'once' }],
    [{ kind: 'permission', decision: 'allow', scope: 'session' }, { kind: 'permission', decision: 'allow', scope: 'session' }],
    [{ kind: 'permission', decision: 'allow', scope: 'local_settings' }, { kind: 'permission', decision: 'allow', scope: 'local_settings' }],
    [{ kind: 'permission', decision: 'deny', message: '' }, { kind: 'permission', decision: 'deny' }],
    [{ kind: 'permission', decision: 'deny', message: 'not that file' }, { kind: 'permission', decision: 'deny', message: 'not that file' }],
    [{ kind: 'permission', decision: 'deny_and_stop', message: 'stop here' }, { kind: 'permission', decision: 'deny_and_stop', message: 'stop here' }],
    [{ kind: 'plan', outcome: 'implement' }, { kind: 'plan', outcome: 'implement', feedback: null }],
    [{ kind: 'plan', outcome: 'clear_and_implement' }, { kind: 'plan', outcome: 'clear_and_implement', feedback: null }],
    [{ kind: 'plan', outcome: 'keep_planning', feedback: 'split step 2' }, { kind: 'plan', outcome: 'keep_planning', feedback: 'split step 2' }],
    [{ kind: 'plan', outcome: 'keep_planning', feedback: '  ' }, { kind: 'plan', outcome: 'keep_planning', feedback: null }],
    [{ kind: 'dialog', dialogKind: 'refusal_fallback_prompt', result: 'retry_fallback' }, { kind: 'dialog', behavior: 'completed', result: 'retry_fallback' }],
    [{ kind: 'dialog', dialogKind: 'refusal_fallback_prompt', result: 'edit_prompt' }, { kind: 'dialog', behavior: 'completed', result: 'edit_prompt' }],
    [{ kind: 'dialog', dialogKind: 'refusal_fallback_prompt', result: 'cancelled' }, { kind: 'dialog', behavior: 'completed', result: 'cancelled' }],
    [{ kind: 'dialog', dialogKind: 'auto_mode_server_fallback', result: 'continue' }, { kind: 'dialog', behavior: 'completed', result: 'continue' }],
    [{ kind: 'dialog', dialogKind: 'auto_mode_server_fallback', result: 'interrupt' }, { kind: 'dialog', behavior: 'completed', result: 'interrupt' }],
    [{ kind: 'elicitation', action: 'accept', content: { color: 'teal' } }, { kind: 'elicitation', action: 'accept', content: { color: 'teal' } }],
    [{ kind: 'elicitation', action: 'accept', content: null }, { kind: 'elicitation', action: 'accept' }], // a url-mode accept carries no content
    [{ kind: 'elicitation', action: 'decline' }, { kind: 'elicitation', action: 'decline' }],
    [{ kind: 'elicitation', action: 'cancel' }, { kind: 'elicitation', action: 'cancel' }],
  ];

  it.each(states.map(([state, answer]) => ({ name: JSON.stringify(state), state, answer })))('$name', ({ state, answer }) => {
    const out = toAnswer(state);
    expect(out).toEqual(answer);
    expect(RequestAnswerSchema.safeParse(out).success).toBe(true);
  });

  it('a permission deny carries no scope and deny_and_stop keeps its message (ledger d.17)', () => {
    expect(toAnswer({ kind: 'permission', decision: 'deny', message: 'x' })).not.toHaveProperty('scope');
    expect(toAnswer({ kind: 'permission', decision: 'deny_and_stop', message: 'why' })).toEqual({ kind: 'permission', decision: 'deny_and_stop', message: 'why' });
  });

  it('question answers for question-roundtrip seq 137 with Red, Apple and Pear equal seq 138', () => {
    const state: VariantState = { kind: 'question', questions: question.questions, selected: { [color.question]: ['Red'], [fruits.question]: ['Apple', 'Pear'] }, other: {} };
    expect(toAnswer(state)).toEqual({ kind: 'question', answers: recorded });
    expect(recorded).toEqual({ 'Which color do you prefer?': 'Red', 'Which fruits do you like?': 'Apple, Pear' });
  });

  it("a question's Other text is the answer verbatim, beside the chosen options of a multi-select", () => {
    const state: VariantState = { kind: 'question', questions: question.questions, selected: { [fruits.question]: ['Apple'] }, other: { [color.question]: 'Teal, mostly', [fruits.question]: 'Fig' } };
    expect(toAnswer(state)).toEqual({ kind: 'question', answers: { [color.question]: 'Teal, mostly', [fruits.question]: 'Apple, Fig' } });
  });

  // W4: the stepper's Skip leaves a question out; the pinned engine reads an absent answer as unanswered.
  it('a question with no answer (a blank Other is none) is left out of the reply, and none at all is an empty map', () => {
    const state: VariantState = { kind: 'question', questions: question.questions, selected: { [color.question]: ['Red'] }, other: { [fruits.question]: '   ' } };
    expect(questionAnswers(state)).toEqual({ [color.question]: 'Red' });
    expect(toAnswer(state)).toEqual({ kind: 'question', answers: { [color.question]: 'Red' } });
    expect(toAnswer({ kind: 'question', questions: question.questions, selected: {}, other: {} })).toEqual({ kind: 'question', answers: {} });
  });

  it('refuses a dialog result the kind does not have, cancelled for the auto-mode fallback, and any undeclared kind', () => {
    expect(() => toAnswer({ kind: 'dialog', dialogKind: 'auto_mode_server_fallback', result: 'cancelled' })).toThrow();
    expect(() => toAnswer({ kind: 'dialog', dialogKind: 'refusal_fallback_prompt', result: 'continue' })).toThrow();
    expect(() => toAnswer({ kind: 'dialog', dialogKind: 'cost_threshold', result: 'cancelled' })).toThrow(/cost_threshold/);
  });
});
