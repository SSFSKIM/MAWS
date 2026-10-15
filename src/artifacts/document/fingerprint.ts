// Schema parity's fingerprint (D4 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md): what a document's stored
// bytes depend on, taken from the schema module. A node is stored under its name with one Yjs attribute per node
// attribute; a mark is stored under a key `@y/prosemirror` derives from its spec (its name, or `name--<hash of the mark's
// JSON>` for a mark that does not exclude itself, S1 pitfall 4), so the key is read from `pmnodeToDelta` itself rather
// than re-derived. The content and mark expressions are in it too: a narrower one makes a reader drop stored content.
// fingerprint.json is the committed copy; fingerprint.test.ts fails on any difference.
import type { MarkType, NodeType, Schema } from '@tiptap/pm/model';
import { pmnodeToDelta } from '../yjs/prosemirror';
import { schemaFor } from './schema';

type Defaults = Record<string, unknown>;
export interface SchemaFingerprint {
  nodes: Record<string, { attrs: Defaults; content: string | null; marks: string | null; group: string | null; inline: boolean; atom: boolean }>;
  marks: Record<string, { attrs: Defaults; excludes: string | null; inclusive: boolean | null; storageKey: string | null }>;
}

const REQUIRED = '(required)';
const defaults = (attrs: Record<string, { default?: unknown }> | undefined): Defaults =>
  Object.fromEntries(
    Object.keys(attrs ?? {})
      .sort()
      .map((name) => [name, attrs![name] && 'default' in attrs![name] ? (attrs![name].default ?? null) : REQUIRED]),
  );

// The values a one-mark fixture needs where a default would not do (a link without an href; a comment's key hashes
// its thread id, so a fixed one keeps the key stable while still changing with the attribute set).
const FIXTURE_ATTRS: Record<string, Record<string, unknown>> = { link: { href: 'https://example.com' }, comment: { threadId: 'fingerprint' } };

/** The Yjs key a mark is stored under, as `@y/prosemirror` writes it; null for a render-only mark it never stores. */
function storageKey(schema: Schema, mark: MarkType): string | null {
  const doc = schema.topNodeType.create(null, schema.nodes.paragraph.create(null, schema.text('x', [mark.create(FIXTURE_ATTRS[mark.name] ?? null)])));
  const delta = (pmnodeToDelta(doc) as unknown as { toJSON(): { children: Array<{ insert: Array<{ children: Array<{ format?: Record<string, unknown> }> }> }> } }).toJSON();
  const keys = Object.keys(delta.children[0]?.insert[0]?.children[0]?.format ?? {});
  return keys[0] ?? null;
}

const node = (type: NodeType) => ({
  attrs: defaults(type.spec.attrs),
  content: type.spec.content ?? null,
  marks: type.spec.marks ?? null,
  group: type.spec.group ?? null,
  inline: type.isInline,
  atom: type.isAtom,
});

export function fingerprint(schema: Schema = schemaFor()): SchemaFingerprint {
  const nodes = Object.fromEntries(Object.keys(schema.nodes).sort().map((name) => [name, node(schema.nodes[name])]));
  const marks = Object.fromEntries(
    Object.keys(schema.marks)
      .sort()
      .map((name) => {
        const mark = schema.marks[name];
        return [name, { attrs: defaults(mark.spec.attrs), excludes: mark.spec.excludes ?? null, inclusive: mark.spec.inclusive ?? null, storageKey: storageKey(schema, mark) }];
      }),
  );
  return { nodes, marks };
}

/** The fingerprint as the committed file holds it. */
export const fingerprintJSON = (schema?: Schema): string => `${JSON.stringify(fingerprint(schema), null, 2)}\n`;
