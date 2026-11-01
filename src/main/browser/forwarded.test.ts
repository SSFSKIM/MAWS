// P5 O7 M3: a forwarded port's tab over the real tab store (forwarded.ts): its provenance read from the listeners at each
// move of its page, and its forward opened again lazily past a relaunch, a stale answer touching nothing.
import type { WebContents, WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { CommandResult } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { forwardedTabs, type BrowserForwards, type ForwardedTabs } from './forwarded';
import type { TabsFile } from './persist';
import { TabStore } from './tabs';

const S = 'OtherMachineRef0000/App-R' as AppSessionId; // a remote session's key (machines.ts)
const OTHER = 'OtherMachineRef0000' as MachineRef;
const A = { machine: OTHER, port: 5173 };
const B = { machine: OTHER, port: 8000 };
type Answer = CommandResult<'remote.forward.open'>;

const contents = () => ({ loadURL: vi.fn(() => Promise.resolve()), close: () => {}, isDestroyed: () => false });

/** A store and its forwarded tabs over `listeners` (local port → the machine's port); `restored`: a relaunch's tabs.json. */
function world(listeners: Record<number, { machine: MachineRef; port: number }>, restored?: Pick<TabsFile, 'tabs' | 'selected'>) {
  const live = new Map(Object.entries(listeners).map(([port, forward]) => [Number(port), forward]));
  const opens: Array<{ machine: MachineRef; port: number; answer(result: Answer): void }> = [];
  const forwards: BrowserForwards = {
    // an answered open listens from then on, as remote lane B's forwards do
    open: (machine, port) =>
      new Promise((resolve) =>
        opens.push({
          machine,
          port,
          answer: (result) => {
            if (result.ok) live.set(result.value.localPort, { machine, port });
            resolve(result);
          },
        }),
      ),
    listening: (machine, port) => [...live].find(([, f]) => f.machine === machine && f.port === port)?.[0] ?? null,
    at: (localPort) => live.get(localPort) ?? null,
  };
  let forwarded: ForwardedTabs | null = null;
  const store = new TabStore({
    emit: () => {},
    createView: (_tab, adopted?: WebContents) => ({ webContents: adopted ?? contents() }) as unknown as WebContentsView,
    resolvePartition: () => DEFAULT_PARTITION,
    restored,
    schedule: () => {},
    routeLoad: (tab, url) => forwarded!.route(tab, url),
  });
  forwarded = forwardedTabs({ store, forwards, log: () => {} });
  const open = (url: string) => {
    const { tab } = store.open({ appSessionId: S, url, select: true });
    forwarded!.opened(tab);
    return tab.tabId;
  };
  const commit = (tabId: string, url: string) => store.navigationCommitted(tabId, { url, canGoBack: true, canGoForward: false });
  const tab = (tabId: string) => store.require(tabId).tab;
  /** Past a relaunch: tabs.json read back, every listener gone (or `listeners`). */
  const relaunch = (after: Record<number, { machine: MachineRef; port: number }> = {}) => world(after, store.snapshot());
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { store, opens, live, open, commit, tab, relaunch, settle };
}

describe('a forwarded tab’s provenance, read from the listeners at each move of its page', () => {
  it('names the second forward after a navigation from one forward’s page to another’s, and opens that one past a relaunch', async () => {
    const w = world({ 49001: A, 49002: B });
    const id = w.open('http://127.0.0.1:49001/');
    expect(w.tab(id).forward).toEqual({ ...A, localPort: 49001 });
    w.commit(id, 'http://127.0.0.1:49002/b?x=1');
    expect(w.tab(id).forward).toEqual({ ...B, localPort: 49002 });
    const next = w.relaunch();
    next.store.load(id, next.tab(id).url);
    expect(next.opens.map(({ machine, port }) => ({ machine, port }))).toEqual([B]);
    next.opens[0]!.answer({ ok: true, value: { localPort: 50002 } });
    await next.settle();
    expect([next.tab(id).url, next.tab(id).forward]).toEqual(['http://127.0.0.1:50002/b?x=1', { ...B, localPort: 50002 }]);
  });

  it('names none once its page leaves every forward, and past a relaunch loads that page with no forward opened', () => {
    const w = world({ 49001: A });
    const id = w.open('http://127.0.0.1:49001/');
    w.commit(id, 'https://example.com/docs');
    expect(w.tab(id).forward).toBeUndefined();
    w.commit(id, 'http://127.0.0.1:49999/'); // another local port nobody forwards
    expect(w.tab(id).forward).toBeUndefined();
    const next = w.relaunch();
    expect(next.tab(id).forward).toBeUndefined();
    expect(next.store.load(id, next.tab(id).url)).toBe(true);
    expect([next.opens, next.tab(id).url]).toEqual([[], 'http://127.0.0.1:49999/']);
  });

  it('keeps the forward of a page moving within its own listener’s port after that listener went (its link dropped)', () => {
    const w = world({ 49001: A });
    const id = w.open('http://127.0.0.1:49001/');
    w.live.delete(49001);
    w.store.navigatedInPage(id, { url: 'http://127.0.0.1:49001/#route', canGoBack: true, canGoForward: false, loading: false });
    expect(w.tab(id).forward).toEqual({ ...A, localPort: 49001 });
  });

  it('gives a forwarded page’s window.open child its forward, which it opens again past a relaunch', async () => {
    const w = world({ 49001: A });
    const opener = w.open('http://127.0.0.1:49001/');
    const child = w.store.adoptChild(w.store.require(opener), { url: 'http://127.0.0.1:49001/popup', select: false, webContents: contents() as unknown as WebContents });
    expect(child.tab.forward).toEqual({ ...A, localPort: 49001 });
    const next = w.relaunch();
    next.store.load(child.tab.tabId, next.tab(child.tab.tabId).url);
    expect(next.opens.map(({ machine, port }) => ({ machine, port }))).toEqual([A]);
  });
});

describe('a forwarded tab’s forward opened again past a relaunch', () => {
  const restoredAt = () => {
    const w = world({ 49001: A });
    const id = w.open('http://127.0.0.1:49001/app');
    return { next: w.relaunch(), id };
  };

  for (const outcome of ['answered', 'refused'] as const) {
    it(`leaves the page the person moved to while the open was pending alone when the open is ${outcome}`, async () => {
      const { next, id } = restoredAt();
      next.store.load(id, next.tab(id).url);
      expect(next.opens).toHaveLength(1);
      next.store.load(id, 'https://example.com/'); // the person went elsewhere meanwhile
      expect(next.tab(id).url).toBe('https://example.com/');
      next.opens[0]!.answer(outcome === 'answered' ? { ok: true, value: { localPort: 50001 } } : { ok: false, error: { code: 'host_unavailable', message: 'not connected' } });
      await next.settle();
      expect([next.tab(id).url, next.tab(id).failed]).toEqual(['https://example.com/', null]);
      expect(next.opens).toHaveLength(1);
    });
  }

  it('loads the latest page asked on the forward while its open was pending, with one open', async () => {
    const { next, id } = restoredAt();
    next.store.load(id, 'http://127.0.0.1:49001/first');
    next.store.load(id, 'http://127.0.0.1:49001/second?x=1');
    expect(next.opens).toHaveLength(1);
    next.opens[0]!.answer({ ok: true, value: { localPort: 50001 } });
    await next.settle();
    expect(next.tab(id).url).toBe('http://127.0.0.1:50001/second?x=1');
  });
});
