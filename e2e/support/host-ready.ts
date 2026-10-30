// P5 O3-B: a launch's wait for the daemon shape's engine host (e2e/support/launch.ts), apart from Playwright so its
// bound is unit-tested (test/support/host-ready.test.ts). It reads `host.status` every 100 ms until the engine host is
// ready through `mawsd`, for 30 s at most whatever the page does: each read is raced against the bound, so one still
// pending there (a navigation's context, a stuck IPC) ends the wait as the bound does and is left to settle unread.
// Never failing, it returns the line the launch prints (`[e2e] daemon host ready:`, which the job logs are grepped for):
// the wait, the time from the launch, and at the bound the state `host.status` last answered. Any other shape, or a read
// that fails or answers null (a page without the bridge), returns null at once.
export const HOST_READY_MS = 30_000;
const POLL_MS = 100;

export interface HostStatusLike {
  transport: string;
  state: string;
  supervisor: unknown;
}

export interface HostReadyIo {
  read(): Promise<HostStatusLike | null>; // `host.status`, or null when it did not answer ok
  now(): number; // for the printed times
  sleep(ms: number): Promise<void>;
}

const BOUND = Symbol('bound');

export async function untilHostReady(io: HostReadyIo, launchedAt: number): Promise<string | null> {
  const started = io.now();
  const bound: Promise<typeof BOUND> = io.sleep(HOST_READY_MS).then(() => BOUND);
  const line = (atBound: string | null) => {
    const now = io.now();
    return `[e2e] daemon host ready: waited ${now - started} ms after the window, ${now - launchedAt} ms after the launch${atBound === null ? '' : ` (the ${HOST_READY_MS / 1000} s bound: ${atBound}; the launch goes on)`}`;
  };
  let last = 'host.status unanswered';
  for (;;) {
    const status = await Promise.race([io.read().catch(() => null), bound]);
    if (status === BOUND) return line(last);
    if (status?.transport !== 'daemon') return null;
    if (status.state === 'ready' && status.supervisor !== null) return line(null);
    last = status.state;
    if ((await Promise.race([io.sleep(POLL_MS), bound])) === BOUND) return line(last);
  }
}

// P5 O3-D M5b (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, D24): the cold-start budget's reading. On the daemon
// shape the spine runs in `mawsd` and loads at the first command that needs it, so once the engine host is ready the
// launch asks `session.list` until it answers (the front answers it once the spine has loaded; an unavailable answer, a
// refusal or a load under way, is asked again 100 ms later), for 30 s at most whatever the page does, and returns the
// line the launch prints (`[e2e] spine ready:`, beside the host's line and `mawsd`'s own `[spine] loaded in N ms`).
export interface SpineReadyIo {
  list(): Promise<{ ok: true } | { ok: false; error: string }>; // `session.list`, its error as `<code>: <message>`
  now(): number;
  sleep(ms: number): Promise<void>;
}

export async function untilSpineReady(io: SpineReadyIo, launchedAt: number): Promise<string> {
  const started = io.now();
  const bound: Promise<typeof BOUND> = io.sleep(HOST_READY_MS).then(() => BOUND);
  const line = (atBound: string | null) => {
    const now = io.now();
    return `[e2e] spine ready: waited ${now - started} ms after the host, ${now - launchedAt} ms after the launch${atBound === null ? '' : ` (the ${HOST_READY_MS / 1000} s bound: ${atBound}; the launch goes on)`}`;
  };
  let last = 'session.list unanswered';
  for (;;) {
    const answer = await Promise.race([io.list().catch((error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) })), bound]);
    if (answer === BOUND) return line(last);
    if (answer.ok) return line(null);
    last = answer.error;
    if ((await Promise.race([io.sleep(POLL_MS), bound])) === BOUND) return line(last);
  }
}
