// S4: an editor replica attached to the host doc over a real MessageChannel carrying y-protocols sync (0) and
// awareness (1) frames plus the host's ack (100, S2's frame: [100, frames received, revision]), so remote updates reach
// the editor as separate tasks, as over the app's MessagePort. Parameterized by the Yjs generation (v14, and v13 for
// the comparison page). Minimal; S2 owns the real provider: the composition hold below is the part P3-A copies into it.
//
// The composition hold (Decision Log 33's split): the *provider* holds. While a hold is set it buffers inbound sync
// frames (type 0) in arrival order and never drops one; awareness (1) and ack (100) frames pass through, since neither
// touches the document. The *editor binding* sets and clears the hold (composition-hold.ts). A cap releases a hold
// after `capMs` even mid-composition, so a stuck composition cannot leave the replica diverged indefinitely.
// Throwaway spike code.

export interface YMods { sync: any, aw: any, encoding: any, decoding: any }
export const MSG_SYNC = 0
export const MSG_AWARENESS = 1
export const MSG_ACK = 100

export interface HoldStats {
  holds: number, flushes: number, framesHeld: number, maxHeldFrames: number, maxHeldMs: number, capFired: number,
  awarenessDuringHold: number, acksDuringHold: number, acks: number, sent: number, acked: number,
  arrived: number, syncApplied: number, outOfOrder: number
}
export interface Provider {
  /** Set the hold (idempotent); the cap timer starts with it. */
  hold: () => void
  /** Clear the hold and apply the buffered sync frames in arrival order. */
  release: () => void
  readonly holding: boolean
  readonly held: number
  readonly stats: HoldStats
  unlink: () => void
}

