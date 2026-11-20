import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atomicWriteFileSync } from '@shared/fs/atomic-write';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { LayoutFileStore, registerLayoutHandlers, WINDOW_DEBOUNCE_MS } from './store';

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const OTHER = 'OtherMachineRef0000000' as MachineRef;
const panelOf = (id: string, machine = LOCAL) => `panel.${addressOf(machine, id)}` as const;

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

  // UX wave U7, O-16 (Interfaces §G): build F's main reads the whole file into a map and writes the whole map, so a key F
  // never asks for survives its writes; held here on the same code, which F's build shares.
  it('keeps a stored sidebar.hidden, value equal, through a set of another key', () => {
    const hidden = { version: 1, hidden: { [addressOf(LOCAL, 'app-1')]: { at: '2026-11-12T10:00:00.000Z', armedAt: null }, [addressOf(OTHER, 'app-2')]: { at: '2026-11-12T10:00:00.000Z', armedAt: '2026-11-12T10:01:00.000Z' } } };
    writeFileSync(file, JSON.stringify({ 'sidebar.hidden': hidden, regions: { width: 240 } }));
    new LayoutFileStore(file).set('regions', { width: 260 });
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect(written['sidebar.hidden']).toEqual(hidden);
    expect(written.regions).toEqual({ width: 260 });
  });

  it('P5 O2 M2: reports a renderer key set or deleted, never the window key', () => {
    const store = new LayoutFileStore(file);
    const keys: string[] = [];
    const off = store.onChange((key) => void keys.push(key));
    store.set('main.tabs', { version: 2 });
    store.set('window.main', WINDOW);
    store.delete('main.tabs');
    store.delete('main.tabs'); // absent: nothing changed
    off();
    store.set('regions', { width: 240 });
    expect(keys).toEqual(['main.tabs', 'main.tabs']);
    store.flush();
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

// UX wave U6b-5b (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5b-zoom.md, decision 34; finding 7): a key published is
// in the map and in the file together, or in neither. The store is given the file's writer, here one that fails on demand.
describe('a published key', () => {
  const ZOOM = { version: 1, factor: 1.25 };
  const failing = () => {
    const writer = { fails: 0, writes: 0 };
    const write = (target: string, text: string) => {
      writer.writes++;
      if (writer.fails > 0) {
        writer.fails--;
        throw Object.assign(new Error('EIO: i/o error, write'), { code: 'EIO' });
      }
      atomicWriteFileSync(target, text);
    };
    return { writer, write };
  };
  const onDisk = () => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

  it('writes the value with the whole file, and its removal likewise; a removal of an absent key writes nothing', () => {
    const { writer, write } = failing();
    const store = new LayoutFileStore(file, write);
    store.set('regions', { width: 240 });
    store.publish('window.zoom', ZOOM);
    expect(store.get('window.zoom')).toEqual(ZOOM);
    expect(onDisk()).toEqual({ regions: { width: 240 }, 'window.zoom': ZOOM });
    store.publish('window.zoom', null);
    expect(store.get('window.zoom')).toBeNull();
    expect(onDisk()).toEqual({ regions: { width: 240 } });
    const writes = writer.writes;
    store.publish('window.zoom', null);
    expect(writer.writes).toBe(writes);
  });

  it('leaves the map as it was for the key when the write throws, and throws on: a later write of another key carries the old value', () => {
    const { writer, write } = failing();
    const store = new LayoutFileStore(file, write);
    store.publish('window.zoom', ZOOM); // the control: a publish that succeeds is read back from the file
    expect(onDisk()['window.zoom']).toEqual(ZOOM);
    writer.fails = 1;
    expect(() => store.publish('window.zoom', { version: 1, factor: 1.5 })).toThrow(/EIO/);
    expect(store.get('window.zoom')).toEqual(ZOOM);
    store.set('regions', { width: 260 });
    expect(onDisk()).toEqual({ 'window.zoom': ZOOM, regions: { width: 260 } });
    writer.fails = 1;
    expect(() => store.publish('window.zoom', null)).toThrow(/EIO/); // a removal that fails leaves the key
    expect(store.list()).toEqual(['window.zoom', 'regions']);
    store.set('regions', { width: 280 });
    expect(onDisk()['window.zoom']).toEqual(ZOOM);
  });

  it('leaves an absent key absent when its first write throws', () => {
    const { writer, write } = failing();
    const store = new LayoutFileStore(file, write);
    writer.fails = 1;
    expect(() => store.publish('window.zoom', ZOOM)).toThrow(/EIO/);
    expect(store.get('window.zoom')).toBeNull();
    expect(store.list()).toEqual([]);
    store.set('regions', { width: 240 });
    expect(onDisk()).toEqual({ regions: { width: 240 } });
  });

  it('takes a pending window write with it, as a set of a renderer key does', () => {
    vi.useFakeTimers();
    const store = new LayoutFileStore(file);
    store.set('window.main', WINDOW);
    store.publish('window.zoom', ZOOM);
    expect(onDisk()).toEqual({ 'window.main': WINDOW, 'window.zoom': ZOOM });
    const written = readFileSync(file, 'utf8');
    vi.advanceTimersByTime(WINDOW_DEBOUNCE_MS);
    expect(readFileSync(file, 'utf8')).toBe(written);
  });
});

describe('a session’s panel key', () => {
  it('layout.set refuses a panel key of a session main does not know, so a write in flight at removal cannot recreate it', () => {
    const store = new LayoutFileStore(file);
    registerLayoutHandlers(store, (id) => id === 'app-a', LOCAL);
    const set = handlers.get('layout.set')!;
    const panel = { tabs: [], activeTabId: null };
    set({ key: panelOf('app-a'), value: panel });
    expect(() => set({ key: panelOf('app-gone'), value: panel })).toThrow(/no such session/);
    set({ key: 'panel.app-a', value: panel }); // P5 O6 M2: a bare key is the local machine's
    expect(() => set({ key: 'panel.app-gone', value: panel })).toThrow(/no such session/);
    set({ key: panelOf('app-gone', OTHER), value: panel }); // another machine's: its machine reports its removals (M4)
    set({ key: 'panel.pinned', value: [] });
    set({ key: 'regions', value: {} });
    expect(store.list().sort()).toEqual([panelOf('app-a'), panelOf('app-gone', OTHER), 'panel.app-a', 'panel.pinned', 'regions'].sort());
  });

  // P5 O6 M2: the renderer's migration renames a bare panel key to its address, then deletes the bare one
  it('layout.set of null deletes the key, whatever main knows of its session', () => {
    const store = new LayoutFileStore(file);
    registerLayoutHandlers(store, () => false, LOCAL);
    store.set('panel.app-gone', { tabs: [], activeTabId: null });
    store.set('regions', {});
    handlers.get('layout.set')!({ key: 'panel.app-gone', value: null });
    expect(store.list()).toEqual(['regions']);
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')))).toEqual(['regions']);
  });

});

describe('main’s own keys', () => {
  // UX wave U5 (l6-artifacts-20): the last export's folder is main's, as the window's state is
  // UX wave U6b-5b (decision 23): the window's zoom is main's too
  const VALUE = { 'window.main': WINDOW, 'library.exportFolder': { path: '/srv/exports' }, 'window.zoom': { version: 1, factor: 1.25 } } as const;
  it.each(['window.main', 'library.exportFolder', 'window.zoom'] as const)('%s is listed, and never read or written across IPC', (key) => {
    const store = new LayoutFileStore(file);
    registerLayoutHandlers(store, () => true, LOCAL);
    store.set(key, VALUE[key]);
    store.flush();
    expect(handlers.get('layout.list')!(undefined)).toEqual({ keys: [key] });
    expect(() => handlers.get('layout.get')!({ key })).toThrow(`${key} is main's own layout key`);
    for (const value of [{ path: '/elsewhere' }, null]) expect(() => handlers.get('layout.set')!({ key, value })).toThrow(`${key} is main's own layout key`);
    expect(new LayoutFileStore(file).get(key)).toEqual(VALUE[key]);
  });
});
