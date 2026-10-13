// S3 items 1 and 2: versions as full V2 states (gc on) over a realistic history (the human typing in a real Tiptap
// editor, two agent sessions on their own replicas, attribute, table and code-block edits), any two versions
// rendered by DiffRenderer with attributions from provenance that survives a compaction of the log, "N changes" with
// ↑ ↓, "Show editors" after compaction, the preview in the live editor (render time on a mid-sized document), leaving
// history with the live doc byte-unchanged, undo blocked in history, typing after exit reaching the live doc.
// Run: node spikes/p3-store/s3/s3-history.mjs [sections=25]   (writes s3/out/history.json and history.txt)
import { tick, win } from '../s1/lib/dom.mjs'
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import * as sync from '@y/protocols/sync'
import * as aw from '@y/protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { pmnodeToDelta } from '@y/prosemirror'
import { createHub } from '../s1/lib/link.mjs'
import { extensions, schemaFor, attributedNodes } from './lib/schema.mjs'
import { YCollaboration, isBindingTransaction } from './lib/collab.mjs'
import { seedDocument, tabBody, blockIds } from './lib/artifact.mjs'
import { createStore } from './lib/provenance.mjs'
import { openDiff, renderDiff, attributedRuns, changeList, nextChange, prevChange, showEditors, indexById } from './lib/history.mjs'

const SECTIONS = Number(process.argv[2] ?? 25)
const schema = schemaFor()
const T0 = Date.parse('2026-10-12T09:00:00Z')
let fake = 0
const clock = () => T0 + (++fake) * 1000
const iso = t => new Date(t).toISOString().slice(11, 19)
const lines = []
const say = (...a) => { const s = a.join(' '); lines.push(s); console.log(s) }
const med = xs => { const s = [...xs].sort((a, b) => a - b); return +s[Math.floor(s.length / 2)].toFixed(1) }

const hostDoc = new Y.Doc()
const hub = createHub({ Y, sync, aw, encoding, decoding, hostDoc, clock })
const store = createStore()
let landed = 0
const land = () => { while (landed < hub.log.length) store.land(hub.log[landed++]) }
seedDocument(hostDoc, schema, { sections: SECTIONS })
land()
const V = {}
const version = (name, actor, kind) => { V[name] = store.version(hostDoc, { seq: hub.log.length, at: hub.log[hub.log.length - 1].at, actor, kind, label: name }); return V[name] }
version('V0', 'import', 'import')

// the human's live editor on tab t1; the guard-less control editor for the negative check
const hDoc = new Y.Doc(); hub.connect(hDoc, 'human'); hub.flush()
const mkEditor = (ydoc, guardUndo = true) => {
  const el = document.createElement('div'); document.body.appendChild(el)
  return new Editor({ element: el, extensions: [...extensions(), YCollaboration.configure({ ytype: tabBody(ydoc, 't1'), guardUndo, syncOptions: { attributedNodes } })], coreExtensionOptions: { delete: { filterTransaction: tr => !isBindingTransaction(tr) } } })
}
const human = mkEditor(hDoc)
await tick()
const a1 = new Y.Doc(); hub.connect(a1, 'agent:session-1'); hub.flush()
const a2 = new Y.Doc(); hub.connect(a2, 'agent:session-2'); hub.flush()
const settle = async () => { for (let i = 0; i < 3; i++) { hub.flush(); await tick() } land(); human.storage.collaboration.undoManager.stopCapturing() }
const blockPos = (ed, id) => { let at = -1; ed.state.doc.descendants((n, pos) => { if (at < 0 && n.attrs?.id === id) at = pos }); return at }
const endOf = (ed, id) => blockPos(ed, id) + ed.state.doc.nodeAt(blockPos(ed, id)).nodeSize - 1
const textOf = n => n.toArray().filter(x => typeof x === 'string').join('')
const yb = (d, id) => indexById(tabBody(d, 't1')).get(id)
const lastAt = () => hub.log[hub.log.length - 1].at
// a Node writer must format through the binding's own mark mapping: an overlapping mark is stored under a hashed key (S1 pitfall 4)
const markFormat = mark => { const d = pmnodeToDelta(schema.nodes.paragraph.create(null, schema.text("x", [mark]))); for (const op of d.children) if (op.format) return op.format; return {} }

// expectations: each edit's kind, author, block, text or attribute, and the window of times it may carry
const expectations = []
let phaseStart = 0
const phase = () => { phaseStart = lastAt() + 1 }
const expect = (e) => expectations.push({ ...e, from: phaseStart, to: lastAt() })

