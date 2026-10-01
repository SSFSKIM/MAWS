// The question stepper's state (W4; C7 execution document, Request card, the question card): one question shown at a
// time, every answer kept until the one reply the wire takes. The draft is held beside the request in the attention
// store (`drafts`, keyed by the item), not in the card, so a remount or a move between placements (docked, inline, the
// Overview card) resumes at the same question with the same picks. Pure.
import type { Question } from '@shared/graph/events';
import { questionAnswers } from './answers';

export interface QuestionDraft {
  step: number; // the question shown
  reached: number; // the furthest question shown so far: the pager's forward arrow goes no further
  selected: Record<string, string[]>; // the chosen option labels, by question text
  other: Record<string, string>; // the Other text, by question text; a key present means Other is chosen
}

export const EMPTY_DRAFT: QuestionDraft = { step: 0, reached: 0, selected: {}, other: {} };

// The question's answer as the reply would carry it, or null while it has none.
export const answerOf = (draft: QuestionDraft, question: Question): string | null =>
  questionAnswers({ kind: 'question', questions: [question], selected: draft.selected, other: draft.other })[question.question] ?? null;

export function goTo(draft: QuestionDraft, step: number, count: number): QuestionDraft {
  const to = Math.max(0, Math.min(count - 1, step));
  return { ...draft, step: to, reached: Math.max(draft.reached, to) };
}

export const advance = (draft: QuestionDraft, count: number): QuestionDraft => goTo(draft, draft.step + 1, count);

const withoutOther = (other: Record<string, string>, question: string) => Object.fromEntries(Object.entries(other).filter(([key]) => key !== question));

// A single-select pick: that option alone, Other dropped.
export const pick = (draft: QuestionDraft, question: Question, label: string): QuestionDraft => ({
  ...draft,
  selected: { ...draft.selected, [question.question]: [label] },
  other: withoutOther(draft.other, question.question),
});

// A multi-select toggle, the labels kept in the options' order.
export function toggle(draft: QuestionDraft, question: Question, label: string, on: boolean): QuestionDraft {
  const chosen = draft.selected[question.question] ?? [];
  const next = on ? question.options.map((o) => o.label).filter((l) => l === label || chosen.includes(l)) : chosen.filter((l) => l !== label);
  return { ...draft, selected: { ...draft.selected, [question.question]: next } };
}

// Other chosen (its text, empty at first) or dropped (null). A single-select question's Other replaces its pick; a
// multi-select's sits beside the picks.
export function setOther(draft: QuestionDraft, question: Question, text: string | null): QuestionDraft {
  const other = text === null ? withoutOther(draft.other, question.question) : { ...draft.other, [question.question]: text };
  const selected = text !== null && !question.multiSelect ? { ...draft.selected, [question.question]: [] } : draft.selected;
  return { ...draft, selected, other };
}

// Skip: the question left unanswered (whatever was picked is dropped), the stepper on to the next.
export function skip(draft: QuestionDraft, question: Question, count: number): QuestionDraft {
  const cleared = { ...draft, selected: { ...draft.selected, [question.question]: [] }, other: withoutOther(draft.other, question.question) };
  return advance(cleared, count);
}

