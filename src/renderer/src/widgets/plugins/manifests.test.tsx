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
import { usePluginsRead } from './read';

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

// A view carries its marketplace's entry (`marketplaceVersion`, the overlay), which a marketplace's add, update or removal
// changes without moving the installation's `lastUpdated`: a kept view holds only while the listing it was read under is
// the client's latest `marketplaces.list` answer for the cwd (the whole-branch review's regression).
describe('usePluginManifests under the marketplace listing', () => {
  let offered: string;
  let listings: number;
  let changed: Set<(payload: unknown) => void>;
  let hold: { listing: Promise<void> | null; manifest: Promise<void> | null };
  beforeEach(() => {
    offered = '1.0.0';
    listings = 0;
    changed = new Set();
    hold = { listing: null, manifest: null };
    window.maws = {
      invoke: vi.fn(async (command: string, input: { items: ManifestItemRef[] }) => {
        if (command === 'marketplaces.list') {
          listings += 1;
          await hold.listing;
          return { ok: true, value: { marketplaces: [{ name: 'm', source: 'directory', locator: '/m', installLocation: '/m' }] } };
        }
        asked.push(input.items);
        const version = offered; // what the files say when the read starts
        await hold.manifest;
        return { ok: true, value: { manifests: input.items.map((key) => ({ ...answer(key), marketplaceVersion: version })) } };
      }),
      on: (name: string, listener: (payload: unknown) => void) => {
        if (name !== 'plugins.changed') return () => {};
        changed.add(listener);
        return () => void changed.delete(listener);
      },
    } as unknown as MawsBridge;
  });
  // the hook as its callers hold it: beside their own read of the marketplace listing
  const useCaller = (cwd: string, items: readonly ManifestRequest[]) => {
    usePluginsRead('marketplaces.list', cwd);
    return usePluginManifests(cwd, items);
  };
  const fresh = () => {
    const own = new QueryClient();
    return function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={own}>{children}</QueryClientProvider>;
    };
  };
  const P: ManifestRequest = { kind: 'installation', id: 'p@m', scope: 'user', projectPath: null, lastUpdated: '2026-10-01T00:00:00Z' };
  const offeredOf = (manifests: { views: ReadonlyMap<string, PluginManifestView> }) => manifests.views.get(manifestKeyOf(P))?.marketplaceVersion;

  it('reads a kept view again once the listing after a marketplace change answers, showing the kept one meanwhile; a reopen reuses the new one', async () => {
    const wrapper = fresh();
    const hook = renderHook(() => useCaller(CWD, [P]), { wrapper });
    await waitFor(() => expect(offeredOf(hook.result.current)).toBe('1.0.0'));
    expect(asked).toHaveLength(1);
    // Manage marketplaces › Check for updates pulled a newer entry; the installation's lastUpdated stays
    offered = '2.0.0';
    let release!: () => void;
    hold.manifest = new Promise((resolve) => (release = resolve));
    act(() => changed.forEach((listener) => listener({})));
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(listings).toBe(2);
    expect(offeredOf(hook.result.current)).toBe('1.0.0'); // the kept view stays drawn while it is read again
    expect(hook.result.current.loading).toBe(false);
    act(() => release());
    await waitFor(() => expect(offeredOf(hook.result.current)).toBe('2.0.0'));
    hook.unmount();
    // the dialog opened again within the listing's freshness: the view kept under the new listing, nothing asked
    const again = renderHook(() => useCaller(CWD, [{ ...P }]), { wrapper });
    expect(offeredOf(again.result.current)).toBe('2.0.0');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toHaveLength(2);
    again.unmount();
  });

  it('asks for nothing while the listing’s first answer is on its way, then asks once', async () => {
    let release!: () => void;
    hold.listing = new Promise((resolve) => (release = resolve));
    const hook = renderHook(() => useCaller(CWD, [P]), { wrapper: fresh() });
    await waitFor(() => expect(listings).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toEqual([]);
    act(() => release());
    await waitFor(() => expect(offeredOf(hook.result.current)).toBe('1.0.0'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(asked).toHaveLength(1);
    hook.unmount();
  });

  it('a view read again partial replaces the kept one and is not kept', async () => {
    const wrapper = fresh();
    const hook = renderHook(() => useCaller(CWD, [P]), { wrapper });
    await waitFor(() => expect(offeredOf(hook.result.current)).toBe('1.0.0'));
    answer = (key) => view(key, { partial: true });
    offered = '2.0.0';
    act(() => changed.forEach((listener) => listener({})));
    await waitFor(() => expect(hook.result.current.views.get(manifestKeyOf(P))?.partial).toBe(true));
    hook.unmount();
    const again = renderHook(() => useCaller(CWD, [P]), { wrapper });
    await waitFor(() => expect(asked).toHaveLength(3)); // never kept: the next open asks again
    again.unmount();
  });
});

