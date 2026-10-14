// E1 M4: a question's draft in the Question sheet and the answer it becomes (E1 execution document, M4's decisions:
// `Draft`, `toAnswer`; Decide for me and Skip mutually exclusive with an answer; an empty draft counts as skipped).
import { describe, expect, it } from 'vitest';
import type { AskQuestion } from '@shared/maws/tools';
import { askAnswersProblem } from '@shared/maws/ask';
import {
  addPaths, draftStatus, EMPTY_DRAFT, pickOption, removePath, setDecide, setNote, setOther, setRepository, setSkip, setText, skippedCount, toAnswer, toAnswers, toggleOption, type Draft,
} from './draft';

const single: AskQuestion = { id: 'q1', question: 'Which colour?', modality: 'choice', options: [{ label: 'Red' }, { label: 'Green' }, { label: 'Blue' }] };
const multi: AskQuestion = { id: 'q2', question: 'Which days?', modality: 'choice', multi: true, options: [{ label: 'Mon' }, { label: 'Tue' }, { label: 'Wed' }] };
const text: AskQuestion = { id: 'q3', question: 'What should the title be?', modality: 'text' };
const folder: AskQuestion = { id: 'q4', question: 'Which folder holds the assets?', modality: 'folder' };
const files: AskQuestion = { id: 'q6', question: 'Which files?', modality: 'file', multiple: true };
const repo: AskQuestion = { id: 'q5', question: 'Which repository is this for?', modality: 'repository' };
const PROJECTS = [{ name: 'maws', directory: '/Users/me/maws' }, { name: 'site', directory: '/Users/me/site' }];

const d = (over: Partial<Draft>): Draft => ({ ...EMPTY_DRAFT, ...over });

describe('toAnswer', () => {
  it('a single-select choice: one label in a list', () => {
    expect(toAnswer(single, pickOption(single, EMPTY_DRAFT, 'Blue'))).toEqual({ id: 'q1', question: 'Which colour?', status: 'answered', value: ['Blue'] });
  });

  it('a single-select choice answered under Other alone: no label, the typed text', () => {
    const draft = setOther(single, pickOption(single, EMPTY_DRAFT, 'Red'), 'Teal');
    expect(draft.selected).toEqual([]);
    expect(toAnswer(single, draft)).toEqual({ id: 'q1', question: 'Which colour?', status: 'answered', value: [], otherText: 'Teal' });
  });

  it('a multi-select choice: the labels in option order, plus Other', () => {
    let draft = toggleOption(multi, EMPTY_DRAFT, 'Wed', true);
    draft = toggleOption(multi, draft, 'Mon', true);
    draft = setOther(multi, draft, 'Fri');
    expect(toAnswer(multi, draft)).toEqual({ id: 'q2', question: 'Which days?', status: 'answered', value: ['Mon', 'Wed'], otherText: 'Fri' });
    expect(toAnswer(multi, toggleOption(multi, draft, 'Mon', false)).value).toEqual(['Wed']);
  });

  it('text: the text as typed', () => {
    expect(toAnswer(text, setText(EMPTY_DRAFT, 'Spring launch'))).toEqual({ id: 'q3', question: 'What should the title be?', status: 'answered', value: 'Spring launch' });
  });

  it('file and folder: the absolute paths, each once', () => {
    expect(toAnswer(folder, addPaths(folder, EMPTY_DRAFT, ['/repo/assets']))).toEqual({ id: 'q4', question: 'Which folder holds the assets?', status: 'answered', value: ['/repo/assets'] });
    const picked = addPaths(files, addPaths(files, EMPTY_DRAFT, ['/a.txt', '/b.txt']), ['/b.txt', '/c.txt']);
    expect(toAnswer(files, picked).value).toEqual(['/a.txt', '/b.txt', '/c.txt']);
    expect(toAnswer(files, removePath(picked, '/b.txt')).value).toEqual(['/a.txt', '/c.txt']);
  });

  it('a single file or folder question keeps the latest pick only', () => {
    const picked = addPaths(folder, addPaths(folder, EMPTY_DRAFT, ['/one']), ['/two']);
    expect(picked.paths).toEqual(['/two']);
  });

  it('repository: the project’s directory, with its name', () => {
    expect(toAnswer(repo, setRepository(EMPTY_DRAFT, '/Users/me/site'), PROJECTS)).toEqual({
      id: 'q5', question: 'Which repository is this for?', status: 'answered', value: '/Users/me/site', name: 'site',
    });
    // a directory no project names any more still answers, without a name
    expect(toAnswer(repo, setRepository(EMPTY_DRAFT, '/gone'), PROJECTS)).toEqual({ id: 'q5', question: 'Which repository is this for?', status: 'answered', value: '/gone' });
  });

  it('Decide for me and Skip carry no value, whatever the draft holds', () => {
    const filled = pickOption(single, EMPTY_DRAFT, 'Red');
    expect(toAnswer(single, setDecide(filled, true))).toEqual({ id: 'q1', question: 'Which colour?', status: 'decide_for_me' });
    expect(toAnswer(single, setSkip(filled, true))).toEqual({ id: 'q1', question: 'Which colour?', status: 'skipped' });
  });

  it('an empty draft is skipped, for every modality', () => {
    for (const question of [single, multi, text, folder, files, repo]) {
      expect(toAnswer(question, EMPTY_DRAFT, PROJECTS)).toEqual({ id: question.id, question: question.question, status: 'skipped' });
    }
    expect(toAnswer(text, setText(EMPTY_DRAFT, '   ')).status).toBe('skipped');
  });

  it('every answer the sheet can produce is one the host admits', () => {
    const questions = [single, multi, text, folder, repo];
    const drafts = new Map<string, Draft>([
      ['q1', setOther(single, EMPTY_DRAFT, 'Teal')],
      ['q2', toggleOption(multi, EMPTY_DRAFT, 'Tue', true)],
      ['q3', setSkip(EMPTY_DRAFT, true)],
      ['q4', addPaths(folder, EMPTY_DRAFT, ['/repo/assets'])],
      ['q5', setDecide(EMPTY_DRAFT, true)],
    ]);
    expect(askAnswersProblem(questions, toAnswers(questions, drafts, PROJECTS))).toBeNull();
    expect(askAnswersProblem(questions, toAnswers(questions, new Map(), PROJECTS))).toBeNull();
  });
});