// ── phase 1: the human types (keystrokes) and starts a new paragraph ──
phase()
for (const ch of ' Typed by the human.') { human.chain().setTextSelection(endOf(human, 's0p2')).insertContent(ch).run(); await settle() }
human.chain().setTextSelection(endOf(human, 's1p4')).splitBlock().run(); await settle()
for (const ch of 'A new human paragraph.') { human.commands.insertContent(ch); await settle() }
expect({ id: 'h-type-s0p2', kind: 'ins', who: 'human', where: 'paragraph#s0p2', text: 'Typed by the human.' })
expect({ id: 'h-newpara', kind: 'ins', who: 'human', where: null, text: 'A new human paragraph.' })
version('V1', 'human', 'auto')

// ── phase 2: agent session 1's turn on its own replica ──
phase()
a1.transact(() => { const n = yb(a1, 's2p2'); const t = textOf(n); const i = t.indexOf(' ') + 1; const j = t.indexOf(' ', i); n.delete(i, j - i); n.insert(i, 'REWORDED') }); await settle()
expect({ id: 'a1-rewrite-ins', kind: 'ins', who: 'agent:session-1', where: 'paragraph#s2p2', text: 'REWORDED' })
expect({ id: 'a1-rewrite-del', kind: 'del', who: 'agent:session-1', where: 'paragraph#s2p2' })
a1.transact(() => { const b = tabBody(a1, 't1'); const i = b.toArray().findIndex(c => c.getAttr('id') === 's3h'); b.insert(i + 1, [pmnodeToDelta(schema.nodes.heading.create({ level: 3, id: 'aH1' }, schema.text('Agent section'))), pmnodeToDelta(schema.nodes.paragraph.create({ id: 'aP1' }, schema.text('Inserted by agent one after a heading.')))]) }); await settle()
expect({ id: 'a1-section', kind: 'ins', who: 'agent:session-1', where: 'paragraph#aP1', text: 'Inserted by agent one' })
a1.transact(() => { const c = yb(a1, 's4r1c1p'); c.delete(0, textOf(c).length); c.insert(0, '4242') }); await settle()
expect({ id: 'a1-cell', kind: 'ins', who: 'agent:session-1', where: 'paragraph#s4r1c1p', text: '4242' })
a1.transact(() => { const c = yb(a1, 's5c'); c.insert(textOf(c).length, '\nreturn v5 * 2') }); await settle()
expect({ id: 'a1-code', kind: 'ins', who: 'agent:session-1', where: 'codeBlock#s5c', text: 'return v5 * 2' })
version('V2', 'agent:session-1', 'turn')

// ── phase 3: the human changes attributes and formats ──
phase()
human.chain().setTextSelection(blockPos(human, 's6h') + 2).setNode('heading', { level: 3 }).run(); await settle()
expect({ id: 'h-level', kind: 'attrs', who: 'human', where: 'heading#s6h', attr: 'level' })
human.chain().command(({ tr }) => { tr.setNodeAttribute(blockPos(human, 's0ti1'), 'checked', true); return true }).run(); await settle()
expect({ id: 'h-check', kind: 'attrs', who: 'human', where: 'taskItem#s0ti1', attr: 'checked' })
human.chain().command(({ tr }) => { tr.setNodeAttribute(blockPos(human, 's7co'), 'tone', 'warn'); return true }).run(); await settle()
expect({ id: 'h-tone', kind: 'attrs', who: 'human', where: 'callout#s7co', attr: 'tone' })
{ let ip = -1; human.state.doc.nodeAt(blockPos(human, 's8p3')).descendants((n, p) => { if (n.type.name === 'image') ip = blockPos(human, 's8p3') + 1 + p }); human.chain().command(({ tr }) => { tr.setNodeAttribute(ip, 'alt', 'a better alt'); return true }).run(); await settle() }
expect({ id: 'h-img-alt', kind: 'attrs', who: 'human', where: 'image#?', attr: 'alt' })
human.chain().setTextSelection({ from: blockPos(human, 's9p2') + 1, to: blockPos(human, 's9p2') + 12 }).setMark('bold').run(); await settle()
expect({ id: 'h-bold', kind: 'fmt', who: 'human', where: 'paragraph#s9p2' })
version('V3', 'human', 'auto')

