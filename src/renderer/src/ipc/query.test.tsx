import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IpcCommandError, QUERY_COMMANDS, useCommand } from './query';
import { SETTINGS_DEFAULTS_V20 } from '@shared/settings/defaults';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const answer = (result: unknown) => {
  window.maws = { localMachine: TEST_MACHINE, invoke: vi.fn(async () => result), on: vi.fn() } as unknown as typeof window.maws;
};

describe('useCommand', () => {
  afterEach(() => {
    delete (window as { maws?: unknown }).maws;
  });

  it('resolves to the validated command output', async () => {
    const state = { settings: { ...SETTINGS_DEFAULTS_V20, theme: 'dark' }, resolvedTheme: 'dark' };
    answer({ ok: true, value: state });
    const { result } = renderHook(() => useCommand('settings.get', undefined), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(state);
    expect(window.maws.invoke).toHaveBeenCalledWith('settings.get', undefined, TEST_MACHINE);
  });

  it('fails with an IpcCommandError carrying the IPC error', async () => {
    answer({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is not running' } });
    const { result } = renderHook(() => useCommand('engine.ping', undefined), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(IpcCommandError);
    expect(result.current.error?.error).toEqual({ code: 'host_unavailable', message: 'engine-host is not running' });
  });

  // P5 O6 M2 (OX2): a read names its machine; this machine's keeps the key it always had, another's is cached apart
  it('asks the machine its options name, keyed apart from the local machine’s read', async () => {
    answer({ ok: true, value: { settings: SETTINGS_DEFAULTS_V20, resolvedTheme: 'light' } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const own = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const local = renderHook(() => useCommand('settings.get', undefined, undefined, { machine: TEST_MACHINE }), { wrapper: own });
    const other = renderHook(() => useCommand('settings.get', undefined, undefined, { machine: OTHER_MACHINE }), { wrapper: own });
    await waitFor(() => expect(local.result.current.isSuccess && other.result.current.isSuccess).toBe(true));
    expect(window.maws.invoke).toHaveBeenCalledWith('settings.get', undefined, TEST_MACHINE);
    expect(window.maws.invoke).toHaveBeenCalledWith('settings.get', undefined, OTHER_MACHINE);
    expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([['maws', 'settings.get', undefined], ['maws', 'settings.get', undefined, { machine: OTHER_MACHINE }]]);
  });
});

describe('useCommand is for reads only', () => {
  it('allows exactly the read commands with a value to cache', () => {
    const c7 = ['attention.request', 'git.branches', 'git.lsFiles', 'git.worktree.list', 'session.catalog', 'session.getContextUsage', 'session.getMemoryDialog', 'session.getSessionCost', 'session.getUsage', 'session.history.list', 'session.listModels', 'session.listPermissionRules', 'settings.usage']; // C7
    // C11: the widgets', Session info's and the Settings tab's reads (fs.state: its config home, M5), and C10's model catalogue
    const c11 = ['engine.binaryInfo', 'engine.models', 'engine.relayHealth', 'session.exportConversation', 'session.getHooksListing', 'session.getSandboxDialog', 'session.getSettings', 'session.getSkillsDialog', 'session.getStatus', 'session.getWorkspaceDiff', 'session.mcpStatus', 'settings.claudeUsage.status', 'fs.state'];
    const w3 = ['settings.userEngineDefaults']; // W3: an unstarted tab's model chip, the model selector
    const e9 = ['voice.status']; // E9: Settings › Voice (a non-prompting probe)
    const e6 = ['scm.status', 'scm.pr.state']; // E6: the Source control tool's and the push-state row's reads
    const e4a = ['browser.tabs.list', 'browser.history.suggest', 'browser.profiles.list']; // E4a: the browser's tab list, suggestions, profiles
    const e4b = ['browser.import.profiles', 'browser.import.list']; // E4b: the import sheet's picker, the imported records
    const cua90 = ['browser.bookmarks.tree', 'browser.bookmarks.favicons', 'browser.extensions.actions']; // cua #90: the bookmarks bar's tree and icons, the action bar's list
    expect([...QUERY_COMMANDS].sort()).toEqual(['engine.hostState', 'engine.ping', 'fs.workflows', 'pty.hostState', 'pty.ping', 'settings.get', ...c7, ...c11, ...w3, ...e9, ...e6, ...e4a, ...e4b, ...cua90].sort());
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
