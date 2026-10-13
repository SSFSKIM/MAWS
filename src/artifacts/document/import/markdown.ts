// The Markdown import (D12 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): the writer's own parser
// (`DocMarkdown.parse`), so a human's import and the agent's `artifact_create {content}` read a file the same way, GFM
// and the kind's lossless dialect alike. Pure and headless: it runs in Node, which P3-F's one-time conversion of a
// design system's DESIGN.md law into this schema needs (Decision Log 39).
import type { Node as PMNode } from '@tiptap/pm/model';
import { docMarkdown } from '../markdown';
import { nanoid8, schemaFor } from '../schema';

export interface MarkdownImportOptions {
  /** Mints the id of every block the markdown does not name with `^id`. */
  generateID?: () => string;
}

/** A Markdown file as a tab body: a checked `doc` of the schema, one empty paragraph when the file has no content. */
export function importMarkdown(markdown: string, { generateID = nanoid8 }: MarkdownImportOptions = {}): PMNode {
  const schema = schemaFor();
  const blocks = docMarkdown().parse(markdown, { generateID });
  const body = schema.node('doc', null, blocks.length ? blocks : [schema.node('paragraph', { id: generateID() })]);
  body.check();
  return body;
}
