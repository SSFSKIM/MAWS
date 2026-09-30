// The control channel (charter §4.2; C3 execution document, Interfaces "Control channel"): request/response
// correlation over the control envelopes with host-minted ids `${launchId}-${n}`, per-class timeouts, cancellation,
// and a late table so a response that arrives after its deadline is reconciled rather than treated as unexpected.
// The client is not the wire's reader: the session's read loop journals every stdout frame and feeds it to
// `observe()`, so the journal row precedes any correlation. Every `out` frame the client authors goes through the
// process's OutboundWriter: journaled when its write resolves (the §4.6 delivery truth), `meta write_failed`
// otherwise, and counted as in flight so the session can hold inbound frames until it settled (M3 review and
// re-review). A timeout never proves a mutation did not apply (SPEC 45.16.4).
import type { RequestId } from '@shared/graph/ids';
import type { ControlRequestFrame, StdinFrame } from '@shared/wire/frames';
import { CONTROLS, REQUEST_TIMEOUT_MS, isOutboundSubtype, requestClassOf, type OutboundRequest, type OutboundResponse, type OutboundSubtype, type RequestClass, type RequestOptions } from './controls';
import { OutboundWriter, type JournalSink, type WriteOptions } from './outbound-writer';
import type { EngineTransport } from './transport';

export { REQUEST_TIMEOUT_MS };
export type { RequestClass };

export const LATE_TABLE_MS = 60_000;
const ANSWERED_KEPT = 1_000; // answers awaiting their echo; an echo follows its answer within milliseconds

export type { JournalSink };
export { writeFailedMeta } from './outbound-writer';

export class ControlError extends Error {
  constructor(
    readonly subtype: string,
    readonly requestId: RequestId,
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'ControlError';
  }
}
export class ControlTimeout extends ControlError {
  // `since`: what a deadline restarted by `extendDeadline` counts from
  constructor(subtype: string, requestId: RequestId, timeoutMs: number, since?: string) {
    super(subtype, requestId, since === undefined ? `${subtype} unanswered after ${Math.round(timeoutMs / 1000)} s` : `${subtype} unanswered ${Math.round(timeoutMs / 1000)} s after ${since}`, 'timeout');
    this.name = 'ControlTimeout';
  }
}
export class ControlCancelled extends ControlError {
  constructor(subtype: string, requestId: RequestId) {
    super(subtype, requestId, `${subtype} cancelled`, 'cancelled');
    this.name = 'ControlCancelled';
  }
}

type ResponseEnvelope = { subtype: 'success'; request_id: string; response?: unknown } | { subtype: 'error'; request_id: string; error: string; error_code?: string };

interface Pending {
  subtype: string;
  resolve: (envelope: ResponseEnvelope) => void;
  reject: (error: ControlError) => void;
  timer: ReturnType<typeof setTimeout> | null;
  arm: ((timeoutMs: number, since?: string) => void) | null; // (re)starts the deadline, once the request was written
  onAbort: (() => void) | null;
  signal: AbortSignal | undefined;
}

export interface LateResponse {
  requestId: RequestId;
  subtype: string;
  response: ResponseEnvelope;
}

function unref(timer: ReturnType<typeof setTimeout>): ReturnType<typeof setTimeout> {
  (timer as { unref?: () => void }).unref?.();
  return timer;
}

export class ControlClient {
  private counter = 0;
  private readonly pendingTable = new Map<string, Pending>();
  private readonly lateTable = new Map<string, { subtype: string; timer: ReturnType<typeof setTimeout> }>();
  private readonly inboundHandlers: ((req: ControlRequestFrame) => void)[] = [];
  private readonly cancelHandlers: ((requestId: RequestId) => void)[] = [];
  private readonly lateHandlers: ((late: LateResponse) => void)[] = [];
  // Inbound requests we answered, whose answer the engine echoes back on stdout under `--replay-user-messages` ("under
  // it the transport also echoes inbound control_response frames", SPEC A4 glossary; first seen live in M6, 3.3's
  // journal, our answer out then the same envelope in). The echo is consumed here, once, instead of warning as unknown.
  private readonly answered = new Set<string>();
  private closed: string | null = null;
  private readonly warn: (message: string) => void;
  readonly writer: OutboundWriter;

