// S5 (P3-0): the test world — a host Y.Doc with two Tiptap 3.31.3 editor replicas (the owner's panel and main tab) and
// an agent replica, all synced through y-protocols sync and awareness frames by S1's logging hub (imported; it takes
// the Yjs generation as parameters). Throwaway spike code.
import { tick } from './dom.mjs'
import * as Y from '@y/y'
import * as sync from '@y/protocols/sync'
import * as aw from '@y/protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Editor } from '@tiptap/core'
import { pmnodeToDelta, ynodeToPmnode } from '@y/prosemirror'
import { extensions, schemaFor } from './schema.mjs'
import { YCollaboration } from './collab.mjs'
import { CommentDisplay, CommentPaste, liveRanges, liveIdsY, threadStates, commentSelection } from './comments.mjs'
import { createHub } from '../../s1/lib/link.mjs'

export const schema = schemaFor()
export { Y }

export const seedJSON = () => ({ type: 'doc', content: [
  { type: 'heading', attrs: { level: 1, id: 'h1' }, content: [{ type: 'text', text: 'Plan' }] },
  { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'The plan ships quarterly with design review notes. Owners track the budget.' }] },
  { type: 'paragraph', attrs: { id: 'p2' }, content: [{ type: 'text', text: 'Second paragraph keeps going here.' }] },
  { type: 'paragraph', attrs: { id: 'p3' }, content: [{ type: 'text', text: 'Third paragraph.' }] }
] })

let clock = 1_760_000_000_000
export const now = () => (clock += 1000)

/** A fresh world. `paste: false` builds the editors without the paste dedupe (the contrast). */
export const createWorld = async ({ paste = true, seed = seedJSON(), hostState = null } = {}) => {
  const hostDoc = new Y.Doc()
  const hub = createHub({ Y, sync, aw, encoding, decoding, hostDoc, clock: () => clock })
  if (hostState) Y.applyUpdateV2(hostDoc, hostState)
  else hostDoc.transact(() => hostDoc.get('default').applyDelta(pmnodeToDelta(schema.nodeFromJSON(seed))), { actor: 'import' })
  const settle = async () => { for (let i = 0; i < 4; i++) { hub.flush(); await tick() } hub.flush() }
  const makeEditor = async (actor, user) => {
    const doc = new Y.Doc()
    const awareness = new aw.Awareness(doc)
    const port = hub.connect(doc, actor, awareness)
    hub.flush()
    const el = document.createElement('div'); document.body.appendChild(el)
    const editor = new Editor({
      element: el,
      extensions: [...extensions(), CommentDisplay.configure({ ydoc: doc }), ...(paste ? [CommentPaste.configure({ ydoc: doc })] : []),
        YCollaboration.configure({ ytype: doc.get('default'), awareness, user })]
    })
    await tick(); hub.flush(); await tick()
    const r = { actor, doc, awareness, port, editor, el, view: editor.view, um: () => editor.storage.collaboration.undoManager }
    r.reconnect = () => { r.port = hub.connect(doc, actor, awareness) }
    return r
  }
  const A = await makeEditor('owner:panel', { name: 'Owner', color: '#3366ff' })
  const B = await makeEditor('owner:tab', { name: 'Owner (tab)', color: '#33aa66' })
  const agentDoc = new Y.Doc()
  const agent = { actor: 'agent:s1', doc: agentDoc, port: hub.connect(agentDoc, 'agent:s1'), root: agentDoc.get('default') }
  agent.reconnect = () => { agent.port = hub.connect(agentDoc, 'agent:s1') }
  await settle()
  return { hostDoc, host: hostDoc.get('default'), hub, settle, A, B, agent, makeEditor }
}

// ── helpers over an editor replica ──────────────────────────────────────────────────────────────────────────────
export const textOf = ed => ed.state.doc.textBetween(0, ed.state.doc.content.size, '\n')
export const findPos = (ed, needle, nth = 0) => {
  let at = -1; let seen = 0
  // search each textblock's whole text (marks split it into several text nodes); no inline atoms in S5's fixtures
  ed.state.doc.descendants((n, pos) => {
    if (at >= 0) return false
    if (!n.isTextblock) return true
    const t = n.textContent; let i = t.indexOf(needle)
    while (i >= 0 && at < 0) { if (seen++ === nth) at = pos + 1 + i; else i = t.indexOf(needle, i + 1) }
    return false
  })
  if (at < 0) throw new Error('not found: ' + needle)
  return at
}
export const select = (ed, needle, through = null) => {
  const from = findPos(ed, needle)
  const to = through == null ? from + needle.length : findPos(ed, through) + through.length
  ed.commands.setTextSelection({ from, to })
  return { from, to }
}
/** Typing as ProseMirror types: insertText at the selection with the marks the cursor carries. */
export const type = (ed, pos, text) => { ed.commands.setTextSelection(pos); ed.view.dispatch(ed.state.tr.insertText(text)) }
export const key = (ed, pos, name) => { ed.commands.setTextSelection(pos); return ed.commands.keyboardShortcut(name) }
/** threadId → the text its live mark covers (ranges joined by '|'). */
export const covered = ed => {
  const out = {}
  for (const [id, ranges] of liveRanges(ed.state.doc)) out[id] = ranges.map(r => ed.state.doc.textBetween(r.from, r.to, '¶')).join('|')
  return Object.fromEntries(Object.entries(out).sort())
}
/** The open threads the display plugin highlights in the rendered DOM (decorations), id → text. */
export const highlighted = r => {
  const out = {}
  for (const el of r.el.querySelectorAll('.comment-open')) for (const c of el.classList) if (c.startsWith('comment-t-')) { const id = c.slice(10); out[id] = (out[id] ?? '') + el.textContent }
  return Object.fromEntries(Object.entries(out).sort())
}
export const blocks = ed => { const out = []; ed.state.doc.forEach(n => out.push(`${n.type.name}#${n.attrs.id ?? '-'}`)); return out }
export const states = (doc, root) => threadStates(doc, liveIdsY(root)).map(t => `${t.id}:${t.status}${t.orphan ? ':orphan' : ''}`).join(' ')
export const pmJSON = root => JSON.stringify(ynodeToPmnode(root, schema).toJSON())
export { commentSelection }
