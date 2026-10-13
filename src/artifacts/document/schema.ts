// The document kind's one schema module (D1, D2 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; X26): the Tiptap
// extension list every writer, editor, importer, exporter and the history renderer build from, and the ProseMirror
// schema built from it. Schema parity is key parity: `@y/prosemirror` stores a mark under a key derived from its spec
// (S1 pitfall 4) and a node by its name, so a second schema anywhere re-keys what it writes; fingerprint.ts pins what
// this module produces and the lint keeps it the only builder. Importable in Node: no React and no DOM at import time
// (node views and the editor live in editor/). Copied and typed from P3-0's spikes (s1/v14/schema.mjs, S3's and S4's
// additions, S5's comment mark), Tiptap 3.31.3 on `@y/prosemirror` 2.0.0-15; the attribution hardening adapted from
// upstream's yhub-tiptap-demo/src/schema.js (MIT).
import { getSchema, Mark, mergeAttributes, Node, type AnyExtension, type Extensions, type RawCommands } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';
import { Plugin, type EditorState } from '@tiptap/pm/state';
import { Blockquote } from '@tiptap/extension-blockquote';
import { Bold } from '@tiptap/extension-bold';
import { Code } from '@tiptap/extension-code';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Heading } from '@tiptap/extension-heading';
import { Highlight } from '@tiptap/extension-highlight';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Italic } from '@tiptap/extension-italic';
import { Link } from '@tiptap/extension-link';
import { BulletList, ListItem, OrderedList, TaskItem, TaskList } from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Strike } from '@tiptap/extension-strike';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { Text } from '@tiptap/extension-text';
import { Underline } from '@tiptap/extension-underline';
import { TrailingNode } from '@tiptap/extensions';
import { customAlphabet } from 'nanoid';
import { isBindingTransaction } from '../yjs';
import { ySyncPluginKey } from '../yjs/prosemirror';
import { uniqueId } from './ids';

// ── the four reserved attribution marks (names fixed by the binding; history and suggestions render through them) ──
export const ATTRIBUTION_MARKS = ['y-attributed-insert', 'y-attributed-delete', 'y-attributed-format', 'y-attributed-attrs'] as const;
const A = ATTRIBUTION_MARKS.join(' ');

const payload = { userIds: { default: null, rendered: false }, timestamp: { default: null, rendered: false } };
const userOf = (ids: unknown): string | null => (Array.isArray(ids) && ids.length > 0 ? String(ids[0]) : null);
const markDom = (tag: string, ids: unknown): [string, Record<string, string>, 0] => {
  const user = userOf(ids);
  return [tag, user ? { 'data-user': user } : {}, 0];
};
const AttributionMarks = [
  Mark.create({ name: 'y-attributed-insert', excludes: '', inclusive: false, addAttributes: () => payload, parseHTML: () => [{ tag: 'y-ins' }], renderHTML: ({ mark }) => markDom('y-ins', mark.attrs.userIds) }),
  Mark.create({ name: 'y-attributed-delete', excludes: '', inclusive: false, addAttributes: () => payload, parseHTML: () => [{ tag: 'y-del' }], renderHTML: ({ mark }) => markDom('y-del', mark.attrs.userIds) }),
  Mark.create({
    name: 'y-attributed-format',
    excludes: '',
    inclusive: false,
    addAttributes: () => ({ ...payload, userIdsByAttr: { default: null, rendered: false } }),
    parseHTML: () => [{ tag: 'y-fmt' }],
    renderHTML: ({ mark }) => markDom('y-fmt', mark.attrs.userIds),
  }),
  // node-level, for attribute changes (a heading's level); keeps the default `excludes` so a re-render replaces it
  Mark.create({ name: 'y-attributed-attrs', inclusive: false, addAttributes: () => ({ changes: { default: null, rendered: false } }), parseHTML: () => [{ tag: 'y-attr' }], renderHTML: () => ['y-attr', {}, 0] }),
];

