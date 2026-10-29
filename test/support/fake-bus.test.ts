import { describe, expect, it, vi } from 'vitest';
import { HostCommandError } from '@shared/host/runtime';
import { endableClientRef } from '@shared/ipc/client';
import { ipcError } from '@shared/ipc/errors';
import { fakeBus } from './fake-bus';

const APP_ID = '6f2c1d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f';

describe('the fake services bus answers as main’s router does', () => {
  it('validates the input against the registry before any handler runs: a refused input is invalid_input', async () => {
    const bus = fakeBus();
    const handler = vi.fn(() => null);
    bus.register('session.get', handler);
    expect(await bus.invoke('session.get', { appSessionId: 7 })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(handler).not.toHaveBeenCalled();
    expect(await bus.invoke('session.get', { appSessionId: APP_ID })).toEqual({ ok: true, value: null });
  });

  it('hands the handler the asker’s client, and the test’s own when it names one', async () => {
    const bus = fakeBus();
    const clients: string[] = [];
    bus.register('session.get', (_input, { client }) => (clients.push(client.id), null));
    await bus.invoke('session.get', { appSessionId: APP_ID });
    await bus.invoke('session.get', { appSessionId: APP_ID }, endableClientRef('page:2.1'));
    expect(clients).toEqual(['page:1.1', 'page:2.1']);
  });

  it('runs an interceptor before the handler or the owning host, until it is removed', async () => {
    const bus = fakeBus();
    const handler = vi.fn(() => null);
    bus.register('session.get', handler);
    const off = bus.intercept('session.get', () => null);
    await bus.invoke('session.get', { appSessionId: APP_ID });
    expect(handler).not.toHaveBeenCalled();
    off();
    await bus.invoke('session.get', { appSessionId: APP_ID });
    expect(handler).toHaveBeenCalledTimes(1);
    // a host-owned command answers through its interceptor, and host_unavailable with none (no host runs here)
    const answer = { appSessionId: APP_ID, requestId: 'r1', answer: { kind: 'permission', decision: 'allow', scope: 'once' } };
    const offAnswer = bus.intercept('session.answer', () => ({ outcome: 'not_pending' }));
    expect(await bus.invoke('session.answer', answer)).toEqual({ ok: true, value: { outcome: 'not_pending' } });
    offAnswer();
    expect(await bus.invoke('session.answer', answer)).toMatchObject({ ok: false, error: { code: 'host_unavailable' } });
  });

  it('answers a HostCommandError intact, any other throw internal, and a refused output internal', async () => {
    const bus = fakeBus();
    bus.register('session.get', () => {
      throw new HostCommandError(ipcError('timeout', 'the host’s deadline'));
    });
    bus.register('session.list', () => {
      throw new Error('boom');
    });
    bus.register('session.drafts.get', () => ({ not: 'a draft' }) as never);
    expect(await bus.invoke('session.get', { appSessionId: APP_ID })).toEqual({ ok: false, error: { code: 'timeout', message: 'the host’s deadline' } });
    expect(await bus.invoke('session.list', {})).toEqual({ ok: false, error: { code: 'internal', message: 'boom' } });
    expect(await bus.invoke('session.drafts.get', { appSessionId: APP_ID })).toMatchObject({ ok: false, error: { code: 'internal' } });
    // a main handler with none registered is the router's internal "no main handler"
    expect(await bus.invoke('session.projects.list')).toMatchObject({ ok: false, error: { code: 'internal', message: expect.stringContaining('no handler') } });
  });

  it('refuses a name registered twice, or one a host answers', () => {
    const bus = fakeBus();
    bus.register('session.get', () => null);
    expect(() => bus.register('session.get', () => null)).toThrow(/already registered/);
    expect(() => bus.register('session.answer', () => ({ outcome: 'delivered' }))).toThrow(/engine-host/);
  });

  it('emits a payload only once it validated: a tap hears what was sent, and a refused payload is neither sent nor heard', () => {
    const bus = fakeBus();
    const heard: unknown[] = [];
    const off = bus.onEmitted('library.changed', (payload) => heard.push(payload));
    expect(bus.emit('library.changed', { revision: 'one' } as never)).toBe(false);
    expect(heard).toEqual([]);
    expect(bus.emitted).toEqual([]);
    expect(bus.emit('library.changed', { revision: 3 })).toBe(true);
    expect(heard).toEqual([{ revision: 3 }]);
    expect(bus.emitted).toEqual([{ name: 'library.changed', payload: { revision: 3 } }]);
    off();
    bus.emit('library.changed', { revision: 4 });
    expect(heard).toEqual([{ revision: 3 }]);
    expect(bus.emittedOf('library.changed')).toEqual([{ revision: 3 }, { revision: 4 }]);
  });

  it('names what is registered and intercepted', () => {
    const bus = fakeBus();
    bus.register('session.get', () => null);
    const off = bus.intercept('session.answer', () => ({ outcome: 'not_pending' }));
    expect(bus.registered()).toEqual(['session.get']);
    expect(bus.intercepted()).toEqual(['session.answer']);
    off();
    expect(bus.intercepted()).toEqual([]);
  });
});
