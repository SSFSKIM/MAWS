// E1 (M4): one question's draft in the Question sheet and the answer it becomes (E1 execution document, M4's decisions).
// Every edit is a pure function of the question and the draft. Decide for me and Skip exclude each other and any
// answer: turning one on leaves the draft beneath it untouched (turning it off restores the answer), and any edit of
// the answer turns both off. A single-select choice's Other row excludes its labels; a multi-select's sits beside them.
// An empty draft at Submit is skipped; a draft with Other chosen and nothing typed is incomplete, the one state that
// holds Submit back. P2-C3 (the P2 spec's Decision Log 34): a note sits beside the answer, whatever its status; no edit
// of the answer or the toggles touches it, nor it them, and it travels trimmed, only when something is written.
// P3-D: a design_system question's draft is the system picked (its id and name) or "Build one with me" (`create`),
// which a question with `allowCreate: false` never answers.
import type { AskAnswer, AskQuestion } from '@shared/maws/tools';

export interface Draft {
  selected: string[]; // choice: the chosen labels
  otherText: string | null; // choice: what is typed under Other; null while Other is not chosen
  text: string; // text
  paths: string[]; // file and folder: absolute paths
  repository: string | null; // repository: the project's directory
  designSystem: DesignSystemPick | null; // P3-D: design_system
  decide: boolean;
  skip: boolean;
  note: string | null; // the note beside the answer; null while its field is not opened
}

// P3-D: a system by its artifact id and name, or the request to build a new one with the agent.
export type DesignSystemPick = { id: string; name: string } | 'create';

export const EMPTY_DRAFT: Draft = { selected: [], otherText: null, text: '', paths: [], repository: null, designSystem: null, decide: false, skip: false, note: null };

export type DraftStatus = 'answered' | 'decide' | 'skipped' | 'empty' | 'incomplete';

// An edit of the answer itself: both toggles go off.
const answering = (draft: Draft, patch: Partial<Draft>): Draft => ({ ...draft, ...patch, decide: false, skip: false });

const isMulti = (question: AskQuestion) => question.multi === true;
const blank = (text: string) => text.trim() === '';

export function pickOption(question: AskQuestion, draft: Draft, label: string): Draft {
  return isMulti(question) ? toggleOption(question, draft, label, !draft.selected.includes(label)) : answering(draft, { selected: [label], otherText: null });
}

export function toggleOption(question: AskQuestion, draft: Draft, label: string, on: boolean): Draft {
  if (!isMulti(question)) return on ? pickOption(question, draft, label) : answering(draft, { selected: [] });
  const chosen = new Set(draft.selected);
  if (on) chosen.add(label);
  else chosen.delete(label);
  // in the question's option order, so the answer reads as the question listed them
  const selected = (question.options ?? []).map((option) => option.label).filter((candidate) => chosen.has(candidate));
  return answering(draft, { selected });
}

// `null` takes the Other row away; a string chooses it (a single-select's labels go) and holds what is typed.
export function setOther(question: AskQuestion, draft: Draft, text: string | null): Draft {
  if (text !== null && !isMulti(question)) return answering(draft, { selected: [], otherText: text });
  return answering(draft, { otherText: text });
}

export const setText = (draft: Draft, text: string): Draft => answering(draft, { text });

// A picker's result: added after what is held (each path once) for a `multiple` question, else in its place.
export function addPaths(question: AskQuestion, draft: Draft, paths: readonly string[]): Draft {
  if (paths.length === 0) return draft;
  if (question.multiple !== true) return answering(draft, { paths: [paths.at(-1)!] });
  return answering(draft, { paths: [...new Set([...draft.paths, ...paths])] });
}

export const removePath = (draft: Draft, path: string): Draft => answering(draft, { paths: draft.paths.filter((held) => held !== path) });

export const setRepository = (draft: Draft, directory: string | null): Draft => answering(draft, { repository: directory });

export const setDesignSystem = (draft: Draft, pick: DesignSystemPick | null): Draft => answering(draft, { designSystem: pick }); // P3-D

