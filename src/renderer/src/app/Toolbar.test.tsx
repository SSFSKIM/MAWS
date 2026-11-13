// The title bar's project chip (P3-F wave S, F17; the owner's obs 8): the project of the session in front (U13a), named
// left of the chrome’s tab strips, out of their crowded row. A click is the sidebar's "+" (a new unstarted session tab in that
// project); its context menu reveals the project in the sidebar.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { projectReveal } from '../sidebar/reveal';
import { useLayout } from '../stores/layout';
import { useMachines } from '../stores/machines';
import { activeTab } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { fillStores, pageScenario, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { PROJECT_CHIP_COPY, Toolbar } from './Toolbar';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => pageScenario(nine).sessions.find((r) => r.title.text === title)!.appId; // P5 O6 M2: the page's ids
const MAWS = at('proj-maws' as ProjectId);
const NEW = at('app-new' as AppSessionId);
const offs: (() => void)[] = [];

const toolbar = () => screen.getByRole('banner');
const chip = () => toolbar().querySelector<HTMLElement>('[data-toolbar-project]');

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  useMachines.setState({ loaded: new Set([TEST_MACHINE]) }); // the current project is known once the session's machine has answered
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
});

describe('the title bar’s project chip', () => {
  it('names the project left of the chrome tab strips, outside the drag region; no session in front shows none', () => {
    render(<Toolbar />);
    expect(chip()).toBeNull(); // nothing open: no session in front
    act(() => useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' }));
    expect(chip()!.textContent).toBe('MAWS');
    expect(chip()!.className).toContain('[-webkit-app-region:no-drag]');
    const tabs = toolbar().querySelector<HTMLElement>('[data-chrome-tabs]')!;
    expect(chip()!.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(toolbar()).queryByText('Charter + research')).toBeNull(); // title comes from the shell’s portaled tab strip, never a duplicate title row
    act(() => useLayout.getState().openSession(idOf('Quota reset recovery'), { how: 'tab' }));
    expect(chip()!.textContent).toBe('codex_somersault');
    act(() => useLayout.getState().openTab({ kind: 'diagnostics' }));
    expect(chip()!.textContent).toBe('codex_somersault'); // a page in front changes no project
    act(() => useLayout.setState({ main: LAYOUT_DEFAULTS.main }));
    expect(chip()).toBeNull();
  });

  it('a click opens a new unstarted session tab in that project, as the sidebar’s "+" does', async () => {
    const user = userEvent.setup();
    const creator = vi.fn(async () => NEW);
    offs.push(registerSessionCreator(creator));
    render(<Toolbar />);
    act(() => useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' }));
    const button = within(toolbar()).getByRole('button', { name: PROJECT_CHIP_COPY.newChat('MAWS') });
    expect(button).toBe(chip());
    await user.click(button);
    expect(creator).toHaveBeenCalledWith(MAWS);
    expect(useSessions.getState().unstarted.get(NEW)?.projectId).toBe(MAWS);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: NEW });
  });

  it('its context menu reveals the project in the sidebar: the sidebar shown and the row expanded and focused', async () => {
    const user = userEvent.setup();
    act(() => useLayout.getState().setSidebar({ collapsed: true, expandedProjects: [] }));
    render(<Toolbar />);
    act(() => useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' }));
    fireEvent.contextMenu(chip()!);
    await user.click(await screen.findByRole('menuitem', { name: PROJECT_CHIP_COPY.reveal }));
    expect(useLayout.getState().regions.sidebar).toMatchObject({ collapsed: false, expandedProjects: [MAWS] });
    expect(projectReveal.getState().pending).toBe(MAWS); // no sidebar mounted here: the reveal waits for its body
    expect(useSessions.getState().unstarted.size).toBe(0); // the menu opened no tab
  });

  // P3-F wave S (F17 review 3): the keyboard reaches the reveal, as Enter on the strip's label did, by the menu key
  it('Shift+F10 on the focused chip opens its menu, and Enter on Reveal in sidebar reveals the project', async () => {
    const user = userEvent.setup();
    act(() => useLayout.getState().setSidebar({ collapsed: true, expandedProjects: [] }));
    render(<Toolbar />);
    act(() => useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' }));
    act(() => chip()!.focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    const reveal = await screen.findByRole('menuitem', { name: PROJECT_CHIP_COPY.reveal });
    await waitFor(() => expect(document.activeElement).toBe(reveal)); // opened from the keyboard: its item holds the keyboard
    await user.keyboard('{Enter}');
    expect(useLayout.getState().regions.sidebar).toMatchObject({ collapsed: false, expandedProjects: [MAWS] });
    expect(useSessions.getState().unstarted.size).toBe(0); // the key opened no tab
  });
});
