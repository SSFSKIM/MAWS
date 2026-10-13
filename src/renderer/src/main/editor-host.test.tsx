// P3-G (§D2.3, §D2.4): X32 in a main tab: the body learns its scope from the pane, a registered body gets the header row
// above its content (no region controls), an unregistered one draws nothing new, and the main close path asks the
// registration's closeGuard before the kind's guard.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerShellActions } from '../app/shell-actions';
import { Shell } from '../app/Shell';
import { registerSlot, resetSlots } from '../app/slots';
import { registerCloseGuard, requestCloseTab } from '../keymap/actions-runtime';
import { resetEditorHosts, useEditorHost, useEditorHostScope, type EditorHostScope } from '../panel/editor-host';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';

vi.mock('../app/Diagnostics', () => ({ Diagnostics: () => <section aria-label="Diagnostics">diagnostics</section> }));

const offs: (() => void)[] = [];
const main = () => document.querySelector<HTMLElement>('[data-region="main"]')!;
const mainHeader = () => main().querySelector<HTMLElement>('[data-editor-header]');
const settingsOpen = () => allTabs(useLayout.getState().main).some((t) => t.kind === 'settings');

beforeEach(() => {
  resetShellStores();
  resetEditorHosts();
  fillStores(scenarioFile('nine-sessions'));
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
});