// ── the comment mark (§4.4 as amended by S5, Decision Log 31): `{threadId}` and nothing else, forever ──
// A mark's attributes are its Yjs storage key (`comment--<hash of the attrs>`), so a second attribute, even a default,
// re-keys every comment in every document. Overlapping allowed (`excludes: ''`), non-inclusive; orphaned is derived
// (threads.ts), never stored. The thread id rides in `data-thread`, so the OS clipboard carries it (D9).
const Comment = Mark.create({
  name: 'comment',
  excludes: '',
  inclusive: false,
  addAttributes: () => ({
    threadId: { default: null, parseHTML: (el: Attributed) => el.getAttribute('data-thread'), renderHTML: (a: Record<string, unknown>) => ({ 'data-thread': a.threadId }) },
  }),
  parseHTML: () => [{ tag: 'span[data-thread]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0],
});

// What parseHTML reads from an element, typed structurally so this module needs no DOM types (it runs in Node).
interface Attributed {
  getAttribute(name: string): string | null;
  textContent: string | null;
}
const data = (name: string) => (el: Attributed) => el.getAttribute(name);

// ── the document's own nodes ──
export const CALLOUT_TONES = ['note', 'tip', 'warn', 'danger'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];
export const MENTION_KINDS = ['person', 'session', 'artifact'] as const;

// `data-callout-tone` is the ledger's canon name (X28, Decision Log 39): D's components/document.css styles by it.
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  marks: A,
  addAttributes: () => ({
    tone: { default: 'note', parseHTML: (el: Attributed) => el.getAttribute('data-callout-tone') ?? 'note', renderHTML: (a: Record<string, unknown>) => ({ 'data-callout-tone': a.tone }) },
  }),
  parseHTML: () => [{ tag: 'aside[data-callout-tone]' }],
  renderHTML: ({ HTMLAttributes }) => ['aside', mergeAttributes(HTMLAttributes), 0],
});

// An image is an asset (`assetId`), shown through the host's asset URL; inline, as the ledger's row has it.
const Image = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  addAttributes: () => ({
    src: { default: null },
    alt: { default: null },
    assetId: { default: null, parseHTML: data('data-asset-id'), renderHTML: (a: Record<string, unknown>) => (a.assetId ? { 'data-asset-id': a.assetId } : {}) },
  }),
  parseHTML: () => [{ tag: 'img[src]' }],
  renderHTML: ({ HTMLAttributes }) => ['img', mergeAttributes(HTMLAttributes)],
});

// ProseMirror fixes inline or block per node type, so inline math and display math are two nodes (KaTeX in M3).
const MathInline = Node.create({
  name: 'math',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ latex: { default: '', parseHTML: data('data-latex'), renderHTML: (a: Record<string, unknown>) => ({ 'data-latex': a.latex }) } }),
  parseHTML: () => [{ tag: 'span[data-math]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['span', mergeAttributes({ 'data-math': '' }, HTMLAttributes), String(node.attrs.latex)],
});
const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  atom: true,
  addAttributes: () => ({ latex: { default: '', parseHTML: data('data-latex'), renderHTML: (a: Record<string, unknown>) => ({ 'data-latex': a.latex }) } }),
  parseHTML: () => [{ tag: 'div[data-math-block]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['div', mergeAttributes({ 'data-math-block': '' }, HTMLAttributes), String(node.attrs.latex)],
});

// A mermaid diagram, its own node rather than a `mermaid` code block, so the agent's markdown and the history view can
// tell a diagram from a code listing (D2's rejection).
const Diagram = Node.create({
  name: 'diagram',
  group: 'block',
  atom: true,
  addAttributes: () => ({ source: { default: '', parseHTML: (el: Attributed) => el.textContent ?? '', rendered: false } }),
  // above the code block's `pre` rule, which would otherwise take a pasted or imported diagram as code (M6)
  parseHTML: () => [{ tag: 'pre[data-diagram]', priority: 60 }],
  renderHTML: ({ node, HTMLAttributes }) => ['pre', mergeAttributes({ 'data-diagram': '' }, HTMLAttributes), String(node.attrs.source)],
});

