// The renderer's `plugins.manifest` request (P2-B execution document §5.5): asked for what the caller names, kept for
// the app run only when `read` and complete, read again when an installation's `lastUpdated` moves, and never asked by a
// harness mounting widgets passively.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ManifestItemRef, PluginManifestView } from '@shared/ipc/schema/plugins';
import { WidgetReadPolicyContext } from '../read';
import { manifestKeyOf } from './library';
import { usePluginManifests, type ManifestRequest } from './manifests';

const CWD = '/work/maws';
const view = (key: ManifestItemRef, over: Partial<PluginManifestView> = {}): PluginManifestView => ({
  key,
  state: 'read',
  name: null,
  displayName: null,
  version: null,
  marketplaceVersion: null,
  description: 'from its files',
  author: null,
  license: null,
  keywords: [],
  components: { mcpServers: [], mcpBundles: 0, agents: [], hooks: [], hookModules: 0, monitors: [], lspServers: [], commands: [], skills: [] },
  partial: false,
  problems: [],
  ...over,
});
const A: ManifestRequest = { kind: 'installation', id: 'a@m', scope: 'user', projectPath: null, lastUpdated: '2026-10-01T00:00:00Z' };
const B: ManifestRequest = { kind: 'installation', id: 'b@m', scope: 'user', projectPath: null, lastUpdated: null };
const C: ManifestRequest = { kind: 'installation', id: 'c@m', scope: 'user', projectPath: null, lastUpdated: null };

let asked: ManifestItemRef[][];
let answer: (key: ManifestItemRef) => PluginManifestView;
// how the next call ends: answered, refused by the host, or the bridge's promise rejected
let ending: 'answer' | 'refuse' | 'reject';
beforeEach(() => {
  asked = [];
  answer = (key) => view(key);
  ending = 'answer';
  window.maws = {
    invoke: vi.fn(async (_name: string, input: { items: ManifestItemRef[] }) => {
      asked.push(input.items);
      if (ending === 'reject') throw new Error('the bridge went away');
      if (ending === 'refuse') return { ok: false, error: { code: 'timeout', message: 'plugins.manifest unanswered after 10 s' } };
      return { ok: true, value: { manifests: input.items.map((key) => answer(key)) } };
    }),
    on: () => () => {},
  } as unknown as MawsBridge;
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
});

const client = new QueryClient();
const wrapper = (passive = false) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <WidgetReadPolicyContext.Provider value={{ mode: passive ? 'passive' : 'active' }}>{children}</WidgetReadPolicyContext.Provider>
      </QueryClientProvider>
    );
  };

describe('usePluginManifests', () => {
  it('asks once for what it is given, without the lastUpdated it keys by, and keeps only complete read views', async () => {
    answer = (key) => (key.kind === 'installation' && key.id === 'b@m' ? view(key, { partial: true }) : key.kind === 'installation' && key.id === 'c@m' ? view(key, { state: 'unknown' }) : view(key));
    const first = renderHook(() => usePluginManifests(CWD, [A, B, C]), { wrapper: wrapper() });
    await waitFor(() => expect(first.result.current.views.size).toBe(3));
    expect(first.result.current.loading).toBe(false);
    expect(asked).toEqual([[{ kind: 'installation', id: 'a@m', scope: 'user', projectPath: null }, { kind: 'installation', id: 'b@m', scope: 'user', projectPath: null }, { kind: 'installation', id: 'c@m', scope: 'user', projectPath: null }]]);
    first.unmount();
    // a second mount (the dialog opened again) asks only for what was not kept: the partial and the unknown views
    const second = renderHook(() => usePluginManifests(CWD, [A, B, C]), { wrapper: wrapper() });
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked[1].map((k) => (k.kind === 'installation' ? k.id : ''))).toEqual(['b@m', 'c@m']);
    await waitFor(() => expect(second.result.current.views.get(manifestKeyOf(A))?.description).toBe('from its files'));
    second.unmount();
  });

  it('reads an installation again once its lastUpdated moves (an update)', async () => {
    const items = [{ ...A, id: 'u@m' }];
    const hook = renderHook(({ list }) => usePluginManifests(CWD, list), { wrapper: wrapper(), initialProps: { list: items } });
    await waitFor(() => expect(hook.result.current.views.size).toBe(1));
    const before = asked.length;
    hook.rerender({ list: [{ ...items[0], lastUpdated: '2026-10-09T00:00:00Z' }] });
    await waitFor(() => expect(asked).toHaveLength(before + 1));
  });

  it('asks nothing under the passive policy or without a directory', async () => {
    renderHook(() => usePluginManifests(CWD, [{ ...A, id: 'p@m' }]), { wrapper: wrapper(true) });
    renderHook(() => usePluginManifests(null, [{ ...A, id: 'q@m' }]), { wrapper: wrapper() });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toEqual([]);
  });
  for (const how of ['refuse', 'reject'] as const) {
    it(`a ${how === 'refuse' ? 'refused' : 'rejected'} read settles with its words and a retry, keeps nothing, and the retry reads again`, async () => {
      ending = how;
      const items = [{ ...A, id: `${how}@m` }];
      const hook = renderHook(() => usePluginManifests(CWD, items), { wrapper: wrapper() });
      await waitFor(() => expect(hook.result.current.error).toBe(how === 'refuse' ? 'plugins.manifest unanswered after 10 s' : 'the bridge went away'));
      expect(hook.result.current.loading).toBe(false);
      expect(hook.result.current.views.size).toBe(0);
      ending = 'answer';
      act(() => hook.result.current.retry());
      await waitFor(() => expect(hook.result.current.views.size).toBe(1));
      expect(asked).toHaveLength(2);
      expect(hook.result.current.error).toBeNull();
      hook.unmount();
    });
  }

  it('never keeps a failure: the next open asks again', async () => {
    ending = 'refuse';
    const items = [{ ...A, id: 'again@m' }];
    const first = renderHook(() => usePluginManifests(CWD, items), { wrapper: wrapper() });
    await waitFor(() => expect(first.result.current.error).not.toBeNull());
    first.unmount();
    ending = 'answer';
    const second = renderHook(() => usePluginManifests(CWD, items), { wrapper: wrapper() });
    await waitFor(() => expect(second.result.current.views.size).toBe(1));
    expect(asked).toHaveLength(2);
    expect(second.result.current.error).toBeNull();
    second.unmount();
  });
});
