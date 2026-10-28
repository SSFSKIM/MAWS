// The chat panels' lifetime (panel-lifetime.ts; P5 O3-C reader R4): a session's panel keys are written only while the
// spine's view knows the session (a record or an intent), and leave layout.json once it is gone, read through the view
// alone. The cases of the removed `dropPanelKeysOfRemovedSessions` (D17), carried over to the production path.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { record } from '../../../test/support/builders';
import { fakeSpineView, type FakeSpineView } from '../../../test/support/fake-spine-view';
import { intentFor } from '../../../test/support/session-host';
import { LayoutFileStore, PANEL_DROP_DELAY_MS } from '../layout/store';
import { registerChatPanels } from './panel-lifetime';

const handlers = vi.hoisted(() => new Map<string, (input: unknown) => unknown>());
vi.mock('../ipc/router', () => ({ registerMainHandler: (name: string, handler: (input: unknown) => unknown) => void handlers.set(name, handler) }));
const disk = vi.hoisted(() => ({ full: false }));
vi.mock('@shared/fs/atomic-write', async (load) => {
  const real = await load<typeof import('@shared/fs/atomic-write')>();
  return {
    ...real,
    atomicWriteFileSync: (...args: Parameters<typeof real.atomicWriteFileSync>) => {
      if (disk.full) throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
      return real.atomicWriteFileSync(...args);
    },
  };
});

const LOCAL = 'LocalMachineRef0000000' as MachineRef;
const OTHER = 'OtherMachineRef0000000' as MachineRef;
const A = 'app-a' as AppSessionId;
const panelOf = (id: string, machine = LOCAL) => `panel.${addressOf(machine, id)}` as const;
const panel = { tabs: [{ id: 't1', toolId: 'files', pinned: false }], activeTabId: 't1' };

describe('a session’s chat panels', () => {
  let dir: string;
  let file: string;
  let view: FakeSpineView;
  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), 'maws-panels-'));
    file = join(dir, 'layout.json');
    view = fakeSpineView();
    disk.full = false;
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('layout.set writes a panel key only while the view knows the session: a record, or an intent before its first send', () => {
    const store = new LayoutFileStore(file);
    registerChatPanels(store, view, LOCAL);
    const set = handlers.get('layout.set')!;
    expect(() => set({ key: panelOf(A), value: panel })).toThrow(/no such session/);
    view.putIntent(intentFor('app-new'));
    set({ key: panelOf('app-new'), value: panel });
    view.putRecord(record(A));
    set({ key: panelOf(A), value: panel });
    expect(store.list().sort()).toEqual([panelOf(A), panelOf('app-new')].sort());
  });

  it('a removed record’s keys leave layout.json once the renderer has heard it, and only that session’s', () => {
    const store = new LayoutFileStore(file);
    registerChatPanels(store, view, LOCAL);
    store.set(panelOf(A), panel);
    store.set('panel.app-a', panel); // P5 O6 M2: a bare key the renderer has not migrated yet goes too
    store.set(panelOf('app-b'), panel);
    store.set(panelOf(A, OTHER), panel); // another machine's session of the same id stays
    store.set('panel.pinned', []);
    view.putRecord(record(A));
    view.putRecord(record('app-b'));
    view.putRecord(record(A, { pinned: true })); // a change is not a removal
    view.removeRecord(A);
    expect(store.get(panelOf(A))).toEqual(panel); // the source's tick has not told the renderer yet
    vi.advanceTimersByTime(PANEL_DROP_DELAY_MS);
    const kept = [panelOf('app-b'), panelOf(A, OTHER), 'panel.pinned'].sort();
    expect(store.list().sort()).toEqual(kept);
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8'))).sort()).toEqual(kept);
  });

  it('a discarded intent’s keys go too, unless a record took the session over meanwhile', () => {
    const store = new LayoutFileStore(file);
    registerChatPanels(store, view, LOCAL);
    view.putIntent(intentFor('app-new'));
    view.putIntent(intentFor('app-bound'));
    store.set(panelOf('app-new'), panel);
    store.set(panelOf('app-bound'), panel);
    view.removeIntent('app-new' as AppSessionId);
    view.putRecord(record('app-bound')); // its first send bound it: the record takes over from the intent
    view.removeIntent('app-bound' as AppSessionId);
    vi.advanceTimersByTime(PANEL_DROP_DELAY_MS);
    expect(store.list()).toEqual([panelOf('app-bound')]);
  });

  it('keeps the key of a session removed and recreated under the same id before the delete falls due; stopping cancels a delete', () => {
    const store = new LayoutFileStore(file);
    const stop = registerChatPanels(store, view, LOCAL);
    store.set(panelOf(A), { tabs: [], activeTabId: null });
    view.putRecord(record(A));
    view.removeRecord(A);
    view.putRecord(record(A)); // createForLaunch with the caller's id, within one tick
    vi.advanceTimersByTime(PANEL_DROP_DELAY_MS);
    expect(store.get(panelOf(A))).not.toBeNull();
    view.removeRecord(A);
    stop();
    vi.advanceTimersByTime(PANEL_DROP_DELAY_MS);
    expect(store.get(panelOf(A))).not.toBeNull();
    expect(view.listeners()).toBe(0);
  });

  it('a failed delete is logged, never thrown into the view', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = new LayoutFileStore(file);
    registerChatPanels(store, view, LOCAL);
    store.set(panelOf(A), { tabs: [], activeTabId: null });
    view.putRecord(record(A));
    disk.full = true;
    view.removeRecord(A);
    expect(() => vi.advanceTimersByTime(PANEL_DROP_DELAY_MS)).not.toThrow();
    expect(String(error.mock.calls[0][0])).toContain(panelOf(A));
    error.mockRestore();
  });
});
