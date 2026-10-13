// S4 item 5 in Node: op application time and update size per op kind on a mid-sized document (40 sections, 320
// top-level blocks), and the agent's attribution after a batch: the ContentMap built from the batch's update alone,
// rendered through v14's DiffRenderer (S1's history path), covers only the words the agent changed; a move's raw
// ContentMap covers the whole re-inserted block, and the carry puts the authorship back. Run:
//   node spikes/p3-store/s4/test/numbers.ts      (writes s4/out/numbers.json and s4/out/attribution.txt)
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import { ynodeToPmnode } from '@y/prosemirror'
import { world, check, results, schema } from './setup.ts'
import { attributedNodes } from '../src/schema.ts'
import { deepSlotIds } from '../src/patch-writer.ts'

const out = new URL('../out/', import.meta.url)
const SECTIONS = 40
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 100) / 100 }

// ── timing and sizes per op kind ──
const { host, agent } = world(SECTIONS)
const a = agent('agent:s1')
const docBytes = Y.encodeStateAsUpdateV2(host.doc).length
const blocks = (host.doc.get('default') as any).length
console.log(`document: ${blocks} top-level blocks, ${docBytes} B (V2 state), ${(host.doc.get('default') as any).toString().replace(/<[^>]*>/g, '').length} chars`)
const kinds: Record<string, (k: number) => any[]> = {
  replace_text: k => [{ op: 'replace_text', block: `ps${k}1`, old: 'two sentences', new: 'three short sentences' }],
  'replace_block (same type, 2 hunks)': k => [{ op: 'replace_block', id: `ps${k}2`, markdown: 'The review is scheduled for Monday and the owner signs off before it.' }],
  'replace_block (type change)': k => [{ op: 'replace_block', id: `ps${k}4`, markdown: '### Closing paragraph of this section, with enough words to look like prose that a person wrote.' }],
  insert: k => [{ op: 'insert', after: `hs${k}1`, markdown: 'A new paragraph with **bold** and a [link](https://example.com).' }],
  delete: k => [{ op: 'delete', id: `cs${k}1` }],
  move: k => [{ op: 'move', id: `ps${k}3`, after: `ps${k}4` }],
  set_cell: k => [{ op: 'set_cell', table: `tbs${k}1`, row: 1, col: 1, markdown: String(100 + k) }],
  'batch of 5': k => [
    { op: 'replace_text', block: `ps${k}1`, old: 'jumps over', new: 'leaps over' },
    { op: 'replace_text', block: `ps${k}2`, old: 'owner signs off', new: 'owner approves' },
    { op: 'insert', after: `ps${k}2`, markdown: 'Inserted.' },
    { op: 'set_cell', table: `tbs${k}1`, row: 2, col: 0, markdown: 'gamma' },
    { op: 'move', id: `ls${k}1`, after: `tbs${k}1` }
  ]
}
const numbers: Record<string, any> = {}
let tu = 0
for (const [kind, ops] of Object.entries(process.env.S4_SKIP_TIMING ? {} : kinds)) {
  const total: number[] = []; const writer: number[] = []; const bytes: number[] = []
  for (let k = 0; k < SECTIONS; k++) {
    const t0 = performance.now()
    const res = host.edit(a, { toolUseId: `n${tu++}`, baseRevision: host.revision, ops: ops(k) })
    total.push(performance.now() - t0)
    if (!res.ok) throw new Error(kind + ' ' + JSON.stringify(res))
    writer.push(res.ms); bytes.push(res.updateBytes)
  }
  numbers[kind] = { n: SECTIONS, editMs: { p50: pct(total, 0.5), p95: pct(total, 0.95) }, writerMs: { p50: pct(writer, 0.5), p95: pct(writer, 0.95) }, updateBytesV2: { p50: pct(bytes, 0.5), max: Math.max(...bytes) } }
  console.log(kind.padEnd(36), JSON.stringify(numbers[kind]))
}
// the dry run's share: a clone of the replica per batch
{
  const t0 = performance.now(); for (let i = 0; i < 20; i++) { const c = new Y.Doc(); Y.applyUpdateV2(c, Y.encodeStateAsUpdateV2(a.doc)) }
  numbers.cloneForDryRunMs = Math.round((performance.now() - t0) / 20 * 100) / 100
  console.log('clone for the dry run (per batch):', numbers.cloneForDryRunMs, 'ms')
}
if (!process.env.S4_SKIP_TIMING) check('every op kind applied 40 times on the mid-sized document', Object.keys(kinds).every(k => numbers[k].n === SECTIONS))

