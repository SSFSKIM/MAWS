// The replay transport (C3 execution document, Interfaces "Transport", M2 decisions): a test seam that stands in for
// a process and plays a fixture journal's `in` rows, holding at each `out` row until the adapter writes the frame the
// fixture recorded there. Recorded request ids and user uuids are mapped onto the ones the adapter minted and the map
// is applied to every following `in` row, so correlation and deduplication see the host's own ids. The host's own
// `initialize` and `get_status` are answered from the handshake prelude when the fixture's next `out` row is not that
// request; any other unrecorded write is a replay mismatch that ends the stream (`exited` `{ null, null }`), so a test
// cannot pass by advancing past a frame the probe never saw. `stderr` rows replay; `meta exit` ends the stream with
// the row's code and signal; `kill` ends a journal that has no exit row. Nothing here journals (the harness does).
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { TransportClosed, type EngineTransport, type TransportItem } from './transport';

export const PRELUDE_SUBTYPES: ReadonlySet<string> = new Set(['initialize', 'get_status']);

export interface ReplayTransport extends EngineTransport {
  readonly holding: JournalRow | null; // the `out` row the replay waits on, or null while `in` rows remain or the stream ended
}

type Frame = Record<string, unknown>;
type ControlRequest = { type: 'control_request'; request_id: string; request: { subtype: string } };
type ControlResponse = { type: 'control_response'; response: { subtype: string; request_id: string; response?: { behavior?: string } } };

interface Waiter {
  frame: StdinFrame;
  resolve: () => void;
  reject: (error: Error) => void;
}

function describeOut(row: JournalRow): string {
  const f = row.frame as Frame;
  return `seq ${row.seq} ${describeFrame(f)}`;
}

function describeFrame(f: Frame): string {
  if (f.type === 'control_request') return `control_request/${(f as ControlRequest).request.subtype}`;
  if (f.type === 'control_response') {
    const r = (f as ControlResponse).response;
    return `control_response/${r.request_id}${r.response?.behavior ? `/${r.response.behavior}` : ''}`;
  }
  return String(f.type);
}

// Same type; control requests by subtype; control responses by request id and, when recorded, behavior.
function matches(recorded: Frame, written: Frame): boolean {
  if (recorded.type !== written.type) return false;
  if (recorded.type === 'control_request') return (recorded as ControlRequest).request.subtype === (written as ControlRequest).request.subtype;
  if (recorded.type === 'control_response') {
    const a = (recorded as ControlResponse).response;
    const b = (written as ControlResponse).response;
    if (a.request_id !== b.request_id) return false;
    return a.response?.behavior === undefined || a.response.behavior === b.response?.behavior;
  }
  if (recorded.type === 'control_cancel_request') return recorded.request_id === written.request_id;
  return true;
}

// The prelude's response to `subtype`: the `in` control_response following its `out` control_request.
function preludeResponse(prelude: JournalRow[], subtype: string): Frame | null {
  const request = prelude.find((r) => r.direction === 'out' && (r.frame as Frame).type === 'control_request' && (r.frame as ControlRequest).request.subtype === subtype);
  if (!request) return null;
  const id = (request.frame as ControlRequest).request_id;
  const response = prelude.find((r) => r.direction === 'in' && (r.frame as Frame).type === 'control_response' && (r.frame as ControlResponse).response.request_id === id);
  return response ? (response.frame as Frame) : null;
}