// spans of V0→V3 rendered from the log window, before any compaction (S1's build), for the after-compaction compare
const spansOf = (pv, nv, attributions) => { const d = openDiff({ prevState: pv.state, nextState: nv.state, attributions, pick: doc => tabBody(doc, 't1') }); const pm = renderDiff(d, schema, attributedNodes); d.destroy(); return attributedRuns(pm).map(({ kind, who, at, attr, where, text, from, to }) => ({ kind, who, at, attr, where, text, from, to })) }
const pre = { v0v3: spansOf(V.V0, V.V3, store.attributionsFromLog(V.V0.seq, V.V3.seq)), v1v3: spansOf(V.V1, V.V3, store.attributionsFromLog(V.V1.seq, V.V3.seq)) }

// ── compaction: fold the log up to V3 into the base state, drop those rows; bucket the oldest provenance ──
const logRowsBefore = store.log.length
const compaction = store.compact(V.V3.seq)
const bucketed = store.bucket(V.V1.seq)

// ── phase 4: agent session 2's turn: a table row, the code block's language and text, a deleted paragraph, a comment ──
phase()
a2.transact(() => { const t = yb(a2, 's10t'); t.insert(2, [pmnodeToDelta(schema.nodes.tableRow.create({ id: 'nR' }, [0, 1, 2].map(ci => schema.nodes.tableCell.create({ id: 'nRc' + ci }, schema.nodes.paragraph.create({ id: 'nRc' + ci + 'p' }, schema.text('new ' + ci))))))]) }); await settle()
expect({ id: 'a2-row', kind: 'ins', who: 'agent:session-2', where: 'paragraph#nRc1p', text: 'new 1' })
a2.transact(() => { const c = yb(a2, 's10c'); c.setAttr('language', 'ts'); c.delete(0, 5); c.insert(0, 'let') }); await settle()
expect({ id: 'a2-lang', kind: 'attrs', who: 'agent:session-2', where: 'codeBlock#s10c', attr: 'language' })
expect({ id: 'a2-code-ins', kind: 'ins', who: 'agent:session-2', where: 'codeBlock#s10c', text: 'let' })
expect({ id: 'a2-code-del', kind: 'del', who: 'agent:session-2', where: 'codeBlock#s10c', text: 'const' })
a2.transact(() => { const b = tabBody(a2, 't1'); const i = b.toArray().findIndex(c => c.getAttr('id') === 's11p4'); b.delete(i, 1) }); await settle()
expect({ id: 'a2-delpara', kind: 'del', who: 'agent:session-2', where: 'paragraph#s11p4' })
a2.transact(() => { const n = yb(a2, 's12p2'); n.format(0, 8, markFormat(schema.marks.comment.create({ threadId: 'th3', orphan: false }))) }); await settle()
version('V4', 'agent:session-2', 'turn')

// ── phase 5: the human types again and deletes a word the import wrote ──
phase()
for (const ch of ' More.') { human.chain().setTextSelection(endOf(human, 's13p2')).insertContent(ch).run(); await settle() }
expect({ id: 'h-type-s13p2', kind: 'ins', who: 'human', where: 'paragraph#s13p2', text: 'More.' })
{ const p = blockPos(human, 's0p2'); human.chain().deleteRange({ from: p + 1, to: p + 5 }).run(); await settle() }
expect({ id: 'h-del-s0p2', kind: 'del', who: 'human', where: 'paragraph#s0p2' })
version('V5', 'human', 'auto')

