import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { record } from '../../../test/support/builders';
import { SessionReadModel, type ReadModelWriter } from '../sessions/read-model';
import { dropPanelKeysOfRemovedSessions, LayoutFileStore, PANEL_DROP_DELAY_MS, registerLayoutHandlers } from './store';

const handlers = vi.hoisted(() => new Map<string, (input: unknown) => unknown>());
vi.mock('../ipc/router', () => ({ registerMainHandler: (name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler) }));

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
  beforeEach(() => vi.useFakeTimers());

  it('leaves layout.json once the renderer has heard the removal, and only that key', () => {
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
    expect(store.get('panel.app-a')).toEqual(panel); // the source's tick has not told the renderer yet
    vi.advanceTimersByTime(PANEL_DROP_DELAY_MS);
    expect(store.list().sort()).toEqual(['panel.app-b', 'panel.pinned']);
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8'))).sort()).toEqual(['panel.app-b', 'panel.pinned']);
    writer.observeRemoved('app-c' as AppSessionId); // no key of its own: nothing to write
    vi.advanceTimersByTime(PANEL_DROP_DELAY_MS);
    expect(new LayoutFileStore(file).list().sort()).toEqual(['panel.app-b', 'panel.pinned']);
  });

  it('keeps the key of a session removed and recreated under the same id before the delete falls due', () => {
    const store = new LayoutFileStore(file);
    const model = new SessionReadModel('index');
    let writer!: ReadModelWriter;
    model.register({ start: (w) => ((writer = w), () => {}) });
    const stop = dropPanelKeysOfRemovedSessions(model, store);
    store.set('panel.app-a', { tabs: [], activeTabId: null });
    writer.observeRecord(record('app-a'));
    writer.observeRemoved('app-a' as AppSessionId);
    writer.observeRecord(record('app-a')); // createForLaunch with the caller's id, within one tick
    vi.advanceTimersByTime(PANEL_DROP_DELAY_MS);
    expect(store.get('panel.app-a')).not.toBeNull();
    writer.observeRemoved('app-a' as AppSessionId);
    stop(); // stopping cancels a delete not yet due
    vi.advanceTimersByTime(PANEL_DROP_DELAY_MS);
    expect(store.get('panel.app-a')).not.toBeNull();
  });

  it('layout.set refuses a panel key of a session main does not know, so a write in flight at removal cannot recreate it', () => {
    const store = new LayoutFileStore(file);
    registerLayoutHandlers(store, (id) => id === 'app-a');
    const set = handlers.get('layout.set')!;
    set({ key: 'panel.app-a', value: { tabs: [], activeTabId: null } });
    expect(() => set({ key: 'panel.app-gone', value: { tabs: [], activeTabId: null } })).toThrow(/no such session/);
    set({ key: 'panel.pinned', value: [] });
    set({ key: 'regions', value: {} });
    expect(store.list().sort()).toEqual(['panel.app-a', 'panel.pinned', 'regions']);
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
    writer.observeRemoved('app-a' as AppSessionId);
    expect(() => vi.advanceTimersByTime(PANEL_DROP_DELAY_MS)).not.toThrow();
    expect(String(error.mock.calls[0][0])).toContain('panel.app-a');
  });
});
