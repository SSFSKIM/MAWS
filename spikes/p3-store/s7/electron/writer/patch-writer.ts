// S7b: a copy of S4's patch writer (spikes/p3-store/s4/src/patch-writer.ts, read 2026-10-12) with two options added for
// the scale gate: `rootOf` (the prose root may be a nested node, S3's tabs layout) and `validate`: 'document' (S4's
// strict check of the whole document after each run) or 'touched' (only the top-level blocks the batch touched, plus a
// shallow check of the root's content expression). `timings` records the dry-run clone and the validation per apply.
// S4 (P3-0): the patch writer (spec §4.4, Decision Log 20e). Applies the agent's block ops as minimal Yjs v14
// operations on the agent's own replica, never as a whole-fragment rewrite:
//  - same type: attributes set one by one, a textblock's text as a multi-hunk word diff with explicit formats, a
//    container's children aligned and patched recursively, so unchanged words keep their items (authorship,
//    comments, relative positions);
//  - type change (a Y node's name is immutable in v14): the node is re-inserted with the old id, and every mark the
//    agent's markdown cannot express (comments, highlights) is re-mapped onto the new text through the diff;
//  - marks (§4.4 A5, S5's rule, reconciled): unchanged words keep every mark the agent's markdown cannot express
//    (comments) and take the agent's markdown marks (bold, link…); deleted words lose theirs; inserted words carry a
//    comment when it covers both neighbours or covered every word the hunk replaces; hunks separated only by
//    whitespace are one hunk; every other key is an explicit null; a comment is orphaned only when all its words go,
//    and orphaned is derived (reported, never written: the mark is `comment {threadId}`, the threads map untouched);
//  - move: the block's node re-inserted with its id and marks (or, if a human caret is in it, the blocks it jumps
//    over are re-inserted instead, so a live composition is never under a re-insert);
//  - every re-insert reports a `carry` (old item ids → new item ids, char by char) so provenance keeps authorship.
// A batch is all or none: it is dry-run on a throwaway clone first, then applied in one transaction (one update, one
// revision). Throwaway spike code meant to be copied by P3-B.
import * as Y from '@y/y'
import * as delta from 'lib0/delta'
import { pmnodeToDelta, ynodeToPmnode, yattr2markname } from '@y/prosemirror'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import { type Cell, type Fmt, type Hunk, cellsOf, diffCells, equalMap, sameFmtValue, EMBED } from './inline-diff.ts'
import type { DocMarkdown } from './markdown.ts'

export type Op =
  | { op: 'replace_text', block?: string, old: string, new: string, all?: boolean }
  | { op: 'replace_block', id: string, markdown: string }
  | { op: 'insert', after?: string, before?: string, markdown: string }
  | { op: 'delete', id: string }
  | { op: 'move', id: string, after: string | null }
  | { op: 'set_cell', table: string, row: number, col: number, markdown: string }

export interface OpResult { line: string, target: string, newIds: string[] }
/** One char-for-char re-insert: item `from[i]` (client, clock) now lives at `to[i]`. */
export interface Carry {
  kind: 'move' | 'retype', blockId: string, from: Array<[number, number]>, to: Array<[number, number]>
  /** move: the old and the new node's own items (a copy, for the host's duplicate rule) */
  source?: [number, number], node?: [number, number]
  /** old textblock item → new textblock item, in order (for edits that arrive with only a parent) */
  blocks?: Array<[[number, number], [number, number]]>
}
export interface Applied { results: OpResult[], carries: Carry[], orphaned: string[] }

export class EditError extends Error {
  readonly code: 'not_found' | 'not_unique' | 'bad_target' | 'invalid'
  readonly candidates: Array<{ id: string, text: string, matches?: number }>
  readonly opIndex: number
  constructor (code: EditError['code'], message: string, candidates: EditError['candidates'] = [], opIndex = -1) {
    super(message); this.code = code; this.candidates = candidates; this.opIndex = opIndex
  }
}

const ATTRIBUTION = /^y-attributed-/

interface Found { node: any, parent: any, index: number, top: boolean }