// E's Dashboard block, present from day one so its arrival re-keys nothing; drawn as a labelled placeholder with its
// source until E lands. `spec` is opaque here (E shapes it): stored and carried as given.
const Chart = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  addAttributes: () => ({
    source: { default: '', parseHTML: data('data-source'), renderHTML: (a: Record<string, unknown>) => ({ 'data-source': a.source }) },
    // a string spec rides as `data-spec`, any other value as its JSON in `data-spec-json`, so HTML (paste, the HTML
    // export and import) gives the stored value back (M6; the dialect's `spec`/`spec-json`, Decision Log 17)
    spec: {
      default: null,
      parseHTML: (el: Attributed) => {
        const json = el.getAttribute('data-spec-json');
        if (json === null) return el.getAttribute('data-spec');
        try {
          return JSON.parse(json) as unknown;
        } catch {
          return json;
        }
      },
      renderHTML: (a: Record<string, unknown>) => (a.spec == null ? {} : typeof a.spec === 'string' ? { 'data-spec': a.spec } : { 'data-spec-json': JSON.stringify(a.spec) }),
    },
  }),
  parseHTML: () => [{ tag: 'div[data-chart]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes({ 'data-chart': '' }, HTMLAttributes)],
});

// The agent's placeholder for a section it will write (Claude Docs' shape, Decision Log 21): a labelled block.
const Pending = Node.create({
  name: 'pending',
  group: 'block',
  atom: true,
  addAttributes: () => ({ intent: { default: '', parseHTML: data('data-intent'), renderHTML: (a: Record<string, unknown>) => ({ 'data-intent': a.intent }) } }),
  parseHTML: () => [{ tag: 'div[data-pending]' }],
  renderHTML: ({ node, HTMLAttributes }) => ['div', mergeAttributes({ 'data-pending': '' }, HTMLAttributes), String(node.attrs.intent)],
});

