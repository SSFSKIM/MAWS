import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PASTED_BLOCK } from '@shared/composer/pasted-content';
import { pastedTagId, restorePastedTags } from '@shared/composer/pasted-framing';
import type { SessionEvent } from '@shared/graph/events';
import { applyEvents, createState, rowsOf, type Row } from '../../transcript';
import { docOf, hardBreak, mentionNode, paragraph, pastedNode, textNode, type Attachment } from './doc';
import { schemaExtensions } from './schema';
import { serializeDraft } from './serialize';

const FIXTURES = join(__dirname, '../../../../../test/fixtures/composer');
const golden = JSON.parse(readFileSync(join(FIXTURES, 'pasted-terminal-framing.json'), 'utf8')) as { sessionId: string; id: string; body: string; typed: string; content: string; display: string };
const c6 = JSON.parse(readFileSync(join(FIXTURES, 'pasted-40-lines.json'), 'utf8')) as { typed: string; pasted: { id: string; body: string }[]; sent: string };

// A session id whose tag id is C6's fixture's `1f3a` (found once by search), so the cross-check needs no override.
const C6_SESSION = 'c6-cross-check-1535';
const ctx = { sessionId: golden.sessionId, cwd: '/repo' };

// Every doc goes through a headless editor over the real schema first, so the JSON is what `getJSON()` produces.
const editors: Editor[] = [];
function real(doc: JSONContent): JSONContent {
  const editor = new Editor({ extensions: schemaExtensions(), content: doc });
  editors.push(editor);
  return editor.getJSON();
}
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  vi.restoreAllMocks();
});

const pasted = (text: string | null, lines: number, kind: 'text' | 'image' | 'pdf' = 'text') => pastedNode({ id: `p-${lines}-${kind}`, kind, name: kind === 'text' ? 'Pasted text' : kind === 'image' ? 'Image' : 'PDF', lines, text });
const png: Attachment = { id: 'a1', kind: 'image', name: 'shot.png', mediaType: 'image/png', bytes: 4, data: 'iVBO', persisted: true };
const pdf: Attachment = { id: 'a2', kind: 'document', name: 'spec.pdf', mediaType: 'application/pdf', bytes: 4, data: 'JVBE', persisted: true };