/** Every visible slot's item id in document order, descending into child nodes (the node's own item first). */
export const deepSlotIds = (node: any, out: Array<[number, number]> = []): Array<[number, number]> => {
  for (let item = node._start; item !== null; item = item.right) {
    if (item.deleted || !item.countable) continue
    const c = item.content
    if (c instanceof Y.ContentString) {
      for (let k = 0; k < c.str.length; k++) out.push([item.id.client, item.id.clock + k])
    } else if (c instanceof Y.ContentType) {
      out.push([item.id.client, item.id.clock]); deepSlotIds(c.type, out)
    } else {
      for (let k = 0; k < item.length; k++) out.push([item.id.client, item.id.clock + k])
    }
  }
  return out
}

export interface WriterOptions {
  schema: Schema
  md: DocMarkdown
  /** §4.4 A5: merge hunks separated only by whitespace (default true; false only for S5's contrast runs) */
  mergeWhitespace?: boolean
  /** Mark names the agent's markdown can express; computed from the schema when absent. */
  agentMarks?: Set<string>
  /** The document's prose root name. */
  root?: string
  /** S7b: the prose root of a doc (overrides `root`) */
  rootOf?: (doc: Y.Doc) => any
  /** S7b: what `run` validates strictly */
  validate?: 'document' | 'touched'
}

export class PatchWriter {
  readonly schema: Schema
  readonly md: DocMarkdown
  readonly agentMarks: Set<string>
  readonly rootName: string
  readonly mergeWhitespace: boolean
  readonly rootOf: (doc: Y.Doc) => any
  readonly validate: 'document' | 'touched'
  /** S7b: per apply, the dry-run clone's and the validations' milliseconds */
  readonly timings: { cloneMs: number, runCloneMs: number, runMs: number, validateMs: number[] }[] = []
  private validateMs: number[] = []

  constructor (o: WriterOptions) {
    this.schema = o.schema; this.md = o.md; this.mergeWhitespace = o.mergeWhitespace ?? true
    this.rootName = o.root ?? 'default'
    this.rootOf = o.rootOf ?? ((doc: Y.Doc) => doc.get(this.rootName))
    this.validate = o.validate ?? 'document'
    this.agentMarks = o.agentMarks ?? this.probeAgentMarks()
  }

  /** A mark is the agent's if markdown serialize → parse keeps it (bold, italic, strike, underline, code, link here). */
  private probeAgentMarks (): Set<string> {
    const out = new Set<string>()
    const s = this.schema
    for (const name of Object.keys(s.marks)) {
      if (ATTRIBUTION.test(name)) continue
      const attrs = name === 'link' ? { href: 'https://example.com' } : null
      try {
        const p = s.nodes.paragraph.create(null, [s.text('a '), s.text('w', [s.marks[name].create(attrs)]), s.text(' b')])
        const back = this.md.parse(this.md.block(p))[0]
        let kept = false
        back.descendants(n => { if (n.marks.some(m => m.type.name === name)) kept = true })
        if (kept) out.add(name)
      } catch { /* not expressible */ }
    }
    return out
  }

  private isAgentKey (key: string) { return this.agentMarks.has(yattr2markname(key)) }

  /**
   * Apply a batch to `doc` (the agent's replica) as one transaction with `origin`. Throws EditError (and changes
   * nothing) if any op fails. `live` holds block ids with a human caret in them (from awareness).
   */
  apply (doc: Y.Doc, ops: Op[], { origin = null as unknown, live = new Set<string>() } = {}): Applied {
    // dry run on a clone: any failure leaves the replica untouched (Yjs cannot roll a transaction back)
    this.validateMs = []
    const t0 = performance.now()
    const clone = new Y.Doc({ gc: doc.gc })
    Y.applyUpdateV2(clone, Y.encodeStateAsUpdateV2(doc))
    const t1 = performance.now()
    this.run(clone, ops, live)
    const t2 = performance.now()
    let out!: Applied
    doc.transact(() => { out = this.run(doc, ops, live) }, origin)
    this.timings.push({ cloneMs: t1 - t0, runCloneMs: t2 - t1, runMs: performance.now() - t2, validateMs: this.validateMs })
    return out
  }

  /** Apply ops in order inside the current transaction. */
  run (doc: Y.Doc, ops: Op[], live: Set<string>): Applied {
    const ctx: Applied = { results: [], carries: [], orphaned: [] }
    const root = this.rootOf(doc)
    ops.forEach((op, i) => {
      try {
        ctx.results.push(this.applyOne(doc, root, op, live, ctx))
      } catch (e) {
        if (e instanceof EditError) throw new EditError(e.code, `op ${i} (${op.op}): ${e.message}`, e.candidates, i)
        throw new EditError('invalid', `op ${i} (${op.op}): ${(e as Error).message}`, [], i)
      }
    })
    // validation against the renderer's exact schema, strictly (ynodeToPmnode alone drops what does not fit)
    const tv = performance.now()
    if (this.validate === 'document') this.strict(root)
    else this.strictTouched(root, ctx)
    this.validateMs.push(performance.now() - tv)
    return ctx
  }

