// S1 scenario 3 on Yjs v14: two stored full V2 states of a gc-on live doc, rendered as a diff by DiffRenderer with
// attributions built per update from the host's author log (actor, at), headless (ynodeToPmnode) and in a read-only
// Tiptap editor; then the editor leaves history by rebinding to the live doc. Run:
//   node spikes/p3-store/s1/v14/s1-history.mjs   (writes out/v14-history.json)
import { tick } from '../lib/dom.mjs'
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import * as sync from '@y/protocols/sync'
import * as aw from '@y/protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Editor } from '@tiptap/core'
import { pmnodeToDelta, ynodeToPmnode, configureYProsemirror } from '@y/prosemirror'
import { extensions, schemaFor, attributedNodes } from './schema.mjs'
import { YCollaboration } from './collab.mjs'
import { createHub } from '../lib/link.mjs'
import { seedJSON, spans, score } from '../lib/history-fixture.mjs'

const T0 = Date.parse('2026-10-12T09:00:00Z')
let fake = 0
const clock = () => T0 + (++fake) * 1000
const schema = schemaFor()
const hostDoc = new Y.Doc() // gc on (default)
const hub = createHub({ Y, sync, aw, encoding, decoding, hostDoc, clock })
const live = hostDoc.get('default')
hostDoc.transact(() => live.applyDelta(pmnodeToDelta(schema.nodeFromJSON(seedJSON))), { actor: 'import' })
const v1 = Y.encodeStateAsUpdateV2(hostDoc)
const v1Seq = hub.log.length

// the human's replica: a Tiptap editor
const hDoc = new Y.Doc()
hub.connect(hDoc, 'human'); hub.flush()
const el = document.createElement('div'); document.body.appendChild(el)
const human = new Editor({ element: el, extensions: [...extensions(), YCollaboration.configure({ ytype: hDoc.get('default') })] })
await tick()
const settle = async () => { for (let i = 0; i < 3; i++) { hub.flush(); await tick() } }
const findPos = (ed, needle) => { let at = -1; ed.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) }); return at }

// the agent's replica: plain Y ops, no DOM
const aDoc = new Y.Doc()
hub.connect(aDoc, 'agent:session-1'); hub.flush()
const aRoot = aDoc.get('default')
const byId = (node, id) => { for (const c of node.toArray()) { if (c && c.name) { if (c.getAttr('id') === id) return c; const r = byId(c, id); if (r) return r } } return null }
const textIndex = (node, needle) => node.toString().replace(/<[^>]*>/g, '').indexOf(needle)

// ── edits between v1 and v2 ──
// human: append to p1, bold "opening", heading level 2 → 3, delete "Closing " in p4
human.chain().setTextSelection(findPos(human, 'second sentence.') + 'second sentence.'.length).insertContent(' Added by human.').run(); await settle()
human.chain().setTextSelection({ from: findPos(human, 'opening'), to: findPos(human, 'opening') + 7 }).setMark('bold').run(); await settle()
human.chain().setTextSelection(findPos(human, 'Quarterly') + 2).setNode('heading', { level: 3 }).run(); await settle()
human.chain().deleteRange({ from: findPos(human, 'Closing '), to: findPos(human, 'Closing ') + 8 }).run(); await settle()
// agent: a note inside the human's paragraph, a rewrite in p2, a new paragraph, the code block's text and language, a table cell
aDoc.transact(() => { const p1 = byId(aRoot, 'p1'); p1.insert(textIndex(p1, ' It has'), ' (agent note)') }); await settle()
aDoc.transact(() => { const p2 = byId(aRoot, 'p2'); const i = textIndex(p2, 'the middle of'); p2.delete(i, 'the middle of'.length); p2.insert(i, 'a part of') }); await settle()
aDoc.transact(() => {
  const idx = aRoot.toArray().findIndex(c => c.getAttr('id') === 'p2')
  aRoot.insert(idx + 1, [pmnodeToDelta(schema.nodes.paragraph.create({ id: 'pA' }, schema.text('Agent inserted paragraph.')))])
}); await settle()
aDoc.transact(() => { const c1 = byId(aRoot, 'c1'); const n = c1.length; c1.delete(n - 1, 1); c1.insert(n - 1, '3\nconst c = 4'); c1.setAttr('language', 'ts') }); await settle()
aDoc.transact(() => { const cell = byId(aRoot, 'td2p'); cell.delete(0, 1); cell.insert(0, '42') }); await settle()

const v2 = Y.encodeStateAsUpdateV2(hostDoc)
const window = hub.log.filter(e => e.seq > v1Seq)
console.log('log window:', window.map(e => `${e.seq}:${e.actor}`).join(' '))

