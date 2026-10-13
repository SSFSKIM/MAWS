// S7a (P3-0): months of simulated use of a 100-slide deck (S6's v14 model, imported through `publish`) against the
// retained store (../store.mjs). The human drags (one transaction per pointer move, S6's `attachDrag`), restyles, types
// in text boxes, re-orders, adds and deletes slides and changes z-order; agent turns publish edited slide files through
// `publish` (restyles, word rewrites, added and removed elements, new and deleted slides, deck.json order). Same
// clock, triggers and measurements as the document soak. Throwaway spike code.
import * as Y from '@y/y'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { Store, MIN, HOUR, DAY } from '../store.mjs'
import { rng } from '../doc/corpus.mjs'
import { revertUpdateFixed as revertUpdate } from '../revert.mjs' // S3's revertUpdate with the soak's two fixes (see revert.mjs)
import { shapes, w } from './shapes.ts'
import { deckFiles, readFlat, setStyle, zOrder, moveSlide, slideOrder } from './model.ts'
import { publish } from './publish.ts'
import * as M from './ydoc.ts'

export const PROFILES: Record<string, any> = {
  // a deck the owner reworks weekly with an agent: one editing session and 8 agent turns a day
  normal: { sessions: [10], drags: 12, restyles: 15, typing: 250, zorders: 2, reorders: 1, addSlide: 0.4, delSlide: 0.5, turns: 8, publishes: [1, 2], slidesPerPublish: [1, 4], newSlide: 0.06, delSlideAgent: 0.07, comments: 0.5, named: [5], restoreEvery: 30, dsEvery: 21, agentSessions: 2 },
  // a deck built all day: three sessions, 30 agent turns, more slides churned
  heavy: { sessions: [9, 13, 16], drags: 15, restyles: 20, typing: 400, zorders: 4, reorders: 3, addSlide: 1.2, delSlide: 1.4, turns: 30, publishes: [1, 3], slidesPerPublish: [1, 6], newSlide: 0.1, delSlideAgent: 0.11, comments: 2, named: [1, 3, 5], restoreEvery: 14, dsEvery: 14, agentSessions: 6 }
}
const START = Date.UTC(2026, 3, 6)
const ISO = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ')
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12)
const filesView = (d: any) => { const f = deckFiles(d); return JSON.stringify(Object.keys(f).sort().map(k => [k, f[k]])) + JSON.stringify(canon(d.get('threads').toJSON())) }
const canon = (v: any): any => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v)
const VOCAB = 'pipeline revenue onboarding retention latency quarter forecast margin cohort launch hiring roadmap growth churn pricing segment partner channel funnel conversion activation expansion region market share target plan review risk owner budget'.split(' ')

