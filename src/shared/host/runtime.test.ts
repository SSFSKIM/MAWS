import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostRuntime, HostCommandError, parentPortListener, type HostEmit, type HostPort } from './runtime';

// A fake MessagePortMain: what the runtime posts is recorded; `deliver` plays main posting a message to the host.
function fakePort() {
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const posted: unknown[] = [];
  const port: HostPort = {
    on: (_event, listener) => void listeners.push(listener),
    postMessage: (message) => void posted.push(message),
    start: vi.fn(),
  };
  return {
    port,
    posted,
    deliver: async (data: unknown) => {
      listeners.forEach((l) => l({ data }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const PING = { pid: 42, uptimeMs: 10, hostVersion: 'test' };

describe('host runtime speaks the host protocol', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('answers a request with the handler’s validated output', async () => {
    const fake = fakePort();
    createHostRuntime((on) => on('engine.ping', async () => PING)).serve(fake.port);
    expect(fake.port.start).toHaveBeenCalled();
    await fake.deliver({ t: 'req', id: '1', name: 'engine.ping', input: undefined });
    expect(fake.posted).toEqual([{ t: 'res', id: '1', ok: true, value: PING }]);
  });

  it('answers a request naming a command outside the registry with unknown_command', async () => {
    const fake = fakePort();
    createHostRuntime(() => {}).serve(fake.port);
    await fake.deliver({ t: 'req', id: '7', name: 'nope.thing', input: undefined });
    expect(fake.posted).toEqual([{ t: 'res', id: '7', ok: false, error: expect.objectContaining({ code: 'unknown_command' }) }]);
  });

  it('answers a registry command this host has no handler for with internal', async () => {
    const fake = fakePort();
    createHostRuntime(() => {}).serve(fake.port);
    await fake.deliver({ t: 'req', id: '2', name: 'pty.ping', input: undefined });
    expect(fake.posted).toEqual([{ t: 'res', id: '2', ok: false, error: expect.objectContaining({ code: 'internal' }) }]);
  });

  it('validates the input against the X2 schema before the handler sees it', async () => {
    const fake = fakePort();
    const handler = vi.fn(async () => undefined);
    createHostRuntime((on) => on('pty.write', handler)).serve(fake.port);
    await fake.deliver({ t: 'req', id: '3', name: 'pty.write', input: { ptyId: 'p', data: 5 } });
    expect(fake.posted).toEqual([{ t: 'res', id: '3', ok: false, error: expect.objectContaining({ code: 'invalid_input' }) }]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('turns a throwing handler into internal carrying its message', async () => {
    const fake = fakePort();
    createHostRuntime((on) =>
      on('pty.write', async () => {
        throw new Error('unknown pty');
      }),
    ).serve(fake.port);
    await fake.deliver({ t: 'req', id: '4', name: 'pty.write', input: { ptyId: 'p', data: 'x' } });
    expect(fake.posted).toEqual([{ t: 'res', id: '4', ok: false, error: { code: 'internal', message: 'unknown pty' } }]);
  });

  // C3 start: typed errors through the host runtime (C3 execution document, Interfaces "Typed errors through the host
  // runtime"): a HostCommandError keeps its code across the port; anything else still answers `internal`.
  it('forwards a HostCommandError with its code intact, and a plain Error still answers internal', async () => {
    const fake = fakePort();
    createHostRuntime((on) => {
      on('engine.ping', async () => {
        throw new HostCommandError({ code: 'timeout', message: 'get_usage unanswered after 8 s' });
      });
    }).serve(fake.port);
    await fake.deliver({ t: 'req', id: '9', name: 'engine.ping', input: undefined });
    expect(fake.posted).toEqual([{ t: 'res', id: '9', ok: false, error: { code: 'timeout', message: 'get_usage unanswered after 8 s' } }]);

    const plain = fakePort();
    createHostRuntime((on) => {
      on('engine.ping', async () => {
        throw new Error('boom');
      });
    }).serve(plain.port);
    await plain.deliver({ t: 'req', id: '10', name: 'engine.ping', input: undefined });
    expect(plain.posted).toEqual([{ t: 'res', id: '10', ok: false, error: { code: 'internal', message: 'boom' } }]);
  });
  // C3 end

  it('refuses to answer with an output that fails the command’s schema', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakePort();
    createHostRuntime((on) => on('engine.ping', async () => ({ pid: 'x' }) as never)).serve(fake.port);
    await fake.deliver({ t: 'req', id: '5', name: 'engine.ping', input: undefined });
    expect(fake.posted).toEqual([{ t: 'res', id: '5', ok: false, error: expect.objectContaining({ code: 'internal' }) }]);
  });

  it('logs and drops a message that is not a well-formed request', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakePort();
    createHostRuntime((on) => on('engine.ping', async () => PING)).serve(fake.port);
    await fake.deliver({ t: 'req', name: 'engine.ping' }); // no id: nothing to answer to
    await fake.deliver({ t: 'res', id: '1', ok: true, value: 1 }); // wrong direction
    expect(fake.posted).toEqual([]);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('emits valid events as evt messages and drops invalid ones with a log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakePort();
    let emit!: HostEmit;
    const runtime = createHostRuntime((_on, e) => (emit = e));
    runtime.serve(fake.port);
    runtime.setReady();
    const data = new Uint8Array([104, 105]);
    expect(emit('pty.data', { ptyId: 'p' as never, offset: 0, data })).toBe(true);
    expect(emit('pty.data', { ptyId: 'p' as never, offset: 2, data: 'hi' as never })).toBe(false);
    expect(fake.posted).toEqual([{ t: 'evt', name: 'pty.data', payload: { ptyId: 'p', offset: 0, data } }]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pty.data'), expect.anything());
  });

  it('refuses a command owned by the other host, in either order', () => {
    expect(() =>
      createHostRuntime((on) => {
        on('pty.ping', async () => PING);
        on('engine.ping', async () => PING);
      }),
    ).toThrow(/engine\.ping is owned by engine-host, but this host serves pty-host/);
    expect(() =>
      createHostRuntime((on) => {
        on('engine.ping', async () => PING);
        on('pty.write', async () => undefined);
      }),
    ).toThrow(/pty\.write is owned by pty-host, but this host serves engine-host/);
    expect(() =>
      createHostRuntime((on) => {
        on('pty.ping', async () => PING);
        on('pty.write', async () => undefined);
      }),
    ).not.toThrow();
  });

  it('refuses to register a main-owned command or the same command twice', () => {
    expect(() => createHostRuntime((on) => on('settings.get', async () => ({}) as never))).toThrow(/main/);
    expect(() =>
      createHostRuntime((on) => {
        on('engine.ping', async () => PING);
        on('engine.ping', async () => PING);
      }),
    ).toThrow(/already/);
  });
});

// E10: the runtime's client hooks (E10 execution document, Interfaces "The host runtime"). Events flow only to a
// connected client that said `ready`; the connect hooks run synchronously at it, before any later event.
describe('host runtime client hooks', () => {
  beforeEach(() => vi.restoreAllMocks());

  const ITEMS = { appSessionId: 'app-1', items: [] } as never;

  function engineHost(hooks: (() => void)[] = []) {
    let emit!: HostEmit;
    const runtime = createHostRuntime((on, e) => {
      on('engine.ping', async () => PING);
      emit = e;
    });
    for (const hook of hooks) runtime.onConnect(hook);
    return { runtime, emit: () => emit('session.brokerItems', ITEMS) };
  }

  it('emits nothing before the client’s ready line, and everything after it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakePort();
    const { runtime, emit } = engineHost();
    expect(runtime.hasClient()).toBe(false);
    expect(emit()).toBe(false);
    runtime.serve(fake.port);
    expect(runtime.hasClient()).toBe(false);
    expect(emit()).toBe(false);
    expect(fake.posted).toEqual([]);
    await fake.deliver({ t: 'ready' });
    expect(runtime.hasClient()).toBe(true);
    expect(emit()).toBe(true);
    expect(fake.posted).toEqual([{ t: 'evt', name: 'session.brokerItems', payload: ITEMS }]);
  });

  it('runs the connect hooks synchronously at ready, in order, with events already flowing to the client', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakePort();
    const order: string[] = [];
    const host = engineHost([
      () => {
        order.push('first');
        expect(host.emit()).toBe(true);
      },
      () => {
        order.push('second');
        throw new Error('a failing hook does not stop the next');
      },
      () => void order.push('third'),
    ]);
    host.runtime.serve(fake.port);
    expect(order).toEqual([]);
    host.runtime.setReady();
    expect(order).toEqual(['first', 'second', 'third']);
    expect(fake.posted).toHaveLength(1);
  });

  it('hands the register the client hooks: a connect hook it registers runs at ready, and hasClient follows the client', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakePort();
    const seen: boolean[] = [];
    let hasClient!: () => boolean;
    const runtime = createHostRuntime((on, emit, client) => {
      on('engine.ping', async () => PING);
      hasClient = client.hasClient;
      client.onConnect(() => void seen.push(client.hasClient(), emit('session.brokerItems', ITEMS)));
    });
    runtime.serve(fake.port);
    expect(hasClient()).toBe(false);
    await fake.deliver({ t: 'ready' });
    expect(seen).toEqual([true, true]);
    expect(fake.posted).toEqual([{ t: 'evt', name: 'session.brokerItems', payload: ITEMS }]);
    runtime.detach();
    expect(hasClient()).toBe(false);
  });

  it('a duplicate ready from the same client runs no hook twice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakePort();
    const hook = vi.fn();
    const { runtime } = engineHost([hook]);
    runtime.serve(fake.port);
    await fake.deliver({ t: 'ready' });
    await fake.deliver({ t: 'ready' });
    expect(hook).toHaveBeenCalledTimes(1);
  });

  it('detach drops the client: emits answer false until a new client is served and ready', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = fakePort();
    const { runtime, emit } = engineHost();
    runtime.serve(first.port);
    runtime.setReady();
    runtime.detach();
    expect(runtime.hasClient()).toBe(false);
    expect(emit()).toBe(false);
    expect(first.posted).toEqual([]);
  });

  it('a second serve replaces the port: a ready from the old one is ignored and events reach only the new one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = fakePort();
    const second = fakePort();
    const hook = vi.fn();
    const { runtime, emit } = engineHost([hook]);
    runtime.serve(first.port);
    runtime.setReady();
    runtime.serve(second.port);
    expect(runtime.hasClient()).toBe(false);
    await first.deliver({ t: 'ready' });
    expect(runtime.hasClient()).toBe(false);
    await second.deliver({ t: 'ready' });
    expect(emit()).toBe(true);
    expect(hook).toHaveBeenCalledTimes(2);
    expect(first.posted).toEqual([]);
    expect(second.posted).toHaveLength(1);
    // a request on the old port is still answered there (the caller closed its socket, so the answer drops)
    await first.deliver({ t: 'req', id: 'old', name: 'engine.ping', input: undefined });
    expect(first.posted).toEqual([{ t: 'res', id: 'old', ok: true, value: PING }]);
  });

  // E11 (tracker row E10 "host.log expected traffic as errors"): dropping while no client is ready is the rule, not a
  // failure, so its lines are info, never error
  it('logs dropped events once per stretch without a client, then their count when one is ready, at info level', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { runtime, emit } = engineHost();
    emit();
    emit();
    emit();
    expect(log.mock.calls.filter(([line]) => String(line).includes('dropping events'))).toHaveLength(1);
    runtime.serve(fakePort().port);
    runtime.setReady();
    expect(log.mock.calls.some(([line]) => String(line).includes('3 events dropped'))).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });

  it('answers false when the port reports it wrote nothing (a socket already closing)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakePort();
    let writable = true;
    const port: HostPort = { ...fake.port, postMessage: (message) => (writable ? void fake.posted.push(message) : false) };
    const { runtime, emit } = engineHost();
    runtime.serve(port);
    runtime.setReady();
    expect(emit()).toBe(true);
    writable = false;
    expect(emit()).toBe(false);
    expect(fake.posted).toHaveLength(1);
  });

  // E10 Task 2.3: a false from emit is told apart by hasClient: a port that wrote nothing is a client gone for good (a
  // socket port never recovers), while an invalid payload leaves the client connected
  it('a port that wrote nothing ends the client; an invalid payload does not', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakePort();
    let writable = true;
    const port: HostPort = { ...fake.port, postMessage: (message) => (writable ? void fake.posted.push(message) : false) };
    let emit!: HostEmit;
    const runtime = createHostRuntime((on, e) => {
      on('engine.ping', async () => PING);
      emit = e;
    });
    runtime.serve(port);
    runtime.setReady();
    expect(emit('session.brokerItems', { appSessionId: 'app-1', items: 'not a list' } as never)).toBe(false);
    expect(runtime.hasClient()).toBe(true);
    writable = false;
    expect(emit('session.brokerItems', ITEMS)).toBe(false);
    expect(runtime.hasClient()).toBe(false);
    writable = true;
    expect(emit('session.brokerItems', ITEMS)).toBe(false); // nothing more goes to that port
    expect(fake.posted).toEqual([]);
  });

  it('the engine host refuses to emit an event outside HOST_EVENTS', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakePort();
    let emit!: HostEmit;
    const runtime = createHostRuntime((on, e) => {
      on('engine.ping', async () => PING);
      emit = e;
    });
    runtime.serve(fake.port);
    runtime.setReady();
    expect(emit('engine.hostState', { state: 'ready', pid: 1, restarts: 0, revision: 1 })).toBe(false);
    expect(fake.posted).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('engine.hostState is not in HOST_EVENTS'));
  });
});