// ── attributions from the author log: one ContentMap per update, merged ──
const t0 = performance.now()
const attributions = Y.mergeContentMaps(window.map(e => Y.createContentMapFromContentIds(
  Y.createContentIdsFromUpdateV2(e.v2),
  [Y.createContentAttribute('insert', e.actor), Y.createContentAttribute('insertAt', e.at)],
  [Y.createContentAttribute('delete', e.actor), Y.createContentAttribute('deleteAt', e.at)]
)))
const prevDoc = new Y.Doc({ gc: false }); Y.applyUpdateV2(prevDoc, v1)
const nextDoc = new Y.Doc({ gc: false }); Y.applyUpdateV2(nextDoc, v2)
const before = { prev: Y.encodeStateAsUpdateV2(prevDoc).length, next: Y.encodeStateAsUpdateV2(nextDoc).length, sv: Y.encodeStateVector(nextDoc).toString() }
const renderer = Y.createDiffRenderer(prevDoc, nextDoc, { attributions })
const headless = ynodeToPmnode(nextDoc.get('default'), schema, { renderer, attributedNodes })
const msHeadless = performance.now() - t0

// how the v14 marks read: insert/delete/format carry userIds + timestamp; attrs carries { changes: { attr: {userIds, timestamp} } }
const iso = t => (t ? new Date(t).toISOString().slice(11, 19) : undefined)
const read = (m) => {
  if (m.type === 'y-attributed-insert') return { kind: 'ins', who: m.attrs?.userIds?.[0], at: iso(m.attrs?.timestamp) }
  if (m.type === 'y-attributed-delete') return { kind: 'del', who: m.attrs?.userIds?.[0], at: iso(m.attrs?.timestamp) }
  if (m.type === 'y-attributed-format') return { kind: 'fmt', who: m.attrs?.userIds?.[0], at: iso(m.attrs?.timestamp), byAttr: m.attrs?.userIdsByAttr }
  if (m.type === 'y-attributed-attrs') return Object.entries(m.attrs?.changes ?? {}).map(([attr, c]) => ({ kind: 'attrs', attr, who: c?.userIds?.[0], at: iso(c?.timestamp) }))
  return null
}
const hSpans = spans(headless.toJSON(), read)
const hScore = score(hSpans)
let checkError = null
try { headless.check() } catch (e) { checkError = e.message }

// ── the same in a read-only Tiptap editor, then leave history by rebinding to the live replica ──
const vel = document.createElement('div'); document.body.appendChild(vel)
const viewer = new Editor({ element: vel, editable: false, extensions: [...extensions({ uniqueId: false }), YCollaboration.configure({ ytype: nextDoc.get('default'), renderer, syncOptions: { attributedNodes } })] })
await tick(); await tick()
const eSpans = spans(viewer.getJSON(), read)
const eScore = score(eSpans)
const after = { prev: Y.encodeStateAsUpdateV2(prevDoc).length, next: Y.encodeStateAsUpdateV2(nextDoc).length, sv: Y.encodeStateVector(nextDoc).toString() }
const domSample = vel.querySelector('.ProseMirror').innerHTML.slice(0, 600)
const liveBefore = live.toString()
const vDoc = new Y.Doc(); hub.connect(vDoc, 'human-viewer'); hub.flush()
configureYProsemirror({ ytype: vDoc.get('default'), renderer: null })(viewer.state, viewer.view.dispatch)
viewer.setEditable(true)
await tick(); hub.flush()
const exitOk = viewer.getText() === human.getText()
viewer.chain().setTextSelection(findPos(viewer, 'Quarterly')).insertContent('Q4 ').run(); await settle()
const liveAfterExit = live.toString()

const out = {
  sizes: { v1: v1.length, v2: v2.length, logWindowBytes: window.reduce((s, e) => s + e.v2.length, 0), attributionsEncoded: Y.encodeContentMap(attributions).length },
  msHeadlessRender: Math.round(msHeadless * 10) / 10,
  headless: { score: hScore, spans: hSpans, checkError },
  editor: { score: eScore, versionDocsUnchanged: JSON.stringify(before) === JSON.stringify(after), before, after, domSample },
  exit: { rebindShowsLive: exitOk, liveUnchangedByHistory: liveBefore === liveAfterExit.replace('Q4 ', ''), typingAfterExitReachesLive: liveAfterExit.includes('Q4 Quarterly') }
}
writeFileSync(new URL('../out/v14-history.json', import.meta.url), JSON.stringify(out, null, 2))
const show = (label, sc) => { console.log(`\n${label}: ${sc.filter(s => s.ok).length}/${sc.length}`); for (const s of sc) console.log(`  ${s.ok ? 'ok ' : 'MISS'} ${s.id.padEnd(20)} ${s.got}`) }
show('v14 headless (ynodeToPmnode + DiffRenderer)', hScore)
show('v14 editor (read-only Tiptap + DiffRenderer)', eScore)
console.log('\nspans (headless):'); for (const s of hSpans.filter(s => s.kind !== 'none')) console.log(`  ${s.where} ${s.kind}${s.attr ? '(' + s.attr + ')' : ''} by ${s.who} at ${s.at} ${s.node ? '[node]' : JSON.stringify(s.text)}`)
console.log('\nheadless doc.check():', checkError ?? 'valid', '| version docs unchanged by the editor render:', out.editor.versionDocsUnchanged, '| exit:', JSON.stringify(out.exit))
console.log('sizes:', JSON.stringify(out.sizes), '| headless render ms:', out.msHeadlessRender)
process.exit(0)
