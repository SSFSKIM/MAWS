// S4 (P3-0): the host side of `artifact_edit` around the patch writer: the host doc with S1's hub (one port per
// replica, the `{seq, actor, at, bytes}` log), the live revision (the log's sequence), a per-block "last changed at"
// index for target-only validation against `baseRevision`, idempotency by tool-use id, the id repair (missing ids,
// concurrent-move duplicates: keep the later insertion and tombstone the other; any other duplicate re-id'd), and
// edit forwarding (the rule this spike proposes): edits that land in a block after the agent re-inserted it elsewhere
// (a move or a type change) are carried into the live copy instead of vanishing in the tombstone.
// Throwaway spike code; P3-A/P3-B own the real service.
import * as Y from '@y/y'
import { createHub } from './hub.ts'
import { BLOCK_TYPES, nanoid8 } from './schema.ts'
import { type Op, type Carry, type Applied, PatchWriter, EditError, deepSlotIds } from './patch-writer.ts'

export type Slot = [number, number]
export const REPAIR = { actor: 'host-repair' }
const key = (s: Slot | { client: number, clock: number }) => (Array.isArray(s) ? `${s[0]}:${s[1]}` : `${s.client}:${s.clock}`)

export interface EditRequest { toolUseId: string, baseRevision: number, ops: Op[], live?: Set<string> }
export type EditResult =
  | { ok: true, revision: number, lines: string[], newIds: string[], orphaned: string[], replayed?: boolean, ms: number, updateBytes: number }
  | { ok: false, revision: number, conflicts?: Array<{ op: number, block: string, changedAt: number, text: string }>, error?: { code: string, message: string, candidates: unknown[] }, replayed?: boolean }

interface CopyRec { blockId: string, node: Slot, seq: number, source: Slot | null, base: Map<string, Slot> }

export class DocHost {
  readonly doc: Y.Doc
  readonly hub: any
  readonly writerFor: (actor: string) => PatchWriter
  /** id → seq of the last update that changed the block or anything inside it */
  readonly changedAt = new Map<string, number>()
  /** container id → seq of the last update that changed its own child list (rows of a table) */
  readonly structAt = new Map<string, number>()
  readonly insertedAt = new WeakMap<object, number>()
  readonly applied = new Map<string, EditResult>()
  readonly carries: Array<Carry & { seq: number, actor: string }> = []
  readonly copies = new Map<string, CopyRec>() // copy node item key → record
  /** where a char of a re-inserted (stale) node lives now */
  readonly fwd = new Map<string, { to: Slot, seq: number }>()
  /** stale textblock item key → its live textblock item */
  readonly fwdBlock = new Map<string, { to: Slot, seq: number }>()
  /** updates that re-inserted something (their own deletes of the old copy are not edits to forward) */
  readonly carrySeqs = new Set<number>()
  readonly report: string[] = []
  /** the actor whose batch is being applied (its update re-inserts; its deletes of the old copy are not edits) */
  private batchActor: string | null = null
  readonly rootName: string

  constructor ({ doc = new Y.Doc(), writerFor, clock = () => Date.now(), root = 'default' }: { doc?: Y.Doc, writerFor: (actor: string) => PatchWriter, clock?: () => number, root?: string }) {
    this.doc = doc; this.writerFor = writerFor; this.rootName = root
    this.hub = createHub({ hostDoc: doc, clock, receive: (u, origin, o) => this.receive(u, origin, o) })
    doc.on('afterTransaction', (tr: any) => this.index(tr))
  }

  get revision (): number { return this.hub.log.length }
  get root (): any { return this.doc.get(this.rootName) }

  // ── the block-change index (target-only validation) ───────────────────────────────────────────────────────
  private index (tr: any) {
    if (tr.changed.size === 0 && tr.deleteSet.clients.size === 0) return
    const seq = this.hub.log.length + 1 // the update this transaction is about to log
    const mark = (n: any) => { for (let t = n; t; t = t.parent) { const id = t.getAttr?.('id'); if (id != null) this.changedAt.set(id, seq) } }
    for (const [t, subs] of tr.changed as Map<any, Set<string | null>>) {
      mark(t)
      if (subs.has(null)) {
        const id = t.getAttr?.('id'); if (id != null) this.structAt.set(id, seq)
        for (const c of t.toArray()) {
          if (!(c instanceof Y.Node) || !(c as any)._item) continue
          const it = (c as any)._item.id
          if (tr.insertSet.has(it.client, it.clock)) { this.insertedAt.set(c, seq); markDeep(c, id2 => this.changedAt.set(id2, seq)) }
        }
      }
    }
  }

