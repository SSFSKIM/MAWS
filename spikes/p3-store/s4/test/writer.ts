// S4 items 1 and 3 in Node (no DOM): the patch writer's ops, the atomic batch with target-only validation,
// idempotency, schema validation, and marks (overlapping comments, bold, link) through rewrites, a type change,
// a move and a deletion. Run:
//   node spikes/p3-store/s4/test/writer.ts        (writes s4/out/writer.json and s4/out/writer-read.txt)
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import { world, check, results, mdOf, blockMd, marksOf, threads, liveThreads, ids, dupes, converged, nodeOf, agentMarks } from './setup.ts'

const out = new URL('../out/', import.meta.url)
console.log('agent marks (markdown-expressible):', [...agentMarks].join(', '))

// ── the read format ──
{
  const { host } = world()
  writeFileSync(new URL('writer-read.txt', out), mdOf(host.doc))
  console.log(mdOf(host.doc))
}

// ── 1. ops ──
{
  const { host, agent } = world()
  const a = agent('agent:s1')
  const r = host.revision
  let res = host.edit(a, { toolUseId: 'u1', baseRevision: r, ops: [{ op: 'replace_text', block: 'p1', old: 'two sentences', new: 'three short sentences' }] })
  check('replace_text exact in a block', res.ok && blockMd(host.doc, 'p1').endsWith('It has three short sentences.'), JSON.stringify(res))
  check('replace_text keeps unchanged words\' marks', marksOf(host.doc, 'p1') === 'The |quick [c:t1]|brown[c:t1,c:t2]| fox[c:t2]| jumps over the |lazy[bold]| |dog[link]|. It has three short sentences.', marksOf(host.doc, 'p1'))

  res = host.edit(a, { toolUseId: 'u2', baseRevision: host.revision, ops: [{ op: 'replace_text', old: 'The ', new: 'A ' }] })
  check('replace_text not unique → error listing candidates', !res.ok && res.error?.code === 'not_unique' && (res.error.candidates as any[]).length >= 2, JSON.stringify(res.error?.candidates?.map((c: any) => `${c.id}×${c.matches}`)))
  res = host.edit(a, { toolUseId: 'u3', baseRevision: host.revision, ops: [{ op: 'replace_text', old: 'review is planned', new: 'x' }] })
  check('replace_text not found → error listing near blocks', !res.ok && res.error?.code === 'not_found' && (res.error.candidates as any[]).some((c: any) => c.id === 'p2'), JSON.stringify(res.error))
  res = host.edit(a, { toolUseId: 'u4', baseRevision: host.revision, ops: [{ op: 'replace_text', old: 'item', new: 'entry', all: true }] })
  check('replace_text all', res.ok && blockMd(host.doc, 'l1') === '- first entry\n- second entry with **bold**', blockMd(host.doc, 'l1'))
  check('replace_text all keeps the list items\' ids', ids(host.doc).includes('li1') && ids(host.doc).includes('lp2'))

  const before = Y.encodeStateVector(host.doc)
  res = host.edit(a, { toolUseId: 'u5', baseRevision: host.revision, ops: [{ op: 'insert', after: 'h1', markdown: 'An inserted **intro** paragraph.\n\n- with a list' }] })
  const newIds = res.ok ? res.newIds : []
  check('insert after: ids minted for every block written', res.ok && newIds.length === 4 && newIds.every(i => ids(host.doc).includes(i)), JSON.stringify(res))
  res = host.edit(a, { toolUseId: 'u6', baseRevision: host.revision, ops: [{ op: 'insert', before: 'p4', markdown: '## Before closing' }] })
  check('insert before', res.ok && mdOf(host.doc).includes('## Before closing ^' + (res.ok ? res.newIds[0] : '') + '\n\nClosing paragraph'), res.ok ? res.lines[0] : JSON.stringify(res))

  res = host.edit(a, { toolUseId: 'u7', baseRevision: host.revision, ops: [{ op: 'set_cell', table: 'tb1', row: 2, col: 1, markdown: '**42**' }] })
  check('set_cell', res.ok && /\| beta +\| \*\*42\*\* \|/.test(blockMd(host.doc, 'tb1')), blockMd(host.doc, 'tb1'))
  check('set_cell keeps the cell\'s ids', ids(host.doc).includes('td2b') && ids(host.doc).includes('td2bp'))

  res = host.edit(a, { toolUseId: 'u8', baseRevision: host.revision, ops: [{ op: 'move', id: 'p3', after: 'c1' }] })
  const order = (host.doc.get('default') as any).toArray().map((n: any) => n.getAttr('id'))
  check('move: order', res.ok && order.indexOf('p3') === order.indexOf('c1') + 1, order.join(' '))
  check('move: id and marks kept', marksOf(host.doc, 'p3') === 'A plain paragraph the human types into. |Words[c:t4]| to keep.', marksOf(host.doc, 'p3'))

  res = host.edit(a, { toolUseId: 'u9', baseRevision: host.revision, ops: [{ op: 'delete', id: 'p2' }] })
  check('delete: block gone, its comment reported orphaned (derived: no live text), its thread and stored quote untouched', res.ok && !ids(host.doc).includes('p2') && res.orphaned.includes('t3') && !liveThreads(host.doc).has('t3') && threads(host.doc).t3.quote === 'scheduled for Friday', JSON.stringify(res))

  // idempotency: the same tool-use id replays the result and writes nothing
  const sv = Y.encodeStateVector(host.doc); const rev = host.revision
  const again = host.edit(a, { toolUseId: 'u9', baseRevision: 0, ops: [{ op: 'delete', id: 'p2' }] })
  check('idempotent: a repeated tool-use id replays, writes nothing', (again as any).replayed && Buffer.compare(Buffer.from(sv), Buffer.from(Y.encodeStateVector(host.doc))) === 0 && host.revision === rev)
  check('replicas converge (host, agent)', converged(host.doc, a.doc))
  check('no duplicate ids', dupes(ids(host.doc)).length === 0, dupes(ids(host.doc)).join(','))
  void before
}

