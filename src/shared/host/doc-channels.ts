// The detached host's document channels (P3-A M5; docs/doperpowers/plans/2026-10-12-p3-a-store.md; the P3 ledger's X24
// binary-channel row; S2's `spikes/p3-store/s2/src/socket/doc-channels.ts` HostDocChannels, copied). Main, the socket's
// one client, opens a channel per open document port with `documents.open {channel, artifactId, actor}`; frames for it
// may follow at once (the socket keeps order and the channel opens as its line is read). Each channel is an end with a
// MessagePortMain's shape, handed to the engine host's document handler as a utility host hands it a MessagePort
// (`HostRuntime.docPort`), so the document service attaches it like any replica's port.
//
// Either side ends a channel: main by `documents.close` (quietly), the host when the service closes its port
// (`documents.closed {host}`: an eviction, a refused frame, a document it cannot serve). A frame for a channel this side
// does not know is dropped (it was in flight across a close). The socket's close ends every channel, telling nobody.
//
// Backpressure. Frames share the socket with the engine's JSON lines, and a replica that falls behind must not grow the
// host's buffer without bound or stall the session events: before writing a frame the host reads the socket's queued
// bytes and, past the high-water mark, ends that channel with `reset` instead of queuing. Main ends the renderer's port
// and the renderer's one reopen path re-syncs it on a new channel (step 1 and step 2 need nothing that was dropped). A
// single frame is always written while the queue is under the mark, however large (a first sync's step 2).
import type { HostDoc } from '../ipc/host-protocol';
import type { DocPortEnd } from './runtime';
import type { DocumentsClosed, DocumentsOpen } from './socket-protocol';

export const DOC_HIGH_WATER = 8 * 1024 * 1024;

// How a channel ended: main closed it, the host's service closed it, the high-water reset, or the socket went.
export type DocCloseReason = 'client' | 'host' | 'reset' | 'socket';

// The socket port as the channels use it.
export interface DocWire {
  postDoc(channel: number, frame: Uint8Array): boolean;
  queuedBytes(): number;
  postMessage(message: DocumentsClosed): boolean;
}

export interface DocChannelOptions {
  highWater?: number;
  log?: (line: string) => void;
}

interface Channel {
  end: DocPortEnd;
  receive(frame: Uint8Array): void;
  ended(): void;
}

export class HostDocChannels {
  private readonly channels = new Map<number, Channel>();
  readonly counts = { framesIn: 0, framesOut: 0, resets: 0, dropped: 0 };
  private readonly highWater: number;
  private readonly log: (line: string) => void;

  constructor(
    private readonly wire: DocWire,
    private readonly openPort: (message: HostDoc, end: DocPortEnd) => void, // the runtime's docPort
    options: DocChannelOptions = {},
  ) {
    this.highWater = options.highWater ?? DOC_HIGH_WATER;
    this.log = options.log ?? ((line) => console.error(`[documents] ${line}`));
  }

  get size(): number {
    return this.channels.size;
  }

  open({ channel, artifactId, actor }: DocumentsOpen): void {
    if (this.channels.has(channel)) {
      // main reuses a number only for a channel it has forgotten: the stale one goes as main's close would end it
      this.log(`channel ${channel} opened again; the earlier one is ended`);
      this.end(channel, 'client');
    }
    const entry = this.channelEnd(channel);
    this.channels.set(channel, entry);
    this.openPort({ t: 'doc', channel, artifactId, actor }, entry.end);
  }

  deliver(channel: number, frame: Uint8Array): void {
    const entry = this.channels.get(channel);
    if (!entry) {
      this.counts.dropped += 1;
      return;
    }
    this.counts.framesIn += 1;
    entry.receive(frame);
  }

  close(channel: number): void {
    this.end(channel, 'client');
  }

  endAll(): void {
    for (const channel of [...this.channels.keys()]) this.end(channel, 'socket');
  }

  private end(channel: number, reason: DocCloseReason): void {
    const entry = this.channels.get(channel);
    if (!entry) return;
    this.channels.delete(channel);
    if (reason === 'reset') {
      this.counts.resets += 1;
      this.log(`channel ${channel} reset: the socket is ${this.wire.queuedBytes()} bytes behind`);
    }
    if (reason === 'host' || reason === 'reset') this.wire.postMessage({ t: 'documents.closed', channel, reason });
    entry.ended();
  }

  private write(channel: number, frame: Uint8Array): void {
    if (!this.channels.has(channel)) return;
    if (this.wire.queuedBytes() > this.highWater) return this.end(channel, 'reset');
    if (this.wire.postDoc(channel, frame)) this.counts.framesOut += 1;
  }

  // One channel's end: frames that arrive before the service starts it wait, as a MessagePort's do.
  private channelEnd(channel: number): Channel {
    const messageListeners: ((event: { data: unknown }) => void)[] = [];
    const closeListeners: (() => void)[] = [];
    let backlog: Uint8Array[] | null = [];
    let ended = false;
    const deliver = (frame: Uint8Array) => {
      for (const listener of messageListeners) listener({ data: frame });
    };
    const end: DocPortEnd = {
      postMessage: (message) => {
        if (!ended && message instanceof Uint8Array) this.write(channel, message);
      },
      on: (event: 'message' | 'close', listener: ((event: { data: unknown }) => void) | (() => void)) => {
        if (event === 'message') messageListeners.push(listener as (event: { data: unknown }) => void);
        else closeListeners.push(listener as () => void);
      },
      start: () => {
        const waiting = backlog;
        backlog = null;
        for (const frame of waiting ?? []) if (!ended) deliver(frame);
      },
      close: () => {
        if (!ended && this.channels.get(channel)?.end === end) this.end(channel, 'host');
      },
    };
    return {
      end,
      receive: (frame) => {
        if (ended) return;
        if (backlog) backlog.push(frame);
        else deliver(frame);
      },
      ended: () => {
        ended = true;
        backlog = null;
        for (const listener of closeListeners) {
          try {
            listener();
          } catch (error) {
            this.log(`a close listener of channel ${channel} failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      },
    };
  }
}
