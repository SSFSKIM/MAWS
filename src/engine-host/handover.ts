// The handover's drain (docs/doperpowers/plans/2026-10-31-p5-o16-holder.md, M3 and Interfaces §D; D9, D34, D41): the
// rows the table froze in one synchronous step, each drained at the first moment it holds no MAWS-owned call in flight
// (`inFlightThroughDelivery`, every tool's but `ask`), checked at each retirement, or once a deliberate stop took it
// back. The drain settles once every row has; then every row is detached at once (the writer's in-flight writes, the
// final ack, the `host_detach` row, the connection closed without `release`; a row taken back is not), and the exit
// order's shutdown awaits it. Fix wave 1: no row detaches before the drain settles, so a stop-all or quit that comes
// during a deferral can still take every row back and stop it. Nothing is ever forced: a call that runs on keeps the
// drain open, and `host.handover` answers `deferred` meanwhile.

// What the drain needs of a frozen row (EngineSession's).
export interface DrainingRow {
  inFlightThroughDelivery(): number;
  deliveringTool?(): string | null; // P5 O16 M3c fix wave 2: the first of those calls' tool
  drained(): Promise<void>; // resolves at the first moment nothing is in flight (or the engine has exited)
  detach(reason: 'handover' | 'exit'): Promise<void>;
}

export const HANDOVER_GRACE_MS = 10_000; // how long `host.handover` waits for the drain before answering `deferred`

export class HandoverDrain {
  private draining: number;
  private readonly waiters = new Set<() => void>();

  constructor(
    private readonly rows: readonly DrainingRow[],
    // `detached` (P5 O16 M3c fix wave 2): every row's detach has ended, after the settle
    private readonly opts: { log: (line: string) => void; settled: () => void; detached?: () => void },
  ) {
    this.draining = rows.length;
    for (const row of rows) {
      void row.drained().then(() => {
        this.draining -= 1;
        if (this.draining === 0) this.settle();
      });
    }
    if (this.draining === 0) queueMicrotask(() => this.settle());
  }

  get settled(): boolean {
    return this.draining === 0;
  }

  // The calls the drain still waits for, over every row.
  inFlight(): number {
    return this.rows.reduce((sum, row) => sum + row.inFlightThroughDelivery(), 0);
  }

  // P5 O16 M3c fix wave 2 (D63): the tool of the first call the drain still waits for, null when none
  tool(): string | null {
    for (const row of this.rows) {
      const tool = row.deliveringTool?.() ?? null;
      if (tool !== null) return tool;
    }
    return null;
  }

  // Whether the drain settles within `ms`.
  settledWithin(ms: number): Promise<boolean> {
    if (this.settled) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve(this.settled);
      };
      const timer = setTimeout(done, ms);
      this.waiters.add(done);
    });
  }

  private settle(): void {
    const detaches = this.rows.map((row) => row.detach('handover').catch((error: unknown) => this.opts.log(`a row's detach failed: ${error instanceof Error ? error.message : String(error)}`)));
    void Promise.all(detaches).then(() => this.opts.detached?.());
    for (const waiter of [...this.waiters]) waiter();
    this.opts.settled();
  }
}
