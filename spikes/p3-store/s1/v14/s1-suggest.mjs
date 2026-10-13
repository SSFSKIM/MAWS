// S1 scenario 4 on Yjs v14: an agent's edit lands as a suggestion the human accepts or rejects per hunk.
// Host keeps the base doc (gc on) and a suggestion doc (gc off, isSuggestionDoc); the agent edits through its own
// replica of the suggestion doc; the human's editor binds its suggestion replica through a DiffRenderer over its
// base replica, with the suggester's identity from the host's log. Run:
//   node spikes/p3-store/s1/v14/s1-suggest.mjs   (writes out/v14-suggest.json)
import { tick } from '../lib/dom.mjs'
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import * as sync from '@y/protocols/sync'
import * as aw from '@y/protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Editor } from '@tiptap/core'
import { pmnodeToDelta, acceptChanges, rejectChanges } from '@y/prosemirror'
import { extensions, schemaFor, attributedNodes } from './schema.mjs'
import { YCollaboration } from './collab.mjs'
import { createHub } from '../lib/link.mjs'

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }
const schema = schemaFor()
const base = new Y.Doc()
const sugg = new Y.Doc({ gc: false, isSuggestionDoc: true })
const baseHub = createHub({ Y, sync, aw, encoding, decoding, hostDoc: base })
const suggHub = createHub({ Y, sync, aw, encoding, decoding, hostDoc: sugg })
base.transact(() => base.get('default').applyDelta(pmnodeToDelta(schema.nodeFromJSON({ type: 'doc', content: [
  { type: 'heading', attrs: { level: 2, id: 'h1' }, content: [{ type: 'text', text: 'Draft' }] },
  { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'The owner types here.' }] },
  { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Agent will rewrite the middle of this paragraph.' }] },
  { type: 'paragraph', attrs: { id: 'p3' }, content: [{ type: 'text', text: 'Closing line.' }] }
] }))), { actor: 'import' })
// the host keeps the suggestion doc a superset of base: every base update flows in (DiffRenderer does the same per replica)
Y.applyUpdate(sugg, Y.encodeStateAsUpdate(base))
base.on('update', u => Y.applyUpdate(sugg, u, 'base'))
const settle = async () => { for (let i = 0; i < 4; i++) { baseHub.flush(); suggHub.flush(); await tick() } }

// the agent proposes through its replica of the suggestion doc
const agentSugg = new Y.Doc({ gc: false })
suggHub.connect(agentSugg, 'agent:session-1'); suggHub.flush()
const aRoot = agentSugg.get('default')
const byId = (node, id) => node.toArray().find(c => c?.getAttr?.('id') === id)
const idx = (node, needle) => node.toString().replace(/<[^>]*>/g, '').indexOf(needle)
agentSugg.transact(() => {
  const p2 = byId(aRoot, 'p2'); const i = idx(p2, 'the middle of'); p2.delete(i, 'the middle of'.length); p2.insert(i, 'a part of') // hunk 1
  const p3 = byId(aRoot, 'p3'); p3.insert(p3.length, ' Agent closing remark.') // hunk 2
  const k = aRoot.toArray().findIndex(c => c.getAttr('id') === 'p3')
  aRoot.insert(k, [pmnodeToDelta(schema.nodes.paragraph.create({ id: 'pA' }, schema.text('Agent proposed paragraph.')))]) // hunk 3
}, 'agent')
await settle()
check('agent edit stays out of base', !base.get('default').toString().includes('a part of') && sugg.get('default').toString().includes('a part of'))

// the human's side: a base replica and a suggestion replica, a DiffRenderer, attributions from the suggestion log
const hBase = new Y.Doc(); baseHub.connect(hBase, 'human'); baseHub.flush()
const hSugg = new Y.Doc({ gc: false }); suggHub.connect(hSugg, 'human'); suggHub.flush()
const attrOf = e => Y.createContentMapFromContentIds(Y.createContentIdsFromUpdate(e.v1),
  [Y.createContentAttribute('insert', e.actor), Y.createContentAttribute('insertAt', e.at)],
  [Y.createContentAttribute('delete', e.actor), Y.createContentAttribute('deleteAt', e.at)])
const attributions = Y.mergeContentMaps(suggHub.log.filter(e => e.actor.startsWith('agent:')).map(attrOf))
const renderer = Y.createDiffRenderer(hBase, hSugg, { attributions })
renderer.suggestionMode = false // "view suggestions": the owner's own typing goes to base, the agent's stays a proposal
const el = document.createElement('div'); document.body.appendChild(el)
const editor = new Editor({ element: el, extensions: [...extensions(), YCollaboration.configure({ ytype: hSugg.get('default'), renderer, syncOptions: { attributedNodes } })] })
await tick(); await settle()
const marksAt = () => { const out = []; editor.state.doc.descendants((n, pos) => { if (n.isText) for (const m of n.marks) if (m.type.name.startsWith('y-attributed')) out.push({ pos, text: n.text, mark: m.type.name.slice(13), who: m.attrs.userIds?.[0] }) }); return out }
const before = marksAt()
console.log('suggestions on screen:', JSON.stringify(before.map(m => `${m.mark}:${m.who}:${JSON.stringify(m.text)}`)))
check('suggestions render with the suggester\'s identity', before.length >= 4 && before.every(m => m.who === 'agent:session-1'), `${before.length} marked runs`)
check('deleted text shown struck (still on screen)', editor.getText().includes('the middle of') && editor.getText().includes('a part of'))