// ── 1b. type changes ──
{
  const { host, agent } = world()
  const a = agent('agent:s1')
  let res = host.edit(a, { toolUseId: 't1', baseRevision: host.revision, ops: [{ op: 'replace_block', id: 'p1', markdown: '## The quick brown fox jumps over the lazy [dog](https://example.com).' }] })
  const n = nodeOf(host.doc, 'p1')
  check('type change paragraph → heading keeps the id', res.ok && n.name === 'heading' && n.getAttr('level') === 2, JSON.stringify(res))
  check('type change re-maps the comments onto the unchanged words', marksOf(host.doc, 'p1') === 'The |quick [c:t1]|brown[c:t1,c:t2]| fox[c:t2]| jumps over the lazy |dog[link]|.', marksOf(host.doc, 'p1'))
  res = host.edit(a, { toolUseId: 't2', baseRevision: host.revision, ops: [{ op: 'replace_block', id: 'p2', markdown: '- The review is scheduled for Friday.' }] })
  const l = nodeOf(host.doc, 'p2')
  check('type change paragraph → list item keeps the id (on the list)', res.ok && l.name === 'bulletList', JSON.stringify(res) + ' ' + l.name)
  check('…and re-maps the comment into the item\'s paragraph', marksOf(host.doc, 'p2') === 'The review is |scheduled for Friday[c:t3]|.', marksOf(host.doc, 'p2'))
  check('…the dropped words orphan nothing that still has text', res.ok && res.orphaned.length === 0 && liveThreads(host.doc).has('t3'))
  res = host.edit(a, { toolUseId: 't3', baseRevision: host.revision, ops: [{ op: 'replace_block', id: 'p3', markdown: '```\nA plain paragraph the human types into. Words to keep.\n```' }] })
  check('type change into a code block: comments not allowed there → reported orphaned', res.ok && nodeOf(host.doc, 'p3').name === 'codeBlock' && res.orphaned.includes('t4') && !liveThreads(host.doc).has('t4'), JSON.stringify(res))
  res = host.edit(a, { toolUseId: 't4', baseRevision: host.revision, ops: [{ op: 'replace_block', id: 'h1', markdown: '### Section 1 plan' }] })
  check('same type, attribute change (heading level) is a setAttr, text untouched', res.ok && nodeOf(host.doc, 'h1').getAttr('level') === 3, JSON.stringify(res))
  check('converged', converged(host.doc, a.doc))
}

