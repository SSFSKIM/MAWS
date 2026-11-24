// A question's words, a receipt, and the draft and the Send (§B `words.ts`): the contracts M3's surface and C4's page
// build their Send on.
import { describe, expect, it } from 'vitest';
import type { SheetQuestion } from './model';
import { lineError } from './read';
import { SEND_MAX_LINES, TEXT_MAX, confirmDraft, draftConflict, hasAnswer, isConfirmed, isTooLong, questionSentence, receiptOf, sendOf, type QuestionDraft } from './words';

function question(id: string, options: string[] = ['Yes', 'No'], fields: Partial<SheetQuestion> = {}): SheetQuestion {
  return {
    id,
    revision: 1,
    asker: 'main',
    question: `Question ${id}?`,
    options: options.map((label) => ({ label })),
    multiSelect: false,
    references: [],
    askedAt: '2026-11-23T09:00:00.000Z',
    callId: 'toolu_01Words',
    handle: id,
    ...fields,
  };
}

const draft = (fields: Partial<QuestionDraft> = {}): QuestionDraft => ({ revision: 1, picks: [], text: '', images: [], ...fields });
const keys = () => {
  let n = 0;
  return () => `maws-${String((n += 1)).padStart(8, '0')}`;
};

describe('questionSentence', () => {
  it('shows the sentence that asks, not the statement before it', () => {
    expect(questionSentence('The two checks disagree on expiry. Is the session check in these lines the one to keep?')).toBe(
      'Is the session check in these lines the one to keep?',
    );
    expect(questionSentence('Which auth method should the login use?')).toBe('Which auth method should the login use?');
  });

  it('shows the first sentence when none asks', () => {
    expect(questionSentence('Rename the settings page. Then ship it.')).toBe('Rename the settings page.');
    expect(questionSentence('Pick a log level')).toBe('Pick a log level');
  });

  it('ends a sentence only where its mark ends a word, or at a line break', () => {
    expect(questionSentence('Is v1.2 the one to ship? It is the last.')).toBe('Is v1.2 the one to ship?');
    expect(questionSentence('See src/auth.ts first\nShould the check move?')).toBe('Should the check move?');
    expect(questionSentence('First line\nSecond line')).toBe('First line');
    expect(questionSentence('\n\n  Ship it today?  ')).toBe('Ship it today?');
    expect(questionSentence('Really?! Then ship.')).toBe('Really?!');
    expect(questionSentence('')).toBe('');
  });
});

describe('receiptOf', () => {
  it('joins the labels, or reads the text’s first 80 characters, as the record does', () => {
    expect(receiptOf(['OAuth', 'Passkeys'], 'passkeys only on mobile')).toBe('OAuth, Passkeys');
    expect(receiptOf([], 'Nothing waiting for you.')).toBe('Nothing waiting for you.');
    expect(receiptOf([], '\u{1F600}'.repeat(100))).toBe('\u{1F600}'.repeat(80));
    expect(receiptOf([], '')).toBe('');
  });
});

describe('the draft', () => {
  it('has an answer with a pick or a text that is not blank; an image alone is none', () => {
    expect(hasAnswer(undefined)).toBe(false);
    expect(hasAnswer(draft({ picks: ['Yes'] }))).toBe(true);
    expect(hasAnswer(draft({ text: 'Only on mobile' }))).toBe(true);
    expect(hasAnswer(draft({ text: '  \n ' }))).toBe(false);
    expect(hasAnswer(draft({ images: ['uploads/maws-0123.png'] }))).toBe(false);
  });

  it('stays at the revision it was typed against until the person confirms it on the rewritten card', () => {
    const rewritten = question('q1', ['Yes', 'No', 'Later'], { revision: 2, handle: 'q1@2' });
    const typed = draft({ picks: ['No'], text: 'not this week' });
    expect(isConfirmed(typed, rewritten)).toBe(false);
    expect(sendOf([rewritten], new Map([['q1', typed]]), 'maws', keys())).toEqual({ lines: [], ids: [], left: 0 });

    const kept = confirmDraft(typed, rewritten);
    expect(kept).toEqual({ ...typed, revision: 2 });
    expect(isConfirmed(kept, rewritten)).toBe(true);
    expect(sendOf([rewritten], new Map([['q1', kept]]), 'maws', keys()).lines).toEqual([
      { v: 1, key: 'maws-00000001', kind: 'answer', id: 'q1', revision: 2, picks: ['No'], text: 'not this week', by: 'maws' },
    ]);
  });

  it('keeps on confirming only the picks that are still labels, one unless the question is multi-select', () => {
    const typed = draft({ picks: ['Gone', 'Yes', 'No'] });
    expect(confirmDraft(typed, question('q1', ['Yes', 'No'], { revision: 3 })).picks).toEqual(['Yes']);
    expect(confirmDraft(typed, question('q1', ['Yes', 'No'], { revision: 3, multiSelect: true })).picks).toEqual(['Yes', 'No']);
  });
});

