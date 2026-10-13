// S7a probe: does S3's revert (`revertUpdate`) bring a document version back exactly, by the version's age, on a finished
// doc soak store? Compares the body (canonical PM JSON) and the threads map; also S3's structural diff paired by id.
// Usage: node spikes/p3-store/s7/soak/doc/probe-restore.mjs [doc-normal-delta]
import * as Y from '@y/y'
import { ynodeToPmnode } from '@y/prosemirror'
import { Store, DAY, HOUR } from '../store.mjs'
import { revertUpdate, diffUpdate, byId } from './restore.mjs'
import { revertUpdateFixed } from '../revert.mjs'
import { schemaFor } from './schema.mjs'

const tag = process.argv[2] ?? 'doc-normal-delta'
const store = new Store(`/tmp/p3-s7a/${tag}.sqlite`, { encoding: tag.split('-')[2] }, { fresh: false })
const schema = schemaFor({ uniqueId: false })
const canon = v => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v)
const parts = d => ({ body: JSON.stringify(canon(ynodeToPmnode(d.get('tabs').getAttr('t1').getAttr('body'), schema).toJSON())), threads: JSON.stringify(canon(d.get('threads').toJSON())) })
const blocks = d => ynodeToPmnode(d.get('tabs').getAttr('t1').getAttr('body'), schema).toJSON().content.map(b => JSON.stringify(canon(b)))
const { doc: live } = store.load()
const next = Y.encodeStateAsUpdateV2(live)
const vs = store.versions(); const newest = vs.at(-1)
for (const age of [DAY, 7 * DAY, 30 * DAY, 90 * DAY, 150 * DAY]) {
  const target = [...vs].reverse().find(v => v.at <= newest.at - age)
  if (!target) continue
  const prev = store.stateAt(target.seq).state
  const old = new Y.Doc(); Y.applyUpdateV2(old, prev)
  const want = parts(old); const wantBlocks = blocks(old)
  const row = { age: age / HOUR + 'h', kind: target.kind }
  for (const [name, fn] of [['revert', () => revertUpdate(prev, next)], ['revertFixed', () => revertUpdateFixed(prev, next)], ['diffById', () => diffUpdate(prev, next, { compare: byId })]]) {
    try {
      const t0 = performance.now(); const R = fn(); const ms = Math.round(performance.now() - t0)
      const d = new Y.Doc(); Y.applyUpdateV2(d, next); if (R) Y.applyUpdateV2(d, R)
      const got = parts(d); const gotBlocks = blocks(d)
      const wb = new Set(wantBlocks); const missing = wantBlocks.filter(b => !new Set(gotBlocks).has(b)).length; const extra = gotBlocks.filter(b => !wb.has(b)).length
      row[name] = { ms, body: got.body === want.body, threads: got.threads === want.threads, blocksMissing: missing, blocksExtra: extra }
    } catch (e) { row[name] = 'throws: ' + e.message.slice(0, 80) }
  }
  console.log(JSON.stringify(row))
}
process.exit(0)
