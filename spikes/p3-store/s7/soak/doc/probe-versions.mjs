// S7a probe: does a delta-chain version reconstruct the state it recorded? Compares, on a finished soak store, the
// newest version (keyframe + deltas) with the head + log tail, by canonical JSON and by content ids.
import * as Y from '@y/y'
import { ynodeToPmnode } from '@y/prosemirror'
import { Store } from '../store.mjs'
import { schemaFor } from './schema.mjs'

const path = process.argv[2] ?? '/tmp/p3-s7a/doc-normal-delta.sqlite'
const store = new Store(path, { encoding: 'delta' }, { fresh: false })
const schema = schemaFor({ uniqueId: false })
const canon = v => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v)
const view = d => JSON.stringify(canon({ body: ynodeToPmnode(d.get('tabs').getAttr('t1').getAttr('body'), schema).toJSON(), threads: d.get('threads').toJSON() }))
const vs = store.versions()
const newest = vs.at(-1)
const head = store.db.prepare('SELECT seq FROM head').get().seq
const tail = store.db.prepare('SELECT COUNT(*) AS n FROM updates WHERE seq > ?').get(newest.seq).n
console.log('versions', vs.length, 'newest', newest.seq, newest.kind, newest.enc, 'head', head, 'log rows after newest', tail)
const { doc: live } = store.load()
const { state, chain } = store.stateAt(newest.seq)
const rec = new Y.Doc(); Y.applyUpdateV2(rec, state)
console.log('chain', chain, 'pending in reconstructed', !!rec.store.pendingStructs, !!rec.store.pendingDs, 'skips empty', rec.store.skips.isEmpty())
const a = view(live); const b = view(rec)
console.log('canonical JSON equal (live vs newest version):', a === b, a.length, b.length)
if (a !== b) { let i = 0; while (a[i] === b[i]) i++; console.log('first diff at', i, '\nlive:', a.slice(i - 80, i + 120), '\nrec: ', b.slice(i - 80, i + 120)) }
const ia = Y.createContentIdsFromDoc(live, false); const ib = Y.createContentIdsFromDoc(rec, false)
const d1 = Y.excludeContentIds(ia, ib); const d2 = Y.excludeContentIds(ib, ia)
console.log('visible ids only in live', d1.inserts.clients.size, 'only in reconstructed', d2.inserts.clients.size)
// apply the deltas one by one instead of merging them
const kf = store.db.prepare("SELECT seq, bytes FROM versions WHERE enc = 'full' AND seq <= ? ORDER BY seq DESC LIMIT 1").get(newest.seq)
const seqd = new Y.Doc(); Y.applyUpdateV2(seqd, kf.bytes)
for (const r of store.db.prepare('SELECT bytes FROM versions WHERE seq > ? AND seq <= ? ORDER BY seq').all(kf.seq, newest.seq)) Y.applyUpdateV2(seqd, r.bytes)
console.log('sequential apply equal to live:', view(seqd) === a, 'pending', !!seqd.store.pendingStructs, !!seqd.store.pendingDs)
process.exit(0)
