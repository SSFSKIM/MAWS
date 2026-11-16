// The viewer's hold on a key in transfer (UX wave U6b-1, docs/doperpowers/plans/2026-11-14-ux-wave-U6b-1-file-beside-
// chat.md, Decision 20b; sequence 11): a held key is out of the 20-entry cap until it is next mounted, or until no tab
// holds it; after either, a prune treats it like any other key.
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_MACHINE } from '../../../../../../test/support/machine';
import { useLayout } from '../../../stores/layout';
import { installDisk } from '../../../test-support/code-disk';
import { A, resetPanelStores } from '../../../test-support/panel';
import { useFiles } from '../files/store';
import { useViewer, VIEWER_ENTRIES_MAX } from './viewer-store';

const path = (i: number) => `/r/f${i}.ts`;
const KEY = (i: number) => `file:${TEST_MACHINE}:${path(i)}`;
const has = (i: number) => useViewer.getState().entries.has(KEY(i));

beforeEach(() => {
  resetPanelStores();
  useViewer.getState().reset();
  useFiles.getState().reset();
  installDisk(Object.fromEntries(Array.from({ length: VIEWER_ENTRIES_MAX + 2 }, (_, i) => [path(i), `${i}\n`])));
});
afterEach(() => useViewer.getState().reset());

// The file in a main tab not in front, mounted once and unmounted: a clean entry the cap may take, the newest used.
function shown(i: number): void {
  act(() => useLayout.getState().openTab({ kind: 'file', path: path(i), line: null, appSessionId: A, machine: TEST_MACHINE }, { activate: false }));
  const off = useViewer.getState().mount(KEY(i), { appSessionId: A, path: path(i), line: null });
  act(off);
}

describe('a held key', () => {
  it('is passed over by the cap until its next mount, after which the cap takes it like any other', () => {
    for (let i = 0; i < VIEWER_ENTRIES_MAX; i++) shown(i); // f0 the least recently used
    act(() => useViewer.getState().holdKey(KEY(0)));
    shown(VIEWER_ENTRIES_MAX); // one past the cap: the least recently used entry not held goes
    expect([has(0), has(1)]).toEqual([true, false]);
    shown(0); // its next mount ends the hold
    for (let i = 2; i <= VIEWER_ENTRIES_MAX; i++) shown(i); // f0 the least recently used again
    shown(VIEWER_ENTRIES_MAX + 1);
    expect(has(0)).toBe(false);
  });

  it('whose destination never mounts ends its hold when no tab holds the key', () => {
    for (let i = 0; i < 3; i++) shown(i);
    act(() => useViewer.getState().holdKey(KEY(0)));
    act(() => useLayout.getState().closeTab(KEY(0), { remember: false }));
    expect(has(0)).toBe(false);
    expect([has(1), has(2)]).toEqual([true, true]);
  });
});
