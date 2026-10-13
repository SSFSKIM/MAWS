// S1 helper: a host Y.Doc with replicas attached through y-protocols sync (0) and awareness (1) frames,
// the star topology of the P3 spec §4.2 (host doc service, one port per replica, each agent its own replica).
// The host appends every update it receives to a log tagged with the sending port's actor and a timestamp
// (the `artifact_updates` row shape: seq, actor, at, bytes). Frames are queued and drained by `flush()` so no
// update is applied re-entrantly inside another doc's update handler.
// Parameterized by the Yjs generation so the same code runs v13 (yjs, y-protocols, lib0 0.2) and v14 (@y/y,
// @y/protocols, lib0 1.0 rc). Throwaway spike code (P3-0, S1).

export const createHub = ({ Y, sync, aw, encoding, decoding, hostDoc, clock = () => Date.now() }) => {
  const log = [] // { seq, actor, at, v1, v2 }
  const ports = new Set()
  const queue = []
  const hostAw = new aw.Awareness(hostDoc)
  hostAw.setLocalState(null)
  let currentPort = null

  hostDoc.on('update', (update, origin) => {
    const port = origin && origin.isPort ? origin : null
    const actor = port ? port.actor : (origin && origin.actor) || 'host'
    log.push({ seq: log.length + 1, actor, at: clock(), v1: update, v2: Y.convertUpdateFormatV1ToV2(update) })
    for (const p of ports) if (p !== port) p.toReplica(frameUpdate(update))
  })
  hostAw.on('update', ({ added, updated, removed }, origin) => {
    const changed = added.concat(updated, removed)
    const bytes = aw.encodeAwarenessUpdate(hostAw, changed)
    for (const p of ports) if (p !== origin) p.toReplica(frameAw(bytes))
  })

  const frameUpdate = update => {
    const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); sync.writeUpdate(e, update); return encoding.toUint8Array(e)
  }
  const frameAw = bytes => {
    const e = encoding.createEncoder(); encoding.writeVarUint(e, 1); encoding.writeVarUint8Array(e, bytes); return encoding.toUint8Array(e)
  }
  const handle = (doc, awareness, msg, origin, reply) => {
    const d = decoding.createDecoder(msg)
    const type = decoding.readVarUint(d)
    if (type === 0) {
      const e = encoding.createEncoder(); encoding.writeVarUint(e, 0)
      sync.readSyncMessage(d, e, doc, origin)
      if (encoding.length(e) > 1) reply(encoding.toUint8Array(e))
    } else if (type === 1) {
      aw.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(d), origin)
    }
  }

  /** Attach a replica doc as `actor`; returns the port. `replicaAw` is the replica's Awareness (optional). */
  const connect = (replicaDoc, actor, replicaAw = new aw.Awareness(replicaDoc)) => {
    const port = { isPort: true, actor, replicaDoc, replicaAw, open: true }
    port.toReplica = msg => queue.push(() => port.open && handle(replicaDoc, replicaAw, msg, port, r => port.toHost(r)))
    port.toHost = msg => queue.push(() => port.open && handle(hostDoc, hostAw, msg, port, r => port.toReplica(r)))
    port.onReplicaUpdate = (update, origin) => { if (origin !== port) port.toHost(frameUpdate(update)) }
    port.onReplicaAw = ({ added, updated, removed }, origin) => {
      if (origin === port) return
      port.toHost(frameAw(aw.encodeAwarenessUpdate(replicaAw, added.concat(updated, removed))))
    }
    replicaDoc.on('update', port.onReplicaUpdate)
    replicaAw.on('update', port.onReplicaAw)
    ports.add(port)
    // y-protocols handshake both ways: step 1 from each side, answered with step 2.
    const s1 = d => { const e = encoding.createEncoder(); encoding.writeVarUint(e, 0); sync.writeSyncStep1(e, d); return encoding.toUint8Array(e) }
    port.toHost(s1(replicaDoc))
    port.toReplica(s1(hostDoc))
    const states = Array.from(hostAw.getStates().keys())
    if (states.length) port.toReplica(frameAw(aw.encodeAwarenessUpdate(hostAw, states)))
    if (replicaAw.getLocalState()) port.toHost(frameAw(aw.encodeAwarenessUpdate(replicaAw, [replicaDoc.clientID])))
    return port
  }
  const disconnect = port => {
    port.open = false
    port.replicaDoc.off('update', port.onReplicaUpdate)
    port.replicaAw.off('update', port.onReplicaAw)
    ports.delete(port)
  }
  /** Drain queued frames until quiet (bounded). */
  const flush = () => {
    let n = 0
    while (queue.length) {
      if (++n > 100000) throw new Error('hub: frame storm (did not converge)')
      currentPort = null
      queue.shift()()
    }
    return n
  }
  return { log, hostAw, connect, disconnect, flush }
}
