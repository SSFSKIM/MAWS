// A replica's side of one document port (X24; P3-0's S2 `PortProvider`, `spikes/p3-store/s2/v14/provider/port.ts`). No
// Electron, Node or window import: the renderer hands it a DOM MessagePort, the host's agent replica a Node
// MessagePort, P4 a WebSocket adapter. y-protocols sync and awareness frames plus the host's `ack` and `restored`
// (frames.ts).
//
// Durability. The host counts the content frames (step 2 and update) it receives on a connection and, after their log
// rows commit, acks "the first N are durable, the doc is at revision R". The provider keeps the frame number of every
// local update it sent; an ack drops those ≤ N. Local updates made while not live (no port, or the handshake below)
// are `carried`: they are not sent one by one but go out inside the step 2 that answers the host's step 1, so the ack
// of that frame makes them durable. A disconnect moves every unacked local update into `carried`, which is how an
// update the host never committed is re-sent after a reconnect: the new connection's step 2 is computed from the
// host's state vector, so it holds exactly what the host lacks.
//
// The handshake rule (Decision Log 26): after connect the provider sends only its step 1 and awareness until it has
// answered the host's step 1. A local update sent earlier could reach the host before the step 2 that carries the
// clocks preceding it, and the host refuses a gap.
//
// Restores (this child's Decision Log 16). The host sends `restored` after a restore's update, and on every attach it
// sends the document's latest `restored` directly after its step 2, so a replica that was away learns of a restore it
// missed. `onRestored` fires once per restore this replica did not see: never twice for one `versionId`, and not for
// the restore its first sync is told of (that state is simply the document it opened).
//
// The composition hold (this child's Decision Log 20). While an editor composes text through an IME, a remote update
// that touches the composing node ends the composition early and doubles jamo. `holdRemote(true)` buffers inbound
// step 2 and update frames in arrival order (and a `restored` behind them); a host step 1 is still answered, and
// awareness and acks pass. `holdRemote(false)` applies the buffer in order, each run of consecutive updates merged and
// applied once (a held Korean word buffers 7 to 9 frames: singly 63 to 103 ms, merged 21 to 27 ms; parent Decision
// Log 35); a step 2 or `restored` keeps its place between runs. The hold clears itself after 5 s, and says so in the
// log; a disconnect discards the buffer, since the next step 2 re-delivers everything. P4-B2 (D17): a deck session also
// holds through a drag; the reasons are the session's, and this hold stays one flag.
//
// Awareness throttle (M4, Decision Log 31c; parent 37's advisory). With `awarenessThrottleMs` (a renderer's replica:
// 50 ms), outbound awareness goes out at most once per window: the first change at once, the rest of the window as one
// trailing frame encoding the current state of every client that changed in it, so the last state wins. A disconnect
// drops what is pending (the next connect sends the local state itself). Without the option every change goes at once.
// P3-F: a disconnect forgets the other side's clocks with their states, and a connect sends the local state at a newer
// clock, so presence returns on a reconnect without anyone changing it.
//
// A broken peer is one whose frame does not decode or whose payload fails to apply: the provider logs, disconnects and
// keeps its accounting. An exception from an application listener (`subscribe`, `onRestored`) is the application's:
// every listener still runs, the connection stays, and the first error is rethrown to the caller once state is settled.
import * as awarenessProtocol from '@y/protocols/awareness';
import { ArtifactProvisionalSchema, mergeProvisional, type ArtifactProvisional } from '@shared/artifacts/provisional'; // P4-A2 (X35)
import { applyV1, diffV1, mergeUpdates, onUpdate, stateVector, type Doc } from '../yjs';
import { decodeFrame, encodeFrame, type Frame } from './frames';

