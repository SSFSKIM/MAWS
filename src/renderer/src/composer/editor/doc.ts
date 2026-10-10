// The composer document's vocabulary (C7 execution document, Interfaces "Document model and serialisation"): plain text
// with atoms, serialised as Tiptap JSON (`editor.getJSON()`), the shape C4's `Draft.doc` stores. Attachments ride in the
// document's own attributes so a draft restores the strip with the text. Pure types and builders, no Tiptap import, so
// the serialiser and the recall builders stay DOM-free.
import type { JSONContent } from '@tiptap/core';

// An image or PDF held beside the text and sent as a content block. `data` is base64; `persisted` is false when the
// draft's byte budget left it out (the strip labels it "not kept in draft").
export type Attachment =
  | { id: string; kind: 'image'; name: string; mediaType: string; bytes: number; data: string; persisted: boolean }
  | { id: string; kind: 'document'; name: string; mediaType: 'application/pdf'; bytes: number; data: string; persisted: boolean };

// `file`: `id` is the path as inserted (relative to cwd, or absolute); `agent`: `id` is the agent name.
export interface MentionAttrs {
  id: string;
  label: string;
  kind: 'file' | 'agent';
}

// A pasted atom. `kind: 'text'` with a body is a paste the send frames in the terminal's tags; `text: null` is an
// unavailable atom (a recalled placeholder whose body is not stored), which serialises to nothing. `image` and `pdf`
// atoms exist only as unavailable recalls of `[Image #n]` and `[PDF #n]` (history keeps no bytes).
export interface PastedAttrs {
  id: string;
  kind: 'text' | 'image' | 'pdf';
  name: string;
  lines: number;
  text: string | null;
}

export const MENTION = 'mention';
export const PASTED = 'pasted';

export type ComposerDoc = JSONContent;

export const emptyDoc = (attachments: Attachment[] = []): ComposerDoc => ({ type: 'doc', attrs: { attachments }, content: [{ type: 'paragraph' }] });

export const attachmentsOf = (doc: ComposerDoc): Attachment[] => (Array.isArray(doc.attrs?.attachments) ? (doc.attrs.attachments as Attachment[]) : []);

export const textNode = (text: string): JSONContent => ({ type: 'text', text });
export const hardBreak = (): JSONContent => ({ type: 'hardBreak' });
export const mentionNode = (attrs: MentionAttrs): JSONContent => ({ type: MENTION, attrs: { ...attrs, mentionSuggestionChar: '@' } });
export const pastedNode = (attrs: PastedAttrs): JSONContent => ({ type: PASTED, attrs: { ...attrs } });
export const paragraph = (...content: JSONContent[]): JSONContent => (content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' });
export const docOf = (paragraphs: JSONContent[], attachments: Attachment[] = []): ComposerDoc => ({
  type: 'doc',
  attrs: { attachments },
  content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
});

// More than one line: several paragraphs, or a hard break in one (§5.8: Enter then breaks the line; ⌘Enter sends).
export const isMultiline = (doc: ComposerDoc): boolean => (doc.content?.length ?? 0) > 1 || (doc.content ?? []).some((p) => (p.content ?? []).some((n) => n.type === 'hardBreak'));

let counter = 0;
// An id for an atom or attachment, unique within this renderer.
export const atomId = (prefix: string): string => {
  const n = counter;
  counter++;
  return `${prefix}-${Date.now().toString(36)}-${n.toString(36)}`;
};