  /** Connect a replica (an editor or an agent's doc); returns the port. */
  connect (replica: Y.Doc, actor: string, awareness?: any) { return this.hub.connect(replica, actor, awareness) }
  flush () { return this.hub.flush() }

  // ── artifact_edit ─────────────────────────────────────────────────────────────────────────────────────────
  /**
   * The atomic batch on an agent's replica. `replaceText: 'match'` validates replace_text by its quote (exact and
   * unique in the current text) rather than by its block's revision (this spike's proposed amendment); 'block' is
   * §4.4 as written.
   */
  edit (agent: { doc: Y.Doc, actor: string }, req: EditRequest, { replaceText = 'match' as 'match' | 'block' } = {}): EditResult {
    const done = this.applied.get(req.toolUseId)
    if (done) return { ...done, replayed: true }
    this.flush() // the agent's replica is in-process: bring it to the host's state first
    const conflicts: NonNullable<Extract<EditResult, { ok: false }>['conflicts']> = []
    const writer = this.writerFor(agent.actor)
    req.ops.forEach((op, i) => {
      for (const t of this.targets(op, replaceText)) {
        const at = Math.max(this.changedAt.get(t.id) ?? 0, t.struct ? (this.structAt.get(t.id) ?? 0) : 0)
        if (at > req.baseRevision) {
          let text = ''
          try { text = writer.md.block(writer.pm(writer.find(this.root, t.id).node)) } catch { text = '(gone)' }
          conflicts.push({ op: i, block: t.id, changedAt: at, text })
        }
      }
    })
    let result: EditResult
    if (conflicts.length) result = { ok: false, revision: this.revision, conflicts }
    else {
      const t0 = performance.now()
      let applied: Applied
      const before = this.revision
      try {
        applied = writer.apply(agent.doc, req.ops, { origin: 'patch-writer', live: req.live ?? new Set() })
      } catch (e) {
        this.batchActor = null
        const ee = e instanceof EditError ? e : new EditError('invalid', (e as Error).message)
        result = { ok: false, revision: this.revision, error: { code: ee.code, message: ee.message, candidates: ee.candidates } }
        this.applied.set(req.toolUseId, result)
        return result
      }
      const ms = performance.now() - t0
      this.batchActor = agent.actor
      try { this.flush() } finally { this.batchActor = null }
      const seq = this.revision
      const updateBytes = this.hub.log.slice(before).filter((e: any) => e.actor === agent.actor).reduce((s: number, e: any) => s + e.v2.length, 0)
      for (const c of applied.carries) this.registerCarry(c, seq, agent.actor)
      this.afterUpdates()
      result = { ok: true, revision: seq, lines: applied.results.map(r => r.line), newIds: applied.results.flatMap(r => r.newIds), orphaned: applied.orphaned, ms, updateBytes }
    }
    this.applied.set(req.toolUseId, result)
    return result
  }

  private targets (op: Op, replaceText: 'match' | 'block'): Array<{ id: string, struct?: boolean }> {
    switch (op.op) {
      case 'replace_text': return op.block != null && replaceText === 'block' ? [{ id: op.block }] : []
      case 'replace_block': case 'delete': return [{ id: op.id }]
      case 'set_cell': {
        // the table's shape (rows) and the addressed cell's content
        const out: Array<{ id: string, struct?: boolean }> = [{ id: op.table, struct: true }]
        try {
          const t = this.writerFor('host').find(this.root, op.table).node
          const row = t.toArray()[op.row]; const cell = row?.toArray()[op.col]
          if (row) out.push({ id: String(row.getAttr('id')), struct: true })
          if (cell) out.push({ id: String(cell.getAttr('id')) })
        } catch { /* the writer reports a missing table */ }
        return out
      }
      default: return [] // insert and move: their anchors only need to exist (the writer checks)
    }
  }

