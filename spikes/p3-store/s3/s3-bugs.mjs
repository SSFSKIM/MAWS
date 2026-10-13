// S3 item 4: y-prosemirror's five "not planned" 1.x history bugs (#72, #82, #128, #177, #189) re-tested on v14
// (`@y/y` rc.28, `@y/prosemirror` 2.0.0-15) on the §4.4 schema, plus what else bites: attributes on callouts and
// images, code blocks, tables (rows, columns, marks in cells), nested lists (indent, outdent, type toggle), node type
// changes, deleted containers. Each case: a fresh doc, one edit (the human's editor or an agent replica), the diff of
// the two states rendered headless and in a real read-only Tiptap editor (showVersion), checked.
// Run: node spikes/p3-store/s3/s3-bugs.mjs   (writes s3/out/bugs.json and bugs.txt)
import { tick } from '../s1/lib/dom.mjs'
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import * as sync from '@y/protocols/sync'
import * as aw from '@y/protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Editor } from '@tiptap/core'
import { pmnodeToDelta } from '@y/prosemirror'
import { createHub } from '../s1/lib/link.mjs'
import { extensions, schemaFor, attributedNodes } from './lib/schema.mjs'
import { YCollaboration, isBindingTransaction } from './lib/collab.mjs'
import { tabBody } from './lib/artifact.mjs'
import { contentMapOf } from './lib/provenance.mjs'
import { openDiff, renderDiff, attributedRuns, changeList, indexById } from './lib/history.mjs'

const schema = schemaFor()
const t = (text, marks) => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const P = (id, ...c) => ({ type: 'paragraph', attrs: { id }, content: c })
const BASE = { type: 'doc', content: [
  { type: 'heading', attrs: { level: 3, id: 'hX' }, content: [t('Heading three')] },
  P('p1', t('Plain text with a '), t('link', [{ type: 'link', attrs: { href: 'https://a.example' } }]), t(' and '), { type: 'image', attrs: { src: 'asset://one.png', alt: 'one', assetId: 'one' } }),
  { type: 'callout', attrs: { id: 'co', tone: 'warn' }, content: [P('cop', t('Callout text'))] },
  { type: 'taskList', attrs: { id: 'tl' }, content: [
    { type: 'taskItem', attrs: { id: 'ti1', checked: true }, content: [P('ti1p', t('Done item'))] },
    { type: 'taskItem', attrs: { id: 'ti2', checked: false }, content: [P('ti2p', t('Open item'))] }] },
  { type: 'codeBlock', attrs: { id: 'cb', language: 'py' }, content: [t("print('x')")] },
  { type: 'bulletList', attrs: { id: 'ul' }, content: [
    { type: 'listItem', attrs: { id: 'li1' }, content: [P('li1p', t('one'))] },
    { type: 'listItem', attrs: { id: 'li2' }, content: [P('li2p', t('two')), { type: 'bulletList', attrs: { id: 'ul2' }, content: [{ type: 'listItem', attrs: { id: 'li3' }, content: [P('li3p', t('three'))] }] }] },
    { type: 'listItem', attrs: { id: 'li4' }, content: [P('li4p', t('four'))] }] },
  { type: 'table', attrs: { id: 'tb' }, content: [
    { type: 'tableRow', attrs: { id: 'r0' }, content: [{ type: 'tableHeader', attrs: { id: 'r0a' }, content: [P('r0ap', t('A'))] }, { type: 'tableHeader', attrs: { id: 'r0b' }, content: [P('r0bp', t('B'))] }] },
    { type: 'tableRow', attrs: { id: 'r1' }, content: [{ type: 'tableCell', attrs: { id: 'r1a' }, content: [P('r1ap', t('c1'))] }, { type: 'tableCell', attrs: { id: 'r1b' }, content: [P('r1bp', t('d1'))] }] },
    { type: 'tableRow', attrs: { id: 'r2' }, content: [{ type: 'tableCell', attrs: { id: 'r2a' }, content: [P('r2ap', t('e1'))] }, { type: 'tableCell', attrs: { id: 'r2b' }, content: [P('r2bp', t('f1'))] }] }] },
  { type: 'blockquote', attrs: { id: 'q' }, content: [P('qp', t('Quoted'))] },
  P('p2', t('Last paragraph.'))
] }

