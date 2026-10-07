import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsPaneShow } from '@shared/ipc/schema/maws';
import { browserInspector } from './inspect';
import type { TabEntry } from './tabs';

const A = 'App-A' as AppSessionId;

function fakeWindow(id: number) {
  const children: unknown[] = [];
  return { id, isDestroyed: () => false, contentView: { children } };
}

function loadedEntry(tabId: string, more: Partial<TabEntry> = {}) {
  const view = { getVisible: () => true, getBounds: () => ({ x: 1, y: 2, width: 300, height: 200 }), webContents: { isDestroyed: () => false } };
  return { tab: { tabId, memoryKiB: null }, view, host: null, placement: null, ...more } as unknown as TabEntry;
}

function setup(entries: TabEntry[]) {
  const emit = vi.fn();
  const store = {
    entry: (tabId: string) => entries.find((e) => e.tab.tabId === tabId),
    all: () => entries,
    loadedCount: () => entries.filter((e) => e.view !== null).length,
  };
  return { inspector: browserInspector({ store, emit }), emit };
}

describe('the e2e seam (E4a Interfaces "Main": globalThis.__maws_browser)', () => {
  it('reads a placed view as it is: shown, its bounds, in its window\'s contentView, and its owning pane', () => {
    const win = fakeWindow(7);
    const entry = loadedEntry('b_000000000001');
    win.contentView.children.push(entry.view);
    Object.assign(entry, { host: win, placement: { paneId: 'p1', surface: 'main', window: win, rect: { x: 1, y: 2, width: 300, height: 200 } } });
    const { inspector } = setup([entry]);
    expect(inspector.tab('b_000000000001')).toEqual({
      visible: true,
      bounds: { x: 1, y: 2, width: 300, height: 200 },
      attached: true,
      windowId: 7,
      owner: { paneId: 'p1', surface: 'main', windowId: 7 },
    });
  });

  it('a tab with no view, an unplaced view, and an unknown tab', () => {
    const win = fakeWindow(3);
    const unplaced = loadedEntry('b_000000000002', { host: win as never }); // left in its window, not a child of it any more
    const suspended = { tab: { tabId: 'b_000000000003', memoryKiB: null }, view: null, host: null, placement: null } as unknown as TabEntry;
    const { inspector } = setup([unplaced, suspended]);
    expect(inspector.tab('b_000000000002')).toMatchObject({ attached: false, windowId: 3, owner: null });
    expect(inspector.tab('b_000000000003')).toEqual({ visible: false, bounds: null, attached: false, windowId: null, owner: null });
    expect(inspector.tab('b_ffffffffffff')).toBeNull();
  });

  it('metrics counts the loaded tabs and those the memory sample has measured', () => {
    const measured = loadedEntry('b_000000000001');
    (measured.tab as { memoryKiB: number | null }).memoryKiB = 120_000;
    const unmeasured = loadedEntry('b_000000000002');
    const suspended = { tab: { tabId: 'b_000000000003', memoryKiB: null }, view: null } as unknown as TabEntry;
    expect(setup([measured, unmeasured, suspended]).inspector.metrics()).toEqual({ loaded: 2, sampled: 1 });
  });

  it('showPane hands the windows a maws.pane.show as the engine host would', () => {
    const { inspector, emit } = setup([]);
    const request: MawsPaneShow = { appSessionId: A, requestId: 'r-1' as never, pane: 'browser', target: 'http://127.0.0.1:1/a.html', line: null };
    inspector.showPane(request);
    expect(emit).toHaveBeenCalledWith('maws.pane.show', request);
  });
});
