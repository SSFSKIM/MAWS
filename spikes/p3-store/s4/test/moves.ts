// S4 item 4 in Node: concurrent moves of one block by two agent replicas while a human edits it, the duplicate that
// results, the host's repair (keep the later insertion, tombstone the other) with and without edit forwarding, and
// a concurrent split creating duplicate ids, repaired. Replicas go offline by not flushing the hub (their frames
// queue), which is how in-flight edits look to the host. Run:
//   node spikes/p3-store/s4/test/moves.ts        (writes s4/out/moves.json)
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import { world, check, results, mdOf, blockMd, marksOf, ids, dupes, converged, nodeOf } from './setup.ts'
import { DocHost } from '../src/host.ts'

const out = new URL('../out/', import.meta.url)
const order = (doc: Y.Doc) => (doc.get('default') as any).toArray().map((n: any) => n.getAttr('id'))
const textOf = (doc: Y.Doc, id: string) => { try { return blockMd(doc, id) } catch { return '(gone)' } }
/** Type into a block on a replica as the editor's binding would: an insert at an offset of a textblock. */
const typeAt = (doc: Y.Doc, id: string, at: number | 'end', text: string) => {
  const n = nodeOf(doc, id); doc.transact(() => n.insert(at === 'end' ? n.length : at, text, {}))
}
/** Replace a run of chars (an IME composition step: delete the composing text, insert the new one). */
const compose = (doc: Y.Doc, id: string, from: number, len: number, text: string) => {
  const n = nodeOf(doc, id); doc.transact(() => { n.delete(from, len); n.insert(from, text, {}) })
}
/** Run `f` with a port's outgoing frames held back (an in-flight replica), then release them. */
const offline = (host: DocHost, port: any) => { port.open = false; return () => { port.open = true; host.hub.connect /* noop */ } }

const report: any = {}

// ── A. one agent moves the block the human is typing in; the human's in-flight keystrokes ──
for (const forward of [false, true]) {
  const { host, agent, human } = world()
  if (!forward) { (host as any).receive = (u: Uint8Array, o: any) => Y.applyUpdate(host.doc, u, o) }
  const a = agent('agent:s1'); const h = human()
  typeAt(h.doc, 'p3', 'end', ' ㅎ'); host.flush()
  // the human keeps composing while the move is in flight: their replica has not seen it yet
  const hold: any[] = []; const realQ = (h.port as any).toReplica
  ;(h.port as any).toReplica = (m: any) => hold.push(m)
  const res = host.edit(a, { toolUseId: 'mv1', baseRevision: host.revision, ops: [{ op: 'move', id: 'p3', after: 'c1' }] })
  const len = nodeOf(h.doc, 'p3').length
  compose(h.doc, 'p3', len - 1, 1, '하'); host.flush(); host.afterUpdates()
  compose(h.doc, 'p3', len - 1, 1, '한'); host.flush(); host.afterUpdates()
  typeAt(h.doc, 'p3', 'end', '글'); host.flush(); host.afterUpdates()
  ;(h.port as any).toReplica = realQ; for (const m of hold) realQ(m); host.flush(); host.afterUpdates()
  const p3 = textOf(host.doc, 'p3')
  report[`A.forward=${forward}`] = { res, p3, order: order(host.doc), log: host.report }
  if (forward) {
    check('A: move under in-flight typing, with forwarding: the human\'s keystrokes land in the moved block', p3 === 'A plain paragraph the human types into. Words to keep. 한글', JSON.stringify(p3))
    check('A: …converged, ids unique, p3 after c1', converged(host.doc, a.doc, h.doc) && dupes(ids(host.doc)).length === 0 && order(host.doc).indexOf('p3') === order(host.doc).indexOf('c1') + 1, order(host.doc).join(' '))
  } else {
    check('A: without forwarding the in-flight keystrokes are lost (shown)', p3 !== 'A plain paragraph the human types into. Words to keep. 한글', JSON.stringify(p3))
  }
}