// ── 1a. any two versions, attributions from provenance only (after the compaction) ──
// keystroke typing renders one run per keystroke (each carries its own time); join adjacent text runs of the same
// kind, author and block for matching, keeping the latest time
const joinRuns = runs => { const out = []; for (const r of runs) { const l = out[out.length - 1]; if (l && !r.node && !l.node && l.kind === r.kind && l.who === r.who && l.where === r.where && l.attr === r.attr && l.to === r.from) { l.text += r.text; l.to = r.to; l.at = Math.max(l.at, r.at); l.parts++ } else out.push({ ...r, parts: 1 }) } return out }
const score = (runs, exps) => exps.map(e => {
  const hit = joinRuns(runs).find(r => r.kind === e.kind && r.who === e.who && (e.where == null || r.where === e.where || (e.where.endsWith('#?') && r.where.startsWith(e.where.slice(0, -1)))) && (e.attr ? r.attr === e.attr : (e.text ? (r.text ?? '').includes(e.text) : true)))
  const timeOk = hit && hit.at >= e.from && hit.at <= e.to
  return { id: e.id, ok: !!hit && timeOk, got: hit ? `${hit.kind}${hit.attr ? '(' + hit.attr + ')' : ''} by ${hit.who} at ${iso(hit.at)}${timeOk ? '' : ' (time outside ' + iso(e.from) + '..' + iso(e.to) + ')'}` : 'not rendered' }
})
const prov = store.attributions()
const tH = performance.now()
const dAll = openDiff({ prevState: V.V0.state, nextState: V.V5.state, attributions: prov, pick: doc => tabBody(doc, 't1') })
const pmAll = renderDiff(dAll, schema, attributedNodes)
const msHeadless = performance.now() - tH
dAll.destroy()
const runsAll = attributedRuns(pmAll)
const sc = score(runsAll, expectations)
let checkAll = null; try { pmAll.check() } catch (e) { checkAll = e.message }
const post = { v0v3: spansOf(V.V0, V.V3, prov), v1v3: spansOf(V.V1, V.V3, prov) }
const sameAfterCompaction = { v0v3: JSON.stringify(pre.v0v3) === JSON.stringify(post.v0v3), v1v3: JSON.stringify(pre.v1v3) === JSON.stringify(post.v1v3) }
const v2v4 = spansOf(V.V2, V.V4, prov)
const v2v4Who = [...new Set(v2v4.map(r => r.who))].sort()
// provenance with times quantized at write (to 10 s and to the minute): keystroke runs collapse into one range
const quant = q => { const m = Y.mergeContentMaps(hub.log.map(e => Y.createContentMapFromContentIds(Y.createContentIdsFromUpdateV2(e.v2), [Y.createContentAttribute('insert', e.actor), Y.createContentAttribute('insertAt', Math.floor(e.at / q) * q)], [Y.createContentAttribute('delete', e.actor), Y.createContentAttribute('deleteAt', Math.floor(e.at / q) * q)]))); const d = openDiff({ prevState: V.V0.state, nextState: V.V5.state, attributions: m, pick: doc => tabBody(doc, 't1') }); const r = attributedRuns(renderDiff(d, schema, attributedNodes)).length; d.destroy(); return { mergedBytes: Y.encodeContentMap(m).length, runs: r } }
const quantized = { exact: quant(1), tenSeconds: quant(10000), minute: quant(60000) }

// ── 1b. "N changes" and ↑ ↓ ──
const changes = changeList(pmAll)
const walkDown = []; { let pos = 0; for (let i = 0; i < changes.length + 1; i++) { const c = nextChange(changes, pos); walkDown.push(c.from); pos = c.from } }
const walkUp = []; { let pos = pmAll.content.size; for (let i = 0; i < changes.length + 1; i++) { const c = prevChange(changes, pos); walkUp.push(c.from); pos = c.from } }
const navOk = walkDown.slice(0, changes.length).every((f, i) => f === changes[i].from) && walkDown[changes.length] === changes[0].from &&
  walkUp.slice(0, changes.length).every((f, i) => f === changes[changes.length - 1 - i].from)

// ── 1c. "Show editors" on selections of the live editor, from provenance after compaction, against the full-log truth ──
const truthMap = Y.mergeContentMaps([...hub.log.map(e => (/** full log, never compacted, kept by the hub for the check */ Y.createContentMapFromContentIds(Y.createContentIdsFromUpdateV2(e.v2), [Y.createContentAttribute('insert', e.actor), Y.createContentAttribute('insertAt', e.at)], [Y.createContentAttribute('delete', e.actor), Y.createContentAttribute('deleteAt', e.at)])))])
const sel = id => { const p = blockPos(human, id); return { from: p, to: p + human.state.doc.nodeAt(p).nodeSize } }
const editorsFor = (id, provenance) => showEditors({ pmDoc: human.state.doc, ...sel(id), liveRoot: tabBody(hDoc, 't1'), provenance })
const showEd = ['s0p2', 's2p2', 's4r1c1p', 's6h', 's10c', 's12p2', 's9p2'].map(id => ({ id, editors: editorsFor(id, prov), truth: editorsFor(id, truthMap) }))
const showEdOk = showEd.every(s => JSON.stringify(s.editors) === JSON.stringify(s.truth))