describe('sendOf', () => {
  it('sends the confirmed drafts with an answer, oldest question first, each line one the door takes', () => {
    const open = [question('q1'), question('q2'), question('q3'), question('q4', [], { multiSelect: false })];
    const drafts = new Map<string, QuestionDraft>([
      ['q4', draft({ text: 'Only on mobile', images: ['uploads/maws-0123.png'] })],
      ['q2', draft({ picks: ['Yes'], text: '   ' })],
      ['q3', draft({ images: ['uploads/maws-0456.png'] })], // an image alone is no answer
      ['q9', draft({ picks: ['Yes'] })], // no longer listed
    ]);
    const send = sendOf(open, drafts, 'page', keys());
    expect(send.ids).toEqual(['q2', 'q4']);
    expect(send.left).toBe(0);
    expect(send.lines).toEqual([
      { v: 1, key: 'maws-00000001', kind: 'answer', id: 'q2', revision: 1, picks: ['Yes'], by: 'page' },
      { v: 1, key: 'maws-00000002', kind: 'answer', id: 'q4', revision: 1, text: 'Only on mobile', images: ['uploads/maws-0123.png'], by: 'page' },
    ]);
    for (const line of send.lines) expect(lineError(line)).toBeNull();
  });

  it('carries an edit of a queued answer as a retract of its key and then the answer, in that order', () => {
    const queued = question('q1', ['Yes', 'No'], {
      queued: { key: 'cli-1901a001', kind: 'answer', picks: ['Yes'], text: '', images: [], revision: 1, by: 'cli' },
    });
    const send = sendOf([queued], new Map([['q1', draft({ picks: ['No'], replaces: 'cli-1901a001' })]]), 'maws', keys());
    expect(send.lines).toEqual([
      { v: 1, key: 'maws-00000001', kind: 'retract', target: 'cli-1901a001', by: 'maws' },
      { v: 1, key: 'maws-00000002', kind: 'answer', id: 'q1', revision: 1, picks: ['No'], by: 'maws' },
    ]);
    expect(send.ids).toEqual(['q1']);
  });

  it('stops before the draft whose lines would pass fifty, and never parts a retract from its answer', () => {
    expect(SEND_MAX_LINES).toBe(50);
    const open = Array.from({ length: 51 }, (_, n) => question(`q${n + 1}`));
    open[49] = question('q50', ['Yes', 'No'], { queued: { key: 'cli-00000001', kind: 'answer', picks: ['Yes'], text: '', images: [], revision: 1, by: 'cli' } });
    const drafts = new Map(open.slice(0, 49).map((q) => [q.id, draft({ picks: ['Yes'] })]));
    drafts.set('q50', draft({ picks: ['No'], replaces: 'cli-00000001' }));
    const send = sendOf(open, drafts, 'maws', keys());
    expect(send.lines).toHaveLength(49);
    expect(send.lines.every((line) => line.kind === 'answer')).toBe(true);
    expect(send.ids).toHaveLength(49);
    expect(send.left).toBe(1);
    // A one-line draft after it waits too: one Send takes the questions in order and stops.
    drafts.set('q51', draft({ picks: ['No'] }));
    expect(sendOf(open, drafts, 'maws', keys())).toMatchObject({ ids: send.ids, left: 2 });
  });
});

describe('what Send may take', () => {
  const queued = (key: string) => ({ key, kind: 'answer' as const, picks: ['Yes'], text: '', images: [], revision: 1, by: 'cli' as const });

  it('holds a draft in conflict when the answer its card shows is not the one it was written against', () => {
    expect(draftConflict(draft({ picks: ['No'] }), question('q1'))).toBe(false);
    expect(draftConflict(draft({ picks: ['No'], replaces: 'cli-1901a001' }), question('q1', ['Yes', 'No'], { queued: queued('cli-1901a001') }))).toBe(false);
    // another surface queued an answer while this draft was written
    expect(draftConflict(draft({ picks: ['No'] }), question('q1', ['Yes', 'No'], { queued: queued('cli-1901a001') }))).toBe(true);
    // the queued answer it edits was taken back, or replaced by another
    expect(draftConflict(draft({ picks: ['No'], replaces: 'cli-1901a001' }), question('q1'))).toBe(true);
    expect(draftConflict(draft({ picks: ['No'], replaces: 'cli-1901a001' }), question('q1', ['Yes', 'No'], { queued: queued('cli-1901a002') }))).toBe(true);
  });

  it('counts a text past 20,000 code points as too long, in code points', () => {
    expect(TEXT_MAX).toBe(20000);
    expect(isTooLong(draft({ text: 'a'.repeat(20000) }))).toBe(false);
    expect(isTooLong(draft({ text: 'a'.repeat(20001) }))).toBe(true);
    expect(isTooLong(draft({ text: '😀'.repeat(20000) }))).toBe(false); // 40,000 UTF-16 units
  });

  it('takes neither a draft in conflict nor one too long, and leaves both out of its count and its rest', () => {
    const open = [question('q1', ['Yes', 'No'], { queued: queued('cli-1901a001') }), question('q2'), question('q3')];
    const drafts = new Map<string, QuestionDraft>([
      ['q1', draft({ picks: ['No'] })],
      ['q2', draft({ text: 'x'.repeat(20001) })],
      ['q3', draft({ picks: ['Yes'] })],
    ]);
    const send = sendOf(open, drafts, 'maws', keys());
    expect(send.ids).toEqual(['q3']);
    expect(send.left).toBe(0);
    for (const line of send.lines) expect(lineError(line)).toBeNull();
  });
});