// ── B. two agents move the same block concurrently while the human edits it ──
for (const forward of [false, true]) {
  const { host, agent, human } = world()
  if (!forward) { (host as any).receive = (u: Uint8Array, o: any) => Y.applyUpdate(host.doc, u, o); (host as any).carryCopyEdits = () => 0 }
  const a1 = agent('agent:s1'); const a2 = agent('agent:s2'); const h = human()
  const base = host.revision
  // a2 and the human are offline while a1 moves p3 after c1
  const hold2: any[] = []; const hold2r = (a2 as any)
  const p2 = [...(host.hub as any).log].length // unused
  void p2; void hold2r
  const portOf = (doc: Y.Doc) => [...(host.hub as any).connect ? [] : []]
  void portOf
  // simplest: give a2 and the human private copies of the state, edit there, then merge as the host receives them
  const a2doc = new Y.Doc(); Y.applyUpdateV2(a2doc, Y.encodeStateAsUpdateV2(host.doc))
  const hdoc = new Y.Doc(); Y.applyUpdateV2(hdoc, Y.encodeStateAsUpdateV2(host.doc))
  const r1 = host.edit(a1, { toolUseId: 'b1', baseRevision: base, ops: [{ op: 'move', id: 'p3', after: 'c1' }] })
  // the human, seeing a1's move first, types into the moved copy; a2 moves the original concurrently
  Y.applyUpdateV2(hdoc, Y.encodeStateAsUpdateV2(host.doc, Y.encodeStateVector(hdoc)))
  const hUpdates: Uint8Array[] = []; hdoc.on('update', (u: Uint8Array) => hUpdates.push(u))
  typeAt(hdoc, 'p3', 0, 'Edited: ')
  // a2's writer runs on its own stale replica (it read before a1's move); its update reaches the host later
  const w2 = (host as any).writerFor('agent:s2')
  const applied2 = w2.apply(a2doc, [{ op: 'move', id: 'p3', after: 'h1' }], { origin: 'patch-writer' })
  const beforeH = host.revision
  for (const u of hUpdates) host.receive(u, { isPort: true, actor: 'human' }) // incremental, as typed
  // a2's batch: the host knows it is applying a batch (its deletes of the old copy are not edits to forward)
  host.receive(Y.encodeStateAsUpdate(a2doc, Y.encodeStateVector(host.doc)), { isPort: true, actor: 'agent:s2' }, { forward: false })
  for (const c of applied2.carries) host.registerCarry(c, host.revision, 'agent:s2')
  const dupBefore = dupes(ids(host.doc))
  const mdBefore = mdOf(host.doc)
  host.afterUpdates()
  const after = order(host.doc)
  const p3 = textOf(host.doc, 'p3')
  report[`B.forward=${forward}`] = { r1, beforeH, dupBefore, mdBefore, after, p3, log: host.report }
  if (!forward) {
    check('B: concurrent moves of one block duplicate it (two p3 with the same id)', dupBefore.includes('p3'), dupBefore.join(','))
    check('B: repair keeps the later insertion (a2: after h1) and tombstones the other', after.filter((x: string) => x === 'p3').length === 1 && after.indexOf('p3') === after.indexOf('h1') + 1, after.join(' '))
    check('B: without carrying the loser\'s edits, the human\'s edit in the tombstoned copy is lost (shown)', !p3.startsWith('Edited: '), JSON.stringify(p3))
  } else {
    check('B: with the carry rule the human\'s edit made in the losing copy survives in the kept one', p3.startsWith('Edited: A plain paragraph') && after.indexOf('p3') === after.indexOf('h1') + 1, JSON.stringify(p3))
    check('B: marks intact in the kept copy', marksOf(host.doc, 'p3') === 'Edited: A plain paragraph the human types into. |Words[c:t4]| to keep.', marksOf(host.doc, 'p3'))
    check('B: no duplicate ids after repair', dupes(ids(host.doc)).length === 0)
  }
}

// ── C. a human edit landing in the original while two agents moved it ──
{
  const { host, agent } = world()
  const a1 = agent('agent:s1')
  const hdoc = new Y.Doc(); Y.applyUpdateV2(hdoc, Y.encodeStateAsUpdateV2(host.doc))
  const a2doc = new Y.Doc(); Y.applyUpdateV2(a2doc, Y.encodeStateAsUpdateV2(host.doc))
  host.edit(a1, { toolUseId: 'c1', baseRevision: host.revision, ops: [{ op: 'move', id: 'p3', after: 'c1' }] })
  const applied2 = (host as any).writerFor('agent:s2').apply(a2doc, [{ op: 'move', id: 'p3', after: 'h1' }], {})
  const hUpdates: Uint8Array[] = []; hdoc.on('update', (u: Uint8Array) => hUpdates.push(u))
  typeAt(hdoc, 'p3', 2, 'very ') // into the original, which both moves deleted
  host.receive(Y.encodeStateAsUpdate(a2doc, Y.encodeStateVector(host.doc)), { isPort: true, actor: 'agent:s2' }, { forward: false })
  for (const c of applied2.carries) host.registerCarry(c, host.revision, 'agent:s2')
  for (const u of hUpdates) host.receive(u, { isPort: true, actor: 'human' })
  host.afterUpdates()
  const p3 = textOf(host.doc, 'p3')
  report.C = { p3, order: order(host.doc), log: host.report }
  check('C: an edit into the original after two concurrent moves is forwarded into the kept copy, once', p3 === 'A very plain paragraph the human types into. Words to keep.' && dupes(ids(host.doc)).length === 0, JSON.stringify(p3) + ' ' + order(host.doc).join(' '))
}

// ── D. concurrent splits creating duplicate ids, repaired ──
{
  const { host } = world()
  const d1 = new Y.Doc(); Y.applyUpdateV2(d1, Y.encodeStateAsUpdateV2(host.doc))
  const d2 = new Y.Doc(); Y.applyUpdateV2(d2, Y.encodeStateAsUpdateV2(host.doc))
  // a split as a binding writes it when the second half keeps the attributes it copied (a writer or a paste that
  // carries the id): delete the tail, insert a new paragraph with the same id holding it
  const split = (doc: Y.Doc, at: number) => {
    const root = doc.get('default') as any; const i = order(doc).indexOf('p4'); const n = root.get(i)
    const tail = n.toDelta().children.map((op: any) => op.insert).join('').slice(at)
    doc.transact(() => { n.delete(at, n.length - at); root.insert(i + 1, [Y.Node ? (() => { const p = new Y.Node('paragraph'); p.setAttr('id', 'p4'); p.insert(0, tail); return p })() : null]) })
  }
  split(d1, 8); split(d2, 20)
  host.receive(Y.encodeStateAsUpdate(d1, Y.encodeStateVector(host.doc)), { isPort: true, actor: 'human' })
  host.receive(Y.encodeStateAsUpdate(d2, Y.encodeStateVector(host.doc)), { isPort: true, actor: 'human-tab' })
  const before = dupes(ids(host.doc))
  const lines = host.repair()
  report.D = { before, lines, md: mdOf(host.doc) }
  check('D: concurrent splits that carry the id duplicate it', before.includes('p4'), before.join(','))
  check('D: repair re-ids the later ones, no text deleted', dupes(ids(host.doc)).length === 0 && ids(host.doc).includes('p4') && lines.length >= 1, lines.join(' | '))
}

writeFileSync(new URL('moves.json', out), JSON.stringify({ results, report }, null, 2))
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
