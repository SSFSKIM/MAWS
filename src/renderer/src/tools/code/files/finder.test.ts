// Go to file's action and the request for the keyboard (UX wave U6b-3b, docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3b-go-to-file.md,
// M1; decisions 10 and 11, R5, sequence S2): `files.goToFile` is registered exactly while it can end with the keyboard in
// the field (a session for the side column, no Settings dialog, no Overview); its handler leaves an open page, shows
// Files, marks the tab it lands in as finding and asks for the keyboard for that tab's field; the request is one at most,
// taken once by the taker it names, replaced by a later one and dropped by the next key or pointer press anywhere.
// Invented paths.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { isActionEnabled, runAction } from '../../../keymap/actions-runtime';
import { registerPanelTool } from '../../../panel/host';
import { surfaceSession } from '../../../panel/surface-model';
import { useLayout } from '../../../stores/layout';
import { fail, installFakeMain, ok } from '../../../test-support/code';
import { A, B, mainShowing, panelOf, resetPanelStores } from '../../../test-support/panel';
import { registerEditor } from '../editor/register';
import { resetKeptOpens } from '../open-file';
import { filesTool } from './FilesTool';
import { canGoToFile, connectGoToFile, goToFile, requestKeyboard, takeKeyboard, useKeyboardRequest, type KeyboardRequest } from './finder';
import { resetTreeState, treeOf, useTreeState } from './tree-state';

const offs: (() => void)[] = [];
const filesOf = (id: typeof A) => (panelOf(id)?.tabs ?? []).filter((tab) => tab.toolId === 'files');
const filter = (tabId: string): KeyboardRequest => ({ into: 'filter', tabId });

beforeEach(() => {
  resetPanelStores();
  resetKeptOpens();
  resetTreeState();
  installFakeMain(async (name) => {
    if (name === 'files.watch' || name === 'files.unwatch' || name === 'layout.set') return ok();
    if (name === 'layout.get') return ok({ value: null });
    return fail(`unexpected ${name}`);
  });
  offs.push(registerPanelTool(filesTool));
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })); // no request held over into the next case
});

describe('canGoToFile (decision 11; R5)', () => {
  it('holds with a session for the side column and neither the Settings dialog nor the Overview open; a page open does not stop it', () => {
    expect(canGoToFile(useLayout.getState())).toBe(true); // the panel stores' reset shows session A
    act(() => useLayout.setState({ main: LAYOUT_DEFAULTS.main }));
    expect(surfaceSession(useLayout.getState())).toBeNull();
    expect(canGoToFile(useLayout.getState())).toBe(false);
    act(() => useLayout.setState({ main: mainShowing(A) }));
    act(() => useLayout.getState().openSettings());
    expect(canGoToFile(useLayout.getState())).toBe(false);
    act(() => useLayout.getState().closeSettings());
    act(() => useLayout.getState().setOverviewOpen(true));
    expect(canGoToFile(useLayout.getState())).toBe(false);
    act(() => useLayout.getState().setOverviewOpen(false));
    act(() => useLayout.getState().openDestination({ kind: 'projects' }));
    expect(canGoToFile(useLayout.getState())).toBe(true);
  });
});