const blockPos = (ed, id) => { let at = -1; ed.state.doc.descendants((n, pos) => { if (at < 0 && n.attrs?.id === id) at = pos }); return at }
const findPos = (ed, needle) => { let at = -1; ed.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) }); return at }
const textOf = n => n.toArray().filter(x => typeof x === 'string').join('')
const delNode = (ed, id) => { const p = blockPos(ed, id); return ed.chain().deleteRange({ from: p, to: p + ed.state.doc.nodeAt(p).nodeSize }).run() }
const setAttr = (ed, id, k, v) => ed.chain().command(({ tr }) => { tr.setNodeAttribute(blockPos(ed, id), k, v); return true }).run()
const imagePos = ed => { let at = -1; ed.state.doc.descendants((n, pos) => { if (at < 0 && n.type.name === 'image') at = pos }); return at }
const yb = (d, id) => indexById(tabBody(d, 't1')).get(id)

// deleted nodes: every node carrying a y-attributed-delete mark, with its attrs (what #82 lost)
const deletedNodes = pm => { const out = []; pm.descendants(n => { if (!n.isText && n.marks.some(m => m.type.name === 'y-attributed-delete')) out.push({ type: n.type.name, attrs: Object.fromEntries(Object.entries(n.attrs).filter(([k]) => k !== 'y-attributed')) }) }); return out }

