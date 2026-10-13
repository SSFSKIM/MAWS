// S5 (P3-0): comments on Yjs v14 — §4.4's `comment` mark, the `threads` map in the same Y.Doc, the derived thread
// state (open / resolved / orphaned), the display plugin (only open threads highlight; resolve never touches the
// text), Outline's paste dedupe (cut moves a comment, copy does not duplicate it), and the orphan locator over the
// stored relative positions. DOM-free except the editor plugins' view hooks. Throwaway spike code; the P3-B copy target.
//
// The model (one Y.Doc per artifact; `doc.get('threads')` is a v14 Y.Node used as a map):
//   threads.attr[threadId] = Y.Node('thread') {
//     attrs: status 'open'|'resolved', quote, anchor {start, end, block} (relative positions as JSON),
//            blockId, createdBy, createdAt, resolvedBy?, resolvedAt?, reopenedBy?, reopenedAt?
//     children: messages {id, by, at, body} (a sequence, so concurrent replies both land)
//   }
// Orphaned is never stored: it is "open, and no live text carries the thread's mark", so undo, restore and a cut that
// is pasted back un-orphan a thread with no write.
import { Mark, Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { Slice, Fragment } from '@tiptap/pm/model'
import * as Y from '@y/y'
import { resolvedPositionsToRelativePositions, relativePositionsToResolvedPositions, yattr2markname } from '@y/prosemirror'

// ── the mark ────────────────────────────────────────────────────────────────────────────────────────────────────
/** §4.4's comment mark (BlockNote's shape): overlapping allowed (`excludes: ''`), non-inclusive. `orphan` is kept
 *  for the spec's shape and never written by this module (see the findings: drop it). */
export const Comment = Mark.create({
  name: 'comment',
  excludes: '',
  inclusive: false,
  addAttributes: () => ({
    threadId: { default: null, parseHTML: el => el.getAttribute('data-thread'), renderHTML: a => ({ 'data-thread': a.threadId }) },
    orphan: { default: false, parseHTML: el => el.hasAttribute('data-orphan'), renderHTML: a => (a.orphan ? { 'data-orphan': '' } : {}) }
  }),
  parseHTML: () => [{ tag: 'span[data-thread]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', HTMLAttributes, 0]
})

export const isCommentKey = k => yattr2markname(k) === 'comment'

// ── the threads map ─────────────────────────────────────────────────────────────────────────────────────────────
export const threadsRoot = doc => doc.get('threads')
const rposJSON = r => (r == null ? null : Y.relativePositionToJSON(r))
const rposOf = j => (j == null ? null : Y.createRelativePositionFromJSON(j))

export const readThread = (node, id) => node && ({
  id,
  status: node.getAttr('status'),
  quote: node.getAttr('quote'),
  blockId: node.getAttr('blockId'),
  anchor: node.getAttr('anchor'),
  createdBy: node.getAttr('createdBy'),
  createdAt: node.getAttr('createdAt'),
  resolvedBy: node.getAttr('resolvedBy') ?? null,
  resolvedAt: node.getAttr('resolvedAt') ?? null,
  messages: node.toArray()
})
export const getThread = (doc, id) => readThread(threadsRoot(doc).getAttr(id), id)
export const listThreads = doc => [...threadsRoot(doc).attrEntries()].map(([id, n]) => readThread(n, id)).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))

/** Write a thread record (one Y transaction). `anchor` holds relative positions already JSON-encoded. */
export const addThread = (doc, { threadId, quote, anchor, blockId, by, at, body, msgId = threadId + ':m0' }, origin = null) => {
  doc.transact(() => {
    const t = new Y.Node('thread')
    threadsRoot(doc).setAttr(threadId, t)
    t.setAttr('status', 'open'); t.setAttr('quote', quote); t.setAttr('anchor', anchor); t.setAttr('blockId', blockId)
    t.setAttr('createdBy', by); t.setAttr('createdAt', at)
    if (body != null) t.insert(0, [{ id: msgId, by, at, body }])
  }, origin)
}
export const reply = (doc, threadId, msg, origin = null) => doc.transact(() => threadsRoot(doc).getAttr(threadId).push([msg]), origin)
export const resolve = (doc, threadId, by, at, origin = null) => doc.transact(() => { const t = threadsRoot(doc).getAttr(threadId); t.setAttr('status', 'resolved'); t.setAttr('resolvedBy', by); t.setAttr('resolvedAt', at) }, origin)
export const reopen = (doc, threadId, by, at, origin = null) => doc.transact(() => { const t = threadsRoot(doc).getAttr(threadId); t.setAttr('status', 'open'); t.setAttr('reopenedBy', by); t.setAttr('reopenedAt', at) }, origin)

