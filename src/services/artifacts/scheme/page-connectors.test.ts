// P3-H H4: the page's connector runtime (`window.mawsConnectors`, part of the bridge script), evaluated in a happy-dom
// window standing in for an artifact's frame. Its requests wait for the one port the parent hands it at load, go over
// that port, and settle on the answers the parent's relay posts back; a page with no parent, or whose port never comes,
// reads `paused: closed`.
import { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIDGE_SCRIPT } from './bridge-script';
import { PAGE_PORT_WAIT_MS } from './page-connectors';

interface Connectors {
  declare(tools: unknown): Promise<unknown>;
  call(request: unknown): Promise<unknown>;
  watch(request: unknown, onUpdate: (update: unknown) => void): Promise<{ ok: boolean; watchId?: string; stop?(): Promise<unknown>; refresh?(): Promise<unknown> }>;
}

// The relay's end of the page's port: what the page sent, and a way to answer.
class RelayEnd {
  readonly received: Record<string, unknown>[] = [];
  page: { onmessage: ((event: { data: unknown }) => void) | null } | null = null;
  answer(id: unknown, answer: unknown) {
    this.page?.onmessage?.({ data: { id, answer } });
  }
  update(watchId: string, update: unknown) {
    this.page?.onmessage?.({ data: { watchId, update } });
  }
}

function portPair(relay: RelayEnd) {
  const port = {
    onmessage: null as ((event: { data: unknown }) => void) | null,
    postMessage: (data: Record<string, unknown>) => {
      relay.received.push(structuredClone(data));
    },
    close: vi.fn(),
  };
  relay.page = port;
  return port;
}

let win: Window;
let parent: { postMessage: ReturnType<typeof vi.fn> };
beforeEach(() => {
  win = new Window();
  parent = { postMessage: vi.fn() };
  Object.defineProperty(win, 'parent', { configurable: true, get: () => parent });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await win.happyDOM.close();
});

