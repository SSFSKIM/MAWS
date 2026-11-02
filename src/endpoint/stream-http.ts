// The `http` read open's plane (P5 O7 M5b, docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M5 "The `http`
// stream"; Interfaces §N): one request of an artifact page to the machine's artifact endpoint (`EndpointServices.
// artifacts.fetch`, the scheme's own handler: its status and headers, the bridge script already in an `html` page), its
// open admitted at `view` on the artifact its URL names (streams.ts, the `artifact` rule). The request is made once the
// open is admitted and before it is answered; the decision is then asked whether it stands in the step the stream is
// published (`decide`). `streamOpened {http: {status, headers}}` carries the answer's status and headers as received, then
// the body as `streamData` from offset 0, then `streamClose closed`; a HEAD, a 304, a 404 and a 416, and an answer with no
// body, close right after `streamOpened`. The body is read from its `ReadableStream` one read ahead, whatever the credit
// (so its end is seen, and the close queued behind the data, when the body spends the credit exactly), and what a read
// brings is queued for the device a piece at a time, each at most what the credit allows (and a chunk), once nothing
// queued waits to be sent: the stream's queue never holds more than the credit, the read ahead (one source chunk: a
// bridged `html` page is one buffer, up to the tool's 16 MiB) waits here, and it is never `behind`.
// The device sends no data and no control on it (`malformed`). A body that fails mid-way closes the stream `unavailable`;
// the device holds the length the headers said. A re-check that refuses it ends it `removed`, the body let go.
import { STREAM_CHUNK_BYTES, type StreamHttpOpen } from 'org-protocol';
import type { EndpointServices } from './services';
import { Stream, type ReadAccess, type ReadOpening, type ReadPlane } from './stream-base';

/** The statuses whose answer is its status and headers alone: closed right after `streamOpened`. */
const HEADERS_ONLY: ReadonlySet<number> = new Set([304, 404, 416]);

/** The plane over the machine's artifact endpoint (`fetch`). */
export function httpPlane(fetch: EndpointServices['artifacts']['fetch']): ReadPlane {
  return async (opening) => {
    const { url, method, range } = opening.input as StreamHttpOpen;
    let answer: Awaited<ReturnType<typeof fetch>>;
    try {
      answer = await fetch({ url, method, ...(range === undefined ? {} : { range }) });
    } catch (error) {
      opening.log(`endpoint: an artifact page could not be fetched: ${(error as Error).message}`);
      return opening.refuse('unavailable');
    }
    const body = answer.body;
    const decided = await opening.decide((access) => {
      if (opening.cancelled()) return false;
      const stream = new HttpStream(opening, access, body);
      opening.install(stream);
      stream.open({ http: { status: answer.status, headers: answer.headers } });
      if (method === 'HEAD' || HEADERS_ONLY.has(answer.status) || body === null) stream.closeAfter('closed');
      else stream.pull();
      return true;
    });
    if (decided.ok && decided.value) return;
    void body?.cancel().catch(() => {});
    if (!decided.ok) opening.refuse(decided.reason);
  };
}

class HttpStream extends Stream {
  #reader: ReadableStreamDefaultReader<Uint8Array> | null;
  /** The body's bytes queued so far: the next piece's offset. */
  #queued = 0;
  /** What the last read brought and is not queued yet. */
  #pending: Uint8Array | null = null;
  #reading = false;
  readonly #log: (line: string) => void;

  constructor(opening: ReadOpening, access: ReadAccess, body: ReadableStream<Uint8Array> | null) {
    super(opening.id, opening.channel, opening.act, opening.binding, opening.credit, opening.window, opening.over);
    this.read = access;
    this.#reader = body?.getReader() ?? null;
    this.#log = opening.log;
  }

  /**
   * The body's next piece queued, while the device's credit allows and nothing queued waits to be sent, and the next read
   * made once the last one's bytes are all queued.
   */
  pull(): void {
    if (this.ended) return;
    const pending = this.#pending;
    if (pending !== null && !this.held && this.backlog === 0 && this.creditLeft > 0) {
      const n = Math.min(pending.byteLength, this.creditLeft, STREAM_CHUNK_BYTES);
      this.#pending = n === pending.byteLength ? null : pending.subarray(n);
      this.push(this.#queued, pending.subarray(0, n));
      this.#queued += n;
    }
    const reader = this.#reader;
    if (reader === null || this.#reading || this.#pending !== null || this.ended) return;
    this.#reading = true;
    reader.read().then(
      (next) => {
        this.#reading = false;
        if (this.ended) return;
        if (next.done) {
          this.#reader = null;
          return this.closeAfter('closed');
        }
        if (next.value.byteLength > 0) this.#pending = next.value;
        this.pull();
      },
      (error: unknown) => {
        this.#reading = false;
        this.#log(`endpoint: an artifact page's body failed after ${this.#queued} bytes: ${(error as Error).message}`);
        this.end('unavailable');
      },
    );
  }

  /**
   * A piece was sent: the next is queued once the window's turn is over (a piece queued from inside the turn would be sent
   * by a nested turn, ahead of the one being sent).
   */
  protected override drained(): void {
    queueMicrotask(() => this.pull());
  }

  protected override credited(): void {
    this.pull();
  }

  protected idle(): boolean {
    return true;
  }

  /** The body let go: what it still holds is never read, and what was read and not queued is dropped. */
  protected closed(): void {
    const reader = this.#reader;
    this.#reader = null;
    this.#pending = null;
    void reader?.cancel().catch(() => {});
  }

  /** A device sends nothing on an `http` stream. */
  input(): void {
    this.end('malformed');
  }

  control(): void {
    this.end('malformed');
  }

  closedByDevice(): void {
    this.end(null);
  }
}
