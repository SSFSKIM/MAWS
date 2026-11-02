// Main's document bridge (P5 O7 M5b, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5's "The `document`
// stream", its "On this Mac" half; Interfaces §N): `artifacts.open` of an artifact on an RL2 machine. Remote lane B's
// artifact adapter (../lane-b/remote-artifacts.ts) brings it here with the machine's link, as the router routes every
// command naming that artifact.
//
// - The open is the local one's (./open.ts) over the link: the artifact read first (`artifacts.get`), so an artifact gone
//   or of no document kind opens nothing, then one MessageChannelMain, its window end posted on `maws:doc-port` under a
//   channel number from the same counter, and the other end bridged to one `document` read open on the machine. The
//   stream is opened `edit` first and, refused `grade` or `read-only`, `view`; the window's end is posted only once a
//   stream stands behind it, and the answer says `readOnly` for a `view` one. The editor goes read-only on it; this side
//   forwards from a `view` port only what the endpoint would (step 1 and awareness), so a replica's local edits never
//   reach a channel that would drop them and close.
// - The frames. Each document frame (src/artifacts/provider/frames.ts) crosses length-prefixed (frame-stream.ts): the
//   window's go into the stream, which sends within the endpoint's credit and holds the rest up to DOCUMENT_OUTBOUND_MAX
//   (past it the bridge ends: the host socket's own queue rule); the machine's are taken within the credit given
//   at the open, refunded as they are taken in (one frame at most is assembled here), and posted to the window whole.
// - The reopen is the window's. Any end of the stream (a carrier lost, the machine's `host`, `reset` or `upstream`, a
//   re-check's `removed`, `behind`, `malformed`) closes the window's port, and the renderer's ArtifactHost opens again
//   through its one reopen path (250 ms, 1 s, 3 s, then the machine's link coming up): a fresh port, a fresh stream, and
//   the same provider, whose step 2 carries every update the machine had not acked. A stream reopened behind the same
//   port could not: the provider counts its content frames and the host acks them per connection, and a new endpoint
//   channel starts its count and its handshake from zero.
// - Every open ends: `host_unavailable` at once while the link is down, `timeout` when no stream opened within
//   DOCUMENT_OPEN_MS, a refusal for good (`notFound`: viewable in neither mode; `invalid`: not a document, a malformed
//   open, or a machine that offers no read open) that the ArtifactHost stops on, the machine's other words as a
//   transient refusal it retries. Every bridge ends with its stream, its port, its window and the app (review fixes 1, 3
//   and 4: no port is posted for a stream already ended; the app's stop answers an open still in its preflight; the
//   bound runs from the open's start).
import type { MessageChannelMain, MessagePortMain } from 'electron';
import { LengthPrefixed, lengthPrefixed } from '@artifacts/provider/frame-stream';
import { decodeFrame } from '@artifacts/provider/frames';
import { isDocKind } from '@shared/artifacts/entity';
import { DOC_HIGH_WATER } from '@shared/host/doc-channels';
import type { ClientRef } from '@shared/ipc/client';
import { DOC_PORT_CHANNEL } from '@shared/ipc/doc-port';
import { ipcError, type IpcError } from '@shared/ipc/errors';
import type { CommandOutput } from '@shared/ipc/schema';
import type { ArtifactRefusal } from '@shared/ipc/schema/artifacts';
import { pageOf } from '../ipc/clients';
import { CommandFailure } from '../ipc/router';
import { dispatchOverLink } from '../machines/remote/dispatch';
import type { RemoteLink, RemoteStream } from '../machines/remote/link';
import { nextDocChannel } from './open';
import { notAnswered, notOffered, offline, OPEN_TIMEOUT_MS } from './remote-scheme';

/** What the machine may send of the document's frames ahead of this side taking them. */
export const DOCUMENT_STREAM_CREDIT = 1024 * 1024;
/** The largest frame either way, the endpoint's own bound (the engine host's socket resets a channel queued past it). */
export const DOCUMENT_FRAME_MAX = DOC_HIGH_WATER;
/**
 * Milestone review item 4: the window's frames waiting here for the machine's credit, at most, as the engine host's own
 * socket bounds its queue (src/shared/host/doc-channels.ts' `write`): a frame that comes while more than this waits closes
 * the bridge, and one that comes while less waits is taken whole, whatever its size up to the frame maximum. A machine
 * that keeps its channel but takes nothing can't grow main's memory; the reopen's step 2 carries what never landed.
 */
export const DOCUMENT_OUTBOUND_MAX = DOC_HIGH_WATER;
/** An open not answered by then, from its start (the preflight and both stream attempts in it), is answered `timeout`: a page's bound. */
export const DOCUMENT_OPEN_MS = OPEN_TIMEOUT_MS;

export const cannotView = (machine: string) => `you can’t view this document on ${machine}`;
export const notRead = (machine: string) => `${machine} doesn’t read this document’s stream`;

type BridgePort = Pick<MessagePortMain, 'on' | 'start' | 'close' | 'postMessage'>;
type Mode = 'edit' | 'view';
type Opened = { channel: number; readOnly?: true };

