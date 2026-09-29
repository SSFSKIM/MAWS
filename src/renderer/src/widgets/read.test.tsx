import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { useSessions } from '../stores/sessions';
import { readIntoCache, useEngineRead, WidgetReadPolicyContext, type WidgetReadPolicy } from './read';

const ROOT = join(__dirname, '../../../..');
const ID = 'app-7412a115' as AppSessionId;
let backend: WidgetBackend;
let client: QueryClient;

beforeEach(() => {
  backend = createWidgetBackend({ root: ROOT, statuses: loadScenario(join(ROOT, 'test/fixtures/shell/nine-sessions.json')).engine });
  window.maws = backend.bridge();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useSessions.setState({ engine: new Map([[ID, backend.status(ID)]]) });
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
  useSessions.setState({ engine: new Map() });
});

const wrapper =
  (policy: WidgetReadPolicy = { mode: 'active' }) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <WidgetReadPolicyContext.Provider value={policy}>{children}</WidgetReadPolicyContext.Provider>
    </QueryClientProvider>
  );
const reads = (command: string) => backend.calls.filter((c) => c.command === command).length;

describe('useEngineRead', () => {
  it('reads once over a ready process and answers the engine value', async () => {
    const { result } = renderHook(() => useEngineRead('session.getSandboxDialog', { appSessionId: ID }), { wrapper: wrapper() });
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.data).toMatchObject({ mode: 'disabled', supported: true });
    expect(reads('session.getSandboxDialog')).toBe(1);
  });

  it('is not running, and reads nothing, without a ready process', async () => {
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), process: 'exited' }]]) });
    const { result } = renderHook(() => useEngineRead('session.getSandboxDialog', { appSessionId: ID }), { wrapper: wrapper() });
    expect(result.current.state).toBe('not_running');
    await new Promise((r) => setTimeout(r, 10));
    expect(reads('session.getSandboxDialog')).toBe(0);
  });

  it('reads once when the process becomes ready after the widget opened', async () => {
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), process: 'initializing' }]]) });
    const { result } = renderHook(() => useEngineRead('session.getSandboxDialog', { appSessionId: ID }), { wrapper: wrapper() });
    expect(result.current.state).toBe('not_running');
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: backend.status(ID) }));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    await new Promise((r) => setTimeout(r, 10));
    expect(reads('session.getSandboxDialog')).toBe(1);
  });

  it('refetches when the session status moves, not when an unrelated field changes', async () => {
    const { result } = renderHook(() => useEngineRead('session.getWorkspaceDiff', { appSessionId: ID }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: { ...backend.status(ID), memory: { rssKiB: 1, treeRssKiB: 2, sampledAt: 'x' } } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(reads('session.getWorkspaceDiff')).toBe(1);
    const turnId = backend.emitTurnStarted(ID);
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: backend.status(ID) }));
    await waitFor(() => expect(reads('session.getWorkspaceDiff')).toBe(2));
    expect(turnId).toBeTruthy();
  });

  it("refetches when an operation naming the session completes, and not for another session's", async () => {
    const { result } = renderHook(() => useEngineRead('session.mcpStatus', { appSessionId: ID }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    const done = { opId: 'op-1', command: 'session.mcpReconnect' as const, late: false, outcome: { ok: true as const, value: null } };
    act(() => backend.emitOperation({ ...done, appSessionId: 'app-other' as AppSessionId }));
    await new Promise((r) => setTimeout(r, 10));
    expect(reads('session.mcpStatus')).toBe(1);
    act(() => backend.emitOperation({ ...done, appSessionId: ID }));
    await waitFor(() => expect(reads('session.mcpStatus')).toBe(2));
  });

  it("shows an engine refusal in words, and a timeout as the engine's silence", async () => {
    backend.script('session.getHooksListing', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'get_hooks_listing unanswered after 8 s' });
    });
    backend.script('session.getSettings', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'get_settings is not available on this connection' });
    });
    const hooks = renderHook(() => useEngineRead('session.getHooksListing', { appSessionId: ID }), { wrapper: wrapper() });
    const settings = renderHook(() => useEngineRead('session.getSettings', { appSessionId: ID }), { wrapper: wrapper() });
    await waitFor(() => expect(hooks.result.current.state).toBe('error'));
    await waitFor(() => expect(settings.result.current.state).toBe('error'));
    expect(hooks.result.current.error).toBe('The engine did not answer · get_hooks_listing unanswered after 8 s');
    expect(settings.result.current.error).toBe('get_settings is not available on this connection');
  });

  it('in passive mode issues nothing and renders what the harness read into the cache under its key', async () => {
    const { result } = renderHook(() => useEngineRead('session.getContextUsage', { appSessionId: ID, detail: 'full' }), { wrapper: wrapper({ mode: 'passive' }) });
    await new Promise((r) => setTimeout(r, 10));
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: { ...backend.status(ID), engineState: 'running' } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(reads('session.getContextUsage')).toBe(0);
    expect(result.current.state).toBe('loading');
    await act(() => readIntoCache(client, 'session.getContextUsage', { detail: 'full', appSessionId: ID }));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.data?.totalTokens).toBe(30433);
    expect(reads('session.getContextUsage')).toBe(1);
  });
});