  // `writer`: the process's shared OutboundWriter (the session passes the one its read loop gates on); by default
  // the client makes its own over the transport and sink.
  constructor(transport: EngineTransport, journal: JournalSink, readonly launchId: string, opts: { warn?: (message: string) => void; writer?: OutboundWriter } = {}) {
    this.warn = opts.warn ?? ((message) => console.warn(`[engine-host] ${message}`));
    this.writer = opts.writer ?? new OutboundWriter(transport, journal);
  }

  get pending(): number {
    return this.pendingTable.size;
  }

  // A typed request: the response payload is parsed with the subtype's schema; a parse failure rejects with
  // ControlError `invalid_response` (the wire changed under us) and the raw response stays in the journal.
  async request<S extends OutboundSubtype>(subtype: S, payload: OutboundRequest<S>, opts: RequestOptions = {}): Promise<OutboundResponse<S>> {
    const { envelope, requestId } = await this.exchange(subtype, payload as Record<string, unknown>, opts);
    const parsed = CONTROLS[subtype].response.safeParse(envelope.response ?? {});
    if (!parsed.success) {
      const paths = parsed.error.issues.map((issue) => issue.path.join('.') || '<root>').join(', ');
      this.warn(`${subtype} ${requestId}: response failed its schema at ${paths}`);
      throw new ControlError(subtype, requestId, `${subtype} answered with an unexpected shape (${paths})`, 'invalid_response');
    }
    return parsed.data as OutboundResponse<S>;
  }

  // A subtype without a typed schema (the fixtures' `fork_conversation`); the raw payload is returned as is.
  async requestRaw(subtype: string, payload: Record<string, unknown> = {}, opts: RequestOptions & { klass?: Exclude<RequestClass, 'human'> } = {}): Promise<unknown> {
    const { envelope } = await this.exchange(subtype, payload, opts);
    return envelope.response;
  }

  private async exchange(subtype: string, payload: Record<string, unknown>, opts: RequestOptions & { klass?: Exclude<RequestClass, 'human'> }): Promise<{ envelope: ResponseEnvelope & { subtype: 'success' }; requestId: RequestId }> {
    const requestId = `${this.launchId}-${++this.counter}` as RequestId;
    if (this.closed !== null) throw new ControlError(subtype, requestId, `${subtype} not sent: ${this.closed}`, 'exited');
    if (opts.signal?.aborted) throw new ControlCancelled(subtype, requestId); // never journaled or written: a mutation must not run after the caller heard "cancelled"
    const frame: StdinFrame = { type: 'control_request', request_id: requestId, request: { subtype, ...payload } };
    const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS[opts.klass ?? (isOutboundSubtype(subtype) ? requestClassOf(subtype) : 'mutate')];

    const settled = new Promise<ResponseEnvelope>((resolve, reject) => {
      const entry: Pending = { subtype, resolve, reject, timer: null, arm: null, onAbort: null, signal: opts.signal };
      this.pendingTable.set(requestId, entry);
      if (opts.signal) {
        entry.onAbort = () => this.cancel(requestId);
        opts.signal.addEventListener('abort', entry.onAbort, { once: true });
      }
    });
    settled.catch(() => {}); // the caller's await below observes the rejection; never an unhandled rejection here

    try {
      await this.writer.write(frame);
    } catch (error) {
      const entry = this.take(requestId);
      const message = error instanceof Error ? error.message : String(error);
      const failure = new ControlError(subtype, requestId, `${subtype} not written: ${message}`, 'write_failed');
      entry?.reject(failure);
      throw failure;
    }
    const entry = this.pendingTable.get(requestId);
    if (entry) {
      entry.arm = (ms, since) => {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = unref(
          setTimeout(() => {
            const timedOut = this.take(requestId);
            if (!timedOut) return;
            this.park(requestId, subtype);
            this.writeCancel(requestId);
            timedOut.reject(new ControlTimeout(subtype, requestId, ms, since));
          }, ms),
        );
      };
      entry.arm(timeoutMs);
    }
    opts.onWritten?.(requestId); // after the deadline is armed, so the callback may extend it

    const envelope = await settled;
    if (envelope.subtype === 'error') throw new ControlError(subtype, requestId, envelope.error, envelope.error_code ?? null);
    return { envelope, requestId };
  }

  // Restarts a written, still pending request's deadline: `timeoutMs` from now, its timeout saying what it counted from
  // (the session's initialize while the engine streams SessionStart hook frames). False when there is none to restart.
  extendDeadline(requestId: RequestId, timeoutMs: number, since: string): boolean {
    const entry = this.pendingTable.get(requestId);
    if (!entry?.arm) return false;
    entry.arm(timeoutMs, since);
    return true;
  }