// The shape shared by a DOM MessagePort and a Node MessagePort (worker_threads), which is all the provider touches.
export interface PortLike {
  postMessage(message: Uint8Array): void;
  addEventListener(type: 'message' | 'close', listener: (event: { data?: unknown }) => void): void;
  removeEventListener(type: 'message' | 'close', listener: (event: { data?: unknown }) => void): void;
  start?(): void;
  close(): void;
}

export type Phase = 'off' | 'handshake' | 'live';
export interface SaveState {
  phase: Phase;
  synced: boolean; // the host's step 2 has been applied on this connection
  unsaved: number; // local updates not yet known durable
  revision: number; // the host's live revision as last acked
  // P4-A2 (X35 rule 2): the highest row seq this replica has integrated through the host's content frames (a step 2's
  // revision, an update's seq); never an ack's revision, which passes the composition hold while the rows it counts
  // wait in the buffer. A provisional layer whose `commitSeq` is at most this has its write on the page.
  integrated: number;
}
export interface Restored {
  revision: number;
  versionId: number;
}

// The longest a composition hold stands before the provider clears it (Decision Log 20).
export const HOLD_LIMIT_MS = 5_000;

export class PortProvider {
  readonly awareness: awarenessProtocol.Awareness;
  private readonly ownsAwareness: boolean; // made here, so destroyed here (its outdated-state timer)
  private port: PortLike | null = null;
  private phase: Phase = 'off';
  private synced = false;
  private sent = 0; // content frames sent on this connection
  private unacked: number[] = []; // per local update sent live: its frame number
  private carried = 0; // local updates that ride in the next step 2
  private carriedFrame = Infinity; // the step 2 frame that carries them, once sent
  private revision = 0;
  private integrated = 0; // P4-A2
  private everSynced = false; // a step 2 from the host has been applied on some connection before this one's
  private catchUp: 'none' | 'first' | 'later' = 'none'; // whether the next frame may be the attach-time `restored`
  private restoreSeen: number | null = null; // the latest restore's version id this replica knows of
  private held = false;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private buffered: Frame[] = []; // inbound frames waiting out a hold, in arrival order
  private received = 0; // P4-B2 (row 256): the remote content frames received, held or not
  private capped = 0; // P4-B2 (D17): the times the 5 s cap cleared a hold
  private released = 0; // P4-B2 (D17): the buffered frames a hold's clearing (its end or its cap) released to apply
  private readonly awarenessThrottleMs: number;
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null; // the open throttle window
  private awarenessPending = new Set<number>(); // clients whose awareness changed inside it
  private readonly listeners = new Set<(state: SaveState) => void>();
  private readonly restoredListeners = new Set<(restored: Restored) => void>();
  private readonly provisionalListeners = new Set<(frame: ArtifactProvisional) => void>(); // P4-A2 (X35)
  // P4-A2 G2 (G-R1's mid-stream condition): each call still streaming on this connection, as its frames so far make it
  // (a publish's files merged by path), for a listener that attaches after them
  private readonly streaming = new Map<string, ArtifactProvisional>();
  // The host ends a call before its terminal frame on this ordered port. A recent-ID guard also rejects a stray
  // late tick from replay, without keeping every call ID for the lifetime of a long-open document.
  private readonly ended = new Set<string>();
  private readonly log: (line: string) => void;
  private readonly offUpdate: () => void;
  private readonly onMessage = (event: { data?: unknown }) => this.receive(event.data);
  private readonly onClose = () => this.disconnect();