  // ── carries: provenance and the forwarding map ────────────────────────────────────────────────────────────
  registerCarry (c: Carry, seq: number, actor: string) {
    this.carries.push({ ...c, seq, actor })
    this.carrySeqs.add(seq)
    c.from.forEach((s, i) => this.fwd.set(key(s), { to: c.to[i], seq }))
    for (const [o, n] of c.blocks ?? []) this.fwdBlock.set(key(o), { to: n, seq })
    if (c.node) {
      const base = new Map<string, Slot>(); c.from.forEach((s, i) => base.set(key(c.to[i]), s))
      this.copies.set(key(c.node), { blockId: c.blockId, node: c.node, seq, source: c.source ?? null, base })
    }
  }

  /**
   * Where a char lives now for an update logged at `seq`, following forwards registered before it; null if it was
   * not re-inserted by then. (Updates logged before a re-insert were already in the copy it made.)
   */
  resolve (s: Slot, seq = Infinity): Slot | null { // eslint-disable-line
    let cur = this.fwd.get(key(s)); let last: Slot | null = null; let n = 0
    while (cur && cur.seq < seq && n++ < 64) { last = cur.to; cur = this.fwd.get(key(cur.to)) }
    return last
  }

  /** Run after every batch of incoming updates: repair ids (forwarding happens as each update is received). */
  afterUpdates () {
    this.repair()
    this.flush()
  }

  /**
   * Every update a replica sends the host comes through here. Edit forwarding: an update that inserts into or
   * deletes from a block the host knows was re-inserted elsewhere (its sender had not seen the move or the type
   * change yet) is replayed onto the live copy. The update's own bytes are read before it is applied, because the
   * tombstoned block's new content is garbage-collected on arrival.
   */
  receive (update: Uint8Array, origin: any, { forward = true, step2 = false } = {}) {
    const stale = forward && this.fwd.size && origin?.actor !== this.batchActor ? Y.decodeUpdate(update) as any : null
    Y.applyUpdate(this.doc, update, origin)
    if (stale) this.forward(stale, origin?.actor ?? '?', !step2)
  }

  /**
   * Deletions are forwarded only from incremental updates: a sync step 2 (a replica catching up) restates the
   * sender's whole delete set, including the move's own deletion of the old copy, so its deletes are not edits.
   */
  private forward ({ structs, ds }: any, actor: string, deletes: boolean) {
    const ops: Array<() => void> = []
    for (const it of structs) {
      if (!(it instanceof Y.Item) || !(it.content instanceof Y.ContentString)) continue
      const str: string = it.content.str
      const src = it.id
      ops.push(() => {
        if (this.liveAt([src.client, src.clock])) return // it landed in a live block: nothing to forward
        const left = it.origin ? this.resolve([it.origin.client, it.origin.clock]) : null
        const right = !left && it.rightOrigin ? this.resolve([it.rightOrigin.client, it.rightOrigin.clock]) : null
        const pb = !left && !right && it.parent && typeof it.parent !== 'string' ? this.fwdBlock.get(key(it.parent)) : undefined
        if (!left && !right && !pb) return
        const at = left ? this.locate(left) : right ? this.locate(right) : { node: this.nodeOf(pb!.to), index: -1 }
        if (!at || !at.node) { this.report.push(`forward: lost "${str}" from ${actor} (its anchor is gone too)`); return }
        const index = left ? at.index + 1 : right ? at.index : 0
        at.node.insert(index, str, this.formatAt(at.node, index))
        const slots = deepSlotIdsRange(at.node, index, str.length)
        for (let k = 0; k < str.length; k++) this.fwd.set(key([src.client, src.clock + k]), { to: slots[k], seq: 0 })
        this.report.push(`forward: "${str}" from ${actor} into ^${blockIdOf(at.node)}`)
      })
    }
    if (deletes) ds.clients.forEach((ranges: any, client: number) => {
      for (const r of ranges.getIds()) {
        for (let k = 0; k < r.len; k++) {
          const from: Slot = [client, r.clock + k]
          ops.push(() => {
            const to = this.resolve(from); const at = to && this.locate(to)
            if (at) { at.node.delete(at.index, 1); this.report.push(`forward: a deletion from ${actor} in ^${blockIdOf(at.node)}`) }
          })
        }
      }
    })
    if (ops.length) this.doc.transact(() => ops.forEach(f => f()), REPAIR)
  }

