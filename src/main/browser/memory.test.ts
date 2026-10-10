import type { WebContentsView } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_TABS_MEMORY_MAX_MIB, DEFAULT_PARTITION } from '@shared/browser/tab';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { MEMORY_SAMPLE_MS, MemorySampler } from './memory';
import { TabStore } from './tabs';

const A = 'App-A' as AppSessionId;
const B = 'App-B' as AppSessionId;
const GIB = 1024 * 1024; // in KiB

function harness() {
  const emitted: { name: EventName; payload: unknown }[] = [];
  let ids = 0;
  let pids = 100;
  let clock = Date.parse('2026-10-06T12:00:00.000Z');
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload });
  const store = new TabStore({
    emit,
    createView: () => {
      const pid = ++pids;
      const webContents = { loadURL: () => Promise.resolve(), close: vi.fn(), isDestroyed: () => false, getOSProcessId: vi.fn(() => pid) };
      return { webContents } as unknown as WebContentsView;
    },
    resolvePartition: () => DEFAULT_PARTITION,
    now: () => clock,
    newTabId: () => `b_${(++ids).toString(16).padStart(12, '0')}`,
    schedule: () => {},
  });
  const workingSets = new Map<number, number>(); // pid → KiB
  const metrics = vi.fn(() => [...workingSets].map(([pid, workingSetSize]) => ({ pid, memory: { workingSetSize } })));
  const sampler = new MemorySampler({ store, emit, metrics });
  // A loaded, idle, unplaced tab (the cap's kind of victim), shown at `shownAt` minutes past noon.
  const loaded = (shownAt: number, appSessionId: AppSessionId = A) => {
    clock += 1000;
    const { tab } = store.open({ appSessionId, url: `https://a.test/${shownAt}`, select: true });
    store.update(tab.tabId, { loading: false, lastShownAt: `2026-10-06T12:${String(shownAt).padStart(2, '0')}:00.000Z` });
    return store.entry(tab.tabId)!;
  };
  const pidOf = (entry: ReturnType<typeof loaded>) => entry.view!.webContents.getOSProcessId();
  const notices = () => emitted.filter((e) => e.name === 'browser.notice').map((e) => e.payload);
  return { store, sampler, metrics, workingSets, loaded, pidOf, notices };
}

describe('MemorySampler: the sample (E4a Design §12)', () => {
  it('writes each loaded tab\'s renderer working set, matched by pid, and null for a renderer the metrics do not list', () => {
    const h = harness();
    const one = h.loaded(1);
    const two = h.loaded(2);
    const gone = h.loaded(3);
    const empty = h.store.open({ appSessionId: A, url: null, select: false }).tab; // no view
    h.workingSets.set(h.pidOf(one), 120_000.4).set(h.pidOf(two), 250_000).set(999, 5_000_000); // 999: another process
    h.sampler.sample();
    expect(h.store.entry(one.tab.tabId)!.tab.memoryKiB).toBe(120_000);
    expect(h.store.entry(two.tab.tabId)!.tab.memoryKiB).toBe(250_000);
    expect(h.store.entry(gone.tab.tabId)!.tab.memoryKiB).toBeNull();
    expect(h.store.entry(empty.tabId)!.tab.memoryKiB).toBeNull();
    h.sampler.stop();
  });
});

describe('MemorySampler: the schedule', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('samples every 15 s while any tab is loaded, and stops once none is', () => {
    const h = harness();
    vi.advanceTimersByTime(MEMORY_SAMPLE_MS * 2);
    expect(h.metrics).not.toHaveBeenCalled(); // nothing loaded: no timer
    const tab = h.loaded(1);
    vi.advanceTimersByTime(MEMORY_SAMPLE_MS - 1);
    expect(h.metrics).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.metrics).toHaveBeenCalledTimes(1);
    h.store.close(tab.tab.tabId);
    vi.advanceTimersByTime(MEMORY_SAMPLE_MS * 3);
    expect(h.metrics).toHaveBeenCalledTimes(1); // the tick that found nothing loaded did not sample, and none followed
    expect(vi.getTimerCount()).toBe(0);
    h.loaded(2);
    vi.advanceTimersByTime(MEMORY_SAMPLE_MS);
    expect(h.metrics).toHaveBeenCalledTimes(2);
    h.sampler.stop();
    expect(vi.getTimerCount()).toBe(0);
    h.loaded(3);
    expect(vi.getTimerCount()).toBe(0); // stopped for good
  });
});

