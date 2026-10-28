// Main's document relay for a detached engine host (P3-A M5; docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision
// Log 13 and 34b; S2's `spikes/p3-store/s2/src/socket/doc-channels.ts` MainDocRelay, copied). In utility mode a window's
// document port is entangled with the host's directly; in detached mode main keeps the host's end of the window's
// MessageChannelMain and relays it over a channel of the supervisor's socket: `documents.open` when the window's open is
// served, the frames both ways (main reads none, it moves bytes), `documents.close` when the window's end goes.
//
// Main tracks each channel's window. The window's port is ended when the host ends the channel (`documents.closed`:
// host or reset), when the window closes or reloads (`closeOwner`), and when the connection goes (`disconnect`); the
// renderer's ArtifactHost then re-opens through its one reopen path, its provider's step 2 re-sending what the host
// lacks, so nothing it was told is durable is lost and nothing dropped here needs re-sending by main.
import type { HostDoc } from '@shared/ipc/host-protocol';
import type { DocumentsClose, DocumentsOpen } from '@shared/host/socket-protocol';

// Main's end of a window's MessageChannelMain (the shape the relay uses).
export interface RelayPort {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
  start(): void;
  close(): void;
  // P5 O2 M5: told why the relay ends it, just before its close: the host's `documents.closed` (`host`, `reset`), or the
  // connection's end (`upstream`). `mawsd`'s endpoint channels report it (docs/doperpowers/plans/2026-10-27-p5-o2-mawsd.md).
  closedBy?(reason: RelayCloseReason): void;
}

export type RelayCloseReason = 'host' | 'reset' | 'upstream';

// The served connection to the supervisor, as the relay uses it.
export interface RelayLink {
  postMessage(message: DocumentsOpen | DocumentsClose): void;
  postDoc(channel: number, frame: Uint8Array): boolean;
}

interface Relayed {
  port: RelayPort;
  owner: string | null; // the asking client's id (`ClientRef.id`)
}

export class MainDocRelay {
  private link: RelayLink | null = null;
  private readonly channels = new Map<number, Relayed>();

  get size(): number {
    return this.channels.size;
  }

  // A served connection: channels open on it from here.
  connect(link: RelayLink): void {
    this.closeAll('upstream');
    this.link = link;
  }

  // The connection is gone: the host ended every channel with it, so every window's port is ended here.
  disconnect(): void {
    this.link = null;
    this.closeAll('upstream');
  }

  // False (nothing asked, the port untouched) when no connection is served.
  open({ channel, artifactId, actor, doc }: HostDoc, port: RelayPort, owner: string | null): boolean {
    const link = this.link;
    if (!link) return false;
    this.forget(channel)?.port.close(); // a number main reused: the stale port goes with it (P5 O2 M5: no reason; nothing ended it)
    const entry: Relayed = { port, owner };
    this.channels.set(channel, entry);
    link.postMessage({ t: 'documents.open', channel, artifactId, actor, ...(doc && { doc }) });
    port.on('message', ({ data }) => {
      if (this.channels.get(channel) === entry && data instanceof Uint8Array) this.link?.postDoc(channel, data);
    });
    port.on('close', () => {
      if (this.channels.get(channel) !== entry) return;
      this.channels.delete(channel);
      this.link?.postMessage({ t: 'documents.close', channel });
    });
    port.start();
    return true;
  }

  deliver(channel: number, frame: Uint8Array): void {
    this.channels.get(channel)?.port.postMessage(frame);
  }

  // The host ended the channel (`documents.closed`; P5 O2 M5: with its reason, `upstream` when the connection ended).
  closed(channel: number, reason: RelayCloseReason = 'host'): void {
    const entry = this.forget(channel);
    if (!entry) return;
    entry.port.closedBy?.(reason);
    entry.port.close();
  }

  // The client ended (its page closed, reloaded or crashed): its channels end on both sides.
  closeOwner(owner: string): void {
    for (const [channel, entry] of [...this.channels]) {
      if (entry.owner !== owner) continue;
      this.channels.delete(channel);
      entry.port.close();
      this.link?.postMessage({ t: 'documents.close', channel });
    }
  }

  private closeAll(reason: RelayCloseReason): void {
    for (const channel of [...this.channels.keys()]) this.closed(channel, reason);
  }

  private forget(channel: number): Relayed | null {
    const entry = this.channels.get(channel) ?? null;
    this.channels.delete(channel);
    return entry;
  }
}
