// Main's reading of `mawsd`'s engine host update under way (./engine-handover.ts): from machine.sock's
// `daemon.engineHandover` alone, fresh for ENGINE_HANDOVER_FRESH_MS, gone with the machine link or at `none`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostState } from '@shared/ipc/schema';
import type { EngineHandover } from '@shared/ipc/schema/daemon';
import { ENGINE_HANDOVER_FRESH_MS, watchEngineHandover } from './engine-handover';

function harness() {
  const events = new Set<(payload: EngineHandover) => void>();
  const states = new Set<(state: HostState) => void>();
  const hosts = {
    onEvent: vi.fn((name: string, listener: (payload: EngineHandover) => void) => (expect(name).toBe('daemon.engineHandover'), events.add(listener), () => events.delete(listener))),
    onState: vi.fn((owner: string, listener: (state: HostState) => void) => (expect(owner).toBe('machine'), states.add(listener), () => states.delete(listener))),
  };
  const heard = (payload: Omit<EngineHandover, 'at'>) => {
    for (const listener of events) listener({ ...payload, at: new Date().toISOString() });
  };
  const machine = (state: HostState['state']) => {
    for (const listener of states) listener({ state, pid: state === 'ready' ? 9 : null, restarts: 0, revision: 0 } as HostState);
  };
  return { hosts, heard, machine, events, states };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('watchEngineHandover', () => {
  it('waits on a fresh draining report, names a fresh report’s calls, and tells each change', () => {
    const h = harness();
    const watch = watchEngineHandover();
    const off = watch.bind(h.hosts as never);
    const changes = vi.fn();
    watch.onChange(changes);
    expect(watch.drainingAt()).toBeNull();
    expect(watch.reason()).toBeNull();
    h.heard({ state: 'waiting', inFlight: 2, tool: 'artifact_list' });
    expect(watch.drainingAt()).toBeNull(); // the old build serves meanwhile: nothing held
    expect(watch.reason()).toEqual({ inFlight: 2, tool: 'artifact_list' });
    h.heard({ state: 'draining', inFlight: 1 });
    expect(watch.drainingAt()).toBe(Date.now());
    expect(watch.reason()).toEqual({ inFlight: 1 });
    expect(changes).toHaveBeenCalledTimes(2);
    h.heard({ state: 'draining', inFlight: 0 });
    vi.advanceTimersByTime(1_000);
    expect(watch.drainingAt()).toBe(Date.now()); // still draining: now
    expect(watch.reason()).toBeNull(); // nothing to wait for: no reason to show
    h.heard({ state: 'none', inFlight: 0 });
    const ended = Date.now();
    vi.advanceTimersByTime(7_000);
    expect(watch.drainingAt()).toBe(ended); // the drain's end, however long ago it was read
    off();
    expect(h.events.size + h.states.size).toBe(0);
  });

  it('a stale report falls back: past its freshness, it neither waits nor names, and says so', () => {
    const h = harness();
    const watch = watchEngineHandover();
    watch.bind(h.hosts as never);
    const changes = vi.fn();
    watch.onChange(changes);
    h.heard({ state: 'draining', inFlight: 1, tool: 'show_pane' });
    vi.advanceTimersByTime(ENGINE_HANDOVER_FRESH_MS - 1);
    expect(watch.drainingAt()).toBe(Date.now());
    h.heard({ state: 'draining', inFlight: 1, tool: 'show_pane' }); // mawsd's resend renews it
    const resent = Date.now();
    vi.advanceTimersByTime(ENGINE_HANDOVER_FRESH_MS - 1);
    expect(watch.drainingAt()).toBe(Date.now());
    vi.advanceTimersByTime(1);
    expect(watch.drainingAt()).toBe(resent + ENGINE_HANDOVER_FRESH_MS); // ended when it went stale
    vi.advanceTimersByTime(5_000);
    expect(watch.drainingAt()).toBe(resent + ENGINE_HANDOVER_FRESH_MS);
    expect(watch.reason()).toBeNull();
    expect(changes).toHaveBeenCalledTimes(3); // heard, heard again (renewed), stale
  });

  it('a machine link that goes down falls back at once; an older mawsd that sends nothing never waits', () => {
    const h = harness();
    const watch = watchEngineHandover();
    watch.bind(h.hosts as never);
    expect(watch.drainingAt()).toBeNull();
    h.machine('ready');
    h.heard({ state: 'draining', inFlight: 1 });
    expect(watch.drainingAt()).toBe(Date.now());
    vi.advanceTimersByTime(2_000);
    h.machine('restarting');
    const down = Date.now();
    vi.advanceTimersByTime(2_000);
    expect(watch.drainingAt()).toBe(down);
    expect(watch.reason()).toBeNull();
  });

  // P5 O16 M3c fix wave 3 (the re-review's P1): the drain's end is kept, so main's transport gives the successor a whole
  // start budget from it, however late it reads it (a held hello it was waiting on ends after the drain did)
  it('keeps the moment the drain ended, whatever ended it: a report that is not draining, then none at all', () => {
    const h = harness();
    const watch = watchEngineHandover();
    watch.bind(h.hosts as never);
    h.heard({ state: 'draining', inFlight: 1 });
    vi.advanceTimersByTime(3_000);
    h.heard({ state: 'waiting', inFlight: 1 }); // a failed ask's recycle: the host serves again
    const ended = Date.now();
    vi.advanceTimersByTime(3_000);
    expect(watch.drainingAt()).toBe(ended);
    h.heard({ state: 'none', inFlight: 0 });
    vi.advanceTimersByTime(3_000);
    expect(watch.drainingAt()).toBe(ended); // a later end of something that was not a drain moves nothing
  });

  it('learns it from the event alone: it dispatches nothing, so a parked engine host is never woken', () => {
    const h = harness();
    const watch = watchEngineHandover();
    watch.bind(h.hosts as never);
    expect(Object.keys(h.hosts)).toEqual(['onEvent', 'onState']); // no dispatch reaches it: no daemon.status, no wake
    vi.advanceTimersByTime(ENGINE_HANDOVER_FRESH_MS * 4);
    expect(watch.drainingAt()).toBeNull(); // a parked host with a held hello: no report, today's bound, no spawn held off
  });
});
