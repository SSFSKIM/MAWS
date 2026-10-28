// Remote viewers' interest (O10 M8; P5's OX5): a lane B subscription counts its session as watched, so the engine host
// keeps it from its idle release as it does for a local window. Each channel is one viewer, `<device>/<channel>`, whose
// report is the set of lane B sessions it subscribes to now: a subscription adds its session, an unsubscription drops
// it, and an empty set drops the viewer. A channel that closes keeps its report for the resume window, then drops it,
// so a phone that vanished never keeps the machine's engine host awake, while one that reconnects within the window
// finds its sessions still warm. Lane A's sessions are sminos's and are in no union of MAWS's.
import type { EndpointServices } from './services';

/** How long a closed channel's report outlives it: the resume window (RL3). */
export const RESUME_MS = 120_000;

export type InterestContext = {
  /** mawsd's interest seam, once started. */
  interest(): EndpointServices['interest'] | null;
  log(line: string): void;
  /** The suites' seams for the window and its timer. */
  resumeMs?: number;
  setTimer?(run: () => void, ms: number): () => void;
};

export class Interest {
  readonly #ctx: InterestContext;
  /** The sessions each live viewer reports. */
  readonly #reports = new Map<string, readonly string[]>();
  /** Viewers whose channel closed, dropped when their window ends. */
  readonly #closing = new Map<string, () => void>();

  constructor(ctx: InterestContext) {
    this.#ctx = ctx;
  }

  /** The viewer's sessions now (its channel's lane B subscriptions); an empty set drops it. */
  report(viewer: string, sessions: readonly string[]): void {
    this.#closing.get(viewer)?.();
    this.#closing.delete(viewer);
    const next = [...new Set(sessions)].sort();
    const before = this.#reports.get(viewer);
    if (before !== undefined && before.length === next.length && before.every((s, i) => s === next[i])) return;
    if (next.length === 0) {
      if (before !== undefined) this.#drop(viewer);
      return;
    }
    this.#reports.set(viewer, next);
    this.#call(() => this.#ctx.interest()?.report(viewer, next as never));
  }

  /** The viewer's channel closed: its report stands for the resume window, then goes. */
  closed(viewer: string): void {
    if (!this.#reports.has(viewer) || this.#closing.has(viewer)) return;
    const timer = this.#ctx.setTimer ?? defaultTimer;
    this.#closing.set(
      viewer,
      timer(() => {
        this.#closing.delete(viewer);
        this.#drop(viewer);
      }, this.#ctx.resumeMs ?? RESUME_MS),
    );
  }

  /** Every report dropped (the endpoint stops). */
  stop(): void {
    for (const cancel of this.#closing.values()) cancel();
    this.#closing.clear();
    for (const viewer of [...this.#reports.keys()]) this.#drop(viewer);
  }

  #drop(viewer: string): void {
    this.#reports.delete(viewer);
    this.#call(() => this.#ctx.interest()?.drop(viewer));
  }

  #call(run: () => void): void {
    try {
      run();
    } catch (error) {
      this.#ctx.log(`endpoint: interest could not be reported: ${(error as Error).message}`);
    }
  }
}

function defaultTimer(run: () => void, ms: number): () => void {
  const timer = setTimeout(run, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
}
