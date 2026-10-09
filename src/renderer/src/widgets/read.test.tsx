import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { loadScenario } from '../../../../test/support/scenario';
import { createWidgetBackend, fixtureLine, WidgetBackendError, type WidgetBackend } from '../../../../test/support/widget-backend';
import { useSessions } from '../stores/sessions';
import { digest, record } from '../../../../test/support/builders';
import { trustState } from '../test-support/setup-intents';
import { readIntoCache, useEngineRead, useReadLoads, WidgetReadPolicyContext, type WidgetReadPolicy } from './read';

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
  useSessions.setState({ engine: new Map(), records: new Map(), digests: new Map() });
  useReadLoads.setState({ loads: new Map() });
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

  // M4: Session info holds its reads while its tab is hidden and repeats them every 30 s while it is shown.
  it('holds the read while not enabled, and repeats it at the interval while enabled', async () => {
    let enabled = false;
    const { result, rerender } = renderHook(() => useEngineRead('session.getSandboxDialog', { appSessionId: ID }, { enabled, refetchIntervalMs: 40 }), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 60));
    expect(reads('session.getSandboxDialog')).toBe(0);
    expect(result.current.state).toBe('loading');
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: { ...backend.status(ID), engineState: 'running' } }));
    await new Promise((r) => setTimeout(r, 10));
    expect(reads('session.getSandboxDialog'), 'a status move while held reads nothing').toBe(0);
    enabled = true;
    rerender();
    await waitFor(() => expect(result.current.state).toBe('ready'));
    await waitFor(() => expect(reads('session.getSandboxDialog')).toBeGreaterThanOrEqual(3));
    enabled = false;
    rerender();
    const held = reads('session.getSandboxDialog');
    await new Promise((r) => setTimeout(r, 100));
    expect(reads('session.getSandboxDialog')).toBe(held);
  });

  // C11 M6, live: /diff opened seconds after a turn that wrote a file showed the cached `0 files`: its read was fresh by
  // age but answered before the turn. A read answered before the session's latest event is read again on open.
  it('reads again on open when the session had events since the cached answer, and not when it had none', async () => {
    const first = renderHook(() => useEngineRead('session.getSandboxDialog', { appSessionId: ID }), { wrapper: wrapper() });
    await waitFor(() => expect(first.result.current.state).toBe('ready'));
    first.unmount();
    const again = renderHook(() => useEngineRead('session.getSandboxDialog', { appSessionId: ID }), { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 20));
    expect(reads('session.getSandboxDialog'), 'nothing moved: the fresh answer serves').toBe(1);
    again.unmount();
    // a turn came and went: the facts MOVES_READS compares are where they were, the event seq is not
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: { ...backend.status(ID), lastEventSeq: backend.status(ID).lastEventSeq + 12 } }));
    renderHook(() => useEngineRead('session.getSandboxDialog', { appSessionId: ID }), { wrapper: wrapper() });
    await waitFor(() => expect(reads('session.getSandboxDialog')).toBe(2));
  });

  it('is dormant, and reads nothing, without a ready process', async () => {
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), process: 'exited' }]]), records: new Map([[ID, record(ID)]]) });
    const { result } = renderHook(() => useEngineRead('session.getSandboxDialog', { appSessionId: ID }), { wrapper: wrapper() });
    expect(result.current.state).toBe('dormant');
    expect(result.current.readAt).toBeNull();
    await new Promise((r) => setTimeout(r, 10));
    expect(reads('session.getSandboxDialog')).toBe(0);
  });

  it('reads once when the process becomes ready after the widget opened', async () => {
    useSessions.setState({ engine: new Map([[ID, { ...backend.status(ID), process: 'initializing' }]]), records: new Map([[ID, record(ID)]]) });
    const { result } = renderHook(() => useEngineRead('session.getSandboxDialog', { appSessionId: ID }), { wrapper: wrapper() });
    expect(result.current.state).toBe('starting'); // P2-A: a launch in flight
    act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: backend.status(ID) }));
    await waitFor(() => expect(result.current.state).toBe('ready'));
    await new Promise((r) => setTimeout(r, 10));
    expect(reads('session.getSandboxDialog')).toBe(1);
  });

  it('a status move while a refetch is in flight joins that refetch: it is never cancelled and asked again', async () => {
    const { result } = renderHook(() => useEngineRead('session.getWorkspaceDiff', { appSessionId: ID }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    const answers: ((value: unknown) => void)[] = [];
    backend.script('session.getWorkspaceDiff', () => new Promise((resolve) => answers.push(resolve)));
    const move = () => {
      backend.emitTurnStarted(ID);
      act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: backend.status(ID) }));
    };
    move(); // the first move refetches
    await waitFor(() => expect(reads('session.getWorkspaceDiff')).toBe(2));
    move(); // the second arrives while that refetch is unanswered
    await new Promise((r) => setTimeout(r, 10));
    expect(reads('session.getWorkspaceDiff')).toBe(2);
    await act(async () => answers.forEach((answer) => answer(fixtureLine(ROOT, 'reads#81'))));
    expect(result.current.state).toBe('ready');
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

  it("keeps the last value when a refetch fails, and says so: a timeout as the engine's silence, a refusal in its words", async () => {
    const { result } = renderHook(() => useEngineRead('session.getWorkspaceDiff', { appSessionId: ID }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.error).toBeNull();
    const off = backend.script('session.getWorkspaceDiff', () => {
      throw new WidgetBackendError({ code: 'timeout', message: 'get_workspace_diff unanswered after 8 s' });
    });
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.error).toBe('The engine did not answer · showing the last value it reported'));
    expect(result.current.state).toBe('ready');
    expect(result.current.data).toMatchObject({ diff: expect.anything() });
    off();
    backend.script('session.getWorkspaceDiff', () => {
      throw new WidgetBackendError({ code: 'internal', message: 'the diff read failed' });
    });
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.error).toBe('the diff read failed · showing the last value it reported'));
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

  // P2-A (2026-10-09; the execution document §5.6): no ready process is dormant, starting or unavailable; only the owner's
  // Load now acquires, and the read follows at ready.
  describe('a session with a record and no ready process', () => {
    const exited = () => ({ ...backend.status(ID), process: 'exited' as const });
    const acquires = () => backend.calls.filter((c) => c.command === 'session.acquire');

    it('keeps the cached answer, dated, and reads nothing: not on a status move, an operation, a refetch or a refresh', async () => {
      useSessions.setState({ records: new Map([[ID, record(ID)]]) });
      const { result } = renderHook(() => useEngineRead('session.mcpStatus', { appSessionId: ID }), { wrapper: wrapper() });
      await waitFor(() => expect(result.current.state).toBe('ready'));
      const readAt = result.current.readAt;
      expect(typeof readAt).toBe('number');
      act(() => useSessions.getState().applyStatus({ appSessionId: ID, status: exited() }));
      expect(result.current.state).toBe('dormant');
      expect(result.current.data).toBeDefined();
      expect(result.current.readAt).toBe(readAt);
      const done = { opId: 'op-1', command: 'session.mcpReconnect' as const, late: false, outcome: { ok: true as const, value: null } };
      act(() => backend.emitOperation({ ...done, appSessionId: ID }));
      act(() => result.current.refetch());
      await act(async () => void (await result.current.refresh()));
      await new Promise((r) => setTimeout(r, 20));
      expect(reads('session.mcpStatus')).toBe(1);
      expect(acquires()).toHaveLength(0);
      expect(result.current.state).toBe('dormant');
    });

    it('Load now acquires once (reason read), says Starting… meanwhile, and reads at ready', async () => {
      useSessions.setState({ engine: new Map([[ID, exited()]]), records: new Map([[ID, record(ID)]]) });
      let answer!: (outcome: unknown) => void;
      backend.script('session.acquire', () => new Promise((resolve) => (answer = resolve)));
      const { result } = renderHook(() => useEngineRead('session.getSandboxDialog', { appSessionId: ID }), { wrapper: wrapper() });
      expect(result.current.state).toBe('dormant');
      let loaded!: Promise<unknown>;
      act(() => void (loaded = result.current.load()));
      expect(result.current.state).toBe('starting');
      expect(acquires().map((c) => c.input)).toEqual([{ appSessionId: ID, reason: 'read' }]);
      await act(async () => {
        useSessions.getState().applyStatus({ appSessionId: ID, status: backend.status(ID) });
        answer({ status: 'ready', appSessionId: ID, launched: true, joined: false });
        await loaded;
      });
      await waitFor(() => expect(result.current.state).toBe('ready'));
      expect(reads('session.getSandboxDialog')).toBe(1);
      expect(acquires()).toHaveLength(1);
    });

    it('a refused Load now is unavailable with its words until the next one', async () => {
      useSessions.setState({ engine: new Map([[ID, exited()]]), records: new Map([[ID, record(ID)]]) });
      backend.script('session.acquire', () => ({ status: 'missing_directory', appSessionId: ID, directory: '/gone' }));
      const { result } = renderHook(() => useEngineRead('session.getSandboxDialog', { appSessionId: ID }), { wrapper: wrapper() });
      await act(async () => void (await result.current.load()));
      expect(result.current.state).toBe('unavailable');
      expect(result.current.error).toBe('Directory not found: /gone');
      backend.script('session.acquire', () => ({ status: 'needs_trust', appSessionId: ID, trust: trustState() }));
      await act(async () => void (await result.current.load()));
      expect(result.current.error).toBe('Trust this folder in the session to continue');
      expect(reads('session.getSandboxDialog')).toBe(0);
    });

    it('a terminal holding it, or an archive, is unavailable in words; a launch in flight is starting', () => {
      const terminal = record(ID, { holder: { kind: 'terminal', pid: 4711 } });
      useSessions.setState({ engine: new Map(), records: new Map([[ID, terminal]]), digests: new Map([[ID, digest(ID, { availability: 'foreign_held' })]]) });
      const { result, rerender } = renderHook(() => useEngineRead('session.getSandboxDialog', { appSessionId: ID }), { wrapper: wrapper() });
      expect(result.current.state).toBe('unavailable');
      expect(result.current.error).toBe('Held by terminal · 4711');
      act(() => useSessions.setState({ records: new Map([[ID, record(ID, { archived: true })]]), digests: new Map([[ID, digest(ID, { availability: 'archived' })]]) }));
      rerender();
      expect(result.current.error).toBe('Archived · unarchive it to continue');
      act(() => useSessions.setState({ records: new Map([[ID, record(ID)]]), digests: new Map([[ID, digest(ID, { availability: 'starting' })]]) }));
      rerender();
      expect(result.current.state).toBe('starting');
      expect(acquires()).toHaveLength(0);
    });
  });
});
