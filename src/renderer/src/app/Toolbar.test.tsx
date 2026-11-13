// The title bar's project chip (P3-F wave S, F17; the owner's obs 8): the row of the session in front (UX wave U13a, O-31),
// named left of the chrome’s tab strips, out of their crowded row. A click, Enter or Space reveals that row in the sidebar
// and creates nothing.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { newChat, registerSessionCreator } from '../keymap/actions-runtime';
import { projectReveal } from '../sidebar/reveal';
import { useLayout } from '../stores/layout';
import { useMachines } from '../stores/machines';
import { allTabs } from '../stores/layout-model';
import { useShellView } from './shell-view';
import { addressOf } from '@shared/machine/address';
import { machineKey, type OrgKey } from '@shared/machine/org-key';
import { project, remoteRow } from '../../../../test/support/builders';
import { useSessions } from '../stores/sessions';
import { fillStores, pageScenario, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
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

  it('names a machine’s row for a session in no listed project, and none for a chat with no project', () => {
    const bare = at('app-bare' as AppSessionId);
    useSessions.setState({ unstarted: new Map([[bare, { projectId: null, createdAt: '2026-11-12T10:00:00Z' }]]) });
    render(<Toolbar />);
    act(() => useLayout.getState().openSession(idOf('Terminal workflow notes'), { how: 'tab' }));
    expect(chip()!.textContent).toBe('This Mac');
    expect(chip()!.getAttribute('data-toolbar-project')).toBe(machineKey(TEST_MACHINE));
    act(() => useLayout.getState().openSession(bare, { how: 'tab' }));
    expect(chip()).toBeNull();
  });

  // the branch review (finding 4): a lane A listing opened with no record read sits under its listing's row, as lane B's does
  it('names the row of a lane A session in front from its listing, and New chat starts in that row’s folder here', async () => {
    const KEY = 'repo:lane-a-fixture' as OrgKey;
    const LOCAL = at('proj-lane-a' as ProjectId);
    const LISTED = addressOf(OTHER_MACHINE, 'lane-a-1' as AppSessionId);
    useSessions.setState((s) => ({
      projects: new Map(s.projects).set(LOCAL, project(LOCAL, 9, { name: 'lane-a-fixture', org: { key: KEY, name: 'lane-a-fixture', source: 'repository', smnsId: null } })),
      listed: new Map([[LISTED, { ...remoteRow(OTHER_MACHINE, 'eng-lane-a', { lane: 'A', orgKey: KEY, title: 'Remote work' }), appId: LISTED }]]),
    }));
    useMachines.setState({ loaded: new Set([TEST_MACHINE, OTHER_MACHINE]) });
    const asked: (ProjectId | null)[] = [];
    offs.push(registerSessionCreator(async (projectId) => (asked.push(projectId), NEW)));
    render(<Toolbar />);
    act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: LISTED }));
    expect(chip()!.textContent).toBe('lane-a-fixture');
    expect(chip()!.getAttribute('data-toolbar-project')).toBe(KEY);
    await act(async () => void (await newChat()));
    expect(asked).toEqual([LOCAL]);
  });

  it('a click reveals the row in the sidebar, shown, opened and handed to the sidebar, and creates nothing', async () => {
    const user = userEvent.setup();
    const creator = vi.fn(async () => NEW);
    offs.push(registerSessionCreator(creator));
    act(() => useLayout.getState().setSidebar({ collapsed: true, expandedProjects: [] }));
    render(<Toolbar />);
    act(() => useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' }));
    const before = allTabs(useLayout.getState().main).map((t) => t.id);
    const button = within(toolbar()).getByRole('button', { name: PROJECT_CHIP_COPY.reveal('MAWS') });
    expect(button).toBe(chip());
    expect(button.title).toBe('Reveal MAWS in sidebar');
    expect(button.getAttribute('data-toolbar-project')).toBe(MAWS);
    await user.click(button);
    expect(useLayout.getState().regions.sidebar).toMatchObject({ collapsed: false, expandedProjects: [MAWS] });
    expect(useShellView.getState().sidebarOverlay).toBe(true); // where the sidebar steps aside, it opens as the overlay
    expect(projectReveal.getState().pending).toBe(MAWS); // no sidebar mounted here: the reveal waits for its body
    expect(creator).not.toHaveBeenCalled();
    expect(useSessions.getState().unstarted.size).toBe(0);
    expect(allTabs(useLayout.getState().main).map((t) => t.id)).toEqual(before);
  });

  it('Enter and Space on the focused chip reveal the row; it has no menu', async () => {
    const user = userEvent.setup();
    render(<Toolbar />);
    act(() => useLayout.getState().openSession(idOf('Quota reset recovery'), { how: 'tab' }));
    const somersault = at('proj-codex-somersault' as ProjectId);
    act(() => chip()!.focus());
    await user.keyboard('{Enter}');
    expect(projectReveal.getState().pending).toBe(somersault);
    act(() => projectReveal.setState({ pending: null }));
    act(() => useLayout.getState().setSidebar({ collapsed: true, expandedProjects: [] }));
    await user.keyboard(' ');
    expect(projectReveal.getState().pending).toBe(somersault);
    expect(useLayout.getState().regions.sidebar).toMatchObject({ collapsed: false, expandedProjects: [somersault] });
    fireEvent.contextMenu(chip()!);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(useSessions.getState().unstarted.size).toBe(0);
  });
});