describe('exclusivity', () => {
  it('Decide for me and Skip turn each other off', () => {
    expect(setSkip(setDecide(EMPTY_DRAFT, true), true)).toMatchObject({ decide: false, skip: true });
    expect(setDecide(setSkip(EMPTY_DRAFT, true), true)).toMatchObject({ decide: true, skip: false });
  });

  it('answering turns both off', () => {
    const decided = setDecide(EMPTY_DRAFT, true);
    expect(pickOption(single, decided, 'Red')).toMatchObject({ decide: false, skip: false });
    expect(toggleOption(multi, setSkip(EMPTY_DRAFT, true), 'Mon', true)).toMatchObject({ skip: false });
    expect(setOther(single, decided, '')).toMatchObject({ decide: false });
    expect(setText(decided, 'x')).toMatchObject({ decide: false });
    expect(addPaths(folder, decided, ['/x'])).toMatchObject({ decide: false });
    expect(setRepository(setSkip(EMPTY_DRAFT, true), '/x')).toMatchObject({ skip: false });
  });

  it('a single-select’s Other and its labels exclude each other; a multi-select’s do not', () => {
    const other = setOther(single, EMPTY_DRAFT, 'Teal');
    expect(pickOption(single, other, 'Red')).toMatchObject({ selected: ['Red'], otherText: null });
    const both = setOther(multi, toggleOption(multi, EMPTY_DRAFT, 'Mon', true), 'Fri');
    expect(both).toMatchObject({ selected: ['Mon'], otherText: 'Fri' });
  });

  it('turning a toggle off restores the draft beneath it', () => {
    const filled = pickOption(single, EMPTY_DRAFT, 'Red');
    expect(toAnswer(single, setDecide(setDecide(filled, true), false)).value).toEqual(['Red']);
  });
});

