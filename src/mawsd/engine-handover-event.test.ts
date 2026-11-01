// `mawsd`'s engine host update under way, told on machine.sock (./engine-handover-event.ts): at each change of the host
// supervisor's handover state, again every ENGINE_HANDOVER_RESEND_MS while one is, and `none` once at its end; read from
// the host supervisor alone, so a parked engine host is never asked anything.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineHandoverState } from '@shared/host/host-supervisor';
import { validateEventPayload } from '@shared/ipc/validate';
import { ENGINE_HANDOVER_RESEND_MS, tellEngineHandover } from './engine-handover-event';

function harness() {
  const listeners = new Set<(state: EngineHandoverState | null) => void>();
  let current: EngineHandoverState | null = null;
  const posted: unknown[] = [];
  const hosts = {
    handoverState: vi.fn(() => current),
    onHandover: vi.fn((_owner: string, listener: (state: EngineHandoverState | null) => void) => (listeners.add(listener), () => listeners.delete(listener))),
  };
  const set = (next: EngineHandoverState | null) => {
    current = next;
    for (const listener of listeners) listener(next);
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
});
