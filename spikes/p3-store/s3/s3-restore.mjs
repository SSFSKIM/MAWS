// S3 item 3: artifact-wide restore on Yjs v14. A document artifact (two tabs, threads; the human in a real Tiptap
// editor, two agent replicas) and a deck artifact (deck + slides maps) are edited after version V0, then restored to V0
// as one update applied by the host as the restorer's transaction, while an agent replica edits concurrently.
// Mechanisms: revert (Y.undoContentIds on a scratch doc), diff (lib0 delta.diff + applyDelta), diff-by-id.
// Run: node spikes/p3-store/s3/s3-restore.mjs [sections=25]   (writes s3/out/restore[-N].json and .txt)
import { tick } from '../s1/lib/dom.mjs'
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import * as sync from '@y/protocols/sync'
import * as aw from '@y/protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Editor } from '@tiptap/core'
import { pmnodeToDelta, ynodeToPmnode } from '@y/prosemirror'
import { createHub } from '../s1/lib/link.mjs'
import { extensions, schemaFor, attributedNodes } from './lib/schema.mjs'
import { YCollaboration, isBindingTransaction } from './lib/collab.mjs'
import { seedDocument, seedDeck, tabBody, canon, blockIds, commentThreads } from './lib/artifact.mjs'
import { createStore } from './lib/provenance.mjs'
import { openDiff, renderDiff, attributedRuns, showEditors, indexById } from './lib/history.mjs'
import { revertUpdate, diffUpdate, byId } from './lib/restore.mjs'

const schema = schemaFor()
const SECTIONS = Number(process.argv[2] ?? 25)
const SUFFIX = SECTIONS === 25 ? "" : "-" + SECTIONS
const T0 = Date.parse('2026-10-12T09:00:00Z')
const lines = []
const say = (...a) => { const s = a.join(' '); lines.push(s); console.log(s) }
const sizeOf = o => JSON.stringify(o).length

const findPos = (ed, needle) => { let at = -1; ed.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) }); return at }
const blockPos = (ed, id) => { let at = -1; ed.state.doc.descendants((n, pos) => { if (at < 0 && n.attrs?.id === id) at = pos }); return at }
const yBlock = (root, id) => indexById(root).get(id)
const textOf = n => n.toArray().filter(x => typeof x === 'string').join('')

