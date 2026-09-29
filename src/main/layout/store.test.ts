import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { record } from '../../../test/support/builders';
import { SessionReadModel, type ReadModelWriter } from '../sessions/read-model';
import { dropPanelKeysOfRemovedSessions, LayoutFileStore } from './store';

// A disk that fills up on demand: while `diskFull` is set, every write the store makes fails with ENOSPC.
const disk = vi.hoisted(() => ({ full: false }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const writeFileSync: typeof fs.writeFileSync = (...args) => {
    if (disk.full) throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    fs.writeFileSync(...args);
  };
  return { ...fs, default: { ...fs, writeFileSync }, writeFileSync };
});

let dir: string;
let file: string;

beforeEach(() => {
  vi.restoreAllMocks();
  dir = mkdtempSync(join(tmpdir(), 'maws-layout-'));
  file = join(dir, 'layout.json');
});
afterEach(() => {
  disk.full = false;
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const WINDOW = { bounds: { x: 0, y: 0, width: 1280, height: 820 }, maximized: false, fullscreen: false };

describe('layout file store', () => {
  it('starts empty without a file and without writing one', () => {
    const store = new LayoutFileStore(file);
    expect(store.get('regions')).toBeNull();
    expect(store.list()).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('keeps one value per key and survives a restart, through a temporary file and a rename', () => {
    const store = new LayoutFileStore(file);
    store.set('regions', { width: 240 });
    store.set('panel.app-1', { tabs: [], activeTabId: null });
    expect(store.get('regions')).toEqual({ width: 240 });
    expect(store.list().sort()).toEqual(['panel.app-1', 'regions']);
    expect(readdirSync(dir)).toEqual(['layout.json']);
    const reopened = new LayoutFileStore(file);
    expect(reopened.get('panel.app-1')).toEqual({ tabs: [], activeTabId: null });
  });

  it('writes the window key 500 ms after its last change, and at once on flush', () => {
    vi.useFakeTimers();
    const store = new LayoutFileStore(file);
    store.set('window.main', WINDOW);
    store.set('window.main', { ...WINDOW, maximized: true });
    expect(store.get('window.main')).toEqual({ ...WINDOW, maximized: true });
    expect(readdirSync(dir)).toEqual([]);
    vi.advanceTimersByTime(499);
    expect(readdirSync(dir)).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(JSON.parse(readFileSync(file, 'utf8'))['window.main'].maximized).toBe(true);
    store.set('window.main', WINDOW);
    store.flush();
    expect(JSON.parse(readFileSync(file, 'utf8'))['window.main'].maximized).toBe(false);
  });

  it('replaces an unreadable or invalid file by an empty store with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(file, '[1,2');
    expect(new LayoutFileStore(file).list()).toEqual([]);
    writeFileSync(file, '[1,2]');
    expect(new LayoutFileStore(file).list()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('a failed write of the debounced window key or at quit is logged once each and never thrown', () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new LayoutFileStore(file);
    disk.full = true;
    store.set('window.main', WINDOW);
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('ENOSPC');
    store.set('window.main', { ...WINDOW, maximized: true });
    expect(() => store.flush()).not.toThrow(); // will-quit
    expect(error).toHaveBeenCalledTimes(2);
    disk.full = false;
    store.flush(); // the values survived the failures and reach the disk once it has room
    expect(JSON.parse(readFileSync(file, 'utf8'))['window.main'].maximized).toBe(true);
  });

  it('a failed write of a renderer key still reaches the caller, whose router answers it as an error', () => {
    const store = new LayoutFileStore(file);
    disk.full = true;
    expect(() => store.set('regions', { width: 240 })).toThrow(/ENOSPC/);
  });
});

describe('a removed session’s panel key', () => {
  it('leaves layout.json when the read model sees the session removed, and only that key', () => {
    const store = new LayoutFileStore(file);
    const model = new SessionReadModel('index');
    let writer!: ReadModelWriter;
    model.register({ start: (w) => ((writer = w), () => {}) });
    dropPanelKeysOfRemovedSessions(model, store);
    const panel = { tabs: [{ id: 't1', toolId: 'files', pinned: false }], activeTabId: 't1' };
    store.set('panel.app-a', panel);
    store.set('panel.app-b', panel);
    store.set('panel.pinned', []);
    writer.observeRecord(record('app-a'));
    writer.observeRecord(record('app-b'));
    writer.observeRecord(record('app-a', { pinned: true })); // a change is not a removal
    expect(store.get('panel.app-a')).toEqual(panel);

    writer.observeRemoved('app-a' as AppSessionId);
    expect(store.list().sort()).toEqual(['panel.app-b', 'panel.pinned']);
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8'))).sort()).toEqual(['panel.app-b', 'panel.pinned']);
    writer.observeRemoved('app-c' as AppSessionId); // no key of its own: nothing to write
    expect(new LayoutFileStore(file).list().sort()).toEqual(['panel.app-b', 'panel.pinned']);
  });

  it('a failed delete is logged, never thrown into the read model', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new LayoutFileStore(file);
    const model = new SessionReadModel('index');
    let writer!: ReadModelWriter;
    model.register({ start: (w) => ((writer = w), () => {}) });
    dropPanelKeysOfRemovedSessions(model, store);
    store.set('panel.app-a', { tabs: [], activeTabId: null });
    disk.full = true;
    expect(() => writer.observeRemoved('app-a' as AppSessionId)).not.toThrow();
    expect(String(error.mock.calls[0][0])).toContain('panel.app-a');
  });
});