  // ── lookup ───────────────────────────────────────────────────────────────────────────────────────────────────
  find (root: any, id: string): Found {
    const walk = (parent: any, top: boolean): Found | null => {
      let index = 0
      for (const c of parent.toArray()) {
        if (c instanceof Y.Node) {
          if (c.getAttr('id') === id) return { node: c, parent, index, top }
          const r = walk(c, false); if (r) return r
        }
        index++
      }
      return null
    }
    const f = walk(root, true)
    if (!f) throw new EditError('not_found', `no block ^${id}`)
    return f
  }

  pm (node: any): PMNode { return ynodeToPmnode(node, this.schema) }

  /** Build the PM tree with createChecked at every level: throws on any node the schema does not admit there. */
  strict (y: any): PMNode {
    const isRoot = y.parent == null
    const type = isRoot ? this.schema.topNodeType : this.schema.nodes[y.name]
    if (!type) throw new EditError('invalid', `unknown node type ${y.name}`)
    if (type.isTextblock || type.isLeaf) {
      const pm = ynodeToPmnode(y, this.schema)
      if (cellsOf(y.toDelta()).length !== pm.content.size) throw new EditError('invalid', `${y.name} ^${y.getAttr('id')} holds content its schema drops`)
      pm.check(); return pm
    }
    const kids = y.toArray().filter((c: any) => c instanceof Y.Node).map((c: any) => this.strict(c))
    const attrs = isRoot ? null : y.getAttrs()
    try { return type.createChecked(attrs, kids) } catch (e) { throw new EditError('invalid', `${isRoot ? 'the document' : `${y.name} ^${y.getAttr('id')}`} would be invalid: ${(e as Error).message}`) }
  }
  text (node: any): string { return this.pm(node).textContent }

  /** S7b: strict validation of the top-level blocks holding what the batch touched, and the root's child types. */
  strictTouched (root: any, ctx: Applied) {
    const ids = new Set<string>()
    for (const r of ctx.results) { for (const t of r.target.split(',')) if (t) ids.add(t); for (const n of r.newIds) ids.add(n) }
    const tops = new Set<any>()
    for (const id of ids) {
      let f: Found
      try { f = this.find(root, id) } catch { continue } // deleted by the batch: the root check below covers it
      let n = f.node
      while (n.parent && n.parent !== root) n = n.parent
      tops.add(n)
    }
    for (const n of tops) this.strict(n)
    let m: any = this.schema.topNodeType.contentMatch
    for (const c of root.toArray()) {
      if (!(c instanceof Y.Node)) throw new EditError('invalid', 'text at the document root')
      const type = this.schema.nodes[c.name]
      m = type && m?.matchType(type)
      if (!m) throw new EditError('invalid', `the document would be invalid: ${c.name} at the root`)
    }
    if (!m.validEnd) throw new EditError('invalid', 'the document would be invalid: incomplete content')
  }

