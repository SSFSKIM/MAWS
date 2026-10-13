// S3 (P3-0): the §4.4-shaped document schema on Yjs v14, extended from S1's hardened schema (s1/v14/schema.mjs):
// paragraph, headings 1-3, bullet/ordered/task lists, quote, code block, table with row and cell ids, a callout
// (container with a `tone` attribute), an image (inline atom with `src`, `alt`), marks bold, italic, link, code and
// the `comment {threadId, orphan}` mark (overlapping allowed, non-inclusive), UniqueID with S1's v14 filter, and the
// four reserved `y-attributed-*` marks allowed everywhere. DOM-free (importable in Node). Throwaway spike code.
import { Mark, Node, mergeAttributes, getSchema } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { UniqueID } from '@tiptap/extension-unique-id'
import { customAlphabet } from 'nanoid'
import { ySyncPluginKey } from '@y/prosemirror'
import { tiptapSub } from '../../s1/lib/tiptap.mjs'
import { isBindingTransaction } from './collab.mjs'

const sub = tiptapSub(new URL('../node_modules', import.meta.url).pathname)
const { Blockquote } = await sub('extension-blockquote')
const { BulletList, OrderedList, ListItem } = await sub('extension-list')
const { CodeBlock } = await sub('extension-code-block')
const { Code } = await sub('extension-code')
const { Document } = await sub('extension-document')
const { Link } = await sub('extension-link')
const { TrailingNode } = await sub('extensions')

export const ATTRIBUTION_MARKS = ['y-attributed-insert', 'y-attributed-delete', 'y-attributed-format', 'y-attributed-attrs']
const A = ATTRIBUTION_MARKS.join(' ')

// ── the four reserved attribution marks (S1's definitions) ──
const payload = { userIds: { default: null, rendered: false }, timestamp: { default: null, rendered: false } }
const userOf = ids => (Array.isArray(ids) && ids.length ? String(ids[0]) : null)
const markDom = (tag, ids) => [tag, ids && userOf(ids) ? { 'data-user': userOf(ids) } : {}, 0]
export const AttributionMarks = [
  Mark.create({ name: 'y-attributed-insert', excludes: '', inclusive: false, addAttributes: () => payload, parseHTML: () => [{ tag: 'y-ins' }], renderHTML: ({ mark }) => markDom('y-ins', mark.attrs.userIds) }),
  Mark.create({ name: 'y-attributed-delete', excludes: '', inclusive: false, addAttributes: () => payload, parseHTML: () => [{ tag: 'y-del' }], renderHTML: ({ mark }) => markDom('y-del', mark.attrs.userIds) }),
  Mark.create({ name: 'y-attributed-format', excludes: '', inclusive: false, addAttributes: () => ({ ...payload, userIdsByAttr: { default: null, rendered: false } }), parseHTML: () => [{ tag: 'y-fmt' }], renderHTML: ({ mark }) => markDom('y-fmt', mark.attrs.userIds) }),
  Mark.create({ name: 'y-attributed-attrs', inclusive: false, addAttributes: () => ({ changes: { default: null, rendered: false } }), parseHTML: () => [{ tag: 'y-attr' }], renderHTML: () => ['y-attr', {}, 0] })
]

// ── the comment mark: overlapping allowed, non-inclusive (BlockNote's shape, §4.4) ──
export const Comment = Mark.create({
  name: 'comment',
  excludes: '',
  inclusive: false,
  addAttributes: () => ({ threadId: { default: null }, orphan: { default: false } }),
  parseHTML: () => [{ tag: 'span[data-thread]', getAttrs: el => ({ threadId: el.getAttribute('data-thread'), orphan: el.hasAttribute('data-orphan') }) }],
  renderHTML: ({ mark }) => ['span', { 'data-thread': mark.attrs.threadId, ...(mark.attrs.orphan ? { 'data-orphan': '' } : {}) }, 0]
})

// ── a container with an attribute (callout) and an inline atom with attributes (image) ──
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  marks: A,
  addAttributes: () => ({ tone: { default: 'info' } }),
  parseHTML: () => [{ tag: 'aside[data-callout]', getAttrs: el => ({ tone: el.getAttribute('data-tone') }) }],
  renderHTML: ({ HTMLAttributes }) => ['aside', mergeAttributes({ 'data-callout': '', 'data-tone': HTMLAttributes.tone }, HTMLAttributes), 0]
})
export const Image = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({ src: { default: null }, alt: { default: null }, assetId: { default: null } }),
  parseHTML: () => [{ tag: 'img[src]' }],
  renderHTML: ({ HTMLAttributes }) => ['img', mergeAttributes(HTMLAttributes)]
})