// The chips: inline atoms. A date, a mention of a person, a session or an artifact, and a dropdown (a status).
const chip = (kind: string) => ({ group: 'inline', inline: true, atom: true, parseHTML: () => [{ tag: `span[data-chip="${kind}"]` }] });
const DateChip = Node.create({
  name: 'date',
  ...chip('date'),
  addAttributes: () => ({ iso: { default: null, parseHTML: data('data-iso'), renderHTML: (a: Record<string, unknown>) => ({ 'data-iso': a.iso }) } }),
  renderHTML: ({ node, HTMLAttributes }) => ['span', mergeAttributes({ 'data-chip': 'date' }, HTMLAttributes), String(node.attrs.iso ?? '')],
});
const Mention = Node.create({
  name: 'mention',
  ...chip('mention'),
  addAttributes: () => ({
    kind: { default: 'person', parseHTML: data('data-kind'), renderHTML: (a: Record<string, unknown>) => ({ 'data-kind': a.kind }) },
    ref: { default: null, parseHTML: data('data-ref'), renderHTML: (a: Record<string, unknown>) => ({ 'data-ref': a.ref }) },
    label: { default: '', parseHTML: (el: Attributed) => el.textContent ?? '', rendered: false },
  }),
  renderHTML: ({ node, HTMLAttributes }) => ['span', mergeAttributes({ 'data-chip': 'mention' }, HTMLAttributes), String(node.attrs.label)],
});
const Dropdown = Node.create({
  name: 'dropdown',
  ...chip('dropdown'),
  addAttributes: () => ({
    options: { default: [], parseHTML: (el: Attributed) => parseOptions(el.getAttribute('data-options')), renderHTML: (a: Record<string, unknown>) => ({ 'data-options': JSON.stringify(a.options ?? []) }) },
    value: { default: null, parseHTML: data('data-value'), renderHTML: (a: Record<string, unknown>) => ({ 'data-value': a.value }) },
  }),
  renderHTML: ({ node, HTMLAttributes }) => ['span', mergeAttributes({ 'data-chip': 'dropdown' }, HTMLAttributes), String(node.attrs.value ?? '')],
});
function parseOptions(json: string | null): string[] {
  try {
    const value: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

// ── guard document-repairing plugins against the binding's own dispatches (S1; upstream's CAVEATS) ──
// A plugin whose appendTransaction repairs the document (tables, the trailing node, autolink) must not answer the
// binding's remote writes or an attribution render, or every peer writes the same repair.
const renderingAttribution = (state: EditorState): boolean => (ySyncPluginKey.getState(state) as { renderer?: unknown } | undefined)?.renderer != null;
const guard = (plugin: Plugin): Plugin => {
  const append = plugin.spec.appendTransaction;
  if (append == null) return plugin;
  return new Plugin({
    ...plugin.spec,
    appendTransaction(trs, oldState, newState) {
      if (renderingAttribution(newState) || trs.some(isBindingTransaction)) return null;
      return append.call(this, trs, oldState, newState);
    },
  });
};
// Tiptap's `extend` config is typed per extension; the override reads only `parent`.
const guarded = <E extends AnyExtension>(ext: E): E =>
  (ext as unknown as { extend(config: object): E }).extend({
    addProseMirrorPlugins(this: { parent?: () => Plugin[] }) {
      return (this.parent?.() ?? []).map(guard);
    },
  });

// ── relaxed `--attributed` variants of the strict containers ──
// The binding renders a container holding a deleted child under `<name>--attributed` (a looser content expression);
// the variants carry every canonical attribute, the id included, or rendered attributes stop matching (S1 pitfall 5).
const inert = {
  addCommands: () => ({}),
  addKeyboardShortcuts: () => ({}),
  addInputRules: () => [],
  addPasteRules: () => [],
  addProseMirrorPlugins: () => [],
  addNodeView: () => null,
  addGlobalAttributes: () => [],
  parseHTML: () => [],
};
const yAttributed = { 'y-attributed': { isRequired: true, parseHTML: () => null, renderHTML: () => ({ 'data-y-attributed': 'true' }) } };
const STRICT = ['blockquote', 'listItem', 'taskItem', 'callout'] as const;
type Attrs = Record<string, unknown>;
const variant = <E extends AnyExtension>(ext: E, name: string, group: string, render: (attrs: Attrs) => [string, Attrs, 0]): E =>
  (ext as unknown as { extend(config: object): E }).extend({
    ...inert,
    name,
    marks: A,
    content: 'block*',
    group,
    addAttributes(this: { parent?: () => Attrs }) {
      return { ...this.parent?.(), ...yAttributed };
    },
    renderHTML: ({ HTMLAttributes }: { HTMLAttributes: Attrs }) => render(HTMLAttributes),
  });
const variants = [
  variant(Blockquote, 'blockquote--attributed', 'block', (a) => ['blockquote', mergeAttributes(a), 0]),
  variant(ListItem, 'listItem--attributed', 'listItemGroup', (a) => ['li', mergeAttributes(a), 0]),
  variant(TaskItem, 'taskItem--attributed', 'taskItemGroup', (a) => ['li', mergeAttributes({ 'data-type': 'taskItem' }, a), 0]),
  variant(Callout, 'callout--attributed', 'block', (a) => ['aside', mergeAttributes(a), 0]),
];

// ── the link mark's values (Decision Log 18) ──
// A link's `href` and `title` carry no ASCII control character: no URL grammar admits one, and the agent's markdown
// could not write an address holding a line break. They are stripped where a link enters (pasted HTML, the link
// commands, the markdown parser), so the state is never stored.
// eslint-disable-next-line no-control-regex -- matching the control characters is the point
const CONTROLS = /[\u0000-\u001F\u007F]/g;
/** The value without U+0000–U+001F and U+007F; anything but a string as it was. */
export const withoutControls = <T>(value: T): T => (typeof value === 'string' ? (value.replace(CONTROLS, '') as T) : value);
const linkAttrs = <T extends object>(attrs: T): T =>
  Object.fromEntries(Object.entries(attrs).map(([key, value]) => [key, key === 'href' || key === 'title' ? withoutControls(value) : value])) as T;

/** The binding's `attributedNodes`: a strict container holding a deletion renders as its `--attributed` variant. */
export const attributedNodes = (name: string, kinds: { insert?: boolean; delete?: boolean; format?: boolean }): boolean =>
  kinds.delete === true && (STRICT as readonly string[]).includes(name);

/** Every block node carries an `id` (an 8-character nanoid): what the agent's markdown marks with `^id`. */
export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'callout',
  'horizontalRule',
  'table',
  'tableRow',
  'tableCell',
  'tableHeader',
  'mathBlock',
  'diagram',
  'chart',
  'pending',
] as const;
const ID_TYPES = [...BLOCK_TYPES, ...STRICT.map((name) => `${name}--attributed`)];

export const nanoid8 = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

/** The extension list. `generateID` makes ids deterministic in tests; the schema does not depend on it. */
export const extensions = ({ generateID = (): string => nanoid8() }: { generateID?: () => string } = {}): Extensions => [
  Document.extend({ marks: A }),
  Paragraph,
  Text,
  HardBreak,
  Heading.configure({ levels: [1, 2, 3] }),
  Bold,
  Italic,
  Underline,
  Strike,
  Code,
  guarded(Link.configure({ openOnClick: false })).extend({
    // `{href, title}` only (D2): Link's `target`, `rel` and `class` defaults would ride in every stored link
    addAttributes(this: { parent?: () => Attrs }) {
      const parent = this.parent?.() ?? {};
      return {
        href: { ...(parent.href as Attrs), parseHTML: (el: Attributed) => withoutControls(el.getAttribute('href')) },
        title: { ...(parent.title as Attrs), parseHTML: (el: Attributed) => withoutControls(el.getAttribute('title')) },
      };
    },
    addCommands(this: { parent?: () => Partial<RawCommands> }): Partial<RawCommands> {
      const parent = this.parent?.() ?? {};
      const { setLink, toggleLink } = parent as Pick<RawCommands, 'setLink' | 'toggleLink'>;
      return { ...parent, setLink: (attrs) => setLink(linkAttrs(attrs)), toggleLink: (attrs) => toggleLink(attrs && linkAttrs(attrs)) };
    },
  }),
  // a `<mark>` without a colour reads as no colour (Tiptap's rule reads the empty inline style as `''`), M6
  Highlight.configure({ multicolor: true }).extend({
    addAttributes(this: { parent?: () => Attrs }) {
      const parent = this.parent?.() ?? {};
      const color = parent.color as Attrs & { parseHTML?: (el: Attributed) => unknown };
      return { ...parent, color: { ...color, parseHTML: (el: Attributed) => color.parseHTML?.(el) || null } };
    },
  }),
  Comment,
  Blockquote.extend({ marks: A }),
  BulletList.extend({ marks: A, content: 'listItemGroup*' }),
  OrderedList.extend({ marks: A, content: 'listItemGroup*' }),
  ListItem.extend({ marks: A, group: 'listItemGroup' }),
  TaskList.extend({ marks: A, content: 'taskItemGroup*' }),
  TaskItem.extend({ marks: A, group: 'taskItemGroup' }).configure({ nested: true }),
  // a passage retyped to code keeps its comments (S5 pitfall 5)
  CodeBlock.extend({ marks: `${A} comment` }),
  HorizontalRule,
  guarded(Table.extend({ marks: A, content: 'tableRow*' })),
  TableRow.extend({ marks: A }),
  TableCell.extend({ marks: A, content: 'block*' }),
  TableHeader.extend({ marks: A, content: 'block*' }),
  Callout,
  Image,
  MathInline,
  MathBlock,
  Diagram,
  Chart,
  Pending,
  DateChip,
  Mention,
  Dropdown,
  guarded(TrailingNode),
  ...variants,
  ...AttributionMarks,
  uniqueId({ types: ID_TYPES, generateID }),
];

let cached: Schema | null = null;
/** The schema every writer and editor builds from: one object per process, so two modules cannot hold two. */
export const schemaFor = (): Schema => (cached ??= getSchema(extensions()));