// ── 1c. the atomic batch: target-only validation, all or none, schema validation ──
{
  const { host, agent, human } = world()
  const a = agent('agent:s1'); const h = human()
  const base = host.revision
  // the human types in p3 and in p1 after the agent's read
  ;(h.doc.get('default') as any).get(3).insert(2, 'NEW ') // p3
  ;(h.doc.get('default') as any).get(1).insert(0, 'Well, ') // p1
  host.flush()
  let res = host.edit(a, { toolUseId: 'b1', baseRevision: base, ops: [
    { op: 'replace_text', block: 'p2', old: 'Friday', new: 'Monday' },
    { op: 'replace_block', id: 'p3', markdown: 'Rewritten.' }
  ] })
  check('conflict on a target the human changed: the whole batch rejected, naming the block with its current text', !res.ok && res.conflicts?.length === 1 && res.conflicts[0].block === 'p3' && res.conflicts[0].text.startsWith('A NEW plain'), JSON.stringify(res))
  check('…and nothing applied (all or none)', blockMd(host.doc, 'p2').includes('Friday'))
  res = host.edit(a, { toolUseId: 'b2', baseRevision: base, ops: [{ op: 'replace_text', block: 'p2', old: 'Friday', new: 'Monday' }, { op: 'replace_block', id: 'p4', markdown: 'Closing words.' }] })
  check('the human\'s typing elsewhere never conflicts', res.ok, JSON.stringify(res))
  // §4.4 as written ('block'): replace_text in a block the human typed in is rejected even though the quote is intact
  res = host.edit(a, { toolUseId: 'b3', baseRevision: base, ops: [{ op: 'replace_text', block: 'p1', old: 'lazy', new: 'sleepy' }] }, { replaceText: 'block' })
  check('§4.4 literal: replace_text in a block the human typed in after the read is rejected', !res.ok && res.conflicts?.[0]?.block === 'p1', JSON.stringify(res))
  res = host.edit(a, { toolUseId: 'b4', baseRevision: base, ops: [{ op: 'replace_text', block: 'p1', old: 'lazy', new: 'sleepy' }] }, { replaceText: 'match' })
  check('amended: replace_text validated by its quote applies, and keeps the human\'s words', res.ok && blockMd(host.doc, 'p1').startsWith('Well, The quick') && blockMd(host.doc, 'p1').includes('**sleepy**'), blockMd(host.doc, 'p1'))
  // one failing op → nothing applied
  const sv = Y.encodeStateVector(a.doc)
  res = host.edit(a, { toolUseId: 'b5', baseRevision: host.revision, ops: [{ op: 'replace_text', block: 'p4', old: 'Closing', new: 'Final' }, { op: 'delete', id: 'nope' }] })
  check('a failing op in the batch → error with its index, nothing applied', !res.ok && res.error?.code === 'not_found' && /op 1/.test(res.error.message) && Buffer.compare(Buffer.from(sv), Buffer.from(Y.encodeStateVector(a.doc))) === 0, JSON.stringify(res))
  // schema validation: a heading inside a list item position is rejected by the renderer's schema
  res = host.edit(a, { toolUseId: 'b6', baseRevision: host.revision, ops: [{ op: 'replace_block', id: 'li1', markdown: '## not an item' }] })
  check('schema validation: a list item replaced by a heading is rejected, nothing applied', !res.ok && Buffer.compare(Buffer.from(sv), Buffer.from(Y.encodeStateVector(a.doc))) === 0, JSON.stringify(res.ok ? res : res.error?.message))
  // a table that gained a row since the read: set_cell by (row, col) conflicts on the table's shape
  const base2 = host.revision
  host.edit(agent('agent:s2'), { toolUseId: 'b7', baseRevision: base2, ops: [{ op: 'replace_block', id: 'tb1', markdown: '| Name | Value |\n| --- | --- |\n| zero | 0 |\n| alpha | 1 |\n| beta | 2 |' }] })
  res = host.edit(a, { toolUseId: 'b8', baseRevision: base2, ops: [{ op: 'set_cell', table: 'tb1', row: 1, col: 1, markdown: '100' }] })
  check('set_cell after another writer added a row: conflict on the table\'s shape', !res.ok && res.conflicts?.some(c => c.block === 'tb1'), JSON.stringify(res))
  check('converged (host, agent, human)', converged(host.doc, a.doc, h.doc))
}

