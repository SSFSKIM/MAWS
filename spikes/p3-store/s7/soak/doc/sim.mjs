// S7a (P3-0): months of simulated use of the 200-page document against the retained store (../store.mjs), with a fake
// clock. One host Y.Doc (gc on); every edit is one transaction under the writer's clientID (a human editor replica per
// session, one replica per agent session, a scratch client per restore), so each update and its provenance land in the
// store exactly as S2's host logs a replica's update. Replicas and sync are not simulated (S2 proved them); storage
// depends only on the updates. Throwaway spike code.
import * as Y from '@y/y'
import { pmnodeToDelta, ynodeToPmnode } from '@y/prosemirror'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { schemaFor, attributedNodes } from './schema.mjs'
import { rng, sentence, words, word, sectionBlocks, bigDocJSON, countText } from './corpus.mjs'
import { openDiff, renderDiff, changeList, showEditors } from './history.mjs'
import { revertUpdateFixed as revertUpdate } from '../revert.mjs' // S3's revertUpdate with the soak's two fixes (see revert.mjs)
import { Store, MIN, HOUR, DAY } from '../store.mjs'

export const PROFILES = {
  // a writer who drafts with an agent: ~3k keystrokes (~450 words net) and 12 agent turns a day
  normal: { sessions: [[9.5, 1500], [14, 1500]], turns: 12, batches: [1, 2], ops: [1, 4], comments: 1, resolves: 0.8, named: [5], restoreEvery: 30, images: 1, dsEvery: 21, agentSessions: 3 },
  // all day in the document: ~10k keystrokes, 40 agent turns with larger batches and section rewrites
  heavy: { sessions: [[9, 2500], [11, 2500], [14, 2500], [16.5, 2500]], turns: 40, batches: [1, 3], ops: [1, 6], comments: 4, resolves: 3.5, named: [1, 3, 5], restoreEvery: 14, images: 3, dsEvery: 14, agentSessions: 8, rewriteSections: 0.12 },
  // the heavy profile with a writer that replaces whole sentences once most of their words change (the tombstone mitigation)
  get heavySentence () { return { ...this.heavy, rewriteMode: 'sentence' } }
}
const AGENT_MIX = [['replace_text', 0.42], ['rewrite_block', 0.15], ['set_cell', 0.10], ['insert_section', 0.07], ['delete_section', 0.07], ['move', 0.04], ['add_row', 0.03], ['insert_paragraph', 0.06], ['resolve', 0.055]]
const START = Date.UTC(2026, 3, 6) // Monday 2026-04-06, 00:00
const ISO = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ')
const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 12)
// canonical JSON (sorted keys): a loaded doc may list a node's attributes in another order than the live doc
const canon = v => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v)
const view = (d, schema) => JSON.stringify(canon({ body: ynodeToPmnode(d.get('tabs').getAttr('t1').getAttr('body'), schema).toJSON(), threads: d.get('threads').toJSON() }))
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

