// S5 (P3-0): the minimal agent rewrite S5 needs on Yjs v14 — one textblock's text replaced by new plain text as a
// word diff of Y operations on the agent's replica (never a whole-block replace), with the comment marks re-mapped:
// unchanged words keep every format; deleted words go with theirs; inserted words carry a comment when the comment
// covers both neighbours (an insertion inside it) or covered every word they replace (an in-place rewording of the
// commented words). Every other format key is passed as null on insert so nothing inherits from the left (S6's
// pitfall). Hunks separated only by whitespace are merged (a token diff otherwise matches the spaces of a rewritten
// sentence and leaves comments on stray words). S4 owns the real patch writer; this is the rule S5 measured. Throwaway.
import * as Y from '@y/y'
import fastDiff from 'fast-diff'
import { ynodeToPmnode, pmnodeToDelta } from '@y/prosemirror'
import { isCommentKey } from './comments.mjs'

/**
 * The agent changes a block's type (paragraph → heading): a v14 node's name is immutable, so the block is deleted and
 * re-inserted under the same id with its inline content, every mark (comments included) carried as it was (S1's
 * recipe; §4.4 "a block whose type changes keeps its id and its marks").
 */
export const retypeBlock = (doc, root, blockId, schema, typeName, attrs = {}, origin = 'agent') => {
  const node = findById(root, blockId)
  const parent = node.parent
  const at = parent.toArray().indexOf(node)
  const pm = ynodeToPmnode(node, schema)
  const next = schema.nodes[typeName].create({ ...attrs, id: blockId }, pm.content)
  doc.transact(() => { parent.delete(at, 1); parent.insert(at, [pmnodeToDelta(next)]) }, origin)
}

/** Find a Y node by its `id` attribute under `root` (any depth). */
export const findById = (root, id) => {
  for (const c of root.toArray()) {
    if (!(c instanceof Y.Node)) continue
    if (c.getAttr('id') === id) return c
    const d = findById(c, id); if (d) return d
  }
  return null
}

/** Cells of a textblock's delta: one per character (or embed), each with its format record. */
export const cellsOf = node => {
  const out = []
  for (const op of node.toDelta().children) {
    const fmt = op.format ? { ...op.format } : {}
    if (typeof op.insert === 'string') for (const ch of op.insert) out.push({ ch, fmt })
    else for (const e of op.insert) out.push({ ch: '￼', fmt, embed: e })
  }
  return out
}
export const plainOf = node => cellsOf(node).map(c => c.ch).join('')

const TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu
/** Word-level hunks {from, to, nFrom, nTo} between old cells and a new string (old/new character offsets). */
export const wordHunks = (oldStr, newStr, { mergeWhitespace = true } = {}) => {
  const alphabet = new Map()
  const enc = s => { let out = ''; const lens = []; for (const t of s.match(TOKEN) ?? []) { let c = alphabet.get(t); if (c === undefined) { c = String.fromCharCode(0xe000 + alphabet.size); alphabet.set(t, c) } out += c; lens.push(t.length) } return { out, lens } }
  const a = enc(oldStr); const b = enc(newStr)
  const hunks = []; let ia = 0; let ib = 0; let ta = 0; let tb = 0; let open = null
  const span = (lens, t, n) => { let s = 0; for (let k = t; k < t + n; k++) s += lens[k]; return s }
  for (const [op, text] of fastDiff(a.out, b.out)) {
    const n = text.length
    if (op === 0) { if (open) { hunks.push(open); open = null } ia += span(a.lens, ta, n); ib += span(b.lens, tb, n); ta += n; tb += n } else {
      open ??= { from: ia, to: ia, nFrom: ib, nTo: ib }
      if (op === -1) { ia += span(a.lens, ta, n); ta += n; open.to = ia } else { ib += span(b.lens, tb, n); tb += n; open.nTo = ib }
    }
  }
  if (open) hunks.push(open)
  if (!mergeWhitespace) return hunks
  // a token diff matches the spaces between unrelated words; two hunks separated only by whitespace are one change
  // (else a rewritten sentence keeps comment marks on stray spaces and words; measured in s5-pins.mjs)
  const merged = []
  for (const h of hunks) {
    const prev = merged[merged.length - 1]
    if (prev && /^\s*$/.test(oldStr.slice(prev.to, h.from))) { prev.to = h.to; prev.nTo = h.nTo } else merged.push({ ...h })
  }
  return merged
}

/**
 * Rewrite block `blockId`'s text to `newText` on `doc` (the agent's replica) as one transaction. Returns the hunks and
 * the comment keys dropped (comments whose every cell in this block was deleted).
 */
export const rewriteBlock = (doc, root, blockId, newText, { origin = 'agent', inherit = 'inside-or-reworded', mergeWhitespace = true } = {}) => {
  const node = findById(root, blockId)
  if (!node) throw new Error('no block ' + blockId)
  const old = cellsOf(node)
  const oldStr = old.map(c => c.ch).join('')
  const hunks = wordHunks(oldStr, newText, { mergeWhitespace })
  const before = new Set(old.flatMap(c => Object.keys(c.fmt).filter(isCommentKey)))
  doc.transact(() => {
    for (const h of [...hunks].reverse()) {
      const left = old[h.from - 1]?.fmt ?? {}; const right = old[h.to]?.fmt ?? {}
      const replaced = old.slice(h.from, h.to)
      const fmt = {}
      for (const [k, v] of Object.entries(left)) if (isCommentKey(k) && k in right) fmt[k] = v
      if (inherit === 'inside-or-reworded' && replaced.length && h.nTo > h.nFrom) {
        for (const [k, v] of Object.entries(replaced[0].fmt)) if (isCommentKey(k) && replaced.every(c => k in c.fmt)) fmt[k] = v
      }
      // nothing inherits implicitly: every key on the left neighbour not chosen above is nulled
      for (const k of Object.keys(left)) if (!(k in fmt)) fmt[k] = null
      if (h.to > h.from) node.delete(h.from, h.to - h.from)
      if (h.nTo > h.nFrom) node.insert(h.from, newText.slice(h.nFrom, h.nTo), fmt)
    }
  }, origin)
  const after = new Set(cellsOf(node).flatMap(c => Object.keys(c.fmt).filter(isCommentKey)))
  return { hunks, dropped: [...before].filter(k => !after.has(k)) }
}
