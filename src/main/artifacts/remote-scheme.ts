// The scheme's remote responder (P5 O7 M5b, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5's "The `http`
// stream" (its "On this Mac" half) and "Which machine an artifact is on"; Interfaces §N): an `html`, PDF, image or media
// artifact of another machine's session renders in the pane's frame, each request of its page fetched from that machine's
// artifact endpoint over the machine's RL2 link.
//
// - Which requests are its own (`respond`), in two stages of main's chain (../artifacts/index.ts):
//   - `placed` (the default), after the presenter's embeds: an artifact `ArtifactMachines` places on an RL2 machine;
//   - `referred`, after this Mac's store answered 404: an artifact whose request's referrer is a scheme URL of an artifact
//     placed on an RL2 machine (a page's embeds: another artifact's assets, fonts, frames) goes to that machine.
//   Otherwise null (the local path's answer stands). b3's review: a local artifact is absent from the table as an unheard
//   remote one is, so this Mac's store answers an unplaced id before any referrer does, and the responder never writes
//   the table (its writer is the adapter, from what a link answers): a referrer can't take a local id to another machine.
//   An embed's own loads (its referrer the embed, which the table doesn't place) fall to this Mac's store; the stock frame
//   policy and CSP keep an artifact page from embedding another artifact's frames in the first place
//   (src/render/policies.ts, src/services/artifacts/scheme/scheme-handler.ts).
// - Each request is one `http` read open (`{url, method, range?}`, no `op`), at most HTTP_STREAMS_PER_LINK open per link at
//   once, the rest queued in arrival order. Its `Response` is answered with the status and headers the endpoint sent, the
//   body the stream's bytes, which this side's credit bounds: the endpoint may send HTTP_STREAM_CREDIT bytes ahead, and each
//   chunk is refunded as the frame pulls it, so nothing here buffers past the credit.
// - A body is checked against its `Content-Length`: a stream that ends short of it, runs past it, skips an offset or closes
//   with any word but `closed` errors the body, which the frame shows as a failed load.
// - A paused media pane holds its stream under spent credit (the architect's ruling on b3's review, 2026-11-02): while a
//   request waits for a slot, a stream whose frame hasn't taken a byte for IDLE_MS (and isn't waiting on the machine for
//   more) gives its slot up, the oldest first. Its body ends normally with what came, and the stream closes; the media
//   element asks again with a Range when it plays on. An idle stream keeps its slot while nothing waits.
// - Every request ends: `503` "<machine> is offline" while the link is down (at the request, or before the answer came),
//   `504` when nothing opened within OPEN_TIMEOUT_MS of the request, a refusal as the HTTP status it means (REFUSAL_STATUS),
//   and the app's stop ends whatever is still in flight. A stream lost with its channel before its answer is opened again
//   on the next, within the same bound (a GET or a HEAD asked twice is the same answer).
import { artifactUrl } from '@shared/artifacts/scheme';
import type { MachineRef } from '@shared/machine/ref';
import type { RemoteLink, RemoteStream } from '../machines/remote/link';
import type { StreamOpened, StreamRequest } from '../machines/remote/streams';
import type { ArtifactMachines } from './machines';

/** The most `http` streams one link holds open at once; the rest wait their turn (the channel holds 32 of every kind). */
export const HTTP_STREAMS_PER_LINK = 8;
/** What the endpoint may send of a body ahead of the frame's reads. */
export const HTTP_STREAM_CREDIT = 1024 * 1024;
/** A request whose answer hasn't come by then is answered 504. */
export const OPEN_TIMEOUT_MS = 30_000;
/**
 * A stream whose frame hasn't read for this long gives its slot to a waiting request. Far inside OPEN_TIMEOUT_MS, so a
 * queue behind eight paused panes is served in seconds; far past the gaps of a load the frame is reading (it takes each
 * chunk as it comes), so only a pane that stopped pulling gives way.
 */
export const IDLE_MS = 2_000;

export const offline = (machine: string) => `${machine} is offline`;
export const notAnswered = (machine: string) => `${machine} didn’t answer in time`;
export const notOffered = (machine: string) => `${machine} doesn’t offer this`;