const run = () => new Function('window', 'document', 'Element', BRIDGE_SCRIPT)(win, win.document, win.Element);
const connectors = () => (win as unknown as { mawsConnectors: Connectors }).mawsConnectors;
const handPort = (port: unknown, data: unknown = { type: 'maws:connectors' }, source: unknown = parent) =>
  win.dispatchEvent(new win.MessageEvent('message', { data, source: source as never, ports: [port as never] }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the page’s connector runtime', () => {
  it('is a frozen, non-writable global whose requests wait for the parent’s port, then go over it in order', async () => {
    run();
    const api = connectors();
    expect(Object.isFrozen(api)).toBe(true);
    expect(() => ((win as unknown as { mawsConnectors: unknown }).mawsConnectors = null)).toThrow(TypeError); // a page cannot replace it
    expect(connectors()).toBe(api);
    const declared = api.declare([{ server: 'fixture', tool: 'read_series' }]);
    const called = api.call({ server: 'fixture', tool: 'read_series', args: { q: 1 } });
    expect(parent.postMessage).not.toHaveBeenCalled(); // nothing goes to the parent window itself
    const relay = new RelayEnd();
    handPort(portPair(relay));
    expect(relay.received).toEqual([
      { id: 1, op: 'declare', tools: [{ server: 'fixture', tool: 'read_series' }] },
      { id: 2, op: 'call', request: { server: 'fixture', tool: 'read_series', args: { q: 1 } } },
    ]);
    relay.answer(2, { ok: true, result: [1], fetchedAt: 3, via: { route: 'engine' } });
    relay.answer(1, { ok: true, declared: [] });
    await expect(called).resolves.toEqual({ ok: true, result: [1], fetchedAt: 3, via: { route: 'engine' } });
    await expect(declared).resolves.toEqual({ ok: true, declared: [] });
  });

  it('takes one port, from the parent alone', async () => {
    run();
    const stranger = new RelayEnd();
    handPort(portPair(stranger), { type: 'maws:connectors' }, {}); // a port from another window: ignored
    handPort(portPair(stranger), { type: 'maws:pick', on: true }); // another message of the parent's: ignored
    const relay = new RelayEnd();
    handPort(portPair(relay));
    const later = new RelayEnd();
    handPort(portPair(later)); // a second port: ignored
    void connectors().call({ server: 's', tool: 't' });
    await settle();
    expect(stranger.received).toEqual([]);
    expect(later.received).toEqual([]);
    expect(relay.received).toEqual([{ id: 1, op: 'call', request: { server: 's', tool: 't' } }]);
  });

  it('hands a watch’s refreshes to its callback from its start on, and none after it stops', async () => {
    run();
    const relay = new RelayEnd();
    handPort(portPair(relay));
    const updates: unknown[] = [];
    const watching = connectors().watch({ server: 's', tool: 't', intervalMs: 60_000 }, (update) => updates.push(update));
    expect(relay.received).toEqual([{ id: 1, op: 'watch', request: { server: 's', tool: 't', intervalMs: 60_000 } }]);
    relay.answer(1, { ok: true, watchId: 'w1', intervalMs: 60_000 });
    relay.update('w1', { ok: true, result: 1, fetchedAt: 1, via: { route: 'engine' } }); // posted right after the answer
    const watch = await watching;
    expect(watch).toMatchObject({ ok: true, watchId: 'w1', intervalMs: 60_000 });
    expect(updates).toEqual([{ ok: true, result: 1, fetchedAt: 1, via: { route: 'engine' } }]);
    relay.update('other', { ok: true, result: 2, fetchedAt: 2, via: { route: 'engine' } });
    expect(updates).toHaveLength(1);
    const refreshed = watch.refresh!();
    expect(relay.received[1]).toEqual({ id: 2, op: 'refresh', watchId: 'w1' });
    relay.answer(2, true);
    await expect(refreshed).resolves.toBe(true);
    const stopped = watch.stop!();
    expect(relay.received[2]).toEqual({ id: 3, op: 'unwatch', watchId: 'w1' });
    relay.update('w1', { ok: false, state: 'paused', reason: 'noRoute' });
    relay.answer(3, true);
    await expect(stopped).resolves.toBe(true);
    expect(updates).toHaveLength(1);
  });

  it('answers a refused watch as it came, with no handle', async () => {
    run();
    const relay = new RelayEnd();
    handPort(portPair(relay));
    const watching = connectors().watch({ server: 's', tool: 't', intervalMs: 1 }, () => {});
    relay.answer(1, { ok: false, state: 'invalid', reason: 'undeclared' });
    await expect(watching).resolves.toEqual({ ok: false, state: 'invalid', reason: 'undeclared' });
  });

  it('answers invalid: request for what cannot cross to the parent, keeping the rest', async () => {
    run();
    const relay = new RelayEnd();
    handPort(portPair(relay));
    await expect(connectors().call({ server: 's', tool: 't', args: { f: () => 1 } })).resolves.toEqual({ ok: false, state: 'invalid', reason: 'request' });
    await expect(connectors().watch({ server: 's', tool: 't', intervalMs: 1 }, 'not a function' as never)).resolves.toEqual({ ok: false, state: 'invalid', reason: 'request' });
    expect(relay.received).toEqual([]);
  });

  it('reads paused: closed at once in a page with no parent (the capture window loads it top-level)', async () => {
    Object.defineProperty(win, 'parent', { configurable: true, get: () => win });
    run();
    await expect(connectors().call({ server: 's', tool: 't' })).resolves.toEqual({ ok: false, state: 'paused', reason: 'closed' });
  });

  it('reads paused: closed once no port came a while after the page loaded, the queued requests included', async () => {
    const timers: { run: () => void; ms: number }[] = [];
    vi.spyOn(win, 'setTimeout').mockImplementation(((run: () => void, ms: number) => timers.push({ run, ms })) as never);
    run();
    const queued = connectors().call({ server: 's', tool: 't' });
    win.dispatchEvent(new win.Event('load'));
    expect(timers.map(({ ms }) => ms)).toEqual([PAGE_PORT_WAIT_MS]);
    timers[0]!.run();
    await expect(queued).resolves.toEqual({ ok: false, state: 'paused', reason: 'closed' });
    await expect(connectors().declare([])).resolves.toEqual({ ok: false, state: 'paused', reason: 'closed' });
    const late = new RelayEnd();
    handPort(portPair(late));
    expect(late.received).toEqual([]);
  });
});
