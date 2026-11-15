// `mawsd`'s engine host update under way, told on machine.sock (./engine-handover-event.ts): at each change of the host
// supervisor's handover state, again every ENGINE_HANDOVER_RESEND_MS while one is, and `none` once at its end; read from
// the host supervisor alone, so a parked engine host is never asked anything.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineHandoverState, HandoverEnded } from '@shared/host/host-supervisor';
import { validateEventPayload } from '@shared/ipc/validate';
import { ENGINE_HANDOVER_RESEND_MS, tellEngineHandover } from './engine-handover-event';

function harness() {
  const listeners = new Set<(state: EngineHandoverState | null, ended?: HandoverEnded) => void>();
  let current: EngineHandoverState | null = null;
  const posted: unknown[] = [];
  const hosts = {
    handoverState: vi.fn(() => current),
    onHandover: vi.fn((_owner: string, listener: (state: EngineHandoverState | null, ended?: HandoverEnded) => void) => (listeners.add(listener), () => listeners.delete(listener))),
  };
  const set = (next: EngineHandoverState | null, ended?: HandoverEnded) => {
    current = next;
    for (const listener of listeners) listener(next, ended);
  };
  const emit = (payload: unknown) => {
    const checked = validateEventPayload('daemon.engineHandover', payload);
    if (!checked.ok) throw new Error(`invalid daemon.engineHandover: ${JSON.stringify(checked.issues)}`);
    posted.push(payload);
    return true;
  };
  return { hosts, set, emit, posted, listeners };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-01T10:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('tellEngineHandover', () => {
  it('tells each change, again every resend while one is under way, and none once at its end', () => {
    const h = harness();
    const told = tellEngineHandover({ hosts: h.hosts, emit: h.emit });
    expect(h.posted).toEqual([]); // nothing under way at the start: nothing said
    h.set({ state: 'waiting', inFlight: 2, tool: 'artifact_list' });
    expect(h.posted).toEqual([{ state: 'waiting', inFlight: 2, tool: 'artifact_list', at: '2026-11-01T10:00:00.000Z' }]);
    vi.advanceTimersByTime(ENGINE_HANDOVER_RESEND_MS);
    expect(h.posted).toHaveLength(2);
    expect(h.posted[1]).toEqual({ state: 'waiting', inFlight: 2, tool: 'artifact_list', at: '2026-11-01T10:00:05.000Z' });
    h.set({ state: 'draining', inFlight: 1 });
    expect(h.posted.at(-1)).toMatchObject({ state: 'draining', inFlight: 1 });
    h.set(null);
    expect(h.posted.at(-1)).toMatchObject({ state: 'none', inFlight: 0 });
    const ended = h.posted.length;
    vi.advanceTimersByTime(ENGINE_HANDOVER_RESEND_MS * 3);
    expect(h.posted).toHaveLength(ended); // nothing resent once it ended
    told.stop();
    expect(h.listeners.size).toBe(0);
  });

  it('a parked engine host has no update under way: nothing is told, and the host is never asked anything', () => {
    const h = harness();
    const told = tellEngineHandover({ hosts: h.hosts, emit: h.emit });
    vi.advanceTimersByTime(ENGINE_HANDOVER_RESEND_MS * 4);
    expect(h.posted).toEqual([]);
    expect(Object.keys(h.hosts)).toEqual(['handoverState', 'onHandover']); // nothing it could dispatch: no wake
    told.stop();
  });

  it('a stop ends the resend', () => {
    const h = harness();
    const told = tellEngineHandover({ hosts: h.hosts, emit: h.emit });
    h.set({ state: 'draining', inFlight: 1 });
    told.stop();
    vi.advanceTimersByTime(ENGINE_HANDOVER_RESEND_MS * 3);
    expect(h.posted).toHaveLength(1);
  });

  // #473: the drain's end carries the verdict on the old host's exit, which main's own verdict on its relayed host waits for
  it('the none that ends a drain carries the verdict on the old host’s exit', () => {
    const h = harness();
    tellEngineHandover({ hosts: h.hosts, emit: h.emit });
    h.set({ state: 'draining', inFlight: 0 });
    h.set(null, { pid: 4242, startedAt: '2026-11-01T09:00:00.000Z', handedOver: true });
    expect(h.posted.at(-1)).toEqual({ state: 'none', inFlight: 0, at: '2026-11-01T10:00:00.000Z', ended: { pid: 4242, startedAt: '2026-11-01T09:00:00.000Z', handedOver: true } });
  });

  // #473: a client that says ready while a drain runs hears it then, not at the next resend (a quick drain is over by then)
  it('retell says the state under way, and nothing when none is', () => {
    const h = harness();
    const told = tellEngineHandover({ hosts: h.hosts, emit: h.emit });
    told.retell();
    expect(h.posted).toEqual([]);
    h.set({ state: 'draining', inFlight: 1, tool: 'artifact_list' });
    told.retell();
    expect(h.posted).toEqual([
      { state: 'draining', inFlight: 1, tool: 'artifact_list', at: '2026-11-01T10:00:00.000Z' },
      { state: 'draining', inFlight: 1, tool: 'artifact_list', at: '2026-11-01T10:00:00.000Z' },
    ]);
  });
});
