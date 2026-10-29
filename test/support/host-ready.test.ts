// A launch's wait for the daemon shape's engine host (P5 O3-B; e2e/support/host-ready.ts): it ends at the 30 s bound
// whatever the page does, a `host.status` read still pending included, returns at once on any other shape or a read
// that fails, and gives the line the launch prints. Runs on vitest's clock, the window answering 500 ms after the launch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { untilHostReady, type HostStatusLike } from '../../e2e/support/host-ready';

const LAUNCHED_AT = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(LAUNCHED_AT + 500);
});
afterEach(() => {
  vi.useRealTimers();
});

const daemon = (state: string, supervisor: unknown = state === 'ready' ? { pid: 4242 } : null): HostStatusLike => ({ transport: 'daemon', state, supervisor });

// Starts the wait over `read`; `line()` stays undefined until it returns.
function wait(read: () => Promise<HostStatusLike | null>) {
  const reads = vi.fn(read);
  let line: string | null | undefined;
  void untilHostReady({ read: reads, now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }, LAUNCHED_AT).then((result) => (line = result));
  return { reads, line: () => line };
}

describe('untilHostReady', () => {
  it('ends at the bound when a read never settles, the launch going on', async () => {
    const run = wait(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run.line()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.line()).toBe('[e2e] daemon host ready: waited 30000 ms after the window, 30500 ms after the launch (the 30 s bound: host.status unanswered; the launch goes on)');
    expect(run.reads).toHaveBeenCalledTimes(1);
  });

  it('ends at the bound with the state last answered when the host never comes up', async () => {
    const run = wait(async () => daemon('starting'));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(run.line()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.line()).toBe('[e2e] daemon host ready: waited 30000 ms after the window, 30500 ms after the launch (the 30 s bound: starting; the launch goes on)');
  });

  it('returns once the engine host is ready with its supervisor, polling every 100 ms until then', async () => {
    const statuses = [daemon('starting'), daemon('ready', null), daemon('ready')];
    const run = wait(async () => statuses.shift()!);
    await vi.advanceTimersByTimeAsync(199);
    expect(run.line()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.line()).toBe('[e2e] daemon host ready: waited 200 ms after the window, 700 ms after the launch');
    expect(run.reads).toHaveBeenCalledTimes(3);
  });

  it('returns at once, printing nothing, on another shape or a read answered null', async () => {
    for (const status of [{ transport: 'utility', state: 'starting', supervisor: null }, null]) {
      const run = wait(async () => status);
      await vi.advanceTimersByTimeAsync(0);
      expect(run.line(), JSON.stringify(status)).toBeNull();
      expect(run.reads).toHaveBeenCalledTimes(1);
    }
  });

  it('returns at once, printing nothing, when the read rejects (a page without the bridge)', async () => {
    const run = wait(() => Promise.reject(new Error("Cannot read properties of undefined (reading 'invoke')")));
    await vi.advanceTimersByTimeAsync(0);
    expect(run.line()).toBeNull();
    expect(run.reads).toHaveBeenCalledTimes(1);
  });
});
