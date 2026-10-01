// The composer document's schema (C7 execution document, "Document model and serialisation"): Document with its
// `attachments` attribute (and M4b's `editing`, the edit mode a draft carries across a reload), Paragraph, Text, HardBreak, the mention node (Tiptap's, with a `kind`) and the pasted atom.
// No marks, no headings, no lists: the model reads markdown from the text. These are the extensions every editor of the
// composer shares, the headless ones in tests included; `extensions.ts` adds the interactive behaviour on top.
import { mergeAttributes, Node, type AnyExtension } from '@tiptap/core';
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
  addOptions() {
    return {
      ...this.parent!(),
      deleteTriggerWithBackspace: true,
      renderText: ({ node }) => mentionText(node.attrs as { id: string; kind: 'file' | 'agent' }),
      renderHTML: ({ node, options }) => ['span', options.HTMLAttributes, mentionText(node.attrs as { id: string; kind: 'file' | 'agent' })],
    };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      kind: { default: 'file', parseHTML: (el) => (el.getAttribute('data-kind') === 'agent' ? 'agent' : 'file'), renderHTML: (a) => ({ 'data-kind': a.kind as string }) },
    };
  },
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
  // Every attribute rides in the HTML ProseMirror copies, so a chip cut and pasted within the editor comes back whole.
  addAttributes() {
    // `attr` as the HTML attribute `data-<html>`; a null value is left out and parses back as null
    const data = (attr: string, html: string, parse: (value: string | null) => unknown) => ({
      parseHTML: (el: HTMLElement) => parse(el.getAttribute(`data-${html}`)),
      renderHTML: (attrs: Record<string, unknown>) => (attrs[attr] === null ? {} : { [`data-${html}`]: String(attrs[attr]) }),
    });
    return {
      id: { default: '', ...data('id', 'atom-id', (v) => v ?? '') },
      kind: { default: 'text', ...data('kind', 'kind', (v) => (v === 'image' || v === 'pdf' ? v : 'text')) },
      name: { default: '', ...data('name', 'name', (v) => v ?? '') },
      lines: { default: 0, ...data('lines', 'lines', (v) => Number(v ?? 0)) },
      text: { default: null, ...data('text', 'text', (v) => v) },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-pasted]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-pasted': '' }, HTMLAttributes), node.attrs.name as string];
  },
  renderText({ node }) {
    return `[${node.attrs.name as string}]`;
  },
});

export const schemaExtensions = (): AnyExtension[] => [ComposerDocument, Paragraph, Text, HardBreak, MentionNode, PastedNode];