// ── 3. marks through rewrites ──
{
  const { host, agent } = world()
  const a = agent('agent:s1')
  let res = host.edit(a, { toolUseId: 'm1', baseRevision: host.revision, ops: [{ op: 'replace_block', id: 'p1', markdown: 'The quick brown fox leaps over the **lazy** [dog](https://example.com) twice. It has two sentences.' }] })
  check('marks: a rewrite keeps overlapping comments, bold and link on unchanged words', res.ok && marksOf(host.doc, 'p1') === 'The |quick [c:t1]|brown[c:t1,c:t2]| fox[c:t2]| leaps over the |lazy[bold]| |dog[link]| twice. It has two sentences.', marksOf(host.doc, 'p1'))
  res = host.edit(a, { toolUseId: 'm2', baseRevision: host.revision, ops: [{ op: 'replace_text', block: 'p1', old: 'quick brown', new: 'quick red' }] })
  check('marks: a word replaced inside overlapping comments stays covered by both', res.ok && marksOf(host.doc, 'p1').startsWith('The |quick [c:t1]|red[c:t1,c:t2]| fox[c:t2]'), marksOf(host.doc, 'p1'))
  check('marks: neither comment orphaned', res.ok && res.orphaned.length === 0 && liveThreads(host.doc).has('t1') && liveThreads(host.doc).has('t2'))
  res = host.edit(a, { toolUseId: 'm3a', baseRevision: host.revision, ops: [{ op: 'replace_text', block: 'p2', old: 'scheduled for Friday', new: 'planned for Monday' }] })
  check('marks (A5): rewording a comment\'s words in place keeps it on the new words', res.ok && marksOf(host.doc, 'p2') === 'The review is |planned for Monday[c:t3]| and the owner signs off after it.', marksOf(host.doc, 'p2'))
  res = host.edit(a, { toolUseId: 'm3', baseRevision: host.revision, ops: [{ op: 'replace_text', block: 'p2', old: 'review is planned for Monday and', new: 'review and' }] })
  check('marks: a comment whose words are all deleted is orphaned (derived), its thread keeps its stored quote', res.ok && res.orphaned.includes('t3') && !liveThreads(host.doc).has('t3') && threads(host.doc).t3.quote === 'scheduled for Friday', JSON.stringify(res))
  res = host.edit(a, { toolUseId: 'm4', baseRevision: host.revision, ops: [{ op: 'replace_block', id: 'p1', markdown: 'The quick red fox leaps over the lazy dog twice.' }] })
  check('marks: the agent removing ** and [] removes bold and link (its marks), comments stay', res.ok && marksOf(host.doc, 'p1') === 'The |quick [c:t1]|red[c:t1,c:t2]| fox[c:t2]| leaps over the lazy dog twice.', marksOf(host.doc, 'p1'))
  res = host.edit(a, { toolUseId: 'm5', baseRevision: host.revision, ops: [{ op: 'replace_block', id: 'p1', markdown: '### The quick red fox leaps over the lazy dog twice.' }, { op: 'move', id: 'p1', after: 'p4' }] })
  check('marks: survive a type change and a move in one batch', res.ok && nodeOf(host.doc, 'p1').name === 'heading' && marksOf(host.doc, 'p1') === 'The |quick [c:t1]|red[c:t1,c:t2]| fox[c:t2]| leaps over the lazy dog twice.' && (host.doc.get('default') as any).toArray().at(-1).getAttr('id') === 'p1', marksOf(host.doc, 'p1'))
  check('converged', converged(host.doc, a.doc))
}

writeFileSync(new URL('writer.json', out), JSON.stringify({ results }, null, 2))
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
