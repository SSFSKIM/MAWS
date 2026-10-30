// The discovery wake (P5 O3-D M6 fix rounds 1 and 2, the architect's ruling (a) on discovery): a read whose answer
// depends on the index's discovery, from a client that is not the app (the CLI, another machine's link, the endpoint),
// on a parked engine host, wakes it and waits for its first discovery pass (the scan, its discoveries applied) before
// answering, at most until DISCOVERY_WAKE_BOUND_MS after the read's arrival. Reads meanwhile join that wake, and no
// park of the host is asked until it ends (fix round 3). The host the wake woke is asked to park again
// (DaemonClocks.parkNow: only with no app attached or being admitted and no interest) once the pass is heard, and
// equally when the wake gives up, so a host whose scan failed or ran late is not left up; once it has parked, the next
// read wakes it again.

// The reads whose answers come from discovery.
export const DISCOVERY_READS: ReadonlySet<string> = new Set(['session.list', 'session.get', 'session.search', 'session.projects.list', 'session.digests']);
// How long after its arrival a read answers, the spine's load included, when the wake's pass has not come: then with
// what the index holds (logged), and the wake goes on, so the read after its pass is fresh. It is the tightest caller
// deadline that reaches these reads less DISCOVERY_ANSWER_MARGIN_MS: another profile's link (socket-link.ts), the CLI
// (machine-client.ts) and a remote machine's call through the endpoint (remote/timing.ts) each give up at 10 s, and an
// answer after that is discarded (the panel's sweep#4, amending D54's 15 s). A cold host's start and a stat-only scan
// usually fit (a few seconds on a loaded Mac, and well under one for thousands of known transcripts); a first scan of
// a large unindexed store may not.
export const DISCOVERY_WAKE_BOUND_MS = 8_000;
// What the bound leaves under the caller's deadline: the read's own answer from the index, and its way back (for a
// remote caller, its way here too).
export const DISCOVERY_ANSWER_MARGIN_MS = 2_000;
// A read within this long of a heard pass wakes nothing: a reader's burst (a listing, its projects, a session it opens)
// costs one wake, and what it sees is at most this stale; a host start and scan each time would cost a process spawn per read.
export const DISCOVERY_FRESH_MS = 30_000;
// A wake whose pass is not heard within this long ends (logged): the host did not come up, or its scan failed or is
// slower than this; it is asked to park, as after a pass, and the next read after it parked wakes again. The reads
// meanwhile each answered by DISCOVERY_WAKE_BOUND_MS after its arrival.
export const DISCOVERY_WAKE_GIVE_UP_MS = 60_000;

export interface DiscoverySignal {
  onApplied(listener: () => void): () => void; // SpineRoot.discovery: a pass's discoveries are in the index
}

export interface DiscoveryWakeOptions {
  discovery(): DiscoverySignal | undefined; // the loaded spine's; undefined for a stand-in root, which nothing waits for
  parked(): boolean; // the engine host's on-demand park
  wake(): void; // the engine host woken from its park
  waking(): void; // DaemonClocks.discoveryWaking: no park of the host until parkNow
  parkNow(): void; // DaemonClocks.parkNow
  log(line: string): void;
}

// The front's beforeSpineCommand: `app` is a client whose hello listed machine.spine, which keeps the index current itself;
// `arrivedAt` is when the front took the request (Date.now()), before the spine's load.
export function discoveryWake(options: DiscoveryWakeOptions): (name: string, app: boolean, arrivedAt: number) => Promise<void> {
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
      options.waking();
      options.wake();
    });
  };

  return async (name, app, arrivedAt) => {
    if (app || !DISCOVERY_READS.has(name)) return;
    const discovery = options.discovery();
    if (!discovery) return;
    if (!inFlight) {
      if (!options.parked() || Date.now() - heardAt < DISCOVERY_FRESH_MS) return;
      inFlight = start(name, discovery);
    }
    const wake = inFlight;
    const left = arrivedAt + DISCOVERY_WAKE_BOUND_MS - Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = left <= 0 || (await Promise.race([wake.then(() => false), new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(true), left)))]));
    clearTimeout(timer);
    if (timedOut) log(`[spine] discovery: ${name} answers what the index holds: no pass within ${DISCOVERY_WAKE_BOUND_MS / 1000} s of its arrival`);
  };
}
