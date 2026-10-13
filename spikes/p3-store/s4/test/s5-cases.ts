// S4 × S5: S5's agent-rewrite cases (spikes/p3-store/s5/s5-pins.mjs, the §4.4 A5 rule) run through S4's patch writer
// (`replace_block` with the new sentence as markdown), with and without the whitespace merge, so P3-B gets one writer.
// Expected covers are S5's. Run:
//   node spikes/p3-store/s4/test/s5-cases.ts     (writes s4/out/s5-cases.json)
import { writeFileSync } from 'node:fs'
import * as Y from '@y/y'
import { pmnodeToDelta } from '@y/prosemirror'
import { schema, md, agentMarks, check, results, coveredIn, liveThreads } from './setup.ts'
import { PatchWriter } from '../src/patch-writer.ts'

const P1 = 'The plan ships quarterly with design review notes. Owners track the budget.'
const seed = () => {
  const s = schema; const c = (id: string) => s.marks.comment.create({ threadId: id })
  const doc = new Y.Doc()
  const pm = s.nodes.doc.create(null, [
    s.nodes.paragraph.create({ id: 'p1' }, [s.text('The plan '), s.text('ships quarterly with ', [c('t1')]), s.text('design review', [c('t1'), c('t2')]), s.text(' notes', [c('t2')]), s.text('. Owners track the budget.')]),
    s.nodes.paragraph.create({ id: 'p2' }, [s.text('This one '), s.text('keeps going', [c('t3')]), s.text('.')])
  ])
  doc.transact(() => (doc.get('default') as any).applyDelta(pmnodeToDelta(pm)))
  return doc
}
const J = (x: unknown) => JSON.stringify(x)
const BASE = { t1: 'ships quarterly with design review', t2: 'design review notes', t3: 'keeps going' }
const cases: Array<[string, string, boolean, Record<string, string>, string[]]> = [
  ['agent rewords t2 in place', 'The plan ships quarterly with a short summary. Owners track the budget.', true, { t1: 'ships quarterly with ', t2: 'a short summary' }, []],
  ['…without the whitespace merge (contrast)', 'The plan ships quarterly with a short summary. Owners track the budget.', false, { t1: 'ships quarterly with a short', t2: 'a short summary' }, []],
  ['agent deletes t2\'s words', 'The plan ships quarterly. Owners track the budget.', true, { t1: 'ships quarterly' }, ['t2']],
  ['agent rewrites the whole sentence', 'Shipping is monthly now. Owners track the budget.', true, {}, ['t1', 't2']],
  ['…without the whitespace merge (contrast)', 'Shipping is monthly now. Owners track the budget.', false, { t1: ' is monthly', t2: 'is monthly now' }, []]
]
const out: any[] = []
const base = seed()
check('seed covers as S5\'s base', J({ ...coveredIn(base, 'p1'), ...coveredIn(base, 'p2') }) === J(BASE), J(coveredIn(base, 'p1')))
for (const [name, text, merge, want, orphans] of cases) {
  const doc = seed()
  const w = new PatchWriter({ schema, md, agentMarks, mergeWhitespace: merge })
  const r = w.apply(doc, [{ op: 'replace_block', id: 'p1', markdown: text }])
  const got = coveredIn(doc, 'p1')
  const live = liveThreads(doc)
  const ok = J(got) === J(want) && J(r.orphaned.sort()) === J(orphans) && orphans.every(t => !live.has(t)) && live.has('t3')
  check(`${name}${merge ? '' : ' [merge off]'}`, ok, `${J(got)} orphaned ${J(r.orphaned)}`)
  out.push({ name, merge, text, got, orphaned: r.orphaned, want, wantOrphans: orphans })
}
writeFileSync(new URL('../out/s5-cases.json', import.meta.url), JSON.stringify({ results, cases: out }, null, 2))
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
