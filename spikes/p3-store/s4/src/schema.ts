// S4 (P3-0): the document schema module, S1's `s1/v14/schema.mjs` with static imports (so it bundles for the
// renderer and for Node alike) plus the `comment` mark of spec §4.4 (BlockNote's shape: `threadId`, `orphan`,
// overlapping, non-inclusive). One module for every writer and every editor: schema parity is also Y-key parity
// (S1 pitfall 4). Throwaway spike code; P3-B owns the real one.
import { Mark, mergeAttributes, getSchema, type AnyExtension } from '@tiptap/core'
import { Plugin, type Transaction } from '@tiptap/pm/state'
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
import { ySyncPluginKey } from '@y/prosemirror'
import { customAlphabet } from 'nanoid'

/** True for transactions the v14 binding dispatched (S1 pitfall 1: UniqueID must skip them). */
export const isBindingTransaction = (tr: Transaction): boolean =>
  tr.getMeta('y-sync-transaction') != null || tr.getMeta('y-sync-append') != null || tr.getMeta('y-sync$') != null

export const ATTRIBUTION_MARKS = ['y-attributed-insert', 'y-attributed-delete', 'y-attributed-format', 'y-attributed-attrs']
const A = ATTRIBUTION_MARKS.join(' ')

const payload = { userIds: { default: null, rendered: false }, timestamp: { default: null, rendered: false } }
const userOf = (ids: unknown) => (Array.isArray(ids) && ids.length ? String(ids[0]) : null)
const markDom = (tag: string, ids: unknown): any => [tag, ids && userOf(ids) ? { 'data-user': userOf(ids) } : {}, 0]
const AttributionMarks = [
  Mark.create({ name: 'y-attributed-insert', excludes: '', inclusive: false, addAttributes: () => payload, parseHTML: () => [{ tag: 'y-ins' }], renderHTML: ({ mark }) => markDom('y-ins', mark.attrs.userIds) }),
  Mark.create({ name: 'y-attributed-delete', excludes: '', inclusive: false, addAttributes: () => payload, parseHTML: () => [{ tag: 'y-del' }], renderHTML: ({ mark }) => markDom('y-del', mark.attrs.userIds) }),
  Mark.create({ name: 'y-attributed-format', excludes: '', inclusive: false, addAttributes: () => ({ ...payload, userIdsByAttr: { default: null, rendered: false } }), parseHTML: () => [{ tag: 'y-fmt' }], renderHTML: ({ mark }) => markDom('y-fmt', mark.attrs.userIds) }),
  Mark.create({ name: 'y-attributed-attrs', inclusive: false, addAttributes: () => ({ changes: { default: null, rendered: false } }), parseHTML: () => [{ tag: 'y-attr' }], renderHTML: () => ['y-attr', {}, 0] })
]

/**
 * §4.4's comment mark as amended (A5, S5): `comment {threadId}` only, overlapping allowed (`excludes: ''`, stored in Y
 * as `comment--<hash>`), non-inclusive. Orphaned is derived (an open thread whose mark covers no text), never stored.
 */
export const Comment = Mark.create({
  name: 'comment',
  excludes: '',
  inclusive: false,
  addAttributes: () => ({
    threadId: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute('data-thread'), renderHTML: (a: any) => ({ 'data-thread': a.threadId }) }
  }),
  parseHTML: () => [{ tag: 'span[data-thread]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { class: 'comment' }), 0]
})

// guard document-repairing plugins against the binding's own dispatches (CAVEATS.md; S1)
const renderingAttribution = (state: any) => (ySyncPluginKey.getState(state) as any)?.renderer != null
const guard = (plugin: Plugin) => new Plugin({
  ...plugin.spec,
  appendTransaction: plugin.spec.appendTransaction == null
    ? undefined
    : function (this: any, trs, oldState, newState) {
      if (renderingAttribution(newState) || trs.some(isBindingTransaction)) return null
      return plugin.spec.appendTransaction!.call(this, trs, oldState, newState)
    }
})
const guarded = (ext: any) => ext.extend({ addProseMirrorPlugins (this: any) { return (this.parent?.() ?? []).map(guard) } })

const inert = { addCommands: () => ({}), addKeyboardShortcuts: () => ({}), addInputRules: () => [], addPasteRules: () => [], addProseMirrorPlugins: () => [], addNodeView: () => null, addGlobalAttributes: () => [], parseHTML: () => [] }
const yAttributed = { 'y-attributed': { isRequired: true, parseHTML: () => null, renderHTML: () => ({ 'data-y-attributed': 'true' }) } }
const variants = [
  Blockquote.extend({ ...inert, name: 'blockquote--attributed', marks: A, content: 'block*', group: 'block', addAttributes (this: any) { return { ...this.parent?.(), ...yAttributed } }, renderHTML: ({ HTMLAttributes }: any) => ['blockquote', mergeAttributes(HTMLAttributes), 0] } as any),
  ListItem.extend({ ...inert, name: 'listItem--attributed', marks: A, content: 'block*', group: 'listItemGroup', addAttributes (this: any) { return { ...this.parent?.(), ...yAttributed } }, renderHTML: ({ HTMLAttributes }: any) => ['li', mergeAttributes(HTMLAttributes), 0] } as any)
]

/** The binding's attributedNodes predicate for the two strict containers (S1). */
export const attributedNodes = (name: string, kinds: any) => kinds.delete === true && (name === 'blockquote' || name === 'listItem')

export const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader']
const ID_TYPES = [...BLOCK_TYPES, 'blockquote--attributed', 'listItem--attributed']
export const nanoid8 = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8)

/** The extension list. `{ generateID }` makes ids deterministic in tests. */
export const extensions = ({ generateID = () => nanoid8(), uniqueId = true }: { generateID?: () => string, uniqueId?: boolean } = {}): AnyExtension[] => [
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
  UniqueID.configure({
    types: ID_TYPES,
    generateID,
    filterTransaction: (tr: Transaction) => !isBindingTransaction(tr),
    updateDocument: uniqueId
  })
]

export const schemaFor = (opts?: Parameters<typeof extensions>[0]) => getSchema(extensions(opts))