// ── guard document-repairing plugins against the binding's own dispatches (S1) ──
const renderingAttribution = state => ySyncPluginKey.getState(state)?.renderer != null
const guard = plugin => new Plugin({
  ...plugin.spec,
  appendTransaction: plugin.spec.appendTransaction == null
    ? undefined
    : function (trs, oldState, newState) {
      if (renderingAttribution(newState) || trs.some(isBindingTransaction)) return null
      return plugin.spec.appendTransaction.call(this, trs, oldState, newState)
    }
})
const guarded = ext => ext.extend({ addProseMirrorPlugins () { return (this.parent?.() ?? []).map(guard) } })

// ── relaxed `--attributed` variants for the strict containers (S1 had blockquote and listItem; S3 adds taskItem
//    and callout, whose content expressions also break when a deleted child renders) ──
const inert = { addCommands: () => ({}), addKeyboardShortcuts: () => ({}), addInputRules: () => [], addPasteRules: () => [], addProseMirrorPlugins: () => [], addNodeView: () => null, addGlobalAttributes: () => [], parseHTML: () => [] }
const yAttributed = { 'y-attributed': { isRequired: true, parseHTML: () => null, renderHTML: () => ({ 'data-y-attributed': 'true' }) } }
const STRICT = ['blockquote', 'listItem', 'taskItem', 'callout']
const variants = [
  Blockquote.extend({ ...inert, name: 'blockquote--attributed', marks: A, content: 'block*', group: 'block', addAttributes () { return { ...this.parent?.(), ...yAttributed } }, renderHTML: ({ HTMLAttributes }) => ['blockquote', mergeAttributes(HTMLAttributes), 0] }),
  ListItem.extend({ ...inert, name: 'listItem--attributed', marks: A, content: 'block*', group: 'listItemGroup', addAttributes () { return { ...this.parent?.(), ...yAttributed } }, renderHTML: ({ HTMLAttributes }) => ['li', mergeAttributes(HTMLAttributes), 0] }),
  TaskItem.extend({ ...inert, name: 'taskItem--attributed', marks: A, content: 'block*', group: 'taskItemGroup', addAttributes () { return { ...this.parent?.(), ...yAttributed } }, renderHTML: ({ HTMLAttributes }) => ['li', mergeAttributes({ 'data-type': 'taskItem' }, HTMLAttributes), 0] }),
  Callout.extend({ ...inert, name: 'callout--attributed', marks: A, content: 'block*', group: 'block', addAttributes () { return { ...this.parent?.(), ...yAttributed } }, renderHTML: ({ HTMLAttributes }) => ['aside', mergeAttributes(HTMLAttributes), 0] })
]
export const attributedNodes = (name, kinds) => kinds.delete === true && STRICT.includes(name)

export const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'callout', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader']
const ID_TYPES = [...BLOCK_TYPES, ...STRICT.map(n => n + '--attributed')]
const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8)

/** The extension list. `{ uniqueId: false }` for a read-only view, `{ generateID }` for deterministic ids. */
export const extensions = ({ generateID = () => nano(), uniqueId = true } = {}) => [
  StarterKit.configure({ undoRedo: false, document: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, codeBlock: false, code: false, link: false, trailingNode: false, heading: { levels: [1, 2, 3] } }),
  Document.extend({ marks: A }),
  Blockquote.extend({ marks: A }),
  ListItem.extend({ marks: A, group: 'listItemGroup' }),
  BulletList.extend({ marks: A, content: 'listItemGroup*' }),
  OrderedList.extend({ marks: A, content: 'listItemGroup*' }),
  TaskItem.extend({ marks: A, group: 'taskItemGroup' }).configure({ nested: true }),
  TaskList.extend({ marks: A, content: 'taskItemGroup*' }),
  CodeBlock.extend({ marks: A }),
  Code.extend({ excludes: 'code bold italic strike underline link' }),
  guarded(Table.extend({ marks: A, content: 'tableRow*' })),
  TableRow.extend({ marks: A }),
  TableCell.extend({ marks: A, content: 'block*' }),
  TableHeader.extend({ marks: A, content: 'block*' }),
  Callout,
  Image,
  Comment,
  guarded(TrailingNode),
  guarded(Link.configure({ openOnClick: false })),
  ...variants,
  ...AttributionMarks,
  UniqueID.configure({
    types: ID_TYPES,
    generateID,
    filterTransaction: tr => !isBindingTransaction(tr),
    updateDocument: uniqueId
  })
]

export const schemaFor = opts => getSchema(extensions(opts))
