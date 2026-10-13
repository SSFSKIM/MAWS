// S4: S1's hub (`s1/lib/link.mjs`, the star of in-process replicas logging `{seq, actor, at, bytes}`) with one
// change: an incoming update is handed to `receive(update, port)` instead of being applied inside
// y-protocols' readSyncMessage, so the host can read an update's own content before applying it (an edit that
// lands in a tombstoned block is garbage-collected on arrival; its text survives only in the bytes that carried it).
// Throwaway spike code.
import * as Y from '@y/y'
import * as sync from '@y/protocols/sync'
import * as aw from '@y/protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

export interface Port { isPort: true, actor: string, replicaDoc: Y.Doc, replicaAw: any, open: boolean, toReplica: (m: Uint8Array) => void, toHost: (m: Uint8Array) => void, onReplicaUpdate: any, onReplicaAw: any }
export interface LogEntry { seq: number, actor: string, at: number, v1: Uint8Array, v2: Uint8Array }

/** Read one y-protocols sync message, passing update payloads to `apply` (step 1 is answered as usual). */
export const readSync = (d: decoding.Decoder, reply: encoding.Encoder, doc: Y.Doc, apply: (u: Uint8Array, step2: boolean) => void) => {
  const t = decoding.readVarUint(d)
  if (t === sync.messageYjsSyncStep1) sync.readSyncStep1(d, reply, doc as any)
  else apply(decoding.readVarUint8Array(d), t === sync.messageYjsSyncStep2)
}

export const createHub = ({ hostDoc, clock = () => Date.now(), receive }: { hostDoc: Y.Doc, clock?: () => number, receive?: (update: Uint8Array, origin: any, opts: { step2: boolean }) => void }) => {
  const log: LogEntry[] = []
  const ports = new Set<Port>()
  const queue: Array<() => void> = []
  const hostAw = new aw.Awareness(hostDoc as any)
  hostAw.setLocalState(null)
  const applyToHost = receive ?? ((u: Uint8Array, origin: any) => Y.applyUpdate(hostDoc, u, origin))

  hostDoc.on('update', (update: Uint8Array, origin: any) => {
    const port = origin && origin.isPort ? origin : null
    const actor = port ? port.actor : (origin && origin.actor) || 'host'
    log.push({ seq: log.length + 1, actor, at: clock(), v1: update, v2: Y.convertUpdateFormatV1ToV2(update) })
    for (const p of ports) if (p !== port) p.toReplica(frameUpdate(update))
  })
  hostAw.on('update', ({ added, updated, removed }: any, origin: any) => {
    const bytes = aw.encodeAwarenessUpdate(hostAw, added.concat(updated, removed))
    for (const p of ports) if (p !== origin) p.toReplica(frameAw(bytes))
  })
  const frameUpdate = (update: Uint8Array) => { const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); sync.writeUpdate(e, update); return encoding.toUint8Array(e) }
  const frameAw = (bytes: Uint8Array) => { const e = encoding.createEncoder(); encoding.writeVarUint(e, 1); encoding.writeVarUint8Array(e, bytes); return encoding.toUint8Array(e) }
  const handle = (doc: Y.Doc, awareness: any, msg: Uint8Array, origin: any, reply: (m: Uint8Array) => void, toHost: boolean) => {
    const d = decoding.createDecoder(msg)
    const type = decoding.readVarUint(d)
    if (type === 0) {
      const e = encoding.createEncoder(); encoding.writeVarUint(e, 0)
      readSync(d, e, doc, (u, step2) => (toHost ? applyToHost(u, origin, { step2 }) : Y.applyUpdate(doc, u, origin)))
      if (encoding.length(e) > 1) reply(encoding.toUint8Array(e))
    } else if (type === 1) aw.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(d), origin)
  }

  const connect = (replicaDoc: Y.Doc, actor: string, replicaAw: any = new aw.Awareness(replicaDoc as any)): Port => {
    const port = { isPort: true, actor, replicaDoc, replicaAw, open: true } as Port
    port.toReplica = msg => queue.push(() => port.open && handle(replicaDoc, replicaAw, msg, port, r => port.toHost(r), false))
    port.toHost = msg => queue.push(() => port.open && handle(hostDoc, hostAw, msg, port, r => port.toReplica(r), true))
    port.onReplicaUpdate = (update: Uint8Array, origin: any) => { if (origin !== port) port.toHost(frameUpdate(update)) }
    port.onReplicaAw = ({ added, updated, removed }: any, origin: any) => { if (origin !== port) port.toHost(frameAw(aw.encodeAwarenessUpdate(replicaAw, added.concat(updated, removed)))) }
    replicaDoc.on('update', port.onReplicaUpdate)
    replicaAw.on('update', port.onReplicaAw)
    ports.add(port)
    const s1 = (d: Y.Doc) => { const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); sync.writeSyncStep1(e, d as any); return encoding.toUint8Array(e) }
    port.toHost(s1(replicaDoc)); port.toReplica(s1(hostDoc))
    const states = Array.from(hostAw.getStates().keys())
    if (states.length) port.toReplica(frameAw(aw.encodeAwarenessUpdate(hostAw, states)))
    if (replicaAw.getLocalState()) port.toHost(frameAw(aw.encodeAwarenessUpdate(replicaAw, [replicaDoc.clientID])))
    return port
  }
  const flush = () => {
    let n = 0
    while (queue.length) { if (++n > 100000) throw new Error('hub: frame storm'); queue.shift()!() }
    return n
  }
  return { log, hostAw, connect, flush, ports }
}
