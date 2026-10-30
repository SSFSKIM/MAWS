// A launch's wait for the daemon shape's engine host (P5 O3-B; e2e/support/host-ready.ts): it ends at the 30 s bound
// whatever the page does, a `host.status` read still pending included, returns at once on any other shape or a read
// that fails, and gives the line the launch prints. Runs on vitest's clock, the window answering 500 ms after the launch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { untilHostReady, untilSpineReady, type HostStatusLike } from '../../e2e/support/host-ready';

const LAUNCHED_AT = 1_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(LAUNCHED_AT + 500);
});
afterEach(() => {
  vi.useRealTimers();
});

const daemon = (state: string, supervisor: unknown = state === 'ready' ? { pid: 4242 } : null, watch: unknown = state === 'ready' ? { pid: 4343 } : null): HostStatusLike => ({ transport: 'daemon', state, supervisor, daemon: watch });

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

  it('waits for the daemon watch too: a ready host with its supervisor but no mawsd status yet is not ready (settings.spec.ts:587, run 41022966911)', async () => {
    const statuses = [daemon('ready', { pid: 4242 }, null), daemon('ready')];
    const run = wait(async () => statuses.shift()!);
    await vi.advanceTimersByTimeAsync(99);
    expect(run.line()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.line()).toBe('[e2e] daemon host ready: waited 100 ms after the window, 600 ms after the launch');
    expect(run.reads).toHaveBeenCalledTimes(2);
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

// P5 O3-D M5b (D24): the cold-start line, the first available `session.list` answer after the host's ready
describe('untilSpineReady', () => {
  function spineWait(list: () => Promise<{ ok: true } | { ok: false; error: string }>, closed = () => false) {
    const lists = vi.fn(list);
    let line: string | undefined;
    void untilSpineReady({ list: lists, closed, now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }, LAUNCHED_AT).then((result) => (line = result));
    return { lists, line: () => line };
  }

  it('returns at the first available answer, asking again 100 ms after each unavailable one', async () => {
    const answers = [{ ok: false as const, error: 'host_unavailable: the spine is loading' }, { ok: true as const }];
    const run = spineWait(async () => answers.shift()!);
    await vi.advanceTimersByTimeAsync(99);
    expect(run.line()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.line()).toBe('[e2e] spine ready: waited 100 ms after the host, 600 ms after the launch');
    expect(run.lists).toHaveBeenCalledTimes(2);
  });

  it('ends at the bound with the last unavailable answer, or when an answer never settles', async () => {
    const refused = spineWait(async () => ({ ok: false, error: 'host_unavailable: spine.lock is held by pid 4242' }));
    const pending = spineWait(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refused.line()).toBe('[e2e] spine ready: waited 30000 ms after the host, 30500 ms after the launch (the 30 s bound: host_unavailable: spine.lock is held by pid 4242)');
    expect(pending.line()).toBe('[e2e] spine ready: waited 30000 ms after the host, 30500 ms after the launch (the 30 s bound: session.list unanswered)');
    expect(pending.lists).toHaveBeenCalledTimes(1);
  });

  // M5b fix round 1: the reading runs beside the launch, which has returned; a test that ends first closes the app
  it('stops asking once the app has closed, with a line that is not a reading', async () => {
    let closed = false;
    const run = spineWait(async () => ({ ok: false, error: 'host_unavailable: the spine is loading' }), () => closed);
    await vi.advanceTimersByTimeAsync(250);
    closed = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(run.line()).toBe('[e2e] spine not ready before the app closed: 800 ms after the launch (last: host_unavailable: the spine is loading)');
    expect(run.lists).toHaveBeenCalledTimes(3);
  });

  it('counts a read that rejects as unavailable', async () => {
    const answers: (() => Promise<{ ok: true }>)[] = [() => Promise.reject(new Error('Execution context was destroyed')), async () => ({ ok: true })];
    const run = spineWait(() => answers.shift()!());
    await vi.advanceTimersByTimeAsync(100);
    expect(run.line()).toBe('[e2e] spine ready: waited 100 ms after the host, 600 ms after the launch');
  });
});
