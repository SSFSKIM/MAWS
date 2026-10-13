// S4 probe: why an in-flight edit into a moved-away block is not forwarded.
import * as Y from '@y/y'
import { world, nodeOf } from '../test/setup.ts'
const { host, agent, human } = world()
const a = agent('agent:s1'); const h = human()
const n0 = nodeOf(h.doc, 'p3'); h.doc.transact(() => n0.insert(n0.length, ' ㅎ', {})); host.flush()
const hold: any[] = []; const realQ = (h.port as any).toReplica; (h.port as any).toReplica = (m: any) => hold.push(m)
host.edit(a, { toolUseId: 'mv1', baseRevision: host.revision, ops: [{ op: 'move', id: 'p3', after: 'c1' }] })
console.log('carries', host.carries.map(c => ({ kind: c.kind, seq: c.seq, n: c.from.length, from0: c.from.slice(-3), to0: c.to.slice(-3) })))
const n = nodeOf(h.doc, 'p3'); const len = n.length
h.doc.transact(() => { n.delete(len - 1, 1); n.insert(len - 1, '하', {}) }); host.flush()
const e = host.hub.log.at(-1)
console.log('last log', e.seq, e.actor, 'fwdsize', host.fwd.size)
const { structs, ds } = Y.decodeUpdateV2(e.v2) as any
for (const s of structs) console.log(s.constructor.name, s.id, 'origin', s.origin, 'right', s.rightOrigin, 'parent', s.parent, s.content?.constructor?.name, s.content?.str)
ds.clients.forEach((r: any, c: number) => console.log('ds', c, r.getIds()))
console.log('resolve origin', structs[0]?.origin && host.resolve([structs[0].origin.client, structs[0].origin.clock], e.seq))
host.afterUpdates()
console.log(host.report)
process.exit(0)