export interface RemoteDocumentsDeps {
  /** `new MessageChannelMain()` in the app. */
  channel(): Pick<MessageChannelMain, 'port1' | 'port2'>;
  openMs?: number;
  /** DOCUMENT_OUTBOUND_MAX by default. */
  outboundMax?: number;
  log(line: string): void;
}

export interface RemoteDocuments {
  /** `artifacts.open`'s answer for an artifact on `link`'s machine; throws a CommandFailure with the refusal. */
  open(link: RemoteLink, artifactId: string, client: ClientRef, doc?: 'suggestions'): Promise<Opened>;
  /** The bridges standing (tests). */
  readonly size: number;
  /** The app's stop: every bridge ended. */
  stop(): void;
}

const refusal = (reason: ArtifactRefusal['reason'], message: string, data: Record<string, unknown> = {}) =>
  new CommandFailure(ipcError('invalid_input', message, { reason, data } satisfies ArtifactRefusal));

/** A frame a `view` stream carries from this side: what lets the replica sync and show presence, never a write. */
function viewCarries(frame: Uint8Array): boolean {
  try {
    const { type } = decodeFrame(frame);
    return type === 'step1' || type === 'awareness';
  } catch {
    return false;
  }
}

/** A stream's end before it opened (or the bridge's own) as the open's refusal. */
function failureOf(reason: string, machine: string): CommandFailure {
  switch (reason) {
    case 'grade':
      return refusal('notFound', cannotView(machine), { refusal: 'grade' });
    case 'malformed':
      return refusal('invalid', notRead(machine), { refusal: 'malformed' });
    case 'not-offered':
      return refusal('invalid', notOffered(machine), { refusal: 'not-offered' });
    case 'timeout':
      return new CommandFailure(ipcError('timeout', notAnswered(machine)));
    case 'gone':
      return new CommandFailure(ipcError('internal', 'the window that asked is gone'));
    case 'stopped':
      return new CommandFailure(ipcError('host_unavailable', `documents on ${machine} closed with the app`));
    case 'busy':
      return new CommandFailure(ipcError('host_unavailable', `${machine} is busy; try again`));
    case 'carrier':
    case 'removed':
    case 'closed':
      return new CommandFailure(ipcError('host_unavailable', offline(machine)));
    default:
      return new CommandFailure(ipcError('host_unavailable', `${machine} couldn’t open this document (${reason})`));
  }
}

/** The preflight's refusal: one the member can't read, or a machine that predates the read, is for good. */
function preflightFailure(error: IpcError, machine: string): CommandFailure {
  const word = (error.issues as { refusal?: unknown } | undefined)?.refusal;
  if (word === 'grade' || word === 'no-target') return refusal('notFound', cannotView(machine), { refusal: word });
  if (word === 'not-offered') return refusal('invalid', notOffered(machine), { refusal: word });
  return new CommandFailure(error);
}