  private applyOne (doc: Y.Doc, root: any, op: Op, live: Set<string>, ctx: Applied): OpResult {
    switch (op.op) {
      case 'replace_text': return this.replaceText(doc, root, op, ctx)
      case 'replace_block': {
        const f = this.find(root, op.id)
        const blocks = this.md.parse(op.markdown)
        if (!blocks.length) throw new EditError('invalid', 'empty markdown (use delete)')
        this.patchNode(doc, f, blocks[0], ctx)
        const extra = blocks.slice(1)
        if (extra.length) f.parent.insert(f.index + 1, extra.map(b => pmnodeToDelta(b)))
        return { line: `replaced ^${op.id}${extra.length ? ` (+${extra.length} blocks)` : ''}`, target: op.id, newIds: extra.flatMap(idsOf) }
      }
      case 'insert': {
        const anchor = op.after ?? op.before
        if (anchor == null) throw new EditError('invalid', 'insert needs after or before')
        const f = this.find(root, anchor)
        const blocks = this.md.parse(op.markdown)
        f.parent.insert(op.after != null ? f.index + 1 : f.index, blocks.map(b => pmnodeToDelta(b)))
        const ids = blocks.flatMap(idsOf)
        return { line: `inserted ${blocks.length} block(s) ${op.after != null ? 'after' : 'before'} ^${anchor}: ${blocks.map(b => '^' + b.attrs.id).join(' ')}`, target: anchor, newIds: ids }
      }
      case 'delete': {
        const f = this.find(root, op.id)
        const orphans = commentsIn(cellsDeep(f.node))
        f.parent.delete(f.index, 1)
        const lost = this.orphan(doc, orphans, ctx)
        return { line: `deleted ^${op.id}${lost.length ? `; orphaned thread(s) ${lost.join(', ')}` : ''}`, target: op.id, newIds: [] }
      }
      case 'move': return this.move(root, op, live, ctx)
      case 'set_cell': {
        const t = this.find(root, op.table)
        if (t.node.name !== 'table') throw new EditError('bad_target', `^${op.table} is a ${t.node.name}, not a table`)
        const row = t.node.toArray()[op.row]
        const cell = row?.toArray()[op.col]
        if (!(cell instanceof Y.Node)) throw new EditError('bad_target', `table ^${op.table} has no cell (${op.row}, ${op.col})`)
        const blocks = this.md.parse(op.markdown)
        const pmCell = this.schema.nodes[cell.name].create({ ...this.pm(cell).attrs }, blocks)
        pmCell.check()
        this.patchChildren(doc, cell, blocks, ctx)
        return { line: `set cell (${op.row}, ${op.col}) of ^${op.table}`, target: String(cell.getAttr('id') ?? op.table), newIds: [] }
      }
    }
  }