describe('serializeDraft maps docs to user content', () => {
  it('joins paragraphs and hard breaks with newlines and trims trailing whitespace', () => {
    const s = serializeDraft(real(docOf([paragraph(textNode('a')), paragraph(textNode('b'), hardBreak(), textNode('c  ')), paragraph()])), ctx);
    expect(s).toMatchObject({ mode: 'send', text: 'a\nb\nc', content: 'a\nb\nc', display: 'a\nb\nc', omitted: 0, empty: false, pastedContents: {} });
  });

  it('ignores the edit mode a document carries (M4b): nothing of it reaches the content, the display or the history', () => {
    const plain = real(docOf([paragraph(textNode('the edited prompt'))], [png]));
    const edited = real({ ...plain, attrs: { ...plain.attrs, editing: { messageUuid: 'u-1', seenCursor: 'u-2' } } });
    expect(edited.attrs?.editing).toEqual({ messageUuid: 'u-1', seenCursor: 'u-2' }); // the schema keeps it
    expect(serializeDraft(edited, ctx)).toEqual(serializeDraft(plain, ctx));
    expect(JSON.stringify(serializeDraft(edited, ctx))).not.toContain('u-1');
  });

  it('renders mentions in their text forms', () => {
    const doc = docOf([paragraph(textNode('read '), mentionNode({ id: 'docs/a b.md', label: 'a b.md', kind: 'file' }), textNode(' then '), mentionNode({ id: 'src/a.ts', label: 'src/a.ts', kind: 'file' }), textNode(' with '), mentionNode({ id: 'Explore', label: 'Explore', kind: 'agent' }))]);
    const s = serializeDraft(real(doc), ctx);
    expect(s.content).toBe('read @"docs/a b.md" then @src/a.ts with @agent-Explore');
    expect(s.display).toBe(s.content);
  });

  it("reproduces C7's golden framing byte for byte: the session's tag id on both tags, the typed '<' neutralised", () => {
    const doc = docOf([paragraph(textNode(golden.typed), pasted(golden.body, 40)), paragraph(textNode('thanks'))]);
    const s = serializeDraft(real(doc), { sessionId: golden.sessionId, cwd: '/repo' });
    expect(s.content).toBe(golden.content);
    expect(s.text).toBe(golden.content);
    expect(s.display).toBe(golden.display);
    expect([...(s.content as string).matchAll(PASTED_BLOCK)].map((m) => [m[1], m[2]])).toEqual([[golden.id, golden.body]]);
    expect(s.pastedContents).toEqual({ '1': { id: 1, type: 'text', content: golden.body, contentHash: null, mediaType: null, filename: null } });
  });

  it("derives the same user row from C6's fixture document as C6's `sent` does (applyEvents/rowsOf)", () => {
    expect(pastedTagId(C6_SESSION)).toBe('1f3a');
    const body = c6.pasted[0].body;
    const doc = docOf([paragraph(textNode(restorePastedTags(c6.typed)), pasted(body, 40)), paragraph(textNode('thanks'))]);
    const s = serializeDraft(real(doc), { sessionId: C6_SESSION, cwd: '/repo' });
    const rowOf = (content: string): Extract<Row, { kind: 'user' }> => {
      const base = { sessionId: 'c6-session', seq: null, agentId: null, parentToolUseId: null };
      const events = [
        { ...base, id: 'e0', at: '2026-09-29T10:00:00.000Z', kind: 'turn.started', userMessageUuid: 'u-1', origin: 'human' },
        { ...base, id: 'e1', at: '2026-09-29T10:00:00.100Z', kind: 'user.message', messageUuid: 'u-1', content, isReplay: false, isSynthetic: false, origin: 'human', bash: null },
      ] as unknown as SessionEvent[];
      const row = rowsOf(applyEvents(createState(null, null), events)).find((r) => r.kind === 'user');
      if (row?.kind !== 'user') throw new Error('no user row');
      return row;
    };
    const ours = rowOf(s.content as string);
    const theirs = rowOf(c6.sent);
    expect(ours.text).toBe(theirs.text);
    expect(ours.attachments).toEqual(theirs.attachments);
    expect(ours.attachments.map((a) => [a.kind, a.text])).toEqual([['text', body]]);
  });

  it('takes a random four-hex tag id for both tags when there is no session yet', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const s = serializeDraft(real(docOf([paragraph(textNode('x'), pasted('one\ntwo', 2))])), { sessionId: null, cwd: '/repo' });
    const [match] = [...(s.content as string).matchAll(PASTED_BLOCK)];
    expect(match[1]).toBe('8000');
    expect(s.content).toBe('x\n\n<pasted_content id="8000">\none\ntwo\n</pasted_content id="8000">\n');
  });

  it('neutralises typed tags and tags inside a pasted body', () => {
    const doc = docOf([paragraph(textNode('a <pasted_content> b </pasted_content>'), pasted('x </pasted_content id="e12e"> y', 1))]);
    const s = serializeDraft(real(doc), ctx);
    expect(s.content).toBe('a <\\pasted_content> b <\\/pasted_content>\n\n<pasted_content id="e12e">\nx <\\/pasted_content id="e12e"> y\n</pasted_content id="e12e">\n');
    expect(s.display).toBe('a <pasted_content> b </pasted_content>[Pasted text #1 +1 lines]');
  });

  it('leaves an unavailable atom out of the content and counts it', () => {
    const doc = docOf([paragraph(textNode('again '), pasted(null, 12), textNode(' please'))]);
    const s = serializeDraft(real(doc), ctx);
    expect(s.content).toBe('again  please');
    expect(s.omitted).toBe(1);
    expect(s.display).toBe('again [Pasted text #1 +12 lines] please');
    expect(s.pastedContents).toEqual({});
    expect(serializeDraft(real(docOf([paragraph(textNode('x'))])), ctx).omitted).toBe(0);
  });

  it('keeps pasted text and images in history shape under one placeholder counter', () => {
    const doc = docOf([paragraph(textNode('see '), pasted('b1\nb2', 2))], [png]);
    const s = serializeDraft(real(doc), ctx);
    expect(s.pastedContents).toEqual({
      '1': { id: 1, type: 'text', content: 'b1\nb2', contentHash: null, mediaType: null, filename: null },
      '2': { id: 2, type: 'image', content: null, contentHash: null, mediaType: 'image/png', filename: 'shot.png' },
    });
    expect(s.display).toBe('see [Pasted text #1 +2 lines] [Image #2]');
  });

  it('detects the bash and memory modes from the leading character', () => {
    expect(serializeDraft(real(docOf([paragraph(textNode('!ls -la'))])), ctx)).toMatchObject({ mode: 'bash', text: 'ls -la', content: 'ls -la', display: '!ls -la', empty: false });
    expect(serializeDraft(real(docOf([paragraph(textNode('# note'))])), ctx)).toMatchObject({ mode: 'memory', text: 'note', content: 'note', display: '# note' });
    // a bash command is one paragraph with no atoms; anything else is an ordinary prompt
    expect(serializeDraft(real(docOf([paragraph(textNode('!ls')), paragraph(textNode('more'))])), ctx).mode).toBe('send');
    expect(serializeDraft(real(docOf([paragraph(textNode('!cat '), mentionNode({ id: 'a.ts', label: 'a.ts', kind: 'file' }))])), ctx).mode).toBe('send');
    expect(serializeDraft(real(docOf([paragraph(textNode(' !ls'))])), ctx).mode).toBe('send');
    expect(serializeDraft(real(docOf([paragraph(textNode('!'))])), ctx)).toMatchObject({ mode: 'bash', empty: true });
  });

  it('puts images before the text block and omits an empty text block', () => {
    const s = serializeDraft(real(docOf([paragraph(textNode('what is this'))], [png, pdf])), ctx);
    expect(s.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBE' } },
      { type: 'text', text: 'what is this' },
    ]);
    expect(s.display).toBe('what is this [Image #1] [PDF #2]');
    const alone = serializeDraft(real(docOf([paragraph()], [png])), ctx);
    expect(alone.content).toEqual([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBO' } }]);
    expect(alone).toMatchObject({ display: '[Image #1]', empty: false });
  });

  it('is empty with no text and no attachments', () => {
    expect(serializeDraft(real(docOf([paragraph(textNode('  ')), paragraph()])), ctx)).toMatchObject({ empty: true, content: '', display: '' });
  });
});