const CASES = [
  { id: '#82 deleted heading keeps level and id', by: 'human', edit: async h => delNode(h, 'hX'), want: pm => deletedNodes(pm).some(n => n.type === 'heading' && n.attrs.level === 3 && n.attrs.id === 'hX') },
  { id: '#82 deleted callout keeps tone', by: 'human', edit: async h => delNode(h, 'co'), want: pm => deletedNodes(pm).some(n => n.type.startsWith('callout') && n.attrs.tone === 'warn') },
  { id: '#82 deleted image keeps src and alt', by: 'human', edit: async h => { const p = imagePos(h); return h.chain().deleteRange({ from: p, to: p + 1 }).run() }, want: pm => deletedNodes(pm).some(n => n.type === 'image' && n.attrs.src === 'asset://one.png' && n.attrs.alt === 'one') },
  { id: '#82 deleted checked task item keeps checked', by: 'human', edit: async h => delNode(h, 'ti1'), want: pm => deletedNodes(pm).some(n => n.type.startsWith('taskItem') && n.attrs.checked === true) },
  { id: '#82/#189 deleted code block keeps language and text', by: 'human', edit: async h => delNode(h, 'cb'), want: pm => { let ok = false; pm.descendants(n => { if (n.type.name === 'codeBlock' && n.attrs.language === 'py' && n.textContent === "print('x')" && n.marks.some(m => m.type.name === 'y-attributed-delete')) ok = true }); return ok } },
  { id: '#128 no attributions at all (null) renders', by: 'human', noAttributions: true, edit: async h => { h.chain().setTextSelection(findPos(h, 'Last') ).insertContent('NEW ').run() }, want: (pm, runs) => runs.some(r => r.kind === 'ins' && r.text.includes('NEW')) },
  { id: '#177 task item checked toggle shows', by: 'human', edit: async h => setAttr(h, 'ti2', 'checked', true), want: (pm, runs) => runs.some(r => r.kind === 'attrs' && r.attr === 'checked' && r.where === 'taskItem#ti2' && r.who === 'human') },
  { id: '#189 inserted code block renders with its text', by: 'agent', edit: async a => { const b = tabBody(a, 't1'); a.transact(() => b.insert(b.length - 1, [pmnodeToDelta(schema.nodes.codeBlock.create({ id: 'cb2', language: 'ts' }, schema.text('const z = 1')))])) }, want: (pm, runs) => runs.some(r => r.kind === 'ins' && r.where === 'codeBlock#cb2' && r.text.includes('const z = 1')) },
  { id: 'code block: text edit and language change', by: 'agent', edit: async a => { const c = yb(a, 'cb'); a.transact(() => { c.insert(textOf(c).length, '\nprint(1)'); c.setAttr('language', 'python') }) }, want: (pm, runs) => runs.some(r => r.kind === 'ins' && r.where === 'codeBlock#cb') && runs.some(r => r.kind === 'attrs' && r.attr === 'language') },
  { id: 'callout tone change', by: 'human', edit: async h => setAttr(h, 'co', 'tone', 'info'), want: (pm, runs) => runs.some(r => r.kind === 'attrs' && r.attr === 'tone') },
  { id: 'image src and alt change', by: 'human', edit: async h => { const p = imagePos(h); h.chain().command(({ tr }) => { tr.setNodeAttribute(p, 'src', 'asset://two.png'); tr.setNodeAttribute(p, 'alt', 'two'); return true }).run() }, want: (pm, runs) => runs.some(r => r.kind === 'attrs' && r.attr === 'src') && runs.some(r => r.kind === 'attrs' && r.attr === 'alt') },
  { id: 'image inserted inline', by: 'human', edit: async h => h.chain().setTextSelection(findPos(h, 'Last')).insertContent({ type: 'image', attrs: { src: 'asset://three.png', alt: 'three' } }).run(), want: pm => { let ok = false; pm.descendants(n => { if (n.type.name === 'image' && n.attrs.src === 'asset://three.png' && n.marks.some(m => m.type.name === 'y-attributed-insert')) ok = true }); return ok } },
  { id: 'heading level change', by: 'human', edit: async h => h.chain().setTextSelection(blockPos(h, 'hX') + 2).setNode('heading', { level: 1 }).run(), want: (pm, runs) => runs.some(r => r.kind === 'attrs' && r.attr === 'level') },
  { id: 'heading → paragraph (type change)', by: 'human', edit: async h => h.chain().setTextSelection(blockPos(h, 'hX') + 2).setParagraph().run(), want: (pm, runs) => runs.some(r => r.kind === 'del' && r.where.startsWith('heading')) && runs.some(r => r.kind === 'ins' && r.where.startsWith('paragraph')) },
  { id: 'table: add a row', by: 'human', edit: async h => h.chain().setTextSelection(findPos(h, 'e1') + 1).addRowAfter().run(), want: (pm, runs) => runs.some(r => r.kind === 'ins' && r.where.startsWith('tableRow')) },
  { id: 'table: delete a row', by: 'human', edit: async h => h.chain().setTextSelection(findPos(h, 'c1') + 1).deleteRow().run(), want: (pm, runs) => runs.some(r => r.kind === 'del' && (r.where === 'tableRow#r1' || r.text.includes('c1'))) },
  { id: 'table: add a column', by: 'human', edit: async h => h.chain().setTextSelection(findPos(h, 'd1') + 1).addColumnAfter().run(), want: (pm, runs) => runs.some(r => r.kind === 'ins' && /table(Cell|Header)/.test(r.where)) },
  { id: 'table: delete a column', by: 'human', edit: async h => h.chain().setTextSelection(findPos(h, 'd1') + 1).deleteColumn().run(), want: (pm, runs) => runs.some(r => r.kind === 'del' && r.text.includes('d1')) },
  { id: 'table: bold, link and comment marks inside cells', by: 'human', edit: async h => { const p = findPos(h, 'c1'); h.chain().setTextSelection({ from: p, to: p + 2 }).setMark('bold').run(); const q = findPos(h, 'd1'); h.chain().setTextSelection({ from: q, to: q + 2 }).setMark('link', { href: 'https://b.example' }).run(); const r = findPos(h, 'e1'); h.chain().setTextSelection({ from: r, to: r + 2 }).setMark('comment', { threadId: 'thC', orphan: false }).run() }, want: (pm, runs) => ['paragraph#r1ap', 'paragraph#r1bp', 'paragraph#r2ap'].every(w => runs.some(r => r.kind === 'fmt' && r.where === w)) },
  { id: 'link href change (a mark attribute)', by: 'human', edit: async h => { const p = findPos(h, 'link'); h.chain().setTextSelection({ from: p, to: p + 4 }).setMark('link', { href: 'https://changed.example' }).run() }, want: (pm, runs) => runs.some(r => r.kind === 'fmt' && r.where === 'paragraph#p1') },
  { id: 'nested list: indent (sink)', by: 'human', edit: async h => h.chain().setTextSelection(findPos(h, 'four') + 1).sinkListItem('listItem').run(), want: (pm, runs) => runs.some(r => r.text?.includes('four')) },
  { id: 'nested list: outdent (lift)', by: 'human', edit: async h => h.chain().setTextSelection(blockPos(h, 'li3p') + 2).liftListItem('listItem').run(), want: (pm, runs) => runs.some(r => r.text?.includes('three')) },
  { id: 'list type toggle bullet → ordered', by: 'human', edit: async h => h.chain().setTextSelection(blockPos(h, 'li1p') + 2).toggleOrderedList().run(), want: (pm, runs) => runs.some(r => r.kind === 'del') && runs.some(r => r.kind === 'ins') },
  { id: 'deleted list item with a nested list (listItem--attributed)', by: 'human', edit: async h => delNode(h, 'li2'), want: (pm, runs) => runs.some(r => r.kind === 'del' && r.text?.includes('three')) },
  { id: 'deleted blockquote (blockquote--attributed)', by: 'human', edit: async h => delNode(h, 'q'), want: (pm, runs) => runs.some(r => r.kind === 'del' && r.text?.includes('Quoted')) },
  { id: 'agent replaces a callout\'s paragraph text (container kept)', by: 'agent', edit: async a => { const n = yb(a, 'cop'); a.transact(() => { n.delete(0, textOf(n).length); n.insert(0, 'Agent callout') }) }, want: (pm, runs) => runs.some(r => r.kind === 'ins' && r.text.includes('Agent callout') && r.who === 'agent:session-1') && runs.some(r => r.kind === 'del' && r.text.includes('Callout text')) }
]

