// P3-HD M2: a scripted stand-in for ./direct-client.ts's pool in the host operation tests: one connection per acquire,
// `startup` holding an acquire, `atWrite` holding a call where the transport's actual stdin write or fetch would be, and
// `wire` recording what was actually written. Its failures carry `SECRET_SERVER_TEXT`, which no outcome may repeat.
import type { DirectConnectionKey, DirectConnectionSpec, DirectFailure, DirectLease, DirectTool } from './direct-client';

export const SECRET_SERVER_TEXT = 'server-said-secret-4b2d';

export type Deferred = { promise: Promise<void>; resolve(): void };
export const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
};
export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export class ScriptedPool {
  acquires: DirectConnectionSpec[] = [];
  wire: { kind: 'tools/list' | 'tools/call'; name?: string }[] = [];
  startup: Deferred | null = null;
  startupFailure: DirectFailure | null = null;
  atWrite: Deferred | null = null;
  afterWrite: Deferred | null = null; // holds the answer of a call already written
  onAnswer: (() => void) | null = null; // runs as a written call's answer settles, before its awaiting caller resumes
  listAttempts = 0; // tools/list asked for, written or not
  reachedWrite = deferred();
  tools: DirectTool[] = [{ name: 'rows', readOnly: true }, { name: 'send', readOnly: false }];
  result: unknown = { content: [{ type: 'text', text: 'rows 107' }] };
  callFailure: DirectFailure | null = null;
  aborts = 0;
  leases = 0;
  released = 0;
  invalidations: ((key: DirectConnectionKey) => boolean)[] = [];
  closed = 0;

  async acquire(spec: DirectConnectionSpec, signal: AbortSignal): Promise<{ ok: true; lease: DirectLease } | DirectFailure> {
    this.acquires.push(spec);
    if (this.startup) await this.startup.promise;
    if (signal.aborted) return { ok: false, failure: 'cancelled', admitted: false, message: SECRET_SERVER_TEXT };
    if (this.startupFailure) return this.startupFailure;
    if (!spec.fence()) return { ok: false, failure: 'unavailable', admitted: false, message: SECRET_SERVER_TEXT }; // initialize's write
    this.leases += 1;
    return { ok: true, lease: this.lease(spec) };
  }

  invalidate(match: (key: DirectConnectionKey) => boolean): Promise<void> {
    this.invalidations.push(match);
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }

  private lease(spec: DirectConnectionSpec): DirectLease {
    return {
      listTools: async () => {
        this.listAttempts += 1;
        if (!spec.fence()) return { ok: false, failure: 'unavailable', admitted: false, message: SECRET_SERVER_TEXT };
        this.wire.push({ kind: 'tools/list' });
        return { ok: true, tools: this.tools };
      },
      callTool: async (call, { admit, signal }) => {
        this.reachedWrite.resolve();
        if (this.atWrite) await this.atWrite.promise;
        // the transport's actual write, guarded by the connection's fence and the operation's admission alone (an abort
        // of the operation since is the admission's to see, as the real transport's write is)
        if (!spec.fence() || !admit()) return { ok: false, failure: 'refused', admitted: false, message: SECRET_SERVER_TEXT };
        this.wire.push({ kind: 'tools/call', name: call.name });
        signal.addEventListener('abort', () => (this.aborts += 1), { once: true });
        if (this.afterWrite) await this.afterWrite.promise;
        if (this.callFailure) return this.callFailure;
        this.onAnswer?.();
        return { ok: true, result: this.result };
      },
      release: () => void (this.released += 1),
    };
  }
}

// A clock the test moves: the table's deadlines and retention fire only at `advance`, in due order, while the store's
// and the cache's real I/O keep their own timers.
export class ManualClock {
  private at = 0;
  private next = 1;
  private readonly timers = new Map<number, { due: number; run: () => void }>();
  now = (): number => this.at;
  setTimeout = (run: () => void, ms: number): number => {
    const id = this.next++;
    this.timers.set(id, { due: this.at + ms, run });
    return id;
  };
  clearTimeout = (handle: unknown): void => void this.timers.delete(handle as number);
  advance(ms: number): void {
    const target = this.at + ms;
    for (;;) {
      const due = [...this.timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.at = due[1].due;
      due[1].run();
    }
    this.at = target;
  }
}
