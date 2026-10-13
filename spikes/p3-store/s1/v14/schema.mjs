// S1 (P3-0): the v14 document schema module — StarterKit + tables + UniqueID, hardened for @y/prosemirror 2's
// attribution rendering (ATTRIBUTION.md "Hardening an existing editor schema", adapted from the upstream
// yhub-tiptap-demo/src/schema.js, MIT). DOM-free: importable in Node for the writer. Throwaway spike code.
import { Mark, mergeAttributes, getSchema } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { UniqueID } from '@tiptap/extension-unique-id'
import { customAlphabet } from 'nanoid'
import { ySyncPluginKey } from '@y/prosemirror'
import { tiptapSub } from '../lib/tiptap.mjs'
import { isBindingTransaction } from './collab.mjs'

const sub = tiptapSub(new URL('./node_modules', import.meta.url).pathname)
const { Blockquote } = await sub('extension-blockquote')
const { BulletList, OrderedList, ListItem } = await sub('extension-list')
const { CodeBlock } = await sub('extension-code-block')
const { Code } = await sub('extension-code')
const { Document } = await sub('extension-document')
const { Link } = await sub('extension-link')
const { TrailingNode } = await sub('extensions')

export const ATTRIBUTION_MARKS = ['y-attributed-insert', 'y-attributed-delete', 'y-attributed-format', 'y-attributed-attrs']
const A = ATTRIBUTION_MARKS.join(' ')

// ── the four reserved attribution marks (names fixed by the binding) ──
const payload = { userIds: { default: null, rendered: false }, timestamp: { default: null, rendered: false } }
const userOf = ids => (Array.isArray(ids) && ids.length ? String(ids[0]) : null)
const markDom = (tag, ids) => [tag, ids && userOf(ids) ? { 'data-user': userOf(ids) } : {}, 0]
export const AttributionMarks = [
  Mark.create({ name: 'y-attributed-insert', excludes: '', inclusive: false, addAttributes: () => payload, parseHTML: () => [{ tag: 'y-ins' }], renderHTML: ({ mark }) => markDom('y-ins', mark.attrs.userIds) }),
  Mark.create({ name: 'y-attributed-delete', excludes: '', inclusive: false, addAttributes: () => payload, parseHTML: () => [{ tag: 'y-del' }], renderHTML: ({ mark }) => markDom('y-del', mark.attrs.userIds) }),
  Mark.create({ name: 'y-attributed-format', excludes: '', inclusive: false, addAttributes: () => ({ ...payload, userIdsByAttr: { default: null, rendered: false } }), parseHTML: () => [{ tag: 'y-fmt' }], renderHTML: ({ mark }) => markDom('y-fmt', mark.attrs.userIds) }),
  // node-level, for attribute changes (heading level); keeps the default `excludes` so a re-render replaces it
  Mark.create({ name: 'y-attributed-attrs', inclusive: false, addAttributes: () => ({ changes: { default: null, rendered: false } }), parseHTML: () => [{ tag: 'y-attr' }], renderHTML: () => ['y-attr', {}, 0] })
]

// ── guard document-repairing plugins against the binding's own dispatches (CAVEATS.md) ──
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

// ── relaxed `--attributed` variants for the two containers kept strict ──
const inert = { addCommands: () => ({}), addKeyboardShortcuts: () => ({}), addInputRules: () => [], addPasteRules: () => [], addProseMirrorPlugins: () => [], addNodeView: () => null, addGlobalAttributes: () => [], parseHTML: () => [] }
const yAttributed = { 'y-attributed': { isRequired: true, parseHTML: () => null, renderHTML: () => ({ 'data-y-attributed': 'true' }) } }
const variants = [
  Blockquote.extend({ ...inert, name: 'blockquote--attributed', marks: A, content: 'block*', group: 'block', addAttributes () { return { ...this.parent?.(), ...yAttributed } }, renderHTML: ({ HTMLAttributes }) => ['blockquote', mergeAttributes(HTMLAttributes), 0] }),
  ListItem.extend({ ...inert, name: 'listItem--attributed', marks: A, content: 'block*', group: 'listItemGroup', addAttributes () { return { ...this.parent?.(), ...yAttributed } }, renderHTML: ({ HTMLAttributes }) => ['li', mergeAttributes(HTMLAttributes), 0] })
]
export const attributedNodes = (name, kinds) => kinds.delete === true && (name === 'blockquote' || name === 'listItem')

export const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader']
// variants must carry the canonical attrs (the id) or the rendered attrs stop matching (stability rule)
const ID_TYPES = [...BLOCK_TYPES, 'blockquote--attributed', 'listItem--attributed']
const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8)

/** The extension list. `{ uniqueId: false }` for the history view (read-only), `{ generateID }` to make ids deterministic. */
export const extensions = ({ generateID = () => nano(), uniqueId = true } = {}) => [
  StarterKit.configure({ undoRedo: false, document: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, codeBlock: false, code: false, link: false, trailingNode: false }),
  Document.extend({ marks: A }),
  Blockquote.extend({ marks: A }),
  ListItem.extend({ marks: A, group: 'listItemGroup' }),
  BulletList.extend({ marks: A, content: 'listItemGroup*' }),
  OrderedList.extend({ marks: A, content: 'listItemGroup*' }),
  CodeBlock.extend({ marks: A }),
  // `code` must keep excluding itself: a self-overlapping mark is stored under a hashed key (`code--<hash>`)
  Code.extend({ excludes: 'code bold italic strike underline link' }),
  guarded(Table.extend({ marks: A, content: 'tableRow*' })),
  TableRow.extend({ marks: A }),
  TableCell.extend({ marks: A, content: 'block*' }),
  TableHeader.extend({ marks: A, content: 'block*' }),
  guarded(TrailingNode),
  guarded(Link.configure({ openOnClick: false })),
  ...variants,
  ...AttributionMarks,
  UniqueID.configure({
    types: ID_TYPES,
    generateID,
    // v14's binding marks remote changes with `y-sync-transaction`, not v13's `y-sync$`, so UniqueID would
    // otherwise rewrite ids on every peer for every remote change. Skip the binding's transactions.
    filterTransaction: tr => !isBindingTransaction(tr),
    updateDocument: uniqueId
  })
]

export const schemaFor = opts => getSchema(extensions(opts))
