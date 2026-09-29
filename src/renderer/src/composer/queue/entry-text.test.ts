import { describe, expect, it } from 'vitest';
import { docOf, paragraph, pastedNode, textNode } from '../editor/doc';
import { serializeDraft } from '../editor/serialize';
import { entryDisplay, entryDoc } from './entry-text';

const body = 'one\ntwo\nthree';
const ctx = { sessionId: '7c0e2d1a-4b3f-4c5d-8e6f-9a0b1c2d3e4f', cwd: '/repo' };
const typed = docOf([paragraph(textNode('see <pasted_content> '), pastedNode({ id: 'p1', kind: 'text', name: 'Pasted text #1', lines: 3, text: body })), paragraph(textNode('thanks'))]);

describe('a queued entry reads back as one line and as an editable document', () => {
  it('names pasted blocks, images and PDFs, and restores what was typed', () => {
    const { content } = serializeDraft(typed, ctx);
    expect(entryDisplay(content)).toBe('see <pasted_content> [Pasted text #1 +3 lines] thanks');
    const blocks = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBE' } },
      { type: 'text', text: 'what is\nthis' },
    ];
    expect(entryDisplay(blocks)).toBe('[Image #1] [PDF #1] what is this');
  });

  it('rebuilds a document that serialises back to the same content', () => {
    const { content } = serializeDraft(typed, ctx);
    expect(serializeDraft(entryDoc(content), ctx).content).toBe(content);
    const blocks = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } }, { type: 'text', text: 'look' }];
    expect(serializeDraft(entryDoc(blocks), ctx).content).toEqual(blocks);
  });
});
