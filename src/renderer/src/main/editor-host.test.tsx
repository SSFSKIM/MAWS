// P3-G (§D2.3, §D2.4): X32 in a main tab: the body learns its scope from the pane, a registered body gets the header row
// above its content (no region controls), an unregistered one draws nothing new, and the main close path asks the
// registration's closeGuard before the kind's guard, an inactive tab's included (a registration lives as long as its tab);
// the tab closing or being replaced clears its registration, whatever made it.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerShellActions } from '../app/shell-actions';
import { Shell } from '../app/Shell';
import { registerSlot, resetSlots } from '../app/slots';
import { registerCloseGuard, requestCloseTab } from '../keymap/actions-runtime';
import { editorHostOf, registerEditorHost, resetEditorHosts, useEditorHost, useEditorHostScope, type EditorHostScope } from '../panel/editor-host';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';

vi.mock('../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const offs: (() => void)[] = [];
const main = () => document.querySelector<HTMLElement>('[data-region="main"]')!;
const mainHeader = () => main().querySelector<HTMLElement>('[data-editor-header]');
const settingsOpen = () => allTabs(useLayout.getState().main).some((t) => t.kind === 'settings');
const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;

beforeEach(() => {
  resetShellStores();
  resetEditorHosts();
  fillStores(nine);
  offs.push(registerShellActions({ invoke: vi.fn(async () => ({ ok: true, value: undefined })), on: vi.fn(() => () => {}) } as unknown as MawsBridge));
  window.maws = fakeClient({ 'attention.request': { event: null } }).client;
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
  resetSlots();
  offs.splice(0).forEach((off) => off());
});

describe('X32 in a main tab', () => {
  it('a registered body gets the header row above its content; the guard is asked before the kind’s; unregistered, nothing new', async () => {
    let scope: EditorHostScope | null = null;
    let allow = false;
    let registers = true;
    const kindGuard = vi.fn(async () => true);
    offs.push(registerCloseGuard('settings', kindGuard));
    registerSlot('settingsTab', function SettingsEditor() {
      scope = useEditorHostScope();
      return registers ? <Registered /> : <p>plain settings</p>;
    });
    function Registered() {
      useEditorHost(useEditorHostScope(), { title: 'Preferences', breadcrumb: ['Settings'], saved: 'saved', closeGuard: async () => allow });
      return <p>settings body</p>;
    }

    render(<Shell />);
    act(() => useLayout.getState().openTab({ kind: 'settings', section: null }));
    expect(scope).toEqual({ surface: 'main', tabId: 'settings' });
    const row = mainHeader()!;
    expect(row.querySelector('[data-header-title]')!.textContent).toBe('Preferences');
    expect(row.textContent).toContain('All changes saved');
    expect(within(row).queryByRole('button', { name: /right panel|Float/ }), 'no region controls in a main tab').toBeNull();
    // The row sits above the content, inside the tab panel.
    const panel = within(main()).getByRole('tabpanel');
    expect(panel.contains(row)).toBe(true);
    expect(row.compareDocumentPosition(screen.getByText('settings body')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(() => requestCloseTab('settings'));
    expect(settingsOpen(), 'the registration’s guard keeps the tab').toBe(true);
    expect(kindGuard).not.toHaveBeenCalled();
    allow = true;
    await act(() => requestCloseTab('settings'));
    expect(kindGuard).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(settingsOpen()).toBe(false));

    registers = false;
    act(() => useLayout.getState().openTab({ kind: 'settings', section: null }));
    expect(screen.getByText('plain settings')).toBeTruthy();
    expect(mainHeader(), 'an unregistered main tab draws no header').toBeNull();
  });

  it('Delete on an inactive guarded tab asks its guard: the registration outlives the unmounted body', async () => {
    const user = userEvent.setup();
    let allow = false;
    const kindGuard = vi.fn(async () => true);
    offs.push(registerCloseGuard('settings', kindGuard));
    registerSlot('settingsTab', function SettingsEditor() {
      useEditorHost(useEditorHostScope(), { title: 'Preferences', closeGuard: async () => allow });
      return <p>settings body</p>;
    });

    render(<Shell />);
    act(() => useLayout.getState().openTab({ kind: 'settings', section: null }));
    act(() => useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' }));
    expect(screen.queryByText('settings body'), 'Settings is inactive: its body is unmounted').toBeNull();
    within(main()).getByRole('tab', { name: /Settings/ }).focus();
    await user.keyboard('{Delete}');
    expect(settingsOpen(), 'the inactive tab’s guard vetoes').toBe(true);
    expect(kindGuard).not.toHaveBeenCalled();
    allow = true;
    await user.keyboard('{Delete}');
    await waitFor(() => expect(settingsOpen()).toBe(false));
    expect(editorHostOf({ surface: 'main', tabId: 'settings' }), 'closed, its registration goes').toBeNull();
  });

  it('a tab closing or being replaced clears its registration, a direct registerEditorHost included', async () => {
    render(<Shell />);
    act(() => useLayout.getState().openTab({ kind: 'diagnostics' }));
    act(() => void registerEditorHost({ surface: 'main', tabId: 'diagnostics' }, { title: 'Logs' }));
    expect(mainHeader()?.querySelector('[data-header-title]')?.textContent).toBe('Logs');
    await act(() => requestCloseTab('diagnostics'));
    expect(editorHostOf({ surface: 'main', tabId: 'diagnostics' }), 'closed').toBeNull();
    act(() => useLayout.getState().openTab({ kind: 'diagnostics' }));
    expect(mainHeader(), 'reopened, the tab starts with no registration').toBeNull();

    // A session tab another session replaces (I2's replace in the focused pane).
    const first = idOf('Charter + research');
    act(() => useLayout.getState().openSession(first));
    const scope: EditorHostScope = { surface: 'main', tabId: `session:${first}` };
    act(() => void registerEditorHost(scope, { title: 'Charter notes' }));
    act(() => useLayout.getState().openSession(idOf('Fix sidebar drag')));
    expect(allTabs(useLayout.getState().main).some((t) => t.id === scope.tabId), 'replaced').toBe(false);
    expect(editorHostOf(scope), 'replaced, its registration goes').toBeNull();
  });
});
