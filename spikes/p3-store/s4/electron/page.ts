// S4 item 2, the page: a real Tiptap 3.31.3 editor on S1's v14 extension and the schema module, an editor replica
// linked to the host doc over a MessageChannel, the host (DocHost) with an in-process agent replica and the patch
// writer, all in one hidden Chromium page. Main drives the human's keys through CDP and calls `window.s4` to fire the
// agent's ops at chosen moments. Throwaway spike code.
import * as Y from '@y/y'
import * as aw from '@y/protocols/awareness'
import * as sync from '@y/protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Editor } from '@tiptap/core'
import { getSchema } from '@tiptap/core'
import { ynodeToPmnode } from '@y/prosemirror'
// @ts-ignore — S1's v14 Collaboration replacement, imported unchanged
import { YCollaboration } from '../../s1/v14/collab.mjs'
import { extensions } from '../src/schema.ts'
import { DocMarkdown } from '../src/markdown.ts'
import { PatchWriter, type Op } from '../src/patch-writer.ts'
import { DocHost, liveBlocks } from '../src/host.ts'
import { load } from '../src/fixture.ts'
import { linkOverPort } from '../src/port-link.ts'
import { CaretFollowsId } from '../src/caret-follows-id.ts'
import { CompositionHold } from '../src/composition-hold.ts'

const exts = extensions()
const schema = getSchema(exts)
const md = new DocMarkdown(schema, exts)
const writer = new PatchWriter({ schema, md })

interface Ev { t: number, type: string, data?: string | null, inputType?: string, composing?: boolean, key?: string, code?: number }

let S: any = null

const reset = async ({ hold = true, follow = true, capMs = 5000 } = {}) => {
  if (S) { S.editor.destroy(); S.provider.unlink(); S.el.remove() }
  const host = new DocHost({ writerFor: () => new PatchWriter({ schema, md, agentMarks: writer.agentMarks }) })
  load(host.doc, schema)
  const agentDoc = new Y.Doc(); const agentAw = new aw.Awareness(agentDoc); host.connect(agentDoc, 'agent:s1', agentAw); host.flush()
  const hDoc = new Y.Doc(); const hAw = new aw.Awareness(hDoc)
  let pending = false
  // the provider (port-link.ts) holds; the binding (composition-hold.ts) drives the hold
  const provider = linkOverPort({ sync, aw, encoding, decoding }, hDoc, hAw, host.doc, host.hub.hostAw, 'human', {
    onHostApplied: () => {
      host.flush()
      if (!pending) { pending = true; queueMicrotask(() => { pending = false; host.afterUpdates() }) }
    },
    receive: (u, origin, o) => host.receive(u, origin, o),
    revision: () => host.revision,
    capMs
  })
  await new Promise(r => setTimeout(r, 20))
  const el = document.createElement('div'); el.id = 'editor'; document.body.appendChild(el)
  const editor = new Editor({ element: el, extensions: [...exts, ...(follow ? [CaretFollowsId] : []), ...(hold ? [CompositionHold.configure({ provider })] : []), YCollaboration.configure({ ytype: hDoc.get('default'), awareness: hAw, user: { name: 'Owner', color: '#3366ff' } })] })
  await new Promise(r => setTimeout(r, 30))
  const events: Ev[] = []
  const t0 = performance.now()
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input', 'keydown', 'keyup']) {
    editor.view.dom.addEventListener(type, (e: any) => events.push({ t: Math.round((performance.now() - t0) * 10) / 10, type, data: e.data, inputType: e.inputType, composing: e.isComposing, key: e.key, code: e.keyCode }), true)
  }
  S = { provider, host, agentDoc, agentAw, hDoc, hAw, editor, el, events, agentResults: [] as any[], errors: [] as string[], pings: 0 }
  window.addEventListener('error', e => S.errors.push(String(e.message)))
  return { ok: true, blocks: ids(host.doc) }
}

const ids = (doc: Y.Doc) => { const out: string[] = []; ynodeToPmnode(doc.get('default'), schema).descendants(n => { if (n.attrs?.id) out.push(n.attrs.id) }); return out }
const pmJSON = (doc: Y.Doc) => JSON.stringify(ynodeToPmnode(doc.get('default'), schema).toJSON())

