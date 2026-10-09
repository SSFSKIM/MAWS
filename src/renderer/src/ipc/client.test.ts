import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { createClient, onCommandRefused } from './client';
import { SETTINGS_DEFAULTS_V12 } from '@shared/settings/defaults';

// A bridge that answers every invoke with `answer` and lets the test deliver raw event payloads.
function fakeBridge(answer: unknown) {
  const listeners = new Map<string, (payload: unknown) => void>();
  const bridge = {
    invoke: vi.fn(async () => answer),
    on: vi.fn((name: string, listener: (payload: unknown) => void) => {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    }),
  };
  return { bridge: bridge as unknown as MawsBridge, deliver: (name: string, payload: unknown) => listeners.get(name)?.(payload) };
}

const LIGHT = { settings: { ...SETTINGS_DEFAULTS_V12, theme: 'light' }, resolvedTheme: 'light' } as const;

describe('renderer ipc client', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns a valid command output', async () => {
    const { bridge } = fakeBridge({ ok: true, value: LIGHT });
    await expect(createClient(() => bridge).invoke('settings.get', undefined)).resolves.toEqual({ ok: true, value: LIGHT });
    expect(bridge.invoke).toHaveBeenCalledWith('settings.get', undefined);
  });

  it('turns an output that fails the command’s schema into invalid_output', async () => {
    const { bridge } = fakeBridge({ ok: true, value: { ...LIGHT, resolvedTheme: 'sepia' } });
    const result = await createClient(() => bridge).invoke('settings.get', undefined);
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_output', issues: [{ path: ['resolvedTheme'] }] } });
  });

  it('turns a malformed result envelope into invalid_output', async () => {
    for (const answer of [undefined, 'LIGHT', { ok: 'yes' }, { ok: false, error: { code: 'wat', message: 'x' } }]) {
      const { bridge } = fakeBridge(answer);
      const result = await createClient(() => bridge).invoke('settings.get', undefined);
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_output' } });
    }
  });

  it('returns a void command’s outcome as ok with an undefined value', async () => {
    const { bridge } = fakeBridge({ ok: true, value: undefined });
    await expect(createClient(() => bridge).invoke('pty.write', { ptyId: 'p1' as never, data: 'x' })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    const { bridge: wrong } = fakeBridge({ ok: true, value: 'surprise' });
    await expect(createClient(() => wrong).invoke('pty.kill', { ptyId: 'p1' as never })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_output' },
    });
  });

  it('passes main’s own errors through', async () => {
    const error = { code: 'invalid_input', message: 'invalid input for settings.set', issues: [{ path: ['theme'] }] };
    const { bridge } = fakeBridge({ ok: false, error });
    await expect(createClient(() => bridge).invoke('settings.set', { theme: 'dark' })).resolves.toEqual({ ok: false, error });
  });

  // E10: what reacts to a refusal app-wide (a launch refused while an incompatible supervisor is waited for).
  it('tells refusal listeners about main’s own errors, until they unsubscribe', async () => {
    const error = { code: 'host_unavailable', message: 'the engine host is not running' };
    const { bridge } = fakeBridge({ ok: false, error });
    const heard = vi.fn();
    const off = onCommandRefused(heard);
    await createClient(() => bridge).invoke('session.start', { appSessionId: 'a' as never, message: null, options: {} as never });
    expect(heard).toHaveBeenCalledExactlyOnceWith('session.start', error);
    off();
    await createClient(() => bridge).invoke('session.start', { appSessionId: 'a' as never, message: null, options: {} as never });
    expect(heard).toHaveBeenCalledOnce();
    const { bridge: fine } = fakeBridge({ ok: true, value: LIGHT });
    const offAgain = onCommandRefused(heard);
    await createClient(() => fine).invoke('settings.get', undefined);
    offAgain();
    expect(heard).toHaveBeenCalledOnce(); // an answer is not a refusal
  });

  it('answers a refused command as refused even when a refusal listener throws, and still tells the others', async () => {
    const error = { code: 'host_unavailable', message: 'the engine host is not running' };
    const { bridge } = fakeBridge({ ok: false, error });
    const failure = new Error('listener broke');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const heard = vi.fn();
    const offBroken = onCommandRefused(() => {
      throw failure;
    });
    const off = onCommandRefused(heard);
    try {
      await expect(createClient(() => bridge).invoke('session.start', { appSessionId: 'a' as never, message: null, options: {} as never })).resolves.toEqual({ ok: false, error });
      expect(heard).toHaveBeenCalledExactlyOnceWith('session.start', error);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('session.start'), failure);
    } finally {
      offBroken();
      off();
    }
  });

  it('delivers a valid event to the listener', () => {
    const { bridge, deliver } = fakeBridge(null);
    const listener = vi.fn();
    createClient(() => bridge).on('settings.changed', listener);
    deliver('settings.changed', LIGHT);
    expect(listener).toHaveBeenCalledExactlyOnceWith(LIGHT);
  });

  it('drops a pty.data event whose data is a number and logs the event name and the issues', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { bridge, deliver } = fakeBridge(null);
    const listener = vi.fn();
    createClient(() => bridge).on('pty.data', listener);
    deliver('pty.data', { ptyId: 'p1', offset: 0, data: 42 });
    expect(listener).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('pty.data'),
      [expect.objectContaining({ path: ['data'] })],
    );
  });

  it('unsubscribes through the bridge', () => {
    const { bridge, deliver } = fakeBridge(null);
    const listener = vi.fn();
    const off = createClient(() => bridge).on('settings.changed', listener);
    off();
    deliver('settings.changed', LIGHT);
    expect(listener).not.toHaveBeenCalled();
  });
});
