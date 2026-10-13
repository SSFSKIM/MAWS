// S5 (P3-0) item 5: the agent's markdown read with comments, and the three comment tools over the agent's replica.
// The read is S4's GFM with `^id` block markers (spikes/p3-store/s4/src/markdown.ts) plus comment milestones:
// `<c:ID>` where an open thread's text starts and `</c:ID>` where it ends. Each tag names its thread, so overlapping
// comments need no nesting ("<c:t1>a <c:t2>b</c:t1> c</c:t2>"). Resolved threads are not marked (as on screen); a
// footer lists the open threads, orphans included with their stored quote. @tiptap/markdown's serializer tracks marks
// by type, so overlapping same-type marks cannot go through it: the milestones are inserted as sentinel characters
// before serializing and replaced after. Throwaway spike code (P3-B owns the real reader).
import { MarkdownManager } from '@tiptap/markdown'
import { ynodeToPmnode } from '@y/prosemirror'
import { threadStates, liveIdsY, getThread, reply, resolve, reopen, locate } from './comments.mjs'
import { findById, plainOf, rewriteBlock } from './rewrite.mjs'

const OPEN = 'o'; const CLOSE = 'c'; const END = ''
export const MARKER = /<\/?c:[A-Za-z0-9_-]+>/g
export const stripMarkers = s => s.replace(MARKER, '')

/** Inline content with comment marks of `show` threads replaced by sentinel milestones (PM JSON in, PM JSON out). */
const milestones = (content, show) => {
  const out = []; let active = []
  const ids = n => (n.marks ?? []).filter(m => m.type === 'comment' && show.has(m.attrs.threadId)).map(m => m.attrs.threadId)
  const rest = n => (n.marks ?? []).filter(m => m.type !== 'comment')
  const sentinel = (text, marks) => ({ type: 'text', text, ...(marks.length ? { marks } : {}) })
  content.forEach((n, i) => {
    const now = n.type === 'text' ? ids(n) : []
    const closing = active.filter(id => !now.includes(id)); const opening = now.filter(id => !active.includes(id))
    const prevMarks = i > 0 ? rest(content[i - 1]) : []
    for (const id of closing.reverse()) out.push(sentinel(CLOSE + id + END, prevMarks))
    for (const id of opening) out.push(sentinel(OPEN + id + END, rest(n)))
    const m = rest(n)
    out.push(n.type === 'text' ? { ...n, marks: m.length ? m : undefined } : n)
    active = now
  })
  const last = content.length ? rest(content[content.length - 1]) : []
  for (const id of active.reverse()) out.push(sentinel(CLOSE + id + END, last))
  return out
}
const walk = (json, show) => {
  if (!json.content) return json
  const inline = json.content.some(c => c.type === 'text')
  return { ...json, content: inline ? milestones(json.content, show) : json.content.map(c => walk(c, show)) }
}

export const createReader = (schema, exts) => {
  const md = new MarkdownManager({ extensions: exts })
  const block = node => md.serialize({ type: 'doc', content: [node] }).trim()
  /** The document as the agent reads it, with comment milestones and the comments footer. */
  const read = (doc, root) => {
    const states = threadStates(doc, liveIdsY(root))
    const show = new Set(states.filter(t => t.status === 'open').map(t => t.id))
    const pm = ynodeToPmnode(root, schema).toJSON()
    const out = []
    for (const b of pm.content) {
      const text = block(walk(b, show)).replace(new RegExp(OPEN + '([^' + END + ']+)' + END, 'g'), '<c:$1>').replace(new RegExp(CLOSE + '([^' + END + ']+)' + END, 'g'), '</c:$1>')
      const id = b.attrs?.id
      out.push(id == null ? text : (text.includes('\n') ? `${text}\n^${id}` : `${text} ^${id}`))
    }
    const open = states.filter(t => t.status === 'open')
    const nResolved = states.length - open.length
    const foot = open.map(t => {
      const first = t.messages[0]; const n = t.messages.length
      const head = t.orphan
        ? `- c:${t.id} orphaned (its text was deleted; was "${t.quote}", near ^${locate(doc, t).blockId ?? '?'})`
        : `- c:${t.id} on ^${blockOfThread(root, t.id) ?? t.blockId} "${t.quote}"`
      return `${head} — ${first?.by ?? '?'}: ${first?.body ?? ''}${n > 1 ? ` (+${n - 1} repl${n === 2 ? 'y' : 'ies'})` : ''}`
    })
    const footer = open.length || nResolved
      ? `\n\n---\nComments: ${open.length} open${open.some(t => t.orphan) ? ` (${open.filter(t => t.orphan).length} orphaned)` : ''}${nResolved ? `, ${nResolved} resolved (not shown; artifact_comments {status: "all"})` : ''}\n${foot.join('\n')}`
      : ''
    return out.join('\n\n') + footer + '\n'
  }
  return { read, block }
}

/** The block id whose text first carries thread `id` (the comment's current block). */
const blockOfThread = (root, id) => {
  for (const n of root.toArray()) {
    const hit = nodeHas(n, id); if (hit) return hit
  }
  return null
}
const nodeHas = (n, id) => {
  if (!n?.toDelta) return null
  for (const op of n.toDelta().children) {
    if (typeof op.insert === 'string' && op.format && Object.values(op.format).some(v => v?.threadId === id)) return n.getAttr('id') ?? null
    if (Array.isArray(op.insert)) for (const c of op.insert) { const h = nodeHas(c, id); if (h) return h }
  }
  return null
}

// ── the three tools, over the agent's replica (the host would route them; shapes per §4.3) ──────────────────────
export const artifactComments = (doc, root, { status = 'open' } = {}) => threadStates(doc, liveIdsY(root))
  .filter(t => status === 'all' || t.status === status)
  .map(t => ({
    threadId: t.id, status: t.status, orphan: t.orphan, quote: t.quote,
    block: t.live ? blockOfThread(root, t.id) : null, near: t.orphan ? locate(doc, t).blockId : undefined,
    createdBy: t.createdBy, createdAt: t.createdAt, resolvedBy: t.resolvedBy ?? undefined,
    messages: t.messages.map(m => ({ by: m.by, at: m.at, body: m.body }))
  }))
export const artifactReply = (doc, threadId, { by, at, body }) => reply(doc, threadId, { id: `${threadId}:${at}`, by, at, body }, by)
export const artifactResolve = (doc, threadId, { by, at, reopen: again = false }) => (again ? reopen : resolve)(doc, threadId, by, at, by)

/** `replace_text {block, old, new}` with markers tolerated in `old` (stripped) and ignored in `new` (stripped). */
export const replaceText = (doc, root, { block, old, new: neu }, origin = 'agent') => {
  const node = findById(root, block)
  const plain = plainOf(node)
  const o = stripMarkers(old)
  const at = plain.indexOf(o)
  if (at < 0 || plain.indexOf(o, at + 1) >= 0) throw new Error(`replace_text: "${o}" is ${at < 0 ? 'absent' : 'not unique'} in ^${block}`)
  return rewriteBlock(doc, root, block, plain.slice(0, at) + stripMarkers(neu) + plain.slice(at + o.length), { origin })
}