// E4c start (E4c execution document, Decision Log 31 and 43; X13): the client's going, which the browser bridge settles
// its pending requests on. The runtime learns a ready client left in three places: the socket closed (`detach`), a new
// client replaced it (`serve`), or a write to it failed; each fires the hooks once per ready client.
describe('host runtime: a ready client going (E4c)', () => {
  beforeEach(() => vi.restoreAllMocks());
  const ITEMS = { appSessionId: 'app-1', items: [] } as never;

  function host() {
    let emit!: HostEmit;
    let gone = 0;
    let unsubscribe!: () => void;
    const runtime = createHostRuntime((on, e, client) => {
      on('engine.ping', async () => PING);
      emit = e;
      unsubscribe = client.onClientGone(() => void gone++);
    });
    return { runtime, emit: () => emit('session.brokerItems', ITEMS), gone: () => gone, unsubscribe: () => unsubscribe() };
  }

  it('fires once when a ready client detaches, and not for a client that never said ready', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = host();
    h.runtime.serve(fakePort().port);
    h.runtime.detach();
    expect(h.gone()).toBe(0); // served, never ready: nothing was asked of it
    h.runtime.serve(fakePort().port);
    h.runtime.setReady();
    h.runtime.detach();
    h.runtime.detach();
    expect(h.gone()).toBe(1);
  });

  it('fires once when a second serve replaces a ready client', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = host();
    h.runtime.serve(fakePort().port);
    h.runtime.setReady();
    h.runtime.serve(fakePort().port);
    expect(h.gone()).toBe(1);
    expect(h.runtime.hasClient()).toBe(false);
  });

  it('fires once when a write to the client fails, and not again at the close that follows', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakePort();
    let writable = true;
    const port: HostPort = { ...fake.port, postMessage: (message) => (writable ? void fake.posted.push(message) : false) };
    const h = host();
    h.runtime.serve(port);
    h.runtime.setReady();
    expect(h.emit()).toBe(true);
    writable = false;
    expect(h.emit()).toBe(false);
    expect(h.gone()).toBe(1);
    expect(h.emit()).toBe(false);
    h.runtime.detach();
    expect(h.gone()).toBe(1);
  });

  it('an unsubscribed hook is not called', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const h = host();
    h.unsubscribe();
    h.runtime.serve(fakePort().port);
    h.runtime.setReady();
    h.runtime.detach();
    expect(h.gone()).toBe(0);
  });
});
// E4c end

