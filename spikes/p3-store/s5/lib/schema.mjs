// Provenance: spikes/p3-store/s1/v14/schema.mjs (S1, P3-0: StarterKit + tables + UniqueID hardened for @y/prosemirror
// 2's attribution rendering, adapted from upstream yhub-tiptap-demo/src/schema.js, MIT), copied into S5's package (one
// @y/y per process). S5 adds §4.4's `comment` mark (lib/comments.mjs) and the comment plugins; the extension subpackages
// are this package's own dependencies. DOM-free: importable in Node for the writer and the agent read. Throwaway.
import { Mark, mergeAttributes, getSchema } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { UniqueID } from '@tiptap/extension-unique-id'
import { Blockquote } from '@tiptap/extension-blockquote'
import { BulletList, OrderedList, ListItem } from '@tiptap/extension-list'
import { CodeBlock } from '@tiptap/extension-code-block'
import { Code } from '@tiptap/extension-code'
import { Document } from '@tiptap/extension-document'
import { Link } from '@tiptap/extension-link'
import { TrailingNode } from '@tiptap/extensions'
import { customAlphabet } from 'nanoid'
import { ySyncPluginKey } from '@y/prosemirror'
import { isBindingTransaction } from './collab.mjs'
import { Comment } from './comments.mjs'

export const ATTRIBUTION_MARKS = ['y-attributed-insert', 'y-attributed-delete', 'y-attributed-format', 'y-attributed-attrs']
const A = ATTRIBUTION_MARKS.join(' ')

const payload = { userIds: { default: null, rendered: false }, timestamp: { default: null, rendered: false } }
const userOf = ids => (Array.isArray(ids) && ids.length ? String(ids[0]) : null)
const markDom = (tag, ids) => [tag, ids && userOf(ids) ? { 'data-user': userOf(ids) } : {}, 0]
export const AttributionMarks = [
  Mark.create({ name: 'y-attributed-insert', excludes: '', inclusive: false, addAttributes: () => payload, parseHTML: () => [{ tag: 'y-ins' }], renderHTML: ({ mark }) => markDom('y-ins', mark.attrs.userIds) }),
  Mark.create({ name: 'y-attributed-delete', excludes: '', inclusive: false, addAttributes: () => payload, parseHTML: () => [{ tag: 'y-del' }], renderHTML: ({ mark }) => markDom('y-del', mark.attrs.userIds) }),
  Mark.create({ name: 'y-attributed-format', excludes: '', inclusive: false, addAttributes: () => ({ ...payload, userIdsByAttr: { default: null, rendered: false } }), parseHTML: () => [{ tag: 'y-fmt' }], renderHTML: ({ mark }) => markDom('y-fmt', mark.attrs.userIds) }),
  Mark.create({ name: 'y-attributed-attrs', inclusive: false, addAttributes: () => ({ changes: { default: null, rendered: false } }), parseHTML: () => [{ tag: 'y-attr' }], renderHTML: () => ['y-attr', {}, 0] })
]

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

const inert = { addCommands: () => ({}), addKeyboardShortcuts: () => ({}), addInputRules: () => [], addPasteRules: () => [], addProseMirrorPlugins: () => [], addNodeView: () => null, addGlobalAttributes: () => [], parseHTML: () => [] }
const yAttributed = { 'y-attributed': { isRequired: true, parseHTML: () => null, renderHTML: () => ({ 'data-y-attributed': 'true' }) } }
const variants = [
  Blockquote.extend({ ...inert, name: 'blockquote--attributed', marks: A, content: 'block*', group: 'block', addAttributes () { return { ...this.parent?.(), ...yAttributed } }, renderHTML: ({ HTMLAttributes }) => ['blockquote', mergeAttributes(HTMLAttributes), 0] }),
  ListItem.extend({ ...inert, name: 'listItem--attributed', marks: A, content: 'block*', group: 'listItemGroup', addAttributes () { return { ...this.parent?.(), ...yAttributed } }, renderHTML: ({ HTMLAttributes }) => ['li', mergeAttributes(HTMLAttributes), 0] })
]

export const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader']
const ID_TYPES = [...BLOCK_TYPES, 'blockquote--attributed', 'listItem--attributed']
const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8)

/** The extension list. `plugins` (the comment plugins, editor-side) are added by the caller. */
export const extensions = ({ generateID = () => nano(), uniqueId = true } = {}) => [
  StarterKit.configure({ undoRedo: false, document: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, codeBlock: false, code: false, link: false, trailingNode: false }),
  Document.extend({ marks: A }),
  Blockquote.extend({ marks: A }),
  ListItem.extend({ marks: A, group: 'listItemGroup' }),
  BulletList.extend({ marks: A, content: 'listItemGroup*' }),
  OrderedList.extend({ marks: A, content: 'listItemGroup*' }),
  CodeBlock.extend({ marks: A }),
  Code.extend({ excludes: 'code bold italic strike underline link' }),
  guarded(Table.extend({ marks: A, content: 'tableRow*' })),
  TableRow.extend({ marks: A }),
  TableCell.extend({ marks: A, content: 'block*' }),
  TableHeader.extend({ marks: A, content: 'block*' }),
  guarded(TrailingNode),
  guarded(Link.configure({ openOnClick: false })),
  ...variants,
  ...AttributionMarks,
  Comment,
  UniqueID.configure({ types: ID_TYPES, generateID, filterTransaction: tr => !isBindingTransaction(tr), updateDocument: uniqueId })
]

export const schemaFor = opts => getSchema(extensions(opts))