// ───────────────────────────────── the document artifact ─────────────────────────────────
const runDocument = async (mechanism, undoPolicy = "keep") => {
  let fake = 0
  const clock = () => T0 + (++fake) * 1000
  const hostDoc = new Y.Doc()
  const hub = createHub({ Y, sync, aw, encoding, decoding, hostDoc, clock })
  const store = createStore()
  let landed = 0
  const land = () => { while (landed < hub.log.length) store.land(hub.log[landed++]) }
  seedDocument(hostDoc, schema, { sections: SECTIONS })
  land()
  const V0 = store.version(hostDoc, { seq: hub.log.length, at: clock(), actor: 'import', kind: 'import' })

  // replicas: the human's Tiptap editor on tab t1, two agents as plain Y replicas
  const hDoc = new Y.Doc(); hub.connect(hDoc, 'human'); hub.flush()
  const el = document.createElement('div'); document.body.appendChild(el)
  const human = new Editor({ element: el, extensions: [...extensions(), YCollaboration.configure({ ytype: tabBody(hDoc, 't1'), syncOptions: { attributedNodes } })], coreExtensionOptions: { delete: { filterTransaction: tr => !isBindingTransaction(tr) } } })
  await tick()
  const settle = async () => { for (let i = 0; i < 3; i++) { hub.flush(); await tick() } land(); human.storage.collaboration.undoManager.stopCapturing() }
  const a1 = new Y.Doc(); hub.connect(a1, 'agent:session-1'); hub.flush()
  const a2 = new Y.Doc(); hub.connect(a2, 'agent:session-2'); hub.flush()

  // ── edits since V0 ──
  // human: keystrokes at the end of s0p2, delete s2p4, heading s3h 2→3, bold in s4h, check s0ti1, callout s1co tone
  const endOf = id => blockPos(human, id) + human.state.doc.nodeAt(blockPos(human, id)).nodeSize - 1
  for (const ch of ' typed by the human') { human.chain().setTextSelection(endOf('s0p2')).insertContent(ch).run(); await settle() }
  const p = blockPos(human, 's2p4'); human.chain().deleteRange({ from: p, to: p + human.state.doc.nodeAt(p).nodeSize }).run(); await settle()
  human.chain().setTextSelection(blockPos(human, 's3h') + 2).setNode('heading', { level: 3 }).run(); await settle()
  human.chain().setTextSelection({ from: blockPos(human, 's4h') + 1, to: blockPos(human, 's4h') + 8 }).setMark('bold').run(); await settle()
  human.chain().command(({ tr }) => { tr.setNodeAttribute(blockPos(human, 's0ti1'), 'checked', true); return true }).run(); await settle()
  human.chain().command(({ tr }) => { tr.setNodeAttribute(blockPos(human, 's1co'), 'tone', 'warn'); return true }).run(); await settle()
  // human: a new comment thread th3 on part of s9p2 (mark in the text + entry in the threads map)
  const s9 = blockPos(human, 's9p2')
  human.chain().setTextSelection({ from: s9 + 1, to: s9 + 10 }).setMark('comment', { threadId: 'th3', orphan: false }).run(); await settle()
  hDoc.transact(() => { const t = new Y.Node('thread'); hDoc.get('threads').setAttr('th3', t); t.setAttr('quote', 'x'); t.setAttr('resolved', false); t.setAttr('author', 'human') }); await settle()
  // agent 1: rewrite in s5p2, a new paragraph nA1 after s6h, a table cell, the code block's text and language
  const a1t1 = tabBody(a1, 't1')
  a1.transact(() => { const n = yBlock(a1t1, 's5p2'); const len = textOf(n).length; n.delete(0, Math.min(20, len)); n.insert(0, 'Rewritten by agent one: ') }); await settle()
  a1.transact(() => { const idx = a1t1.toArray().findIndex(c => c.getAttr('id') === 's6h'); a1t1.insert(idx + 1, [pmnodeToDelta(schema.nodes.paragraph.create({ id: 'nA1' }, schema.text('Agent one inserted this paragraph.')))]) }); await settle()
  a1.transact(() => { const c = yBlock(a1t1, 's7r1c1p'); c.delete(0, textOf(c).length); c.insert(0, '99') }); await settle()
  a1.transact(() => { const c = yBlock(a1t1, 's8c'); c.insert(textOf(c).length, '\nconsole.log("more")'); c.setAttr('language', 'ts') }); await settle()
  // agent 1: tab t2 renamed and edited (text added, a block deleted), a new tab t3
  a1.transact(() => { const t2 = a1.get('tabs').getAttr('t2'); t2.setAttr('title', 'Appendix B'); const b = t2.getAttr('body'); const x2 = yBlock(b, 'x2'); x2.insert(textOf(x2).length, ' Updated by the agent.'); const i = b.toArray().findIndex(c => c.getAttr('id') === 'x3'); b.delete(i, 1) }); await settle()
  a1.transact(() => { const t = new Y.Node('tab'); a1.get('tabs').setAttr('t3', t); t.setAttr('title', 'Scratch'); t.setAttr('order', 'a2'); const b = new Y.Node('doc'); t.setAttr('body', b); b.applyDelta(pmnodeToDelta(schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: 'z1' }, content: [{ type: 'text', text: 'New tab.' }] }] }))) }); await settle()
  // agent 1 moves s11p1 after s11p4 (the patch writer's move: delete, re-insert the same node with its id); the human types inside th1's marked text
  a1.transact(() => { const arr = a1t1.toArray(); const i = arr.findIndex(c => c.getAttr("id") === "s11p1"); const d = arr[i].toDeltaDeep(); a1t1.delete(i, 1); const j = a1t1.toArray().findIndex(c => c.getAttr("id") === "s11p4"); a1t1.insert(j + 1, [d]) }); await settle()
  { const at = findPos(human, "bold words") + 5; human.chain().setTextSelection(at).insertContent("NEW ").run(); await settle() }
  // agent 1 replaces paragraph s20p2 by a new paragraph nB at the same index (delete + insert, a new id)
  a1.transact(() => { const i = a1t1.toArray().findIndex(c => c.getAttr("id") === "s20p2"); a1t1.delete(i, 1); a1t1.insert(i, [pmnodeToDelta(schema.nodes.paragraph.create({ id: "nB" }, schema.text("Replacement paragraph written by agent one.")))]) }); await settle()
  // the human resolves th2
  hDoc.transact(() => hDoc.get('threads').getAttr('th2').setAttr('resolved', true)); await settle()
  const L = store.version(hostDoc, { seq: hub.log.length, at: clock(), actor: 'human', kind: 'auto' })
  const liveCanon = canon(hostDoc, schema)
  const docOf = state => { const d = new Y.Doc(); Y.applyUpdateV2(d, state); return d }
  const v0Canon = canon(docOf(V0.state), schema)

  // ── the restore, with a concurrent agent edit in flight ──
  const t0 = performance.now()
  const R = mechanism === 'revert' ? revertUpdate(V0.state, Y.encodeStateAsUpdateV2(hostDoc))
    : diffUpdate(V0.state, Y.encodeStateAsUpdateV2(hostDoc), mechanism === 'diff-by-id' ? { compare: byId } : {})
  const msCompute = performance.now() - t0
  // agent 2 edits on its replica before seeing the restore: one edit in content the restore keeps, one in content it removes
  const a2t1 = tabBody(a2, 't1')
  a2.transact(() => { const n = yBlock(a2t1, 's10p2'); n.insert(textOf(n).length, ' [concurrent]') })
  a2.transact(() => { const n = yBlock(a2t1, 'nA1'); n.insert(0, '[into-removed] ') })
  a2.transact(() => { const n = yBlock(a2t1, "s5p2"); n.insert(9, "[c2]") })
  a2.transact(() => { const n = yBlock(a2t1, "nB"); n.insert(0, "[into-replacement] ") })
  const t1 = performance.now()
  Y.applyUpdateV2(hostDoc, R, { actor: 'human:restore' })
  const msApply = performance.now() - t1
  await settle()
  const after = canon(hostDoc, schema)

  // ── checks ──
  const checks = []
  const ck = (name, ok, got) => checks.push({ name, ok: !!ok, got })
  const conv = [hDoc, a1, a2].every(d => JSON.stringify(canon(d, schema)) === JSON.stringify(after))
  ck('replicas converge (human, agent 1, agent 2)', conv)
  const bodyV0 = v0Canon.tabs.t1.body.content; const bodyAfter = after.tabs.t1.body.content
  const diffBlocks = []
  const flat = arr => { const m = new Map(); const walk = n => { if (n.attrs?.id) m.set(n.attrs.id, JSON.stringify(n)); for (const c of n.content ?? []) walk(c) }; arr.forEach(walk); return m }
  const fv0 = flat(bodyV0); const fa = flat(bodyAfter)
  for (const [id, j] of fa) if (fv0.get(id) !== j && !['s10p2', 's5p2'].includes(id)) diffBlocks.push(id)
  for (const id of fv0.keys()) if (!fa.has(id)) diffBlocks.push('missing:' + id)
  const s10 = JSON.parse(fa.get('s10p2') ?? 'null')
  ck('tab t1 equals V0 except the concurrent edit (no other block differs)', diffBlocks.length === 0, diffBlocks.slice(0, 12).join(','))
  ck('concurrent edit in kept content survives (s10p2 ends with " [concurrent]")', s10 && JSON.stringify(s10).includes(' [concurrent]'))
  ck('concurrent edit into removed content is dropped (CRDT rule: nA1 gone)', !fa.has('nA1'))
  { const tx = (JSON.parse(fa.get("s5p2")).content ?? []).map(t => t.text).join(""); const v0tx = (JSON.parse(fv0.get("s5p2")).content ?? []).map(t => t.text).join(""); ck("concurrent insert inside rewritten text (s5p2) survives; the rest is V0", tx.includes("[c2]") && tx.replace("[c2]", "") === v0tx, JSON.stringify(tx.slice(0, 50))) }
  ck("moved block s11p1 back at its V0 place; th1 mark span back to \"bold words\"", blockIds(tabBody(hostDoc, "t1")).indexOf("s11p1") === blockIds(tabBody(docOf(V0.state), "t1")).indexOf("s11p1") && fa.get("s0p1") === fv0.get("s0p1"))
  ck("replaced paragraph: s20p2 back exactly as V0, nB gone, the concurrent edit into nB not grafted into s20p2", fa.get("s20p2") === fv0.get("s20p2") && !fa.has("nB"), (fa.get("s20p2") ?? "").slice(0, 120))
  ck('block ids in V0 order, none duplicated', JSON.stringify(blockIds(tabBody(hostDoc, 't1'))) === JSON.stringify(blockIds((() => { const d = new Y.Doc(); Y.applyUpdateV2(d, V0.state); return tabBody(d, 't1') })())))
  ck('deleted paragraph s2p4 back', fa.has('s2p4'))
  ck('heading s3h level back to 2', JSON.parse(fa.get('s3h')).attrs.level === 2)
  ck('task s0ti1 unchecked again', JSON.parse(fa.get('s0ti1')).attrs.checked === false)
  ck('callout s1co tone back to info', JSON.parse(fa.get('s1co')).attrs.tone === 'info')
  ck('bold in s4h removed', !JSON.stringify(JSON.parse(fa.get('s4h'))).includes('"bold"'))
  ck('code block s8c text and language back', JSON.stringify(JSON.parse(fa.get('s8c'))) === fv0.get('s8c'))
  ck('table cell s7r1c1p back', fa.get('s7r1c1p') === fv0.get('s7r1c1p'))
  ck('tab t2 title back to "Appendix"', after.tabs.t2?.title === 'Appendix', after.tabs.t2?.title)
  ck('tab t2 body equals V0 (x3 back, x2 text back)', JSON.stringify(after.tabs.t2?.body) === JSON.stringify(v0Canon.tabs.t2.body))
  ck('tab t3 (created since) gone', after.tabs.t3 === undefined, Object.keys(after.tabs).join(','))
  const thr = hostDoc.get('threads')
  ck('thread th2 (resolved since) unresolved again', thr.getAttr('th2')?.getAttr('resolved') === false)
  ck('thread th3 (created since) gone', thr.getAttr('th3') === undefined)
  ck('comment marks: th1 and th2 present, th3 gone', JSON.stringify(commentThreads({ content: bodyAfter })) === JSON.stringify(['th1', 'th2']), commentThreads({ content: bodyAfter }).join(','))
  ck('threads map equals V0', JSON.stringify(after.threads) === JSON.stringify(v0Canon.threads))
  const edJSON = human.getJSON()
  let edCheck = null; try { human.state.doc.check() } catch (e) { edCheck = e.message }
  ck('human editor shows the restored doc (= host t1), doc.check() valid', JSON.stringify(edJSON) === JSON.stringify(ynodeToPmnode(tabBody(hostDoc, 't1'), schema).toJSON()) && !edCheck, edCheck)

  // ── attribution: the restore credits the restorer; untouched content keeps its authors ──
  land()
  const restoreRows = store.log.filter(e => e.actor === 'human:restore')
  const After = store.version(hostDoc, { seq: hub.log.length, at: clock(), actor: 'human:restore', kind: 'restore', label: 'Restored from V0' })
  const d = openDiff({ prevState: L.state, nextState: After.state, attributions: store.attributions(), pick: doc => tabBody(doc, 't1') })
  const runs = attributedRuns(renderDiff(d, schema, attributedNodes)); d.destroy()
  const whoRuns = [...new Set(runs.map(r => r.who))].sort()
  ck('diff L→restored attributes every change to the restorer (or the concurrent agent)', whoRuns.every(w => w === 'human:restore' || w === 'agent:session-2'), whoRuns.join(','))
  const prov = store.attributions()
  const ed = (id, pm) => { const pos = (() => { let at = -1; pm.descendants((n, ps) => { if (at < 0 && n.attrs?.id === id) at = ps }); return at })(); const n = pm.nodeAt(pos); return showEditors({ pmDoc: pm, from: pos, to: pos + n.nodeSize, liveRoot: tabBody(hostDoc, 't1'), provenance: prov }) }
  const livePm = ynodeToPmnode(tabBody(hostDoc, 't1'), schema)
  const untouched = ed('s12p2', livePm)
  ck('untouched paragraph s12p2: editors = import only', untouched.length === 1 && untouched[0].who === 'import', JSON.stringify(untouched))
  const restoredP = ed('s2p4', livePm)
  ck('restored paragraph s2p4: credited to the restorer', restoredP.some(e => e.who === 'human:restore'), JSON.stringify(restoredP))
  const s10eds = ed('s10p2', livePm)
  ck('s10p2: import + agent 2 (concurrent), not the restorer', s10eds.some(e => e.who === 'agent:session-2') && !s10eds.some(e => e.who === 'human:restore'), JSON.stringify(s10eds))

  // ── #72's neighbourhood: undo after a restore. The human's undo stack still holds pre-restore edits; undoing a
  //    deletion the restore already brought back re-inserts the original item a second time. Policy 'clear' empties
  //    every bound editor's UndoManager when a restore lands (the host would signal it). ──
  const um = human.storage.collaboration.undoManager
  const stackBefore = um.undoStack.length
  if (undoPolicy === 'clear') um.clear()
  const steps = []
  let n = 0
  const firstUndoReturned = human.commands.undo(); await settle()
  do {
    const ids = blockIds(tabBody(hostDoc, 't1'))
    const dups = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))]
    const fNow = flat(canon(hostDoc, schema).tabs.t1.body.content)
    steps.push({ step: n, dups, changedVsRestored: [...fNow].filter(([id, j]) => fa.get(id) !== j).map(([id]) => id).slice(0, 6) })
    if (!um.undoStack.length) break
    human.commands.undo(); await settle()
  } while (++n < 200)
  const dupSteps = steps.filter(s => s.dups.length)
  ck(`undo after restore (policy ${undoPolicy}): no undo step duplicates a block id`, dupSteps.length === 0, JSON.stringify(dupSteps.slice(0, 3)))
  if (undoPolicy === 'clear') ck('policy clear: undo is a no-op and the restored doc stays', firstUndoReturned === false && JSON.stringify(canon(hostDoc, schema)) === JSON.stringify(after))

  // ── "never destroys": restoring the version taken just before the restore brings the pre-restore state back ──
  let reverse = null
  if (undoPolicy === 'clear') {
    const R2 = mechanism === 'revert' ? revertUpdate(L.state, Y.encodeStateAsUpdateV2(hostDoc)) : diffUpdate(L.state, Y.encodeStateAsUpdateV2(hostDoc), mechanism === 'diff-by-id' ? { compare: byId } : {})
    Y.applyUpdateV2(hostDoc, R2, { actor: 'human:restore' }); await settle()
    const back = canon(hostDoc, schema)
    const fb = flat(back.tabs.t1.body.content); const fl = flat(liveCanon.tabs.t1.body.content)
    const differ = [...new Set([...fb.keys(), ...fl.keys()])].filter(id => fb.get(id) !== fl.get(id))
    reverse = { bytes: R2.length, differ }
    ck('restore of the pre-restore version gives L back exactly (the concurrent edits, made after L, are undone too)', differ.length === 0 && JSON.stringify(back.threads) === JSON.stringify(liveCanon.threads) && JSON.stringify(Object.keys(back.tabs)) === JSON.stringify(Object.keys(liveCanon.tabs)) && back.tabs.t2.title === 'Appendix B', differ.join(','))
  }

  const res = {
    mechanism, undoPolicy,
    sizes: { V0: V0.state.length, live: L.state.length, restoreUpdate: R.length, restoreLogRows: restoreRows.length, provenanceBytes: store.provenanceBytes() },
    ms: { compute: +msCompute.toFixed(1), applyAtHost: +msApply.toFixed(1) },
    doc: { topLevelBlocks: tabBody(hostDoc, 't1').length, ids: blockIds(tabBody(hostDoc, 't1')).length, chars: livePm.textContent.length },
    checks,
    undoAfterRestore: { stackBefore, firstUndoReturned, dupSteps: dupSteps.slice(0, 5), steps: steps.length },
    reverse
  }
  human.destroy()
  return res
}

