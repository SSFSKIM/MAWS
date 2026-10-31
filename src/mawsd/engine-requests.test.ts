// A client's request to the engine host and the park (P5 O5 landing 1; engine-requests.ts): a need, counted in flight
// so no park is asked under it; one that arrives after the ask was sent goes only once that host has exited, or once
// the ask is taken back from a host that stays; another owner's goes straight on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostState } from '@shared/host/host-supervisor';
import type { HostResponse } from '@shared/ipc/host-protocol';
import { engineRequests, EXIT_SETTLE_MS } from './engine-requests';

function scene() {
  const steps: string[] = [];
  const listeners = new Set<(state: HostState) => void>();
  const s = { asked: false, parked: false, steps, inFlight: [] as number[] };
  const forwarded: ((value: HostResponse) => void)[] = [];
  const hosts = {
    forward: vi.fn((owner: string, request: { name: string }) => {
      steps.push(`forward ${owner} ${request.name}`);
      return new Promise<HostResponse>((resolve) => forwarded.push(resolve));
    }),
    onState: (_owner: string, listener: (state: HostState) => void) => (listeners.add(listener), () => void listeners.delete(listener)),
    parked: () => s.parked,
  };
  const clocks = {
    engineNeeded: () => void steps.push('need'),
    engineRequests: (count: number) => void s.inFlight.push(count),
    parkAsked: () => s.asked,
    takeBackPark: () => {
      steps.push('take back');
      s.asked = false;
    },
  };
  const logs: string[] = [];
  const guard = engineRequests({ hosts: hosts as never, clocks, log: (line) => void logs.push(line) });
  const exit = () => {
    s.asked = false;
    s.parked = true;
    for (const listener of [...listeners]) listener({ state: 'restarting', pid: null, restarts: 0 } as HostState);
  };
  const answer = (value: HostResponse = { t: 'res', id: 'x', ok: true, value: null } as HostResponse) => forwarded.shift()!(value);
  return { s, hosts, guard, exit, answer, logs, listeners };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a client’s request to the engine host and the park', () => {
  it('is a need, counted in flight until it is answered', async () => {
    const t = scene();
    const asked = t.guard.forward('engine-host', { name: 'artifacts.get', input: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.s.steps).toEqual(['need', 'forward engine-host artifacts.get']);
    expect(t.s.inFlight).toEqual([1]);
    t.answer();
    await asked;
    expect(t.s.inFlight).toEqual([1, 0]);
  });

  it('after the park’s ask, goes only once that host has exited (the supervisor then starts the next for it)', async () => {
    const t = scene();
    t.s.asked = true;
    const asked = t.guard.forward('engine-host', { name: 'artifacts.create', input: {} });
    await vi.advanceTimersByTimeAsync(100);
    expect(t.hosts.forward, 'nothing sent to the host leaving').not.toHaveBeenCalled();
    t.exit();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.s.steps).toEqual(['need', 'forward engine-host artifacts.create']);
    expect(t.listeners.size, 'its watch ended').toBe(0);
    t.answer();
    await asked;
  });

  it('takes the ask back from a host still serving after the bound (it holds live rows), and sends to it', async () => {
    const t = scene();
    t.s.asked = true;
    const asked = t.guard.forward('engine-host', { name: 'artifacts.get', input: {} });
    await vi.advanceTimersByTimeAsync(EXIT_SETTLE_MS - 1);
    expect(t.hosts.forward).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.s.steps).toEqual(['need', 'take back', 'forward engine-host artifacts.get']);
    expect(t.logs).toContain('[hosts] the engine host asked to park still serves after 5 s: the park taken back for artifacts.get');
    t.answer();
    await asked;
  });

  it('goes at once when the asked host has already parked', async () => {
    const t = scene();
    t.s.asked = true;
    t.s.parked = true;
    const asked = t.guard.forward('engine-host', { name: 'artifacts.get', input: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.hosts.forward).toHaveBeenCalledOnce();
    t.answer();
    await asked;
  });

  it('another owner’s request goes straight on, no need and nothing counted', async () => {
    const t = scene();
    void t.guard.forward('pty-host', { name: 'pty.list', input: undefined });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.s.steps).toEqual(['forward pty-host pty.list']);
    expect(t.s.inFlight).toEqual([]);
  });
});
