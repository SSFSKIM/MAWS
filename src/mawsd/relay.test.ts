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

// P5 O3-D M5 (docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md, Interfaces §L): the relay's own refusal of a hello,
// before any upstream is woken, and the exit that follows it asking nothing; an app the relay gives no events to; and the
// app's capabilities handed to the daemon's intercepts
describe('a relay’s own refusal and its app’s capabilities (P5 O3-D M5)', () => {
  const PEER = { major: 3, minor: 7, build: 'old-app', capabilities: ['socket.ptyFrames'] };
  const LINE = { t: 'refuse', reason: 'wire', protocol: 3, buildId: 'mawsd-build', wire: 'w', liveSessions: 2 } as const;

  it('refuses a hello its check names with the relay’s own line, waking no upstream, and is told the hello’s appPid', async () => {
    const asked: unknown[] = [];
    const r = relay({ refuseHello: (peer, appPid) => (asked.push([peer.build, appPid]), LINE) });
    const admission = await r.relay.admit(PEER, 4321);
    expect(admission).toEqual({ kind: 'refuse', line: LINE, own: true });
    expect(asked).toEqual([['old-app', 4321]]);
    expect(r.told).toEqual([]); // never between: no upstream was woken for it
  });

  it('admits as before a hello its check passes (null)', async () => {
    const r = relay({ refuseHello: () => null });
    const admitted = r.relay.admit(PEER, 4321);
    r.ready();
    expect((await admitted).kind).toBe('welcome');
  });

  it('an exit after its own refusal asks nothing; after the upstream’s reflected one it is the app’s, as before', () => {
    const exits: [string, boolean][] = [];
    const lines: string[] = [];
    const r = relay({ onExit: (when, refused) => void exits.push([when, refused]), log: (line) => void lines.push(line) });
    r.relay.exit('now', { refused: true, own: true });
    expect(exits).toEqual([]);
    expect(lines).toEqual(['exit now on a connection the relay refused itself: nothing asked of the engine-host']);
    r.relay.exit('now', { refused: true, own: false });
    r.relay.exit('now', { refused: false });
    expect(exits).toEqual([['now', true], ['now', false]]);
  });

  it('gives no event to an app `deliverTo` declines, by the capabilities its hello listed; another app hears them from its ready', () => {
    const posted: unknown[][] = [[], []];
    const portOf = (n: number): HostPort & { deliver(data: unknown): void } => {
      let listener: ((event: { data: unknown }) => void) | null = null;
      return { start: () => {}, postMessage: (message: unknown) => (posted[n]!.push(message), true), on: (_e: string, l: (event: { data: unknown }) => void) => void (listener = l), deliver: (data: unknown) => listener!({ data }) } as never;
    };
    const r = relay({ deliverTo: (capabilities) => !capabilities.includes('machine.spine') });
    const spineApp = portOf(0);
    r.relay.serve(spineApp, { capabilities: ['socket.ptyFrames', 'machine.spine'] });
    spineApp.deliver({ t: 'ready' });
    r.relay.deliver({ name: 'session.eventBatch', payload: 1 });
    expect(posted[0]).toEqual([]);
    const oldApp = portOf(1);
    r.relay.serve(oldApp, { capabilities: ['socket.ptyFrames'] });
    oldApp.deliver({ t: 'ready' });
    r.relay.deliver({ name: 'session.eventBatch', payload: 2 });
    expect(posted[1]).toEqual([{ t: 'evt', name: 'session.eventBatch', payload: 2 }]);
  });

  it('hands each request’s intercept the app’s capabilities', async () => {
    const seen: unknown[] = [];
    const r = relay({ intercept: (request, app) => (seen.push([request.name, app.capabilities]), Promise.resolve({ t: 'res', id: request.id, ok: true, value: 'mine' })) });
    let listener: ((event: { data: unknown }) => void) | null = null;
    const answers: unknown[] = [];
    r.relay.serve({ start: () => {}, postMessage: (message: unknown) => (answers.push(message), true), on: (_e: string, l: (event: { data: unknown }) => void) => void (listener = l) } as never, { capabilities: ['machine.spine'] });
    listener!({ data: { t: 'req', id: 'r1', name: 'session.rewind', input: {} } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toEqual([['session.rewind', ['machine.spine']]]);
    expect(answers).toEqual([{ t: 'res', id: 'r1', ok: true, value: 'mine' }]);
  });
});
