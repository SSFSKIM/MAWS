// S1 scenario 1 + 2 on Yjs v13 (the baseline): the same replicas and checks as v14/s1-binding.mjs through
// Tiptap's Collaboration + CollaborationCaret (@tiptap/y-tiptap 3.0.9) and stock UniqueID. Run:
//   node spikes/p3-store/s1/v13/s1-binding.mjs
import { tick, pasteHTML } from '../lib/dom.mjs'
import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as aw from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Editor, getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { UniqueID } from '@tiptap/extension-unique-id'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { prosemirrorToYXmlFragment } from '@tiptap/y-tiptap'
import { createHub } from '../lib/link.mjs'

const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader']
let n = 0
const base = () => [StarterKit.configure({ undoRedo: false }), Table, TableRow, TableCell, TableHeader, UniqueID.configure({ types: BLOCK_TYPES, generateID: () => 'u' + (++n).toString(36) + Math.random().toString(36).slice(2, 6) })]
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

const schema = getSchema(base())
const hostDoc = new Y.Doc()
const hub = createHub({ Y, sync, aw, encoding, decoding, hostDoc })
const host = hostDoc.getXmlFragment('default')
const seed = schema.nodeFromJSON({ type: 'doc', content: [
  { type: 'heading', attrs: { level: 2, id: 'h1' }, content: [{ type: 'text', text: 'Plan' }] },
  { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'First paragraph here.' }] },
  { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Second paragraph, split me here please.' }] },
  { type: 'paragraph', attrs: { id: 'p3' }, content: [{ type: 'text', text: 'Third paragraph.' }] }
] })
hostDoc.transact(() => prosemirrorToYXmlFragment(seed, host), { actor: 'import' })

let hid = 0
const repairIds = () => {
  const seen = new Set(); let fixed = 0
  const walk = node => node.toArray().forEach(c => {
    if (!(c instanceof Y.XmlElement)) return
    if (BLOCK_TYPES.includes(c.nodeName)) {
      const id = c.getAttribute('id')
      if (id == null || seen.has(id)) { c.setAttribute('id', 'r' + (++hid)); fixed++ } else seen.add(id)
    }
    walk(c)
  })
  hostDoc.transact(() => walk(host), { actor: 'host-repair' })
  return fixed
}
const ids = node => { const out = []; const w = x => x.toArray().forEach(c => { if (c instanceof Y.XmlElement && BLOCK_TYPES.includes(c.nodeName)) { out.push(c.getAttribute('id')); w(c) } }); w(node); return out }
const dupes = arr => arr.filter((x, i) => arr.indexOf(x) !== i)
const pmIds = ed => { const out = []; ed.state.doc.descendants(x => { if (x.attrs.id !== undefined && x.type.name !== 'text') out.push(x.attrs.id) }); return out }

const makeEditor = async (actor, user) => {
  const doc = new Y.Doc()
  const awareness = new aw.Awareness(doc)
  const port = hub.connect(doc, actor, awareness)
  hub.flush()
  const el = document.createElement('div'); document.body.appendChild(el)
  const provider = { awareness, on () {}, off () {} }
  const editor = new Editor({ element: el, extensions: [...base(), Collaboration.configure({ document: doc }), CollaborationCaret.configure({ provider, user })] })
  await tick(); hub.flush(); await tick()
  return { doc, awareness, port, editor, el }
}
const settle = async () => { for (let i = 0; i < 4; i++) { hub.flush(); await tick() } hub.flush() }
const textOf = ed => ed.state.doc.textBetween(0, ed.state.doc.content.size, '\n')
const findPos = (ed, needle) => { let at = -1; ed.state.doc.descendants((x, pos) => { if (at < 0 && x.isText && x.text.includes(needle)) at = pos + x.text.indexOf(needle) }); return at }

const A = await makeEditor('human', { name: 'Owner', color: '#3366ff' })
const B = await makeEditor('human-tab', { name: 'Owner (tab)', color: '#33aa66' })
check('bind: A renders host content', textOf(A.editor) === 'Plan\nFirst paragraph here.\nSecond paragraph, split me here please.\nThird paragraph.', JSON.stringify(textOf(A.editor)))
check('bind: ids rendered from Y', JSON.stringify(pmIds(A.editor)) === '["h1","p1","p2","p3"]', JSON.stringify(pmIds(A.editor)))