// P3-A M4 start: a document's port on the parent port (docs/doperpowers/plans/2026-10-12-p3-a-store.md, Decision Log 13).
// Main posts `{t: 'doc', channel, artifactId, actor}` with one end of the document's channel; the runtime hands it to
// the handler the register installed, and closes what it cannot hand anywhere.
describe('host runtime: document ports on the parent port (P3-A M4)', () => {
  beforeEach(() => vi.restoreAllMocks());

  const ARTIFACT = '11111111-1111-4111-8111-111111111111';
  const doc = { t: 'doc', channel: 7, artifactId: ARTIFACT, actor: { kind: 'human' } };
  const docPort = () => ({ close: vi.fn(), start: vi.fn(), on: vi.fn(), postMessage: vi.fn() });

  it('hands a doc message and its one port to the register’s handler, after or before the hello alike', () => {
    const opened: unknown[] = [];
    const runtime = createHostRuntime((_on, _emit, client) => client.onDocPort((message, port) => opened.push([message, port])));
    const listen = parentPortListener(runtime);
    const before = docPort();
    listen({ data: doc, ports: [before as never] });
    const hello = fakePort();
    listen({ data: { t: 'hello' }, ports: [hello.port as never] });
    expect(hello.port.start).toHaveBeenCalled(); // the hello still serves
    const after = docPort();
    listen({ data: { ...doc, channel: 8, actor: { kind: 'session', appSessionId: 'app-1' } }, ports: [after as never] });
    expect(opened).toEqual([
      [doc, before],
      [{ ...doc, channel: 8, actor: { kind: 'session', appSessionId: 'app-1' } }, after],
    ]);
    expect(before.close).not.toHaveBeenCalled();
  });

  it('closes a doc port no handler takes, and every port of a doc message that is not well formed', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unhandled = docPort();
    parentPortListener(createHostRuntime(() => {}))({ data: doc, ports: [unhandled as never] });
    expect(unhandled.close).toHaveBeenCalled();
    const handler = vi.fn();
    const listen = parentPortListener(createHostRuntime((_on, _emit, client) => client.onDocPort(handler)));
    for (const data of [
      { ...doc, channel: -1 },
      { ...doc, channel: 2 ** 32 },
      { ...doc, artifactId: 'not-a-uuid' },
      { ...doc, actor: { kind: 'system' } },
      { ...doc, extra: true },
    ]) {
      const port = docPort();
      listen({ data, ports: [port as never] });
      expect(port.close, JSON.stringify(data)).toHaveBeenCalled();
    }
    const [a, b] = [docPort(), docPort()];
    listen({ data: doc, ports: [a as never, b as never] });
    listen({ data: doc, ports: [] });
    expect(a.close).toHaveBeenCalled();
    expect(b.close).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('a throwing handler costs that port only: it is closed and the runtime keeps serving', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const listen = parentPortListener(createHostRuntime((_on, _emit, client) => client.onDocPort(() => { throw new Error('no store'); })));
    const port = docPort();
    listen({ data: doc, ports: [port as never] });
    expect(port.close).toHaveBeenCalled();
    const hello = fakePort();
    listen({ data: { t: 'hello' }, ports: [hello.port as never] });
    expect(hello.port.start).toHaveBeenCalled();
  });

  it('serves the first hello only, as before', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listen = parentPortListener(createHostRuntime(() => {}));
    const [first, second] = [fakePort(), fakePort()];
    listen({ data: { t: 'hello' }, ports: [first.port as never] });
    listen({ data: { t: 'hello' }, ports: [second.port as never] });
    expect(first.port.start).toHaveBeenCalled();
    expect(second.port.start).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[host] ignored a second hello');
  });
});
// P3-A M4 end
