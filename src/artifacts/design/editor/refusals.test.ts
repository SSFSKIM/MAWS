// The word cut (docs/doperpowers/specs/2026-11-16-word-cut-design.md, M5 task 4; G518, G539, G527): a board edit the
// model refuses is said in a person's words, with no board id. The model's own words (`BoardError`, `frameProblems`)
// stay the agents' and the loader's; the workbench reads the refusal against the design as it stands.
import { describe, expect, it } from 'vitest';
import { transact } from '../../yjs';
import * as Y from '../../yjs/slides';
import { design, type BoardSeed } from '../fixtures/support';
import { MISSING_SOURCE_KEY } from '../model';
import { BoardError, deleteBoard, duplicateBoard, insertBoard, setBoardFrame } from '../writers';
import { boardRefusal, frameRefusals } from './refusals';

const BOARDS: BoardSeed[] = [
  { id: 'b1', at: { x: 0, y: 0, w: 390, h: 844 }, title: 'Phone' },
  { id: 'b2', at: { x: 500, y: 0, w: 1440, h: 1024 }, title: 'Desktop' },
  { id: 'b3', at: { x: 2100, y: 0, w: 1080, h: 1080 }, title: 'Poster' },
];

function thrown(write: () => unknown): unknown {
  try {
    write();
  } catch (error) {
    return error;
  }
  throw new Error('the write was not refused');
}

describe('a frame the model refuses, in a person’s words (G539)', () => {
  it('says the limit it passes, once, with no board id or key', () => {
    expect(frameRefusals({ w: 20_000 })).toEqual(['At most 16,384 px a side']);
    expect(frameRefusals({ w: 20_000, h: 17_000 })).toEqual(['At most 16,384 px a side']);
    expect(frameRefusals({ h: 0 })).toEqual(['More than 0 px a side']);
    expect(frameRefusals({ w: 16_384, h: 16_384 })).toEqual(['At most 67,108,864 px in area']);
    expect(frameRefusals({ x: Number.NaN })).toEqual(['Not a number']);
    expect(frameRefusals({ x: 0, y: 0, w: 390, h: 844 })).toEqual([]);
  });
});

describe('a refused board edit, in a person’s words (G518)', () => {
  it('names what could not be done to a held board or a board whose file never arrived', () => {
    const doc = design(BOARDS);
    transact(doc, () => {
      Y.setSlideKey(doc, 'b2', 'held', { source: '<section id="b2"><blink>x</blink></section>', reasons: ['an unknown tag <blink>'] });
      Y.setSlideKey(doc, 'b3', MISSING_SOURCE_KEY, true);
    });
    expect(boardRefusal(doc, thrown(() => duplicateBoard(doc, 'b2')), 'duplicate')).toEqual({ text: 'Can’t duplicate a board that doesn’t load', why: null });
    expect(boardRefusal(doc, thrown(() => duplicateBoard(doc, 'b3')), 'duplicate')).toEqual({ text: 'Can’t duplicate a board whose file hasn’t arrived', why: null });
  });

  it('says the design’s limit when it holds as many boards as it may', () => {
    const doc = design(Array.from({ length: 200 }, (_, i) => ({ id: `b${i}`, at: { x: i * 10, y: 0, w: 10, h: 10 } })));
    const add = thrown(() => insertBoard(doc, { id: 'one-more', frame: { x: 0, y: 0, w: 10, h: 10 } }, null));
    expect(boardRefusal(doc, add, 'add')).toEqual({ text: 'Can’t add a board: 200 boards is the most', why: null });
    expect(boardRefusal(doc, thrown(() => duplicateBoard(doc, 'b0')), 'duplicate')).toEqual({ text: 'Can’t duplicate a board: 200 boards is the most', why: null });
  });

  it('says the limit a frame passes', () => {
    const doc = design(BOARDS);
    expect(boardRefusal(doc, thrown(() => setBoardFrame(doc, 'b1', { w: 20_000 })), 'resize', { w: 20_000 })).toEqual({ text: 'At most 16,384 px a side', why: null });
  });

  it('says a board another replica deleted is gone', () => {
    const doc = design(BOARDS);
    deleteBoard(doc, 'b2');
    expect(boardRefusal(doc, thrown(() => setBoardFrame(doc, 'b2', { x: 10 })), 'resize', { x: 10 })).toEqual({ text: 'That board was deleted', why: null });
  });

  it('keeps the model’s words as the reason of any other refusal, and an unexpected error’s message as it is', () => {
    const doc = design(BOARDS);
    expect(boardRefusal(doc, new BoardError('b1', ['board b1: something new']), 'rename')).toEqual({ text: 'Can’t rename this board', why: 'board b1: something new' });
    expect(boardRefusal(doc, new Error('the session stopped'), 'delete')).toEqual({ text: 'the session stopped', why: null });
  });
});