// the owner types elsewhere while suggestions are open → lands in base directly
const findPos = needle => { let at = -1; editor.state.doc.descendants((n, pos) => { if (at < 0 && n.isText && n.text.includes(needle)) at = pos + n.text.indexOf(needle) }); return at }
editor.chain().setTextSelection(findPos('here.')).insertContent('quickly ').run(); await settle()
check('owner typing in view mode goes to base, unattributed', base.get('default').toString().includes('types quickly here.') && !marksAt().some(m => m.text.includes('quickly')))

// accept hunk 1 (p2 rewrite), reject hunk 2 (p3 remark), accept hunk 3 (new paragraph) — each by its own range
const range = needle => { const f = findPos(needle); return [f, f + needle.length] }
let [f, t] = range('the middle of'); const [f2, t2] = range('a part of')
check('accept hunk 1 command', acceptChanges(Math.min(f, f2), Math.max(t, t2))(editor.state, editor.view.dispatch))
await settle()
;[f, t] = range(' Agent closing remark.')
check('reject hunk 2 command', rejectChanges(f, t)(editor.state, editor.view.dispatch))
await settle()
;[f, t] = range('Agent proposed paragraph.')
// first a text-only range inside the inserted paragraph (what a selection of its words gives)
check('accept hunk 3, text-only range: command returns true', acceptChanges(f, t)(editor.state, editor.view.dispatch))
await settle()
const pendingAfterTextOnly = { hBase: hBase.store.pendingStructs != null, base: base.store.pendingStructs != null }
check('accept hunk 3, text-only range: lands in base', base.get('default').toString().includes('Agent proposed paragraph.'), `pending structs ${JSON.stringify(pendingAfterTextOnly)}`)
// then the block's own range (paragraph start - 1 .. end + 1), what a per-block "Accept" button would pass
;[f, t] = range('Agent proposed paragraph.')
check('accept hunk 3, block range: command returns true', acceptChanges(f - 1, t + 1)(editor.state, editor.view.dispatch))
await settle()
check('accept hunk 3, block range: pending structs cleared', hBase.store.pendingStructs == null && base.store.pendingStructs == null, JSON.stringify({ hBase: hBase.store.pendingStructs != null, base: base.store.pendingStructs != null }))
const baseText = base.get('default').toString()
console.log('base after review:', baseText)
check('base: hunk 1 accepted', baseText.includes('Agent will rewrite a part of this paragraph.'))
check('base: hunk 2 rejected', baseText.includes('Closing line.') && !baseText.includes('Agent closing remark'))
check('base: hunk 3 accepted with its id', baseText.includes('<paragraph id="pA">Agent proposed paragraph.</paragraph>'))
check('no suggestions left on screen', marksAt().length === 0, JSON.stringify(marksAt()))
check('suggestion doc converged to base content', JSON.stringify(sugg.get('default').toJSON()) === JSON.stringify(base.get('default').toJSON()))
// who authored the accepted text in base? the structs keep the agent's ids; the base log credits the port that sent them
const lastBase = baseHub.log.slice(-2).map(e => e.actor)
const pA = base.get('default').toArray().find(c => c.getAttr('id') === 'pA')
check('accepted content keeps the agent replica\'s clientID (provenance can credit the suggester)', pA._item.id.client === agentSugg.clientID, `pA client ${pA._item.id.client} vs agent ${agentSugg.clientID}; base log credits ${JSON.stringify(lastBase)}`)

// a second proposal while the review view is open: attributions registered from the update before it applies
const before2 = suggHub.log.length
agentSugg.on('update', u => Y.insertIntoIdMap(attributions.inserts, Y.createIdMapFromIdSet(Y.createContentIdsFromUpdate(u).inserts, [Y.createContentAttribute('insert', 'agent:session-2')])))
agentSugg.transact(() => { const p1 = byId(aRoot, 'p1'); p1.insert(0, 'Note: ') }, 'agent')
await settle()
const live2 = marksAt()
check('a live second proposal renders while open, attributed', live2.some(m => m.text.includes('Note: ') && m.who === 'agent:session-2'), JSON.stringify(live2.map(m => `${m.mark}:${m.who}:${m.text}`)))
check('reject-all clears it and base never saw it', (renderer.rejectAllChanges(), true) && !base.get('default').toString().includes('Note:'))
await settle()
check('screen back to base after reject-all', !editor.getText().includes('Note:'), JSON.stringify(editor.getText()))

writeFileSync(new URL('../out/v14-suggest.json', import.meta.url), JSON.stringify({ results, base: base.get('default').toString(), suggLog: suggHub.log.map(e => e.actor), baseLog: baseHub.log.map(e => e.actor) }, null, 2))
console.log(`\n${results.filter(r => r.ok).length}/${results.length} checks passed`)
process.exit(0)
