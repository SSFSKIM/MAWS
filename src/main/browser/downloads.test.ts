import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { Downloads, e2eSaveDir } from './downloads';
import { TabStore, type TabEntry } from './tabs';

const A = 'App-A' as AppSessionId;

class FakeItem extends EventEmitter {
  savePath = '';
  received = 0;
  readonly cancel = vi.fn();
  readonly setSavePath = vi.fn((path: string) => void (this.savePath = path));
  readonly setSaveDialogOptions = vi.fn();
  constructor(
    readonly filename = 'file.bin',
    readonly total = 4096,
  ) {
    super();
  }
  getFilename = () => this.filename;
  getURL = () => `https://a.test/${this.filename}`;
  getTotalBytes = () => this.total;
  getReceivedBytes = () => this.received;
  getSavePath = () => this.savePath;
}

function harness(saveDir: string | null = null) {
  const emitted: { name: EventName; payload: unknown }[] = [];
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload });
  const store = new TabStore({
    emit,
    createView: () => ({ webContents: Object.assign(new EventEmitter(), { loadURL: () => Promise.resolve(), close: () => {}, isDestroyed: () => false }) }) as unknown as WebContentsView,
    resolvePartition: () => DEFAULT_PARTITION,
    schedule: () => {},
  });
  const reveal = vi.fn();
  const downloads = new Downloads({ store, emit, downloadsDir: () => '/Users/owner/Downloads', saveDir, reveal });
  const entry = store.entry(store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab.tabId) as TabEntry;
  const start = (item: FakeItem, wc: unknown = entry.view!.webContents) => downloads.handle(item as never, wc as never);
  return { store, entry, downloads, emitted, reveal, start };
}

describe('Downloads (E4a Design §8; A-31: the human\'s, through a save dialog)', () => {
  it('asks the save dialog with the Downloads folder and the file\'s name, and follows the item to done', () => {
    const h = harness();
    const item = new FakeItem();
    h.start(item);
    expect(item.setSaveDialogOptions).toHaveBeenCalledWith({ defaultPath: '/Users/owner/Downloads/file.bin' });
    expect(item.setSavePath).not.toHaveBeenCalled();
    expect(h.entry.tab.download).toEqual({ name: 'file.bin', state: 'progressing', received: 0, total: 4096, path: null });
    item.received = 1024;
    item.emit('updated', {}, 'progressing');
    expect(h.entry.tab.download).toMatchObject({ state: 'progressing', received: 1024 });
    item.savePath = '/Users/owner/Desktop/renamed.bin';
    item.received = 4096;
    item.emit('done', {}, 'completed');
    expect(h.entry.tab.download).toEqual({ name: 'renamed.bin', state: 'done', received: 4096, total: 4096, path: '/Users/owner/Desktop/renamed.bin' });
    expect(h.downloads.reveal(h.entry.tab.tabId)).toEqual({ revealed: true });
    expect(h.reveal).toHaveBeenCalledWith('/Users/owner/Desktop/renamed.bin');
  });

  it('a cancelled dialog or download reads cancelled, an interruption failed; neither can be revealed', () => {
    const h = harness();
    const cancelled = new FakeItem();
    h.start(cancelled);
    cancelled.emit('done', {}, 'cancelled');
    expect(h.entry.tab.download).toMatchObject({ state: 'cancelled', path: null });
    expect(h.downloads.reveal(h.entry.tab.tabId)).toEqual({ revealed: false });
    const interrupted = new FakeItem('other.bin');
    h.start(interrupted);
    interrupted.emit('done', {}, 'interrupted');
    expect(h.entry.tab.download).toMatchObject({ name: 'other.bin', state: 'failed' });
    expect(h.reveal).not.toHaveBeenCalled();
  });

  it('one download per tab: a second replaces the line and the first\'s events are ignored', () => {
    const h = harness();
    const first = new FakeItem('first.bin');
    const second = new FakeItem('second.bin');
    h.start(first);
    h.start(second);
    first.received = 10;
    first.emit('updated', {}, 'progressing');
    first.emit('done', {}, 'completed');
    expect(h.entry.tab.download).toMatchObject({ name: 'second.bin', state: 'progressing', received: 0 });
  });

  it('refuses a download while the agent holds the page: cancelled, the refusal and the chrome notice sent', () => {
    const h = harness();
    h.store.setControl(h.entry.tab.tabId, 'agent');
    const item = new FakeItem();
    h.start(item);
    expect(item.cancel).toHaveBeenCalled();
    expect(item.setSaveDialogOptions).not.toHaveBeenCalled();
    expect(h.entry.tab.download).toBeNull();
    expect(h.emitted.filter((e) => e.name !== 'browser.tabs.changed' && e.name !== 'browser.control.changed')).toEqual([
      { name: 'browser.download.refused', payload: { tabId: h.entry.tab.tabId, url: 'https://a.test/file.bin', filename: 'file.bin' } },
      { name: 'browser.notice', payload: { appSessionId: A, tabId: h.entry.tab.tabId, kind: 'downloadRefusedAgent' } },
    ]);
  });

  it('a download from no tab of ours is cancelled', () => {
    const h = harness();
    const item = new FakeItem();
    h.start(item, {});
    h.start(new FakeItem(), null);
    expect(item.cancel).toHaveBeenCalled();
  });

  it('under the e2e, MAWS_E2E_SAVE_PATH is the folder the file is saved into, with no dialog', () => {
    expect(e2eSaveDir({ MAWS_E2E: '1', MAWS_E2E_SAVE_PATH: '/tmp/e2e-saves' })).toBe('/tmp/e2e-saves');
    expect(e2eSaveDir({ MAWS_E2E_SAVE_PATH: '/tmp/e2e-saves' })).toBeNull(); // never outside the e2e
    expect(e2eSaveDir({ MAWS_E2E: '1' })).toBeNull();
    const h = harness('/tmp/e2e-saves');
    const item = new FakeItem();
    h.start(item);
    expect(item.setSavePath).toHaveBeenCalledWith('/tmp/e2e-saves/file.bin');
    expect(item.setSaveDialogOptions).not.toHaveBeenCalled();
  });

  it('a download whose tab was closed meanwhile goes on, unrecorded; an unknown tab cannot be revealed', () => {
    const h = harness();
    const item = new FakeItem();
    h.start(item);
    const { tabId } = h.entry.tab;
    h.store.close(tabId);
    expect(() => item.emit('done', {}, 'completed')).not.toThrow();
    expect(() => h.downloads.reveal(tabId)).toThrow('unknown browser tab');
  });
});

// E4c start: the in-process hook beside the IPC emission (E4c Design §6; Decision Log 43)
describe('Downloads.onRefused (E4c)', () => {
  it("tells main's listeners of a refusal, and only of a refusal", () => {
    const h = harness();
    const heard = vi.fn();
    const stop = h.downloads.onRefused(heard);
    h.start(new FakeItem('free.bin'));
    expect(heard).not.toHaveBeenCalled(); // the person's download is theirs
    h.store.setControl(h.entry.tab.tabId, 'agent');
    h.start(new FakeItem());
    expect(heard).toHaveBeenCalledWith({ tabId: h.entry.tab.tabId, url: 'https://a.test/file.bin', filename: 'file.bin' });
    stop();
    h.start(new FakeItem());
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
// E4c end
