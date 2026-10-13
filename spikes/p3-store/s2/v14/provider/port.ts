// S2 on Yjs v14 → P3-A's `src/artifacts/provider/port.ts` (X24; the v13 variant is s2/src/provider/port.ts, which differs only in its imports): a replica's side of one document port. No Electron, Node or
// window import: the renderer hands it a DOM MessagePort, the host's agent replica a Node MessagePort, P4 a WebSocket
// adapter. y-protocols sync and awareness frames plus the host's `ack` (frames.ts).
//
// Durability. The host counts the content frames (step 2 and update) it receives on a connection and, after their log
// rows commit, acks "the first N are durable, the doc is at revision R". The provider keeps the frame number of every
// local update it sent; an ack drops those ≤ N. Local updates made while not live (no port, or the handshake below)
// are `carried`: they are not sent one by one but go out inside the step 2 that answers the host's step 1, so the ack
// of that frame makes them durable. A disconnect moves every unacked local update into `carried`, which is how an
// update the host never committed is re-sent after a reconnect: the new connection's step 2 is computed from the
// host's state vector, so it holds exactly what the host lacks.
//
// The handshake rule: after connect the provider sends only its step 1 and awareness until it has answered the host's
// step 1. A local update sent earlier could reach the host before the step 2 that carries the clocks preceding it,
// and the host refuses a gap (it would otherwise hold it in memory, outside the log).
import * as Y from '@y/y';
import * as awarenessProtocol from '@y/protocols/awareness';
import { decodeFrame, encodeFrame, type Frame } from '../../src/frames';

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

type Listener = (state: SaveState) => void;

export class PortProvider {
  readonly awareness: awarenessProtocol.Awareness;
  private port: PortLike | null = null;
  private phase: Phase = 'off';
  private synced = false;
  private sent = 0; // content frames sent on this connection
  private unacked: number[] = []; // per local update sent live: its frame number
  private carried = 0; // local updates that ride in the next step 2
  private carriedFrame = Infinity; // the step 2 frame that carries them, once sent
  private revision = 0;
  private readonly listeners = new Set<Listener>();
  private readonly onMessage = (event: { data?: unknown }) => this.receive(event.data);
  private readonly onClose = () => this.disconnect();

  constructor(
    readonly doc: Y.Doc,
    options: { awareness?: awarenessProtocol.Awareness; log?: (line: string) => void } = {},
  ) {
    this.awareness = options.awareness ?? new awarenessProtocol.Awareness(doc);
    this.log = options.log ?? ((line) => console.warn(`[port-provider] ${line}`));
    doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
  }

  private readonly log: (line: string) => void;

  get state(): SaveState {
    return { phase: this.phase, synced: this.synced, unsaved: this.carried + this.unacked.length, revision: this.revision };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(port: PortLike): void {
    this.disconnect();
    this.port = port;
    this.phase = 'handshake';
    this.sent = 0;
    port.addEventListener('message', this.onMessage);
    port.addEventListener('close', this.onClose);
    port.start?.();
    this.send({ type: 'step1', sv: Y.encodeStateVector(this.doc) });
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
    const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
    awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
    this.emit();
  }

  destroy(): void {
    this.disconnect();
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.listeners.clear();
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
    switch (frame.type) {
      case 'step1': {
        this.send({ type: 'step2', update: Y.encodeStateAsUpdate(this.doc, frame.sv) });
        if (this.carried > 0) this.carriedFrame = this.sent;
        this.phase = 'live';
        break;
      }
      case 'step2':
      case 'update':
        Y.applyUpdate(this.doc, frame.update, this);
        if (frame.type === 'step2') this.synced = true;
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
    }
    this.emit();
  }

  private send(frame: Frame): void {
    this.port?.postMessage(encodeFrame(frame));
    if (frame.type === 'step2' || frame.type === 'update') this.sent += 1;
  }

  private emit(): void {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }
}