A.editor.chain().setTextSelection(findPos(A.editor, 'here.')).insertContent('typed ').run()
await settle()
check('type: B sees A\'s keystrokes', textOf(B.editor).includes('First paragraph typed here.'))
check('type: host has it', host.toString().includes('First paragraph typed here.'))

A.editor.chain().setTextSelection(findPos(A.editor, 'split me')).splitBlock().run()
await settle()
const idsAfterSplit = pmIds(B.editor)
check('split: two paragraphs on B', textOf(B.editor).includes('Second paragraph, \nsplit me here please.'), JSON.stringify(textOf(B.editor)))
check('split: original id kept on first half, new id on second, no duplicates', idsAfterSplit[2] === 'p2' && idsAfterSplit[3] !== 'p2' && idsAfterSplit[3] != null && dupes(idsAfterSplit).length === 0, JSON.stringify(idsAfterSplit))
check('split: host ids equal editor ids', JSON.stringify(ids(host)) === JSON.stringify(pmIds(A.editor)), JSON.stringify(ids(host)))

A.editor.chain().setTextSelection(A.editor.state.doc.content.size - 1).splitBlock().run()
await settle()
const handled = pasteHTML(A.editor.view, '<p data-id="p1">Pasted copy of p1</p><p data-id="zz">Second pasted</p>', 'Pasted copy of p1')
await settle()
const idsAfterPaste = pmIds(B.editor)
check('paste: event handled by ProseMirror', handled)
check('paste: pasted text synced', textOf(B.editor).includes('Pasted copy of p1'), JSON.stringify(textOf(B.editor)))
check('paste: pasted blocks get fresh ids (no duplicate p1, "zz" stripped)', dupes(idsAfterPaste).length === 0 && !idsAfterPaste.includes('zz') && idsAfterPaste.every(x => x != null), JSON.stringify(idsAfterPaste))

const umOf = ed => ed.state.plugins.map(p => p.getState?.(ed.state)).find(s => s && s.undoManager)?.undoManager
umOf(A.editor).stopCapturing(); umOf(B.editor).stopCapturing()
B.editor.chain().setTextSelection(findPos(B.editor, 'Plan') + 4).insertContent(' by B').run()
await settle()
A.editor.chain().setTextSelection(findPos(A.editor, 'Third')).insertContent('A-was-here ').run()
await settle()
check('undo setup: both edits on both', textOf(A.editor).includes('Plan by B') && textOf(B.editor).includes('A-was-here Third'))
A.editor.commands.undo()
await settle()
check('undo: A\'s undo removes only A\'s edit', !textOf(B.editor).includes('A-was-here') && textOf(B.editor).includes('Plan by B'), JSON.stringify(textOf(B.editor)))
A.editor.commands.redo()
await settle()
check('redo: A\'s redo restores it', textOf(B.editor).includes('A-was-here Third'))
const undoDepthA = umOf(A.editor).undoStack.length
while (umOf(A.editor).canUndo()) A.editor.commands.undo()
await settle()
check('undo all of A: B\'s edit survives, A\'s typing/split/paste gone', textOf(B.editor) === 'Plan by B\nFirst paragraph here.\nSecond paragraph, split me here please.\nThird paragraph.', JSON.stringify(textOf(B.editor)) + ` (A stack was ${undoDepthA})`)
check('undo all of A: ids back to the originals', JSON.stringify(pmIds(B.editor)) === '["h1","p1","p2","p3"]', JSON.stringify(pmIds(B.editor)))
while (umOf(A.editor).canRedo()) A.editor.commands.redo()
await settle()