export const setDecide = (draft: Draft, on: boolean): Draft => ({ ...draft, decide: on, skip: on ? false : draft.skip });
export const setSkip = (draft: Draft, on: boolean): Draft => ({ ...draft, skip: on, decide: on ? false : draft.decide });

// `null` closes the note's field; a string opens it and holds what is typed.
export const setNote = (draft: Draft, note: string | null): Draft => ({ ...draft, note });

export function draftStatus(question: AskQuestion, draft: Draft): DraftStatus {
  if (draft.decide) return 'decide';
  if (draft.skip) return 'skipped';
  switch (question.modality) {
    case 'choice':
      if (draft.otherText !== null && blank(draft.otherText)) return 'incomplete';
      return draft.selected.length > 0 || draft.otherText !== null ? 'answered' : 'empty';
    case 'text':
      return blank(draft.text) ? 'empty' : 'answered';
    case 'file':
    case 'folder':
      return draft.paths.length > 0 ? 'answered' : 'empty';
    case 'repository':
      return draft.repository !== null ? 'answered' : 'empty';
    case 'design_system': // P3-D
      return draft.designSystem === null || (draft.designSystem === 'create' && question.allowCreate === false) ? 'empty' : 'answered';
  }
}

export interface ProjectRef {
  name: string;
  directory: string;
}

// The answer a draft becomes at Submit (`AskAnswerSchema`): Decide for me, skipped (asked for, or empty), or the
// modality's value, with the note when one is written. `projects` names a repository answer's project by its directory.
export function toAnswer(question: AskQuestion, draft: Draft, projects: readonly ProjectRef[] = []): AskAnswer {
  const note = draft.note?.trim() ?? '';
  return { ...answerOf(question, draft, projects), ...(note !== '' && { note }) };
}

function answerOf(question: AskQuestion, draft: Draft, projects: readonly ProjectRef[]): AskAnswer {
  const base = { id: question.id ?? '', question: question.question };
  const status = draftStatus(question, draft);
  if (status === 'decide') return { ...base, status: 'decide_for_me' };
  if (status !== 'answered') return { ...base, status: 'skipped' };
  switch (question.modality) {
    case 'choice':
      return { ...base, status: 'answered', value: isMulti(question) ? draft.selected : draft.selected.slice(0, 1), ...(draft.otherText !== null && { otherText: draft.otherText }) };
    case 'text':
      return { ...base, status: 'answered', value: draft.text };
    case 'file':
    case 'folder':
      return { ...base, status: 'answered', value: draft.paths };
    case 'repository': {
      const name = projects.find((project) => project.directory === draft.repository)?.name;
      return { ...base, status: 'answered', value: draft.repository!, ...(name !== undefined && { name }) };
    }
    case 'design_system': { // P3-D
      const pick = draft.designSystem!;
      return pick === 'create' ? { ...base, status: 'answered', create: true } : { ...base, status: 'answered', designSystemId: pick.id, name: pick.name };
    }
  }
}

const draftOf = (drafts: ReadonlyMap<string, Draft> | undefined, question: AskQuestion) => drafts?.get(question.id ?? '') ?? EMPTY_DRAFT;

// One answer per question, in the asked order (the questions carry their ids; `withQuestionIds`).
export const toAnswers = (questions: readonly AskQuestion[], drafts: ReadonlyMap<string, Draft> | undefined, projects: readonly ProjectRef[] = []): AskAnswer[] =>
  questions.map((question) => toAnswer(question, draftOf(drafts, question), projects));

// How many questions Submit would send as skipped: the ones skipped and the ones left empty.
export const skippedCount = (questions: readonly AskQuestion[], drafts: ReadonlyMap<string, Draft> | undefined): number =>
  questions.filter((question) => ['skipped', 'empty'].includes(draftStatus(question, draftOf(drafts, question)))).length;

// Whether Submit may send: no question is half answered.
export const canSubmit = (questions: readonly AskQuestion[], drafts: ReadonlyMap<string, Draft> | undefined): boolean =>
  questions.every((question) => draftStatus(question, draftOf(drafts, question)) !== 'incomplete');