// ───────────────────────────────── the deck artifact ─────────────────────────────────
const runDeck = async (mechanism) => {
  let fake = 0
  const clock = () => T0 + (++fake) * 1000
  const hostDoc = new Y.Doc()
  const hub = createHub({ Y, sync, aw, encoding, decoding, hostDoc, clock })
  seedDeck(hostDoc)
  const V0 = Y.encodeStateAsUpdateV2(hostDoc)
  const v0 = new Y.Doc(); Y.applyUpdateV2(v0, V0)
  const h = new Y.Doc(); hub.connect(h, 'human'); hub.flush()
  const a1 = new Y.Doc(); hub.connect(a1, 'agent:session-1'); hub.flush()
  const a2 = new Y.Doc(); hub.connect(a2, 'agent:session-2'); hub.flush()
  const S = d => d.get('slides')
  // since V0: delete s3, add s13, move s1/e2, retitle the deck, reorder s2, edit s4 notes, edit s6/e3 text, delete s7/e4, resolve dk1
  h.transact(() => S(h).deleteAttr('s3'))
  h.transact(() => { const e = S(h).getAttr('s1').getAttr('elements').getAttr('e2'); e.setAttr('style:left', '900px'); e.setAttr('style:top', '700px') })
  h.transact(() => S(h).getAttr('s2').setAttr('order', 'a115'))
  hub.flush()
  a1.transact(() => { const s = new Y.Node('slide'); S(a1).setAttr('s13', s); s.setAttr('order', 'a13'); const els = new Y.Node('elements'); s.setAttr('elements', els); const e = new Y.Node('el'); els.setAttr('e1', e); e.setAttr('tag', 'h1'); const tx = new Y.Node('text'); e.setAttr('text', tx); tx.insert(0, 'Agent slide') })
  a1.transact(() => a1.get('deck').setAttr('title', 'Launch review v2'))
  a1.transact(() => { const n = S(a1).getAttr('s4').getAttr('notes'); n.insert(n.length, ' Agent added a note.') })
  a1.transact(() => { const t = S(a1).getAttr('s6').getAttr('elements').getAttr('e3').getAttr('text'); t.delete(0, 4); t.insert(0, 'Edited') })
  a1.transact(() => S(a1).getAttr('s7').getAttr('elements').deleteAttr('e4'))
  a1.transact(() => a1.get('threads').getAttr('dk1').setAttr('resolved', true))
  hub.flush()
  const live = Y.encodeStateAsUpdateV2(hostDoc)
  const t0 = performance.now()
  const R = mechanism === 'revert' ? revertUpdate(V0, live) : diffUpdate(V0, live, mechanism === 'diff-by-id' ? { compare: byId } : {})
  const msCompute = performance.now() - t0
  // concurrent: agent 2 moves s8/e1 and edits s9's notes; and edits inside s13 (removed by the restore)
  a2.transact(() => S(a2).getAttr('s8').getAttr('elements').getAttr('e1').setAttr('style:left', '333px'))
  a2.transact(() => { const n = S(a2).getAttr('s9').getAttr('notes'); n.insert(n.length, ' [concurrent]') })
  a2.transact(() => S(a2).getAttr('s13').getAttr('elements').getAttr('e1').setAttr('style:left', '1px'))
  Y.applyUpdateV2(hostDoc, R, { actor: 'human:restore' })
  hub.flush()
  const checks = []
  const ck = (name, ok, got) => checks.push({ name, ok: !!ok, got })
  const J = d => JSON.stringify({ deck: d.get('deck').toDeltaDeep().toJSON(), slides: d.get('slides').toDeltaDeep().toJSON(), threads: d.get('threads').toDeltaDeep().toJSON() })
  ck('replicas converge', [h, a1, a2].every(d => J(d) === J(hostDoc)))
  const sl = S(hostDoc)
  ck('slide s3 (deleted since) back with its 5 elements, notes and text', sl.getAttr('s3') && Object.keys(sl.getAttr('s3').getAttr('elements').getAttrs()).length === 5 && textOf(sl.getAttr('s3').getAttr('notes')) === 'Speaker notes for slide 3.' && textOf(sl.getAttr('s3').getAttr('elements').getAttr('e1').getAttr('text')) === 'Slide 3 title')
  ck('slide s13 (added since) gone', sl.getAttr('s13') === undefined)
  ck('moved element s1/e2 back', sl.getAttr('s1').getAttr('elements').getAttr('e2').getAttr('style:left') === '208px' && sl.getAttr('s1').getAttr('elements').getAttr('e2').getAttr('style:top') === '308px', sl.getAttr('s1').getAttr('elements').getAttr('e2').getAttr('style:left'))
  ck('deck title back', hostDoc.get('deck').getAttr('title') === 'Launch review')
  ck('slide order s2 back', sl.getAttr('s2').getAttr('order') === 'a02')
  ck('notes s4 back', textOf(sl.getAttr('s4').getAttr('notes')) === 'Speaker notes for slide 4.')
  ck('element text s6/e3 back', textOf(sl.getAttr('s6').getAttr('elements').getAttr('e3').getAttr('text')) === 'Body text 6.3')
  ck('deleted element s7/e4 back', sl.getAttr('s7').getAttr('elements').getAttr('e4') !== undefined)
  ck('thread dk1 unresolved', hostDoc.get('threads').getAttr('dk1').getAttr('resolved') === false)
  ck('concurrent move s8/e1 survives', sl.getAttr('s8').getAttr('elements').getAttr('e1').getAttr('style:left') === '333px')
  ck('concurrent notes edit s9 survives', textOf(sl.getAttr('s9').getAttr('notes')).endsWith(' [concurrent]'))
  // equality with V0 apart from the two concurrent edits
  const exp = new Y.Doc(); Y.applyUpdateV2(exp, V0)
  exp.transact(() => { S(exp).getAttr('s8').getAttr('elements').getAttr('e1').setAttr('style:left', '333px'); const n = S(exp).getAttr('s9').getAttr('notes'); n.insert(n.length, ' [concurrent]') })
  ck('deck equals V0 plus the concurrent edits (deep)', J(hostDoc) === J(exp))
  return { mechanism, sizes: { V0: V0.length, live: live.length, restoreUpdate: R.length }, ms: { compute: +msCompute.toFixed(2) }, checks }
}

