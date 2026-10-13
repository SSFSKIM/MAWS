// S2 → P3-A: document channels over the detached host's socket (framing.ts), both ends.
//
// Multiplexing. Main, the socket's one client, allocates a channel number per open document port and asks
// `documents.open {docId, channel, actor}` on a JSON line; frames for that channel may follow at once (the socket
// keeps order, and the host opens the channel synchronously when it reads the line). Either end ends a channel:
// main by `documents.close {channel}`, the host by the event `documents.closed {channel, reason}`. A frame for a
// channel the reader does not know is dropped (it was in flight across a close). The socket's close ends every channel.
//
// Backpressure. Document frames share the socket with the engine's JSON lines, and a replica that falls behind must
// not grow main's or the host's buffers without bound or stall the session events. Before writing a frame the host
// checks the socket's queued bytes; past `highWater` it resets that channel instead of queuing (a `reset` close), and
// main ends the renderer's port; the editor's provider then reconnects on a new port and re-syncs by step 1 and step 2,
// which needs nothing that was dropped. One recovery path serves reset, host restart and reconnect alike. A single
// frame is always written when the queue is under the mark, however large (a first sync's step 2).
import type { Socket } from 'node:net';
import type { DocumentService, HostPort } from '../host/document-service';
import type { Actor } from '../host/storage';
import { encodeDocFrame } from './framing';

export const DOC_HIGH_WATER = 8 * 1024 * 1024;

interface Channel {
  listener: ((data: unknown) => void) | null;
  closeListeners: (() => void)[];
}

export type CloseReason = 'client' | 'host' | 'reset' | 'socket';

// The host's side: each channel is a HostPort the document service attaches like any other.
export class HostDocChannels {
  private readonly channels = new Map<number, Channel>();
  readonly counts = { framesOut: 0, framesIn: 0, resets: 0, dropped: 0 };

  constructor(
    private readonly socket: Socket,
    private readonly service: DocumentService,
    private readonly event: (name: string, input: unknown) => void, // a JSON `evt` line to the client
    private readonly highWater = DOC_HIGH_WATER,
  ) {}

  open(channel: number, docId: string, actor: Actor): void {
    if (this.channels.has(channel)) throw new Error(`channel ${channel} is open`);
    const entry: Channel = { listener: null, closeListeners: [] };
    this.channels.set(channel, entry);
    const port: HostPort = {
      send: (frame) => this.write(channel, frame),
      close: () => this.end(channel, 'host'),
      onMessage: (listener) => void (entry.listener = listener),
      onClose: (listener) => void entry.closeListeners.push(listener),
    };
    this.service.attach(docId, port, actor);
  }

  deliver(channel: number, frame: Uint8Array): void {
    const entry = this.channels.get(channel);
    if (!entry?.listener) {
      this.counts.dropped += 1;
      return;
    }
    this.counts.framesIn += 1;
    entry.listener(frame);
  }

  end(channel: number, reason: CloseReason): void {
    const entry = this.channels.get(channel);
    if (!entry) return;
    this.channels.delete(channel);
    if (reason === 'reset') this.counts.resets += 1;
    if (reason === 'host' || reason === 'reset') this.event('documents.closed', { channel, reason });
    for (const listener of entry.closeListeners) listener();
  }

  endAll(): void {
    for (const channel of [...this.channels.keys()]) this.end(channel, 'socket');
  }

  private write(channel: number, frame: Uint8Array): void {
    if (!this.channels.has(channel) || this.socket.destroyed) return;
    if (this.socket.writableLength > this.highWater) return this.end(channel, 'reset');
    this.counts.framesOut += 1;
    this.socket.write(encodeDocFrame(channel, frame));
  }
}

// Main's side: the relay between a renderer's port and a socket channel. Main reads no frame; it moves bytes.
export interface RelayPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  start(): void;
  close(): void;
}

export class MainDocRelay {
  private readonly channels = new Map<number, RelayPort>();
  private nextChannel = 1;

  constructor(
    private readonly writeFrame: (channel: number, frame: Uint8Array) => void,
    private readonly request: (name: string, input: unknown) => void,
  ) {}

  // `hostEnd` is main's end of a MessageChannelMain whose other end goes to the renderer.
  open(docId: string, actor: Actor, hostEnd: RelayPort): number {
    const channel = this.nextChannel++;
    this.channels.set(channel, hostEnd);
    this.request('documents.open', { docId, channel, actor });
    hostEnd.on('message', ({ data }) => {
      if (data instanceof Uint8Array) this.writeFrame(channel, data);
    });
    hostEnd.on('close', () => {
      if (this.channels.delete(channel)) this.request('documents.close', { channel });
    });
    hostEnd.start();
    return channel;
  }

  deliver(channel: number, frame: Uint8Array): void {
    this.channels.get(channel)?.postMessage(frame);
  }

  // The host ended the channel (or the socket is gone): end the renderer's port so its provider reconnects.
  closed(channel: number): void {
    const port = this.channels.get(channel);
    if (!port) return;
    this.channels.delete(channel);
    port.close();
  }

  closeAll(): void {
    for (const channel of [...this.channels.keys()]) this.closed(channel);
  }
}