describe('files.goToFile (connectGoToFile)', () => {
  beforeEach(() => offs.push(connectGoToFile()));

  it('is registered exactly while canGoToFile holds, following the layout store', () => {
    expect(isActionEnabled('files.goToFile')).toBe(true);
    act(() => useLayout.setState({ main: LAYOUT_DEFAULTS.main }));
    expect(isActionEnabled('files.goToFile')).toBe(false);
    act(() => useLayout.setState({ main: mainShowing(A) }));
    expect(isActionEnabled('files.goToFile')).toBe(true);
    act(() => useLayout.getState().openSettings());
    expect(isActionEnabled('files.goToFile')).toBe(false);
    act(() => useLayout.getState().closeSettings());
    expect(isActionEnabled('files.goToFile')).toBe(true);
    act(() => useLayout.getState().setOverviewOpen(true));
    expect(isActionEnabled('files.goToFile')).toBe(false);
    act(() => useLayout.getState().setOverviewOpen(false));
    expect(isActionEnabled('files.goToFile')).toBe(true);
    act(() => useLayout.getState().openDestination({ kind: 'projects' }));
    expect(isActionEnabled('files.goToFile')).toBe(true); // a page open: the handler leaves it
  });

  it('with a page open leaves the page, shows the side column’s session’s Files, marks that tab as finding and asks the keyboard for its field', () => {
    act(() => useLayout.getState().setPanel({ collapsed: true }));
    act(() => useLayout.getState().openDestination({ kind: 'projects' }));
    expect(filesOf(A)).toEqual([]);
    act(() => runAction('files.goToFile'));
    expect(useLayout.getState().destination).toBeNull();
    expect(useLayout.getState().regions.panel.collapsed).toBe(false);
    const [tab] = filesOf(A);
    expect(tab).toBeDefined();
    expect(treeOf(useTreeState.getState(), A).finding).toBe(tab.id);
    expect(filesOf(B)).toEqual([]);
    expect(takeKeyboard(filter('files:another'))).toBe(false); // the request names the tab it landed in, and no other
    expect(takeKeyboard(filter(tab.id))).toBe(true);
  });

  it('a second press lands in the same tab and asks again', () => {
    act(() => runAction('files.goToFile'));
    const [tab] = filesOf(A);
    expect(takeKeyboard(filter(tab.id))).toBe(true);
    expect(takeKeyboard(filter(tab.id))).toBe(false); // taken once
    act(() => runAction('files.goToFile'));
    expect(filesOf(A)).toEqual([tab]);
    expect(takeKeyboard(filter(tab.id))).toBe(true);
  });

  it('does nothing when called while it cannot end in the field', () => {
    act(() => useLayout.getState().openSettings());
    act(() => goToFile());
    expect(filesOf(A)).toEqual([]);
    expect(useLayout.getState().settings).not.toBeNull();
  });

  it('is mounted by the editor’s registrations', () => {
    offs.splice(0).forEach((off) => off()); // this suite's own connection and the tool
    expect(isActionEnabled('files.goToFile')).toBe(false);
    const off = registerEditor();
    expect(isActionEnabled('files.goToFile')).toBe(true);
    off();
    expect(isActionEnabled('files.goToFile')).toBe(false);
  });
});

describe('the request for the keyboard (S2)', () => {
  it('is taken once, by the taker it names alone', () => {
    requestKeyboard(filter('files:one'));
    expect(takeKeyboard(filter('files:two'))).toBe(false);
    expect(takeKeyboard({ into: 'file', key: 'files:one' })).toBe(false); // a file's taker is another taker
    expect(takeKeyboard(filter('files:one'))).toBe(true);
    expect(takeKeyboard(filter('files:one'))).toBe(false);
  });

  it('a second request replaces the first', () => {
    requestKeyboard(filter('files:one'));
    requestKeyboard(filter('files:two'));
    expect(takeKeyboard(filter('files:one'))).toBe(false);
    expect(takeKeyboard(filter('files:two'))).toBe(true);
  });

  it.each([
    ['a key pressed', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))],
    ['a pointer pressed', () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))],
  ])('%s anywhere drops it; with nothing pressed between it is taken', (_name, press) => {
    requestKeyboard(filter('files:one'));
    press();
    expect(takeKeyboard(filter('files:one'))).toBe(false);
    requestKeyboard(filter('files:one')); // the control: the same request, nothing pressed
    expect(takeKeyboard(filter('files:one'))).toBe(true);
    requestKeyboard(filter('files:two')); // and a press after a request was taken drops nothing later
    expect(takeKeyboard(filter('files:two'))).toBe(true);
    press();
    requestKeyboard(filter('files:three'));
    expect(takeKeyboard(filter('files:three'))).toBe(true);
  });

  it('tells a drawn taker of a request for it, and of no other', () => {
    const one = renderHook(() => useKeyboardRequest(filter('files:one')));
    const two = renderHook(() => useKeyboardRequest(filter('files:two')));
    const none = renderHook(() => useKeyboardRequest(null));
    const before = [one.result.current, two.result.current, none.result.current];
    act(() => requestKeyboard(filter('files:one')));
    const first = one.result.current;
    expect(first).not.toBe(before[0]);
    expect([two.result.current, none.result.current]).toEqual([before[1], before[2]]);
    act(() => void takeKeyboard(filter('files:one')));
    act(() => requestKeyboard(filter('files:one')));
    expect(one.result.current).not.toBe(first); // a new request for the same taker is told again
    expect(two.result.current).toBe(before[1]);
  });
});
