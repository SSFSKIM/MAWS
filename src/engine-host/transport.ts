// Process transport (charter §4.2; C3 execution document, Interfaces "Transport"): spawns the plan `buildLaunch`
// produced and speaks NDJSON with it at the frame level. Stdout is decoded with a UTF-8 StringDecoder and cut on `\n`
// (blank lines dropped, a leading BOM stripped, a trailing `\r` tolerated); an unterminated line over the budget is a
// transport error that kills the process, and a line that fails JSON.parse is reported as an item, never thrown, so
// the session goes on. Stdin has one serialised writer: `write()` resolves when the bytes reached the OS pipe, which
// is the §4.6 delivery truth. `keep_alive` is never sent (the engine drops it); U+2028/2029 are not escaped (the
// engine's reader splits on `\n` only). Nothing here journals: the session journals what it reads and writes.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { StdinFrame } from '@shared/wire/frames';
import type { LaunchPlan } from './launch';

export const MAX_LINE_CHARS = 64 * 1024 * 1024; // the engine's own budget is 256 Mi; ours protects the host's memory
const PARSE_ERROR_PREVIEW_CHARS = 4_096;
const CLOSE_AFTER_EXIT_GRACE_MS = 2_000;

export interface TransportProblem {
  kind: 'parse_error' | 'line_budget' | 'spawn_error' | 'replay_mismatch' | 'replay_unrecorded_read'; // replay_*: the replay transport only (M2; debt wave 3)
  message: string;
  length: number; // characters of the offending line (0 for a spawn error or a replay item)
  typeGuess: string | null; // the `"type"` a malformed line seemed to carry
  replay?: { expected: string; got: string }; // the held out row and the unrecorded write, for the `meta replay_mismatch` row
  read?: { subtype: string; requestId: string }; // the unrecorded read the replay answered empty, for the `meta replay_unrecorded_read` row
}

// One stdout line: a parsed frame, or a problem with the raw preview. `raw` is the whole line for a frame and at most
// PARSE_ERROR_PREVIEW_CHARS for a problem, so a garbage line never pins its bytes in the journal.
export type TransportItem =
  | { frame: unknown; raw: string; error: null }
  | { frame: null; raw: string; error: TransportProblem };

export interface EngineTransport {
  readonly pid: number | null;
  frames: AsyncIterable<TransportItem>; // parsed stdout lines, in order
  stderr: AsyncIterable<string>; // one line per item
  write(frame: StdinFrame): Promise<void>; // resolves when the bytes reached the OS pipe; rejects on EPIPE/closed
  endInput(): void; // stdin.end()
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export class TransportClosed extends Error {
  constructor(detail: string) {
    super(`engine transport closed: ${detail}`);
    this.name = 'TransportClosed';
  }
}

export class LineBudgetExceeded extends Error {
  // `lines`: the complete lines the same chunk closed before the remainder passed the budget; they are valid and
  // must be delivered before the error, in order.
  constructor(readonly length: number, readonly maxLineChars: number, readonly lines: string[]) {
    super(`line budget exceeded: an unterminated stdout line reached ${length} characters (budget ${maxLineChars})`);
    this.name = 'LineBudgetExceeded';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Framing

export class LineSplitter {
  private readonly decoder = new StringDecoder('utf8');
  private parts: string[] = [];
  private pendingChars = 0;

  constructor(private readonly maxLineChars: number) {}

  // Characters held back waiting for a newline.
  get pending(): number {
    return this.pendingChars;
  }

  // Returns the complete lines the chunk closed, cleaned; throws LineBudgetExceeded once the unterminated remainder
  // passes the budget, carrying the lines this chunk completed first (the remainder is dropped so a caller that
  // continues does not throw again on the same bytes).
  push(chunk: Buffer | string): string[] {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const lines: string[] = [];
    let start = 0;
    for (;;) {
      const nl = text.indexOf('\n', start);
      if (nl < 0) break;
      let line = text.slice(start, nl);
      if (this.parts.length > 0) {
        this.parts.push(line);
        line = this.parts.join('');
        this.parts = [];
        this.pendingChars = 0;
      }
      const cleaned = cleanLine(line);
      if (cleaned !== null) lines.push(cleaned);
      start = nl + 1;
    }
    const rest = text.slice(start);
    if (rest.length > 0) {
      this.pendingChars += rest.length;
      if (this.pendingChars > this.maxLineChars) {
        const length = this.pendingChars;
        this.parts = [];
        this.pendingChars = 0;
        throw new LineBudgetExceeded(length, this.maxLineChars, lines);
      }
      this.parts.push(rest);
    }
    return lines;
  }

  // The unterminated remainder at end of stream, cleaned, or null when there is none.
  flush(): string | null {
    const tail = this.decoder.end();
    if (tail.length > 0) this.parts.push(tail);
    const line = this.parts.join('');
    this.parts = [];
    this.pendingChars = 0;
    return cleanLine(line);
  }
}

function cleanLine(line: string): string | null {
  let out = line;
  if (out.charCodeAt(0) === 0xfeff) out = out.slice(1);
  if (out.endsWith('\r')) out = out.slice(0, -1);
  return out.trim().length === 0 ? null : out;
}

function typeGuess(line: string): string | null {
  const match = /"type"\s*:\s*"([^"]*)"/.exec(line);
  return match ? match[1]! : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// A single-consumer async queue

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiters: ((result: IteratorResult<T>) => void)[] = [];
  private done = false;

