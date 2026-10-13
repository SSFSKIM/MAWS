// S4 item 2, the v13 comparison page: the same editor scene on Yjs v13 (yjs 13.6.33, Tiptap's Collaboration on
// @tiptap/y-tiptap 3.0.9, from the shared spikes/p3-store package) with the agent's ops emulated as the equivalent
// Y.XmlFragment / Y.XmlText operations, to tell a v14-specific IME failure from a general one. Same window.s4 API
// as page.ts so main.ts drives both. Throwaway spike code.
import * as Y from 'yjs'
import * as aw from 'y-protocols/awareness'
import * as sync from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Editor, getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table'
import { UniqueID } from '@tiptap/extension-unique-id'
import Collaboration from '@tiptap/extension-collaboration'
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
// @ts-ignore — S1's hub, plain JS
import { createHub } from '../../s1/lib/link.mjs'
import { linkOverPort } from '../src/port-link.ts'
import { CompositionHold } from '../src/composition-hold.ts'

const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote', 'codeBlock', 'bulletList', 'orderedList', 'listItem', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader']
let n = 0
const base = () => [StarterKit.configure({ undoRedo: false }), Table, TableRow, TableCell, TableHeader, UniqueID.configure({ types: BLOCK_TYPES, generateID: () => 'u' + (++n).toString(36) })]
const schema = getSchema(base())
const t = (text: string, marks?: any[]) => ({ type: 'text', text, ...(marks ? { marks } : {}) })
const para = (id: string, content: any[]) => ({ type: 'paragraph', attrs: { id }, content })
const cell = (id: string, text: string, kind = 'tableCell') => ({ type: kind, attrs: { id }, content: [para(id + 'p', [t(text)])] })
const seedJSON = { type: 'doc', content: [
  { type: 'heading', attrs: { id: 'h1', level: 2 }, content: [t('Section 1 plan')] },
  para('p1', [t('The quick brown fox jumps over the '), t('lazy', [{ type: 'bold' }]), t(' dog. It has two sentences.')]),
  para('p2', [t('The review is scheduled for Friday and the owner signs off after it.')]),
  // "Words" carries a mark, as the comment does in the v14 fixture, so the text nodes split the same way
  para('p3', [t('A plain paragraph the human types into. '), t('Words', [{ type: 'italic' }]), t(' to keep.')]),
  { type: 'bulletList', attrs: { id: 'l1' }, content: [{ type: 'listItem', attrs: { id: 'li1' }, content: [para('lp1', [t('first item')])] }, { type: 'listItem', attrs: { id: 'li2' }, content: [para('lp2', [t('second item with '), t('bold', [{ type: 'bold' }])])] }] },
  { type: 'table', attrs: { id: 'tb1' }, content: [{ type: 'tableRow', attrs: { id: 'tr0' }, content: [cell('tha', 'Name', 'tableHeader'), cell('thb', 'Value', 'tableHeader')] }, { type: 'tableRow', attrs: { id: 'tr1' }, content: [cell('td1a', 'alpha'), cell('td1b', '1')] }] },
  { type: 'codeBlock', attrs: { id: 'c1', language: 'ts' }, content: [t('const x = 1')] },
  para('p4', [t('Closing paragraph of this section.')])
] }

let S: any = null
const reset = async ({ hold = true } = {}) => {
  if (S) { S.editor.destroy(); S.provider.unlink(); S.el.remove() }
  const hostDoc = new Y.Doc()
  const hub = createHub({ Y, sync, aw, encoding, decoding, hostDoc })
  hostDoc.transact(() => prosemirrorToYXmlFragment(schema.nodeFromJSON(seedJSON), hostDoc.getXmlFragment('default')), { actor: 'import' })
  const agentDoc = new Y.Doc(); hub.connect(agentDoc, 'agent:s1'); hub.flush()
  const hDoc = new Y.Doc(); const hAw = new aw.Awareness(hDoc)
  const provider = linkOverPort({ sync, aw, encoding, decoding }, hDoc, hAw, hostDoc, hub.hostAw, 'human', {
    onHostApplied: () => hub.flush(),
    receive: (u, origin) => Y.applyUpdate(hostDoc, u, origin),
    revision: () => hub.log.length
  })
  await new Promise(r => setTimeout(r, 20))
  const el = document.createElement('div'); el.id = 'editor'; document.body.appendChild(el)
  const editor = new Editor({ element: el, extensions: [...base(), ...(hold ? [CompositionHold.configure({ provider })] : []), Collaboration.configure({ document: hDoc, field: 'default' })] })
  await new Promise(r => setTimeout(r, 30))
  const events: any[] = []
  const t0 = performance.now()
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'keydown', 'keyup']) {
    editor.view.dom.addEventListener(type, (e: any) => events.push({ t: Math.round((performance.now() - t0) * 10) / 10, type, data: e.data, inputType: e.inputType, composing: e.isComposing, key: e.key, code: e.keyCode }), true)
  }
  S = { provider, hostDoc, hub, agentDoc, hDoc, editor, el, events, errors: [] as string[], agentResults: [] as any[] }
  window.addEventListener('error', e => S.errors.push(String(e.message)))
  return { ok: true }
}