// ── live marks ──────────────────────────────────────────────────────────────────────────────────────────────────
/** threadId → merged [{from, to}] ranges in a ProseMirror doc. */
export const liveRanges = pmDoc => {
  const out = new Map()
  pmDoc.descendants((n, pos) => {
    if (!n.isText) return
    for (const m of n.marks) {
      if (m.type.name !== 'comment' || m.attrs.threadId == null) continue
      const list = out.get(m.attrs.threadId) ?? []
      const last = list[list.length - 1]
      if (last && last.to === pos) last.to = pos + n.nodeSize; else list.push({ from: pos, to: pos + n.nodeSize })
      out.set(m.attrs.threadId, list)
    }
  })
  return out
}
/** threadIds carried by live text under a Y node (no editor; the host and the agent's replica). */
export const liveIdsY = root => {
  const ids = new Set()
  const walk = n => {
    for (const op of n.toDelta().children) {
      if (typeof op.insert === 'string' && op.format) for (const [k, v] of Object.entries(op.format)) if (isCommentKey(k) && v?.threadId) ids.add(v.threadId)
      if (Array.isArray(op.insert)) for (const c of op.insert) if (c instanceof Y.Node) walk(c)
    }
  }
  walk(root)
  return ids
}
/** The derived state the UI and the agent see: status plus `orphan` (open and no live text). */
export const threadStates = (doc, liveIds) => listThreads(doc).map(t => ({ ...t, live: liveIds.has(t.id), orphan: t.status === 'open' && !liveIds.has(t.id) }))

// ── creating a comment from the editor ──────────────────────────────────────────────────────────────────────────
/**
 * The owner selects a passage and comments: the mark first (outside the undo history: a comment is not a text edit),
 * then the thread record. Two Y transactions; a peer that sees the mark before the thread renders nothing for it.
 */
export const commentSelection = (editor, ydoc, { threadId, by, at, body }) => {
  const { state, view } = editor
  const { from, to, $from } = state.selection
  if (from === to) throw new Error('empty selection')
  const quote = state.doc.textBetween(from, to, '\n')
  const blockStart = $from.before(1) // the top-level block: its gap in the root survives the block's deletion
  const [start, end, block] = resolvedPositionsToRelativePositions(view, [state.doc.resolve(from), state.doc.resolve(to), state.doc.resolve(blockStart)])
  // raw addMark: Tiptap's setMark copies the attrs of an overlapping comment already on the text into the new one
  view.dispatch(state.tr.addMark(from, to, state.schema.marks.comment.create({ threadId })).setMeta('addToHistory', false))
  addThread(ydoc, { threadId, quote, anchor: { start: rposJSON(start), end: rposJSON(end), block: rposJSON(block) }, blockId: $from.parent.attrs.id, by, at, body })
}

// ── the display plugin: highlight open threads only ─────────────────────────────────────────────────────────────
export const commentDisplayKey = new PluginKey('commentDisplay')
const decorate = (pmDoc, ydoc) => {
  const root = threadsRoot(ydoc)
  const decos = []
  for (const [id, ranges] of liveRanges(pmDoc)) {
    const t = root.getAttr(id)
    if (!t || t.getAttr('status') !== 'open') continue
    // overlapping inline decorations merge into one span: classes concatenate, other attributes overwrite
    for (const r of ranges) decos.push(Decoration.inline(r.from, r.to, { class: `comment-open comment-t-${id}` }))
  }
  return DecorationSet.create(pmDoc, decos)
}
export const CommentDisplay = Extension.create({
  name: 'commentDisplay',
  addOptions: () => ({ ydoc: null }),
  addProseMirrorPlugins () {
    const ydoc = this.options.ydoc
    return [new Plugin({
      key: commentDisplayKey,
      state: {
        init: (_, state) => decorate(state.doc, ydoc),
        apply: (tr, old, _o, state) => (tr.docChanged || tr.getMeta(commentDisplayKey) ? decorate(state.doc, ydoc) : old)
      },
      props: { decorations: state => commentDisplayKey.getState(state) },
      view: view => {
        // a threads-map change (resolve, reopen, a new thread) is outside the bound fragment: redraw on it
        const onChange = () => queueMicrotask(() => { if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(commentDisplayKey, true).setMeta('addToHistory', false)) })
        threadsRoot(ydoc).observeDeep(onChange)
        return { destroy: () => threadsRoot(ydoc).unobserveDeep(onChange) }
      }
    })]
  }
})

// ── Outline's paste dedupe ──────────────────────────────────────────────────────────────────────────────────────
/**
 * A pasted comment mark is kept only when its thread belongs to this document and no live text carries it: a cut
 * (text gone) followed by a paste moves the comment; a copy (text still there) pastes plain text; text from another
 * document, or an external `span[data-thread]`, never brings a mark in. An internal drag-move (`view.dragging.move`)
 * counts the dragged range as gone, since ProseMirror runs transformPasted before it deletes the source.
 */