  // ── id repair ─────────────────────────────────────────────────────────────────────────────────────────────
  repair (): string[] {
    const lines: string[] = []
    const byId = new Map<string, any[]>()
    const missing: any[] = []
    const walk = (n: any) => {
      for (const c of n.toArray()) {
        if (!(c instanceof Y.Node)) continue
        if (BLOCK_TYPES.includes(c.name)) {
          const id = c.getAttr('id')
          if (id == null) missing.push(c); else (byId.get(id) ?? byId.set(id, []).get(id)!).push(c)
        }
        walk(c)
      }
    }
    walk(this.root)
    const dups = [...byId].filter(([, ns]) => ns.length > 1)
    if (!missing.length && !dups.length) return lines
    this.doc.transact(() => {
      for (const n of missing) { const id = nanoid8(); n.setAttr('id', id); lines.push(`repair: ${n.name} without id → ^${id}`) }
      for (const [id, nodes] of dups) {
        const copies = nodes.filter(n => this.copies.has(key(itemOf(n))))
        let rest = nodes
        if (copies.length >= 2) {
          // concurrent moves of one block: keep the later insertion, carry the others' edits into it, tombstone them
          copies.sort((a, b) => this.copies.get(key(itemOf(a)))!.seq - this.copies.get(key(itemOf(b)))!.seq)
          const winner = copies[copies.length - 1]
          for (const loser of copies.slice(0, -1)) {
            const moved = this.carryCopyEdits(loser, winner)
            const p = loser.parent; const i = p.toArray().indexOf(loser)
            p.delete(i, 1)
            lines.push(`repair: ^${id} duplicated by concurrent moves → kept the later copy (seq ${this.copies.get(key(itemOf(winner)))!.seq}), tombstoned the copy of seq ${this.copies.get(key(itemOf(loser)))!.seq}${moved ? `, carried ${moved} edit(s) into the kept copy` : ''}`)
          }
          rest = nodes.filter(n => !copies.includes(n) || n === winner)
        }
        if (rest.length > 1) {
          // any other duplicate (a concurrent split, a writer that copied an id): the earliest keeps it
          rest.sort((a, b) => (this.insertedAt.get(a) ?? 0) - (this.insertedAt.get(b) ?? 0))
          for (const n of rest.slice(1)) { const nid = nanoid8(); n.setAttr('id', nid); lines.push(`repair: ^${id} duplicated (${n.name}) → the later one re-id'd ^${nid}`) }
        }
      }
    }, REPAIR)
    this.report.push(...lines)
    return lines
  }

  /**
   * Before a losing copy is tombstoned: walk it, and for every char that is not one it was created with (an edit
   * made in it after the move) insert it into the winner after the winner's counterpart of its left neighbour;
   * creation chars that are gone are deleted from the winner. Returns the number of runs carried.
   */
  private carryCopyEdits (loser: any, winner: any): number {
    const recL = this.copies.get(key(itemOf(loser)))!; const recW = this.copies.get(key(itemOf(winner)))!
    const srcToW = new Map<string, Slot>(); for (const [w, s] of recW.base) srcToW.set(key(s), parseKey(w))
    const visible = new Set(deepSlotIds(loser).map(key))
    let runs = 0
    const tbL = textblocksOf(loser); const tbW = textblocksOf(winner)
    tbL.forEach((tb, b) => {
      let anchor: { node: any, index: number } = { node: tbW[b], index: -1 }
      const cells = cellSlots(tb)
      let pending = ''; let pendingFrom: Slot | null = null
      const flushPending = () => {
        if (!pending || !anchor.node) { pending = ''; return }
        anchor.node.insert(anchor.index + 1, pending, this.formatAt(anchor.node, anchor.index + 1))
        const slots = deepSlotIdsRange(anchor.node, anchor.index + 1, pending.length)
        for (let k = 0; k < pending.length; k++) this.fwd.set(key([pendingFrom![0], pendingFrom![1] + k]), { to: slots[k], seq: 0 })
        anchor = { node: anchor.node, index: anchor.index + pending.length }
        runs++; pending = ''
      }
      for (const { slot, ch } of cells) {
        const src = recL.base.get(key(slot))
        const w = src ? srcToW.get(key(src)) : undefined
        if (w) { flushPending(); const at = this.locate(w); if (at) anchor = at; this.fwd.set(key(slot), { to: w, seq: 0 }) } else { if (!pending) pendingFrom = slot; pending += ch }
      }
      flushPending()
    })
    // creation chars deleted in the loser: delete them from the winner too
    for (const [l, s] of recL.base) {
      if (visible.has(l)) continue
      const w = srcToW.get(key(s)); const at = w && this.locate(w)
      if (at) { at.node.delete(at.index, 1); runs++ }
    }
    return runs
  }

