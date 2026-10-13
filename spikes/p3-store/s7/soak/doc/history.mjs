// COPY of spikes/p3-store/s3/lib/history.mjs at 4ab6b9b7 for S7a (edited as s7/soak/copy-sources.mjs describes).
// S3 (P3-0): the history renderer module — any two stored full V2 states rendered by v14's DiffRenderer with
// attributions from provenance, the change list behind "N changes" and ↑ ↓, and "Show editors" for a selection
// answered from provenance over the live doc. Pure functions over Y and ProseMirror; no DOM.
// Throwaway spike code (copy target for P3-B; the provenance side is P3-A's).
import * as Y from '@y/y'
import { ynodeToPmnode } from '@y/prosemirror'
import { attrsOf } from './provenance.mjs'

/**
 * Load two version states into throwaway gc-off docs and build the renderer. `pick(doc)` returns the fragment to
 * show (the tab's body). The caller destroys both docs when the preview closes.
 */
export const openDiff = ({ prevState, nextState, attributions, pick }) => {
  const prevDoc = new Y.Doc({ gc: false }); Y.applyUpdateV2(prevDoc, prevState)
  const nextDoc = new Y.Doc({ gc: false }); Y.applyUpdateV2(nextDoc, nextState)
  const renderer = Y.createDiffRenderer(prevDoc, nextDoc, { attributions })
  return { prevDoc, nextDoc, renderer, ytype: pick(nextDoc), destroy: () => { renderer.destroy(); prevDoc.destroy(); nextDoc.destroy() } }
}

/** Headless render of a diff (what the agent or a test reads). */
export const renderDiff = (diff, schema, attributedNodes) => ynodeToPmnode(diff.ytype, schema, { renderer: diff.renderer, attributedNodes })

const iso = t => (t ? new Date(t).toISOString().slice(11, 19) : undefined)
/** The attribution marks of one PM node, read as {kind, who, at, attr?}. */
export const readMarks = node => {
  const out = []
  for (const m of node.marks ?? []) {
    const t = m.type?.name ?? m.type
    if (t === 'y-attributed-insert') out.push({ kind: 'ins', who: m.attrs?.userIds?.[0], at: m.attrs?.timestamp })
    else if (t === 'y-attributed-delete') out.push({ kind: 'del', who: m.attrs?.userIds?.[0], at: m.attrs?.timestamp })
    else if (t === 'y-attributed-format') out.push({ kind: 'fmt', who: m.attrs?.userIds?.[0], at: m.attrs?.timestamp, byAttr: m.attrs?.userIdsByAttr })
    else if (t === 'y-attributed-attrs') for (const [attr, c] of Object.entries(m.attrs?.changes ?? {})) out.push({ kind: 'attrs', attr, who: c?.userIds?.[0], at: c?.timestamp })
  }
  return out
}

/**
 * Every attributed run of a rendered PM doc: text runs, whole nodes inserted or deleted, and node attribute changes
 * (a point at the node's start). `where` is the nearest block's `type#id`.
 */
export const attributedRuns = pmDoc => {
  const runs = []
  pmDoc.descendants((node, pos, parent) => {
    const where = node.isText ? `${parent.type.name}#${parent.attrs?.id ?? '?'}` : `${node.type.name}#${node.attrs?.id ?? '?'}`
    for (const r of readMarks(node)) {
      const point = r.kind === 'attrs'
      runs.push({ ...r, from: pos, to: point ? pos + 1 : pos + node.nodeSize, where, text: node.isText ? node.text : node.textContent, node: !node.isText })
    }
  })
  return runs.sort((a, b) => a.from - b.from || b.to - a.to)
}

/**
 * Group runs into changes ("N changes"): runs that overlap or touch form one change (a replace is one change, a
 * new block with its text is one change). Each change keeps its authors and latest time.
 */
export const changeList = pmDoc => {
  const changes = []
  for (const r of attributedRuns(pmDoc)) {
    const last = changes[changes.length - 1]
    if (last && r.from <= last.to) {
      last.to = Math.max(last.to, r.to); last.kinds.add(r.kind); last.who.add(r.who); last.at = Math.max(last.at ?? 0, r.at ?? 0); last.runs++
    } else {
      changes.push({ from: r.from, to: r.to, kinds: new Set([r.kind]), who: new Set([r.who]), at: r.at, where: r.where, runs: 1 })
    }
  }
  return changes.map(c => ({ ...c, kinds: [...c.kinds], who: [...c.who] }))
}

/** ↓ and ↑: the change after / before `pos`, wrapping (Google's "Total: N edits" stepper). */
export const nextChange = (changes, pos) => changes.find(c => c.from > pos) ?? changes[0] ?? null
export const prevChange = (changes, pos) => [...changes].reverse().find(c => c.from < pos) ?? changes[changes.length - 1] ?? null

/** id → YNode for every block under `root` (the host keeps ids unique, §4.4). */
export const indexById = root => {
  const m = new Map()
  const walk = n => { for (const c of n.toArray()) if (c instanceof Y.Node) { const id = c.getAttr('id'); if (id != null) m.set(id, c); walk(c) } }
  walk(root)
  return m
}

/**
 * "Show editors" for a PM selection [from, to) of the live editor: who inserted the visible content in range, who
 * formatted it, who deleted content inside it, who last set the block's attributes — each with their latest time —
 * from provenance alone (so it is the same before and after a compaction). Maps PM to Y through block ids.
 */
export const showEditors = ({ pmDoc, from, to, liveRoot, provenance }) => {
  const byId = indexById(liveRoot)
  const hits = []
  const add = (attrs, kind) => {
    const a = attrsOf(attrs)
    if (kind === 'del' ? a.delete : a.insert) hits.push({ who: kind === 'del' ? a.delete : a.insert, at: kind === 'del' ? a.deleteAt : a.insertAt, kind })
  }
  pmDoc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    const yn = byId.get(node.attrs.id)
    if (!yn) return false
    const a = Math.max(from, pos + 1) - (pos + 1)
    const b = Math.min(to, pos + 1 + node.content.size) - (pos + 1)
    let idx = 0
    for (let it = yn._start; it !== null; it = it.right) {
      const visible = it.countable && !it.deleted ? it.length : 0
      const start = idx; const end = idx + visible
      if (it.deleted) {
        if (start > a && start < b) for (const r of provenance.deletes.slice(it.id.client, it.id.clock, it.length)) add(r.attrs, 'del')
      } else if (!it.countable) {
        if (start >= a && start <= b) for (const r of provenance.inserts.slice(it.id.client, it.id.clock, it.length)) add(r.attrs, 'fmt')
      } else if (end > a && start < b) {
        const s = Math.max(a, start) - start; const e = Math.min(b, end) - start
        for (const r of provenance.inserts.slice(it.id.client, it.id.clock + s, e - s)) add(r.attrs, 'ins')
      }
      idx = end
    }
    for (const [key, it] of yn._map) if (!it.deleted && key !== 'id') for (const r of provenance.inserts.slice(it.id.client, it.id.clock, it.length)) add(r.attrs, 'attrs:' + key)
    return false
  })
  const byWho = new Map()
  for (const h of hits) {
    const e = byWho.get(h.who) ?? { who: h.who, at: 0, kinds: new Set() }
    e.at = Math.max(e.at, h.at ?? 0); e.kinds.add(h.kind); byWho.set(h.who, e)
  }
  return [...byWho.values()].map(e => ({ who: e.who, at: iso(e.at), atMs: e.at /* S7a edit */, kinds: [...e.kinds].sort() })).sort((x, y) => (x.at < y.at ? 1 : -1))
}
