import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Draft } from '@shared/ipc/schema/session';
import { docOf, mentionNode, paragraph, pastedNode, textNode, type Attachment } from './doc';
import { createDraftWriter, docOfDraft, draftOf } from './drafts';

const MiB = 1024 * 1024;
const image = (id: string, bytes: number): Attachment => ({ id, kind: 'image', name: `${id}.png`, mediaType: 'image/png', bytes, data: `data-${id}`, persisted: true });
const NOW = '2026-09-29T12:00:00.000Z';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('drafts save after a pause, restore, and clear when empty', () => {
  it('writes once, 750 ms after the last of five quick edits', () => {
    const save = vi.fn<(draft: Draft | null) => void>();
    const writer = createDraftWriter(save, { now: () => NOW });
    for (const text of ['h', 'he', 'hel', 'hell', 'hello']) {
      writer.change(docOf([paragraph(textNode(text))]));
      vi.advanceTimersByTime(200);
    }
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(549);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ doc: { content: [{ content: [{ text: 'hello' }] }] }, attachments: [], updatedAt: NOW });
  });

  it('writes null for an emptied editor and flushes a pending write at once', () => {
    const save = vi.fn<(draft: Draft | null) => void>();
    const writer = createDraftWriter(save, { now: () => NOW });
    writer.change(docOf([paragraph(textNode('x'))]));
    writer.change(docOf([paragraph(textNode('  ')), paragraph()]));
    writer.flush();
    expect(save.mock.calls).toEqual([[null]]);
    writer.flush();
    expect(save).toHaveBeenCalledTimes(1); // nothing pending
    writer.change(docOf([paragraph(textNode('y'))]));
    writer.cancel();
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('keeps attachment bytes within the budget and lists path-backed mentions', () => {
    const doc = docOf([paragraph(textNode('see '), mentionNode({ id: 'src/a.ts', label: 'src/a.ts', kind: 'file' }), textNode(' and '), mentionNode({ id: 'Explore', label: 'Explore', kind: 'agent' }))], [image('a', 3 * MiB), image('b', 2 * MiB)]);
    const draft = draftOf(doc, NOW)!;
    expect(draft.attachments).toEqual([{ path: 'src/a.ts', kind: 'file' }]);
    expect((draft.doc as { attrs: { attachments: Attachment[] } }).attrs.attachments.map((a) => a.id)).toEqual(['a']);
  });

  it('keeps a draft holding only an atom, and restores what it wrote', () => {
    const doc = docOf([paragraph(pastedNode({ id: 'p', kind: 'text', name: 'Pasted text #1', lines: 2, text: 'a\nb' }))]);
    const draft = draftOf(doc, NOW);
    expect(draft).not.toBeNull();
    expect(docOfDraft(draft)).toEqual(doc);
    expect(docOfDraft(null)).toBeNull();
    expect(docOfDraft({ doc: { type: 'not-a-doc' }, attachments: [], updatedAt: NOW })).toBeNull();
  });
});
