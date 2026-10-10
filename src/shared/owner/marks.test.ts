import { describe, expect, it } from 'vitest';
import type { AppSessionId, MessageUuid } from '../graph/ids';
import { markIdOf, marksOf, questionHead } from './marks';

const APP = 'app-1' as AppSessionId;
const UUID = 'u-1' as MessageUuid;
const at = { messageUuid: UUID, blockIndex: 2 };
const ids = (text: string) => marksOf(text, at).map((mark) => markIdOf(APP, mark.kind, mark.anchor));

describe('marksOf', () => {
  it('derives the questions and essentials of one block, with their heads and choices; to-human and insight are not marks', () => {
    const text = 'Work.\n<to-human>Plan.</to-human>\n<insight>Why.</insight>\n<essential>\nThe migration drops a column.\nDetail.</essential>\n'
      + '<need-input>Which backend?\n<choice recommended>Postgres</choice>\n<choice>SQLite</choice>\n</need-input>';
    expect(marksOf(text, at)).toEqual([
      { kind: 'essential', anchor: { ...at, span: 0 }, head: 'The migration drops a column.' },
      { kind: 'need-input', anchor: { ...at, span: 0 }, head: 'Which backend?', choices: [{ text: 'Postgres', recommended: true }, { text: 'SQLite', recommended: false }] },
    ]);
  });
  it('two identical questions in one block are two marks with distinct ids', () => {
    const text = '<need-input>Continue?</need-input>\n<need-input>Continue?</need-input>';
    expect(marksOf(text, at).map((mark) => mark.head)).toEqual(['Continue?', 'Continue?']);
    expect(ids(text)).toEqual(['app-1:u-1:2:q0', 'app-1:u-1:2:q1']);
  });
  it('an essential added before a question leaves the question’s id unchanged (kind-scoped ordinals)', () => {
    const question = '<need-input>Which backend?</need-input>';
    expect(ids(question)).toEqual(['app-1:u-1:2:q0']);
    expect(ids(`<essential>Read this first.</essential>\n${question}`)).toEqual(['app-1:u-1:2:e0', 'app-1:u-1:2:q0']);
  });
  it('a mark quoted in code is no mark', () => {
    expect(marksOf('The form is `<need-input>Which?</need-input>`.\n```\n<essential>x</essential>\n```', at)).toEqual([]);
  });
  it('nested marks are separate runs, each its own mark of its kind', () => {
    expect(ids('<to-human>Report.\n<essential>First.</essential>\n<need-input>Go?</need-input>\n<essential>Second.</essential></to-human>'))
      .toEqual(['app-1:u-1:2:e0', 'app-1:u-1:2:q0', 'app-1:u-1:2:e1']);
  });
});

// Ported from the doperpowers mod (`hooks/mods/to-human.tsx`; `tests/mods/to-human.test.ts`, "answers"), its cases
// verbatim: the head is the legacy contract by which an answer given in a terminal names its question.
describe('questionHead', () => {
  it('is the first line of the question, bounded', () => {
    expect(questionHead('\nWhich backend?\nMore detail.')).toBe('Which backend?');
    expect(questionHead('Which "mode"?')).toBe("Which 'mode'?");
    expect(questionHead('x'.repeat(200))).toBe('x'.repeat(119) + '…');
    expect(questionHead('x'.repeat(118) + '😀y')).toBe('x'.repeat(118) + '😀…');
  });
  it('cuts at 120 code points only when the line reaches them, and reads blank text as empty', () => {
    expect(questionHead('x'.repeat(119))).toBe('x'.repeat(119));
    expect(questionHead('x'.repeat(120))).toBe('x'.repeat(119) + '…');
    expect(questionHead('  \n ')).toBe('');
  });
});