/** Put the caret at the end of a block's text (or before the first occurrence of `before`). */
const caret = (blockId: string, before?: string) => {
  const { editor } = S
  let pos = -1
  editor.state.doc.descendants((n: any, p: number) => {
    if (pos >= 0) return false
    if (n.attrs?.id === blockId) {
      if (before != null) { const i = n.textContent.indexOf(before); pos = p + 1 + (i >= 0 ? i : n.textContent.length) } else pos = p + n.nodeSize - 1
      return false
    }
    return true
  })
  editor.commands.focus()
  editor.commands.setTextSelection(pos)
  return { pos, hasFocus: editor.view.hasFocus() }
}

/** The agent's batch, as the host would run it for a tool call; `live` from the host's awareness or none. */
const agent = (ops: Op[], { live = 'awareness' as 'awareness' | 'none', base = null as number | null } = {}) => {
  const { host, agentDoc } = S
  const liveSet = live === 'awareness' ? liveBlocks(host.doc, host.hub.hostAw.getStates()) : new Set<string>()
  const res = host.edit({ doc: agentDoc, actor: 'agent:s1' }, { toolUseId: 'tu' + Math.random(), baseRevision: base ?? host.revision, ops, live: liveSet })
  S.agentResults.push({ at: Math.round(performance.now()), composing: S.editor.view.composing, live: [...liveSet], res })
  return { res, live: [...liveSet], composing: S.editor.view.composing }
}

const blockText = (doc: Y.Doc, id: string) => { let t: string | null = null; ynodeToPmnode(doc.get('default'), schema).descendants((n: any) => { if (t == null && n.attrs?.id === id) { t = n.textContent; return false } return true }); return t }

const state = () => {
  const { host, agentDoc, hDoc, editor, events } = S
  host.flush()
  // the block's DOM text without remote caret widgets (their label is DOM, not content)
  const domText = (id: string) => { const el = editor.view.dom.querySelector(`[data-id="${id}"]`) as HTMLElement | null; if (!el) return null; const c = el.cloneNode(true) as HTMLElement; c.querySelectorAll(".ProseMirror-yjs-cursor").forEach(x => x.remove()); return c.textContent }
  const all = ids(hDoc)
  return {
    editorMd: md.read(hDoc.get('default')),
    hostMd: md.read(host.doc.get('default')),
    converged: pmJSON(host.doc) === pmJSON(hDoc) && pmJSON(host.doc) === pmJSON(agentDoc),
    editorStateMatchesY: JSON.stringify(editor.state.doc.toJSON()) === pmJSON(hDoc),
    ids: all,
    dupes: [...new Set(all.filter((x, i) => all.indexOf(x) !== i))],
    text: (id: string) => blockText(hDoc, id),
    composing: editor.view.composing,
    hold: { ...S.provider.stats, holdingNow: S.provider.holding, heldNow: S.provider.held }, pings: S.pings,
    events, agentResults: S.agentResults, errors: S.errors, report: host.report,
    dom: Object.fromEntries(all.filter(i => /^p\d$/.test(i)).map(i => [i, domText(i)])),
    pmText: Object.fromEntries(all.filter(i => /^p\d$/.test(i)).map(i => [i, blockText(hDoc, i)])),
    awareness: [...host.hub.hostAw.getStates().entries()].map(([k, v]: any) => ({ k, cursor: !!v?.cursor })),
    revision: host.revision
  }
}

/** The agent's awareness: a caret (relative positions) inside block `id` at `at`, and the blocks it is editing. */
const agentPing = (id: string, at: number) => {
  const { agentDoc, agentAw } = S
  const node = writer.find(agentDoc.get('default'), id).node
  const i = Math.max(0, Math.min(at, node.length))
  agentAw.setLocalStateField('user', { name: 'Claude', color: '#d97757' })
  agentAw.setLocalStateField('cursor', { anchor: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(node, i)), head: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(node, Math.min(node.length, i + 4))) })
  agentAw.setLocalStateField('editing', { blocks: S.pings % 2 ? [id] : [id, 'l1'] })
  S.host.flush(); S.pings++
  return { composing: S.editor.view.composing, holding: S.provider.holding, cursors: S.editor.view.dom.querySelectorAll('.ProseMirror-yjs-cursor').length }
}

;(window as any).s4 = { reset, caret, agent, state, agentPing, blockText: (id: string) => blockText(S.hDoc, id), settle: () => new Promise(r => setTimeout(() => { S.host.flush(); r(true) }, 30)) }
;(window as any).s4ready = true
