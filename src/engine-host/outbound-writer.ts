// The one path every `out` frame takes (C3 execution document, Normaliser opening paragraph; M3 review and
// re-review): the frame is written first and journaled only when the write resolves (the §4.6 delivery truth), or
// replaced by a `meta write_failed` row when it rejects. The writer also counts writes in flight, which is the gate
// the session's read loop holds inbound frames behind: an engine reply read while its request's write continuation
// has not run yet is journaled after the request row, never before, so the journal keeps causal order. Requests,
// answers and cancellations (ControlClient) and user frames (EngineSession) share one writer per process.
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalDirection, JournalRow } from '@shared/wire/journal';
import type { EngineTransport } from './transport';

// What the writer journals through: the session wraps its journal so every row also reaches the normaliser.
export interface JournalSink {
  row(direction: JournalDirection, frame: unknown): JournalRow;
}

// The `meta write_failed` row for a frame whose write rejected: what was not sent, and why.
export function writeFailedMeta(frame: StdinFrame, message: string): Record<string, unknown> {
  const f = frame as { type: string; request_id?: string; request?: { subtype?: string }; response?: { request_id?: string } };
  const requestId = f.type === 'control_request' || f.type === 'control_cancel_request' ? (f.request_id ?? null) : f.type === 'control_response' ? (f.response?.request_id ?? null) : null;
  return { event: 'write_failed', frameType: f.type, subtype: f.type === 'control_request' ? (f.request?.subtype ?? null) : null, requestId, message };
}

export interface WriteOptions {
  preface?: Record<string, unknown>[];
  flushed?: () => void;
}

export class OutboundWriter {
  private inFlight = 0;
  private readonly idleHandlers: (() => void)[] = [];

  constructor(
    private readonly transport: EngineTransport,
    private readonly journal: JournalSink,
  ) {}

  // True while any write has not settled (and been journaled).
  get busy(): boolean {
    return this.inFlight > 0;
  }

  // Runs each time the last in-flight write settles, right after its row was journaled.
  onIdle(handler: () => void): void {
    this.idleHandlers.push(handler);
  }

  // Writes the frame; on success journals `preface` rows (meta rows that describe this frame, e.g. the broker's
  // answer note), then the `out` row, then runs `flushed` (the broker marks its item delivered there), all before any
  // held inbound frame is released; on failure journals `write_failed` and rejects with the transport's error.
  async write(frame: StdinFrame, opts: WriteOptions = {}): Promise<void> {
    this.inFlight += 1;
    try {
      await this.transport.write(frame);
    } catch (error) {
      this.settle(() => this.journal.row('meta', writeFailedMeta(frame, error instanceof Error ? error.message : String(error))));
      throw error;
    }
    this.settle(() => {
      for (const meta of opts.preface ?? []) this.journal.row('meta', meta);
      this.journal.row('out', frame);
      opts.flushed?.();
    });
  }

  private settle(journal: () => void): void {
    try {
      journal();
    } catch {
      /* the journal is closed after the exit; the caller hears about the write itself */
    } finally {
      this.inFlight -= 1;
      if (this.inFlight === 0) for (const handler of this.idleHandlers) handler();
    }
  }
}