export async function runDeck ({ profile = 'normal', months = 6, encoding = 'delta', policy = {}, dbDir = '/tmp/p3-s7a', seed = 11, log = console.log, truth = true, suffix = null }: any) {
  const P = PROFILES[profile]
  const r = rng(seed)
  const pick = <T>(a: T[]): T => a[Math.floor(r() * a.length)]
  const between = ([a, b]: number[]) => a + Math.floor(r() * (b - a + 1))
  const tag = `deck-${profile}-${encoding}${suffix ? "-" + suffix : ""}`
  const store = new Store(`${dbDir}/${tag}.sqlite`, { encoding, ...policy }, { truthPath: truth ? `${dbDir}/${tag}.truth.sqlite` : null })

  const doc: any = M.newDoc()
  let now = START + 8 * HOUR
  let actor = 'import'
  let nextClient = 1000
  const setActor = (a: string, client: number) => { actor = a; doc.clientID = client }
  doc.on('update', (u: Uint8Array) => store.land(u, actor, now))

  // the 100-slide deck (S6's bench shapes), imported in one publish
  const N = 100
  let slideN = N
  const ids = Array.from({ length: N }, (_, i) => `s${String(i + 1).padStart(3, '0')}`)
  const files: Record<string, string> = { 'project/deck.json': JSON.stringify({ v: 4, createdOnFiles: { v: 1, at: '2026-04-06T08:00:00Z' }, lists: 'css', title: 'Soak', cover: ids[0], order: ids, faces: {}, designSystems: [] }) }
  ids.forEach((id, i) => { files[`project/slides/${id}.html`] = shapes[i % shapes.length](id, i) })
  const sourceBytes = Object.values(files).reduce((n, s) => n + Buffer.byteLength(s), 0)
  setActor('import', nextClient++)
  const imp = publish(doc, files, { seed: 'import' })
  if (!imp.ok || Object.keys(imp.held).length) throw new Error('import failed ' + JSON.stringify(imp.held))
  const threadsRoot = doc.get('threads')

  // assets: every img src on a live slide; design-system states as in the document soak
  const assetSize = new Map<string, number>()
  const liveAssets = () => {
    const out = new Set<string>()
    for (const sid of M.slideIds(doc)) for (const e of readFlat(doc, sid, false)) if (e.tag === 'img' && e.attrs?.src) out.add(e.attrs.src)
    for (const a of out) if (!assetSize.has(a)) { const s = 30_000 + Math.floor(r() * 400_000); assetSize.set(a, s); store.addAsset(a, s) }
    return [...out]
  }
  liveAssets()
  let dsRev = 1; let dsRef = 'ds-default@1'; store.addDs(dsRef, 40_000)
  const touched = new Map<string, { actor: string, at: number }>() // `${slide}/${element}` → last touch

  let lastVersionAt = now; let lastVersionSeq = 0; let lastHumanAt = 0; let humanDirty = false
  const hashes = new Map<number, string>()
  const version = (kind: string, at: number, by: string, label?: string) => {
    const v = store.version(doc, { at, actor: by, kind, label: label ?? null, dsRef, assetRefs: liveAssets() })
    if (v) { lastVersionAt = at; lastVersionSeq = v.seq; humanDirty = false }
    return v
  }
  version('import', now, 'import')
  const dirty = () => store.seq > lastVersionSeq
  const advance = (t: number) => {
    if (humanDirty && lastHumanAt + 2 * MIN <= t) { const at = lastHumanAt + 2 * MIN; now = at; version('auto', at, 'human') }
    if (dirty() && t - lastVersionAt >= 10 * MIN) { now = t; version('auto', t, actor) }
    now = t
  }
  const human = () => { lastHumanAt = now; humanDirty = true }

  // ── the human on the canvas ──
  const pinnedEls = (sid: string) => readFlat(doc, sid, false).filter(e => e.style.position === 'absolute' && (e.style.left || e.style.right) && (e.style.top || e.style.bottom))
  const textEls = (sid: string) => readFlat(doc, sid).filter(e => e.text?.length && e.text[0].inline.some((x: any) => 'text' in x && x.text.length > 3))
  let hot = 0
  const slideNear = () => { const o = slideOrder(doc); return r() < 0.6 ? o[Math.max(0, Math.min(o.length - 1, hot + Math.floor((r() - 0.5) * 12)))] : pick(o) }
  const drag = (t: number) => {
    const sid = slideNear(); const els = pinnedEls(sid); if (!els.length) return t
    const e = pick(els); const key = e.style.left ? 'left' : 'right'; const vkey = e.style.top ? 'top' : 'bottom'
    let x = parseFloat(e.style[key]) || 0; let y = parseFloat(e.style[vkey]) || 0
    const moves = 15 + Math.floor(r() * 16)
    for (let k = 0; k < moves; k++) { t += 16 + Math.floor(r() * 30); advance(t); x += Math.round((r() - 0.5) * 20); y += Math.round((r() - 0.5) * 12); setStyle(doc, sid, e.id, { [key]: `${x}px`, [vkey]: `${y}px` }) }
    touched.set(`${sid}/${e.id}`, { actor: 'human', at: now }); human()
    return t
  }
  const restyle = (t: number) => {
    const sid = slideNear(); const els = readFlat(doc, sid, false); if (!els.length) return t
    const e = pick(els); advance(t)
    const prop = pick(['color', 'background', 'font-size', 'border-radius', 'opacity'])
    const val = prop === 'font-size' ? `${16 + Math.floor(r() * 80)}px` : prop === 'border-radius' ? `${Math.floor(r() * 32)}px` : prop === 'opacity' ? (0.5 + r() * 0.5).toFixed(2) : '#' + Math.floor(r() * 0xffffff).toString(16).padStart(6, '0')
    setStyle(doc, sid, e.id, { [prop]: val })
    touched.set(`${sid}/${e.id}`, { actor: 'human', at: now }); human()
    return t
  }
  const typeIn = (t: number, keys: number) => {
    const sid = slideNear(); const els = textEls(sid); if (!els.length) return t
    const e = pick(els)
    let blocks = M.readText(doc, sid, e.id)
    const run = blocks[0].inline.find((x: any) => 'text' in x) as any
    let pos = Math.floor(r() * run.text.length)
    let stream = ''
    for (let k = 0; k < keys; k++) {
      t += 120 + Math.floor(r() * 200); advance(t)
      if (r() < 0.08 && pos > 0) { run.text = run.text.slice(0, pos - 1) + run.text.slice(pos); pos-- } else {
        if (!stream) stream = ' ' + pick(VOCAB)
        run.text = run.text.slice(0, pos) + stream[0] + run.text.slice(pos); stream = stream.slice(1); pos++
      }
      M.transact(doc, () => M.patchText(doc, sid, e.id, blocks))
      blocks = M.readText(doc, sid, e.id)
      const fresh = blocks[0].inline.find((x: any) => 'text' in x) as any
      if (!fresh) break
      Object.assign(run, fresh)
    }
    touched.set(`${sid}/${e.id}`, { actor: 'human', at: now }); human()
    return t
  }
  const addSlideBy = (who: string, seedTag: string) => {
    const o = slideOrder(doc); const after = pick(o); const id = `n${(slideN++).toString(36)}`
    const order = [...o]; order.splice(o.indexOf(after) + 1, 0, id)
    const deck = JSON.parse(deckFiles(doc)['project/deck.json']); deck.order = order
    publish(doc, { [`project/slides/${id}.html`]: shapes[slideN % shapes.length](id, slideN), 'project/deck.json': JSON.stringify(deck) }, { seed: seedTag })
    for (const e of readFlat(doc, id, false)) touched.set(`${id}/${e.id}`, { actor: who, at: now })
  }
  const deleteSlideBy = () => {
    const o = slideOrder(doc); if (o.length < 80) return
    const id = pick(o); const deck = JSON.parse(deckFiles(doc)['project/deck.json']); deck.order = o.filter(s => s !== id)
    publish(doc, { [`project/slides/${id}.html`]: null, 'project/deck.json': JSON.stringify(deck) }, { seed: 'del' })
  }
  const humanSession = (t: number) => {
    setActor('human', nextClient++)
    const ops: string[] = []
    for (let k = 0; k < P.drags; k++) ops.push('drag')
    for (let k = 0; k < P.restyles; k++) ops.push('restyle')
    for (let k = 0; k < Math.ceil(P.typing / 30); k++) ops.push('type')
    for (let k = 0; k < P.zorders; k++) ops.push('z')
    for (let k = 0; k < P.reorders; k++) ops.push('reorder')
    if (r() < P.addSlide % 1 || P.addSlide >= 1) for (let k = 0; k < Math.max(1, Math.floor(P.addSlide)); k++) ops.push('add')
    if (r() < P.delSlide % 1 || P.delSlide >= 1) for (let k = 0; k < Math.max(1, Math.floor(P.delSlide)); k++) ops.push('del')
    ops.sort(() => r() - 0.5)
    for (const op of ops) {
      t += (2 + Math.floor(r() * 40)) * 1000
      if (r() < 0.12) t += (150 + Math.floor(r() * 300)) * 1000 // a pause long enough for an idle version
      advance(t)
      if (op === 'drag') t = drag(t)
      else if (op === 'restyle') t = restyle(t)
      else if (op === 'type') t = typeIn(t, 20 + Math.floor(r() * 20))
      else if (op === 'z') { const sid = slideNear(); const els = pinnedEls(sid); if (els.length) { const e = pick(els); try { zOrder(doc, sid, e.id, r() < 0.5 ? 'front' : 'back'); touched.set(`${sid}/${e.id}`, { actor: 'human', at: now }) } catch {} } human() }
      else if (op === 'reorder') { const o = slideOrder(doc); moveSlide(doc, pick(o), pick(o)); human() }
      else if (op === 'add') { addSlideBy('human', 'h' + now); human() }
      else if (op === 'del') { deleteSlideBy(); human() }
    }
    return t
  }

  // ── agent turns: publish edited files ──
  const rewriteText = (html: string) => html.replace(/>([^<>]{12,})</, (_m, s) => '>' + s.split(' ').map((x: string) => (r() < 0.4 && /^[a-z]+$/i.test(x) ? pick(VOCAB) : x)).join(' ') + '<')
  let added = 0
  const editSlide = (html: string) => {
    let out = html
    const k = r()
    if (k < 0.3) { const sizes = [...out.matchAll(/font-size:(\d+)px/g)]; if (sizes.length) { const m = pick(sizes); out = out.slice(0, m.index!) + `font-size:${16 + Math.floor(r() * 100)}px` + out.slice(m.index! + m[0].length) } }
    else if (k < 0.45) { const cs = [...out.matchAll(/#[0-9a-f]{6}/g)]; if (cs.length) { const m = pick(cs); out = out.slice(0, m.index!) + '#' + Math.floor(r() * 0xffffff).toString(16).padStart(6, '0') + out.slice(m.index! + 7) } }
    else if (k < 0.8) { out = rewriteText(out) }
    else if (k < 0.92) {
      const id = `a${(added++).toString(36)}`; const el = `<p id="${id}" style="position:absolute; left:${128 + Math.floor(r() * 1200)}px; top:${64 + Math.floor(r() * 800)}px; font-size:28px; color:#1a1a1a">${pick(VOCAB)} ${pick(VOCAB)} ${pick(VOCAB)}</p>\n`
      out = out.includes('<aside>') ? out.replace('<aside>', el + '<aside>') : out.replace('</section>', el + '</section>')
    } else { const ms = [...out.matchAll(/<p id="a[0-9a-z]+"[^>]*>[^<]*<\/p>\n?/g)]; if (ms.length) { const m = pick(ms); out = out.slice(0, m.index!) + out.slice(m.index! + m[0].length) } }
    return out
  }
  let turnN = 0
  const agentTurn = (t: number, s: { actor: string, client: number }) => {
    setActor(s.actor, s.client)
    const np = between(P.publishes)
    for (let p = 0; p < np; p++) {
      t += (15 + Math.floor(r() * 60)) * 1000; advance(t)
      const x = r()
      if (x < P.newSlide) { addSlideBy(s.actor, `t${turnN}-${p}`); continue }
      if (x < P.newSlide + P.delSlideAgent) { deleteSlideBy(); continue }
      const all = deckFiles(doc); const o = slideOrder(doc)
      const chosen = new Set<string>(); const n = between(P.slidesPerPublish)
      const near = slideNear(); for (let k = 0; k < n; k++) chosen.add(r() < 0.5 ? near : pick(o))
      const edit: Record<string, string> = {}
      for (const sid of chosen) edit[`project/slides/${sid}.html`] = editSlide(all[`project/slides/${sid}.html`])
      const before = new Map([...chosen].map(sid => [sid, new Map(readFlat(doc, sid, false).map(e => [e.id, JSON.stringify(e)]))]))
      const res = publish(doc, edit, { seed: `t${turnN}-${p}` })
      if (!res.ok) throw new Error('publish refused: ' + res.refused)
      for (const sid of chosen) for (const e of readFlat(doc, sid, false)) if (before.get(sid)!.get(e.id) !== JSON.stringify(e)) touched.set(`${sid}/${e.id}`, { actor: s.actor, at: now })
    }
    turnN++
    version('turn', now, s.actor)
    return t
  }
  const comment = () => {
    const sid = slideNear(); const els = readFlat(doc, sid, false); if (!els.length) return
    const e = pick(els); const th = `k${(slideN++).toString(36)}`
    M.transact(doc, () => { const n = new Y.Node('thread'); threadsRoot.setAttr(th, n); n.setAttr('quote', e.id); n.setAttr('resolved', false); n.setAttr('anchor', { slideId: sid, elementId: e.id }) })
  }
  const resolve = () => {
    const open = Object.entries(threadsRoot.getAttrs()).filter(([, n]: any) => n instanceof Y.Node && !n.getAttr('resolved'))
    if (!open.length) return
    const [, n]: any = pick(open); M.transact(doc, () => n.setAttr('resolved', true))
  }

  const restores: any[] = []
  const restoreFrom = (ageMs: number) => {
    const rows = store.versions().filter((v: any) => v.at <= now - ageMs)
    if (!rows.length) return
    const target = rows[rows.length - 1]
    version('auto', now, 'human')
    const t0 = performance.now()
    const R = revertUpdate(store.stateAt(target.seq).state, Y.encodeStateAsUpdateV2(doc))
    const ms = performance.now() - t0
    setActor('human:restore', nextClient++)
    Y.applyUpdateV2(doc, R)
    version('restore', now, 'human', `Restored from ${ISO(target.at)}`)
    restores.push({ at: ISO(now), from: ISO(target.at), ms: +ms.toFixed(1), bytes: R.length })
  }

  // ── per-element "Show editors": the element's attribute items and its text's items, read from provenance ──
  const elementItems = (sid: string, eid: string) => {
    const el = doc.get('slides').getAttr(sid)?.getAttr('elements')?.getAttr(eid)
    const items: any[] = []
    if (!el) return items
    const walk = (n: any) => { for (const [, it] of n._map) { items.push(it); if (it.content?.type instanceof Y.Node) walk(it.content.type) } for (let it = n._start; it; it = it.right) { items.push(it); if (it.content?.type instanceof Y.Node) walk(it.content.type) } }
    walk(el)
    return items
  }
  const editorsOf = (items: any[], prov: any) => {
    const who = new Map<string, { at: number, kinds: Set<string> }>()
    const add = (attrs: any, kind: string) => {
      const a: any = {}; for (const x of attrs ?? []) a[x.name] = x.val
      const w = kind === 'del' ? a.delete : a.insert; const at = kind === 'del' ? a.deleteAt : a.insertAt
      if (!w) return
      const e = who.get(w) ?? { at: 0, kinds: new Set<string>() }; e.at = Math.max(e.at, at ?? 0); e.kinds.add(kind); who.set(w, e)
    }
    for (const it of items) {
      for (const rg of prov.inserts.slice(it.id.client, it.id.clock, it.length)) add(rg.attrs, 'ins')
      if (it.deleted) for (const rg of prov.deletes.slice(it.id.client, it.id.clock, it.length)) add(rg.attrs, 'del')
    }
    return [...who].map(([w, e]) => ({ who: w, atMs: e.at, kinds: [...e.kinds].sort() }))
  }
  const checkShowEditors = () => {
    const live = [...touched].filter(([k]) => { const [sid, eid] = k.split('/'); return M.hasElement(doc, sid, eid) })
    const old = live.filter(([, t]) => t.at < START + 30 * DAY)
    const mid = live.filter(([, t]) => t.at >= now - 60 * DAY && t.at < now - 14 * DAY && t.actor.startsWith('session'))
    const recent = live.filter(([, t]) => t.at >= now - 7 * DAY)
    const never: [string, null][] = []
    for (const sid of slideOrder(doc)) { for (const e of readFlat(doc, sid, false)) if (!touched.has(`${sid}/${e.id}`)) { never.push([`${sid}/${e.id}`, null]); break } if (never.length >= 2) break }
    const chosen = [...old.slice(0, 3).map(x => [x[0], 'month-1']), ...mid.slice(0, 3).map(x => [x[0], 'agent 2-8 weeks']), ...recent.slice(-3).map(x => [x[0], 'last week']), ...never.map(x => [x[0], 'never edited'])]
    const set = Y.createIdSet()
    const itemsOf = new Map<string, any[]>()
    for (const [k] of chosen) { const [sid, eid] = k.split('/'); const its = elementItems(sid, eid); itemsOf.set(k, its); for (const it of its) set.add(it.id.client, it.id.clock, it.length) }
    const t0 = performance.now(); const stored = store.attributions(0).map; const tStored = performance.now() - t0
    const t1 = performance.now(); const truthMap = store.truthFor(Y.createContentIds(set, set)); const tTruth = performance.now() - t1
    const rows: any[] = []; let pass = 0
    for (const [k, group] of chosen) {
      const t2 = performance.now(); const a = editorsOf(itemsOf.get(k)!, stored); const ms = performance.now() - t2
      const b = editorsOf(itemsOf.get(k)!, truthMap)
      const norm = (xs: any[]) => xs.map(x => `${x.who}@${ISO(x.atMs - (x.atMs % MIN))}`).sort().join(', ')
      const ok = norm(a) === norm(b) && a.every(x => x.atMs % MIN === 0)
      if (ok) pass++
      rows.push({ element: k, group, ok, ms: +ms.toFixed(2), stored: a.map(x => `${x.who}@${ISO(x.atMs)}[${x.kinds}]`), truth: b.map(x => `${x.who}@${new Date(x.atMs).toISOString().slice(0, 19)}`) })
    }
    return { summary: `${pass}/${chosen.length}`, mergeAllMs: +tStored.toFixed(1), truthScanMs: Math.round(tTruth), rows }
  }

  // ── measurements ──
  const months_: any[] = []
  const maint: any[] = []
  const measure = (m: number) => {
    const out: any = { month: m, at: ISO(now), seq: store.seq, slides: M.slideIds(doc).length }
    const t0 = performance.now()
    const live = Y.encodeStateAsUpdateV2(doc)
    out.live = { v2: live.length, v1: Y.encodeStateAsUpdate(doc).length }
    { const d = new Y.Doc(); Y.applyUpdateV2(d, live); out.live.reencoded = Y.encodeStateAsUpdateV2(d).length; d.destroy() }
    { const f = deckFiles(doc); const d: any = M.newDoc(); publish(d, f, { seed: 'fresh' }); out.live.freshImport = Y.encodeStateAsUpdateV2(d).length; out.sourceBytes = Object.values(f).reduce((n, s) => n + Buffer.byteLength(s), 0) }
    let structs = 0; doc.store.clients.forEach((s: any[]) => { structs += s.length }); out.live.structs = structs; out.live.clients = doc.store.clients.size
    out.sizes = store.sizes()
    const loads: number[] = []; let tail = 0
    for (let k = 0; k < 5; k++) { const t = performance.now(); const l = store.load(); loads.push(performance.now() - t); tail = l.tailRows; l.doc.destroy() }
    out.load = { ms: +median(loads).toFixed(1), tailRows: tail }
    const vs = store.versions()
    const target = [...vs].reverse().find((v: any) => v.at <= now - 90 * DAY) ?? vs[0]
    {
      const ph: any = {}; const tt = (k: string, fn: () => any) => { const t = performance.now(); const x = fn(); ph[k] = +(performance.now() - t).toFixed(1); return x }
      const { state: prevState, chain } = tt('state', () => store.stateAt(target.seq))
      const nextState = tt('encodeLive', () => Y.encodeStateAsUpdateV2(doc))
      const attrs = tt('attributions', () => store.attributions(target.seq))
      const docs = tt('openDiff', () => { const p = new Y.Doc({ gc: false }); Y.applyUpdateV2(p, prevState); const n = new Y.Doc({ gc: false }); Y.applyUpdateV2(n, nextState); return { p, n, renderer: Y.createDiffRenderer(p, n, { attributions: attrs.map }) } })
      const delta = tt('render', () => docs.n.get('slides').toDeltaDeep({ renderer: docs.renderer }).toJSON())
      const changed = tt('walk', () => {
        const slides = new Set<string>(); const els = new Set<string>()
        const any = (d: any): boolean => { let hit = false; for (const op of Object.values(d?.attrs ?? {}) as any[]) { if (op.attribution) hit = true; if (op.value && typeof op.value === 'object' && any(op.value)) hit = true } for (const op of d?.children ?? []) { if (op.attribution) hit = true; if (Array.isArray(op.insert)) for (const c of op.insert) if (c && typeof c === 'object' && any(c)) hit = true } return hit }
        for (const [sid, op] of Object.entries((delta as any).attrs ?? {}) as any[]) {
          if (op.attribution) { slides.add(sid); continue }
          if (any(op.value)) slides.add(sid)
          for (const [eid, eop] of Object.entries(op.value?.attrs?.elements?.value?.attrs ?? {}) as any[]) if (eop.attribution || any(eop.value)) els.add(`${sid}/${eid}`)
        }
        return { slides: slides.size, elements: els.size }
      })
      docs.renderer.destroy(); docs.p.destroy(); docs.n.destroy()
      ph.total = +Object.values(ph).reduce((s: number, x: any) => s + x, 0).toFixed(1)
      out.preview = { versionAt: ISO(target.at), kind: target.kind, enc: target.enc, chain, provenanceRows: attrs.rows, changed, ms: ph }
      const t1 = performance.now(); const R = revertUpdate(prevState, nextState); const rms = performance.now() - t1
      out.restore = { ms: +rms.toFixed(1), bytes: R.length }
      if (m === months) {
        const d: any = new Y.Doc(); Y.applyUpdateV2(d, nextState); Y.applyUpdateV2(d, R)
        const old: any = new Y.Doc(); Y.applyUpdateV2(old, prevState)
        out.restore.equalsVersion = filesView(d) === filesView(old)
      }
    }
    const checkable = vs.filter((v: any) => hashes.has(v.seq))
    const sample = checkable.filter((_: any, i: number) => i % Math.max(1, Math.floor(checkable.length / 6)) === 0).slice(0, 8)
    let ok = 0
    for (const v of sample) { const d: any = new Y.Doc(); Y.applyUpdateV2(d, store.stateAt(v.seq).state); if (sha(filesView(d)) === hashes.get(v.seq)) ok++; d.destroy() }
    out.versionCheck = `${ok}/${sample.length}`
    out.versions = { count: vs.length, byKind: out.sizes.kinds }
    if (truth && (m === 1 || m === 3 || m === months)) out.showEditors = checkShowEditors()
    out.measureMs = Math.round(performance.now() - t0)
    months_.push(out)
    log(`month ${m}: ${JSON.stringify({ slides: out.slides, live: out.live.v2, file: out.sizes.file, versions: vs.length, log: out.sizes.tables.log, prov: out.sizes.tables.provenance, load: out.load.ms, preview: out.preview?.ms.total, restore: out.restore?.ms, vc: out.versionCheck, se: out.showEditors?.summary })}`)
  }

  const totalDays = Math.round(months * 30.5)
  const counts: any = { turns: 0, sessions: 0, comments: 0, named: 0, restores: 0 }
  let nextMonth = 1
  const tSim = performance.now()
  for (let day = 0; day < totalDays; day++) {
    const d0 = START + day * DAY
    const dow = (day % 7) + 1
    now = d0 + 3 * HOUR
    const steps = store.maintain(now, { pinned: new Set(), liveAssets: liveAssets(), liveDs: dsRef })
    maint.push({ day, ms: +Object.values(steps).reduce((s: number, x: any) => s + x.ms, 0).toFixed(1), steps })
    if (day > 0 && day >= nextMonth * 30.5 - 0.5) { measure(nextMonth); nextMonth++ }
    if (dow > 5) continue
    if (day % 7 === 0) hot = Math.floor(r() * slideOrder(doc).length)
    if (day > 0 && day % P.dsEvery === 0) { dsRev++; dsRef = `ds-default@${dsRev}`; store.addDs(dsRef, 40_000) }
    const sessions = Array.from({ length: P.agentSessions }, (_, k) => ({ actor: `session:d${day}-${k}`, client: nextClient++ }))
    const ev: any[] = []
    for (const h of P.sessions) ev.push({ t: d0 + h * HOUR + Math.floor(r() * 20 * MIN), kind: 'human' })
    for (let k = 0; k < P.turns; k++) ev.push({ t: d0 + 9 * HOUR + Math.floor(r() * 10 * HOUR), kind: 'turn' })
    const nC = Math.floor(P.comments + r()); for (let k = 0; k < nC; k++) ev.push({ t: d0 + 9 * HOUR + Math.floor(r() * 9 * HOUR), kind: 'comment' })
    const nR = Math.floor(P.comments * 0.9 + r()); for (let k = 0; k < nR; k++) ev.push({ t: d0 + 9 * HOUR + Math.floor(r() * 9 * HOUR), kind: 'resolve' })
    if (P.named.includes(dow)) ev.push({ t: d0 + 17 * HOUR, kind: 'named' })
    if (day > 0 && day % P.restoreEvery === 9) ev.push({ t: d0 + 15 * HOUR, kind: 'restore' })
    ev.sort((a, b) => a.t - b.t)
    let busyUntil = 0
    for (const e of ev) {
      const t = Math.max(e.t, busyUntil)
      advance(t)
      if (e.kind === 'human') { busyUntil = humanSession(t); counts.sessions++ }
      else if (e.kind === 'turn') { busyUntil = agentTurn(t, pick(sessions)); counts.turns++ }
      else if (e.kind === 'comment') { setActor('human', nextClient++); comment(); human(); counts.comments++ }
      else if (e.kind === 'resolve') { setActor('human', nextClient++); resolve(); human() }
      else if (e.kind === 'named') { if (version('named', now, 'human', `Week ${Math.floor(day / 7) + 1}`)) counts.named++ }
      else if (e.kind === 'restore') { restoreFrom((1 + Math.floor(r() * 2)) * DAY); counts.restores++ }
    }
    advance(d0 + 20 * HOUR)
    const lastV = store.versions().at(-1)
    if (lastV && !hashes.has(lastV.seq) && lastV.seq === store.seq) hashes.set(lastV.seq, sha(filesView(doc)))
  }
  if (nextMonth <= months) { now = START + totalDays * DAY + 3 * HOUR; store.maintain(now, { pinned: new Set(), liveAssets: liveAssets(), liveDs: dsRef }); measure(nextMonth) }
  const ms = maint.map(m => m.ms); const stepMax: any = {}
  for (const m of maint) for (const [k, v] of Object.entries(m.steps) as any[]) stepMax[k] = Math.max(stepMax[k] ?? 0, v.ms)
  const result = {
    tag, profile, encoding, policy: store.policy, initial: { slides: N, sourceBytes }, counts, restores, updates: store.seq, clients: doc.store.clients.size,
    counters: store.counters, simSeconds: Math.round((performance.now() - tSim) / 1000), months: months_,
    maintenance: { runs: maint.length, medianMs: median(ms), maxMs: Math.max(...ms), stepMaxMs: stepMax, worst: maint.reduce((a, b) => (b.ms > a.ms ? b : a), maint[0]) }
  }
  store.close()
  return result
}