/** A refusal (or a close before the answer) as an HTTP status and the words the frame shows. */
const REFUSAL_STATUS: ReadonlyMap<string, readonly [number, (machine: string) => string]> = new Map<string, readonly [number, (machine: string) => string]>([
  ['grade', [403, (m) => `you can’t view this artifact on ${m}`]],
  ['malformed', [400, (m) => `${m} doesn’t read this request`]],
  ['busy', [503, (m) => `${m} is busy; try again`]],
  ['unavailable', [502, (m) => `${m} couldn’t serve this`]],
  ['not-offered', [501, notOffered]],
  // the link's end
  ['removed', [503, offline]],
  ['closed', [503, offline]],
  ['carrier', [503, offline]],
]);
/** What the protocol's validator takes (`isHttpOpen`): longer would close the channel, not just the request. */
const URL_MAX = 4096;
const RANGE_MAX = 256;
/** Statuses a `Response` carries no body with. */
const NO_BODY: ReadonlySet<number> = new Set([101, 204, 205, 304]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The artifact a scheme URL names by its host (a page's referrer may be its origin alone), or null. */
export function artifactIdOfUrl(url: string): string | null {
  const host = /^maws-artifact:\/\/([^/?#]+)/i.exec(url)?.[1]?.toLowerCase(); // a standard scheme's host: Chromium lowercases it
  return host !== undefined && UUID.test(host) ? host : null;
}

const plain = (status: number, body: string): Response => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export interface RemoteSchemeDeps {
  machines: Pick<ArtifactMachines, 'machineOf'>;
  remote(machine: MachineRef): RemoteLink | null;
  openTimeoutMs?: number;
  idleMs?: number;
  log(line: string): void;
}

export interface RemoteScheme {
  /** The scheme's responder for another machine's artifacts at a stage of the chain: its answer, or null for a request that isn't one. */
  respond: RemoteResponder;
  /** `request` answered by `machine`'s artifact endpoint over its link (an asset's download). */
  fetch(machine: MachineRef, request: Request): Promise<Response>;
  /** Ends every request in flight (the app's shutdown). */
  stop(): void;
}

/**
 * The remote responder at a stage of main's chain: `placed` (the default) for an artifact the table places on an RL2
 * machine, `referred` (after this Mac's store answered 404) for one whose referrer's artifact the table places there.
 */
export type RemoteResponder = (request: Request, stage?: 'placed' | 'referred') => Promise<Response | null>;

/** A link's open `http` streams and the requests waiting for one. */
type Slots = { open: number; waiting: Array<() => void>; holders: Set<Holder>; sweep: ReturnType<typeof setTimeout> | null };
/** An answered body holding a slot: since when its frame hasn't read (null while it reads or waits for bytes), and its giving way. */
type Holder = { idleSince(): number | null; giveWay(): void };

export function createRemoteScheme(deps: RemoteSchemeDeps): RemoteScheme {
  const openTimeoutMs = deps.openTimeoutMs ?? OPEN_TIMEOUT_MS;
  const idleMs = deps.idleMs ?? IDLE_MS;
  const slots = new WeakMap<RemoteLink, Slots>();
  const inFlight = new Set<() => void>();

  const slotsOf = (link: RemoteLink): Slots => {
    let held = slots.get(link);
    if (held === undefined) slots.set(link, (held = { open: 0, waiting: [], holders: new Set(), sweep: null }));
    return held;
  };
  /** `start` once a slot is free; the cancel of a wait, or null once started. */
  function acquire(link: RemoteLink, start: () => void): (() => void) | null {
    const held = slotsOf(link);
    if (held.open < HTTP_STREAMS_PER_LINK) {
      held.open += 1;
      start();
      return null;
    }
    const turn = () => {
      held.open += 1;
      start();
    };
    held.waiting.push(turn);
    schedule(link, held, 0);
    return () => void held.waiting.splice(held.waiting.indexOf(turn) >>> 0, 1);
  }
  function schedule(link: RemoteLink, held: Slots, ms: number): void {
    if (held.sweep === null) held.sweep = setTimeout(() => sweep(link, held), ms);
  }
  /** While a request waits: the oldest idle body gives way, one per waiting request; looked at again when the next could be idle. */
  function sweep(link: RemoteLink, held: Slots): void {
    held.sweep = null;
    let next = idleMs;
    while (held.waiting.length > 0) {
      const now = Date.now();
      let oldest: { holder: Holder; since: number } | null = null;
      next = idleMs;
      for (const holder of held.holders) {
        const since = holder.idleSince();
        if (since === null) continue;
        if (now - since < idleMs) next = Math.min(next, since + idleMs - now);
        else if (oldest === null || since < oldest.since) oldest = { holder, since };
      }
      if (oldest === null) break;
      oldest.holder.giveWay(); // its slot passed to the first waiting
    }
    if (held.waiting.length > 0) schedule(link, held, next);
  }
  function release(link: RemoteLink): void {
    const held = slotsOf(link);
    held.open -= 1;
    held.waiting.shift()?.();
  }

  function fetchOver(link: RemoteLink, request: Request): Promise<Response> {
    const name = link.name;
    if (link.state() === 'down' || link.ended() !== null) return Promise.resolve(plain(503, offline(name)));
    const method = request.method;
    if (method !== 'GET' && method !== 'HEAD') return Promise.resolve(plain(405, 'method not allowed'));
    const range = request.headers.get('Range') ?? undefined;
    if (request.url.length > URL_MAX || (range !== undefined && (range === '' || range.length > RANGE_MAX))) return Promise.resolve(plain(400, `${name} doesn’t read this request`));
    const http: NonNullable<StreamRequest['http']> = { url: request.url, method, ...(range === undefined ? {} : { range }) };

    return new Promise<Response>((resolve) => {
      let answered = false;
      let finished = false;
      let slotHeld = false;
      let stream: RemoteStream | null = null;
      let cancelWait: (() => void) | null = null;
      let body: Body | null = null;
      let holder: Holder | null = null;

      /** The request's end: what it holds let go, its slot passed on. */
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        offState();
        inFlight.delete(abort);
        cancelWait?.();
        cancelWait = null;
        if (holder !== null) slotsOf(link).holders.delete(holder);
        if (slotHeld) {
          slotHeld = false;
          release(link);
        }
      };
      const answer = (response: Response) => {
        if (answered) return;
        answered = true;
        resolve(response);
      };
      /** Before the answer: the refusal's status; after it: the body's error. Either way the stream closes. */
      const fail = (status: number, words: string) => {
        stream?.close('closed');
        stream = null;
        if (answered) body?.fail(new Error(words));
        else answer(plain(status, words));
        finish();
      };
      const abort = () => fail(503, offline(name));

      const open = () => {
        stream = link.openStream({ kind: 'http', credit: HTTP_STREAM_CREDIT, http }, {
          opened: (opened) => onOpened(opened),
          data: (offset, bytes) => body?.data(offset, bytes),
          credit: () => {},
          closed: (reason) => onClosed(reason),
        });
      };
      const onOpened = (opened: StreamOpened) => {
        clearTimeout(timer);
        offState();
        const at = stream;
        if (opened.http === undefined) return fail(502, `${name} answered no status`);
        const { status, headers } = opened.http;
        const empty = method === 'HEAD' || NO_BODY.has(status);
        const length = empty ? null : lengthOf(headers);
        if (length === undefined) return fail(502, `${name} answered a length this app can’t read`);
        if (!empty) body = new Body(length, (bytes) => at?.credit(bytes), () => {
          at?.close('closed');
          finish();
        });
        let response: Response;
        try {
          response = new Response(body?.stream ?? null, { status, headers });
        } catch {
          body = null;
          return fail(502, `${name} answered what this app can’t read (${status})`);
        }
        answer(response);
        if (body !== null) {
          const held = body;
          holder = {
            idleSince: () => held.idleSince(),
            giveWay: () => {
              deps.log(`artifacts: a stream of ${name} unread for ${idleMs} ms gave its slot to a waiting request`);
              held.cut();
              at?.close('closed');
              stream = null;
              finish();
            },
          };
          slotsOf(link).holders.add(holder);
        }
      };
      const onClosed = (reason: string) => {
        stream = null;
        if (answered) {
          body?.end(reason);
          return finish();
        }
        // lost with its channel before the answer: asked again on the next, while the link lives
        if (reason === 'carrier' && link.state() !== 'down' && link.ended() === null) return open();
        const [status, words] = REFUSAL_STATUS.get(reason) ?? [502, (m: string) => `${m} closed the request (${reason})`];
        fail(status, words(name));
      };

      const timer = setTimeout(() => {
        if (!answered) fail(504, notAnswered(name));
      }, openTimeoutMs);
      const offState = link.onState((state) => {
        if (state === 'down' && !answered) abort();
      });
      inFlight.add(abort);
      cancelWait = acquire(link, () => {
        cancelWait = null;
        slotHeld = true;
        open();
      });
    });
  }

  async function fetch(machine: MachineRef, request: Request): Promise<Response> {
    const link = deps.remote(machine);
    return link === null ? plain(503, offline(machine)) : fetchOver(link, request);
  }

  return {
    async respond(request, stage = 'placed') {
      const artifactId = artifactIdOfUrl(request.url);
      if (artifactId === null) return null;
      const placed = deps.machines.machineOf(artifactId);
      if (stage === 'placed') return placed === null ? null : fetch(placed, request);
      if (placed !== null) return null; // asked of its machine at the first stage
      const from = artifactIdOfUrl(request.referrer);
      const machine = from === null ? null : deps.machines.machineOf(from);
      return machine === null ? null : fetch(machine, request);
    },
    fetch,
    stop() {
      for (const abort of [...inFlight]) abort();
    },
  };
}

/** The `Content-Length` a body is held to: null when none was said, undefined when it isn't a length. */
function lengthOf(headers: Record<string, string>): number | null | undefined {
  const said = Object.entries(headers).find(([header]) => header.toLowerCase() === 'content-length')?.[1];
  if (said === undefined) return null;
  return /^\d{1,15}$/.test(said.trim()) ? Number(said.trim()) : undefined;
}

/**
 * A response's body over one stream: the stream's chunks handed to the frame's reads one at a time, each refunded to the
 * endpoint as it is handed (so the bytes held here never pass the credit), checked against the length said.
 */
class Body {
  readonly stream: ReadableStream<Uint8Array>;
  #controller!: ReadableStreamDefaultController<Uint8Array>;
  readonly #chunks: Uint8Array[] = [];
  #received = 0;
  #wanted = false;
  #done = false;
  /** When the frame last took a chunk (or the answer came). */
  #moved = Date.now();
  readonly length: number | null;
  readonly refund: (bytes: number) => void;
  /** The body ended short of whole: failed, or cancelled by its reader. */
  readonly cancelled: () => void;

  constructor(length: number | null, refund: (bytes: number) => void, cancelled: () => void) {
    this.length = length;
    this.refund = refund;
    this.cancelled = cancelled;
    this.stream = new ReadableStream<Uint8Array>(
      {
        start: (controller) => void (this.#controller = controller),
        pull: () => {
          const next = this.#chunks.shift();
          if (next === undefined) this.#wanted = true;
          else this.#hand(next);
        },
        cancel: () => {
          this.#done = true;
          this.#chunks.length = 0;
          this.cancelled();
        },
      },
      { highWaterMark: 0 },
    );
  }

  data(offset: number, bytes: Uint8Array): void {
    if (this.#done) return;
    if (offset !== this.#received) return this.fail(new Error(`a chunk at ${offset} after ${this.#received} bytes`));
    this.#received += bytes.byteLength;
    if (this.length !== null && this.#received > this.length) return this.fail(new Error(`${this.#received} bytes past a Content-Length of ${this.length}`));
    if (this.#wanted) {
      this.#wanted = false;
      this.#hand(bytes);
    } else this.#chunks.push(bytes);
  }

  /** The stream closed with `reason`: the body is whole, or it failed. */
  end(reason: string): void {
    if (this.#done) return;
    if (reason !== 'closed') return this.fail(new Error(`the stream closed (${reason}) after ${this.#received} bytes`));
    if (this.length !== null && this.#received !== this.length) return this.fail(new Error(`${this.#received} bytes of a Content-Length of ${this.length}`));
    this.#done = true;
    for (const chunk of this.#chunks.splice(0)) this.#controller.enqueue(chunk);
    this.#controller.close();
  }

  /** Since when the frame hasn't read: null while it waits for bytes (the machine is the slow side) or once ended. */
  idleSince(): number | null {
    return this.#done || this.#wanted ? null : this.#moved;
  }

  /** A normal end here with what came: the stream gave its slot up, and the frame asks for the rest by its Range. */
  cut(): void {
    if (this.#done) return;
    this.#done = true;
    for (const chunk of this.#chunks.splice(0)) this.#controller.enqueue(chunk);
    this.#controller.close();
  }

  fail(error: Error): void {
    if (this.#done) return;
    this.#done = true;
    this.#chunks.length = 0;
    this.#controller.error(error);
    this.cancelled();
  }

  #hand(chunk: Uint8Array): void {
    this.#moved = Date.now();
    this.#controller.enqueue(chunk);
    this.refund(chunk.byteLength);
  }
}

/** The asset `ref` of `artifactId` (`assets/<name>`), as the scheme names it. */
export const assetUrl = (artifactId: string, ref: string): string => artifactUrl(artifactId, 'live', ref);