A.editor.commands.focus(); A.editor.commands.setTextSelection({ from: findPos(A.editor, 'First'), to: findPos(A.editor, 'First') + 5 })
await settle()
check('cursor: A publishes a cursor when focused', A.awareness.getLocalState()?.cursor != null)
const bCursors = B.el.querySelectorAll('.collaboration-carets__caret, .ProseMirror-yjs-cursor')
check('cursor: B renders A\'s caret widget with A\'s name', [...bCursors].some(c => c.textContent.includes('Owner')), `${bCursors.length} widget(s): ${[...bCursors].map(c => c.textContent).join(',')}`)
const sel = B.el.querySelectorAll('.collaboration-carets__selection, .ProseMirror-yjs-selection')
check('cursor: B renders A\'s selection highlight', sel.length >= 1 && sel[0].textContent === 'First', `${sel.length} span(s): ${sel[0]?.textContent}`)

const agentDoc = new Y.Doc()
const agentAw = new aw.Awareness(agentDoc)
hub.connect(agentDoc, 'agent:session-1', agentAw)
hub.flush()
const agentFrag = agentDoc.getXmlFragment('default')
const p3 = agentFrag.toArray().find(c => c.getAttribute('id') === 'p3')
const p3text = p3.get(0)
agentAw.setLocalStateField('user', { name: 'Claude (session 1)', color: '#d97706' })
agentAw.setLocalStateField('cursor', { anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(p3text, 0)), head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(p3text, 5)) })
agentAw.setLocalStateField('editing', { blocks: ['p3'] })
await settle()
const aCursors = A.el.querySelectorAll('.collaboration-carets__caret, .ProseMirror-yjs-cursor')
check('cursor: A renders the agent replica\'s caret (relative position from a Node replica)', [...aCursors].some(c => c.textContent.includes('Claude')), [...aCursors].map(c => c.textContent).join(','))
check('awareness: the agent\'s "blocks it is editing" field reaches A', [...A.awareness.getStates().values()].some(s => s.editing?.blocks?.[0] === 'p3'))

const logBefore = hub.log.length
agentDoc.transact(() => {
  const p = new Y.XmlElement('paragraph'); p.insert(0, [new Y.XmlText('Agent block without id')])
  agentFrag.insert(agentFrag.length, [p])
}, 'agent')
await settle()
const writersAfter = hub.log.slice(logBefore).map(e => e.actor)
check('UniqueID (stock): no editor writes ids for a remote block (it skips y-sync$ transactions)', !writersAfter.includes('human') && !writersAfter.includes('human-tab'), JSON.stringify(writersAfter))
const fixed = repairIds()
await settle()
check('host repair: the missing id filled once, both editors show it', fixed === 1 && pmIds(A.editor).every(x => x != null) && JSON.stringify(pmIds(A.editor)) === JSON.stringify(pmIds(B.editor)), `fixed=${fixed} ${JSON.stringify(pmIds(A.editor))}`)

hub.disconnect(A.port); hub.disconnect(B.port)
A.editor.chain().setTextSelection(findPos(A.editor, 'A-was-here')).splitBlock().run()
B.editor.chain().setTextSelection(findPos(B.editor, 'A-was-here')).splitBlock().run()
A.editor.chain().setTextSelection(findPos(A.editor, 'typed')).splitBlock().run()
B.editor.chain().setTextSelection(findPos(B.editor, 'here.')).splitBlock().run()
await tick()
A.port = hub.connect(A.doc, 'human', A.awareness); B.port = hub.connect(B.doc, 'human-tab', B.awareness)
await settle()
const merged = ids(host)
check('concurrent split: replicas converge', textOf(A.editor) === textOf(B.editor), JSON.stringify(textOf(A.editor)))
console.log('  ids after concurrent offline split (host):', JSON.stringify(merged), 'duplicates:', JSON.stringify(dupes(merged)))
const fixed2 = repairIds(); await settle()
check('concurrent split: host repair leaves unique ids on every replica', dupes(pmIds(A.editor)).length === 0 && JSON.stringify(pmIds(A.editor)) === JSON.stringify(pmIds(B.editor)), `fixed=${fixed2} ${JSON.stringify(pmIds(A.editor))}`)
check('final: host, A, B identical', JSON.stringify(A.editor.getJSON()) === JSON.stringify(B.editor.getJSON()) && host.toString() === A.doc.getXmlFragment('default').toString())

const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed; host log ${hub.log.length} updates by ${JSON.stringify([...new Set(hub.log.map(e => e.actor))])}`)
process.exit(0)
