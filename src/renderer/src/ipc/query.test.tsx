import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { IpcCommandError, QUERY_COMMANDS, useCommand } from './query';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const answer = (result: unknown) => {
  window.maws = { invoke: vi.fn(async () => result), on: vi.fn() } as unknown as MawsBridge;
};

describe('useCommand', () => {
  afterEach(() => {
    delete (window as { maws?: MawsBridge }).maws;
  });

  it('resolves to the validated command output', async () => {
    const state = { settings: { version: 2, keymap: {}, notifications: { enabled: true, sound: false }, theme: 'dark' }, resolvedTheme: 'dark' };
    answer({ ok: true, value: state });
    const { result } = renderHook(() => useCommand('settings.get', undefined), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(state);
    expect(window.maws.invoke).toHaveBeenCalledWith('settings.get', undefined);
  });

  it('fails with an IpcCommandError carrying the IPC error', async () => {
    answer({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is not running' } });
    const { result } = renderHook(() => useCommand('engine.ping', undefined), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(IpcCommandError);
    expect(result.current.error?.error).toEqual({ code: 'host_unavailable', message: 'engine-host is not running' });
  });
});

describe('useCommand is for reads only', () => {
  it('allows exactly the read commands with a value to cache', () => {
    expect([...QUERY_COMMANDS].sort()).toEqual(['engine.hostState', 'engine.ping', 'files.list', 'fs.workflows', 'pty.hostState', 'pty.ping', 'settings.get']); // fs.workflows: C8a; files.list: C8c
  });

  // Compile-time: writes and void-output commands are not queries (checked by `pnpm typecheck`); they go through
  // `ipc.invoke` or a store action. Never called; the bodies only have to typecheck.
  it('refuses writes and void-output commands at the type level', () => {
    const useTypeChecks = () => {
      // @ts-expect-error settings.set changes state: refetching it on focus or remount would repeat the write
      useCommand('settings.set', { theme: 'dark' });
      // @ts-expect-error pty.spawn starts a process
      useCommand('pty.spawn', { cwd: '/', cols: 80, rows: 24 });
      // @ts-expect-error pty.write has a void output, which TanStack Query cannot cache
      useCommand('pty.write', { ptyId: 'p1' as never, data: 'x' });
      useCommand('engine.hostState', undefined);
    };
    expect(useTypeChecks).toBeTypeOf('function');
  });
});