export const stripCommentMarks = (fragment, keep) => {
  const out = []
  fragment.forEach(n => {
    if (n.isText) out.push(n.mark(n.marks.filter(m => m.type.name !== 'comment' || keep(m.attrs.threadId))))
    else out.push(n.copy(stripCommentMarks(n.content, keep)))
  })
  return Fragment.fromArray(out)
}
export const CommentPaste = Extension.create({
  name: 'commentPaste',
  addOptions: () => ({ ydoc: null }),
  addProseMirrorPlugins () {
    const ydoc = this.options.ydoc
    return [new Plugin({
      key: new PluginKey('commentPaste'),
      props: {
        transformPasted: (slice, view) => {
          let doc = view.state.doc
          if (view.dragging?.move) { const { from, to } = view.state.selection; doc = view.state.tr.delete(from, to).doc }
          const live = liveRanges(doc)
          const known = threadsRoot(ydoc)
          const keep = id => id != null && known.hasAttr(id) && !live.has(id)
          return new Slice(stripCommentMarks(slice.content, keep), slice.openStart, slice.openEnd)
        }
      }
    })]
  }
})

// ── orphan display: where the passage was ───────────────────────────────────────────────────────────────────────
/** The block id of a Y node, or of its nearest ancestor that has one. */
const blockIdOf = n => { for (let x = n; x; x = x.parent) { const id = x.getAttr?.('id'); if (id) return id } return null }
const isLive = n => { for (let x = n; x; x = x.parent) if (x._item?.deleted) return false; return true }
/**
 * Resolve a thread's stored anchor in a doc (no editor needed): the start/end pair resolved without following undone
 * deletions (the result every peer agrees on), the block's own position in its parent, and the nearest surviving
 * block. `how` names which part answered.
 */
export const locate = (doc, thread) => {
  const abs = j => { const r = rposOf(j); return r ? Y.createAbsolutePositionFromRelativePosition(r, doc, false) : null }
  const s = abs(thread.anchor?.start); const e = abs(thread.anchor?.end)
  if (s && isLive(s.type) && blockIdOf(s.type)) return { how: 'text', blockId: blockIdOf(s.type), index: s.index, endIndex: e && e.type === s.type ? e.index : null }
  const b = abs(thread.anchor?.block)
  if (b && isLive(b.type)) {
    const kids = b.type.toArray().filter(k => k instanceof Y.Node)
    const at = Math.min(b.index, kids.length - 1)
    const here = kids[b.index]; const prev = kids[b.index - 1]
    const pick = here && blockIdOf(here) === thread.blockId ? here : (prev ?? here ?? kids[at])
    return { how: here && here.getAttr('id') === thread.blockId ? 'block' : 'block-gap', blockId: pick ? pick.getAttr('id') : null, index: b.index }
  }
  return { how: 'none', blockId: null }
}
/** The extent of thread `id`'s live mark in Y: the first and last character carrying it, as (node, index) pairs. */
export const markExtentY = (root, id) => {
  let first = null; let last = null
  const walk = n => {
    let i = 0
    for (const op of n.toDelta().children) {
      if (typeof op.insert === 'string') {
        if (op.format && Object.entries(op.format).some(([k, v]) => isCommentKey(k) && v?.threadId === id)) {
          if (!first) first = { node: n, index: i }
          last = { node: n, index: i + op.insert.length }
        }
        i += op.insert.length
      } else for (const c of op.insert) { if (c instanceof Y.Node) walk(c); i += 1 }
    }
  }
  walk(root)
  return first && { first, last }
}
const sameSpot = (doc, j, spot) => { const a = j && Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(j), doc, false); return !!a && a.type === spot.node && a.index === spot.index }
/**
 * Host-side anchor refresh: the stored pair is only for orphan display, and splits, joins, type changes and moves
 * re-create text under new ids, so the pair drifts. For each thread whose mark is live and whose pair no longer
 * brackets it, rewrite the pair (and the block id and the current text) from the mark. Returns the ids rewritten.
 */
export const refreshAnchors = (doc, root, origin = { actor: 'host' }) => {
  const done = []
  doc.transact(() => {
    for (const [id, t] of threadsRoot(doc).attrEntries()) {
      const ext = markExtentY(root, id)
      if (!ext) continue
      const a = t.getAttr('anchor') ?? {}
      if (sameSpot(doc, a.start, ext.first) && sameSpot(doc, a.end, ext.last)) continue
      const block = ext.first.node
      let top = block; while (top.parent && top.parent !== root) top = top.parent // the top-level block holds the gap
      const parent = top.parent
      const at = parent ? parent.toArray().indexOf(top) : -1
      t.setAttr('anchor', {
        start: rposJSON(Y.createRelativePositionFromTypeIndex(ext.first.node, ext.first.index)),
        end: rposJSON(Y.createRelativePositionFromTypeIndex(ext.last.node, ext.last.index, -1)),
        block: at >= 0 ? rposJSON(Y.createRelativePositionFromTypeIndex(parent, at)) : (a.block ?? null)
      })
      t.setAttr('blockId', blockIdOf(block))
      done.push(id)
    }
  }, origin)
  return done
}

/** Map the stored pair into an editor's current doc (what a UI would scroll to). */
export const locateInView = (view, thread) => relativePositionsToResolvedPositions(view, [rposOf(thread.anchor?.start), rposOf(thread.anchor?.end)]).map(p => p?.pos ?? null)
