import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { ECHO_COMMAND, createEchoStore } from './echo';

// A fake main whose PTY host answers spawn and, on write, streams back what a terminal would: the echoed command
// line first, then the command's output, split across chunks.
function fakeMain(onWrite: (emit: (data: string) => void, emitExit: () => void) => void) {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const send = (name: string, payload: unknown) => listeners.get(name)?.forEach((l) => l(payload));
  const client = {
    invoke: vi.fn(async (name: string) => {
      if (name === 'pty.spawn') {
        send('pty.data', { ptyId: 'p1', data: 'sh-3.2$ ' }); // output may beat the spawn reply
        return { ok: true, value: { ptyId: 'p1', pid: 4242 } };
      }
      if (name === 'pty.write') {
        setTimeout(() =>
          onWrite(
            (data) => send('pty.data', { ptyId: 'p1', data }),
            () => send('pty.exit', { ptyId: 'p1', exitCode: 1, signal: null }),
          ),
        );
        return { ok: true, value: undefined };
      }
      return { ok: false, error: { code: 'unknown_command', message: name } };
    }),
    on: vi.fn((name: string, listener: (payload: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    }),
  };
  return { client: client as unknown as MawsBridge, raw: client, listeners, send };
}

describe('echo test', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('spawns /bin/sh, writes the command and reports the output line with the shell pid', async () => {
    const main = fakeMain((emit) => {
      emit(`printf 'MAWS_ECHO_%s\\n' OK\r\n`);
      emit('MAWS_ECHO');
      emit('_OK\r\nsh-3.2$ ');
    });
    const store = createEchoStore(main.client);
    const run = store.getState().run();
    expect(store.getState().echo).toEqual({ status: 'running' });
    await vi.runAllTimersAsync();
    await run;
    expect(main.raw.invoke).toHaveBeenCalledWith('pty.spawn', expect.objectContaining({ shell: '/bin/sh' }));
    expect(main.raw.invoke).toHaveBeenCalledWith('pty.write', { ptyId: 'p1', data: ECHO_COMMAND });
    expect(store.getState().echo).toEqual({ status: 'ok', line: 'MAWS_ECHO_OK', pid: 4242 });
    expect(main.listeners.get('pty.data')?.size).toBe(0); // stops listening; the shell itself lives on
  });

  it('never takes the terminal’s echo of the command line for its output', () => {
    expect(ECHO_COMMAND).not.toContain('MAWS_ECHO_OK');
  });

  it('fails when the marker does not come back within five seconds', async () => {
    const main = fakeMain((emit) => emit('sh: printf: not found\r\n'));
    const store = createEchoStore(main.client);
    const run = store.getState().run();
    await vi.advanceTimersByTimeAsync(5_000);
    await run;
    expect(store.getState().echo).toMatchObject({ status: 'failed', pid: 4242 });
    expect(JSON.stringify(store.getState().echo)).not.toContain('MAWS_ECHO_OK'); // a failure never reads as success
  });

  it('fails when the shell exits before answering', async () => {
    const main = fakeMain((_emit, exit) => exit());
    const store = createEchoStore(main.client);
    const run = store.getState().run();
    await vi.runAllTimersAsync();
    await run;
    expect(store.getState().echo).toMatchObject({ status: 'failed', error: expect.stringContaining('exited') });
  });

  it('fails with the host’s error when the spawn is refused', async () => {
    const main = fakeMain(() => {});
    main.raw.invoke.mockResolvedValueOnce({ ok: false, error: { code: 'host_unavailable', message: 'pty-host is crashed' } });
    const store = createEchoStore(main.client);
    await store.getState().run();
    expect(store.getState().echo).toEqual({ status: 'failed', error: 'pty-host is crashed' });
    expect(main.listeners.get('pty.data')?.size).toBe(0);
  });
});