const out = { document: [], deck: [] }
const plan = [["document", "revert", "keep"], ["document", "revert", "clear"], ["deck", "revert"], ["document", "diff", "clear"], ["deck", "diff"], ["document", "diff-by-id", "clear"], ["deck", "diff-by-id"]]
for (const [kind, m, policy] of plan) {
  {
    const run = kind === "document" ? runDocument : runDeck
    let r
    try { r = await run(m, policy) } catch (e) { r = { mechanism: m, error: e.stack.split('\n').slice(0, 4).join(' | ') } }
    out[kind].push(r)
    say(`\n== ${kind} / ${m}${policy ? " / undo " + policy : ""} ==`)
    if (r.error) { say('  ERROR', r.error); continue }
    say(`  sizes ${JSON.stringify(r.sizes)}  ms ${JSON.stringify(r.ms)}${r.doc ? '  doc ' + JSON.stringify(r.doc) : ''}`)
    for (const c of r.checks) say(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.got !== undefined && (!c.ok || c.name.startsWith('restored') || c.name.startsWith('untouched') || c.name.startsWith('s10')) ? '  → ' + c.got : ''}`)
    say(`  passed ${r.checks.filter(c => c.ok).length}/${r.checks.length}`)
    if (r.undoAfterRestore) say('  undo after restore:', JSON.stringify(r.undoAfterRestore))
  }
}
writeFileSync(new URL(`./out/restore${SUFFIX}.json`, import.meta.url), JSON.stringify(out, null, 2))
writeFileSync(new URL(`./out/restore${SUFFIX}.txt`, import.meta.url), lines.join('\n') + '\n')
process.exit(0)