  // ── replace_text: an exact, unique string edit of a block's markdown, applied as a block patch ──────────────
  private replaceText (doc: Y.Doc, root: any, op: Extract<Op, { op: 'replace_text' }>, ctx: Applied): OpResult {
    if (!op.old) throw new EditError('invalid', 'old is empty')
    const pool: Found[] = op.block != null ? [this.find(root, op.block)] : root.toArray().map((node: any, index: number) => ({ node, parent: root, index, top: true }))
    const hits = pool.map(f => ({ f, md: this.md.block(this.pm(f.node)) })).map(h => ({ ...h, n: count(h.md, op.old) })).filter(h => h.n > 0)
    const total = hits.reduce((s, h) => s + h.n, 0)
    if (total === 0) {
      const words = op.old.replace(/[*_`~[\]()#>+-]/g, ' ').split(/\s+/).filter(w => w.length > 3)
      const near = pool.map(f => ({ id: String(f.node.getAttr('id')), text: this.text(f.node) })).filter(c => words.some(w => c.text.includes(w)))
      throw new EditError('not_found', `"${op.old}" not found${op.block ? ` in ^${op.block}` : ''}`, near.map(c => ({ id: c.id, text: c.text })))
    }
    if (total > 1 && !op.all) {
      throw new EditError('not_unique', `"${op.old}" matches ${total} times; quote more context or pass all`, hits.map(h => ({ id: String(h.f.node.getAttr('id')), text: this.text(h.f.node), matches: h.n })))
    }
    for (const h of hits) {
      const next = op.all ? h.md.split(op.old).join(op.new) : h.md.replace(op.old, () => op.new)
      const blocks = this.md.parse(next)
      if (blocks.length !== 1) throw new EditError('invalid', `the replacement turns ^${h.f.node.getAttr('id')} into ${blocks.length} blocks (use replace_block)`)
      this.patchNode(doc, h.f, blocks[0], ctx)
    }
    return { line: `replaced ${total} occurrence(s) in ${hits.map(h => '^' + h.f.node.getAttr('id')).join(', ')}`, target: hits.map(h => String(h.f.node.getAttr('id'))).join(','), newIds: [] }
  }

  // ── the patch: same type in place, else a re-mapped re-insert ──────────────────────────────────────────────
  patchNode (doc: Y.Doc, f: Found, pm: PMNode, ctx: Applied) {
    const y = f.node
    if (y.name !== pm.type.name) return this.retype(doc, f, pm, ctx)
    for (const [k, v] of Object.entries(pm.attrs)) {
      if (k === 'id') continue
      const cur = y.getAttr(k)
      if (!sameFmtValue(cur ?? null, v ?? null)) { if (v == null) y.deleteAttr(k); else y.setAttr(k, v) }
    }
    if (pm.isTextblock) this.patchInline(doc, y, pm, ctx)
    else {
      const kids: PMNode[] = []; pm.forEach(c => kids.push(c))
      this.patchChildren(doc, y, kids, ctx)
    }
  }

  /** Align a container's children (type + text) and patch pairs; unmatched ones are deleted or inserted. */
  patchChildren (doc: Y.Doc, y: any, kids: PMNode[], ctx: Applied) {
    const old = y.toArray().filter((c: any) => c instanceof Y.Node)
    const sig = (name: string, text: string) => name + '\u0000' + text
    const oldCells: Cell[] = old.map((c: any) => ({ ch: 'x', fmt: {}, embed: sig(c.name, this.text(c)) }))
    const newCells: Cell[] = kids.map(k => ({ ch: 'x', fmt: {}, embed: sig(k.type.name, k.textContent) }))
    // exact matches stay as they are; a run of changed children is paired in order by type, the rest replaced
    const hunks = diffCells(oldCells.map(c => ({ ...c, ch: EMBED })), newCells.map(c => ({ ...c, ch: EMBED })))
    const plan: Array<{ kind: 'patch', o: number, n: number } | { kind: 'del', o: number } | { kind: 'ins', at: number, n: number }> = []
    const eq = equalMap(old.length, hunks)
    eq.forEach((n, o) => { if (n !== undefined) plan.push({ kind: 'patch', o, n }) })
    for (const h of hunks) {
      let o = h.from; let n = h.nFrom
      while (o < h.to && n < h.nTo && old[o].name === kids[n].type.name) plan.push({ kind: 'patch', o: o++, n: n++ })
      while (o < h.to) plan.push({ kind: 'del', o: o++ })
      while (n < h.nTo) plan.push({ kind: 'ins', at: o, n: n++ })
    }
    // apply right to left so indices hold; patches first (they never shift indices)
    for (const p of plan) if (p.kind === 'patch') this.patchNode(doc, { node: old[p.o], parent: y, index: p.o, top: false }, keepId(kids[p.n], old[p.o]), ctx)
    const dels = plan.filter(p => p.kind === 'del').map(p => (p as any).o).sort((a, b) => b - a)
    const ins = plan.filter(p => p.kind === 'ins') as Array<{ at: number, n: number }>
    // inserts are positioned in old coordinates; process from the right together with deletes
    const events = [...dels.map(o => ({ at: o, del: true, n: -1 })), ...ins.map(i => ({ at: i.at, del: false, n: i.n }))]
      .sort((a, b) => b.at - a.at || Number(b.del) - Number(a.del) || b.n - a.n)
    for (const e of events) {
      if (e.del) { const orphans = commentsIn(cellsDeep(old[e.at])); y.delete(e.at, 1); this.orphan(doc, orphans, ctx) } else y.insert(e.at, [pmnodeToDelta(kids[e.n])])
    }
  }

  /** Same-type textblock: one delta of retains (format fixes), deletes and inserts, from the word diff. */
  patchInline (doc: Y.Doc, y: any, pm: PMNode, ctx: Applied) {
    const old = cellsOf(y.toDelta())
    const neu = cellsOf(pmnodeToDelta(pm))
    const hunks = diffCells(old, neu, { mergeWhitespace: this.mergeWhitespace })
    const merged = this.mergeFormats(old, neu, hunks, pm.type)
    const d = delta.create()
    let i = 0; let j = 0
    const retainRun = (until: number) => {
      while (i < until) {
        const patch = fmtPatch(old[i].fmt, merged[j])
        let n = 1
        while (i + n < until && sameFmtValue(fmtPatch(old[i + n].fmt, merged[j + n]), patch)) n++
        d.retain(n, patch ?? undefined)
        i += n; j += n
      }
    }
    for (const h of hunks) {
      retainRun(h.from)
      if (h.to > h.from) d.delete(h.to - h.from)
      insertRuns(d, neu.slice(h.nFrom, h.nTo), merged.slice(h.nFrom, h.nTo), old[h.from - 1]?.fmt ?? {})
      i = h.to; j = h.nTo
    }
    retainRun(old.length)
    y.applyDelta(d.done())
    this.orphan(doc, gone(old, merged), ctx)
  }

  /** Formats of the new cells: the agent's marks from its markdown, every other mark carried from the old text. */
  mergeFormats (old: Cell[], neu: Cell[], hunks: Hunk[], parentType: any): Fmt[] {
    const allowed = (k: string) => { const t = this.schema.marks[yattr2markname(k)]; return !!t && parentType.allowsMarkType(t) }
    const merged: Fmt[] = new Array(neu.length)
    const eq = equalMap(old.length, hunks)
    eq.forEach((n, o) => {
      if (n === undefined) return
      const f: Fmt = {}
      for (const [k, v] of Object.entries(neu[n].fmt)) if (this.isAgentKey(k)) f[k] = (k in old[o].fmt && sameAgentMark(k, old[o].fmt[k], v)) ? old[o].fmt[k] : v
      for (const [k, v] of Object.entries(old[o].fmt)) if (!this.isAgentKey(k) && allowed(k)) f[k] = v
      merged[n] = f
    })
    for (const h of hunks) {
      const left = old[h.from - 1]?.fmt ?? {}; const right = old[h.to]?.fmt ?? {}
      // A5: a preserved mark (a comment) covers the new words when it covers both neighbours (an insertion inside
      // it) or covered every word the hunk replaces (an in-place rewording of its words); text typed at its edge,
      // or a rewrite that only partly overlapped it, does not extend it (inclusive: false)
      const inherit: Fmt = {}
      for (const [k, v] of Object.entries(left)) if (!this.isAgentKey(k) && k in right) inherit[k] = v
      if (h.to > h.from && h.nTo > h.nFrom) {
        for (const [k, v] of Object.entries(old[h.from].fmt)) {
          if (this.isAgentKey(k)) continue
          let all = true; for (let o = h.from; o < h.to && all; o++) all = k in old[o].fmt
          if (all) inherit[k] = v
        }
      }
      for (let n = h.nFrom; n < h.nTo; n++) {
        const f: Fmt = {}
        for (const [k, v] of Object.entries(neu[n].fmt)) if (this.isAgentKey(k)) f[k] = v
        for (const [k, v] of Object.entries(inherit)) if (allowed(k)) f[k] = v
        merged[n] = f
      }
    }
    return merged
  }

  /** A type change: the node re-inserted under its id, preserved marks re-mapped through the diff, words carried. */
  retype (doc: Y.Doc, f: Found, pm: PMNode, ctx: Applied) {
    const y = f.node
    const id = y.getAttr('id')
    const oldBlocks = textblocksY(y, this.schema)
    const oldCells = joinCells(oldBlocks.map(b => cellsOf(b.toDelta())))
    const oldSlots = joinSlots(oldBlocks.map(b => deepSlotIds(b)))
    const target = pm.type.create({ ...pm.attrs, id }, pm.content, pm.marks)
    const newBlocksPm: PMNode[] = []
    target.descendants(n => { if (n.isTextblock) { newBlocksPm.push(n); return false } return true })
    if (target.isTextblock) newBlocksPm.push(target)
    const newCells = joinCells(newBlocksPm.map(b => cellsOf(pmnodeToDelta(b))))
    const hunks = diffCells(oldCells, newCells, { mergeWhitespace: this.mergeWhitespace })
    // marks allowed per new cell depend on its textblock's type
    const typeAt: any[] = []; newBlocksPm.forEach((b, k) => { for (let c = 0; c < b.content.size; c++) typeAt.push(b.type); if (k < newBlocksPm.length - 1) typeAt.push(b.type) })
    const merged = this.mergeFormats(oldCells, newCells, hunks, { allowsMarkType: () => true })
    merged.forEach((fm, n) => { for (const k of Object.keys(fm)) { const t = this.schema.marks[yattr2markname(k)]; if (!typeAt[n]?.allowsMarkType(t)) delete fm[k] } })
    f.parent.delete(f.index, 1)
    f.parent.insert(f.index, [pmnodeToDelta(target)])
    const fresh = f.parent.get(f.index)
    // second pass: lay the merged formats onto the inserted text (the insert carried only the agent's marks)
    const newBlocksY = textblocksY(fresh, this.schema)
    let at = 0
    for (const b of newBlocksY) {
      const cur = cellsOf(b.toDelta())
      const d = delta.create(); let k = 0
      while (k < cur.length) {
        const patch = fmtPatch(cur[k].fmt, merged[at + k]); let n = 1
        while (k + n < cur.length && sameFmtValue(fmtPatch(cur[k + n].fmt, merged[at + k + n]), patch)) n++
        d.retain(n, patch ?? undefined); k += n
      }
      if (!d.isEmpty()) b.applyDelta(d.done())
      at += cur.length + 1
    }
    // carry the unchanged words' items (authorship) from the old node to the new one
    const newSlots = joinSlots(newBlocksY.map(b => deepSlotIds(b)))
    const oldTb = oldBlocks.map(itemId); const newTb = newBlocksY.map(itemId)
    const carry: Carry = { kind: 'retype', blockId: String(id), from: [], to: [], blocks: oldTb.slice(0, newTb.length).map((b, k) => [b, newTb[k]]) }
    equalMap(oldCells.length, hunks).forEach((n, o) => {
      if (n !== undefined && oldSlots[o] && newSlots[n] && oldCells[o].ch !== '\n') { carry.from.push(oldSlots[o]!); carry.to.push(newSlots[n]!) }
    })
    ctx.carries.push(carry)
    this.orphan(doc, gone(oldCells, merged), ctx)
  }

  // ── move: re-insert with id and marks, or re-insert what it jumps over when a human is typing in it ─────────
  private move (root: any, op: Extract<Op, { op: 'move' }>, live: Set<string>, ctx: Applied): OpResult {
    const x = this.find(root, op.id)
    if (!x.top) throw new EditError('bad_target', `^${op.id} is not a top-level block`)
    const afterIndex = op.after == null ? -1 : this.find(root, op.after).index
    if (op.after != null && !this.find(root, op.after).top) throw new EditError('bad_target', `^${op.after} is not a top-level block`)
    if (afterIndex === x.index || afterIndex === x.index - 1) return { line: `^${op.id} already there`, target: op.id, newIds: [] }
    // the swap of [x] and the span it jumps over: re-insert the side that holds no human caret
    const down = afterIndex > x.index
    const span = down ? range(x.index + 1, afterIndex + 1) : range(afterIndex + 1, x.index)
    const spanIds = span.map(i => String(root.get(i).getAttr('id')))
    const xLive = live.has(op.id); const spanLive = spanIds.some(id => live.has(id))
    if (xLive && spanLive) throw new EditError('bad_target', `a human is typing in ^${op.id} and in the blocks it would pass; retry later`)
    if (!xLive) {
      this.reinsert(root, x.index, down ? afterIndex : afterIndex + 1, 'move', ctx)
      return { line: `moved ^${op.id} after ${op.after == null ? 'the start' : '^' + op.after}`, target: op.id, newIds: [] }
    }
    // x holds a caret: move the span to the other side of x instead (same resulting order)
    // down: each next span block (right after x) goes right before x; up: each (right after `after`) goes right after x
    if (down) for (let k = 0; k < span.length; k++) this.reinsert(root, x.index + k + 1, x.index + k, 'move', ctx)
    else for (let k = 0; k < span.length; k++) this.reinsert(root, afterIndex + 1, x.index, 'move', ctx)
    return { line: `moved ^${op.id} after ${op.after == null ? 'the start' : '^' + op.after} (by moving ${spanIds.map(s => '^' + s).join(' ')}; a human is typing in ^${op.id})`, target: op.id, newIds: [] }
  }

  /** Delete the top-level block at `from` and insert its copy so that it lands at index `to` (post-delete index). */
  private reinsert (root: any, from: number, to: number, kind: Carry['kind'], ctx: Applied) {
    const node = root.get(from)
    const copy = node.toDeltaDeep()
    const fromSlots = deepSlotIds(node)
    const fromBlocks = textblocksY(node, this.schema).map(itemId)
    const id = String(node.getAttr('id'))
    const source = itemId(node)
    root.delete(from, 1)
    root.insert(to, [copy])
    const fresh = root.get(to)
    const toSlots = deepSlotIds(fresh)
    const toBlocks = textblocksY(fresh, this.schema).map(itemId)
    ctx.carries.push({ kind, blockId: id, from: fromSlots, to: toSlots, source, node: itemId(fresh), blocks: fromBlocks.map((b, k) => [b, toBlocks[k]]) })
  }

  // ── comments ─────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Threads this op left without text (A5: orphaned is derived from the marks, so nothing is written; the result
   * reports them so the agent knows, and the thread keeps its stored quote for display).
   */
  private orphan (doc: Y.Doc, gone: Map<string, string>, ctx: Applied): string[] {
    if (!gone.size) return []
    const live = new Set(commentsIn(cellsDeep(this.rootOf(doc))).values())
    const out: string[] = []
    for (const tid of new Set(gone.values())) {
      if (live.has(tid)) continue // the comment still covers text elsewhere (e.g. a sibling, a moved copy)
      out.push(tid)
      if (!ctx.orphaned.includes(tid)) ctx.orphaned.push(tid)
    }
    return out
  }
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────────
const count = (s: string, sub: string) => { let n = 0; let i = s.indexOf(sub); while (i >= 0) { n++; i = s.indexOf(sub, i + sub.length) } return n }
const itemId = (n: any): [number, number] => [n._item.id.client, n._item.id.clock]
const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k)
const idsOf = (b: PMNode): string[] => { const out: string[] = []; if (b.attrs.id) out.push(b.attrs.id); b.descendants(n => { if (n.attrs?.id) out.push(n.attrs.id) }); return out }
/** The parsed node with the old node's id (and the ids of the matched children are kept by the recursion). */
const keepId = (pm: PMNode, y: any): PMNode => (pm.attrs.id === undefined ? pm : pm.type.create({ ...pm.attrs, id: y.getAttr('id') ?? pm.attrs.id }, pm.content, pm.marks))
const sameAgentMark = (k: string, a: any, b: any) => (yattr2markname(k) === 'link' ? a?.href === b?.href : true)
export const isCommentKey = (k: string) => yattr2markname(k) === 'comment'
const fmtPatch = (old: Fmt, want: Fmt): Fmt | null => {
  const p: Fmt = {}; let any = false
  for (const [k, v] of Object.entries(want)) if (!sameFmtValue(old[k], v)) { p[k] = v; any = true }
  for (const k of Object.keys(old)) if (!(k in want)) { p[k] = null; any = true }
  return any ? p : null
}
/** Insert runs with explicit formats: every key active on the left that a run does not carry is an explicit null. */
const insertRuns = (d: any, cells: Cell[], fmts: Fmt[], leftFmt: Fmt) => {
  let k = 0; let active = leftFmt
  const explicit = (f: Fmt) => { const out: Fmt = { ...f }; for (const key of Object.keys(active)) if (!(key in out)) out[key] = null; active = f; return out }
  while (k < cells.length) {
    if (cells[k].embed !== undefined) { d.insert([cells[k].embed], explicit(fmts[k])); k++; continue }
    let s = cells[k].ch; let n = 1
    while (k + n < cells.length && cells[k + n].embed === undefined && sameFmtValue(fmts[k + n], fmts[k])) s += cells[k + n++].ch
    d.insert(s, explicit(fmts[k])); k += n
  }
}
/** Comments (key → thread id) present in the old cells and absent from every new cell. */
const gone = (old: Cell[], merged: Fmt[]) => {
  const before = commentsIn(old); const after = new Set<string>()
  for (const f of merged) for (const k of Object.keys(f)) if (isCommentKey(k)) after.add(k)
  return new Map([...before].filter(([k]) => !after.has(k)))
}
/** Comment marks in cells, key → thread id. */
export const commentsIn = (cells: Cell[]) => { const m = new Map<string, string>(); for (const c of cells) for (const [k, v] of Object.entries(c.fmt)) if (isCommentKey(k) && v) m.set(k, String(v.threadId)); return m }
/** All text cells under a node (any depth), for comment bookkeeping. */
const cellsDeep = (node: any): Cell[] => {
  const out: Cell[] = []
  const walk = (n: any) => {
    const cells = cellsOf(n.toDelta())
    for (const c of cells) { if (c.embed === undefined) out.push(c) }
    for (const ch of n.toArray()) if (ch instanceof Y.Node) walk(ch)
  }
  walk(node)
  return out
}
const textblocksY = (node: any, schema: Schema): any[] => {
  const out: any[] = []
  const walk = (n: any) => { if (schema.nodes[n.name]?.isTextblock) { out.push(n); return } for (const c of n.toArray()) if (c instanceof Y.Node) walk(c) }
  walk(node)
  return out
}
const SEP: Cell = { ch: '\n', fmt: {} }
const joinCells = (blocks: Cell[][]) => blocks.flatMap((b, k) => (k < blocks.length - 1 ? [...b, SEP] : b))
const joinSlots = (blocks: Array<Array<[number, number]>>) => blocks.flatMap((b, k) => (k < blocks.length - 1 ? [...b, null] : b)) as Array<[number, number] | null>