export function createRemoteDocuments(deps: RemoteDocumentsDeps): RemoteDocuments {
  const openMs = deps.openMs ?? DOCUMENT_OPEN_MS;
  const outboundMax = deps.outboundMax ?? DOCUMENT_OUTBOUND_MAX;
  const bridges = new Set<Bridge>();
  // Review fix 3: the app's stop ends every open, those still before a bridge too, and answers every open after it
  let stopped = false;
  const onStop = new Set<() => void>();

  /** `work`'s value, or 'stopped' as soon as the app stops, or (review fix 4) 'timeout' at `deadline`. */
  function within<T>(work: Promise<T>, deadline: number): Promise<T | 'stopped' | 'timeout'> {
    if (stopped) return Promise.resolve('stopped');
    return new Promise<T | 'stopped' | 'timeout'>((resolve, reject) => {
      const stop = () => resolve('stopped');
      const timer = setTimeout(() => resolve('timeout'), Math.max(0, deadline - Date.now()));
      onStop.add(stop);
      work.then(resolve, reject).finally(() => {
        onStop.delete(stop);
        clearTimeout(timer);
      });
    });
  }

  /** One window port and the stream behind it; a `view` refusal's reopen is the same bridge on a second stream. */
  class Bridge {
    mode: Mode = 'edit';
    #stream: RemoteStream | null = null;
    #ended = false;
    /** Why it ended, once it has. */
    endedBy: string | null = null;
    #received = 0; // the machine's next byte offset
    #dropped = 0; // frames a `view` port wrote, not carried
    readonly #frames = new LengthPrefixed(DOCUMENT_FRAME_MAX);
    readonly #offGone: () => void;
    /** Settles the attempt in flight: its stream opened, or the word it ended with. */
    #settle: ((outcome: string) => void) | null = null;

    constructor(
      readonly link: RemoteLink,
      readonly artifactId: string,
      readonly port: BridgePort,
      client: ClientRef,
    ) {
      bridges.add(this);
      this.#offGone = client.onGone(() => this.end('gone'));
      port.on('message', ({ data }) => this.#fromWindow(data));
      port.on('close', () => this.end('closed'));
      port.start();
    }

    /** A stream opened in `mode`: 'opened', or the word it ended with before it did. */
    attempt(mode: Mode, doc: 'suggestions' | undefined, deadline: number): Promise<string> {
      if (this.#ended) return Promise.resolve('gone');
      this.mode = mode;
      this.#received = 0;
      this.#frames.clear();
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => settle('timeout'), Math.max(0, deadline - Date.now()));
        const settle = (outcome: string) => {
          if (this.#settle !== settle) return;
          this.#settle = null;
          clearTimeout(timer);
          if (outcome !== 'opened') this.#stream?.close('closed'); // nothing after an end; closes one still waiting
          resolve(outcome);
        };
        this.#settle = settle;
        const stream = this.link.openStream(
          { kind: 'document', credit: DOCUMENT_STREAM_CREDIT, document: { artifactId: this.artifactId, mode, ...(doc && { doc }) } },
          {
            opened: () => settle('opened'),
            data: (offset, bytes) => {
              if (this.#stream === stream) this.#fromMachine(offset, bytes);
            },
            credit: () => {},
            closed: (reason) => {
              if (this.#stream !== stream) return;
              if (this.#settle !== null) return this.#settle(reason);
              this.end(reason);
            },
          },
        );
        this.#stream = stream;
      });
    }

    /** The bridge's end, once: its stream closed (a no-op for one the machine or the link ended), its port with it. */
    end(reason: string): void {
      if (this.#ended) return;
      this.#ended = true;
      this.endedBy = reason;
      bridges.delete(this);
      this.#offGone();
      this.#settle?.(reason === 'gone' ? 'gone' : 'closed');
      this.#stream?.close(reason === 'malformed' ? 'malformed' : 'closed');
      this.port.close();
      this.#frames.clear();
      const dropped = this.#dropped > 0 ? `; ${this.#dropped} write(s) of a view port not carried` : '';
      if (reason !== 'closed' && reason !== 'gone') deps.log(`documents: ${this.artifactId} on ${this.link.name} ended (${reason})${dropped}`);
    }

    #fromWindow(data: unknown): void {
      if (this.#ended || this.#settle !== null || !(data instanceof Uint8Array)) return;
      if (this.mode === 'view' && !viewCarries(data)) {
        this.#dropped += 1;
        return;
      }
      if (this.#stream === null) return;
      // review item 4: past the bound the machine isn't taking what it is sent; the bridge ends, the provider reopens
      if (this.#stream.queued() > outboundMax) return this.end('behind');
      this.#stream.send(lengthPrefixed(data));
    }

    #fromMachine(offset: number, bytes: Uint8Array): void {
      if (this.#ended) return;
      if (offset !== this.#received) return this.end('malformed');
      this.#received += bytes.byteLength;
      const frames = this.#frames.push(bytes);
      if (frames === null) return this.end('malformed');
      for (const frame of frames) this.port.postMessage(frame);
      this.#stream?.credit(bytes.byteLength); // taken in (at most one frame waits here), and only then: the refund may bring more at once
    }
  }

  return {
    async open(link, artifactId, client, doc) {
      const deadline = Date.now() + openMs; // review fix 4: one bound from here, over the preflight and both attempts
      if (stopped) throw failureOf('stopped', link.name);
      if (link.state() === 'down') throw new CommandFailure(ipcError('host_unavailable', offline(link.name)));
      const found = await within(dispatchOverLink(link, 'artifacts.get', { artifactId }), deadline);
      if (found === 'stopped' || found === 'timeout') throw failureOf(found, link.name);
      if (!found.ok) throw preflightFailure(found.error, link.name);
      const { artifact } = found.value as CommandOutput<'artifacts.get'>;
      if (!artifact) throw refusal('notFound', `no artifact ${artifactId} on ${link.name}`);
      if (!isDocKind(artifact.kind)) throw refusal('invalid', `a ${artifact.kind} artifact has no document to open`);
      if (!pageOf(client) || pageOf(client)!.isDestroyed()) throw failureOf('gone', link.name);
      const { port1, port2 } = deps.channel();
      const bridge = new Bridge(link, artifactId, port1, client);
      let outcome = await bridge.attempt('edit', doc, deadline);
      if (outcome === 'grade' || outcome === 'read-only') outcome = await bridge.attempt('view', doc, deadline);
      // Review fix 1: a stream opened and already ended (a `host` close in the turn it opened) is no open: no port goes
      if (outcome === 'opened' && bridge.endedBy !== null) outcome = bridge.endedBy;
      const page = pageOf(client);
      if (outcome === 'opened' && (!page || page.isDestroyed())) outcome = 'gone';
      if (outcome !== 'opened') {
        bridge.end(outcome);
        port2.close();
        throw failureOf(outcome, link.name);
      }
      const channel = nextDocChannel();
      page!.postMessage(DOC_PORT_CHANNEL, { channel, artifactId }, [port2]);
      return { channel, ...(bridge.mode === 'view' && { readOnly: true as const }) };
    },
    get size() {
      return bridges.size;
    },
    stop() {
      stopped = true;
      for (const stop of [...onStop]) stop();
      for (const bridge of [...bridges]) bridge.end('stopped');
    },
  };
}
