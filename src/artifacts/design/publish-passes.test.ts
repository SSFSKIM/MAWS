// P3-E1 (the parent's Decision Log 38): the publish's passes over C's half. A publish Design does not refuse calls C's
// `publishDeck` once, on the live document inside the one transaction (no scratch clone); one Design refuses calls it
// once on a scratch copy only, so the answer still names both halves' conflicts and the live document is untouched.
import { describe, expect, it, vi } from 'vitest';
import type { Doc } from '../yjs';
import { setStyle } from '../slides/model';
import { boardPath, CANVAS_PATH, parseCanvasJson, serializeCanvasJson, type CanvasJson } from './canvas';
import { designFiles } from './model';
import { publishCanvas } from './publish';
import { setBoardFrame } from './writers';
import { design, updatesOf } from './fixtures/support';

const deckDocs = vi.hoisted(() => [] as unknown[]);
vi.mock('../slides/publish', async (importOriginal) => {
  const real = await importOriginal<typeof import('../slides/publish')>();
  return { ...real, publishDeck: (doc: Doc, ...rest: [never, never, boolean]) => (deckDocs.push(doc), real.publishDeck(doc, ...rest)) };
});

const sentWith = (base: Record<string, string>, edit: (c: CanvasJson) => void, files: Record<string, string | null> = {}) => {
  const parsed = parseCanvasJson(base[CANVAS_PATH]!);
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  edit(parsed.canvas);
  return { [CANVAS_PATH]: serializeCanvasJson(parsed.canvas), ...files };
};
const B1 = boardPath('b1');

describe('the publish’s passes over C’s half (Decision Log 38)', () => {
  it('calls C once, on the live document, for a publish Design does not refuse, and not at all for a manifest-only one', () => {
    const doc = design();
    const base = designFiles(doc);
    deckDocs.length = 0;
    const out = publishCanvas(doc, base, sentWith(base, (c) => (c.boards.b2!.w = 1200), { [B1]: base[B1]!.replace('font-size:72px', 'font-size:72px; color:#123456') }), false);
    expect(out.conflicts).toEqual([]);
    expect(deckDocs).toEqual([doc]);
    deckDocs.length = 0;
    const read = designFiles(doc);
    expect(publishCanvas(doc, read, sentWith(read, (c) => (c.boards.b2!.x = 7)), false).conflicts).toEqual([]);
    expect(deckDocs).toEqual([]);
  });

  it('calls C once, on a scratch copy only, when Design refuses, answering both halves’ conflicts and writing nothing', () => {
    const doc = design();
    const base = designFiles(doc);
    setStyle(doc, 'b1', 'title', { color: '#ff0000' });
    setBoardFrame(doc, 'b2', { w: 999 });
    deckDocs.length = 0;
    let out!: ReturnType<typeof publishCanvas>;
    const updates = updatesOf(doc, () => (out = publishCanvas(doc, base, sentWith(base, (c) => (c.boards.b2!.w = 1200), { [B1]: base[B1]!.replace('font-size:72px', 'font-size:72px; color:#123456') }), false)));
    expect(updates).toHaveLength(0);
    expect(out.conflicts).toEqual([
      { path: CANVAS_PATH, detail: 'board b2: w changed since your read' },
      { path: B1, detail: 'element title: color changed since your read' },
    ]);
    expect(deckDocs).toHaveLength(1);
    expect(deckDocs[0]).not.toBe(doc);
  });
});