// ── 2. the preview in the live editor: render time, N changes in the view, undo blocked, exit byte-unchanged ──
const um = human.storage.collaboration.undoManager
const undoDepth = um.undoStack.length
const liveBytes = () => Y.encodeStateAsUpdateV2(hDoc)
const hostBytes = () => Y.encodeStateAsUpdateV2(hostDoc)
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
const timesShow = []; const timesLeave = []
let viewInfo = null
for (let rep = 0; rep < 5; rep++) {
  const d = openDiff({ prevState: V.V0.state, nextState: V.V5.state, attributions: store.attributions(), pick: doc => tabBody(doc, 't1') })
  const vPrev = Y.encodeStateAsUpdateV2(d.prevDoc); const vNext = Y.encodeStateAsUpdateV2(d.nextDoc)
  const live0 = liveBytes(); const host0 = hostBytes()
  const t0 = performance.now(); human.commands.showVersion({ ytype: d.ytype, renderer: d.renderer }); timesShow.push(performance.now() - t0)
  await tick()
  if (rep === 0) {
    const vc = changeList(human.state.doc)
    let ck = null; try { human.state.doc.check() } catch (e) { ck = e.message }
    // navigate in the view: ↓ through every change, selection lands on each
    const visits = []; for (let i = 0; i < vc.length; i++) { const c = nextChange(vc, human.state.selection.from); human.view.dispatch(human.state.tr.setSelection(TextSelection.near(human.state.doc.resolve(c.from + (c.from < human.state.doc.content.size ? 1 : 0))))); visits.push(c.from) }
    const dom = human.view.dom
    // undo while history is shown: the command and the key binding
    const cmdUndo = human.commands.undo()
    dom.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'z', metaKey: true, ctrlKey: true, bubbles: true }))
    await tick(); hub.flush(); await tick()
    // typing into the read-only preview: a command and a DOM beforeinput
    const typed = human.commands.insertContent('X')
    await tick(); hub.flush(); await tick()
    viewInfo = {
      nChangesView: vc.length, nChangesHeadless: changes.length, viewCheck: ck ?? 'valid', editable: human.isEditable,
      domMarks: { ins: dom.querySelectorAll('y-ins').length, del: dom.querySelectorAll('y-del').length, fmt: dom.querySelectorAll('y-fmt').length, attr: dom.querySelectorAll('y-attr').length },
      navVisited: visits.length === vc.length && new Set(visits).size === vc.length,
      undoCommandReturned: cmdUndo, undoStackUnchanged: um.undoStack.length === undoDepth,
      liveUnchangedByUndoAndTyping: eq(live0, liveBytes()) && eq(host0, hostBytes()), insertCommandReturned: typed,
      versionDocsUnchanged: eq(vPrev, Y.encodeStateAsUpdateV2(d.prevDoc)) && eq(vNext, Y.encodeStateAsUpdateV2(d.nextDoc)) ? true : 'changed (typing in the preview writes to the throwaway version doc)'
    }
  }
  const t1 = performance.now(); human.commands.leaveHistory(); timesLeave.push(performance.now() - t1)
  await tick(); hub.flush(); await tick()
  if (rep === 0) { viewInfo.exitLiveByteUnchanged = eq(live0, liveBytes()); viewInfo.exitHostByteUnchanged = eq(host0, hostBytes()); viewInfo.exitShowsLive = JSON.stringify(human.getJSON()) === JSON.stringify((await import('@y/prosemirror')).ynodeToPmnode(tabBody(hDoc, 't1'), schema).toJSON()) }
  d.destroy()
}

// session B: an agent edits the live doc while the human looks at history; exit shows it; typing reaches the host; undo works again
const d2 = openDiff({ prevState: V.V3.state, nextState: V.V5.state, attributions: store.attributions(), pick: doc => tabBody(doc, 't1') })
human.commands.showVersion({ ytype: d2.ytype, renderer: d2.renderer }); await tick()
a1.transact(() => { const n = yb(a1, 's14p2'); n.insert(0, 'LIVE-DURING-HISTORY ') }); await settle()
const previewHasAgentEdit = human.getText().includes('LIVE-DURING-HISTORY')
human.commands.leaveHistory(); await tick(); hub.flush(); await tick(); d2.destroy()
const exitShowsAgentEdit = human.getText().includes('LIVE-DURING-HISTORY')
human.chain().setTextSelection(endOf(human, 's14p1')).insertContent(' after-exit').run(); await settle()
const typingReachesHost = textOf(indexById(tabBody(hostDoc, 't1')).get('s14p1')).endsWith(' after-exit')
const undoAfterExit = human.commands.undo(); await settle()
const undoWorksAfterExit = undoAfterExit && !textOf(indexById(tabBody(hostDoc, 't1')).get('s14p1')).endsWith(' after-exit')

