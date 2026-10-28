import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PtyId } from '@shared/ipc/schema/pty';
import type { PreloadBridge } from '@shared/ipc/schema';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { createClient, onCommandRefused } from './client';
import { SETTINGS_DEFAULTS_V20 } from '@shared/settings/defaults';
import { record } from '../../../../test/support/builders';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const OTHER = 'OtherMachineRef0000000' as MachineRef;

// A bridge that answers every invoke with `answer` and lets the test deliver raw event payloads, with the machine main
// stamped on them (none: an event from a main that names no machine).
function fakeBridge(answer: unknown) {
  const listeners = new Map<string, (payload: unknown, machine?: MachineRef) => void>();
  const bridge = {
    localMachine: LOCAL,
    invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => answer),
    on: vi.fn((name: string, listener: (payload: unknown, machine?: MachineRef) => void) => {
      listeners.set(name, listener);
      return () => listeners.delete(name);
    }),
  };
  return { bridge: bridge as unknown as PreloadBridge & typeof bridge, deliver: (name: string, payload: unknown, machine?: MachineRef) => listeners.get(name)?.(payload, machine) };
}

const LIGHT = { settings: { ...SETTINGS_DEFAULTS_V20, theme: 'light' }, resolvedTheme: 'light' } as const;

describe('renderer ipc client', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns a valid command output', async () => {
    const { bridge } = fakeBridge({ ok: true, value: LIGHT });
    await expect(createClient(() => bridge).invoke('settings.get', undefined)).resolves.toEqual({ ok: true, value: LIGHT });
    expect(bridge.invoke).toHaveBeenCalledWith('settings.get', undefined, LOCAL);
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
    await expect(createClient(() => bridge).invoke('pty.write', { ptyId: addressOf(LOCAL, 'p1' as PtyId), data: 'x' })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    const { bridge: wrong } = fakeBridge({ ok: true, value: 'surprise' });
    await expect(createClient(() => wrong).invoke('pty.kill', { ptyId: addressOf(LOCAL, 'p1' as PtyId) })).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_output' },
    });
  });

  it('passes main’s own errors through', async () => {
    const error = { code: 'invalid_input', message: 'invalid input for settings.set', issues: [{ path: ['theme'] }] };
    const { bridge } = fakeBridge({ ok: false, error });
    await expect(createClient(() => bridge).invoke('settings.set', { theme: 'dark' }, { machine: LOCAL })).resolves.toEqual({ ok: false, error });
  });

  // E10: what reacts to a refusal app-wide (a launch refused while an incompatible supervisor is waited for).
  it('tells refusal listeners about main’s own errors, until they unsubscribe', async () => {
    const error = { code: 'host_unavailable', message: 'the engine host is not running' };
    const { bridge } = fakeBridge({ ok: false, error });
    const heard = vi.fn();
    const off = onCommandRefused(heard);
    await createClient(() => bridge).invoke('session.start', { appSessionId: addressOf(LOCAL, 'a' as AppSessionId), message: null, options: {} as never });
    expect(heard).toHaveBeenCalledExactlyOnceWith('session.start', error);
    off();
    await createClient(() => bridge).invoke('session.start', { appSessionId: addressOf(LOCAL, 'a' as AppSessionId), message: null, options: {} as never });
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
      await expect(createClient(() => bridge).invoke('session.start', { appSessionId: addressOf(LOCAL, 'a' as AppSessionId), message: null, options: {} as never })).resolves.toEqual({ ok: false, error });
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
    deliver('settings.changed', LIGHT, LOCAL);
    expect(listener).toHaveBeenCalledExactlyOnceWith(LIGHT, { machine: LOCAL });
  });

  // P5 O6 M2 (OX2): the page holds only addresses; the client lowers what goes out, routes it, and lifts what comes back.
  describe('addresses', () => {
    const A = addressOf(LOCAL, 'app-1' as AppSessionId);
    const B = addressOf(OTHER, 'app-2' as AppSessionId);
    const bare = record('app-1');

    it('lowers an addressed command’s ids, sends it to the machine they name, and lifts its output with that machine', async () => {
      const { bridge } = fakeBridge({ ok: true, value: bare });
      const result = await createClient(() => bridge).invoke('session.get', { appSessionId: addressOf(OTHER, 'app-1' as AppSessionId) });
      expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('session.get', { appSessionId: 'app-1' }, OTHER);
      expect(result).toEqual({ ok: true, value: { ...bare, appId: addressOf(OTHER, 'app-1') } });
    });

    it('lifts the local machine’s ids like any other’s', async () => {
      const { bridge } = fakeBridge({ ok: true, value: bare });
      await expect(createClient(() => bridge).invoke('session.get', { appSessionId: A })).resolves.toEqual({ ok: true, value: { ...bare, appId: A } });
      expect(bridge.invoke).toHaveBeenCalledWith('session.get', { appSessionId: 'app-1' }, LOCAL);
    });

    it('sends a path command to the machine its options name', async () => {
      const status = { ok: true, value: { repoRoot: null } };
      const { bridge } = fakeBridge(status);
      const client = createClient(() => bridge);
      await client.invoke('git.watch', { directory: '/work/a' }, { machine: OTHER });
      await client.invoke('git.watch', { directory: '/work/a' }, { machine: LOCAL });
      expect(bridge.invoke.mock.calls).toEqual([
        ['git.watch', { directory: '/work/a' }, OTHER],
        ['git.watch', { directory: '/work/a' }, LOCAL],
      ]);
    });

    // M4: a path is no machine's by itself.
    it('refuses a path command that names no machine, and sends nothing', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { bridge } = fakeBridge({ ok: true, value: { repoRoot: null } });
      const invoke = createClient(() => bridge).invoke as (name: string, input: unknown) => Promise<unknown>; // the type refuses this call
      await expect(invoke('git.watch', { directory: '/work/a' })).resolves.toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('names no machine') } });
      expect(bridge.invoke).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledOnce();
    });

    it('sends a machine-wide command to the local machine unless its options name another', async () => {
      const { bridge } = fakeBridge({ ok: true, value: LIGHT });
      const client = createClient(() => bridge);
      await client.invoke('settings.get', undefined);
      await client.invoke('settings.get', undefined, { machine: OTHER });
      expect(bridge.invoke.mock.calls.map((call) => call[2])).toEqual([LOCAL, OTHER]);
    });

    it('sends a client command with the machine its ids name, which main hands its handler as ctx.target', async () => {
      const { bridge } = fakeBridge({ ok: true, value: undefined });
      await createClient(() => bridge).invoke('attention.viewing', { appSessionId: B });
      expect(bridge.invoke).toHaveBeenCalledExactlyOnceWith('attention.viewing', { appSessionId: 'app-2' }, OTHER);
    });

    it('refuses an input whose addresses name two machines, naming both, and sends nothing', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { bridge } = fakeBridge({ ok: true, value: { started: true } });
      const result = await createClient(() => bridge).invoke('session.launch', { spec: { appSessionId: A, inheritGrantsFrom: B } as never });
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      expect(bridge.invoke).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledOnce();
      expect(String(logged.mock.calls[0]![0])).toMatch(new RegExp(`session\\.launch.*(${LOCAL}.*${OTHER}|${OTHER}.*${LOCAL})`));
    });

    it('refuses an explicit machine that disagrees with the input’s addresses the same way', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { bridge } = fakeBridge({ ok: true, value: bare });
      const result = await createClient(() => bridge).invoke('session.get', { appSessionId: A }, { machine: OTHER });
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      expect(bridge.invoke).not.toHaveBeenCalled();
      expect(String(logged.mock.calls[0]![0])).toContain(LOCAL);
      expect(String(logged.mock.calls[0]![0])).toContain(OTHER);
    });

    it('refuses a bare id where an address belongs, loudly, and sends nothing', async () => {
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { bridge } = fakeBridge({ ok: true, value: bare });
      const result = await createClient(() => bridge).invoke('session.get', { appSessionId: 'app-1' as AppSessionId });
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
      expect(bridge.invoke).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledOnce();
    });

    it('validates an output on its bare form, so an error names the id as main sent it', async () => {
      const { bridge } = fakeBridge({ ok: true, value: { ...bare, pinned: 'yes' } });
      const result = await createClient(() => bridge).invoke('session.get', { appSessionId: A });
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_output', issues: [{ path: ['pinned'] }] } });
    });

    it('lifts an event with the machine it came from, and reads an event that names none as the local machine’s', () => {
      const { bridge, deliver } = fakeBridge(null);
      const listener = vi.fn();
      createClient(() => bridge).on('pty.exit', listener);
      deliver('pty.exit', { ptyId: 'p1', exitCode: 0, signal: null }, OTHER);
      deliver('pty.exit', { ptyId: 'p2', exitCode: 0, signal: null });
      expect(listener.mock.calls).toEqual([
        [{ ptyId: addressOf(OTHER, 'p1'), exitCode: 0, signal: null }, { machine: OTHER }],
        [{ ptyId: addressOf(LOCAL, 'p2'), exitCode: 0, signal: null }, { machine: LOCAL }],
      ]);
    });

    it('exposes the local machine the preload was given', () => {
      const { bridge } = fakeBridge(null);
      expect(createClient(() => bridge).localMachine).toBe(LOCAL);
    });
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
