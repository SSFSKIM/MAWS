// S4 test setup: schema, markdown, a host with the fixture, an agent replica per session, a plain "human" replica
// (Y ops, as the editor's binding would write them), and a check() recorder. Throwaway spike code.
import * as Y from '@y/y'
import { getSchema } from '@tiptap/core'
import { ynodeToPmnode } from '@y/prosemirror'
import { extensions } from '../src/schema.ts'
import { DocMarkdown } from '../src/markdown.ts'
import { PatchWriter } from '../src/patch-writer.ts'
import { DocHost } from '../src/host.ts'
import { load } from '../src/fixture.ts'

export const exts = extensions()
export const schema = getSchema(exts)
export const md = new DocMarkdown(schema, exts)
const shared = new PatchWriter({ schema, md })
export const agentMarks = shared.agentMarks

export const results: Array<{ name: string, ok: boolean, detail: string }> = []
export const check = (name: string, ok: unknown, detail = '') => {
  results.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

export const world = (sections = 1) => {
  let t = Date.parse('2026-10-12T09:00:00Z')
  const host = new DocHost({ writerFor: () => new PatchWriter({ schema, md, agentMarks }), clock: () => (t += 1000) })
  load(host.doc, schema, sections)
  const agent = (actor: string) => { const doc = new Y.Doc(); host.connect(doc, actor); host.flush(); return { doc, actor } }
  const human = () => { const doc = new Y.Doc(); const port = host.connect(doc, 'human'); host.flush(); return { doc, port, actor: 'human' } }
  return { host, agent, human }
}

export const mdOf = (doc: Y.Doc) => md.read(doc.get('default'))
export const blockMd = (doc: Y.Doc, id: string) => { const w = new PatchWriter({ schema, md, agentMarks }); return md.block(w.pm(w.find(doc.get('default'), id).node)) }
export const pmJSON = (doc: Y.Doc) => ynodeToPmnode(doc.get('default'), schema).toJSON()
export const nodeOf = (doc: Y.Doc, id: string) => new PatchWriter({ schema, md, agentMarks }).find(doc.get('default'), id).node
/** Marks on the words of a block as "word[mark,mark]" for compact assertions. */
export const marksOf = (doc: Y.Doc, id: string): string => {
  const pm = ynodeToPmnode(nodeOf(doc, id), schema)
  const out: string[] = []
  pm.descendants(n => {
    if (!n.isText) return
    const ms = n.marks.map(m => (m.type.name === 'comment' ? `c:${m.attrs.threadId}` : m.type.name)).sort()
    out.push(ms.length ? `${n.text}[${ms.join(',')}]` : String(n.text))
  })
  return out.join('|')
}
export const threads = (doc: Y.Doc) => (doc.get('threads') as any).getAttrs()
/** Thread ids that live text carries (A5: an open thread not in this set is orphaned, derived). */
export const liveThreads = (doc: Y.Doc): Set<string> => {
  const out = new Set<string>()
  ynodeToPmnode(doc.get('default'), schema).descendants(n => { for (const m of n.marks) if (m.type.name === 'comment') out.add(m.attrs.threadId) })
  return out
}
/** threadId → the text its mark covers in a block, contiguous runs joined by '|' (S5's `covered`). */
export const coveredIn = (doc: Y.Doc, id: string): Record<string, string> => {
  const pm = ynodeToPmnode(nodeOf(doc, id), schema)
  const runs: Record<string, string[]> = {}; const open: Record<string, boolean> = {}
  pm.forEach(n => {
    const here = new Set(n.marks.filter(m => m.type.name === 'comment').map(m => m.attrs.threadId))
    for (const t of Object.keys(open)) if (!here.has(t)) open[t] = false
    for (const t of here) { (runs[t] ??= []); if (open[t]) runs[t][runs[t].length - 1] += n.text ?? ''; else runs[t].push(n.text ?? ''); open[t] = true }
  })
  return Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, v.join('|')]))
}
export const ids = (doc: Y.Doc): string[] => { const out: string[] = []; ynodeToPmnode(doc.get('default'), schema).descendants(n => { if (n.attrs?.id) out.push(n.attrs.id) }); return out }
export const dupes = (a: string[]) => [...new Set(a.filter((x, i) => a.indexOf(x) !== i))]
export const converged = (...docs: Y.Doc[]) => {
  const j = docs.map(d => JSON.stringify(pmJSON(d)))
  return j.every(x => x === j[0])
}
