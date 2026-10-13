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
import * as awarenessProtocol from '@y/protocols/awareness';
import { applyV1, diffV1, onUpdate, stateVector, type Doc } from '../yjs';
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
}
export interface Restored {
  revision: number;
  versionId: number;
}

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
  private everSynced = false; // a step 2 from the host has been applied on some connection before this one's
  private catchUp: 'none' | 'first' | 'later' = 'none'; // whether the next frame may be the attach-time `restored`
  private restoreSeen: number | null = null; // the latest restore's version id this replica knows of
  private readonly listeners = new Set<(state: SaveState) => void>();
  private readonly restoredListeners = new Set<(restored: Restored) => void>();
  private readonly log: (line: string) => void;
  private readonly offUpdate: () => void;
  private readonly onMessage = (event: { data?: unknown }) => this.receive(event.data);
  private readonly onClose = () => this.disconnect();

  constructor(
    readonly doc: Doc,
    options: { awareness?: awarenessProtocol.Awareness; log?: (line: string) => void } = {},
  ) {
    this.ownsAwareness = !options.awareness;
    this.awareness = options.awareness ?? new awarenessProtocol.Awareness(doc);
    this.log = options.log ?? ((line) => console.warn(`[port-provider] ${line}`));
    this.offUpdate = onUpdate(doc, this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
  }

  get state(): SaveState {
    return { phase: this.phase, synced: this.synced, unsaved: this.carried + this.unacked.length, revision: this.revision };
  }

  subscribe(listener: (state: SaveState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onRestored(listener: (restored: Restored) => void): () => void {
    this.restoredListeners.add(listener);
    return () => this.restoredListeners.delete(listener);
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
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
    awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
    this.emit();
  }

  destroy(): void {
    this.disconnect();
    this.offUpdate();
    this.awareness.off('update', this.onAwarenessUpdate);
    if (this.ownsAwareness) this.awareness.destroy();
    this.listeners.clear();
    this.restoredListeners.clear();
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
    this.send({ type: 'awareness', update: awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed) });
  };

  private receive(data: unknown): void {
    let frame: Frame;
    try {
      frame = decodeFrame(data);
    } catch (error) {
      this.log(`dropped the connection: ${error instanceof Error ? error.message : String(error)}`);
      return this.disconnect();
    }
    const catchUp = this.catchUp;
    this.catchUp = 'none';
    switch (frame.type) {
      case 'step1': {
        this.send({ type: 'step2', update: diffV1(this.doc, frame.sv) });
        if (this.carried > 0) this.carriedFrame = this.sent;
        this.phase = 'live';
        break;
      }
      case 'step2':
      case 'update':
        applyV1(this.doc, frame.update, this);
        if (frame.type === 'step2') {
          this.synced = true;
          this.catchUp = this.everSynced ? 'later' : 'first';
          this.everSynced = true;
        }
        break;
      case 'awareness':
        awarenessProtocol.applyAwarenessUpdate(this.awareness, frame.update, this);
        break;
      case 'ack':
        this.revision = frame.revision;
        while (this.unacked.length > 0 && this.unacked[0] <= frame.frames) this.unacked.shift();
        if (frame.frames >= this.carriedFrame) {
          this.carried = 0;
          this.carriedFrame = Infinity;
        }
        break;
      case 'restored':
        if (frame.versionId === this.restoreSeen) break;
        this.restoreSeen = frame.versionId;
        if (catchUp === 'first') break; // the restore the opened document already reflects
        for (const listener of [...this.restoredListeners]) listener({ revision: frame.revision, versionId: frame.versionId });
        break;
    }
    this.emit();
  }

  private send(frame: Frame): void {
    this.port?.postMessage(encodeFrame(frame));
    if (frame.type === 'step2' || frame.type === 'update') this.sent += 1;
  }

  private emit(): void {
    const state = this.state;
    for (const listener of [...this.listeners]) listener(state);
  }
}