export async function runDoc ({ profile = 'normal', months = 6, encoding = 'delta', policy = {}, dbDir = '/tmp/p3-s7a', sections = 310, seed = 7, log = console.log, truth = true, suffix = null }) {
  const P = PROFILES[profile]
  const r = rng(seed)
  const pick = a => a[Math.floor(r() * a.length)]
  const between = ([a, b]) => a + Math.floor(r() * (b - a + 1))
  const schema = schemaFor({ uniqueId: false })
  const tag = `doc-${profile}-${encoding}${suffix ? "-" + suffix : ""}`
  const store = new Store(`${dbDir}/${tag}.sqlite`, { encoding, ...policy }, { truthPath: truth ? `${dbDir}/${tag}.truth.sqlite` : null })

  // ── the doc and the writer seam ──
  const doc = new Y.Doc({ gc: true })
  let now = START + 8 * HOUR
  let actor = 'import'
  let nextClient = 1000
  const setActor = (a, client) => { actor = a; doc.clientID = client }
  doc.on('update', u => store.land(u, actor, now))
  const tx = fn => doc.transact(fn)
  const toDelta = json => pmnodeToDelta(schema.nodeFromJSON(json))

  const { json, threads: seedThreads } = bigDocJSON(sections, 42)
  const initial = countText(json)
  setActor('import', nextClient++)
  tx(() => {
    const tab = new Y.Node('tab'); doc.get('tabs').setAttr('t1', tab)
    tab.setAttr('title', 'Main'); tab.setAttr('order', 'a0')
    const body = new Y.Node('doc'); tab.setAttr('body', body)
    body.applyDelta(pmnodeToDelta(schema.nodeFromJSON(json)))
    const th = doc.get('threads')
    for (const t of seedThreads) { const n = new Y.Node('thread'); th.setAttr(t.id, n); n.setAttr('quote', t.quote); n.setAttr('resolved', false); n.setAttr('author', 'human') }
  })
  const body = doc.get('tabs').getAttr('t1').getAttr('body')
  const threadsRoot = doc.get('threads')

  // ── indexes the simulator keeps (never read by the store) ──
  let top = []
  const refresh = () => { top = body.toArray().filter(n => n instanceof Y.Node) }
  refresh()
  const idOf = n => n.getAttr('id')
  const isPara = n => n.name === 'paragraph' && !n._item?.deleted
  const plain = p => { let s = ''; for (const op of p.toDelta().children) s += typeof op.insert === 'string' ? op.insert : '￼'.repeat(op.insert?.length ?? 1); return s }
  const commentKeyCache = new Map()
  const commentKey = th => {
    let k = commentKeyCache.get(th)
    if (!k) {
      const d = pmnodeToDelta(schema.nodeFromJSON({ type: 'paragraph', attrs: { id: 'x' }, content: [{ type: 'text', text: 'x', marks: [{ type: 'comment', attrs: { threadId: th, orphan: false } }] }] }))
      k = Object.keys(d.toJSON().children[0].format)[0]; commentKeyCache.set(th, k)
    }
    return k
  }
  const openThreads = new Map() // threadId → paragraph YNode (or null when unknown)
  for (const t of seedThreads) openThreads.set(t.id, top.find(n => idOf(n) === t.id.replace('th-', '') + 'p2') ?? null)
  const assetsByBlock = new Map() // top-level image paragraph id → asset id
  for (const n of top) if (/img$/.test(idOf(n) ?? '')) { const a = 'img-' + idOf(n).slice(0, -3); assetsByBlock.set(idOf(n), a); store.addAsset(a, 50_000 + Math.floor(r() * 450_000)) }
  const liveAssets = () => { const ids = new Set(top.map(idOf)); return [...assetsByBlock].filter(([b]) => ids.has(b)).map(([, a]) => a) }
  let dsRev = 1; let dsRef = 'ds-default@1'; store.addDs(dsRef, 40_000)
  const touched = new Map() // top-level block id → {actor, at, first}
  const touch = (n, who) => { const id = idOf(n); if (!id) return; const t = touched.get(id); touched.set(id, { actor: who, at: now, first: t?.first ?? now }) }
  let idn = 0
  const newId = p => `${p}${(idn++).toString(36)}`

  // ── versions (§4.7 triggers) ──
  let lastVersionAt = now; let lastVersionSeq = 0; let lastHumanAt = 0; let humanDirty = false
  const hashes = new Map() // seq → content hash, recorded for each day's last version
  const contentHash = () => sha(view(doc, schema))
  const version = (kind, at, by, label) => {
    const v = store.version(doc, { at, actor: by, kind, label, dsRef, assetRefs: liveAssets() })
    if (v) { lastVersionAt = at; lastVersionSeq = v.seq; humanDirty = false }
    return v
  }
  version('import', now, 'import')
  const dirty = () => store.seq > lastVersionSeq
  const advance = t => {
    if (humanDirty && lastHumanAt + 2 * MIN <= t) { const at = lastHumanAt + 2 * MIN; const save = now; now = at; version('auto', at, 'human'); now = save }
    if (dirty() && t - lastVersionAt >= 10 * MIN) { now = t; version('auto', t, actor) }
    now = t
  }

  // ── the human ──
  let hot = Math.floor(r() * top.length)
  const paraNear = () => {
    for (let k = 0; k < 50; k++) {
      const i = r() < 0.6 ? Math.max(0, Math.min(top.length - 1, hot + Math.floor((r() - 0.5) * 80))) : Math.floor(r() * top.length)
      if (isPara(top[i]) && top[i].length > 0 && !/img$/.test(idOf(top[i]))) return top[i]
    }
    return top.find(n => isPara(n) && n.length > 0)
  }
  let stream = ''
  const nextChar = () => { if (!stream.length) stream = ' ' + sentence(r); const c = stream[0]; stream = stream.slice(1); return c }
  const split = (p, at) => {
    const i = top.indexOf(p); if (i < 0 || at <= 0 || at >= p.length) return null
    const pm = ynodeToPmnode(p, schema)
    const tail = schema.nodes.paragraph.create({ id: newId('n') }, pm.content.cut(at))
    tx(() => { p.delete(at, p.length - at); body.insert(i + 1, [pmnodeToDelta(tail)]) })
    refresh()
    return top[i + 1]
  }
  const humanBurst = (t0, n) => {
    let p = paraNear(); let cur = r() < 0.5 ? p.length : Math.max(0, plain(p).lastIndexOf(' ', Math.floor(r() * p.length)))
    let t = t0
    for (let k = 0; k < n; k++) {
      t += 120 + Math.floor(r() * 200)
      advance(t)
      if (p._item?.deleted || p.length < cur) { p = paraNear(); cur = p.length }
      const x = r()
      if (x < 0.07 && cur > 0) tx(() => p.delete(--cur, 1))
      else if (x < 0.074 && cur > 0 && cur < p.length) { const q = split(p, cur); if (q) { p = q; cur = 0 } }
      else if (x < 0.077 && cur > 6) { const len = Math.min(cur, 3 + Math.floor(r() * 12)); tx(() => p.delete(cur - len, len)); cur -= len }
      else if (x < 0.079 && cur > 6) { tx(() => p.format(cur - 5, 4, { bold: {} })) }
      else tx(() => p.insert(cur++, nextChar()))
      touch(p, 'human'); lastHumanAt = now; humanDirty = true
    }
    return t
  }
  const humanSession = (startAt, keys) => {
    setActor('human', nextClient++)
    let t = startAt; let left = keys
    while (left > 0) {
      const n = Math.min(left, 60 + Math.floor(r() * 190)); left -= n
      t = humanBurst(t, n)
      t += r() < 0.3 ? (150 + Math.floor(r() * 330)) * 1000 : (3 + Math.floor(r() * 57)) * 1000
    }
    return t
  }
  const addComment = () => {
    const p = paraNear(); const s = plain(p); const a = s.indexOf(' ', Math.floor(r() * Math.max(1, s.length - 30))) + 1
    if (a <= 0 || a + 20 > s.length) return
    const len = 8 + Math.floor(r() * 12); const th = newId('c')
    tx(() => {
      p.format(a, len, { [commentKey(th)]: { threadId: th, orphan: false } })
      const n = new Y.Node('thread'); threadsRoot.setAttr(th, n); n.setAttr('quote', s.slice(a, a + len)); n.setAttr('resolved', false); n.setAttr('author', actor)
    })
    openThreads.set(th, p); touch(p, actor)
  }
  const resolve = () => {
    if (!openThreads.size) return
    const th = pick([...openThreads.keys()]); const p = openThreads.get(th); openThreads.delete(th)
    tx(() => {
      threadsRoot.getAttr(th)?.setAttr('resolved', true)
      if (p && !p._item?.deleted) {
        const key = commentKey(th); let off = 0
        for (const op of p.toDelta().children) { const len = typeof op.insert === 'string' ? op.insert.length : (op.insert?.length ?? 1); if (op.format?.[key]) p.format(off, len, { [key]: null }); off += len }
      }
    })
  }
  const addImage = () => {
    const p = paraNear(); const i = top.indexOf(p); const id = newId('m') + 'img'; const asset = 'img-' + id
    store.addAsset(asset, 50_000 + Math.floor(r() * 450_000))
    tx(() => body.insert(i + 1, [toDelta({ type: 'paragraph', attrs: { id }, content: [{ type: 'text', text: 'Figure: ' }, { type: 'image', attrs: { src: `asset://${asset}.png`, alt: words(r, 3), assetId: asset } }] })]))
    assetsByBlock.set(id, asset); refresh()
  }

  // ── the agent: one artifact_edit batch = one transaction of word-level hunks and block ops ──
  const wordSpans = s => { const out = []; const re = /[^\s￼]+/g; let m; while ((m = re.exec(s))) out.push([m.index, m[0].length]); return out }
  const rewriteWords = (p, frac, from = 0, to = Infinity) => {
    if (P.rewriteMode === 'sentence' && frac >= 0.5) {
      // a writer that replaces a sentence as one run once most of its words change (one delete + one insert per sentence)
      const s = plain(p); const sents = []; const re = /[^.￼]+\.?/g; let m
      while ((m = re.exec(s))) if (m[0].trim().length > 3) sents.push([m.index, m[0].length, m[0]])
      for (let k = sents.length - 1; k >= 0; k--) {
        const [a, len, text] = sents[k]
        const next = text.split(' ').map(x => (x && r() < frac ? word(r) : x)).join(' ')
        p.delete(a, len); p.insert(a, next)
      }
      return
    }
    const spans = wordSpans(plain(p)).slice(from, to)
    for (let k = spans.length - 1; k >= 0; k--) {
      if (r() >= frac) continue
      const [a, len] = spans[k]; p.delete(a, len); p.insert(a, word(r))
    }
  }
  const randomPara = () => { for (let k = 0; k < 50; k++) { const n = pick(top); if (isPara(n) && n.length > 30 && !/img$/.test(idOf(n))) return n } return paraNear() }
  const h2Indexes = () => top.map((n, i) => (n.name === 'heading' && n.getAttr('level') === 2 ? i : -1)).filter(i => i >= 0)
  const sectionEnd = i => { let j = i + 1; while (j < top.length && !(top[j].name === 'heading' && top[j].getAttr('level') === 2)) j++; return j }
  let sectionN = 0
  const agentOp = (op, who) => {
    switch (op) {
      case 'replace_text': { const p = randomPara(); const n = wordSpans(plain(p)).length; const a = Math.floor(r() * Math.max(1, n - 15)); rewriteWords(p, 0.4, a, a + 8 + Math.floor(r() * 12)); touch(p, who); break }
      case 'rewrite_block': { const p = randomPara(); rewriteWords(p, 0.7); touch(p, who); break }
      case 'set_cell': {
        const tables = top.filter(n => n.name === 'table'); if (!tables.length) break
        const rows = pick(tables).toArray().filter(n => n instanceof Y.Node); const row = pick(rows.slice(1).length ? rows.slice(1) : rows)
        const cell = pick(row.toArray().filter(n => n instanceof Y.Node)); const cp = cell.toArray().find(n => n instanceof Y.Node)
        if (cp) { cp.delete(0, cp.length); cp.insert(0, String(Math.floor(r() * 100000))) }
        break
      }
      case 'add_row': {
        const tables = top.filter(n => n.name === 'table'); if (!tables.length) break
        const t = pick(tables); const rid = newId('r')
        t.insert(t.length, [toDelta({ type: 'tableRow', attrs: { id: rid }, content: [0, 1, 2].map(c => ({ type: 'tableCell', attrs: { id: `${rid}c${c}` }, content: [{ type: 'paragraph', attrs: { id: `${rid}c${c}p` }, content: [{ type: 'text', text: words(r, 2) }] }] })) })])
        break
      }
      case 'insert_section': {
        const hs = h2Indexes(); const at = sectionEnd(pick(hs))
        const { blocks } = sectionBlocks(r, newId('a'), sectionN++, { comments: false })
        body.insert(at, blocks.map(toDelta)); refresh(); for (let k = at; k < at + blocks.length; k++) touch(top[k], who)
        break
      }
      case 'delete_section': {
        const hs = h2Indexes(); if (hs.length < 10) break
        const i = pick(hs.slice(1)); const j = sectionEnd(i)
        body.delete(i, j - i); refresh(); break
      }
      case 'move': {
        const p = randomPara(); const i = top.indexOf(p); const pm = ynodeToPmnode(p, schema)
        let j = Math.max(0, Math.min(top.length - 1, i + Math.floor((r() - 0.5) * 40))); if (j > i) j--
        body.delete(i, 1); body.insert(j, [pmnodeToDelta(pm)]); refresh(); touch(top[j], who); break
      }
      case 'insert_paragraph': { const p = randomPara(); const i = top.indexOf(p); body.insert(i + 1, [toDelta({ type: 'paragraph', attrs: { id: newId('q') }, content: [{ type: 'text', text: sentence(r) + ' ' + sentence(r) }] })]); refresh(); touch(top[i + 1], who); break }
      case 'rewrite_section': { const hs = h2Indexes(); const i = pick(hs); const j = sectionEnd(i); for (let k = i + 1; k < j; k++) if (isPara(top[k]) && top[k].length > 0) { rewriteWords(top[k], 0.8); touch(top[k], who) } break }
      case 'resolve': resolve(); break
    }
  }
  const drawOp = () => { let x = r() * AGENT_MIX.reduce((s, [, w]) => s + w, 0); for (const [op, w] of AGENT_MIX) { if ((x -= w) < 0) return op } return 'replace_text' }
  const agentTurn = (t, session) => {
    setActor(session.actor, session.client)
    const nb = between(P.batches)
    for (let b = 0; b < nb; b++) {
      t += (10 + Math.floor(r() * 50)) * 1000; advance(t)
      const nops = between(P.ops)
      tx(() => { for (let k = 0; k < nops; k++) agentOp(P.rewriteSections && r() < P.rewriteSections ? 'rewrite_section' : drawOp(), session.actor) })
      refresh()
    }
    version('turn', now, session.actor)
    return t
  }

  // ── restore (§4.2, S3's revert): an auto version before, the revert as the restorer's update, a restore version after ──
  const restores = []
  const restoreFrom = (ageMs) => {
    const rows = store.versions().filter(v => v.at <= now - ageMs)
    if (!rows.length) return
    const target = rows[rows.length - 1]
    version('auto', now, 'human')
    const t0 = performance.now()
    const { state } = store.stateAt(target.seq)
    const R = revertUpdate(state, Y.encodeStateAsUpdateV2(doc))
    const ms = performance.now() - t0
    setActor('human:restore', nextClient++)
    Y.applyUpdateV2(doc, R)
    refresh()
    for (const [th] of openThreads) openThreads.set(th, null)
    for (const [th, n] of Object.entries(threadsRoot.getAttrs())) if (n instanceof Y.Node && !n.getAttr('resolved') && !openThreads.has(th)) openThreads.set(th, null)
    version('restore', now, 'human', `Restored from ${ISO(target.at)}`)
    restores.push({ at: ISO(now), from: ISO(target.at), ms: +ms.toFixed(1), bytes: R.length })
  }

  // ── measurements at month boundaries ──
  const months_ = []
  const maint = []
  const measure = (m) => {
    const out = { month: m, at: ISO(now), seq: store.seq }
    const t0 = performance.now()
    const live = Y.encodeStateAsUpdateV2(doc)
    out.live = { v2: live.length, v1: Y.encodeStateAsUpdate(doc).length }
    { const d = new Y.Doc(); Y.applyUpdateV2(d, live); out.live.reencoded = Y.encodeStateAsUpdateV2(d).length; d.destroy() }
    {
      const pm = ynodeToPmnode(body, schema); const d = new Y.Doc()
      d.transact(() => { const tab = new Y.Node('tab'); d.get('tabs').setAttr('t1', tab); const b = new Y.Node('doc'); tab.setAttr('body', b); b.applyDelta(pmnodeToDelta(pm))
        // threads copied as plain values: `toDelta()` hands out the live doc's own YNodes, and applying them to another doc
        // re-parents them there (the live doc then fails on its next write to them; pitfall)
        const th = d.get('threads')
        for (const [id, n] of Object.entries(threadsRoot.getAttrs())) { if (!(n instanceof Y.Node)) continue; const c = new Y.Node('thread'); th.setAttr(id, c); for (const [k, v] of Object.entries(n.getAttrs())) c.setAttr(k, v) }
      })
      out.live.freshImport = Y.encodeStateAsUpdateV2(d).length; out.text = countText(pm.toJSON()); d.destroy()
    }
    let structs = 0; doc.store.clients.forEach(s => { structs += s.length }); out.live.structs = structs; out.live.clients = doc.store.clients.size
    out.sizes = store.sizes()
    const loads = []; let tail = 0
    for (let k = 0; k < 5; k++) { const t = performance.now(); const l = store.load(); loads.push(performance.now() - t); tail = l.tailRows; l.doc.destroy() }
    out.load = { ms: +median(loads).toFixed(1), tailRows: tail }
    const vs = store.versions()
    // the history preview and the restore against the retained version nearest to 90 days ago (once there is one)
    const target = [...vs].reverse().find(v => v.at <= now - 90 * DAY) ?? (m >= 1 ? vs[0] : null)
    if (target) {
      const ph = {}; const tt = (k, fn) => { const t = performance.now(); const x = fn(); ph[k] = +(performance.now() - t).toFixed(1); return x }
      const { state: prevState, chain } = tt('state', () => store.stateAt(target.seq))
      const nextState = tt('encodeLive', () => Y.encodeStateAsUpdateV2(doc))
      const attrs = tt('attributions', () => store.attributions(target.seq))
      const diff = tt('openDiff', () => openDiff({ prevState, nextState, attributions: attrs.map, pick: d => d.get('tabs').getAttr('t1').getAttr('body') }))
      const pm = tt('render', () => renderDiff(diff, schema, attributedNodes))
      const changes = tt('changeList', () => changeList(pm))
      diff.destroy()
      ph.total = +Object.values(ph).reduce((s, x) => s + x, 0).toFixed(1)
      out.preview = { versionAt: ISO(target.at), kind: target.kind, enc: target.enc, chain, provenanceRows: attrs.rows, changes: changes.length, ms: ph }
      const t1 = performance.now(); const R = revertUpdate(prevState, nextState); const rms = performance.now() - t1
      out.restore = { ms: +rms.toFixed(1), bytes: R.length }
      if (m === months) {
        // correctness: the restored artifact equals the version (body and threads), and the reconstructed version state matches the hash recorded the day it was taken
        const d = new Y.Doc(); Y.applyUpdateV2(d, nextState); Y.applyUpdateV2(d, R)
        const old = new Y.Doc(); Y.applyUpdateV2(old, prevState)
        const j = x => view(x, schema)
        out.restore.equalsVersion = j(d) === j(old)
        d.destroy(); old.destroy()
      }
    }
    // reconstructed retained versions equal the content hash recorded when they were taken
    const checkable = vs.filter(v => hashes.has(v.seq))
    const sample = checkable.filter((_, i) => i % Math.max(1, Math.floor(checkable.length / 6)) === 0).slice(0, 8)
    let ok = 0
    for (const v of sample) { const d = new Y.Doc(); Y.applyUpdateV2(d, store.stateAt(v.seq).state); const b = d.get('tabs').getAttr('t1').getAttr('body'); if (sha(view(d, schema)) === hashes.get(v.seq)) ok++; d.destroy() }
    out.versionCheck = `${ok}/${sample.length}`
    out.versions = { count: vs.length, byKind: out.sizes.kinds }
    if (truth && (m === 1 || m === 3 || m === months)) out.showEditors = checkShowEditors()
    out.measureMs = Math.round(performance.now() - t0)
    months_.push(out)
    log(`month ${m}: ${JSON.stringify({ live: out.live.v2, file: out.sizes.file, versions: vs.length, log: out.sizes.tables.log, prov: out.sizes.tables.provenance, load: out.load.ms, preview: out.preview?.ms.total, restore: out.restore?.ms, se: out.showEditors?.summary })}`)
  }
  const checkShowEditors = () => {
    const ids = new Set(top.map(idOf))
    const alive = [...touched].filter(([id]) => ids.has(id))
    const old = alive.filter(([, t]) => t.at < START + 30 * DAY)
    const mid = alive.filter(([, t]) => t.at >= now - 60 * DAY && t.at < now - 14 * DAY && t.actor.startsWith('session'))
    const recent = alive.filter(([, t]) => t.at >= now - 7 * DAY)
    const never = top.filter(n => isPara(n) && !touched.has(idOf(n)) && n.length > 0).map(n => [idOf(n), null])
    const chosen = [...old.slice(0, 3), ...mid.slice(0, 3), ...recent.slice(-3), ...never.slice(0, 2)]
    const pmDoc = ynodeToPmnode(body, schema)
    const ranges = []
    pmDoc.forEach((node, offset) => { const c = chosen.find(([id]) => id === node.attrs.id); if (c && node.isTextblock) ranges.push({ id: c[0], from: offset + 1, to: offset + 1 + node.content.size, group: old.includes(c) ? 'month-1' : mid.includes(c) ? 'agent 2-8 weeks' : recent.includes(c) ? 'last week' : 'never edited' }) })
    // the selection's Y items (inserted text, deleted runs, attributes) as ContentIds, for the truth scan
    const set = Y.createIdSet()
    for (const rg of ranges) { const yn = top.find(n => idOf(n) === rg.id); for (let it = yn._start; it !== null; it = it.right) set.add(it.id.client, it.id.clock, it.length); for (const [, it] of yn._map) set.add(it.id.client, it.id.clock, it.length) }
    const t0 = performance.now(); const stored = store.attributions(0).map; const tStored = performance.now() - t0
    const t1 = performance.now(); const truthMap = store.truthFor(Y.createContentIds(set, set)); const tTruth = performance.now() - t1
    const rows = []; let pass = 0
    for (const rg of ranges) {
      const t2 = performance.now()
      const a = showEditors({ pmDoc, from: rg.from, to: rg.to, liveRoot: body, provenance: stored })
      const ms = performance.now() - t2
      const b = showEditors({ pmDoc, from: rg.from, to: rg.to, liveRoot: body, provenance: truthMap })
      const norm = xs => xs.map(x => `${x.who}@${ISO(x.atMs - (x.atMs % MIN))}`).sort().join(', ')
      const ok = norm(a) === norm(b) && a.every(x => x.atMs % MIN === 0)
      if (ok) pass++
      rows.push({ block: rg.id, group: rg.group, ok, ms: +ms.toFixed(1), stored: a.map(x => `${x.who}@${ISO(x.atMs)}[${x.kinds.join(',')}]`), truth: b.map(x => `${x.who}@${new Date(x.atMs).toISOString().slice(0, 19)}`) })
    }
    return { summary: `${pass}/${ranges.length}`, mergeAllMs: +tStored.toFixed(1), truthScanMs: Math.round(tTruth), rows }
  }

  // ── the calendar ──
  const totalDays = Math.round(months * 30.5)
  const counts = { keystrokes: 0, turns: 0, batches: 0, comments: 0, named: 0, images: 0, restores: 0 }
  let nextMonth = 1
  const sessionsToday = []
  const tSim = performance.now()
  for (let day = 0; day < totalDays; day++) {
    const d0 = START + day * DAY
    const dow = (day % 7) + 1 // 1 = Monday
    // the nightly maintenance pass at 03:00 (every day; the host is idle)
    now = d0 + 3 * HOUR
    const pinned = new Set()
    const steps = store.maintain(now, { pinned, liveAssets: liveAssets(), liveDs: dsRef })
    maint.push({ day, ms: +Object.values(steps).reduce((s, x) => s + x.ms, 0).toFixed(1), steps })
    if (day > 0 && day >= nextMonth * 30.5 - 0.5) { measure(nextMonth); nextMonth++ }
    if (dow > 5) continue
    if (day % 7 === 0) hot = Math.floor(r() * top.length) // the region the owner works on this week
    if (day > 0 && day % P.dsEvery === 0) { dsRev++; dsRef = `ds-default@${dsRev}`; store.addDs(dsRef, 40_000) }
    sessionsToday.length = 0
    for (let k = 0; k < P.agentSessions; k++) sessionsToday.push({ actor: `session:d${day}-${k}`, client: nextClient++ })
    // the day's events: human sessions, agent turns, comments, images, the named version, a restore
    const ev = []
    for (const [h, keys] of P.sessions) ev.push({ t: d0 + h * HOUR + Math.floor(r() * 20 * MIN), kind: 'human', keys })
    for (let k = 0; k < P.turns; k++) ev.push({ t: d0 + 9 * HOUR + Math.floor(r() * 10 * HOUR), kind: 'turn' })
    const nC = Math.floor(P.comments + r()); for (let k = 0; k < nC; k++) ev.push({ t: d0 + 9 * HOUR + Math.floor(r() * 9 * HOUR), kind: 'comment' })
    const nR = Math.floor(P.resolves + r()); for (let k = 0; k < nR; k++) ev.push({ t: d0 + 9 * HOUR + Math.floor(r() * 9 * HOUR), kind: 'resolve' })
    if (r() < P.images / 5) ev.push({ t: d0 + 11 * HOUR, kind: 'image' })
    if (P.named.includes(dow)) ev.push({ t: d0 + 17 * HOUR, kind: 'named' })
    if (day > 0 && day % P.restoreEvery === 9) ev.push({ t: d0 + 15 * HOUR, kind: 'restore' })
    ev.sort((a, b) => a.t - b.t)
    let busyUntil = 0
    for (const e of ev) {
      const t = Math.max(e.t, busyUntil)
      advance(t)
      if (e.kind === 'human') { busyUntil = humanSession(t, e.keys); counts.keystrokes += e.keys }
      else if (e.kind === 'turn') { const s = pick(sessionsToday); agentTurn(t, s); counts.turns++ }
      else if (e.kind === 'comment') { setActor('human', nextClient++); addComment(); lastHumanAt = now; humanDirty = true; counts.comments++ }
      else if (e.kind === 'resolve') { setActor('human', nextClient++); resolve(); lastHumanAt = now; humanDirty = true }
      else if (e.kind === 'image') { setActor('human', nextClient++); addImage(); lastHumanAt = now; humanDirty = true; counts.images++ }
      else if (e.kind === 'named') { if (version('named', now, 'human', `Week ${Math.floor(day / 7) + 1}`)) counts.named++ }
      else if (e.kind === 'restore') { restoreFrom((1 + Math.floor(r() * 2)) * DAY); counts.restores++ }
    }
    advance(d0 + 20 * HOUR) // the day's last idle version
    const lastV = store.versions().at(-1)
    if (lastV && !hashes.has(lastV.seq) && lastV.seq === store.seq) hashes.set(lastV.seq, contentHash())
  }
  if (nextMonth <= months) { now = START + totalDays * DAY + 3 * HOUR; store.maintain(now, { pinned: new Set(), liveAssets: liveAssets(), liveDs: dsRef }); measure(nextMonth) }
  const simMs = performance.now() - tSim
  const result = {
    tag, profile, encoding, policy: store.policy, initial: { ...initial, v2: months_[0] ? undefined : null }, counts, restores,
    updates: store.seq, clients: doc.store.clients.size, counters: store.counters, simSeconds: Math.round(simMs / 1000),
    months: months_,
    maintenance: summarizeMaint(maint)
  }
  store.close()
  return result
}

const summarizeMaint = maint => {
  const ms = maint.map(m => m.ms)
  const stepMax = {}
  for (const m of maint) for (const [k, v] of Object.entries(m.steps)) stepMax[k] = Math.max(stepMax[k] ?? 0, v.ms)
  const worst = maint.reduce((a, b) => (b.ms > a.ms ? b : a), maint[0])
  return { runs: maint.length, medianMs: median(ms), maxMs: Math.max(...ms), stepMaxMs: stepMax, worst }
}
