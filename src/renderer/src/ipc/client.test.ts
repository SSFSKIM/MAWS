import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { createClient } from './client';

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

const LIGHT = { settings: { version: 1, theme: 'light' }, resolvedTheme: 'light' } as const;

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

  it('passes main’s own errors through', async () => {
    const error = { code: 'invalid_input', message: 'invalid input for settings.set', issues: [{ path: ['theme'] }] };
    const { bridge } = fakeBridge({ ok: false, error });
    await expect(createClient(() => bridge).invoke('settings.set', { theme: 'dark' })).resolves.toEqual({ ok: false, error });
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
    deliver('pty.data', { ptyId: 'p1', data: 42 });
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
