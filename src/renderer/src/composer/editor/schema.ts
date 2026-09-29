// The composer document's schema (C7 execution document, "Document model and serialisation"): Document with its
// `attachments` attribute, Paragraph, Text, HardBreak, the mention node (Tiptap's, with a `kind`) and the pasted atom.
// No marks, no headings, no lists: the model reads markdown from the text. These are the extensions every editor of the
// composer shares, the headless ones in tests included; `extensions.ts` adds the interactive behaviour on top.
import { Node, type AnyExtension } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import { Mention } from '@tiptap/extension-mention';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { pastedPlaceholder } from '@shared/composer/pasted-content';
import { PASTED, type PastedAttrs } from './doc';

export const ComposerDocument = Document.extend({
  addAttributes() {
    return { attachments: { default: [], rendered: false } };
  },
});

// Tiptap's mention node with the kind the serialiser needs (`@path` or `@agent-name`); deleted whole by Backspace.
export const MentionNode = Mention.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: { default: 'file', rendered: false },
    };
  },
}).configure({
  deleteTriggerWithBackspace: true,
  renderText: ({ node }) => mentionText(node.attrs as { id: string; kind: 'file' | 'agent' }),
  renderHTML: ({ node, options }) => ['span', options.HTMLAttributes, mentionText(node.attrs as { id: string; kind: 'file' | 'agent' })],
});

// A mention's text form: `@<path>` (quoted when the path holds whitespace, the terminal's form) or `@agent-<name>`, the
// form the engine's agent-mention producer recognises.
export function mentionText({ id, kind }: { id: string; kind: 'file' | 'agent' }): string {
  if (kind === 'agent') return `@agent-${id}`;
  return /\s/.test(id) ? `@"${id}"` : `@${id}`;
}

// The placeholder an atom stands for in `display` and history: `[Pasted text #n +L lines]`, `[Image #n]`, `[PDF #n]`.
export function atomPlaceholder(attrs: Pick<PastedAttrs, 'kind' | 'lines'>, n: number): string {
  if (attrs.kind === 'image') return `[Image #${n}]`;
  if (attrs.kind === 'pdf') return `[PDF #${n}]`;
  return pastedPlaceholder(n, attrs.lines);
}

export const PastedNode = Node.create({
  name: PASTED,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      id: { default: '', rendered: false },
      kind: { default: 'text', rendered: false },
      name: { default: '', rendered: false },
      lines: { default: 0, rendered: false },
      text: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-pasted]' }];
  },
  renderHTML({ node }) {
    return ['span', { 'data-pasted': '' }, node.attrs.name as string];
  },
  renderText({ node }) {
    return `[${node.attrs.name as string}]`;
  },
});

export const schemaExtensions = (): AnyExtension[] => [ComposerDocument, Paragraph, Text, HardBreak, MentionNode, PastedNode];