describe('MemorySampler: the soft cap (Design §2, Decision Log 6)', () => {
  it('past the cap, suspends the least recently shown eligible tabs until the sum is within it, telling each tab\'s session', () => {
    const h = harness();
    const oldest = h.loaded(1, B);
    const middle = h.loaded(2);
    const newest = h.loaded(3);
    for (const entry of [oldest, middle, newest]) h.workingSets.set(h.pidOf(entry), 0.8 * GIB);
    expect(0.8 * GIB * 3).toBeGreaterThan(BROWSER_TABS_MEMORY_MAX_MIB * 1024);
    h.sampler.sample();
    expect(oldest.view).toBeNull();
    expect(h.store.entry(oldest.tab.tabId)!.tab).toMatchObject({ suspended: true, memoryKiB: null, url: 'https://a.test/1' });
    expect(middle.view).not.toBeNull();
    expect(newest.view).not.toBeNull();
    expect(h.notices()).toEqual([{ appSessionId: B, tabId: oldest.tab.tabId, kind: 'tabsCap' }]); // no count: the memory cap
  });

  it('cua #90: closes an internal tab (an extension\'s options page) instead of suspending it', () => {
    const h = harness();
    const { tab } = h.store.open({
      appSessionId: A,
      url: 'chrome-extension://nenbjdahllkkbfanbpfmmdacjencdfpg/options.html',
      select: true,
      internal: { kind: 'extension', extensionId: 'nenbjdahllkkbfanbpfmmdacjencdfpg', title: 'Probe · Options' },
    });
    h.store.update(tab.tabId, { loading: false, lastShownAt: '2026-10-06T12:00:00.000Z' });
    const options = h.store.entry(tab.tabId)!;
    const newer = h.loaded(5);
    h.workingSets.set(h.pidOf(options), 1.5 * GIB);
    h.workingSets.set(h.pidOf(newer), 1.5 * GIB);
    h.sampler.sample();
    expect(h.store.entry(tab.tabId)).toBeUndefined();
    expect(newer.view).not.toBeNull();
    expect(h.notices()).toEqual([{ appSessionId: A, tabId: null, kind: 'tabsCap' }]); // the tab is gone: told to its session
  });

  it('suspends as many as it takes, and never a placed, loading, downloading or driven tab', () => {
    const h = harness();
    const placed = h.loaded(1);
    const busy = h.loaded(2);
    const driven = h.loaded(3);
    const downloading = h.loaded(4);
    const first = h.loaded(5);
    const second = h.loaded(6);
    h.store.update(placed.tab.tabId, { placedIn: { paneId: 'p', surface: 'panel' } });
    h.store.update(busy.tab.tabId, { loading: true });
    h.store.setControl(driven.tab.tabId, 'agent');
    h.store.update(downloading.tab.tabId, { download: { name: 'f', state: 'progressing', received: 1, total: 2, path: null } });
    for (const entry of [placed, busy, driven, downloading, first, second]) h.workingSets.set(h.pidOf(entry), 0.5 * GIB);
    h.sampler.sample(); // 3 GiB: two must go, and only two may
    expect([first.view, second.view]).toEqual([null, null]);
    expect([placed, busy, driven, downloading].every((entry) => entry.view !== null)).toBe(true);
    expect(h.notices()).toHaveLength(2);
    h.sampler.sample(); // still 2 GiB: within the cap
    expect(h.notices()).toHaveLength(2);
  });

  it('with nothing eligible, suspends nothing', () => {
    const h = harness();
    const one = h.loaded(1);
    h.store.update(one.tab.tabId, { placedIn: { paneId: 'p', surface: 'main' } });
    h.workingSets.set(h.pidOf(one), 3 * GIB);
    h.sampler.sample();
    expect(one.view).not.toBeNull();
    expect(h.notices()).toEqual([]);
  });

  it('counts a renderer two tabs share once', () => {
    const h = harness();
    const one = h.loaded(1);
    const two = h.loaded(2);
    vi.mocked(two.view!.webContents.getOSProcessId).mockReturnValue(h.pidOf(one));
    h.workingSets.set(h.pidOf(one), 1.5 * GIB);
    h.sampler.sample();
    expect([one.tab.memoryKiB, two.tab.memoryKiB]).toEqual([1.5 * GIB, 1.5 * GIB]);
    expect(h.notices()).toEqual([]); // 1.5 GiB, not 3
  });
});
