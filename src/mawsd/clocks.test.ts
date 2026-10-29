// `mawsd`'s clocks (P5 O2 M5, "The clocks"), on vitest's fake timers: the engine host's park clock, a private
// daemon's own idle exit, and its quiet (P5 Decision Log 124's idle collection).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GROWTH_BYTES, idleCollector } from '@shared/host/idle-collect';
import { DaemonClocks, DEFAULT_IDLE_EXIT_MS } from './clocks';

const MIN = 60_000;
const action = () => vi.fn<() => void>();
let actions: { armEnginePark: ReturnType<typeof action>; disarmEnginePark: ReturnType<typeof action>; exitDaemon: ReturnType<typeof action>; quiet: ReturnType<typeof vi.fn<(quiet: boolean) => void>> };
const made: DaemonClocks[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-27T10:00:00.000Z') });
  actions = { armEnginePark: action(), disarmEnginePark: action(), exitDaemon: action(), quiet: vi.fn<(quiet: boolean) => void>() };
});
afterEach(() => {
  for (const clocks of made.splice(0)) clocks.stop();
  vi.useRealTimers();
});

function clocks(kind: 'unit' | 'private' = 'unit'): DaemonClocks {
  const made1 = new DaemonClocks(kind, actions);
  made.push(made1);
  return made1;
}

describe('the engine host’s park clock', () => {
  it('arms exit-when-idle once idleExitMs has passed with no app and no interest, for the served engine host', () => {
    const c = clocks();
    expect(c.idleMs()).toBe(DEFAULT_IDLE_EXIT_MS); // 10 minutes until an app configures it
    c.engineHost(4001);
    vi.advanceTimersByTime(DEFAULT_IDLE_EXIT_MS - 1);
    expect(actions.armEnginePark).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(actions.armEnginePark).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(DEFAULT_IDLE_EXIT_MS * 3);
    expect(actions.armEnginePark).toHaveBeenCalledOnce(); // once per engine host
  });

  it('never arms while an app is attached or anything holds interest; either disarms it first and restarts the clock', () => {
    const c = clocks();
    c.configure(5 * MIN);
    c.engineHost(4001);
    c.engineAttached(true);
    vi.advanceTimersByTime(60 * MIN);
    expect(actions.armEnginePark).not.toHaveBeenCalled();
    c.engineAttached(false); // the clock starts at the departure
    vi.advanceTimersByTime(5 * MIN);
    expect(actions.armEnginePark).toHaveBeenCalledOnce();
    c.engineAttached(true);
    expect(actions.disarmEnginePark).toHaveBeenCalledOnce();
    c.engineAttached(false);
    vi.advanceTimersByTime(4 * MIN);
    c.interest(false); // a remote viewer's session enters the union
    vi.advanceTimersByTime(60 * MIN);
    expect(actions.armEnginePark).toHaveBeenCalledOnce();
    c.interest(true); // dropped: the clock starts again, from here
    vi.advanceTimersByTime(5 * MIN - 1);
    expect(actions.armEnginePark).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(actions.armEnginePark).toHaveBeenCalledTimes(2);
    c.interest(false);
    expect(actions.disarmEnginePark).toHaveBeenCalledTimes(2);
  });

  it('arms nothing while no engine host is served, and arms a host served once the time has passed', () => {
    const c = clocks();
    c.configure(MIN);
    vi.advanceTimersByTime(5 * MIN);
    expect(actions.armEnginePark).not.toHaveBeenCalled(); // parked: nothing to arm
    c.engineHost(4002); // a CLI's status woke it
    expect(actions.armEnginePark).toHaveBeenCalledOnce();
  });

  it('arms a new engine host again, and not one it armed that only reconnected', () => {
    const c = clocks();
    c.configure(MIN);
    c.engineHost(4001);
    vi.advanceTimersByTime(MIN);
    expect(actions.armEnginePark).toHaveBeenCalledOnce();
    c.engineHost(null); // a quiet reconnect
    c.engineHost(4001);
    expect(actions.armEnginePark).toHaveBeenCalledOnce();
    c.hosts({ engine: true, pty: true }); // it exited when idle: parked
    c.engineHost(4003); // woken: a new process
    expect(actions.armEnginePark).toHaveBeenCalledTimes(2);
  });

  it('with a null idle time arms nothing', () => {
    const c = clocks();
    c.configure(null);
    c.engineHost(4001);
    vi.advanceTimersByTime(48 * 60 * MIN);
    expect(actions.armEnginePark).not.toHaveBeenCalled();
  });
});

