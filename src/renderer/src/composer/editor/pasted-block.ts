// The composer's text block (UX wave U6b-5a, decision 7; docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md,
// Interfaces §C and §J): the one maker of a pasted text atom, which a paste over the threshold, a dropped text file and
// "Attach selection to chat" all call. The node is today's (`pastedNode`), attribute for attribute, so an older build's
// composer draws a block made here as its own. Where a block is made, and no more: how its text leaves the composer is
// `serializeDraft`'s on a send and `plainTextOf`'s in a side question (ticket 733's to change). Pure.
import type { JSONContent } from '@tiptap/core';
import { atomId, emptyDoc, paragraph, PASTED, pastedNode, type ComposerDoc } from './doc';

/** One attach's block: `id` is minted once per attach (`attach-` and a random UUID), and is how every later step knows
 * whether the block is already where it should be (decision 30). */
export interface AttachedBlock {
  id: string;
  text: string;
}

export const PASTED_TEXT_NAME = 'Pasted text #1'; // the chip shows its place in the document

export function pastedBlock(text: string, id?: string, name: string = PASTED_TEXT_NAME): JSONContent {
  return pastedNode({ id: id ?? atomId('pasted'), kind: 'text', name, lines: text.split('\n').length, text });
}

/** Whether a pasted node of this id stands anywhere in the document. */
export function holdsBlock(doc: unknown, id: string): boolean {
  const node = doc as JSONContent | null | undefined;
  if (node === null || typeof node !== 'object') return false;
  if (node.type === PASTED && (node.attrs as { id?: unknown } | undefined)?.id === id) return true;
  return Array.isArray(node.content) && node.content.some((child) => holdsBlock(child, id));
}

const isDoc = (doc: unknown): doc is ComposerDoc => doc !== null && typeof doc === 'object' && (doc as JSONContent).type === 'doc';

/**
 * The document with the block appended and nothing else of it changed: into its last paragraph when that is empty,
 * else as a paragraph of its own. A missing document starts an empty one. The editor's insertion at the end
 * (`EditorHandle.attachPasted` with `at: 'end'`) places it the same way.
 */
export function appendPasted(doc: unknown, block: AttachedBlock): ComposerDoc {
  const base = isDoc(doc) ? doc : emptyDoc();
  const paragraphs = [...(base.content ?? [])];
  const last = paragraphs.at(-1);
  const node = pastedBlock(block.text, block.id);
  if (last !== undefined && last.type === 'paragraph' && (last.content ?? []).length === 0) paragraphs[paragraphs.length - 1] = { ...last, content: [node] };
  else paragraphs.push(paragraph(node));
  return { ...base, content: paragraphs };
}