// negative control: S1's unguarded commands undo into the live doc while history is shown
const cDoc = new Y.Doc(); hub.connect(cDoc, 'human-control'); hub.flush()
const control = mkEditor(cDoc, false); await tick()
control.chain().setTextSelection(endOf(control, 's15p2')).insertContent(' control-typed').run(); await settle()
const dc = openDiff({ prevState: V.V0.state, nextState: V.V5.state, attributions: store.attributions(), pick: doc => tabBody(doc, 't1') })
control.commands.showVersion({ ytype: dc.ytype, renderer: dc.renderer }); await tick()
const cLive0 = Y.encodeStateAsUpdateV2(cDoc)
const cUndo = control.commands.undo(); await settle()
const controlLiveChanged = !eq(cLive0, Y.encodeStateAsUpdateV2(cDoc))
const controlHostLost = !textOf(indexById(tabBody(hostDoc, 't1')).get('s15p2')).endsWith(' control-typed')
control.commands.leaveHistory(); dc.destroy()

const out = {
  doc: { sections: SECTIONS, topLevelBlocks: tabBody(hostDoc, 't1').length, blockIds: blockIds(tabBody(hostDoc, 't1')).length, chars: human.state.doc.textContent.length, liveStateBytes: Y.encodeStateAsUpdateV2(hostDoc).length },
  versions: Object.fromEntries(Object.entries(V).map(([k, v]) => [k, { seq: v.seq, at: iso(v.at), actor: v.actor, kind: v.kind, bytes: v.state.length }])),
  compaction: { logRowsBefore, folded: compaction, logRowsAfter: store.log.length, provenanceRows: store.provenance.length, bucketedRows: bucketed, provenanceBytes: store.provenanceBytes(), hubLogRows: hub.log.length },
  diffV0V5: { msHeadlessRender: +msHeadless.toFixed(1), check: checkAll ?? 'valid', score: sc, passed: sc.filter(s => s.ok).length + '/' + sc.length, nChanges: changes.length, navOk, runs: runsAll.length },
  provenanceQuantized: quantized,
  afterCompaction: { spansIdentical: sameAfterCompaction, v0v3Spans: post.v0v3.length, v1v3Spans: post.v1v3.length, v2v4Authors: v2v4Who },
  showEditors: { ok: showEdOk, rows: showEd.map(s => ({ id: s.id, editors: s.editors, matchesFullLog: JSON.stringify(s.editors) === JSON.stringify(s.truth) })) },
  preview: { msShowVersionMedian: med(timesShow), msLeaveMedian: med(timesLeave), msShow: timesShow.map(x => +x.toFixed(1)), ...viewInfo },
  liveDuringHistory: { previewHasAgentEdit, exitShowsAgentEdit, typingReachesHost, undoWorksAfterExit },
  controlUnguarded: { undoReturned: cUndo, liveChangedWhileInHistory: controlLiveChanged, typedTextLostOnHost: controlHostLost }
}
writeFileSync(new URL(`./out/history${SECTIONS === 25 ? '' : '-' + SECTIONS}.json`, import.meta.url), JSON.stringify(out, null, 2))
say('doc', JSON.stringify(out.doc))
say('versions', JSON.stringify(out.versions))
say('compaction', JSON.stringify(out.compaction))
say(`diff V0→V5 (provenance after compaction): ${out.diffV0V5.passed} expectations, check ${out.diffV0V5.check}, headless ${out.diffV0V5.msHeadlessRender} ms, N changes ${changes.length}, ↑↓ ok ${navOk}`)
for (const s of sc) say(`  ${s.ok ? 'ok  ' : 'MISS'} ${s.id.padEnd(16)} ${s.got}`)
say('after compaction, spans identical to the log-window build:', JSON.stringify(sameAfterCompaction), '| V2→V4 authors', v2v4Who.join(','))
say('provenance quantized (full log merged):', JSON.stringify(quantized))
say('show editors (after compaction = full-log truth):', showEdOk)
for (const r of out.showEditors.rows) say(`  ${r.id.padEnd(9)} ${r.matchesFullLog ? 'ok  ' : 'DIFF'} ${r.editors.map(e => `${e.who}@${e.at}[${e.kinds.join(',')}]`).join('  ')}`)
say('preview', JSON.stringify(out.preview))
say('live during history', JSON.stringify(out.liveDuringHistory))
say('control (S1 commands, unguarded)', JSON.stringify(out.controlUnguarded))
writeFileSync(new URL(`./out/history${SECTIONS === 25 ? '' : '-' + SECTIONS}.txt`, import.meta.url), lines.join('\n') + '\n')
process.exit(0)
