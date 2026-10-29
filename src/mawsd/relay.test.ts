// A relay's app between its socket and the count (P5 Decision Log 124: `mawsd`'s quiet): a hello waiting on its
// admission, and a departed app whose drain has not ended its side, each told as it begins and ends.
import { describe, expect, it } from 'vitest';
import type { HostSupervisor } from '@shared/host/host-supervisor';
import type { HostPort } from '@shared/host/runtime';
import { Relay, type RelayOptions } from './relay';

function upstream() {
  let state = 'stopped';
  const listeners = new Set<() => void>();
  const hosts = {
    snapshot: () => ({ state }),
    parked: () => state === 'stopped',
    wake: () => void (state = 'starting'),
    welcome: () => (state === 'ready' ? { pid: 7, liveSessions: 0, rows: 0, peer: { minor: 0, build: 'b', capabilities: [] } } : null),
    refusal: () => null,
    facts: () => ({ reason: null }),
    onState: (_owner: string, listener: () => void) => (listeners.add(listener), () => listeners.delete(listener)),
  };
  const ready = () => {
    state = 'ready';
    listeners.forEach((listener) => listener());
  };
  return { hosts: hosts as unknown as HostSupervisor, ready };
}

function relay(over: Partial<RelayOptions> = {}) {
  const { hosts, ready } = upstream();
  const told: boolean[] = [];
  const made: Relay = new Relay({
    owner: 'engine-host', hosts, log: () => {}, startedAt: () => 'then', onExit: () => {}, attached: () => {}, ready: () => {}, departed: () => {},
    between: () => void told.push(made.between()),
    ...over,
  });
  return { relay: made, told, ready };
}

const port = (): HostPort => ({ start: () => {}, postMessage: () => true, on: () => undefined });

describe('a relay’s app between its socket and the count', () => {
  it('is between while its hello waits on a parked host it woke, until the admission answers', async () => {
    const r = relay();
    const admitted = r.relay.admit();
    expect(r.relay.between()).toBe(true);
    r.ready();
    expect((await admitted).kind).toBe('welcome');
    expect(r.relay.between()).toBe(false);
    expect(r.told).toEqual([true, false]);
  });

  it('is between from a departure until its drain ends the app’s side', () => {
    let drained!: () => void;
    const r = relay({ drain: { start: (done) => void (drained = done), boundMs: 60_000 } });
    r.relay.serve(port());
    expect(r.relay.between()).toBe(false); // attached: the count's
    r.relay.ended();
    expect(r.relay.between()).toBe(true);
    drained();
    expect(r.relay.between()).toBe(false);
    expect(r.told).toEqual([true, false]);
  });
});
