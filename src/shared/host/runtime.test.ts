import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHostRuntime, HostCommandError, type HostPort } from './runtime';

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
    let emit!: Parameters<Parameters<typeof createHostRuntime>[0]>[1];
    createHostRuntime((_on, e) => (emit = e)).serve(fake.port);
    emit('pty.data', { ptyId: 'p' as never, data: 'hi' });
    emit('pty.data', { ptyId: 'p' as never, data: 5 as never });
    expect(fake.posted).toEqual([{ t: 'evt', name: 'pty.data', payload: { ptyId: 'p', data: 'hi' } }]);
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
