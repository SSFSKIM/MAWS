// The one path every `out` frame takes (C3 execution document, Normaliser opening paragraph; M3 review and
// re-reviews): the frame is written first and journaled only when the write resolves (the §4.6 delivery truth), or
// replaced by a `meta write_failed` row when it rejects. The writer also tracks writes in flight, which is the gate
// the session's read loop holds inbound frames behind: an engine reply read while its request's write continuation
// has not run yet is journaled after the request row, never before, so the journal keeps causal order. Requests,
// answers and cancellations (ControlClient) and user frames (EngineSession) share one writer per process. A journal
// that fails while live is never mistaken for success: the write rejects and the session ends the process.
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalDirection, JournalRow } from '@shared/wire/journal';
import { TransportClosed, type EngineTransport } from './transport';

// What the writer journals through: the session wraps its journal so every row also reaches the normaliser.
export interface JournalSink {
  row(direction: JournalDirection, frame: unknown): JournalRow;
}

// What the session's journal throws once the process has exited and the journal is closed: the one journal error the
// writer may swallow (a write settling after the exit has nothing left to record). Every other journal failure
// surfaces (M3 re-review 2).
export class JournalClosed extends Error {
  constructor(what: string) {
    super(`journal closed: ${what} not recorded after the exit`);
    this.name = 'JournalClosed';
  }
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

interface InFlight {
  settled: boolean;
  fail: (message: string) => void;
}

export class OutboundWriter {
  private readonly inFlight = new Set<InFlight>();
  private readonly idleHandlers: (() => void)[] = [];
  private readonly failureHandlers: ((error: Error) => void)[] = [];
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly transport: EngineTransport,
    private readonly journal: JournalSink,
  ) {}

  // True while any write has not settled (and been journaled).
  get busy(): boolean {
    return this.inFlight.size > 0;
  }

  // Runs each time the last in-flight write settles, right after its row was journaled.
  onIdle(handler: () => void): void {
    this.idleHandlers.push(handler);
  }

  // Runs when a row this writer owes the journal could not be written while the journal is live (disk full, …): the
  // session ends the process through the ladder, since the journal no longer records what was sent.
  onJournalFailure(handler: (error: Error) => void): void {
    this.failureHandlers.push(handler);
  }

  whenIdle(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  // Settles every unsettled write as `write_failed` (the process is gone, so no out row may follow its exit row); a
  // transport answer that arrives later for one of them is ignored.
  failPending(message: string): void {
    for (const entry of [...this.inFlight]) entry.fail(message);
  }

  // Writes the frame; on success journals `preface` rows (meta rows that describe this frame, e.g. the broker's
  // answer note), then the `out` row, then runs `flushed` (the broker marks its item delivered there), all before any
  // held inbound frame is released; on failure journals `write_failed` and rejects with the transport's error. If the
  // journal itself fails while live, the write rejects with that error after a `transport_error { journal_failed }`.
  write(frame: StdinFrame, opts: WriteOptions = {}): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry: InFlight = {
        settled: false,
        fail: (message) => {
          if (entry.settled) return;
          const failure = this.settle(entry, () => this.journal.row('meta', writeFailedMeta(frame, message)));
          reject(failure ?? new TransportClosed(message));
        },
      };
      this.inFlight.add(entry);
      this.transport.write(frame).then(
        () => {
          if (entry.settled) return;
          const failure = this.settle(entry, () => {
            for (const meta of opts.preface ?? []) this.journal.row('meta', meta);
            this.journal.row('out', frame);
            opts.flushed?.();
          });
          if (failure) reject(failure);
          else resolve();
        },
        (error: unknown) => {
          if (entry.settled) return;
          const message = error instanceof Error ? error.message : String(error);
          const failure = this.settle(entry, () => this.journal.row('meta', writeFailedMeta(frame, message)));
          reject(failure ?? error);
        },
      );
    });
  }

  // Journals the write's rows and releases the gate; returns the journal failure, if any.
  private settle(entry: InFlight, journal: () => void): Error | null {
    entry.settled = true;
    let failure: Error | null = null;
    try {
      journal();
    } catch (error) {
      if (!(error instanceof JournalClosed)) {
        failure = error instanceof Error ? error : new Error(String(error));
        try {
          this.journal.row('meta', { event: 'transport_error', code: 'journal_failed', message: `journal write failed: ${failure.message}` });
        } catch {
          /* the journal cannot take that row either; the rejection and the ladder still report it */
        }
        for (const handler of this.failureHandlers) handler(failure);
      }
    } finally {
      this.inFlight.delete(entry);
      if (this.inFlight.size === 0) {
        for (const handler of this.idleHandlers) handler();
        for (const waiter of this.idleWaiters.splice(0)) waiter();
      }
    }
    return failure;
  }
}