describe('draftStatus and Submit', () => {
  it('answered, delegated, skipped, empty, or incomplete', () => {
    expect(draftStatus(single, pickOption(single, EMPTY_DRAFT, 'Red'))).toBe('answered');
    expect(draftStatus(single, setDecide(EMPTY_DRAFT, true))).toBe('decide');
    expect(draftStatus(single, setSkip(EMPTY_DRAFT, true))).toBe('skipped');
    expect(draftStatus(single, EMPTY_DRAFT)).toBe('empty');
    // Other chosen and nothing typed: neither an answer nor empty, so Submit waits
    expect(draftStatus(single, setOther(single, EMPTY_DRAFT, ''))).toBe('incomplete');
    expect(draftStatus(multi, setOther(multi, toggleOption(multi, EMPTY_DRAFT, 'Mon', true), ' '))).toBe('incomplete');
    expect(draftStatus(text, d({ text: 'x' }))).toBe('answered');
  });

  it('skippedCount counts the skipped and the empty questions', () => {
    const drafts = new Map<string, Draft>([['q1', setSkip(EMPTY_DRAFT, true)], ['q3', setText(EMPTY_DRAFT, 'x')]]);
    expect(skippedCount([single, multi, text], drafts)).toBe(2);
  });
});

// P2-C3 (the P2 spec's Decision Log 34): a note beside the answer, whatever its status
describe('the note', () => {
  it('neither toggle touches it, nor it them, nor does an edit of the answer', () => {
    const noted = setNote(setDecide(EMPTY_DRAFT, true), 'Keep it small');
    expect(noted).toMatchObject({ decide: true, note: 'Keep it small' });
    expect(setSkip(noted, true)).toMatchObject({ skip: true, decide: false, note: 'Keep it small' });
    expect(setDecide(setSkip(noted, true), false)).toMatchObject({ note: 'Keep it small' });
    expect(pickOption(single, noted, 'Red')).toMatchObject({ decide: false, note: 'Keep it small' });
    expect(setText(setNote(EMPTY_DRAFT, 'n'), 'x').note).toBe('n');
  });

  it('draftStatus ignores it: a note alone leaves the question empty', () => {
    expect(draftStatus(single, setNote(EMPTY_DRAFT, 'Not sure yet'))).toBe('empty');
    expect(skippedCount([single], new Map([['q1', setNote(EMPTY_DRAFT, 'Not sure yet')]]))).toBe(1);
  });

  it('travels trimmed on every status, and not at all when blank or never opened', () => {
    const base = { id: 'q1', question: 'Which colour?' };
    expect(toAnswer(single, setNote(pickOption(single, EMPTY_DRAFT, 'Red'), '  warm, please\n'))).toEqual({ ...base, status: 'answered', value: ['Red'], note: 'warm, please' });
    expect(toAnswer(single, setNote(setSkip(EMPTY_DRAFT, true), 'later'))).toEqual({ ...base, status: 'skipped', note: 'later' });
    expect(toAnswer(single, setNote(setDecide(EMPTY_DRAFT, true), 'anything bright'))).toEqual({ ...base, status: 'decide_for_me', note: 'anything bright' });
    expect(toAnswer(single, setNote(EMPTY_DRAFT, 'only a note'))).toEqual({ ...base, status: 'skipped', note: 'only a note' });
    expect(toAnswer(single, setNote(pickOption(single, EMPTY_DRAFT, 'Red'), '   '))).not.toHaveProperty('note');
    expect(toAnswer(single, setNote(EMPTY_DRAFT, ''))).not.toHaveProperty('note');
    expect(toAnswer(single, pickOption(single, EMPTY_DRAFT, 'Red'))).not.toHaveProperty('note');
  });

  it('a noted answer is one the host admits', () => {
    const drafts = new Map<string, Draft>([['q1', setNote(setSkip(EMPTY_DRAFT, true), 'later')], ['q3', setNote(setText(EMPTY_DRAFT, 'x'), 'a draft title')]]);
    expect(askAnswersProblem([single, text], toAnswers([single, text], drafts))).toBeNull();
  });
});
