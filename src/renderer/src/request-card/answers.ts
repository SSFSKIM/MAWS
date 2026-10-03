// A variant's state → the `RequestAnswer` `session.answer` carries (C3's answer contract, C7 execution document,
// Request card). Every answer is parsed by `RequestAnswerSchema` before it leaves, so a shape C3 would refuse throws
// here instead. A question form answers the questions it has answers for (W4: a question the stepper skipped is left
// out, which the engine reads as unanswered); a dialog answers only with a result its declared kind has (an undeclared
// kind has none). Pure.
import { RequestAnswerSchema, type RequestAnswer } from '@shared/engine/answers';
import type { Question } from '@shared/graph/events';
import { DIALOG_RESULTS, isDeclaredDialogKind } from './variants/dialog-kinds';
import type { Scope } from './scope';

export type VariantState =
  | { kind: 'permission'; decision: 'allow'; scope: Scope }
  | { kind: 'permission'; decision: 'deny' | 'deny_and_stop'; message: string }
  | { kind: 'question'; questions: Question[]; selected: Record<string, string[]>; other: Record<string, string> }
  | { kind: 'plan'; outcome: 'implement' | 'clear_and_implement' }
  | { kind: 'plan'; outcome: 'keep_planning'; feedback: string }
  | { kind: 'dialog'; dialogKind: string; result: string }
  | { kind: 'elicitation'; action: 'accept'; content: Record<string, unknown> | null } // null: a url-mode accept, no content
  | { kind: 'elicitation'; action: 'decline' | 'cancel' };

// Engine-provided question text is a dictionary key, never an inherited object property.
export const questionValue = <T,>(values: Record<string, T>, question: string): T | undefined =>
  Object.hasOwn(values, question) ? values[question] : undefined;

const blank = (text: string | undefined) => text === undefined || text.trim() === '';

// Per question: the chosen options, then the Other text verbatim, joined `', '` (the terminal's multi-select join); a
// question with neither has no entry. The pinned engine takes such a partial map as its own dialog sends one when the
// operator submits past a blank question: an absent answer is unanswered, and no answer at all reads "The user did not
// answer the questions." (2.1.283 `cli.pretty.js` 163990-164045, AskUserQuestion's `call` and its tool result).
export function questionAnswers(state: Extract<VariantState, { kind: 'question' }>): Record<string, string> {
  const answers: Record<string, string> = Object.create(null);
  for (const { question, options, multiSelect } of state.questions) {
    const other = questionValue(state.other, question);
    // A mod may rewrite the options while a persisted draft still holds the previous picks.
    const selected = (questionValue(state.selected, question) ?? []).filter((label) => options.some((option) => option.label === label));
    const picks = multiSelect ? selected : selected.slice(0, 1);
    const parts = [...picks, ...(blank(other) ? [] : [other])];
    if (parts.length > 0) answers[question] = parts.join(', ');
  }
  return answers;
}

function build(state: VariantState): RequestAnswer {
  switch (state.kind) {
    case 'permission':
      if (state.decision === 'allow') return { kind: 'permission', decision: 'allow', scope: state.scope };
      return blank(state.message) ? { kind: 'permission', decision: state.decision } : { kind: 'permission', decision: state.decision, message: state.message };
    case 'question':
      return { kind: 'question', answers: questionAnswers(state) };
    case 'plan':
      return state.outcome === 'keep_planning' ? { kind: 'plan', outcome: 'keep_planning', feedback: blank(state.feedback) ? null : state.feedback } : { kind: 'plan', outcome: state.outcome, feedback: null };
    case 'dialog': {
      if (!isDeclaredDialogKind(state.dialogKind)) throw new Error(`MAWS did not declare the dialog kind ${state.dialogKind} and never answers it`);
      if (!(DIALOG_RESULTS[state.dialogKind] as readonly string[]).includes(state.result)) throw new Error(`${state.result} is not a result of ${state.dialogKind}`);
      return { kind: 'dialog', behavior: 'completed', result: state.result };
    }
    case 'elicitation':
      return state.action === 'accept' && state.content !== null ? { kind: 'elicitation', action: 'accept', content: state.content } : { kind: 'elicitation', action: state.action };
  }
}

export function toAnswer(state: VariantState): RequestAnswer {
  return RequestAnswerSchema.parse(build(state));
}