const root = (doc: Y.Doc) => doc.getXmlFragment('default')
const find = (doc: Y.Doc, id: string): { el: Y.XmlElement, parent: any, index: number } => {
  const walk = (p: any): any => { const kids = p.toArray(); for (let i = 0; i < kids.length; i++) { const c = kids[i]; if (c instanceof Y.XmlElement) { if (c.getAttribute('id') === id) return { el: c, parent: p, index: i }; const r = walk(c); if (r) return r } } return null }
  return walk(root(doc))
}
const textOf = (x: Y.XmlText) => x.toDelta().map((op: any) => op.insert).join('')
/** Replace `old` by `neu` where `old` occurs, touching only the differing middle (as the word diff does). */
const replaceIn = (el: Y.XmlElement, old: string, neu: string) => {
  let p = 0; while (p < old.length && old[p] === neu[p]) p++
  let q = 0; while (q < old.length - p && old[old.length - 1 - q] === neu[neu.length - 1 - q]) q++
  for (const c of el.toArray()) {
    if (!(c instanceof Y.XmlText)) continue
    const i = textOf(c).indexOf(old)
    if (i >= 0) { c.delete(i + p, old.length - p - q); c.insert(i + p, neu.slice(p, neu.length - q), {}); return true }
  }
  return false
}
const indexOf = (doc: Y.Doc, id: string) => root(doc).toArray().findIndex((c: any) => c.getAttribute?.('id') === id)
/** Delete the top-level element at `from` and insert its clone at `to` (post-delete index). */
const reinsert = (doc: Y.Doc, from: number, to: number) => { const r = root(doc); const el = r.get(from) as Y.XmlElement; const copy = el.clone(); r.delete(from, 1); r.insert(to, [copy]) }

/** The writer's Y-level effect for the ops main.ts sends, as v13 operations on the agent's replica. */
const agent = (ops: any[], { live = 'awareness' } = {}) => {
  const d = S.agentDoc
  d.transact(() => {
    for (const op of ops) {
      if (op.op === 'replace_text') {
        replaceIn(find(d, op.block).el, op.old, op.new)
      } else if (op.op === 'replace_block') {
        replaceIn(find(d, 'lp1').el, 'first item', 'first item, edited by the agent')
      } else if (op.op === 'insert') {
        const i = indexOf(d, op.before); const pEl = new Y.XmlElement('paragraph'); pEl.setAttribute('id', 'ins1')
        const tx = new Y.XmlText(); tx.insert(0, 'An agent paragraph inserted above.'); pEl.insert(0, [tx])
        root(d).insert(i, [pEl])
      } else if (op.op === 'move') {
        const x = indexOf(d, op.id); const after = indexOf(d, op.after)
        if (live === 'none') reinsert(d, x, after) // x re-inserted after `after` (post-delete index = after)
        else for (let k = 0; k < after - x; k++) reinsert(d, x + k + 1, x + k) // the span moved before x instead
      }
    }
  }, 'agent')
  S.hub.flush()
  return { res: { ok: true, lines: ops.map(o => o.op) }, live: live === 'awareness' ? ['p3'] : [], composing: S.editor.view.composing }
}

const pm = (doc: Y.Doc) => yXmlFragmentToProseMirrorRootNode(root(doc), schema)
const blockText = (doc: Y.Doc, id: string) => { let r: string | null = null; pm(doc).descendants((nn: any) => { if (r == null && nn.attrs?.id === id) { r = nn.textContent; return false } return true }); return r }
const ids = (doc: Y.Doc) => { const out: string[] = []; pm(doc).descendants((nn: any) => { if (nn.attrs?.id) out.push(nn.attrs.id) }); return out }
const mdish = (doc: Y.Doc) => { const out: string[] = []; pm(doc).forEach((b: any) => out.push(`${b.type.name === 'codeBlock' ? '```\n' + b.textContent + '\n```\n^' + b.attrs.id : b.type.name === 'bulletList' ? b.textContent + '\n^' + b.attrs.id : b.textContent + ' ^' + b.attrs.id}`)); return out.join('\n\n') }
const state = () => {
  S.hub.flush()
  const j = (d: Y.Doc) => JSON.stringify(pm(d).toJSON())
  const all = ids(S.hDoc)
  const domText = (id: string) => (S.editor.view.dom.querySelector(`[data-id="${id}"]`) as HTMLElement | null)?.textContent ?? null
  return {
    editorMd: mdish(S.hDoc).replace('first item, edited by the agentsecond item with bold', '- first item, edited by the agent\n- second item with **bold**'),
    converged: j(S.hostDoc) === j(S.hDoc) && j(S.hostDoc) === j(S.agentDoc),
    editorStateMatchesY: JSON.stringify(S.editor.state.doc.toJSON()) === j(S.hDoc),
    ids: all, dupes: [...new Set(all.filter((x, i) => all.indexOf(x) !== i))],
    text: (id: string) => blockText(S.hDoc, id),
    composing: S.editor.view.composing, hold: { ...S.provider.stats, holdingNow: S.provider.holding, heldNow: S.provider.held }, pings: 0, events: S.events, agentResults: [], errors: S.errors, report: [],
    dom: { p3: domText('p3') }, pmText: { p3: blockText(S.hDoc, 'p3') }, awareness: [], revision: S.hub.log.length
  }
}
const caret = (blockId: string) => {
  const { editor } = S
  let pos = -1
  editor.state.doc.descendants((nn: any, p: number) => { if (pos >= 0) return false; if (nn.attrs?.id === blockId) { pos = p + nn.nodeSize - 1; return false } return true })
  editor.commands.focus(); editor.commands.setTextSelection(pos)
  return { pos, hasFocus: editor.view.hasFocus() }
}
;(window as any).s4 = { reset, caret, agent, state, settle: () => new Promise(r => setTimeout(() => { S.hub.flush(); r(true) }, 30)) }
;(window as any).s4ready = true