describe('a private daemon’s idle exit', () => {
  it('exits once no client has been on any socket for idleExitMs, both hosts parked and no hold out', () => {
    const c = clocks('private');
    c.configure(MIN);
    c.hosts({ engine: true, pty: true });
    c.clients(1);
    expect(c.idleExitAt()).toBeNull();
    vi.advanceTimersByTime(10 * MIN);
    c.clients(0);
    expect(c.idleExitAt()).toBe(new Date(Date.now() + MIN).toISOString());
    vi.advanceTimersByTime(MIN - 1);
    expect(actions.exitDaemon).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(actions.exitDaemon).toHaveBeenCalledOnce();
  });

  it('waits for both hosts to park, then exits at once when the time has passed', () => {
    const c = clocks('private');
    c.configure(MIN);
    c.hosts({ engine: false, pty: true });
    vi.advanceTimersByTime(30 * MIN);
    expect(actions.exitDaemon).not.toHaveBeenCalled();
    c.hosts({ engine: true, pty: true });
    expect(actions.exitDaemon).toHaveBeenCalledOnce();
  });

  it('stays up while a hold is out, and exits once it is released', () => {
    const c = clocks('private');
    c.configure(MIN);
    c.hosts({ engine: true, pty: true });
    c.holds(1);
    vi.advanceTimersByTime(30 * MIN);
    expect(actions.exitDaemon).not.toHaveBeenCalled();
    c.holds(0);
    expect(actions.exitDaemon).toHaveBeenCalledOnce();
  });

  it('a client restarts the clock', () => {
    const c = clocks('private');
    c.configure(MIN);
    c.hosts({ engine: true, pty: true });
    vi.advanceTimersByTime(MIN - 10);
    c.clients(1);
    c.clients(0);
    vi.advanceTimersByTime(MIN - 1);
    expect(actions.exitDaemon).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(actions.exitDaemon).toHaveBeenCalledOnce();
  });

  it('a unit daemon never exits by itself, and a null idle time keeps a private one up', () => {
    const unit = clocks('unit');
    unit.configure(MIN);
    unit.hosts({ engine: true, pty: true });
    vi.advanceTimersByTime(60 * MIN);
    expect(unit.idleExitAt()).toBeNull();
    const kept = clocks('private');
    kept.configure(null);
    kept.hosts({ engine: true, pty: true });
    vi.advanceTimersByTime(60 * MIN);
    expect(kept.idleExitAt()).toBeNull();
    expect(actions.exitDaemon).not.toHaveBeenCalled();
  });
});

describe('the daemon’s quiet', () => {
  // its changes as told (it is told at every evaluation)
  const told = () => actions.quiet.mock.calls.map(([quiet]) => quiet).filter((quiet, i, all) => i === 0 || quiet !== all[i - 1]);

  it('is told from the start’s end on, at each evaluation, and changes only with its own facts', () => {
    const c = clocks();
    c.clients(0);
    c.hosts({ engine: true, pty: true });
    expect(told()).toEqual([]); // still starting
    c.served();
    expect(told()).toEqual([true]); // no client yet: the first entry
    c.hosts({ engine: false, pty: true });
    c.configure(MIN);
    expect(told()).toEqual([true]); // facts that are not its own
    c.clients(2);
    c.clients(1);
    c.clients(0);
    expect(told()).toEqual([true, false, true]);
  });

  it('holds while a remote viewer holds interest or the endpoint holds the daemon, with no client', () => {
    const c = clocks();
    c.served();
    c.interest(false);
    c.interest(true);
    c.holds(1);
    c.holds(0);
    expect(told()).toEqual([true, false, true, false, true]);
  });

  it('holds while an app is between a relay’s socket and the count: a hello admitted, a departure drained', () => {
    const c = clocks();
    c.served();
    c.relaysBetween(true);
    c.relaysBetween(false);
    expect(told()).toEqual([true, false, true]);
    expect(c.quiet()).toBe(true);
  });

  it('is told nothing once stopped', () => {
    const c = clocks();
    c.served();
    c.stop();
    c.clients(1);
    expect(told()).toEqual([true]);
    expect(c.quiet()).toBe(false);
  });

  // P5 Decision Log 124: the collection asks the clocks' quiet again as it runs. One row per source it reads that can turn
  // busy after an entry, pending as a queued collection runs: a source added with no row is one the collection cannot see.
  const pending: [string, (c: DaemonClocks) => void][] = [
    ['a client on a socket', (c) => c.clients(1)],
    ['an app between a relay’s socket and the count', (c) => c.relaysBetween(true)],
    ['interest in a session', (c) => c.interest(false)],
    ['a hold out', (c) => c.holds(1)],
  ];

  it.each(pending)('%s, pending as the collection runs, holds it off', (_, pend) => {
    const deferred: (() => void)[] = [];
    const collect = vi.fn();
    let grown = 0;
    const collector = idleCollector({ log: () => {}, collect, heap: () => ({ used: (grown += 2) * GROWTH_BYTES, physical: grown * GROWTH_BYTES }), defer: (run) => void deferred.push(run), quiet: () => c.quiet() });
    const c = new DaemonClocks('unit', { ...actions, quiet: (quiet) => collector.set(quiet) });
    made.push(c);
    c.served();
    pend(c);
    deferred.splice(0).forEach((run) => run());
    expect(c.quiet()).toBe(false);
    expect(collect).not.toHaveBeenCalled();
  });
});