  constructor(
    readonly doc: Doc,
    options: { awareness?: awarenessProtocol.Awareness; log?: (line: string) => void; awarenessThrottleMs?: number } = {},
  ) {
    this.awarenessThrottleMs = options.awarenessThrottleMs ?? 0;
    this.ownsAwareness = !options.awareness;
    this.awareness = options.awareness ?? new awarenessProtocol.Awareness(doc);
    this.log = options.log ?? ((line) => console.warn(`[port-provider] ${line}`));
    this.offUpdate = onUpdate(doc, this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
  }

  get state(): SaveState {
    return { phase: this.phase, synced: this.synced, unsaved: this.carried + this.unacked.length, revision: this.revision, integrated: this.integrated };
  }

  /**
   * P4-B2 (tracker row 256): the remote content frames (step 2, update, restored) this replica has received since it was
   * made, and how many the composition hold buffers now, so an e2e can see a frame arrive and wait out the hold. D17:
   * and how many times the 5 s cap has cleared a hold, counted before the flush it causes, and how many buffered frames
   * the clearings released (a cap or an end over an empty buffer releases none), so the e2e sees frames held and let go.
   */
  counts(): { received: number; held: number; capped: number; released: number } {
    return { received: this.received, held: this.buffered.length, capped: this.capped, released: this.released };
  }

  subscribe(listener: (state: SaveState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onRestored(listener: (restored: Restored) => void): () => void {
    this.restoredListeners.add(listener);
    return () => this.restoredListeners.delete(listener);
  }

  // P4-A2 (X35): the host's provisional frames, each after the frames it arrived with are applied (so a `committed`
  // frame's listener reads `state.integrated` against its `commitSeq`). A provisional frame passes the composition
  // hold: the layer moves while the person composes elsewhere and a refusal withdraws at once; the withdrawal on commit
  // waits for the held row through `integrated`.
  // G2 (G-R1): a new listener is told at once of every call still streaming, as one frame each. The host restates the
  // open calls to a connection in the flush that carries its step 2, and an editor's open resolves on that step 2, so
  // its store attaches after those frames: without them a view opened mid-stream would draw nothing until the next tick
  // (and a publish's files already whole would never come again). A committed or dropped call is not kept: a store
  // draws no committed layer it never streamed (its write is on the page or in the hold), and a dropped one is gone.
  onProvisional(listener: (frame: ArtifactProvisional) => void): () => void {
    this.provisionalListeners.add(listener);
    for (const frame of [...this.streaming.values()]) listener(frame);
    return () => this.provisionalListeners.delete(listener);
  }

  connect(port: PortLike): void {
    this.disconnect();
    this.port = port;
    this.phase = 'handshake';
    this.sent = 0;
    port.addEventListener('message', this.onMessage);
    port.addEventListener('close', this.onClose);
    port.start?.();
    this.send({ type: 'step1', sv: stateVector(this.doc) });
    if (this.awareness.getLocalState() !== null) {
      // P3-F (artifact-protocol finding 5): at a newer clock than any it sent, since a peer that saw it removed with the
      // last connection keeps that clock and takes the state back only at a newer one. The awareness's own first state
      // (clock 0, which no peer takes) is left as it is: the application never set it.
      const meta = this.awareness.meta.get(this.doc.clientID);
      if (meta && meta.clock > 0) this.awareness.meta.set(this.doc.clientID, { clock: meta.clock + 1, lastUpdated: Date.now() });
      this.send({ type: 'awareness', update: awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]) });
    }
    this.emit();
  }

  // The port is gone (closed by either end, or the host died): what was sent and not acked rides in the next step 2.
  disconnect(): void {
    const port = this.port;
    if (!port) return;
    this.port = null;
    port.removeEventListener('message', this.onMessage);
    port.removeEventListener('close', this.onClose);
    try {
      port.close();
    } catch {
      // already closed
    }
    this.carried += this.unacked.length;
    this.unacked = [];
    this.carriedFrame = Infinity;
    this.phase = 'off';
    this.synced = false;
    this.catchUp = 'none';
    this.buffered = [];
    this.streaming.clear(); // G2: the streams ended with the connection; the next step 2 brings the host's restatement
    this.ended.clear();
    this.endAwarenessWindow();
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
    awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
    // P3-F (artifact-protocol finding 5): their clocks too, so the next connection's replay of an unchanged state (at
    // the clock this side already knew) is taken again
    for (const id of [...this.awareness.meta.keys()]) if (id !== this.doc.clientID) this.awareness.meta.delete(id);
    this.emit();
  }

  // Sets or clears the composition hold. Setting it again restarts its 5 s limit.
  holdRemote(on: boolean): void {
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.held = on;
    if (on) {
      this.holdTimer = setTimeout(() => {
        this.log(`the composition hold reached its ${HOLD_LIMIT_MS / 1000} s cap and was cleared, applying ${this.buffered.length} buffered frame(s)`);
        this.capped += 1;
        this.holdRemote(false);
      }, HOLD_LIMIT_MS);
      return;
    }
    const frames = this.buffered;
    this.buffered = [];
    this.released += frames.length;
    if (frames.length > 0) this.process(frames);
  }

  destroy(): void {
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    this.held = false;
    this.disconnect();
    this.offUpdate();
    this.awareness.off('update', this.onAwarenessUpdate);
    if (this.ownsAwareness) this.awareness.destroy();
    this.listeners.clear();
    this.restoredListeners.clear();
    this.provisionalListeners.clear();
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return; // the host's own frames
    if (this.phase === 'live') {
      this.send({ type: 'update', update });
      this.unacked.push(this.sent);
    } else {
      this.carried += 1;
    }
    this.emit();
  };

  private readonly onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this || !this.port) return;
    const changed = [...added, ...updated, ...removed];
    if (this.awarenessThrottleMs <= 0) return this.send({ type: 'awareness', update: awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed) });
    if (this.awarenessTimer !== null) {
      for (const id of changed) this.awarenessPending.add(id);
      return;
    }
    this.send({ type: 'awareness', update: awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed) });
    this.openAwarenessWindow();
  };

  // A throttle window: when it ends, what changed inside it goes as one frame, which opens the next window.
  private openAwarenessWindow(): void {
    this.awarenessTimer = setTimeout(() => {
      this.awarenessTimer = null;
      const pending = [...this.awarenessPending];
      this.awarenessPending.clear();
      if (pending.length === 0 || !this.port) return;
      this.send({ type: 'awareness', update: awarenessProtocol.encodeAwarenessUpdate(this.awareness, pending) });
      this.openAwarenessWindow();
    }, this.awarenessThrottleMs);
  }

  private endAwarenessWindow(): void {
    if (this.awarenessTimer !== null) clearTimeout(this.awarenessTimer);
    this.awarenessTimer = null;
    this.awarenessPending.clear();
  }

  private receive(data: unknown): void {
    let frame: Frame;
    try {
      frame = decodeFrame(data);
    } catch (error) {
      return this.broken(error);
    }
    if (frame.type === 'step2' || frame.type === 'update' || frame.type === 'restored') this.received += 1;
    const remoteContent = frame.type === 'step2' || frame.type === 'update' || (frame.type === 'restored' && this.buffered.length > 0);
    if (this.held && remoteContent) {
      this.buffered.push(frame);
      return;
    }
    this.process([frame]);
  }

  // Applies frames in order, each run of consecutive updates merged into one; a payload that fails ends the connection
  // (the rest are dropped with it). Listeners run once, after the frames.
  private process(frames: Frame[]): void {
    const restores: Restored[] = [];
    const provisionals: ArtifactProvisional[] = []; // P4-A2
    for (let i = 0; i < frames.length; i += 1) {
      if (!this.port) break;
      let applied: Applied;
      try {
        let frame = frames[i];
        if (frame.type === 'update' && frames[i + 1]?.type === 'update') {
          const run = [frame.update];
          let seq = frame.seq ?? 0;
          while (i + 1 < frames.length) {
            const next = frames[i + 1];
            if (next.type !== 'update') break;
            run.push(next.update);
            seq = Math.max(seq, next.seq ?? 0);
            i += 1;
          }
          frame = { type: 'update', update: mergeUpdates(run), seq };
        }
        applied = this.apply(frame);
      } catch (error) {
        this.broken(error);
        break;
      }
      if (applied?.restored) restores.push(applied.restored);
      if (applied?.provisional) provisionals.push(applied.provisional);
    }
    this.notify(restores, provisionals);
  }

  private apply(frame: Frame): Applied {
    const catchUp = this.catchUp;
    this.catchUp = 'none';
    switch (frame.type) {
      case 'step1': {
        const step2 = diffV1(this.doc, frame.sv);
        this.send({ type: 'step2', update: step2 });
        if (this.carried > 0) this.carriedFrame = this.sent;
        this.phase = 'live';
        return null;
      }
      case 'step2':
      case 'update':
        applyV1(this.doc, frame.update, this);
        this.integrated = Math.max(this.integrated, (frame.type === 'step2' ? frame.revision : frame.seq) ?? 0); // P4-A2
        if (frame.type === 'step2') {
          this.synced = true;
          this.catchUp = this.everSynced ? 'later' : 'first';
          this.everSynced = true;
        }
        return null;
      case 'awareness':
        awarenessProtocol.applyAwarenessUpdate(this.awareness, frame.update, this);
        return null;
      case 'ack':
        this.revision = frame.revision;
        while (this.unacked.length > 0 && this.unacked[0] <= frame.frames) this.unacked.shift();
        if (frame.frames >= this.carriedFrame) {
          this.carried = 0;
          this.carriedFrame = Infinity;
        }
        return null;
      case 'restored':
        if (frame.versionId === this.restoreSeen) return null;
        this.restoreSeen = frame.versionId;
        if (catchUp === 'first') return null; // the restore the opened document already reflects
        return { restored: { revision: frame.revision, versionId: frame.versionId } };
      case 'provisional': {
        // P4-A2: the host's JSON, read strictly (a frame the shape does not fit is a broken peer, as a malformed frame is)
        const parsed = ArtifactProvisionalSchema.safeParse(JSON.parse(frame.json));
        if (!parsed.success) throw new Error(`a provisional frame the shape refuses: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
        const id = parsed.data.toolUseId as string;
        if (parsed.data.state !== 'streaming') {
          this.streaming.delete(id); // G2
          this.ended.add(id);
          if (this.ended.size > 64) this.ended.delete(this.ended.values().next().value!);
        } else if (!this.ended.has(id)) this.streaming.set(id, mergeProvisional(this.streaming.get(id), parsed.data));
        return { provisional: parsed.data };
      }
    }
  }

  private broken(error: unknown): void {
    this.log(`dropped the connection: ${error instanceof Error ? error.message : String(error)}`);
    this.disconnect();
  }

  private send(frame: Frame): void {
    this.port?.postMessage(encodeFrame(frame));
    if (frame.type === 'step2' || frame.type === 'update') this.sent += 1;
  }

  private emit(): void {
    this.notify([], []);
  }

  // Runs every listener even when one throws, then rethrows the first error: the provider's state is already settled.
  // P4-A2: the provisional listeners run after the state listeners, so a layer that waits on `integrated` reads the
  // state the frames of this batch reached.
  private notify(restores: Restored[], provisionals: ArtifactProvisional[]): void {
    const errors: unknown[] = [];
    const run = (call: () => void) => {
      try {
        call();
      } catch (error) {
        errors.push(error);
      }
    };
    for (const restored of restores) for (const listener of [...this.restoredListeners]) run(() => listener(restored));
    const state = this.state;
    for (const listener of [...this.listeners]) run(() => listener(state));
    for (const frame of provisionals) for (const listener of [...this.provisionalListeners]) run(() => listener(frame));
    if (errors.length > 0) throw errors[0];
  }
}

// What applying one frame yields for the listeners: a restore to announce, a provisional frame to hand on, or nothing.
type Applied = { restored?: Restored; provisional?: ArtifactProvisional } | null;