  // ── small Yjs helpers (internals: the struct store) ───────────────────────────────────────────────────────
  private itemAt (s: Slot): any {
    const structs = (this.doc.store as any).clients.get(s[0]); if (!structs) return null
    const i = Y.findIndexSS(structs, s[1]); return structs[i] ?? null
  }

  liveAt (s: Slot): boolean { const it = this.itemAt(s); return !!it && it instanceof Y.Item && !it.deleted && s[1] < it.id.clock + it.length }

  /** The node holding a char and the char's index in it; null if the char is deleted. */
  locate (s: Slot): { node: any, index: number } | null {
    const it = this.itemAt(s)
    if (!it || !(it instanceof Y.Item) || it.deleted) return null
    let index = 0
    for (let p = (it.parent as any)._start; p && p !== it; p = p.right) if (!p.deleted && p.countable) index += p.length
    return { node: it.parent, index: index + (s[1] - it.id.clock) }
  }

  private nodeOf (s: Slot): any { const it = this.itemAt(s); return it && !it.deleted ? it.content.type : null }

  /** The formats of the char left of `index` minus comments (typing at a comment's edge does not extend it). */
  private formatAt (node: any, index: number): Record<string, any> {
    if (index <= 0) return {}
    let pos = 0
    for (const op of node.toDelta().children) {
      const len = typeof op.insert === 'string' ? op.insert.length : op.insert.length
      if (pos + len >= index) { const f = { ...(op.format ?? {}) }; for (const k of Object.keys(f)) if (k.startsWith('comment')) delete f[k]; return f }
      pos += len
    }
    return {}
  }
}

// ── module helpers ─────────────────────────────────────────────────────────────────────────────────────────────
const itemOf = (n: any): Slot => [n._item.id.client, n._item.id.clock]
const parseKey = (k: string): Slot => { const [a, b] = k.split(':'); return [Number(a), Number(b)] }
const markDeep = (n: any, f: (id: string) => void) => { const id = n.getAttr?.('id'); if (id != null) f(id); for (const c of n.toArray()) if (c instanceof Y.Node) markDeep(c, f) }
export const blockIdOf = (n: any): string => { let top = n; while (top.parent && top.parent.parent) top = top.parent; return String(top.getAttr?.('id')) }
const textblocksOf = (n: any): any[] => {
  const out: any[] = []
  const walk = (x: any) => { const kids = x.toArray().filter((c: any) => c instanceof Y.Node); if (!kids.length || ['paragraph', 'heading', 'codeBlock'].includes(x.name)) { out.push(x); return } kids.forEach(walk) }
  walk(n)
  return out
}
/** Visible text chars of a textblock with their ids. */
const cellSlots = (tb: any): Array<{ slot: Slot, ch: string }> => {
  const out: Array<{ slot: Slot, ch: string }> = []
  for (let it = tb._start; it; it = it.right) {
    if (it.deleted || !it.countable) continue
    if (it.content instanceof Y.ContentString) for (let k = 0; k < it.content.str.length; k++) out.push({ slot: [it.id.client, it.id.clock + k], ch: it.content.str[k] })
  }
  return out
}
const deepSlotIdsRange = (node: any, index: number, len: number): Slot[] => deepSlotIds(node).slice(index, index + len) as Slot[]

/** Resolve the human's caret (awareness `cursor.anchor`, a relative position) to its top-level block id. */
export const liveBlocks = (doc: Y.Doc, states: Map<number, any>): Set<string> => {
  const out = new Set<string>()
  for (const st of states.values()) {
    const rel = st?.cursor?.anchor ?? st?.cursor?.head
    if (!rel) continue
    try {
      const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(rel), doc) as any
      if (abs?.type) out.add(blockIdOf(abs.type))
    } catch { /* stale cursor */ }
  }
  return out
}