// ── attribution: the agent's ContentMap after a batch covers only the changed words ──
const lines: string[] = []
const attributionOf = (ops: any[], label: string) => {
  const w = world(1); const ag = w.agent('agent:s1')
  const prev = new Y.Doc({ gc: false }); Y.applyUpdateV2(prev, Y.encodeStateAsUpdateV2(w.host.doc))
  const from = w.host.revision
  const res = w.host.edit(ag, { toolUseId: 'att', baseRevision: from, ops })
  if (!res.ok) throw new Error(JSON.stringify(res))
  const batch = w.host.hub.log.slice(from).filter((e: any) => e.actor === 'agent:s1')
  const attributions = Y.mergeContentMaps(batch.map((e: any) => Y.createContentMapFromContentIds(Y.createContentIdsFromUpdateV2(e.v2),
    [Y.createContentAttribute('insert', e.actor), Y.createContentAttribute('insertAt', e.at)],
    [Y.createContentAttribute('delete', e.actor), Y.createContentAttribute('deleteAt', e.at)])))
  const next = new Y.Doc({ gc: false }); Y.applyUpdateV2(next, Y.encodeStateAsUpdateV2(w.host.doc))
  // the carry: re-inserted chars keep their original author, so they leave the agent's map
  const carriedSet = Y.createIdSet()
  for (const c of w.host.carries) for (const s of c.to) carriedSet.add(s[0], s[1], 1)
  const corrected = Y.excludeContentMap(attributions, Y.createContentIds(carriedSet, Y.createIdSet()))
  const render = (map: any) => {
    const renderer = Y.createDiffRenderer(prev, next, { attributions: map })
    const pm = ynodeToPmnode(next.get('default'), schema, { renderer, attributedNodes })
    const spans: string[] = []; let ins = 0; let del = 0
    pm.descendants((n: any, _pos: number, parent: any) => {
      if (!n.isText) return
      const i = n.marks.find((m: any) => m.type.name === 'y-attributed-insert'); const d = n.marks.find((m: any) => m.type.name === 'y-attributed-delete')
      const who = (m: any) => (m.attrs.userIds ?? []).join(',')
      if (i && who(i).includes('agent')) { spans.push(`+"${n.text}" in ^${parent.attrs.id}`); ins += n.text.length }
      if (d && who(d).includes('agent')) { spans.push(`-"${n.text}" in ^${parent.attrs.id}`); del += n.text.length }
    })
    return { spans, ins, del }
  }
  const raw = render(attributions); const fixed = render(corrected)
  let rawIns = 0; let carriedIns = 0
  attributions.inserts.forEach((r: any, client: number) => { for (let k = 0; k < r.len; k++) { rawIns++; if (carriedSet.has(client, r.clock + k)) carriedIns++ } })
  const enc = Y.encodeContentMap(attributions).length
  const spans = fixed.spans; const ins = fixed.ins; const del = fixed.del
  lines.push(`## ${label}`, `ops: ${JSON.stringify(ops)}`, `result: ${res.lines.join('; ')}`,
    `the agent's spans, raw ContentMap of the batch's update (${raw.ins} chars inserted, ${raw.del} deleted):`, ...raw.spans.map(s => '  ' + s),
    `the agent's spans after the carry (${ins} inserted, ${del} deleted):`, ...spans.map(s => '  ' + s),
    `raw ContentMap insert ids ${rawIns} (chars, nodes, attrs, format markers), of which carried ${carriedIns}; encoded ContentMap ${enc} B`, '')
  return { spans, ins, del, raw: { ins: raw.ins, del: raw.del }, rawIns, carriedIns, enc }
}
const r1 = attributionOf([
  { op: 'replace_text', block: 'p1', old: 'jumps over', new: 'leaps over' },
  { op: 'replace_block', id: 'p2', markdown: 'The review is scheduled for Monday and the owner signs off before it.' },
  { op: 'set_cell', table: 'tb1', row: 2, col: 1, markdown: '42' }
], 'a word-level batch')
check('attribution: only the changed words are the agent\'s (leaps, Monday, before, 42)', r1.ins === 'leaps'.length + 'Monday'.length + 'before'.length + '42'.length && r1.spans.some(s => s.startsWith('+"leaps"')), r1.spans.join(' '))
const r2 = attributionOf([{ op: 'replace_block', id: 'p4', markdown: '### Closing paragraph of this section, with enough words to look like prose that a person wrote.' }], 'a type change (paragraph → heading)')
check('attribution: a type change re-inserts the text (the raw map covers all of it); after the carry no char is the agent\'s', r2.raw.ins > 50 && r2.ins === 0, `raw ${r2.raw.ins} chars, after carry ${r2.ins}`)
const r3 = attributionOf([{ op: 'move', id: 'p3', after: 'p4' }], 'a move')
check('attribution: a move\'s raw map covers the whole block; after the carry none of it is the agent\'s', r3.raw.ins > 40 && r3.ins === 0, `raw ${r3.raw.ins} chars, after carry ${r3.ins}`)
writeFileSync(new URL('attribution.txt', out), lines.join('\n'))
console.log(lines.join('\n'))
void deepSlotIds

writeFileSync(new URL('numbers.json', out), JSON.stringify({ document: { blocks, docBytes }, numbers, attribution: { wordBatch: r1, typeChange: r2, move: r3 }, results }, null, 2))
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
