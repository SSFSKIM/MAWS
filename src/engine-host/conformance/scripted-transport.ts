// Test seams for EngineSession (C3 M3): a scripted transport a test drives frame by frame (what it pushes is what the
// engine said; what the session wrote, killed and closed is recorded), and an in-memory journal with the
// JournalWriter's row contract. Not a test file: the suites import them.
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalDirection, JournalRow } from '@shared/wire/journal';
import type { SessionJournal } from '../session';
import { TransportClosed, type EngineTransport, type TransportItem } from '../transport';

class Queue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiters: ((r: IteratorResult<T>) => void)[] = [];
  private done = false;
  push(item: T): void {
    if (this.done) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }
  end(): void {
    this.done = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((r) => this.waiters.push(r));
      },
    };
  }
}

export interface ScriptedTransport extends EngineTransport {
  readonly writes: StdinFrame[];
  readonly calls: string[]; // 'endInput', 'kill:SIGTERM', 'kill:SIGKILL', in order
  push(frame: unknown): void;
  pushProblem(problem: TransportItem['error']): void;
  pushStderr(line: string): void;
  exit(code: number | null, signal?: NodeJS.Signals | null): void;
  // Answers the latest written control_request of `subtype` with a success payload (or an error).
  answer(subtype: string, response?: unknown, error?: string): void;
  requestsOf(subtype: string): { request_id: string; request: Record<string, unknown> }[];
}

// `onWrite` runs after each write is recorded (an auto-responder); `failWrites` rejects every write as a dead pipe,
// `failWrite` only the frames it names; `holdWrite` returns a promise the write waits on before it resolves.
export function scriptedTransport(
  opts: { onWrite?: (frame: StdinFrame, t: ScriptedTransport) => void; failWrites?: boolean; failWrite?: (frame: StdinFrame) => boolean; holdWrite?: (frame: StdinFrame) => Promise<void> | null } = {},
): ScriptedTransport {
  const frames = new Queue<TransportItem>();
  const stderr = new Queue<string>();
  let exited = false;
  let resolveExited!: (v: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exitedPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => (resolveExited = r));
  const t: ScriptedTransport = {
    pid: 4242,
    frames,
    stderr,
    writes: [],
    calls: [],
    exited: exitedPromise,
    async write(frame) {
      if (exited || opts.failWrites || opts.failWrite?.(frame)) throw new TransportClosed(exited ? 'the process exited' : 'EPIPE');
      const hold = opts.holdWrite?.(frame);
      if (hold) await hold;
      t.writes.push(frame);
      opts.onWrite?.(frame, t);
    },
    endInput() {
      t.calls.push('endInput');
    },
    kill(signal) {
      t.calls.push(`kill:${signal}`);
    },
    push(frame) {
      frames.push({ frame, raw: JSON.stringify(frame), error: null });
    },
    pushProblem(problem) {
      frames.push({ frame: null, raw: '', error: problem! });
    },
    pushStderr(line) {
      stderr.push(line);
    },
    exit(code, signal = null) {
      if (exited) return;
      exited = true;
      frames.end();
      stderr.end();
      resolveExited({ code, signal });
    },
    answer(subtype, response = {}, error) {
      const request = t.requestsOf(subtype).at(-1);
      if (!request) throw new Error(`no ${subtype} request was written`);
      t.push({ type: 'control_response', response: error === undefined ? { subtype: 'success', request_id: request.request_id, response } : { subtype: 'error', request_id: request.request_id, error } });
    },
    requestsOf(subtype) {
      return t.writes.filter((w) => w.type === 'control_request' && w.request.subtype === subtype) as { request_id: string; request: Record<string, unknown> }[];
    },
  };
  return t;
}

export class MemoryJournal implements SessionJournal {
  readonly rows: JournalRow[] = [];
  readonly path = '/memory/journal.jsonl';
  closed = false;
  row(direction: JournalDirection, frame: unknown): JournalRow {
    if (this.closed) throw new Error('journal is closed');
    const row: JournalRow = { seq: this.rows.length + 1, direction, at: new Date().toISOString(), frame };
    this.rows.push(row);
    return row;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}