export const linkOverPort = (
  { sync, aw, encoding, decoding }: YMods,
  replica: any, replicaAw: any,
  hostDoc: any, hostAw: any,
  actor: string,
  { onHostApplied, receive, revision = () => 0, capMs = 5000 }: {
    onHostApplied?: () => void
    /** the host applies each update (S4's host reads it first, for edit forwarding); `step2` marks a catch-up diff */
    receive: (u: Uint8Array, origin: any, opts: { step2: boolean }) => void
    revision?: () => number
    capMs?: number
  }
): Provider => {
  const frame = (type: number, write: (e: any) => void) => { const e = encoding.createEncoder(); encoding.writeVarUint(e, type); write(e); return encoding.toUint8Array(e) }
  const ch = new MessageChannel()
  const hostOrigin = { isPort: true, actor } // shaped like S1's hub port: the hub logs the actor and fans out
  const replicaOrigin = { replica: actor }

  // ── host end: applies the replica's frames (through `receive`), acks each content frame, sends its changes ──
  let received = 0
  const hostPort = ch.port1
  hostPort.onmessage = (ev: MessageEvent) => {
    const d = decoding.createDecoder(new Uint8Array(ev.data))
    const type = decoding.readVarUint(d)
    if (type === MSG_SYNC) {
      const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_SYNC)
      const sub = decoding.readVarUint(d)
      if (sub === sync.messageYjsSyncStep1) sync.readSyncStep1(d, e, hostDoc)
      else {
        const u = decoding.readVarUint8Array(d)
        receive(u, hostOrigin, { step2: sub === sync.messageYjsSyncStep2 })
        received++
        hostPort.postMessage(frame(MSG_ACK, en => { encoding.writeVarUint(en, received); encoding.writeVarUint(en, revision()) }))
      }
      if (encoding.length(e) > 1) hostPort.postMessage(encoding.toUint8Array(e))
      onHostApplied?.()
    } else if (type === MSG_AWARENESS) aw.applyAwarenessUpdate(hostAw, decoding.readVarUint8Array(d), hostOrigin)
  }
  const onHostUpdate = (u: Uint8Array, o: unknown) => { if (o !== hostOrigin) hostPort.postMessage(frame(MSG_SYNC, e => sync.writeUpdate(e, u))) }
  const onHostAw = ({ added, updated, removed }: any, o: unknown) => {
    if (o === hostOrigin) return
    hostPort.postMessage(frame(MSG_AWARENESS, e => encoding.writeVarUint8Array(e, aw.encodeAwarenessUpdate(hostAw, added.concat(updated, removed)))))
  }
  hostDoc.on('update', onHostUpdate); hostAw.on('update', onHostAw)

  // ── replica end: the provider, with the composition hold ──
  const stats: HoldStats = { holds: 0, flushes: 0, framesHeld: 0, maxHeldFrames: 0, maxHeldMs: 0, capFired: 0, awarenessDuringHold: 0, acksDuringHold: 0, acks: 0, sent: 0, acked: 0, arrived: 0, syncApplied: 0, outOfOrder: 0 }
  const port = ch.port2
  const buffer: Array<{ n: number, data: Uint8Array }> = []
  let holding = false; let heldAt = 0; let cap: ReturnType<typeof setTimeout> | null = null
  let arrived = 0; let lastApplied = 0
  const applySync = (n: number, data: Uint8Array) => {
    if (n <= lastApplied) stats.outOfOrder++
    lastApplied = n
    const d = decoding.createDecoder(data); decoding.readVarUint(d)
    const e = encoding.createEncoder(); encoding.writeVarUint(e, MSG_SYNC)
    sync.readSyncMessage(d, e, replica, replicaOrigin)
    stats.syncApplied++
    if (encoding.length(e) > 1) port.postMessage(encoding.toUint8Array(e))
  }
  port.onmessage = (ev: MessageEvent) => {
    const data = new Uint8Array(ev.data)
    const d = decoding.createDecoder(data)
    const type = decoding.readVarUint(d)
    if (type === MSG_SYNC) {
      const n = ++arrived; stats.arrived = n
      if (holding) { buffer.push({ n, data }); stats.framesHeld++; stats.maxHeldFrames = Math.max(stats.maxHeldFrames, buffer.length) } else applySync(n, data)
    } else if (type === MSG_AWARENESS) {
      if (holding) stats.awarenessDuringHold++
      aw.applyAwarenessUpdate(replicaAw, decoding.readVarUint8Array(d), replicaOrigin)
    } else if (type === MSG_ACK) {
      if (holding) stats.acksDuringHold++
      stats.acks++; stats.acked = decoding.readVarUint(d)
    }
  }
  const onReplicaUpdate = (u: Uint8Array, o: unknown) => { if (o !== replicaOrigin) { stats.sent++; port.postMessage(frame(MSG_SYNC, e => sync.writeUpdate(e, u))) } }
  const onReplicaAw = ({ added, updated, removed }: any, o: unknown) => {
    if (o === replicaOrigin) return
    port.postMessage(frame(MSG_AWARENESS, e => encoding.writeVarUint8Array(e, aw.encodeAwarenessUpdate(replicaAw, added.concat(updated, removed)))))
  }
  replica.on('update', onReplicaUpdate); replicaAw.on('update', onReplicaAw)
  port.postMessage(frame(MSG_SYNC, e => sync.writeSyncStep1(e, replica)))
  hostPort.postMessage(frame(MSG_SYNC, e => sync.writeSyncStep1(e, hostDoc)))

  const release = () => {
    if (cap) { clearTimeout(cap); cap = null }
    if (!holding) return
    holding = false
    stats.maxHeldMs = Math.max(stats.maxHeldMs, Math.round(performance.now() - heldAt))
    if (buffer.length) stats.flushes++
    while (buffer.length) { const f = buffer.shift()!; applySync(f.n, f.data) }
  }
  const hold = () => {
    if (holding) return
    holding = true; heldAt = performance.now(); stats.holds++
    cap = setTimeout(() => { stats.capFired++; release() }, capMs)
  }
  return {
    hold, release,
    get holding () { return holding },
    get held () { return buffer.length },
    stats,
    unlink: () => { release(); hostDoc.off('update', onHostUpdate); hostAw.off('update', onHostAw); replica.off('update', onReplicaUpdate); replicaAw.off('update', onReplicaAw); port.close(); hostPort.close() }
  }
}