  // Withdraws one of our requests: writes control_cancel_request and rejects the promise with ControlCancelled. The
  // engine "simply completes" an uncancellable subtype, so its answer is treated as late, never as unexpected.
  cancel(requestId: RequestId): void {
    const entry = this.take(requestId);
    if (!entry) return;
    this.park(requestId, entry.subtype);
    this.writeCancel(requestId);
    entry.reject(new ControlCancelled(entry.subtype, requestId));
  }

  // `preface`: meta rows journaled just before the answer's out row, and only when the write succeeded (the broker's
  // answer note), so a failed write leaves nothing behind; `flushed` runs right after that row, before any inbound
  // frame the session held during the write is processed.
  respond(requestId: RequestId, response: unknown, opts: WriteOptions = {}): Promise<void> {
    this.noteAnswered(requestId);
    return this.writer.write({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } }, opts);
  }

  respondError(requestId: RequestId, error: string): Promise<void> {
    this.noteAnswered(requestId);
    return this.writer.write({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error } });
  }

  onInbound(handler: (req: ControlRequestFrame) => void): void {
    this.inboundHandlers.push(handler);
  }

  onInboundCancel(handler: (requestId: RequestId) => void): void {
    this.cancelHandlers.push(handler);
  }

  onLateResponse(handler: (late: LateResponse) => void): void {
    this.lateHandlers.push(handler);
  }

  // Every parsed stdout frame, in order, from the session's read loop (after it journaled the row).
  observe(frame: unknown): void {
    const f = frame as { type?: unknown; request_id?: unknown; request?: unknown; response?: unknown };
    if (f.type === 'control_response') {
      const envelope = f.response as ResponseEnvelope | undefined;
      if (!envelope || typeof envelope.request_id !== 'string') return;
      const entry = this.take(envelope.request_id);
      if (entry) {
        entry.resolve(envelope);
        return;
      }
      const late = this.lateTable.get(envelope.request_id);
      if (late) {
        clearTimeout(late.timer);
        this.lateTable.delete(envelope.request_id);
        for (const handler of this.lateHandlers) handler({ requestId: envelope.request_id as RequestId, subtype: late.subtype, response: envelope });
        return;
      }
      if (this.answered.delete(envelope.request_id)) return; // the echo of our own answer
      this.warn(`control_response for unknown request ${envelope.request_id}`);
    } else if (f.type === 'control_request') {
      for (const handler of this.inboundHandlers) handler(frame as ControlRequestFrame);
    } else if (f.type === 'control_cancel_request' && typeof f.request_id === 'string') {
      for (const handler of this.cancelHandlers) handler(f.request_id as RequestId);
    }
  }

  // The process is gone: every pending request rejects with `exited`, every timer stops, nothing is sent again.
  close(reason: string): void {
    if (this.closed !== null) return;
    this.closed = reason;
    for (const [requestId, entry] of [...this.pendingTable]) {
      this.take(requestId);
      entry.reject(new ControlError(entry.subtype, requestId as RequestId, `${entry.subtype} unanswered: ${reason}`, 'exited'));
    }
    for (const late of this.lateTable.values()) clearTimeout(late.timer);
    this.lateTable.clear();
  }

  private take(requestId: string): Pending | undefined {
    const entry = this.pendingTable.get(requestId);
    if (!entry) return undefined;
    this.pendingTable.delete(requestId);
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener('abort', entry.onAbort);
    return entry;
  }

  private noteAnswered(requestId: string): void {
    this.answered.add(requestId);
    if (this.answered.size > ANSWERED_KEPT) this.answered.delete(this.answered.values().next().value!); // oldest first
  }

  private park(requestId: string, subtype: string): void {
    if (this.closed !== null) return;
    const timer = unref(setTimeout(() => this.lateTable.delete(requestId), LATE_TABLE_MS));
    this.lateTable.set(requestId, { subtype, timer });
  }

  private writeCancel(requestId: RequestId): void {
    if (this.closed !== null) return;
    this.writer.write({ type: 'control_cancel_request', request_id: requestId }).catch((error: Error) => this.warn(`control_cancel_request ${requestId} not written: ${error.message}`));
  }
}