export function replayEngine(journal: JournalRow[], opts: { prelude: JournalRow[]; onHold?: (row: JournalRow) => void }): ReplayTransport {
  const rows = journal;
  let cursor = 0; // index of the next row to consider
  let ended = false;
  const idMap = new Map<string, string>(); // recorded id → minted id
  const injected: Frame[] = []; // prelude answers, delivered before the cursor's next row
  const waiters: Waiter[] = []; // writes not yet matched, in order
  const stderrQueue: string[] = [];
  let stderrWaiter: ((r: IteratorResult<string>) => void) | null = null;
  let stderrEnded = false;
  let wake: (() => void) | null = null; // the frames iterator waiting for a write or a kill
  let held: JournalRow | null = null; // the `out` row `onHold` was last told about
  let resolveExited!: (v: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => (resolveExited = r));

  const rewrite = (frame: unknown): unknown => {
    if (idMap.size === 0) return frame;
    let text = JSON.stringify(frame);
    for (const [recorded, minted] of idMap) if (recorded !== minted) text = text.split(recorded).join(minted);
    return JSON.parse(text) as unknown;
  };

  const pushStderr = (line: string) => {
    if (stderrWaiter) {
      const w = stderrWaiter;
      stderrWaiter = null;
      w({ value: line, done: false });
    } else stderrQueue.push(line);
  };

  const finish = (exit: { code: number | null; signal: NodeJS.Signals | null }) => {
    if (ended) return;
    ended = true;
    stderrEnded = true;
    if (stderrWaiter) {
      const w = stderrWaiter;
      stderrWaiter = null;
      w({ value: undefined, done: true });
    }
    for (const w of waiters.splice(0)) w.reject(new TransportClosed('the replay ended'));
    resolveExited(exit);
    wake?.();
  };

  // Skips the meta rows the replay never delivers (spawn, provenance, the probe's notes) and stderr rows (pushed on
  // the way), leaving the cursor at an `in` row, an `out` row, an exit row, or the end.
  const settleCursor = (): JournalRow | null => {
    while (cursor < rows.length) {
      const row = rows[cursor]!;
      if (row.direction === 'in' || row.direction === 'out') return row;
      if (row.direction === 'meta' && (row.frame as Frame).event === 'exit') return row;
      if (row.direction === 'stderr') pushStderr(String((row.frame as { text?: unknown }).text ?? ''));
      cursor += 1;
    }
    return null;
  };

  // The next `out` row at or after the cursor, without side effects (used to decide a prelude answer at write time).
  const nextOut = (): JournalRow | null => {
    for (let i = cursor; i < rows.length; i += 1) {
      const row = rows[i]!;
      if (row.direction === 'out') return row;
      if (row.direction === 'meta' && (row.frame as Frame).event === 'exit') return null;
    }
    return null;
  };

  // Records the minted ids of a matched write so the recorded ones in later `in` rows become them.
  const learnIds = (recorded: Frame, written: Frame) => {
    if (recorded.type === 'control_request') idMap.set((recorded as ControlRequest).request_id, (written as ControlRequest).request_id);
    if ((recorded.type === 'user' || recorded.type === 'bash_command') && typeof recorded.uuid === 'string' && typeof written.uuid === 'string') idMap.set(recorded.uuid, written.uuid);
  };

  // At a held `out` row with a write waiting: match and advance, or end the replay as a mismatch.
  const tryMatch = (): TransportItem | null => {
    const row = settleCursor();
    if (!row || row.direction !== 'out' || waiters.length === 0) return null;
    const waiter = waiters.shift()!;
    const recorded = row.frame as Frame;
    const written = waiter.frame as unknown as Frame;
    if (matches(recorded, written)) {
      learnIds(recorded, written);
      cursor += 1;
      waiter.resolve();
      return null;
    }
    const expected = describeOut(row);
    const got = describeFrame(written);
    const message = `replay mismatch: expected ${expected}, got ${got}`;
    waiter.reject(new TransportClosed(message));
    finish({ code: null, signal: null });
    return { frame: null, raw: '', error: { kind: 'replay_mismatch', message, length: 0, typeGuess: null, replay: { expected, got } } };
  };

  const frames: AsyncIterable<TransportItem> = {
    [Symbol.asyncIterator]() {
      let pendingMismatch: TransportItem | null = null;
      return {
        next: async (): Promise<IteratorResult<TransportItem>> => {
          for (;;) {
            if (pendingMismatch) {
              const item = pendingMismatch;
              pendingMismatch = null;
              return { value: item, done: false };
            }
            if (injected.length > 0) return { value: { frame: injected.shift()!, raw: '', error: null }, done: false };
            if (ended) return { value: undefined, done: true };
            const row = settleCursor();
            if (!row) {
              await new Promise<void>((r) => (wake = r)); // a journal without an exit row waits for kill
              wake = null;
              continue;
            }
            if (row.direction === 'meta') {
              const f = row.frame as { code?: unknown; signal?: unknown };
              cursor += 1;
              finish({ code: typeof f.code === 'number' ? f.code : null, signal: typeof f.signal === 'string' ? (f.signal as NodeJS.Signals) : null });
              return { value: undefined, done: true };
            }
            if (row.direction === 'in') {
              cursor += 1;
              const frame = rewrite(row.frame);
              return { value: { frame, raw: JSON.stringify(frame), error: null }, done: false };
            }
            // an `out` row: match a waiting write, or wait for one. `onHold` fires here, once per held row, when every
            // earlier row has been delivered and the consumer has finished with it (it called `next()` again), which
            // is the one moment a scripted driver can issue the row's frame without racing the consumer.
            if (waiters.length === 0) {
              if (held !== row) {
                held = row;
                opts.onHold?.(row);
              }
              if (waiters.length === 0) {
                await new Promise<void>((r) => (wake = r));
                wake = null;
              }
              continue;
            }
            const mismatch = tryMatch();
            if (mismatch) pendingMismatch = mismatch;
          }
        },
      };
    },
  };

  const stderr: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (stderrQueue.length > 0) return Promise.resolve({ value: stderrQueue.shift()!, done: false });
          if (stderrEnded) return Promise.resolve({ value: undefined, done: true });
          return new Promise((r) => (stderrWaiter = r));
        },
      };
    },
  };

  return {
    pid: null,
    frames,
    stderr,
    get holding() {
      if (ended) return null;
      const row = settleCursor();
      return row && row.direction === 'out' ? row : null;
    },
    write(frame) {
      if (ended) return Promise.reject(new TransportClosed('the replay ended'));
      const f = frame as unknown as Frame;
      if (f.type === 'control_request' && PRELUDE_SUBTYPES.has((f as ControlRequest).request.subtype)) {
        const upcoming = nextOut();
        if (!upcoming || !matches(upcoming.frame as Frame, f)) {
          const answer = preludeResponse(opts.prelude, (f as ControlRequest).request.subtype);
          if (!answer) return Promise.reject(new TransportClosed(`the handshake prelude has no ${(f as ControlRequest).request.subtype} response`));
          const response = { ...(answer as ControlResponse).response, request_id: (f as ControlRequest).request_id };
          injected.push({ ...answer, response });
          wake?.();
          return Promise.resolve();
        }
      }
      return new Promise<void>((resolve, reject) => {
        waiters.push({ frame, resolve, reject });
        wake?.();
      });
    },
    endInput() {},
    kill(signal) {
      finish({ code: null, signal });
    },
    exited,
  };
}