  push(item: T): void {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    if (this.done) return;
    this.done = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift() as T, done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The process

export function spawnEngine(plan: LaunchPlan, opts: { maxLineChars: number }): EngineTransport {
  const child = spawn(plan.bin, plan.args, { cwd: plan.cwd, env: plan.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const frames = new AsyncQueue<TransportItem>();
  const stderr = new AsyncQueue<string>();
  const stdoutLines = new LineSplitter(opts.maxLineChars);
  const stderrLines = new LineSplitter(opts.maxLineChars);
  let ended = false; // every stream is done and `exited` settled
  let exitSeen: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  let stdinFailure: Error | null = null;

  let resolveExited!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveExited = resolve;
  });

  const finish = (exit: { code: number | null; signal: NodeJS.Signals | null }) => {
    if (ended) return;
    ended = true;
    const tail = stdoutLines.flush();
    if (tail !== null) frames.push(parseLine(tail));
    const errTail = stderrLines.flush();
    if (errTail !== null) stderr.push(errTail);
    frames.end();
    stderr.end();
    resolveExited(exit);
  };

  const parseLine = (line: string): TransportItem => {
    try {
      return { frame: JSON.parse(line) as unknown, raw: line, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { frame: null, raw: line.slice(0, PARSE_ERROR_PREVIEW_CHARS), error: { kind: 'parse_error', message, length: line.length, typeGuess: typeGuess(line) } };
    }
  };

  child.stdout.on('data', (chunk: Buffer) => {
    let lines: string[];
    try {
      lines = stdoutLines.push(chunk);
    } catch (error) {
      const budget = error as LineBudgetExceeded;
      for (const line of budget.lines) frames.push(parseLine(line)); // what the chunk completed before the overflow, in order
      frames.push({ frame: null, raw: '', error: { kind: 'line_budget', message: budget.message, length: budget.length, typeGuess: null } });
      child.stdout.destroy();
      child.kill('SIGKILL');
      return;
    }
    for (const line of lines) frames.push(parseLine(line));
  });
  child.stdout.on('error', () => {
    /* a destroyed pipe after the line-budget kill; the exit follows */
  });

  child.stderr.on('data', (chunk: Buffer) => {
    let lines: string[];
    try {
      lines = stderrLines.push(chunk);
    } catch {
      return; // stderr noise over the budget is dropped, never fatal
    }
    for (const line of lines) stderr.push(line);
  });
  child.stderr.on('error', () => {});

  child.stdin.on('error', (error: Error) => {
    stdinFailure = error; // EPIPE after the engine died; pending writes reject through their callbacks
  });

  child.on('error', (error: Error) => {
    // A spawn failure (ENOENT, EACCES): no exit event may follow.
    stdinFailure = stdinFailure ?? error;
    frames.push({ frame: null, raw: '', error: { kind: 'spawn_error', message: error.message, length: 0, typeGuess: null } });
    finish({ code: null, signal: null });
  });
  child.on('exit', (code, signal) => {
    exitSeen = { code, signal };
    // 'close' waits for every stdio pipe; a grandchild holding one must not keep the session in limbo.
    setTimeout(() => {
      if (!ended) {
        child.stdout.destroy();
        child.stderr.destroy();
        finish(exitSeen!);
      }
    }, CLOSE_AFTER_EXIT_GRACE_MS).unref();
  });
  child.on('close', (code, signal) => finish(exitSeen ?? { code, signal }));

  const stdinOpen = (): boolean => !ended && exitSeen === null && stdinFailure === null && !child.stdin.destroyed && !child.stdin.writableEnded;

  let chain: Promise<void> = Promise.resolve();
  const writeNow = (data: string): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!stdinOpen()) {
        reject(new TransportClosed(stdinFailure ? stdinFailure.message : exitSeen ? 'the process exited' : 'stdin is closed'));
        return;
      }
      let waiting = 1;
      const settle = () => {
        waiting -= 1;
        if (waiting === 0) resolve();
      };
      const fail = (error: Error) => reject(error instanceof TransportClosed ? error : new TransportClosed(error.message));
      const accepted = child.stdin.write(data, (error) => (error ? fail(error) : settle()));
      if (!accepted) {
        waiting += 1;
        const onDrain = () => {
          child.stdin.off('error', onError);
          child.stdin.off('close', onClose);
          settle();
        };
        const onError = (error: Error) => {
          child.stdin.off('drain', onDrain);
          child.stdin.off('close', onClose);
          fail(error);
        };
        const onClose = () => {
          child.stdin.off('drain', onDrain);
          child.stdin.off('error', onError);
          fail(new TransportClosed('stdin closed before drain'));
        };
        child.stdin.once('drain', onDrain);
        child.stdin.once('error', onError);
        child.stdin.once('close', onClose);
      }
    });

  return {
    get pid() {
      return child.pid ?? null;
    },
    frames,
    stderr,
    write(frame) {
      const data = JSON.stringify(frame) + '\n';
      const turn = chain.then(() => writeNow(data));
      chain = turn.catch(() => {}); // one failed write does not poison the chain; the caller sees its own rejection
      return turn;
    },
    endInput() {
      if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
    },
    kill(signal) {
      if (exitSeen === null && !ended) child.kill(signal);
    },
    exited,
  };
}
