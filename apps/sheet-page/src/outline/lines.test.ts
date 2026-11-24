// The outline's lines (F9 and its settlement once drawn): one line a listed question, in the cards' order, its second
// row the draft as a receipt reads it, a queued answer's receipt after "queued", or the question's line.
import { describe, expect, it } from 'vitest';
import type { QuestionDraft } from '@shared/sheet/words';
import { EMPTY_MEMORY, type SheetMemory } from '../../../../src/renderer/src/sheet';
import { CLASH, FIXTURE, NOTICES, SEASON, sheetOf } from '../../../../src/renderer/src/sheet/test-support/questions';
import { countLine, outlineLines } from './lines';

const draft = (picks: string[], text = ''): QuestionDraft => ({ revision: 1, picks, text, images: [] });
const memoryOf = (drafts: [string, QuestionDraft][], rest: Partial<SheetMemory> = {}): SheetMemory => ({ ...EMPTY_MEMORY, drafts: new Map(drafts), ...rest });

describe('the outline’s lines', () => {
  it('lists every open question in the model’s order, with its id, header and asker', () => {
    const lines = outlineLines(sheetOf([CLASH, NOTICES, SEASON, FIXTURE]), EMPTY_MEMORY);
    expect(lines.map((line) => [line.id, line.header, line.from])).toEqual([
      ['q4', 'Clash rule', null],
      ['q5', 'Notices', null],
      ['q6', 'Season dates', null],
      ['q7', 'Fixture', 'reviewer'],
    ]);
  });

  it('reads a draft as its receipt: its picks only, or the typed text’s start; else the question’s line', () => {
    const lines = outlineLines(sheetOf([CLASH, NOTICES, SEASON, FIXTURE]), memoryOf([
      ['q4', draft(['Keep the earlier sailing'], 'and tell the office')],
      ['q5', draft(['Tidal restrictions', 'Vehicle deck limits'])],
      ['q6', draft([], 'From 1 November to 21 March, as the fare table has it. '.repeat(3))],
      ['q7', { ...draft([]), images: ['uploads/maws-0123.png'] }], // an image alone is no answer
    ]));
    expect(lines.map((line) => line.second)).toEqual([
      { kind: 'draft', text: 'Keep the earlier sailing' },
      { kind: 'draft', text: 'Tidal restrictions, Vehicle deck limits' },
      { kind: 'draft', text: 'From 1 November to 21 March, as the fare table has it. '.repeat(3).slice(0, 80) }, // the record's receipt: 80 at most
      { kind: 'question', text: 'May I replace it with this season’s sailings?' }, // the sentence that asks
    ]);
  });

  it('reads a stopped session’s queued answer as its receipt, after "queued"', () => {
    const queued = { ...CLASH, queued: { key: 'page-0000000000000000000000000a', kind: 'answer' as const, picks: ['Keep both and flag the pair'], text: '', images: [], revision: 1, by: 'page' as const } };
    expect(outlineLines(sheetOf([queued]), EMPTY_MEMORY)[0]!.second).toEqual({ kind: 'queued', text: 'Keep both and flag the pair' });
  });

  it('marks a question rewritten since it was seen, or refused as stale, as its card does', () => {
    const memory = memoryOf([], { marked: new Set(['q5']), acts: [{ key: 'k-0000000001', kind: 'answer', id: 'q6', draft: null, sentAt: 1, state: 'stale', note: null }] });
    expect(outlineLines(sheetOf([CLASH, NOTICES, SEASON]), memory).map((line) => line.updated)).toEqual([false, true, true]);
  });

  it('counts the questions, and the drafted ones when any is', () => {
    const lines = outlineLines(sheetOf([CLASH, NOTICES, SEASON]), memoryOf([['q4', draft(['Keep the earlier sailing'])]]));
    expect(countLine(lines)).toBe('3 questions · 1 drafted');
    expect(countLine(outlineLines(sheetOf([CLASH]), EMPTY_MEMORY))).toBe('1 question');
    expect(countLine([])).toBe('0 questions');
  });
});
