// A first message between C7's composer and C10's setup (M4b): the prefill that hands a retained message back to the
// editor, and the message a resubmit's content becomes. Both follow C7's serialiser (`serializeDraft`), so the round
// trip through a real document is the pin.
import { describe, expect, it } from 'vitest';
import { framePasted } from '@shared/composer/pasted-content';
import { atomId, docOf, paragraph, pastedNode, textNode, type Attachment } from '../composer/editor/doc';
import { prefillToDoc } from '../composer/editor/recall';
import { serializeDraft } from '../composer/editor/serialize';
import { firstMessageOf, messagePrefill } from './first-message';

const PNG = 'iVBORw0KGgo=';
const image = (name: string): Attachment => ({ id: atomId('attachment'), kind: 'image', name, mediaType: 'image/png', bytes: 8, data: PNG, persisted: true });
const pasted = (text: string) => pastedNode({ id: atomId('pasted'), kind: 'text', name: 'Pasted text #1', lines: text.split('\n').length, text });
const ctx = { sessionId: 's1', cwd: '/r' }; // a fixed tag id, so two sends of one document are equal

describe('messagePrefill', () => {
  it('hands plain text back as typed', () => {
    expect(messagePrefill({ content: 'Reply OK', display: 'Reply OK' })).toEqual({ text: 'Reply OK', pasted: [], images: [], editing: null });
  });

  it('restores pasted bodies behind their placeholders and re-attaches images without their placeholders', () => {
    const body = 'line one\nline <pasted_content two';
    const doc = docOf([paragraph(textNode('see '), pasted(body), textNode(' then')), paragraph(textNode('more'))], [image('shot.png')]);
    const sent = serializeDraft(doc, ctx);
    expect(sent.display).toBe('see [Pasted text #1 +2 lines] then\nmore [Image #2]');
    const prefill = messagePrefill({ content: sent.content, display: sent.display });
    expect(prefill).toEqual({ text: 'see [Pasted text #1 +2 lines] then\nmore', pasted: [{ name: 'Pasted text #1', text: body }], images: [{ name: 'Image #2', mediaType: 'image/png', data: PNG }], editing: null });
    // what the editor rebuilds from it sends the same message again
    const again = serializeDraft(prefillToDoc(prefill), ctx);
    expect(again.display).toBe(sent.display);
    expect(again.content).toEqual(sent.content);
  });

  it('keeps a PDF as its placeholder: a prefill cannot carry a document back', () => {
    const content = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' } }, { type: 'text', text: 'read this' }];
    expect(messagePrefill({ content, display: 'read this [PDF #1]' })).toEqual({ text: 'read this [PDF #1]', pasted: [], images: [], editing: null });
  });
});

describe('firstMessageOf', () => {
  it('derives the display C7 would have kept for the same document', () => {
    const doc = docOf([paragraph(textNode('see '), pasted('a\nb\nc'), textNode(' end'))], [image('a.png')]);
    const sent = serializeDraft(doc, ctx);
    expect(firstMessageOf(sent.content)).toEqual({ content: sent.content, display: sent.display });
  });

  it('takes a plain string as its own display, and a typed tag as typed', () => {
    expect(firstMessageOf('hello')).toEqual({ content: 'hello', display: 'hello' });
    expect(firstMessageOf('a <\\pasted_content b')).toEqual({ content: 'a <\\pasted_content b', display: 'a <pasted_content b' });
    expect(firstMessageOf(`x\n\n${framePasted('ab12', 'body')}\n`).display).toBe('x[Pasted text #1 +1 lines]');
  });
});
