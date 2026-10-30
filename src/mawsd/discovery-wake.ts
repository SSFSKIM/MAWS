// The discovery wake (P5 O3-D M6 fix rounds 1 and 2, the architect's ruling (a) on discovery): a read whose answer
// depends on the index's discovery, from a client that is not the app (the CLI, another machine's link, the endpoint),
// on a parked engine host, wakes it and waits for its first discovery pass (the scan, its discoveries applied) before
// answering. Reads meanwhile join that wake. The host the wake woke is asked to park again (DaemonClocks.parkNow: only
// with no app attached or being admitted and no interest) once the pass is heard, and equally when the wake gives up,
// so a host whose scan failed or ran late is not left up; once it has parked, the next read wakes it again.

// The reads whose answers come from discovery.
export const DISCOVERY_READS: ReadonlySet<string> = new Set(['session.list', 'session.get', 'session.search', 'session.projects.list', 'session.digests']);
// How long a read waits for the wake's pass before answering with what the index holds (logged): a cold host's start
// (its spawn and welcome, a few seconds on a loaded Mac, inside the supervisor's own start budget) and a stat-only scan
// of a store the index already knows (well under a second for thousands of transcripts), with room; a first scan of a
// large unindexed store may outlast it, and the pass then goes on for the next read.
export const DISCOVERY_WAKE_BOUND_MS = 15_000;
// A read within this long of a heard pass wakes nothing: a reader's burst (a listing, its projects, a session it opens)
// costs one wake, and what it sees is at most this stale; a host start and scan each time would cost a process spawn per read.
export const DISCOVERY_FRESH_MS = 30_000;
// A wake whose pass is not heard within this long ends (logged): the host did not come up, or its scan failed or is
// slower than this; it is asked to park, as after a pass, and the next read after it parked wakes again. The reads
// meanwhile each answered at DISCOVERY_WAKE_BOUND_MS.
export const DISCOVERY_WAKE_GIVE_UP_MS = 60_000;

export interface DiscoverySignal {
  onApplied(listener: () => void): () => void; // SpineRoot.discovery: a pass's discoveries are in the index
}

export interface DiscoveryWakeOptions {
  discovery(): DiscoverySignal | undefined; // the loaded spine's; undefined for a stand-in root, which nothing waits for
  parked(): boolean; // the engine host's on-demand park
  wake(): void; // the engine host woken from its park
  parkNow(): void; // DaemonClocks.parkNow
  log(line: string): void;
}

// The front's beforeSpineCommand: `app` is a client whose hello listed machine.spine, which keeps the index current itself.
export function discoveryWake(options: DiscoveryWakeOptions): (name: string, app: boolean) => Promise<void> {
  const { log } = options;
  let inFlight: Promise<void> | null = null;
  let heardAt = Number.NEGATIVE_INFINITY;

  const start = (name: string, discovery: DiscoverySignal): Promise<void> => {
    log(`[spine] discovery: ${name} wakes the parked engine host for its discovery pass`);
    const started = Date.now();
    return new Promise<void>((resolve) => {
      let off = () => {};
      const done = (heard: boolean) => {
        off();
        clearTimeout(giveUp);
        inFlight = null;
        if (heard) {
          heardAt = Date.now();
          log(`[spine] discovery: the pass is heard ${heardAt - started} ms after the wake`);
        } else log(`[spine] discovery: no pass heard within ${DISCOVERY_WAKE_GIVE_UP_MS / 1000} s of the wake: the engine host is asked to park, and a read after it parked wakes it again`);
        options.parkNow();
        resolve();
      };
      const giveUp = setTimeout(() => done(false), DISCOVERY_WAKE_GIVE_UP_MS);
      giveUp.unref?.();
      off = discovery.onApplied(() => done(true));
      options.wake();
    });
  };

  return async (name, app) => {
    if (app || !DISCOVERY_READS.has(name)) return;
    const discovery = options.discovery();
    if (!discovery) return;
    if (!inFlight) {
      if (!options.parked() || Date.now() - heardAt < DISCOVERY_FRESH_MS) return;
      inFlight = start(name, discovery);
    }
    const wake = inFlight;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([wake.then(() => false), new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(true), DISCOVERY_WAKE_BOUND_MS)))]);
    clearTimeout(timer);
    if (timedOut) log(`[spine] discovery: ${name} answers what the index holds: no pass within ${DISCOVERY_WAKE_BOUND_MS / 1000} s of its wake`);
  };
}
