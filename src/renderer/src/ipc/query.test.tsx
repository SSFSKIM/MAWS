import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { IpcCommandError, useCommand } from './query';

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
    const state = { settings: { version: 1, theme: 'dark' }, resolvedTheme: 'dark' };
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
