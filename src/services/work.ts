// A part's work in flight (P5 O3-D M2, docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §A and D27): what
// `SpineRoot.settled()` waits for before a release or a yield stops the parts and closes the index. Each part that
// writes the machine's files after a command has answered, or on its own schedule, reports what it has in flight (the
// session service's setups and recoveries, the sweep's run, attention's writes, lane A's probes, the owner channel's
// transcript reads), and the root counts every command and intercept its parts registered while one runs. `busy()` reads
// it now; `settled()` resolves once nothing is in flight.
export interface Settling {
  busy(): boolean;
  settled(): Promise<void>;
}

export class Work implements Settling {
  #count = 0;
  readonly #waiting: (() => void)[] = [];

  // Counts `promise` until it settles, whichever way; answers it unchanged.
  track<T>(promise: Promise<T>): Promise<T> {
    this.#count += 1;
    const done = () => {
      this.#count -= 1;
      if (this.#count === 0) for (const resolve of this.#waiting.splice(0)) resolve();
    };
    promise.then(done, done);
    return promise;
  }

  busy(): boolean {
    return this.#count > 0;
  }

  settled(): Promise<void> {
    return this.#count === 0 ? Promise.resolve() : new Promise((resolve) => this.#waiting.push(resolve));
  }
}

// Every part idle at once: each part's `settled`, again until one pass finds none busy, since one part's work can start
// another's (a sweep's archive is the session service's).
export function allSettling(parts: readonly Settling[]): Settling {
  return {
    busy: () => parts.some((part) => part.busy()),
    async settled() {
      do await Promise.all(parts.map((part) => part.settled()));
      while (parts.some((part) => part.busy()));
    },
  };
}