const results = []
for (const c of CASES) {
  let fake = 0
  const clock = () => Date.parse('2026-10-12T09:00:00Z') + (++fake) * 1000
  const hostDoc = new Y.Doc()
  const hub = createHub({ Y, sync, aw, encoding, decoding, hostDoc, clock })
  hostDoc.transact(() => { const tabs = hostDoc.get('tabs'); const tb = new Y.Node('tab'); tabs.setAttr('t1', tb); const b = new Y.Node('doc'); tb.setAttr('body', b); b.applyDelta(pmnodeToDelta(schema.nodeFromJSON(BASE))) }, { actor: 'import' })
  const prev = Y.encodeStateAsUpdateV2(hostDoc); const seq0 = hub.log.length
  const hDoc = new Y.Doc(); hub.connect(hDoc, 'human'); hub.flush()
  const el = document.createElement('div'); document.body.appendChild(el)
  const human = new Editor({ element: el, extensions: [...extensions(), YCollaboration.configure({ ytype: tabBody(hDoc, 't1'), syncOptions: { attributedNodes } })], coreExtensionOptions: { delete: { filterTransaction: tr => !isBindingTransaction(tr) } } })
  await tick()
  const aDoc = new Y.Doc(); hub.connect(aDoc, 'agent:session-1'); hub.flush()
  const r = { id: c.id }
  try {
    await c.edit(c.by === 'agent' ? aDoc : human)
    for (let i = 0; i < 3; i++) { hub.flush(); await tick() }
    const next = Y.encodeStateAsUpdateV2(hostDoc)
    const attributions = c.noAttributions ? null : Y.mergeContentMaps(hub.log.slice(seq0).map(e => contentMapOf(e.v2, e.actor, e.at)))
    const d = openDiff({ prevState: prev, nextState: next, attributions, pick: doc => tabBody(doc, 't1') })
    const pm = renderDiff(d, schema, attributedNodes)
    let check = null; try { pm.check() } catch (e) { check = e.message }
    const runs = attributedRuns(pm)
    // the same in a real read-only editor (a second editor, showVersion), compared with the headless render
    const vDoc = new Y.Doc(); hub.connect(vDoc, 'viewer'); hub.flush()
    const vel = document.createElement('div'); document.body.appendChild(vel)
    const viewer = new Editor({ element: vel, extensions: [...extensions(), YCollaboration.configure({ ytype: tabBody(vDoc, 't1'), syncOptions: { attributedNodes } })], coreExtensionOptions: { delete: { filterTransaction: tr => !isBindingTransaction(tr) } } })
    await tick()
    const live0 = Y.encodeStateAsUpdateV2(hostDoc)
    let viewErr = null
    try { viewer.commands.showVersion({ ytype: d.ytype, renderer: d.renderer }); await tick() } catch (e) { viewErr = e.message }
    let vCheck = null; try { viewer.state.doc.check() } catch (e) { vCheck = e.message }
    const sameAsHeadless = JSON.stringify(viewer.getJSON()) === JSON.stringify(pm.toJSON())
    viewer.commands.leaveHistory(); await tick(); hub.flush()
    const liveUnchanged = Buffer.compare(Buffer.from(live0), Buffer.from(Y.encodeStateAsUpdateV2(hostDoc))) === 0
    const nextUnchanged = Buffer.compare(Buffer.from(next), Buffer.from(Y.encodeStateAsUpdateV2(d.nextDoc))) === 0
    d.destroy(); viewer.destroy()
    const fmtByAttr = runs.filter(x => x.kind === 'fmt').map(x => Object.keys(x.byAttr ?? {}).join('+'))
    Object.assign(r, { pass: !!c.want(pm, runs) && !check && !viewErr && !vCheck && liveUnchanged, want: !!c.want(pm, runs), check: check ?? 'valid', viewErr, viewCheck: vCheck ?? 'valid', sameAsHeadless, liveUnchanged, versionDocUnchanged: nextUnchanged, nChanges: changeList(pm).length, kinds: [...new Set(runs.map(x => `${x.kind}${x.attr ? '(' + x.attr + ')' : ''}@${x.where}`))].slice(0, 8), fmtByAttr: [...new Set(fmtByAttr)], deleted: deletedNodes(pm).slice(0, 4) })
  } catch (e) { Object.assign(r, { pass: false, error: e.stack.split('\n').slice(0, 3).join(' | ') }) }
  human.destroy()
  results.push(r)
}
const lines = []
for (const r of results) {
  lines.push(`${r.pass ? 'ok  ' : 'FAIL'} ${r.id}`)
  if (r.error) lines.push(`     error ${r.error}`)
  else lines.push(`     want ${r.want} | check ${r.check} | view ${r.viewErr ?? 'ok'}, ${r.viewCheck}, sameAsHeadless ${r.sameAsHeadless} | live unchanged ${r.liveUnchanged} | N ${r.nChanges} | ${r.kinds.join(' ')}${r.fmtByAttr.length ? ' | fmt keys ' + r.fmtByAttr.join(',') : ''}${r.deleted.length ? ' | deleted ' + JSON.stringify(r.deleted) : ''}`)
}
lines.push(`\npassed ${results.filter(r => r.pass).length}/${results.length}`)
console.log(lines.join('\n'))
writeFileSync(new URL('./out/bugs.json', import.meta.url), JSON.stringify(results, null, 2))
writeFileSync(new URL('./out/bugs.txt', import.meta.url), lines.join('\n') + '\n')
process.exit(0)
