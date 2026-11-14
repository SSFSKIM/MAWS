import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REL } from '../test-support/relative-time';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { ProjectRecordSchema, type PreloadBridge, type ProjectRecord } from '@shared/ipc/schema';
import { SessionRecordSchema, type SessionRecord } from '@shared/graph/session';
import { addressOf, compileAddressing } from '@shared/machine/address';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { machineKey, type OrgKey } from '@shared/machine/org-key';
import type { MachineState } from '@shared/ipc/schema/machines'; // the UX wave, U9
import { REMOTE_ACT_PENDING_MS } from '@shared/machine/remote-pending'; // the UX wave, U9
import { SESSION_ACTS_CAPABILITY } from '@shared/ipc/remote-unavailable'; // the UX wave, U9 (M4)
import { useMachines } from '../stores/machines';
import { registerSessionAction } from '../app/session-actions';
import { registerEmptyChats, registerSessionCreator } from '../keymap/actions-runtime';
import { closeDialog, useDialogs } from '../sessions/dialogs';
import { resetRemoteSpawn, spawnTargetOf } from '../sessions/remote-spawn'; // the project registry's M11
import { SessionDialogs } from '../sessions/SessionDialogs';
import { Toolbar } from '../app/Toolbar';
import { digest, item, project, record, remoteRow, status } from '../../../../test/support/builders';
import { registerRemoteOpener } from '../sessions/remote-openers'; // P5 O8 M2
import { registerGatewayActions } from '../gateway/actions'; // UX wave U7b: the gear's real handler
import { useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { activeTab, currentSet } from '../stores/layout-model';
import { useSessions, type ListedSession } from '../stores/sessions';
import { usePeople } from '../stores/people'; // P5 O8 M5
import { HIDDEN_KEY, useHidden } from '../stores/hidden'; // UX wave U7, O-16
import { connectRemoteReadMarks, resetRemoteReadMarks } from '../lane-b/read-marks'; // P5 O7 M2
import { fillStores, pageScenario, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { formatAge, type ProjectKey } from './derive';
import { registerProjectAction } from './project-actions';
import { useResumeChooser } from '../resume/host'; // P2-D
import { clearPreviewCache } from '../resume/preview'; // P2-D
import { revealProject } from './reveal';
import { Sidebar } from './Sidebar';
import { formatClock } from '@shared/app/date-format'; // L129
import { togglePalette, usePalette } from '../palette/CommandPalette';

// P5 O6 M2: a scenario file is main's (bare ids), which `fillStores` and the fake `window.maws` take; the page holds it
// lifted (`page`), so a test finds a store's, the layout's or the DOM's id through `idOf` or `at`, and main's through
// `bareIdOf`
const nine = scenarioFile('nine-sessions');
const page = pageScenario(nine);
const idOf = (title: string) => page.sessions.find((r) => r.title.text === title)!.appId;
const bareIdOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const recordOnPage = (record: SessionRecord) => compileAddressing(SessionRecordSchema).lift(record, TEST_MACHINE) as SessionRecord;
const recordAsMain = (record: SessionRecord) => compileAddressing(SessionRecordSchema).lower(record).value;
const projectOnPage = (project: ProjectRecord) => compileAddressing(ProjectRecordSchema).lift(project, TEST_MACHINE) as ProjectRecord;
const pageItem = (...args: Parameters<typeof item>) => { const bare = item(...args); return { ...bare, id: at(bare.id), appSessionId: at(bare.appSessionId) }; };
const offs: (() => void)[] = [];

const projectsTree = () => screen.getByRole('tree', { name: 'Projects' });
const row = (title: string) => screen.getByRole('treeitem', { name: title });
const label = (t: HTMLElement) => t.getAttribute('aria-label');
const projectRows = () => within(projectsTree()).getAllByRole('treeitem').filter((t) => t.dataset.kind === 'project').map(label);
const sessionRows = (el: HTMLElement) =>
  within(el)
    .queryAllByRole('treeitem')
    .filter((t) => t.dataset.kind === 'session')
    .map(label);
const expand = (...keys: string[]) => act(() => useLayout.getState().setSidebar({ expandedProjects: keys.map((key) => (key === 'other' ? machineKey(TEST_MACHINE) : at(key))) as ProjectKey[] })); // bare keys, as the scenario names them
const expanded = () => useLayout.getState().regions.sidebar.expandedProjects;
const toggle = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(within(row(name)).getAllByText(name)[0]);

beforeEach(() => {
  resetShellStores();
});
afterEach(() => {
  cleanup();
  closeDialog();
  useResumeChooser.setState({ open: null }); // P2-D
  offs.splice(0).forEach((off) => off());
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('sidebar destination search', () => {
  it('filters locally, carries the query on Enter or the palette accelerator, and clears on Escape', async () => {
    fillStores(nine);
    render(<Sidebar />);
    const field = screen.getByRole('searchbox', { name: 'Search projects and sessions' });
    await userEvent.type(field, 'Workstation north star');
    expect(projectRows()).toEqual(['MAWS']);
    usePalette.setState({ open: false, query: '', scope: 'sessions' });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(usePalette.getState().open).toBe(false);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(usePalette.getState()).toMatchObject({ open: true, query: 'Workstation north star', scope: 'all' });
    usePalette.setState({ open: false, query: '', scope: 'all' });
    act(() => { field.focus(); togglePalette(); });
    expect(usePalette.getState()).toMatchObject({ open: true, query: 'Workstation north star', scope: 'all' });
    fireEvent.keyDown(field, { key: 'Escape' });
    expect((field as HTMLInputElement).value).toBe('');
    usePalette.setState({ open: false, query: '', scope: 'all' });
  });
});

it('keeps conversation search beside the input and keyboard-reachable with all 785 matching sessions listed', async () => {
  const chosen = project('chosen', 0);
  const sessions = Array.from({ length: 785 }, (_, index) => record(`test ${index + 1}`, { projectId: chosen.id }));
  fillStores({ projects: [chosen], sessions, digests: [], attention: [], engine: [], timeline: [] });
  render(<Sidebar />);
  const field = screen.getByRole('searchbox', { name: 'Search projects and sessions' });
  act(() => field.focus());
  fireEvent.change(field, { target: { value: 'test' } });
  const chosenRow = row('chosen');
  expect(sessionRows(chosenRow)).toHaveLength(785);
  // The count belongs to the header: a label query over all 785 rows needlessly traverses every descendant's text.
  const header = chosenRow.querySelector<HTMLElement>('[data-project-line]')!;
  expect(within(header).getByLabelText('785 matching sessions')).toBeTruthy();
  const search = within(screen.getByRole('navigation', { name: 'App destinations' })).getByRole('button', { name: 'Search in conversations for ‘test’' });
  await userEvent.tab();
  expect(document.activeElement).toBe(search);
  await userEvent.keyboard('{Enter}');
  expect(usePalette.getState()).toMatchObject({ open: true, query: 'test', scope: 'sessions' });
  usePalette.setState({ open: false, query: '', scope: 'all' });
});

describe('sidebar action stability', () => {
  const alpha = project('alpha', 0);
  const beta = project('beta', 1);
  const first = record('first', { projectId: alpha.id, updatedAt: '2026-10-24T10:00:00Z' });
  const second = record('second', { projectId: alpha.id, updatedAt: '2026-10-24T09:00:00Z' });
  const elsewhere = record('elsewhere', { projectId: beta.id, updatedAt: '2026-10-24T08:00:00Z' });
  const start = () => {
    fillStores({ projects: [alpha, beta], sessions: [first, second, elsewhere], digests: [], attention: [], engine: [], timeline: [] });
    expand(alpha.id);
    return render(<><Sidebar /><button>Outside</button></>);
  };
  const working = (id: AppSessionId) => act(() => useSessions.getState().applyDigest(digest(at(id), { phase: 'working', turnStartedAt: id === elsewhere.appId ? '2026-10-24T13:00:00Z' : '2026-10-24T12:00:00Z' }), TEST_MACHINE));

  it.each(['pointer', 'keyboard'] as const)('holds both project and session ranks for the %s, while statuses stay live, then applies the latest ranks on leaving', (input) => {
    start();
    const tree = screen.getByTestId('sidebar-tree');
    if (input === 'pointer') fireEvent.pointerEnter(tree);
    else act(() => row('first').focus());
    working(second.appId);
    working(elsewhere.appId);
    expect(projectRows()).toEqual(['alpha', 'beta']);
    expect(sessionRows(row('alpha'))).toEqual(['first', 'second']);
    expect(within(row('second')).getByRole('img', { name: 'Working' })).toBeTruthy();
    if (input === 'pointer') fireEvent.pointerLeave(tree);
    else act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    expect(projectRows()).toEqual(['beta', 'alpha']);
    expect(sessionRows(row('alpha'))).toEqual(['second', 'first']);
  });

  // UX wave U7, O-16 (M3, decision 5; the review's finding): a Hide settles the order at once, and only then
  it('a Hide settles the order at once, and a later live update is held again until the person leaves', async () => {
    window.maws = fakeClient({ 'layout.get': { value: null }, 'layout.set': undefined }).client as unknown as PreloadBridge;
    const third = record('third', { projectId: alpha.id, updatedAt: '2026-10-24T08:30:00Z' });
    fillStores({ projects: [alpha, beta], sessions: [first, second, third, elsewhere], digests: [], attention: [], engine: [], timeline: [] });
    expand(alpha.id);
    render(<><Sidebar /><button>Outside</button></>);
    const tree = screen.getByTestId('sidebar-tree');
    fireEvent.pointerEnter(tree);
    fireEvent.contextMenu(row('third'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(sessionRows(row('alpha'))).toEqual(['first', 'second']);
    working(second.appId); // no lead changed with the Hide: this is the first change of rank since
    expect(sessionRows(row('alpha'))).toEqual(['first', 'second']);
    fireEvent.pointerLeave(tree);
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    await waitFor(() => expect(sessionRows(row('alpha'))).toEqual(['second', 'first']));
  });

  // The review's finding (round 3): the Hidden list's order, by newest activity, is held like every other row's
  it('holds the order of an open Hidden list while a row’s activity changes, then applies it on leaving', async () => {
    const hiddenAt = '2026-10-24T11:00:00Z';
    window.maws = fakeClient({ 'layout.get': { value: { version: 1, hidden: { [at(first.appId)]: { at: hiddenAt, armedAt: null }, [at(second.appId)]: { at: hiddenAt, armedAt: null } } } }, 'layout.set': undefined }).client as unknown as PreloadBridge;
    await act(() => useHidden.getState().load());
    start();
    const tree = screen.getByTestId('sidebar-tree');
    fireEvent.pointerEnter(tree);
    fireEvent.click(within(row('alpha')).getByRole('treeitem', { name: /^Hidden, / }));
    expect(sessionRows(row('alpha'))).toEqual(['first', 'second']);
    working(second.appId);
    expect(sessionRows(row('alpha'))).toEqual(['first', 'second']);
    fireEvent.pointerLeave(tree);
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    expect(sessionRows(row('alpha'))).toEqual(['second', 'first']);
  });

  it('keeps ranks held when the pointer leaves for the project context menu', async () => {
    start();
    const tree = screen.getByTestId('sidebar-tree');
    fireEvent.pointerEnter(tree);
    fireEvent.contextMenu(row('alpha'));
    fireEvent.pointerLeave(tree);
    working(elsewhere.appId);
    expect(projectRows()).toEqual(['alpha', 'beta']);
    await screen.findByRole('menu');
    await userEvent.click(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => expect(projectRows()).toEqual(['beta', 'alpha']));
  });

  it.each(['expand', 'collapse'] as const)('holds the project under the pointer while its folder icon changes on %s', (action) => {
    start();
    if (action === 'expand') expand();
    const outside = screen.getByRole('button', { name: 'Outside' });
    act(() => outside.focus());
    const project = row('alpha');
    const line = project.querySelector<HTMLElement>('[data-project-line]')!;
    const icon = line.querySelector('svg path')!;
    fireEvent.pointerOver(icon);
    working(elsewhere.appId);
    expect(projectRows()).toEqual(['alpha', 'beta']);
    fireEvent.click(icon);
    expect(project.getAttribute('aria-expanded')).toBe(action === 'expand' ? 'true' : 'false');
    expect(document.activeElement).toBe(outside);
    expect(projectRows()).toEqual(['alpha', 'beta']);
    fireEvent.pointerLeave(line);
    expect(projectRows()).toEqual(['beta', 'alpha']);
  });

  it.each(['portal', 'trigger'] as const)('ends only removed pointer ownership when a hover card closes (pointer on %s)', async (pointer) => {
    start();
    const user = userEvent.setup();
    act(() => screen.getByRole('button', { name: 'Outside' }).focus());
    await user.hover(row('first'));
    const card = await screen.findByRole('dialog', { name: 'first' });
    if (pointer === 'portal') await user.hover(card);
    working(elsewhere.appId);
    expect(projectRows()).toEqual(['alpha', 'beta']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Outside' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'first' })).toBeNull());
    if (pointer === 'trigger') {
      expect(projectRows()).toEqual(['alpha', 'beta']); // the remaining row still owns the pointer
      await user.unhover(row('first'));
    }
    await waitFor(() => expect(projectRows()).toEqual(['beta', 'alpha']));
  });

  it('releases a pointer-only rank hold when the hovered session is removed without leave', () => {
    start();
    fireEvent.pointerEnter(row('first'));
    working(elsewhere.appId);
    expect(projectRows()).toEqual(['alpha', 'beta']);
    act(() => useSessions.getState().applyRemoved({ appSessionId: at(first.appId), revision: useSessions.getState().revision + 1 }, TEST_MACHINE));
    expect(projectRows()).toEqual(['beta', 'alpha']);
  });

  it('releases the keyboard rank hold when a focused session is removed without a focus transfer', () => {
    start();
    act(() => row('first').focus());
    working(elsewhere.appId);
    expect(projectRows()).toEqual(['alpha', 'beta']);
    act(() => useSessions.getState().applyRemoved({ appSessionId: at(first.appId), revision: useSessions.getState().revision + 1 }, TEST_MACHINE));
    expect(document.activeElement).toBe(document.body);
    expect(projectRows()).toEqual(['beta', 'alpha']);
    // Later live data does not need another focus/blur event to resume ordering.
    act(() => useSessions.getState().applyDigest(digest(at(second.appId), { phase: 'working', turnStartedAt: '2026-10-24T14:00:00Z', revision: 2 }), TEST_MACHINE));
    expect(projectRows()).toEqual(['alpha', 'beta']);
  });

  it('lets an explicit sort change take effect while keyboard focus remains in the sidebar', async () => {
    start();
    act(() => useSessions.getState().applyDigest(digest(at(second.appId), { phase: 'working', turnStartedAt: '2026-10-24T07:00:00Z' }), TEST_MACHINE));
    expect(sessionRows(row('alpha'))).toEqual(['second', 'first']);
    act(() => row('second').focus());
    act(() => useLayout.getState().setSidebar({ sort: 'recency' }));
    expect(sessionRows(row('alpha'))).toEqual(['first', 'second']);
    expect(document.activeElement).toBe(row('second'));
  });
});

describe('sidebar recovery routes', () => {
  it.each(['footer', 'context menu'] as const)('recovers a project-less archive through the %s', async (route) => {
    const empty = { ...scenarioFile('empty'), projects: [project('project-a', 0)] }; // the other archived session's project, listed
    fillStores(route === 'footer' ? empty : { ...empty, sessions: [record('listed-other', { projectId: null })] });
    const archived = record('archived-other', { projectId: null, archived: true, title: { text: 'Recovered notes', source: 'user' } });
    const elsewhere = record('archived-project', { projectId: 'project-a' as ProjectId, archived: true, title: { text: 'Project notes', source: 'user' } });
    const fake = fakeClient({
      'session.list': () => ({ sessions: [archived, elsewhere], revision: 1 }),
      'session.update': () => {
        archived.archived = false;
        useSessions.getState().applyChanged({ record: recordOnPage(archived), cause: 'update', revision: useSessions.getState().revision + 1 }, TEST_MACHINE);
        return archived;
      },
    });
    window.maws = fake.client as unknown as PreloadBridge;
    render(<><Sidebar /><SessionDialogs /></>);
    if (route === 'footer') {
      expect(screen.queryByRole('treeitem', { name: 'This Mac' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Archived sessions…' }));
    } else {
      fireEvent.contextMenu(row('This Mac'));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Archived sessions…' }));
    }
    const dialog = await screen.findByRole('dialog', { name: 'Archived sessions · This Mac' });
    await within(dialog).findByText('Recovered notes');
    expect(within(dialog).queryByText('Project notes')).toBeNull();
    expect(fake.invoked('session.list')).toEqual([{ includeArchived: true }]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unarchive' }));
    await within(dialog).findByText('No archived sessions.');
    expect(fake.invoked('session.update')).toEqual([{ appSessionId: archived.appId, patch: { archived: false } }]);
    act(() => closeDialog());
    await toggle(userEvent.setup(), 'This Mac');
    expect(sessionRows(row('This Mac'))).toContain('Recovered notes');
  });

  it('reports a failed hidden-project restore without revealing a row that remains hidden', async () => {
    const project = nine.projects.find((p) => p.name === 'MAWS')!;
    fillStores({ ...nine, projects: nine.projects.map((p) => ({ ...p, hidden: p.id === project.id })) });
    useLayout.getState().setSidebar({ collapsed: true });
    const fake = fakeClient();
    window.maws = fake.client as unknown as PreloadBridge;
    render(<Sidebar />);
    act(() => revealProject(at(project.id)));
    await act(() => fake.fail('session.projects.add', 'Directory no longer exists'));
    expect(screen.queryByRole('treeitem', { name: 'MAWS' })).toBeNull();
    expect(useLayout.getState().regions.sidebar.collapsed).toBe(true);
    expect(expanded()).not.toContain(at(project.id));
    expect(useNotices.getState().notices.at(-1)).toMatchObject({ level: 'danger', text: 'Directory no longer exists' });
  });

  // P3-F wave S (F17); UX wave U13a (O-31): the title bar's project chip reveals its row; a hidden project's is restored
  // first, as the chip's menu item did before the click became the reveal
  it('the title bar chip shows a hidden project: restored first, then its row revealed, expanded and focused', async () => {
    const project = nine.projects.find((p) => p.name === 'MAWS')!;
    fillStores({ ...nine, projects: nine.projects.map((p) => ({ ...p, hidden: p.id === project.id })) });
    useMachines.setState({ loaded: new Set([TEST_MACHINE]) }); // U13a: the chip's project is the session in front's
    offs.push(() => useMachines.setState({ loaded: new Set() }));
    useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' });
    useLayout.getState().setSidebar({ collapsed: true });
    const fake = fakeClient();
    window.maws = fake.client as unknown as PreloadBridge;
    render(<><Sidebar /><Toolbar /></>);
    const chip = () => document.querySelector<HTMLElement>('[data-toolbar-project]')!;
    expect(screen.queryByRole('treeitem', { name: 'MAWS' })).toBeNull();
    expect(chip().getAttribute('aria-label')).toBe('Show MAWS in sidebar');
    await userEvent.click(chip());
    expect(fake.invoked('session.projects.add')).toEqual([{ directory: project.directory }]);
    expect(useLayout.getState().regions.sidebar.collapsed).toBe(true);
    await act(() => fake.reply('session.projects.add', { ...project, hidden: false }));
    // Main's project event may arrive after its command response.
    act(() => useSessions.getState().applyProjects({ projects: page.projects, revision: 10 }, TEST_MACHINE));
    await waitFor(() => expect(document.activeElement).toBe(row('MAWS')));
    expect(row('MAWS').getAttribute('aria-expanded')).toBe('true');
    expect(useLayout.getState().regions.sidebar.collapsed).toBe(false);
    expect(chip().getAttribute('aria-label')).toBe('Reveal MAWS in sidebar');
    await userEvent.click(chip());
    expect(fake.invoked('session.projects.add')).toHaveLength(1);
    expect(useSessions.getState().unstarted.size).toBe(0); // the chip created nothing
  });

  it('the title bar chip reveals a machine’s own row: the sidebar shown, the row expanded and focused', async () => {
    fillStores(nine);
    useMachines.setState({ loaded: new Set([TEST_MACHINE]) });
    offs.push(() => useMachines.setState({ loaded: new Set() }));
    useLayout.getState().openSession(idOf('Terminal workflow notes'), { how: 'tab' }); // a session in no project
    useLayout.getState().setSidebar({ collapsed: true, expandedProjects: [] });
    render(<><Sidebar /><Toolbar /></>);
    const chip = document.querySelector<HTMLElement>('[data-toolbar-project]')!;
    expect(chip.getAttribute('aria-label')).toBe('Reveal This Mac in sidebar');
    await userEvent.click(chip);
    await waitFor(() => expect(document.activeElement).toBe(row('This Mac')));
    expect(row('This Mac').getAttribute('aria-expanded')).toBe('true');
    expect(useLayout.getState().regions.sidebar).toMatchObject({ collapsed: false, expandedProjects: [machineKey(TEST_MACHINE)] });
  });
});

describe('Needs you across projects', () => {
  const waiting = () => screen.getByRole('list', { name: 'Needs you' });
  const buttons = () => within(waiting()).getAllByRole('button');

  it('shows every waiting session in wait order, with project, title and reason, unaffected by search or hidden projects', async () => {
    fillStores({ ...nine, projects: nine.projects.map((p) => ({ ...p, hidden: p.name === 'MAWS' })) });
    render(<Sidebar />);
    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'MAWS · Fix sidebar drag · Approval needed',
      'MAWS · Sidebar interaction pass · Question',
      'codex_somersault · Quota reset recovery · Plan review',
    ]);
    expect(screen.queryByRole('button', { name: /Needs you/ })).toBeNull();
    expect(row('codex_somersault').getAttribute('aria-expanded')).toBe('false');
    await userEvent.type(screen.getByRole('searchbox'), 'no matching project');
    expect(buttons()).toHaveLength(3);
    expect(screen.queryByRole('treeitem', { name: 'MAWS' })).toBeNull();
  });

  it('has one tab stop before the project controls; arrows and Home/End navigate, Enter opens without answering', async () => {
    fillStores(nine);
    const fake = fakeClient({ 'attention.request': () => ({ event: null }) });
    window.maws = fake.client as unknown as PreloadBridge;
    const user = userEvent.setup();
    render(<Sidebar />);
    const search = screen.getByRole('searchbox');
    search.focus();
    for (const name of ['Projects', 'Artifacts', 'Customize']) {
      await user.tab();
      expect(document.activeElement).toBe(within(screen.getByRole('navigation', { name: 'App destinations' })).getByRole('button', { name }));
    }
    await user.tab();
    expect(document.activeElement).toBe(buttons()[0]);
    expect(buttons().filter((b) => b.tabIndex === 0)).toHaveLength(1);
    await user.keyboard('{End}{ArrowUp}{Home}{ArrowDown}{Enter}');
    expect(document.activeElement).toBe(buttons()[1]);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ appSessionId: idOf('Sidebar interaction pass') });
    expect(fake.invoked('session.answer')).toEqual([]);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Filter projects' }));
    search.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(buttons()[1]);
  });

  it('keeps keyboard focus in the sidebar when a focused waiting session retires', () => {
    fillStores(nine);
    render(<Sidebar />);
    act(() => buttons()[0].focus());
    act(() => useAttention.getState().applyChanged({ appSessionId: idOf('Fix sidebar drag'), items: [] }, TEST_MACHINE));
    expect(document.activeElement).toBe(buttons()[0]);
    act(() => {
      for (const entry of page.attention) useAttention.getState().applyChanged({ appSessionId: entry.appSessionId, items: [] }, TEST_MACHINE);
    });
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });

  it.each([
    ['Sidebar interaction pass', 'Quota reset recovery'],
    ['Quota reset recovery', 'Sidebar interaction pass'],
  ])('focuses the neighbour of a retiring %s row', (retired, neighbour) => {
    fillStores(nine);
    render(<Sidebar />);
    act(() => buttons().find((b) => b.dataset.needsYou === idOf(retired))!.focus());
    act(() => useAttention.getState().applyChanged({ appSessionId: idOf(retired), items: [] }, TEST_MACHINE));
    const survivor = buttons().find((b) => b.dataset.needsYou === idOf(neighbour))!;
    expect(document.activeElement).toBe(survivor);
    expect(survivor.tabIndex).toBe(0);
    expect(buttons().filter((b) => b.tabIndex === 0)).toHaveLength(1);
  });

  it('keeps a surviving row focused through reordering and uses its new neighbour when it retires', () => {
    fillStores(nine);
    render(<Sidebar />);
    const id = idOf('Fix sidebar drag');
    const focused = buttons()[0];
    act(() => focused.focus());
    act(() => useAttention.getState().applyChanged({ appSessionId: id, items: [pageItem(bareIdOf('Fix sidebar drag'), 'interrupted', '2026-10-03T10:00:00Z')] }, TEST_MACHINE));
    expect(document.activeElement).toBe(focused);
    expect(buttons().at(-1)).toBe(focused);
    act(() => useAttention.getState().applyChanged({ appSessionId: id, items: [] }, TEST_MACHINE));
    expect(document.activeElement).toBe(buttons().at(-1));
  });

  it.each(['session pane', 'search', 'project tree', 'sort control'])('does not reclaim focus from the %s when waiting rows retire', (place) => {
    fillStores(nine);
    render(<><Sidebar /><textarea aria-label="Session prompt" /></>);
    act(() => buttons()[0].focus());
    const target = place === 'session pane' ? screen.getByRole('textbox', { name: 'Session prompt' })
      : place === 'search' ? screen.getByRole('searchbox')
      : place === 'project tree' ? row('MAWS')
      : screen.getByRole('button', { name: 'Sort sessions' });
    act(() => target.focus());
    act(() => useAttention.getState().applyChanged({ appSessionId: idOf('Fix sidebar drag'), items: [] }, TEST_MACHINE));
    expect(document.activeElement).toBe(target);
    act(() => {
      for (const entry of page.attention) useAttention.getState().applyChanged({ appSessionId: entry.appSessionId, items: [] }, TEST_MACHINE);
    });
    expect(document.activeElement).toBe(target);
  });

  it('updates reasons and ordering from attention, omits archived sessions, and disappears when empty', () => {
    fillStores(nine);
    render(<Sidebar />);
    const id = idOf('Fix sidebar drag');
    act(() => useAttention.getState().applyChanged({ appSessionId: id, items: [pageItem(bareIdOf('Fix sidebar drag'), 'interrupted', '2026-10-03T10:00:00Z')] }, TEST_MACHINE));
    expect(buttons().at(-1)?.getAttribute('aria-label')).toBe('MAWS · Fix sidebar drag · Interrupted');
    act(() => useAttention.getState().applyChanged({ appSessionId: id, items: [pageItem(bareIdOf('Fix sidebar drag'), 'error', '2026-09-01T10:00:00Z')] }, TEST_MACHINE));
    expect(buttons()[0].getAttribute('aria-label')).toBe('MAWS · Fix sidebar drag · Error');
    act(() => useSessions.getState().applyChanged({ record: { ...useSessions.getState().records.get(id)!, archived: true }, cause: 'update', revision: useSessions.getState().revision + 1 }, TEST_MACHINE));
    expect(buttons()).toHaveLength(2);
    act(() => {
      for (const entry of page.attention) useAttention.getState().applyChanged({ appSessionId: entry.appSessionId, items: [] }, TEST_MACHINE);
    });
    expect(screen.queryByRole('list', { name: 'Needs you' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Needs you/ })).toBeNull();
  });
});

describe('the project list', () => {
  beforeEach(() => fillStores(nine));

  it('lists the projects most recently active first, then this machine’s own row, each collapsed, with no drill-in or Pinned section', () => {
    render(<Sidebar />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Needs you · 3', 'Projects']);
    expect(screen.queryByTestId('sidebar-levels')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to projects' })).toBeNull();
    expect(projectRows()).toEqual(['claude-usage-menubar', 'codex_somersault', 'MAWS', 'This Mac']);
    expect(within(projectsTree()).getAllByRole('treeitem').map((t) => t.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false', 'false']);
    expect(sessionRows(projectsTree())).toEqual([]);
  });

  it('carries each collapsed project’s waiting (◐) and working (●) counts, and drops them once expanded', () => {
    render(<Sidebar />);
    expect(within(row('MAWS')).getByLabelText('2 waiting').textContent).toBe('◐2');
    expect(within(row('MAWS')).getByLabelText('1 working').textContent).toBe('●1');
    expect(within(row('codex_somersault')).getByLabelText('1 waiting').textContent).toBe('◐1');
    expect(within(row('codex_somersault')).queryByLabelText(/working/)).toBeNull();
    expect(within(row('claude-usage-menubar')).getByLabelText('1 working')).toBeTruthy();
    expect(within(row('This Mac')).queryByLabelText(/waiting|working/)).toBeNull();
    expand('proj-maws');
    expect(within(row('MAWS')).queryByLabelText('2 waiting')).toBeNull();
  });

  it('a click expands a project in place, persisted; another collapses it', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await toggle(user, 'MAWS');
    expect(expanded()).toEqual([at('proj-maws')]);
    expect(row('MAWS').getAttribute('aria-expanded')).toBe('true');
    expect(sessionRows(row('MAWS'))).toEqual(['Workstation north star', 'Fix sidebar drag', 'Sidebar interaction pass', 'Charter + research']);
    expect(within(row('MAWS')).getByRole('group', { name: 'MAWS' })).toBeTruthy();
    await toggle(user, 'codex_somersault');
    expect(expanded()).toEqual([at('proj-maws'), at('proj-codex-somersault')]);
    await toggle(user, 'MAWS');
    expect(expanded()).toEqual([at('proj-codex-somersault')]);
    expect(row('MAWS').getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(sessionRows(row('MAWS'))).toEqual([])); // once the close has run
  });

  it('a click before the layout hydrates expands over the saved expansions, not in place of them', async () => {
    const user = userEvent.setup();
    act(() => useLayout.setState({ hydrated: false }));
    render(<Sidebar />);
    await toggle(user, 'MAWS');
    expect(expanded()).toEqual([at('proj-maws')]);
    const saved = { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, expandedProjects: [at('proj-codex-somersault')] } };
    const client = fakeClient({ 'layout.list': { keys: ['regions'] }, 'layout.get': ({ key }: { key: string }) => ({ value: key === 'regions' ? saved : null }), 'layout.set': undefined }).client;
    await act(() => useLayout.getState().hydrate(client, () => true));
    expect(expanded()).toEqual([at('proj-codex-somersault'), at('proj-maws')]);
  });

  it('opens what the layout says, and passes over a project that is gone', () => {
    expand('proj-removed', 'proj-codex-somersault');
    render(<Sidebar />);
    expect(sessionRows(row('codex_somersault'))).toEqual(['Quota reset recovery', 'Somersault terminal run', 'Trace stream reconnects']);
    expect(projectRows()).toEqual(['claude-usage-menubar', 'codex_somersault', 'MAWS', 'This Mac']);
  });

  it('This machine’s own row expands like a project, without a "+" but with archive recovery', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    expect(within(row('This Mac')).queryByRole('button')).toBeNull();
    expect(row('This Mac').getAttribute('data-menu')).toBe(`machine:${TEST_MACHINE}`);
    await toggle(user, 'This Mac');
    expect(expanded()).toEqual([machineKey(TEST_MACHINE)]);
    expect(sessionRows(row('This Mac'))).toEqual(['Terminal workflow notes']);
  });

  it('lists five projects, then "Show more" for the rest (not persisted), with this machine’s row last; a search lists every project', async () => {
    const extra = (n: number): ProjectRecord => ({ ...nine.projects[0], id: `proj-x${n}` as ProjectId, name: `extra-${n}`, directory: `/x/extra-${n}`, order: 10 + n, createdAt: `2026-08-0${n}T00:00:00.000Z` });
    fillStores({ ...nine, projects: [...nine.projects, extra(1), extra(2), extra(3), extra(4)] });
    const user = userEvent.setup();
    const { unmount } = render(<Sidebar />);
    expect(projectRows()).toEqual(['claude-usage-menubar', 'codex_somersault', 'MAWS', 'extra-4', 'extra-3', 'This Mac']);
    const rows = within(projectsTree()).getAllByRole('treeitem').map(label);
    expect(rows.indexOf('Show more')).toBe(rows.indexOf('This Mac') - 1);
    const field = screen.getByRole('searchbox', { name: 'Search projects and sessions' });
    await user.type(field, 'extra');
    expect(projectRows()).toEqual(['extra-4', 'extra-3', 'extra-2', 'extra-1']);
    await user.clear(field);
    await user.click(row('Show more'));
    expect(projectRows()).toEqual(['claude-usage-menubar', 'codex_somersault', 'MAWS', 'extra-4', 'extra-3', 'extra-2', 'extra-1', 'This Mac']);
    expect(screen.queryByRole('treeitem', { name: 'Show more' })).toBeNull();
    expect(document.activeElement).toBe(row('extra-2')); // the first project it revealed
    unmount();
    render(<Sidebar />);
    expect(projectRows()).toHaveLength(6);
  });
});

// W11 (I5): the removal action hides a project from the sidebar; a hidden project and its sessions show nowhere in the
// tree (never under its machine’s row), and "Hidden projects…" at the end offers them back.
describe('removing a project from the sidebar', () => {
  beforeEach(() => fillStores(nine));

  it('the remove action beside "+" runs the confirmed removal, disabled until it has a handler', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    expect((within(row('MAWS')).getByRole('button', { name: 'Remove MAWS from sidebar' }) as HTMLButtonElement).disabled).toBe(true);
    const remove = vi.fn();
    offs.push(registerProjectAction('removeProject', remove));
    await user.click(within(row('MAWS')).getByRole('button', { name: 'Remove MAWS from sidebar' }));
    expect(remove).toHaveBeenCalledWith(at('proj-maws'));
    expect(expanded()).toEqual([]); // the click does not toggle the row
    const buttons = within(row('MAWS')).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(buttons.indexOf('Remove MAWS from sidebar')).toBe(buttons.indexOf('New chat in MAWS') - 1);
  });

  it('a hidden project and its sessions are listed nowhere, and "Hidden projects…" opens the list to show it again', async () => {
    const maws = nine.projects.find((p) => p.id === 'proj-maws')!;
    fillStores({ ...nine, projects: nine.projects.map((p) => (p.id === maws.id ? { ...p, hidden: true } : p)) });
    expand('proj-maws', 'other');
    const user = userEvent.setup();
    render(<Sidebar />);
    expect(projectRows()).toEqual(['claude-usage-menubar', 'codex_somersault', 'This Mac']);
    expect(sessionRows(row('This Mac'))).toEqual(['Terminal workflow notes']); // none of MAWS's
    await user.click(screen.getByRole('button', { name: 'Hidden projects…' }));
    expect(useDialogs.getState().open).toEqual({ kind: 'hiddenProjects' });
  });

  it('offers no "Hidden projects…" while nothing is hidden', () => {
    render(<Sidebar />);
    expect(screen.queryByRole('button', { name: 'Hidden projects…' })).toBeNull();
  });
});

describe('an expanded project', () => {
  beforeEach(() => fillStores(nine));

  it('pins on top, then the rest in the chosen sort; the sort menu on the Projects heading switches to recency', async () => {
    const user = userEvent.setup();
    expand('proj-claude-usage-menubar');
    render(<Sidebar />);
    expect(sessionRows(row('claude-usage-menubar'))).toEqual(['Usage reset countdown', 'Settings idle probe', 'SDK wire inventory']);
    await user.click(screen.getByRole('button', { name: 'Sort sessions' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Recency' }));
    expect(useLayout.getState().regions.sidebar.sort).toBe('recency');
  });

  it('shows an unread dot on exactly the unread records and labels every glyph from the glyph table', () => {
    expand('proj-maws', 'proj-codex-somersault', 'proj-claude-usage-menubar', 'other');
    render(<Sidebar />);
    expect(screen.getAllByLabelText('Unread').map((dot) => dot.closest('[data-kind="session"]')!.getAttribute('aria-label')).sort()).toEqual(['Fix sidebar drag', 'Quota reset recovery', 'Terminal workflow notes']);
    const glyph = (title: string) => within(row(title)).getAllByRole('img').find((mark) => !['Unread', 'Pinned', 'Worktree'].includes(mark.getAttribute('aria-label') ?? ''))!.getAttribute('aria-label'); // status sits beside the age
    expect(glyph('Quota reset recovery')).toBe('Plan review');
    expect(glyph('Trace stream reconnects')).toBe('Done');
    expect(glyph('Somersault terminal run')).toBe('Live in terminal');
    expect(glyph('Charter + research')).toBe('Working');
    expect(glyph('Sidebar interaction pass')).toBe('Question');
  });

  it('keeps a row to one line: glyph, title, pin mark, unread dot, age', () => {
    expand('proj-maws');
    render(<Sidebar />);
    const charter = row('Charter + research');
    expect(within(charter).queryByText('Running bun test')).toBeNull();
    expect(charter.textContent).toBe(`Charter + research●${REL.now}`);
    expect(within(row('Workstation north star')).getByRole('img', { name: 'Pinned' })).toBeTruthy();
    expect(within(charter).queryByRole('img', { name: 'Pinned' })).toBeNull();
    expect(within(row('Fix sidebar drag')).getByRole('img', { name: 'Unread' })).toBeTruthy();
  });

  it('marks a worktree session with its ⎇ branch in one flat list, with no groups and no git call', () => {
    const fake = fakeClient();
    window.maws = fake.client as unknown as PreloadBridge;
    fillStores({
      ...nine,
      sessions: nine.sessions.map((r) =>
        r.appId === bareIdOf('Fix sidebar drag')
          ? { ...r, worktree: { path: '/Users/new/Developer/GitHub/MAWS/.claude/worktrees/accept-one', branch: 'worktree-accept-one' } }
          : r.appId === bareIdOf('Charter + research')
            ? { ...r, worktree: { path: '/Users/new/Developer/GitHub/MAWS-detached', branch: null }, branch: null }
            : r,
      ),
    });
    expand('proj-maws');
    render(<Sidebar />);
    expect(sessionRows(row('MAWS'))).toHaveLength(4);
    expect(within(row('MAWS')).getAllByRole('group')).toHaveLength(1); // the project's own: no Main or worktree groups
    expect(within(row('Fix sidebar drag')).getByTestId('row-branch').textContent).toBe('⎇');
    expect(within(row('Charter + research')).getByTestId('row-branch').textContent).toBe('⎇'); // A worktree is marked even when its branch is unknown
    expect(within(row('Sidebar interaction pass')).queryByTestId('row-branch')).toBeNull();
    expect(fake.invoked('git.worktree.list')).toEqual([]);
  });

  it('offers a foreign-live session only the opens in its context menu and a local read toggle, never holder actions', async () => {
    expand('proj-codex-somersault');
    render(<Sidebar />);
    const foreign = row('Somersault terminal run');
    // the three dots (UX wave U7: on every session row) and the local read state, no holder actions
    expect(within(foreign).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Hide', 'Actions for Somersault terminal run', 'Mark unread']); // UX wave U7, O-16: the row's own Hide
    fireEvent.contextMenu(foreign);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Open in new tab', 'Hide']); // UX wave U7, O-16: Hide after the opens
  });

  it('toggles an unread row on hover without opening or pinning it, retaining an accessible unread marker', async () => {
    const user = userEvent.setup();
    const pin = vi.fn();
    offs.push(registerSessionAction('pin', pin));
    const fake = fakeClient({ 'session.update': ({ appSessionId, patch }: { appSessionId: AppSessionId; patch: { unread: boolean } }) => {
      const record = { ...useSessions.getState().records.get(at(appSessionId))!, ...patch };
      useSessions.getState().applyChanged({ record, cause: 'update', revision: useSessions.getState().revision + 1 }, TEST_MACHINE);
      return recordAsMain(record);
    } });
    window.maws = fake.client as unknown as PreloadBridge;
    expand('proj-maws');
    render(<Sidebar />);
    const session = row('Fix sidebar drag');
    expect(within(session).getByRole('img', { name: 'Unread' })).toBeTruthy();
    await user.hover(session);
    const toggle = within(session).getByRole('button', { name: 'Mark read' });
    const overflow = within(session).getByRole('button', { name: 'Actions for Fix sidebar drag' });
    expect(toggle).not.toBe(overflow); // distinct actions; the real-window regression checks their hit targets
    await user.click(within(session).getByRole('button', { name: 'Mark read' }));
    expect(fake.invoked('session.update')).toEqual([{ appSessionId: bareIdOf('Fix sidebar drag'), patch: { unread: false } }]);
    expect(within(session).queryByRole('img', { name: 'Unread' })).toBeNull();
    await user.click(within(session).getByRole('button', { name: 'Mark unread' }));
    expect(fake.invoked('session.update')).toEqual([
      { appSessionId: bareIdOf('Fix sidebar drag'), patch: { unread: false } },
      { appSessionId: bareIdOf('Fix sidebar drag'), patch: { unread: true } },
    ]);
    expect(within(session).getByRole('img', { name: 'Unread' })).toBeTruthy();
    expect(activeTab(useLayout.getState().main)).toBeNull();
    expect(pin).not.toHaveBeenCalled();
  });

  it('offers §5.1’s session actions in a session’s context menu, disabled until a handler registers', async () => {
    offs.push(registerSessionAction('open', vi.fn()));
    expand('proj-maws');
    render(<Sidebar />);
    fireEvent.contextMenu(row('Charter + research'));
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    // C10: a live session offers no Resume; "Fork to a new worktree…" sits beside the fork in place. UX wave U7, O-16: Hide
    // directly after Pin, always enabled, and nothing of it after "Delete conversation…"
    expect(items.map((m) => m.textContent)).toEqual(['Open', 'Open in new tab', 'Open in split', 'Pin', 'Hide', 'Rename…', 'Fork', 'Fork to a new worktree…', 'Archive', 'Delete conversation…']);
    expect(items.map((m) => m.hasAttribute('data-disabled'))).toEqual([false, true, true, true, false, true, true, true, true, true]);
  });

  // P5 O2 M2: the owner's Keep running mark, offered while the session's engine status reports it
  it('offers Keep running while the engine status reports the mark, and Stop keeping running once it holds', async () => {
    const id = idOf('Charter + research');
    const bare = bareIdOf('Charter + research'); // main's id, which the bridge receives
    const fake = fakeClient({ 'session.setKeep': (input: { keep: boolean }) => ({ kept: input.keep }) });
    window.maws = fake.client as unknown as PreloadBridge;
    expand('proj-maws');
    render(<Sidebar />);
    fireEvent.contextMenu(row('Charter + research'));
    expect(within(await screen.findByRole('menu')).queryByRole('menuitem', { name: 'Keep running' })).toBeNull(); // no mark reported yet
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    const live = useSessions.getState().engine.get(id) ?? status(id);
    act(() => useSessions.getState().applyStatuses([{ ...live, kept: false }], TEST_MACHINE));
    fireEvent.contextMenu(row('Charter + research'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Keep running' }));
    expect(fake.invoked('session.setKeep')).toEqual([{ appSessionId: bare, keep: true }]);
    act(() => useSessions.getState().applyStatuses([{ ...live, kept: true }], TEST_MACHINE));
    fireEvent.contextMenu(row('Charter + research'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Stop keeping running' }));
    expect(fake.invoked('session.setKeep')).toEqual([{ appSessionId: bare, keep: true }, { appSessionId: bare, keep: false }]);
  });

  it('the hover overflow offers the same actions without opening the session', async () => {
    const user = userEvent.setup();
    const rename = vi.fn();
    offs.push(registerSessionAction('rename', rename));
    expand('proj-maws');
    render(<Sidebar />);
    await user.click(within(row('Charter + research')).getByRole('button', { name: 'Actions for Charter + research' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Archive' }).hasAttribute('data-disabled')).toBe(true);
    await user.click(within(menu).getByRole('menuitem', { name: 'Rename…' }));
    expect(rename).toHaveBeenCalledWith(idOf('Charter + research'));
    expect(activeTab(useLayout.getState().main)).toBeNull();
  });

  it('a session row carries its id for a drag to a tab strip', () => {
    expand('proj-maws');
    render(<Sidebar />);
    const setData = vi.fn();
    fireEvent.dragStart(row('Charter + research'), { dataTransfer: { setData, effectAllowed: 'none' } });
    expect(setData).toHaveBeenCalledWith('application/x-maws-session', idOf('Charter + research'));
  });

  it('"Mark all read" on a project row marks the project’s unread sessions read through session.update', async () => {
    const fake = fakeClient({ 'session.update': ({ appSessionId }: { appSessionId: AppSessionId }) => recordAsMain(useSessions.getState().records.get(at(appSessionId))!) });
    window.maws = fake.client as unknown as PreloadBridge;
    render(<Sidebar />);
    fireEvent.contextMenu(row('MAWS'));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mark all read' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(fake.invoked('session.update')).toEqual([
      { appSessionId: bareIdOf('Fix sidebar drag'), patch: { unread: false, lastSeen: { messageUuid: null, at: expect.any(String) } } },
    ]);
  });

  it('the search lists the projects it finds, each open on its matching sessions without expanding anything; Escape clears it', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const field = screen.getByRole('searchbox', { name: 'Search projects and sessions' });
    await user.type(field, 'sidebar');
    expect(projectRows()).toEqual(['MAWS']);
    expect(sessionRows(row('MAWS'))).toEqual(['Fix sidebar drag', 'Sidebar interaction pass']);
    await toggle(user, 'MAWS');
    expect(expanded()).toEqual([]); // a click while searching changes nothing
    await user.click(field);
    await user.keyboard('{Escape}');
    expect(projectRows()).toHaveLength(4);
    await user.type(field, 'nothing like it');
    expect(screen.getByText('No projects match')).toBeTruthy();
  });

  it('search reaches every matching session beyond the browsing cap and reports the count', async () => {
    fillStores(scenarioFile('many-sessions'));
    render(<Sidebar />);
    await userEvent.type(screen.getByRole('searchbox'), 'MAWS');
    const expected = [...useSessions.getState().records.values()].filter((r) => r.projectId === at('proj-maws') && !r.archived);
    expect(expected.length).toBeGreaterThan(8);
    expect(sessionRows(row('MAWS'))).toHaveLength(expected.length);
    expect(within(row('MAWS')).getByLabelText(`${expected.length} matching sessions`)).toBeTruthy();
  });

  it('shows five sessions, then "Show more" reveals up to eight, never more', async () => {
    fillStores(scenarioFile('many-sessions'));
    expand('proj-maws');
    const user = userEvent.setup();
    render(<Sidebar />);
    expect(sessionRows(row('MAWS'))).toHaveLength(5);
    await user.click(within(row('MAWS')).getByRole('treeitem', { name: 'Show more' }));
    expect(sessionRows(row('MAWS'))).toHaveLength(8);
    expect(within(row('MAWS')).queryByRole('treeitem', { name: 'Show more' })).toBeNull();
    expect(document.activeElement).toBe(within(row('MAWS')).getAllByRole('treeitem').filter((t) => t.dataset.kind === 'session')[5]); // the first it revealed
    // Collapsed and opened again, it shows its first five.
    await toggle(user, 'MAWS');
    await toggle(user, 'MAWS');
    expect(sessionRows(row('MAWS'))).toHaveLength(5);
  });
});

// UX wave U7, O-16 (docs/doperpowers/plans/2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M3; Interfaces §C and
// §D): Hide in every session row's menu, the project's "Hidden · N" row and its rows, Unhide at the head of the list.
describe('hiding a session', () => {
  const T = '2026-11-12T10:00:00.000Z';
  let fake: ReturnType<typeof fakeClient>;
  // The hidden store's first read answers these entries (or nothing), as main's layout file holds them.
  const storedHidden = async (...titles: string[]) => {
    fake = fakeClient({ 'layout.get': { value: titles.length === 0 ? null : { version: 1, hidden: Object.fromEntries(titles.map((t) => [idOf(t), { at: T, armedAt: null }])) } }, 'layout.set': undefined });
    window.maws = fake.client as unknown as PreloadBridge;
    await act(() => useHidden.getState().load());
  };
  const kinds = (el: HTMLElement) => within(el).getAllByRole('treeitem').map((t) => t.dataset.kind);
  const hiddenRow = (el: HTMLElement) => within(el).getByRole('treeitem', { name: /^Hidden, / });
  const menuItems = async () => within(await screen.findByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent);
  beforeEach(() => fillStores(nine));

  it('Hide from the context menu takes the row out at once; "Hidden · 1" ends the project, closed, and opens to the row, indented', async () => {
    await storedHidden();
    expand('proj-maws');
    render(<Sidebar />);
    fireEvent.contextMenu(row('Charter + research'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    expect(sessionRows(row('MAWS'))).toEqual(['Workstation north star', 'Fix sidebar drag', 'Sidebar interaction pass']);
    const hidden = hiddenRow(row('MAWS'));
    expect(hidden.textContent).toBe('Hidden · 1');
    expect(hidden.getAttribute('aria-label')).toBe('Hidden, 1 session');
    expect(hidden.getAttribute('aria-expanded')).toBe('false');
    expect(kinds(row('MAWS')).at(-1)).toBe('hidden');
    await userEvent.click(hidden);
    expect(hidden.getAttribute('aria-expanded')).toBe('true');
    const shown = row('Charter + research');
    expect(shown.getAttribute('aria-level')).toBe('3');
    expect(shown.dataset.indented).toBe('true');
    expect(row('Fix sidebar drag').dataset.indented).toBeUndefined();
    expect(useHidden.getState().hidden.has(idOf('Charter + research'))).toBe(true);
    fireEvent.contextMenu(shown);
    expect(await menuItems()).toEqual(['Open', 'Open in new tab', 'Open in split', 'Pin', 'Unhide', 'Rename…', 'Fork', 'Fork to a new worktree…', 'Archive', 'Delete conversation…']);
  });

  it('Hide from the three dots, for a local record, without opening it', async () => {
    await storedHidden();
    expand('proj-maws');
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(within(row('Fix sidebar drag')).getByRole('button', { name: 'Actions for Fix sidebar drag' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    expect(sessionRows(row('MAWS'))).toEqual(['Workstation north star', 'Sidebar interaction pass', 'Charter + research']);
    expect(hiddenRow(row('MAWS')).textContent).toBe('Hidden · 1');
    expect(activeTab(useLayout.getState().main)).toBeNull();
  });

  it('draws "Hidden · 2" after "Show more", and a hidden session counts against neither the five nor the eight', async () => {
    const many = scenarioFile('many-sessions');
    fillStores(many);
    const maws = pageScenario(many).sessions.filter((r) => r.projectId === at('proj-maws'));
    fake = fakeClient({ 'layout.get': { value: { version: 1, hidden: Object.fromEntries(maws.slice(0, 2).map((r) => [r.appId, { at: T, armedAt: null }])) } }, 'layout.set': undefined });
    window.maws = fake.client as unknown as PreloadBridge;
    await act(() => useHidden.getState().load());
    expand('proj-maws');
    render(<Sidebar />);
    expect(sessionRows(row('MAWS'))).toHaveLength(5);
    expect(kinds(row('MAWS')).slice(-2)).toEqual(['more', 'hidden']);
    expect(hiddenRow(row('MAWS')).textContent).toBe('Hidden · 2');
    expect(hiddenRow(row('MAWS')).getAttribute('aria-label')).toBe('Hidden, 2 sessions');
    expect(sessionRows(row('MAWS'))).not.toContain(maws[0].title.text);
    expect(within(within(row('MAWS')).getByRole('treeitem', { name: 'Show more' })).queryByRole('button')).toBeNull();
  });

  it('the arrow keys reach the Hidden row; Enter opens it, ArrowDown steps in, ArrowLeft lands on it, then closes it, then steps to the project', async () => {
    await storedHidden('Charter + research');
    expand('proj-maws');
    const user = userEvent.setup();
    render(<Sidebar />);
    row('MAWS').focus();
    await user.keyboard('{ArrowRight}{ArrowDown}{ArrowDown}{ArrowDown}');
    const hidden = hiddenRow(row('MAWS'));
    expect(document.activeElement).toBe(hidden);
    await user.keyboard('{Enter}');
    expect(hidden.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(row('Charter + research'));
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(hidden);
    await user.keyboard('{ArrowLeft}');
    expect(hidden.getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('{ArrowRight}');
    expect(hidden.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard(' ');
    expect(hidden.getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(row('MAWS'));
  });

  it('a Hidden row closes with its project and is closed when the project opens again', async () => {
    await storedHidden('Charter + research');
    expand('proj-maws');
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(hiddenRow(row('MAWS')));
    expect(hiddenRow(row('MAWS')).getAttribute('aria-expanded')).toBe('true');
    await toggle(user, 'MAWS');
    await toggle(user, 'MAWS');
    expect(hiddenRow(row('MAWS')).getAttribute('aria-expanded')).toBe('false');
  });

  it('the keyboard goes, after Hide, to the row that took its place, else to the Hidden row; after Unhide, to the unhidden row', async () => {
    await storedHidden();
    expand('proj-maws');
    const user = userEvent.setup();
    render(<Sidebar />);
    act(() => row('Fix sidebar drag').focus());
    fireEvent.contextMenu(row('Fix sidebar drag'));
    await user.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    await waitFor(() => expect(document.activeElement).toBe(row('Sidebar interaction pass')));
    act(() => row('Charter + research').focus());
    fireEvent.contextMenu(row('Charter + research'));
    await user.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    await waitFor(() => expect(document.activeElement).toBe(hiddenRow(row('MAWS'))));
    await user.keyboard('{Enter}{ArrowDown}');
    fireEvent.contextMenu(document.activeElement!);
    await user.click(await screen.findByRole('menuitem', { name: 'Unhide' }));
    const unhidden = useHidden.getState().leading;
    expect(unhidden.size).toBe(1);
    const back = [...unhidden][0] === idOf('Charter + research') ? 'Charter + research' : 'Fix sidebar drag';
    await waitFor(() => expect(document.activeElement).toBe(row(back)));
    expect(row(back).dataset.indented).toBeUndefined();
    expect(within(projectsTree()).getAllByRole('treeitem').filter((t) => t.tabIndex === 0)).toEqual([row(back)]);
  });

  it('Unhide puts the session at the head of its list while the pointer is still inside the sidebar', async () => {
    await storedHidden('SDK wire inventory');
    expand('proj-claude-usage-menubar');
    const user = userEvent.setup();
    render(<Sidebar />);
    fireEvent.pointerEnter(screen.getByTestId('sidebar-tree'));
    expect(sessionRows(row('claude-usage-menubar'))).toEqual(['Usage reset countdown', 'Settings idle probe']);
    await user.click(hiddenRow(row('claude-usage-menubar')));
    fireEvent.contextMenu(row('SDK wire inventory'));
    await user.click(await screen.findByRole('menuitem', { name: 'Unhide' }));
    expect(sessionRows(row('claude-usage-menubar'))).toEqual(['SDK wire inventory', 'Usage reset countdown', 'Settings idle probe']);
    expect(within(row('claude-usage-menubar')).queryByRole('treeitem', { name: /^Hidden, / })).toBeNull();
    await waitFor(() => expect(fake.invoked('layout.set')).toEqual([{ key: HIDDEN_KEY, value: { version: 1, hidden: {} } }]));
  });

  it('a hidden pinned session is under Hidden, and pinned first again after Unhide', async () => {
    await storedHidden('Workstation north star');
    expand('proj-maws');
    const user = userEvent.setup();
    render(<Sidebar />);
    expect(sessionRows(row('MAWS'))).toEqual(['Fix sidebar drag', 'Sidebar interaction pass', 'Charter + research']);
    await user.click(hiddenRow(row('MAWS')));
    expect(within(row('Workstation north star')).getByRole('img', { name: 'Pinned' })).toBeTruthy();
    fireEvent.contextMenu(row('Workstation north star'));
    await user.click(await screen.findByRole('menuitem', { name: 'Unhide' }));
    expect(sessionRows(row('MAWS'))).toEqual(['Workstation north star', 'Fix sidebar drag', 'Sidebar interaction pass', 'Charter + research']);
  });

  it('a hidden session that waits is still under Needs you, and its project still counts it', async () => {
    await storedHidden('Fix sidebar drag', 'Sidebar interaction pass');
    render(<Sidebar />);
    expect(within(screen.getByRole('list', { name: 'Needs you' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'MAWS · Fix sidebar drag · Approval needed',
      'MAWS · Sidebar interaction pass · Question',
      'codex_somersault · Quota reset recovery · Plan review',
    ]);
    expect(within(row('MAWS')).getByLabelText('2 waiting')).toBeTruthy();
  });

  // The architect's ruling of 2026-11-13: a Needs you row stays where it is whatever is hidden, so its menu offers no Hide
  it('a Needs you row’s menu holds no Hide or Unhide; the same session’s tree row’s menu does', async () => {
    await storedHidden();
    expand('proj-maws');
    render(<Sidebar />);
    const waiting = within(screen.getByRole('list', { name: 'Needs you' })).getByRole('button', { name: 'MAWS · Fix sidebar drag · Approval needed' });
    fireEvent.contextMenu(waiting);
    const items = await menuItems();
    expect(items).toContain('Open');
    expect(items).not.toContain('Hide');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.contextMenu(row('Fix sidebar drag'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    fireEvent.contextMenu(waiting);
    expect(await menuItems()).not.toContain('Unhide');
  });

  it('a search lists a hidden session in place, with no Hidden row', async () => {
    await storedHidden('Fix sidebar drag');
    expand('proj-maws');
    render(<Sidebar />);
    await userEvent.type(screen.getByRole('searchbox'), 'sidebar');
    expect(sessionRows(row('MAWS'))).toEqual(['Fix sidebar drag', 'Sidebar interaction pass']);
    expect(row('Fix sidebar drag').dataset.indented).toBeUndefined();
    expect(within(row('MAWS')).queryByRole('treeitem', { name: /^Hidden, / })).toBeNull();
  });

  // M3, decision 9 (the owner's answer of 2026-11-12, "Button on the row"): the row's own Hide, beside the three dots
  it('the row’s own button hides with one click, opening nothing, and unhides in the Hidden list; no other row has it', async () => {
    await storedHidden();
    expand('proj-maws');
    const user = userEvent.setup();
    render(<Sidebar />);
    const maws = row('MAWS');
    const title = 'Charter + research';
    expect(within(row(title)).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Hide', `Actions for ${title}`, 'Mark unread']); // left of the three dots
    expect(within(row(title)).getByRole('button', { name: 'Hide' }).getAttribute('title')).toBe('Hide');
    await user.click(within(row(title)).getByRole('button', { name: 'Hide' }));
    expect(sessionRows(maws)).toEqual(['Workstation north star', 'Fix sidebar drag', 'Sidebar interaction pass']);
    expect(activeTab(useLayout.getState().main)).toBeNull();
    const hidden = hiddenRow(maws);
    expect(hidden.textContent).toBe('Hidden · 1');
    await waitFor(() => expect(document.activeElement).toBe(hidden)); // the last row hidden: nothing took its place
    expect(within(maws.querySelector<HTMLElement>('[data-project-line]')!).queryByRole('button', { name: 'Hide' })).toBeNull();
    expect(within(hidden).queryByRole('button')).toBeNull();
    for (const waiting of within(screen.getByRole('list', { name: 'Needs you' })).getAllByRole('button')) expect(within(waiting).queryByRole('button', { name: /^(Hide|Unhide)$/ })).toBeNull();
    await user.click(hidden);
    const unhide = within(row(title)).getByRole('button', { name: 'Unhide' });
    expect(unhide.getAttribute('title')).toBe('Unhide');
    await user.click(unhide);
    expect(sessionRows(maws)).toEqual(['Workstation north star', title, 'Fix sidebar drag', 'Sidebar interaction pass']);
    await waitFor(() => expect(document.activeElement).toBe(row(title)));
  });

  it('a listed row carries the same button', async () => {
    const studio = (id: string) => addressOf(OTHER_MACHINE, id) as AppSessionId;
    await storedHidden();
    useSessions.setState({ listed: new Map([[studio('b1'), { ...remoteRow(OTHER_MACHINE, 'b1', { title: 'Studio build', orgKey: null }), appId: studio('b1') }]]) });
    act(() => useLayout.getState().setSidebar({ expandedProjects: [machineKey(OTHER_MACHINE)] as ProjectKey[] }));
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(within(row('Studio build')).getByRole('button', { name: 'Hide' }));
    expect(screen.queryByRole('treeitem', { name: 'Studio build' })).toBeNull();
    expect(useHidden.getState().hidden.has(studio('b1'))).toBe(true);
  });

  // The review's finding (round 3): a return draws its row anew in the project's list; the keyboard it held goes with it
  describe('where the keyboard goes when a hidden session returns', () => {
    const returns = (id: AppSessionId, dropped = false) =>
      act(() => {
        const hidden = new Map(useHidden.getState().hidden);
        hidden.delete(id);
        if (dropped) {
          const records = new Map(useSessions.getState().records);
          records.delete(id);
          useSessions.setState({ records });
        }
        useHidden.setState({ hidden });
      });

    it('a row that returns while it holds the keyboard keeps it', async () => {
      await storedHidden('Charter + research', 'Workstation north star');
      expand('proj-maws');
      render(<Sidebar />);
      fireEvent.click(hiddenRow(row('MAWS')));
      act(() => row('Charter + research').focus());
      returns(idOf('Charter + research'));
      expect(row('Charter + research').dataset.indented).toBeUndefined();
      expect(document.activeElement).toBe(row('Charter + research'));
    });

    it('the Hidden row that goes while it holds the keyboard hands it to the row that returned', async () => {
      await storedHidden('Charter + research');
      expand('proj-maws');
      render(<Sidebar />);
      act(() => hiddenRow(row('MAWS')).focus());
      returns(idOf('Charter + research'));
      expect(within(row('MAWS')).queryByRole('treeitem', { name: /^Hidden, / })).toBeNull();
      expect(document.activeElement).toBe(row('Charter + research'));
    });

    it('with no row returned (its session gone), to the project’s row', async () => {
      await storedHidden('Charter + research');
      expand('proj-maws');
      render(<Sidebar />);
      act(() => hiddenRow(row('MAWS')).focus());
      returns(idOf('Charter + research'), true);
      expect(within(row('MAWS')).queryByRole('treeitem', { name: /^Hidden, / })).toBeNull();
      expect(document.activeElement).toBe(row('MAWS'));
    });

    // The task review's finding (round 3): a row the caps would leave out stays drawn while the keyboard is on it, at its
    // own rank and with no lead
    describe('past the cap: five pinned rows rank above the one that returns', () => {
      const alpha = project('alpha', 0);
      const pins = [1, 2, 3, 4, 5].map((n) => record(`pin-${n}`, { projectId: alpha.id, pinned: true, updatedAt: `2026-10-24T1${6 - n}:00:00Z` }));
      const back = record('back', { projectId: alpha.id, updatedAt: '2026-10-24T09:00:00Z' });
      const other = record('other', { projectId: alpha.id, updatedAt: '2026-10-24T08:00:00Z' });
      const capped = async (...hidden: SessionRecord[]) => {
        fillStores({ projects: [alpha], sessions: [...pins, back, other], digests: [], attention: [], engine: [], timeline: [] });
        fake = fakeClient({ 'layout.get': { value: { version: 1, hidden: Object.fromEntries(hidden.map((r) => [at(r.appId), { at: T, armedAt: null }])) } }, 'layout.set': undefined });
        window.maws = fake.client as unknown as PreloadBridge;
        await act(() => useHidden.getState().load());
        expand(alpha.id);
        render(<><Sidebar /><button>Outside</button></>);
      };
      const pinned = pins.map((r) => r.appId as string);

      it('a focused row that returns sixth keeps the keyboard and stays drawn, after the five, until the keyboard leaves it', async () => {
        await capped(back, other);
        fireEvent.click(hiddenRow(row('alpha')));
        act(() => row('back').focus());
        returns(at(back.appId));
        expect(document.activeElement).toBe(row('back'));
        expect(sessionRows(row('alpha'))).toEqual([...pinned, 'back', 'other']); // 'other' is still under Hidden
        expect(useHidden.getState().leading.size).toBe(0);
        act(() => row('pin-1').focus());
        expect(sessionRows(row('alpha'))).toEqual([...pinned, 'other']);
      });

      it('the same return that removes the last Hidden row hands the keyboard to the row, drawn past the cap', async () => {
        await capped(back);
        act(() => hiddenRow(row('alpha')).focus());
        returns(at(back.appId));
        expect(within(row('alpha')).queryByRole('treeitem', { name: /^Hidden, / })).toBeNull();
        expect(document.activeElement).toBe(row('back'));
        expect(sessionRows(row('alpha'))).toEqual([...pinned, 'back']);
        act(() => screen.getByRole('button', { name: 'Outside' }).focus());
        expect(sessionRows(row('alpha'))).toEqual(pinned);
      });
    });

    it('takes no focus when the sidebar did not hold it', async () => {
      await storedHidden('Charter + research');
      expand('proj-maws');
      render(<><Sidebar /><button>Outside</button></>);
      fireEvent.click(hiddenRow(row('MAWS')));
      const outside = screen.getByRole('button', { name: 'Outside' });
      act(() => outside.focus());
      returns(idOf('Charter + research'));
      expect(document.activeElement).toBe(outside);
    });
  });

  it('a project whose sessions are all hidden keeps its row, open on its Hidden row alone', async () => {
    await storedHidden('Usage reset countdown', 'Settings idle probe', 'SDK wire inventory');
    expand('proj-claude-usage-menubar');
    render(<Sidebar />);
    expect(projectRows()).toContain('claude-usage-menubar');
    expect(kinds(row('claude-usage-menubar'))).toEqual(['hidden']); // the project's own row, then its Hidden row alone
    expect(hiddenRow(row('claude-usage-menubar')).textContent).toBe('Hidden · 3');
  });
});

// W11 (I7, as the owner corrected it); P2-D (the P2 spec, child P2-D, G1 to G5): the project row's search icon and its
// context menu open the resume chooser `/resume` opens too, scoped to the project, and open a session from it.
describe('the resume chooser from the sidebar', () => {
  const TURNS = { turns: [{ prompt: { text: 'Fix the drag handle', at: '2026-09-28T10:00:00.000Z' }, answer: { text: 'Done: the handle drags.', at: '2026-09-28T10:01:00.000Z' }, toolCalls: 3 }], earlier: true, source: 'transcript' };
  let fake: ReturnType<typeof fakeClient>;
  beforeEach(() => {
    clearPreviewCache();
    fillStores(nine);
    const maws = nine.projects.find((p) => p.id === 'proj-maws')!;
    fake = fakeClient({
      'git.worktree.list': { repoRoot: maws.directory, commonDir: `${maws.directory}/.git`, worktrees: [{ repoRoot: maws.directory, path: maws.directory, branch: 'master', head: 'abc', isMain: true, locked: false, prunable: false, managed: false }] },
      'session.recentTurns': TURNS,
    });
    window.maws = fake.client as unknown as PreloadBridge;
  });
  const picker = () => screen.getByRole('dialog', { name: 'Resume session' });
  const options = () => within(picker()).queryAllByRole('option').map((o) => o.querySelector('[data-title]')!.textContent);
  const selectedTitle = () => within(picker()).getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')?.querySelector('[data-title]')?.textContent;
  const openFromRow = async (user: ReturnType<typeof userEvent.setup>) => user.click(within(row('MAWS')).getByRole('button', { name: 'Resume a session in MAWS' }));

  it('opens from the row’s search icon on the project, searches, and Enter opens the session in the current tab', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const button = within(row('MAWS')).getByRole('button', { name: 'Resume a session in MAWS' });
    expect(button.title).toBe('Resume a session…');
    await user.click(button);
    expect(expanded()).toEqual([]); // the click does not toggle the row
    expect(picker().getAttribute('data-widget-size')).toBe('library'); // X19's box
    expect(within(picker()).getByTestId('resume-scope').textContent).toBe('MAWS');
    expect(options().sort()).toEqual(['Charter + research', 'Fix sidebar drag', 'Sidebar interaction pass', 'Workstation north star']);
    expect(within(picker()).getAllByRole('group').map((g) => g.getAttribute('aria-label')).filter((l) => l !== 'Scope').length).toBeGreaterThan(0); // the activity groups
    expect(document.activeElement).toBe(within(picker()).getByRole('combobox', { name: 'Search by title, folder, or branch' }));
    await user.keyboard('drag');
    expect(options()).toEqual(['Fix sidebar drag']);
    await user.keyboard('{Enter}');
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: idOf('Fix sidebar drag') });
    expect(screen.queryByRole('dialog', { name: 'Resume session' })).toBeNull();
  });

  it('a click selects and previews without opening; the arrows move; a double click opens', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await openFromRow(user);
    const first = selectedTitle();
    const other = within(picker()).getAllByRole('option').find((o) => o.querySelector('[data-title]')!.textContent !== first)!;
    await user.click(other);
    expect(selectedTitle()).toBe(other.querySelector('[data-title]')!.textContent);
    expect(activeTab(useLayout.getState().main)).toBeNull();
    expect(document.activeElement).toBe(within(picker()).getByRole('combobox')); // the list keeps the keyboard in the search
    await user.keyboard('{ArrowUp}');
    const up = selectedTitle();
    await user.dblClick(within(picker()).getAllByRole('option').find((o) => o.querySelector('[data-title]')!.textContent === up)!);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: idOf(up!) });
  });

  it('the preview shows the cached facts at once, then the recent turns read for the selection, launching and marking nothing', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(within(row('MAWS')).getByRole('button', { name: 'Resume a session in MAWS' }));
    await user.keyboard('drag');
    const preview = within(picker()).getByTestId('resume-preview');
    const fix = nine.sessions.find((r) => r.title.text === 'Fix sidebar drag')!;
    expect(preview.textContent).toContain(fix.directory);
    expect(preview.textContent).toContain('Last active');
    await waitFor(() => expect(within(preview).getByTestId('resume-turns').textContent).toContain('Done: the handle drags.'));
    expect(within(preview).getByTestId('resume-turns').textContent).toContain('Fix the drag handle');
    expect(within(preview).getByTestId('resume-turns').textContent).toContain('3 tool calls');
    expect(within(preview).getByTestId('resume-turns').textContent).toContain('Earlier messages not shown');
    expect(fake.invoked('session.recentTurns').at(-1)).toEqual({ appSessionId: fix.appId, limit: 6 });
    expect(fake.calls.filter((c) => /session\.(start|setVisible|acquire|launch)|session\.update/.test(c))).toEqual([]);
  });

  it('⌃A widens to every project, ⌘Enter opens in a new tab, Esc clears the search and then closes', async () => {
    const user = userEvent.setup();
    act(() => useLayout.getState().openSession(idOf('Charter + research')));
    render(<Sidebar />);
    await openFromRow(user);
    await user.keyboard('{Control>}a{/Control}');
    expect(within(picker()).getByRole('button', { name: /^All projects/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(picker()).getByTestId('resume-scope').textContent).toBe('All projects');
    expect(options()).toContain('Quota reset recovery');
    expect(options()).toContain('Terminal workflow notes');
    await user.keyboard('quota{Meta>}{Enter}{/Meta}');
    const panes = currentSet(useLayout.getState().main).panes;
    expect(panes[0].tabs.map((t) => (t.kind === 'session' ? t.appSessionId : t.id))).toEqual([idOf('Charter + research'), idOf('Quota reset recovery')]);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ appSessionId: idOf('Quota reset recovery') });
    await openFromRow(user);
    expect(within(picker()).getByRole('button', { name: /^All projects/ }).getAttribute('aria-pressed')).toBe('false'); // a fresh chooser
    await user.keyboard('drag');
    await user.keyboard('{Escape}');
    expect(within(picker()).getByRole('combobox')).toHaveProperty('value', '');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Resume session' })).toBeNull();
  });

  it('an Escape that ends an IME composition leaves the chooser open, even on an empty search', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await openFromRow(user);
    const search = within(picker()).getByRole('combobox');
    expect(search).toHaveProperty('value', '');
    fireEvent.keyDown(search, { key: 'Escape', code: 'Escape', isComposing: true });
    expect(screen.getByRole('dialog', { name: 'Resume session' })).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Escape', code: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Resume session' })).toBeNull();
  });

  it('dismissed, the chooser returns focus to the control that opened it; an opened session keeps it', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const button = within(row('MAWS')).getByRole('button', { name: 'Resume a session in MAWS' });
    await user.click(button);
    await user.click(within(picker()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Resume session' })).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.contextMenu(row('MAWS'));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Resume…' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Resume session' })).toBeNull();
    expect(document.activeElement, 'from the context menu: the project row').toBe(row('MAWS'));
    // the row's hover actions hide once the pointer leaves the row, and a browser focuses no hidden control (happy-dom
    // does, so the opener here refuses focus as Chromium's would)
    await user.click(button);
    const focus = vi.spyOn(button, 'focus').mockImplementation(() => undefined);
    await user.click(within(picker()).getByRole('button', { name: 'Close' }));
    expect(document.activeElement, 'an opener hidden since: its row').toBe(row('MAWS'));
    focus.mockRestore();
    await user.click(button);
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    const stop = useLayout.subscribe(() => elsewhere.isConnected && elsewhere.focus()); // the opened tab takes the keyboard
    await user.keyboard('{Enter}');
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session' });
    expect(document.activeElement).toBe(elsewhere);
    stop();
    elsewhere.remove();
  });

  it('a filter button keeps Enter and Space: Tab from the search to All projects, Enter presses it and opens nothing', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await openFromRow(user);
    expect(document.activeElement).toBe(within(picker()).getByRole('combobox'));
    await user.tab();
    const all = within(picker()).getByRole('button', { name: /^All projects/ });
    expect(document.activeElement).toBe(all);
    await user.keyboard('{Enter}');
    expect(all.getAttribute('aria-pressed')).toBe('true');
    expect(picker()).toBeTruthy();
    expect(activeTab(useLayout.getState().main)).toBeNull();
    await user.keyboard(' ');
    expect(all.getAttribute('aria-pressed')).toBe('false');
    expect(activeTab(useLayout.getState().main)).toBeNull();
  });

  it('⌃B keeps the checkout’s branch, the search finds a branch, and the project’s context menu offers Resume… too', async () => {
    const user = userEvent.setup();
    fillStores({ ...nine, sessions: nine.sessions.map((r) => (r.projectId === 'proj-maws' ? { ...r, branch: r.title.text === 'Fix sidebar drag' ? 'master' : 'feature/chooser' } : r)) });
    render(<Sidebar />);
    fireEvent.contextMenu(row('MAWS'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent).slice(0, 2)).toEqual(['New chat', 'Resume…']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Resume…' }));
    expect(within(picker()).getAllByTestId('row-branch').map((b) => b.textContent).sort()).toEqual(['⎇ chooser', '⎇ chooser', '⎇ chooser', '⎇ master']);
    await user.keyboard('chooser');
    expect(options()).toHaveLength(3);
    await user.clear(within(picker()).getByRole('combobox'));
    await user.keyboard('{Control>}b{/Control}');
    await waitFor(() => expect(options()).toEqual(['Fix sidebar drag']));
  });
});

// W11 (I1): a session launched from MAWS carries its first prompt from the moment its record exists (main seeds it at
// launch), and a record with no title yet reads "New chat", never a blank row.
describe('a freshly launched session', () => {
  beforeEach(() => fillStores(nine));

  it('its row reads its first prompt, and a record without a title reads "New chat"', () => {
    const base = page.sessions.find((r) => r.projectId === at('proj-maws'))!;
    const now = new Date().toISOString();
    const launched = { ...base, appId: at('11111111-1111-4111-8111-111111111111' as AppSessionId), engineSessionId: null, title: { text: 'Fix the drag handle', source: 'none' as const }, pinned: false, unread: false, createdAt: now, updatedAt: now };
    const blank = { ...launched, appId: at('22222222-2222-4222-8222-222222222222' as AppSessionId), title: { text: '', source: 'none' as const } };
    act(() => {
      useSessions.getState().applyChanged({ record: launched, cause: 'live', revision: 1000 }, TEST_MACHINE);
      useSessions.getState().applyChanged({ record: blank, cause: 'live', revision: 1001 }, TEST_MACHINE);
    });
    expand('proj-maws');
    act(() => useLayout.getState().setSidebar({ sort: 'recency' })); // the newest two, among the five shown
    render(<Sidebar />);
    expect(row('Fix the drag handle').textContent).toContain('Fix the drag handle');
    expect(row('New chat').textContent).toContain('New chat');
  });
});

describe('sidebar keyboard', () => {
  beforeEach(() => fillStores(nine));

  it('the tree is one tab stop that arrows move through; Enter expands, ArrowRight steps in', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const stops = within(projectsTree()).getAllByRole('treeitem').filter((t) => t.tabIndex === 0);
    expect(stops.map(label)).toEqual(['claude-usage-menubar']);
    stops[0].focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(row('MAWS'));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(row('This Mac'));
    await user.keyboard('{ArrowUp}{Enter}');
    expect(expanded()).toEqual([at('proj-maws')]);
    expect(document.activeElement).toBe(row('MAWS'));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(row('Workstation north star'));
  });

  it('in a project arrows move, Enter opens a session, ArrowLeft steps out and then collapses, Space expands', async () => {
    const user = userEvent.setup();
    expand('proj-maws');
    render(<Sidebar />);
    row('MAWS').focus();
    await user.keyboard('{ArrowRight}{ArrowDown}{Enter}');
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: idOf('Fix sidebar drag') });
    await user.keyboard('{ArrowDown}{Enter}'); // I2: Enter replaces the shown session, as a click does
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: idOf('Sidebar interaction pass') });
    expect(currentSet(useLayout.getState().main).panes[0].tabs.map((t) => t.id)).toEqual([`session:${idOf('Sidebar interaction pass')}`]);
    expect(row('Sidebar interaction pass').getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(row('MAWS'));
    await user.keyboard('{ArrowLeft}');
    expect(expanded()).toEqual([]);
    await user.keyboard(' ');
    expect(expanded()).toEqual([at('proj-maws')]);
  });

  // W12 (I3) on W11's tree: a project's activation is one path for the pointer and the keys. UX wave U13a: it expands or
  // collapses the row and changes nothing else; the one strip shows the same tabs before and after.
  it('a click, Enter, ArrowRight or Space on a project row or a machine’s row leaves the strip as it was', async () => {
    const user = userEvent.setup();
    act(() => useLayout.getState().openSession(idOf('Fix sidebar drag')));
    const strip = useLayout.getState().main;
    render(<Sidebar />);
    await toggle(user, 'codex_somersault');
    expect(useLayout.getState().main).toBe(strip);
    row('MAWS').focus();
    await user.keyboard('{Enter}');
    expect(useLayout.getState().main).toBe(strip);
    row('claude-usage-menubar').focus();
    await user.keyboard('{ArrowRight}');
    expect(useLayout.getState().main).toBe(strip);
    expect(expanded()).toEqual([at('proj-codex-somersault'), at('proj-maws'), at('proj-claude-usage-menubar')]);
    row('This Mac').focus();
    await user.keyboard(' ');
    expect(expanded()).toContain(machineKey(TEST_MACHINE));
    expect(useLayout.getState().main).toBe(strip);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: idOf('Fix sidebar drag') });
  });

  it('the selected session is the tree’s stop when it is on screen', () => {
    expand('proj-maws');
    act(() => useLayout.getState().openSession(idOf('Fix sidebar drag')));
    render(<Sidebar />);
    expect(within(projectsTree()).getAllByRole('treeitem').filter((t) => t.tabIndex === 0).map(label)).toEqual(['Fix sidebar drag']);
  });

  it('ArrowDown from the search enters the tree when no session waits', async () => {
    fillStores({ ...nine, attention: [] });
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByRole('searchbox', { name: 'Search projects and sessions' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(row('claude-usage-menubar'));
  });
});

describe('new sessions from the sidebar', () => {
  beforeEach(() => fillStores(nine));

  it('"+" is disabled with "Not available here" while no creator is registered', () => {
    render(<Sidebar />);
    const plus = within(row('MAWS')).getByRole('button', { name: 'New chat in MAWS' }) as HTMLButtonElement;
    expect(plus.disabled).toBe(true);
    expect(plus.title).toBe('Not available here');
  });

  it('with a creator, a project row’s "+" opens an unstarted session tab in that project without expanding it, and the sidebar does not list it', async () => {
    const user = userEvent.setup();
    const creator = vi.fn(async () => at('app-new-1' as AppSessionId));
    offs.push(registerSessionCreator(creator));
    render(<Sidebar />);
    await user.click(within(row('MAWS')).getByRole('button', { name: 'New chat in MAWS' }));
    expect(creator).toHaveBeenCalledWith(at('proj-maws'));
    expect(expanded()).toEqual([]);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: at('app-new-1') });
    expect(useSessions.getState().unstarted.get(at('app-new-1' as AppSessionId))?.projectId).toBe(at('proj-maws'));
    expand('proj-maws');
    expect(sessionRows(row('MAWS'))).toHaveLength(4);
  });
});

// U13a (A3): a project row's "+" and its menu's New chat are New chat for their row, so an empty chat of the project in the
// strip comes to the front instead of a second, from behind a tab of another project.
describe('New chat from a project row', () => {
  const EMPTY = at('app-empty-1' as AppSessionId);
  beforeEach(() => {
    fillStores(nine);
    offs.push(registerEmptyChats({ isEmpty: (id) => id === EMPTY, discard: async () => true }));
    useSessions.getState().addUnstarted(EMPTY, { projectId: at('proj-maws' as ProjectId), createdAt: '2026-11-12T09:00:00.000Z' });
    useLayout.getState().openTab({ kind: 'session', appSessionId: EMPTY });
    useLayout.getState().openSession(idOf('Quota reset recovery'), { how: 'tab' });
  });

  it.each([
    ['its "+"', () => userEvent.click(within(row('MAWS')).getByRole('button', { name: 'New chat in MAWS' }))],
    ['its menu’s New chat', async () => {
      fireEvent.contextMenu(row('MAWS'));
      fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'New chat' }));
    }],
  ])('%s brings the project’s empty chat to the front and makes none', async (_control, press) => {
    const creator = vi.fn(async () => at('app-new-1' as AppSessionId));
    offs.push(registerSessionCreator(creator));
    render(<Sidebar />);
    await press();
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(creator).not.toHaveBeenCalled();
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: EMPTY });
    expect(currentSet(useLayout.getState().main).panes[0].tabs.map((t) => t.id)).toEqual([`session:${EMPTY}`, `session:${idOf('Quota reset recovery')}`]);
  });
});

describe('sidebar states', () => {
  it('shows placeholder rows until both snapshots have loaded', () => {
    fillStores(nine, { loaded: false });
    render(<Sidebar />);
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(6);
    act(() => useSessions.setState({ loaded: true }));
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(6);
    act(() => useAttention.setState({ loaded: true }));
    expect(screen.queryAllByTestId('skeleton-row')).toHaveLength(0);
  });

  it('a project revealed while the sidebar still loads is listed and focused once it loads, past the first five', () => {
    const extra = (n: number): ProjectRecord => ({ ...nine.projects[0], id: `proj-x${n}` as ProjectId, name: `extra-${n}`, directory: `/x/extra-${n}`, order: 10 + n, createdAt: `2026-08-0${n}T00:00:00.000Z` });
    fillStores({ ...nine, projects: [...nine.projects, extra(1), extra(2), extra(3), extra(4)] }, { loaded: false });
    render(<Sidebar />);
    act(() => revealProject(at('proj-x2' as ProjectId))); // the sixth project: folded under "Show more" on a plain load
    act(() => {
      useSessions.setState({ loaded: true });
      useAttention.setState({ loaded: true });
    });
    expect(projectRows()).toContain('extra-2');
    expect(document.activeElement).toBe(row('extra-2'));
    expect(row('extra-2').getAttribute('aria-expanded')).toBe('true');
  });

  it('an empty workspace reads "No projects yet" with Add project, and the New chat row above opens a chat in no project', async () => {
    fillStores(scenarioFile('empty'));
    const { rerender } = render(<Sidebar />);
    expect(screen.getByText('No projects yet')).toBeTruthy();
    expect(screen.queryByText('No projects match')).toBeNull();
    expect(screen.queryByText('reconnecting')).toBeNull(); // ticket 407: an ordinary empty workspace
    expect((screen.getByRole('button', { name: 'Add project' }) as HTMLButtonElement).disabled).toBe(false);
    const create = screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    offs.push(registerSessionCreator(async () => at('app-new-2' as AppSessionId)));
    rerender(<Sidebar />);
    expect(create.disabled).toBe(false);
    await userEvent.setup().click(create);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: at('app-new-2') });
    expect(useSessions.getState().unstarted.get(at('app-new-2' as AppSessionId))?.projectId).toBeNull();
  });

  // UX wave U7, ticket 407: while a read of this Mac's sessions is refused (its daemon restarting), the sidebar draws what events
  // delivered and says so beside the Projects heading, instead of reading as an empty workspace.
  it('says “reconnecting” beside the Projects heading while this Mac’s read is refused, drawing the rows it has and no “No projects yet”', () => {
    fillStores(scenarioFile('empty'));
    act(() => useSessions.getState().setReconnecting(true));
    expand('other');
    render(<Sidebar />);
    expect(within(screen.getByRole('status')).getByText('reconnecting')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Projects' }).textContent).toBe('Projects');
    expect(screen.queryByText('No projects yet')).toBeNull();
    act(() => {
      for (const [n, text] of ['Draft one', 'Draft two'].entries())
        useSessions.getState().applyChanged({ record: recordOnPage(record(`delivered-${n}`, { title: { text, source: 'user' } })), cause: 'discovered', revision: n + 1 }, TEST_MACHINE);
    });
    expect(sessionRows(row('This Mac'))).toEqual(expect.arrayContaining(['Draft one', 'Draft two']));
    expect(screen.getByText('reconnecting')).toBeTruthy();
    act(() => useSessions.getState().setReconnecting(false));
    expect(screen.queryByText('reconnecting')).toBeNull();
    expect(sessionRows(row('This Mac'))).toEqual(expect.arrayContaining(['Draft one', 'Draft two']));
  });
});

describe('sidebar at scale', () => {
  it('lists the projects and expands a 120-session project to its first five, fast', async () => {
    fillStores(scenarioFile('many-sessions'));
    let started = performance.now();
    render(<Sidebar />);
    let elapsed = performance.now() - started;
    if (elapsed > 200) console.info(`[sidebar] many-sessions list mounted in ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(1000);
    expect(projectRows()).toHaveLength(3);
    started = performance.now();
    await toggle(userEvent.setup(), 'MAWS');
    elapsed = performance.now() - started;
    if (elapsed > 300) console.info(`[sidebar] a 120-session project expanded in ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(2000);
    expect(sessionRows(row('MAWS'))).toHaveLength(5);
  });
});

// C11 start: the footer's gear opens Settings once C11 registers settings.open (C11 execution document, M5); UX wave U7b:
// the Settings dialog, over the tabs, which it leaves as they were
describe('the footer gear', () => {
  beforeEach(() => fillStores(nine));

  it('is disabled until settings.open has a handler, then opens the Settings dialog', () => {
    render(<Sidebar />);
    const gear = screen.getByRole('button', { name: 'Workspace settings' }) as HTMLButtonElement;
    expect(gear.disabled).toBe(true);
    act(() => void offs.push(registerGatewayActions()));
    expect(gear.disabled).toBe(false);
    expect(gear.title).toBe('Settings · ⌘,');
    const strip = useLayout.getState().main;
    fireEvent.click(gear);
    expect(useLayout.getState().settings).toEqual({ section: null });
    expect(useLayout.getState().main).toBe(strip);
    act(() => useLayout.getState().closeSettings());
  });
});
// C11 end

// UX wave U7b (M5): under a page its row is current and no session row is selected, the session behind it not being on
// screen; Back gives both back.
describe('the sidebar under a page', () => {
  beforeEach(() => fillStores(nine));

  it('marks the open page’s row current and selects no session row, until Back', () => {
    expand('proj-maws');
    act(() => useLayout.getState().openSession(idOf('Fix sidebar drag')));
    render(<Sidebar />);
    const current = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-current');
    expect(row('Fix sidebar drag').getAttribute('aria-selected')).toBe('true');
    act(() => useLayout.getState().openDestination({ kind: 'projects' }));
    expect(row('Fix sidebar drag').getAttribute('aria-selected')).not.toBe('true');
    expect(current('Projects')).toBe('page');
    expect(current('Customize')).toBeNull();
    act(() => useLayout.getState().openDestination({ kind: 'library' }));
    expect(current('Artifacts')).toBe('page');
    expect(current('Projects')).toBeNull();
    act(() => useLayout.getState().closeDestination());
    expect(row('Fix sidebar drag').getAttribute('aria-selected')).toBe('true');
    expect(current('Artifacts')).toBeNull();
  });

  it('opens each row’s page from the row, the strip left as it was', () => {
    render(<Sidebar />);
    const strip = useLayout.getState().main;
    const current = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-current');
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(useLayout.getState().destination).toEqual({ kind: 'customize', view: 'mine', show: 'plugins' });
    expect(current('Customize')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    expect(useLayout.getState().destination).toEqual({ kind: 'projects' });
    expect(current('Projects')).toBe('page');
    expect(current('Customize')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Artifacts' }));
    expect(useLayout.getState().destination).toEqual({ kind: 'library' });
    expect(current('Artifacts')).toBe('page');
    expect(useLayout.getState().main).toBe(strip);
    act(() => useLayout.getState().closeDestination());
  });
});

// C12 start: the memory budget's released mark (C12 execution document, Interfaces "Surfaces of the budget"): one muted
// word on an idle row, with the release's time and budget in its title; no glyph or unread change.
describe('a released session’s row', () => {
  beforeEach(() => {
    fillStores(nine);
    window.maws = fakeClient().client as unknown as PreloadBridge;
  });

  it('reads idle with the muted word released, and says when and why in its title', () => {
    const id = idOf('Settings idle probe');
    const when = new Date(2026, 8, 29, 14, 2).toISOString();
    const digest = useSessions.getState().digests.get(id)!;
    act(() => useSessions.getState().applyDigest({ ...digest, released: { at: when, reason: 'budget', limitKiB: 8 * 1024 * 1024 }, revision: digest.revision + 1 }, TEST_MACHINE));
    expand('proj-claude-usage-menubar');
    render(<Sidebar />);
    const mark = within(row('Settings idle probe')).getByText('released');
    expect(mark.getAttribute('title')).toBe(`Released at ${formatClock(Date.parse(when))} to stay under the 8 GB memory budget · Send resumes it`);
    expect(within(row('Settings idle probe')).getByRole('img', { name: 'Idle' }).textContent).toBe('○'); // the idle glyph, unchanged
    expect(within(row('Settings idle probe')).queryByLabelText('Unread')).toBeNull();
    expect(screen.getAllByText('released')).toHaveLength(1);
  });
});
// C12 end

// E3 start: side threads and forks under their parent (E3 execution document, Design §6, M4's decisions)
describe('the sidebar’s lineage nesting', () => {
  const parent = () => nine.sessions.find((r) => r.title.text === 'Charter + research')!;
  const child = (id: string, title: string, kind: 'side-thread' | 'fork', minute: number, parentId = parent().appId) =>
    record(id, {
      projectId: parent().projectId,
      title: { text: title, source: 'user' },
      createdAt: `2026-10-06T10:0${minute}:00.000Z`,
      updatedAt: '2020-01-01T00:00:00.000Z', // oldest of all: only the nesting puts it next to its parent
      lineage:
        kind === 'side-thread'
          ? { kind, parentAppSessionId: parentId, parentEngineSessionId: null, anchor: { kind: 'file-line', locator: '/r/src/x.ts#L42', label: 'x.ts:42', path: '/r/src/x.ts', line: 42 }, openedBy: 'comment' }
          : { kind, parentAppSessionId: parentId, parentEngineSessionId: null, openedBy: 'fork' },
    });

  it('draws a thread and a fork under their parent, indented and marked, and ArrowLeft steps back to the parent', async () => {
    fillStores({ ...nine, sessions: [...nine.sessions, child('side-1', 'x.ts:42', 'side-thread', 1), child('fork-1', 'Charter (fork)', 'fork', 2)] });
    expand('proj-maws');
    render(<Sidebar />);
    const titles = sessionRows(row('MAWS'));
    expect(titles.slice(titles.indexOf('Charter + research'), titles.indexOf('Charter + research') + 3)).toEqual(['Charter + research', 'x.ts:42', 'Charter (fork)']);
    expect(row('x.ts:42').getAttribute('aria-level')).toBe('3');
    expect(row('Charter + research').getAttribute('aria-level')).toBe('2');
    expect(within(row('x.ts:42')).getByTestId('row-nested').textContent).toBe('↳');
    expect(within(row('x.ts:42')).queryByTestId('row-lineage')).toBeNull(); // titled by its label already
    row('Charter (fork)').focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(row('Charter + research'));
  });

  // UX wave U7, O-16 (Interfaces §D; the review's finding): under the Hidden row every row's keyboard parent is the Hidden
  // row, a lineage child's included, while it keeps its lineage's depth and mark
  it('a hidden thread of a hidden parent keeps its mark and depth, and ArrowLeft from it lands on the Hidden row', async () => {
    fillStores({ ...nine, sessions: [...nine.sessions, child('side-1', 'x.ts:42', 'side-thread', 1)] });
    const hidden = { at: '2026-11-12T10:00:00.000Z', armedAt: null };
    window.maws = fakeClient({ 'layout.get': { value: { version: 1, hidden: { [idOf('Charter + research')]: hidden, [at('side-1')]: hidden } } }, 'layout.set': undefined }).client as unknown as PreloadBridge;
    await act(() => useHidden.getState().load());
    expand('proj-maws');
    const user = userEvent.setup();
    render(<Sidebar />);
    const hiddenRow = within(row('MAWS')).getByRole('treeitem', { name: 'Hidden, 2 sessions' });
    await user.click(hiddenRow);
    expect(row('x.ts:42').getAttribute('aria-level')).toBe('4');
    expect(within(row('x.ts:42')).getByTestId('row-nested').textContent).toBe('↳');
    act(() => row('x.ts:42').focus());
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(hiddenRow);
  });

  it('a thread of a thread carries its real depth in aria-level, indented as its parent is', () => {
    fillStores({ ...nine, sessions: [...nine.sessions, child('side-1', 'x.ts:42', 'side-thread', 1), child('side-2', 'Nested thread', 'side-thread', 2, 'side-1' as AppSessionId)] });
    expand('proj-maws');
    render(<Sidebar />);
    expect(row('x.ts:42').getAttribute('aria-level')).toBe('3');
    expect(row('Nested thread').getAttribute('aria-level')).toBe('4');
    expect(within(row('Nested thread')).getByTestId('row-nested').textContent).toBe('↳');
    expect(row('Nested thread').className).toBe(row('x.ts:42').className); // the visual indent stays one step
  });

  it('a thread whose parent is not listed is a root saying whose it is', () => {
    fillStores({ ...nine, sessions: [...nine.sessions.filter((r) => r.appId !== parent().appId), child('side-1', 'Renamed thread', 'side-thread', 1)] });
    expand('proj-maws');
    render(<Sidebar />);
    expect(row('Renamed thread').getAttribute('aria-level')).toBe('2');
    expect(within(row('Renamed thread')).queryByTestId('row-nested')).toBeNull();
    expect(within(row('Renamed thread')).getByTestId('row-lineage').textContent).toBe('↳ side thread');
  });
});
// E3 end

describe('deliberately selected projects', () => {
  it('keeps discovered projects out of the tree, but offers them from Add project and preserves cross-project attention', async () => {
    fillStores({ ...nine, projects: nine.projects.map((p) => ({ ...p, discovered: p.name === 'MAWS' })), sessions: nine.sessions.map((r) => r.projectId === 'proj-maws' ? { ...r, pinned: false, holder: { kind: 'none' as const } } : r), digests: [], engine: [], attention: nine.attention.filter((a) => !nine.sessions.some((r) => r.appId === a.appSessionId && r.projectId === 'proj-maws')) });
    const fake = fakeClient({ 'session.projects.add': ({ directory }: { directory: string }) => {
      const projects = nine.projects.map((p) => ({ ...p, ...(p.directory === directory ? { discovered: false } : {}) }));
      useSessions.getState().applyProjects({ projects: projects.map(projectOnPage), revision: useSessions.getState().revision + 1 }, TEST_MACHINE);
      return projects.find((p) => p.directory === directory)!;
    } });
    window.maws = fake.client as unknown as PreloadBridge;
    render(<Sidebar />);
    expect(screen.queryByRole('treeitem', { name: 'MAWS' })).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Needs you' })).getByRole('button', { name: /Quota reset recovery/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }));
    const chooser = await screen.findByRole('dialog', { name: 'Add project' });
    await userEvent.click(within(chooser).getByRole('button', { name: /Add MAWS/ }));
    await waitFor(() => expect(screen.getByRole('treeitem', { name: 'MAWS' })).toBeTruthy());
    expect(fake.invoked('session.projects.add')).toEqual([{ directory: nine.projects.find((p) => p.name === 'MAWS')!.directory }]);
  });
});

// P5 O6 M5 ("What a checkout is"): a folder nobody opened is no row, whatever work it holds; its sessions sit under its
// machine's row, and a hidden one's nowhere, while Needs you still lists what waits.
it('lists a discovered project’s sessions under its machine’s row, a hidden one’s nowhere', () => {
  fillStores({ ...nine, projects: nine.projects.map((p) => ({ ...p, discovered: p.name === 'MAWS' })) });
  expand('other');
  render(<Sidebar />);
  expect(screen.queryByRole('treeitem', { name: 'MAWS' })).toBeNull();
  expect(sessionRows(row('This Mac'))).toEqual(expect.arrayContaining(['Fix sidebar drag', 'Terminal workflow notes']));
  act(() => useSessions.getState().applyProjects({ projects: page.projects.map((p) => ({ ...p, discovered: p.name === 'MAWS', hidden: p.name === 'MAWS' })), revision: useSessions.getState().revision + 1 }, TEST_MACHINE));
  expect(sessionRows(row('This Mac'))).toEqual(['Terminal workflow notes']);
  expect(within(screen.getByRole('list', { name: 'Needs you' })).getByRole('button', { name: /Fix sidebar drag/ })).toBeTruthy();
});

it('filters to the current session project, toggles back, and supports a chosen project set without filtering Needs you', async () => {
  fillStores(nine);
  useLayout.getState().openSession(idOf('Charter + research'));
  render(<Sidebar />);
  const filter = screen.getByRole('button', { name: 'Filter projects' });
  await userEvent.click(filter);
  expect(projectRows()).toEqual(['MAWS']);
  expect(within(screen.getByRole('list', { name: 'Needs you' })).getAllByRole('button')).toHaveLength(3);
  await userEvent.click(filter);
  expect(projectRows()).toHaveLength(4);
  await userEvent.hover(filter);
  const chooser = await screen.findByRole('dialog', { name: 'Filter projects' });
  await userEvent.click(within(chooser).getByRole('checkbox', { name: 'MAWS' }));
  await userEvent.click(within(chooser).getByRole('checkbox', { name: 'claude-usage-menubar' }));
  expect(projectRows().sort()).toEqual(['MAWS', 'claude-usage-menubar']);
  await userEvent.click(screen.getByRole('searchbox'));
  await toggle(userEvent.setup(), 'MAWS');
  expect(row('MAWS').getAttribute('aria-expanded')).toBe('true');
  expect(projectRows()).toHaveLength(2);
});

// P5 O6 M5 (OX3; P5 Decision Log 28, T1 to T4): two machines' checkouts and sessions in one tree.
describe('the sidebar across machines', () => {
  const studio = (id: string) => addressOf(OTHER_MACHINE, id);
  const maws = { key: 'repo:maws' as OrgKey, name: 'MAWS', source: 'remote' as const, smnsId: null };
  const projects = [
    project(at('maws'), 0, { name: 'MAWS', org: maws }),
    project(studio('maws-b'), 0, { name: 'maws-b', org: maws }),
    project(studio('notes'), 1, { name: 'notes', org: { key: `folder:${OTHER_MACHINE}:notes` as OrgKey, name: 'notes', source: 'folder', smnsId: null } }),
    project(studio('tmp'), 2, { name: 'tmp', discovered: true, org: { key: `folder:${OTHER_MACHINE}:tmp` as OrgKey, name: 'tmp', source: 'folder', smnsId: null } }),
  ];
  const sessions = [
    record(at('here'), { projectId: at('maws') as ProjectId, title: { text: 'Sidebar pass', source: 'user' }, updatedAt: '2026-10-27T10:00:00Z' }),
    record(studio('there'), { projectId: studio('maws-b') as ProjectId, title: { text: 'Studio build', source: 'user' }, updatedAt: '2026-10-27T09:00:00Z' }),
    record(studio('jot'), { projectId: studio('notes') as ProjectId, title: { text: 'Jot', source: 'user' }, updatedAt: '2026-10-27T08:00:00Z' }),
    record(studio('scratch'), { projectId: studio('tmp') as ProjectId, title: { text: 'Scratch', source: 'user' } }),
    record(studio('home'), { projectId: null, title: { text: 'Home errand', source: 'user' } }),
    record(at('home-here'), { projectId: null, title: { text: 'Local errand', source: 'user' } }),
  ];
  const fill = (over: (p: ProjectRecord) => ProjectRecord = (p) => p) =>
    useSessions.setState({ loaded: true, projects: new Map(projects.map((p) => [p.id, over(p)])), records: new Map(sessions.map((r) => [r.appId, r])) });
  const roster = (studioState: 'up' | 'down') =>
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-27T10:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'Studio', local: false, state: studioState, since: '2026-10-27T10:00:00Z', generation: 0 },
    ]);
  const chip = (title: string) => row(title).querySelector('[data-machine-chip]')?.textContent ?? null;
  beforeEach(() => {
    useAttention.setState({ loaded: true });
    roster('up');
  });
  afterEach(() => useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() }));

  it('lists one row per org project with both machines’ sessions, then each machine’s own row, this machine’s first', () => {
    fill();
    act(() => useLayout.getState().setSidebar({ expandedProjects: ['repo:maws', machineKey(TEST_MACHINE), machineKey(OTHER_MACHINE)] as ProjectKey[] }));
    render(<Sidebar />);
    expect(projectRows()).toEqual(['MAWS', 'notes', 'This Mac', 'Studio']);
    expect(sessionRows(row('MAWS'))).toEqual(['Sidebar pass', 'Studio build']);
    expect(row('MAWS').getAttribute('data-menu')).toBe(`project:${at('maws')}`); // the local checkout acts for the row
    expect(sessionRows(row('This Mac'))).toEqual(['Local errand']);
    expect(sessionRows(row('Studio')).sort()).toEqual(['Home errand', 'Scratch']); // a folder nobody opened, and no folder
    expect(row('Studio').getAttribute('data-menu')).toBe(`machine:${OTHER_MACHINE}`);
  });

  it('Hide from the context menu of a record at another machine’s address takes it under Hidden, where its menu offers Unhide', async () => {
    window.maws = fakeClient({ 'layout.get': { value: null }, 'layout.set': undefined }).client as unknown as PreloadBridge;
    fill();
    act(() => useLayout.getState().setSidebar({ expandedProjects: [maws.key] as ProjectKey[] }));
    render(<Sidebar />);
    fireEvent.contextMenu(row('Studio build'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    expect(screen.queryByRole('treeitem', { name: 'Studio build' })).toBeNull();
    await userEvent.click(within(row('MAWS')).getByRole('treeitem', { name: 'Hidden, 1 session' }));
    expect(row('Studio build').dataset.indented).toBe('true');
    fireEvent.contextMenu(row('Studio build'));
    expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Unhide' })).toBeTruthy();
  });

  it('marks another machine’s session rows with @name, this machine’s with nothing, and the project row with no machine', () => {
    fill();
    act(() => useLayout.getState().setSidebar({ expandedProjects: ['repo:maws'] as ProjectKey[] }));
    render(<Sidebar />);
    expect(chip('Studio build')).toBe('@Studio');
    expect(chip('Sidebar pass')).toBeNull();
    expect(row('MAWS').querySelector('[data-project-line] [data-machine-chip]')).toBeNull();
  });

  it('greys an offline machine’s rows in place, "offline" where the chip was, and an org row only when all its machines are', () => {
    fill();
    roster('down');
    act(() => useLayout.getState().setSidebar({ expandedProjects: ['repo:maws', `folder:${OTHER_MACHINE}:notes`] as ProjectKey[] }));
    render(<Sidebar />);
    expect(projectRows()).toEqual(['MAWS', 'notes, machine offline', 'This Mac', 'Studio, machine offline']); // the order unchanged
    const offline = row('Studio build, machine offline');
    expect(offline.dataset.offline).toBe('true');
    expect(chip('Studio build, machine offline')).toBe('offline');
    expect(offline.querySelector('[data-session-title]')!.className).toContain('text-fg-faint');
    expect(row('Sidebar pass').dataset.offline).toBeUndefined();
    expect(row('MAWS').dataset.offline).toBeUndefined();
  });

  // The UX wave, U9 (O-39, A2): a machine whose link connects, or reconnects within the minute an act is held, is not
  // greyed: its rows keep their @name chip, and its project rows read as live
  it('greys nothing of a machine that connects or reconnects, its rows keeping their @name chip', () => {
    fill();
    act(() => useLayout.getState().setSidebar({ expandedProjects: ['repo:maws', `folder:${OTHER_MACHINE}:notes`] as ProjectKey[] }));
    const here = { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-27T10:00:00Z', generation: 0 } as const;
    for (const studio of [
      { state: 'connecting', since: new Date().toISOString(), generation: 0 },
      { state: 'down', since: new Date().toISOString(), generation: 1 },
    ] as const) {
      act(() => useMachines.getState().applyRoster([here, { ref: OTHER_MACHINE, name: 'Studio', local: false, ...studio }]));
      render(<Sidebar />);
      expect(projectRows(), studio.state).toEqual(['MAWS', 'notes', 'This Mac', 'Studio']);
      expect(row('Studio build').dataset.offline).toBeUndefined();
      expect(chip('Studio build')).toBe('@Studio');
      cleanup();
    }
  });

  it('marks Needs you rows with their machine, greys them in place while it is offline, and names no project by its machine', () => {
    fill();
    const waits = [studio('there'), studio('home'), at('home-here')] as AppSessionId[];
    useAttention.setState({ loaded: true, bySession: new Map(waits.map((id, i) => [id, [item(id, 'permission', `2026-10-27T0${i}:00:00Z`)]])), version: useAttention.getState().version + 1 });
    render(<Sidebar />);
    const buttons = () => within(screen.getByRole('list', { name: 'Needs you' })).getAllByRole('button');
    const chips = () => buttons().map((b) => b.querySelector('[data-machine-chip]')?.textContent ?? null);
    expect(screen.getByRole('heading', { name: 'Needs you · 3' })).toBeTruthy();
    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual(['maws-b · Studio build · Approval needed', 'Studio · Home errand · Approval needed', 'This Mac · Local errand · Approval needed']);
    expect(chips()).toEqual(['@Studio', '@Studio', null]);
    act(() => roster('down'));
    expect(screen.getByRole('heading', { name: 'Needs you · 3' })).toBeTruthy(); // the count and the order unchanged
    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'maws-b · Studio build · Approval needed, machine offline',
      'Studio · Home errand · Approval needed, machine offline',
      'This Mac · Local errand · Approval needed',
    ]);
    expect(chips()).toEqual(['offline', 'offline', null]);
    expect(buttons().map((b) => b.dataset.offline ?? null)).toEqual(['true', 'true', null]);
    expect(within(buttons()[0]).getByText('Studio build').className).toContain('text-fg-faint');
  });

  it('shows an org row while one machine’s checkout is listed, without the hidden checkout’s sessions', () => {
    fill((p) => (p.id === at('maws') ? { ...p, hidden: true } : p));
    act(() => useLayout.getState().setSidebar({ expandedProjects: ['repo:maws'] as ProjectKey[] }));
    render(<Sidebar />);
    expect(sessionRows(row('MAWS'))).toEqual(['Studio build']);
    expect(row('MAWS').getAttribute('data-menu')).toBe(`project:${studio('maws-b')}`);
    expect((within(row('MAWS')).getByRole('button', { name: 'New chat in MAWS' }) as HTMLButtonElement).disabled).toBe(true); // another machine's: O7
  });
});

// P5 O8 M2 (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "Drawing"): another machine's sessions as their
// listings say them, beside this Mac's records.
describe('listed rows from another machine', () => {
  const studio = (id: string) => addressOf(OTHER_MACHINE, id) as AppSessionId;
  const ORG = 'repo:maws' as OrgKey;
  const maws = project(at('maws'), 0, { name: 'MAWS', org: { key: ORG, name: 'MAWS', source: 'remote', smnsId: null } });
  const notes = project(at('notes'), 1, { name: 'notes', hidden: true, org: { key: 'repo:notes' as OrgKey, name: 'notes', source: 'remote', smnsId: null } });
  const here = record(at('here'), { projectId: maws.id, title: { text: 'Sidebar pass', source: 'user' }, updatedAt: '2026-10-28T09:00:00Z' });
  const listedOn = (id: string, over: Partial<ListedSession> = {}): ListedSession => ({ ...remoteRow(OTHER_MACHINE, id, { orgKey: ORG, issued: '2026-10-28T10:00:00Z' }), appId: studio(id), ...over });
  const fill = (listed: ListedSession[], sessions: SessionRecord[] = [here]) =>
    useSessions.setState({ loaded: true, projects: new Map([maws, notes].map((p) => [p.id, p])), records: new Map(sessions.map((r) => [r.appId, r])), listed: new Map(listed.map((l) => [l.appId, l])) });
  const roster = (studioState: 'up' | 'down') =>
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-28T10:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'Studio', local: false, state: studioState, since: '2026-10-28T10:00:00Z', generation: 0 },
    ]);
  const drawn = (el: HTMLElement) => within(el).queryAllByRole('treeitem').filter((t) => t.dataset.kind === 'session' || t.dataset.kind === 'listed').map((t) => [label(t), t.dataset.kind]);
  const chip = (title: string) => row(title).querySelector('[data-machine-chip]')?.textContent ?? null;
  const expandAll = () => act(() => useLayout.getState().setSidebar({ expandedProjects: [ORG, machineKey(OTHER_MACHINE)] as ProjectKey[] }));
  beforeEach(() => {
    useAttention.setState({ loaded: true });
    roster('up');
  });
  afterEach(() => useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() }));

  it('draws its rows under their org project with @name beside the local rows, under its machine’s row when the project is not listed, and nowhere for an all-hidden one', () => {
    fill([listedOn('b1', { title: 'Studio build' }), listedOn('b2', { title: 'Studio chores', orgKey: null }), listedOn('b3', { title: 'Hidden notes', orgKey: 'repo:notes' as OrgKey })]);
    expandAll();
    render(<Sidebar />);
    expect(projectRows()).toEqual(['MAWS', 'Studio']);
    expect(drawn(row('MAWS'))).toEqual([['Studio build', 'listed'], ['Sidebar pass', 'session']]); // the listing issued later
    expect(drawn(row('Studio'))).toEqual([['Studio chores', 'listed']]);
    expect(chip('Studio build')).toBe('@Studio');
    expect(chip('Sidebar pass')).toBeNull();
    expect(screen.queryByRole('treeitem', { name: 'Hidden notes' })).toBeNull();
    expect(row('Studio build').querySelector('[data-session-age]')?.textContent).not.toBe('');
  });

  it('greys its rows in place, "offline" where the chip was, while its machine is not up', () => {
    fill([listedOn('b1', { title: 'Studio build' })]);
    roster('down');
    expandAll();
    render(<Sidebar />);
    const offline = row('Studio build, machine offline');
    expect(offline.dataset.offline).toBe('true');
    expect(chip('Studio build, machine offline')).toBe('offline');
    expect(offline.querySelector('[data-session-title]')!.className).toContain('text-fg-faint');
  });

  // The UX wave, U9 (S-02, O-48; Interfaces §6): every lane B listed row opens the session menu, with its acts over the link
  // from the listing alone: Rename… and Archive for a session you own, Fork for any; a terminal session's listed row has
  // none. Each is drawn disabled with the helper's sentence where the act can't work: on a machine whose build doesn't
  // list `rl2.session-acts`, the update sentence (A14).
  describe('the session menu of a listed row', () => {
    const studioIs = (over: Partial<MachineState>) =>
      useMachines.getState().applyRoster([
        { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-28T10:00:00Z', generation: 0 },
        { ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: '2026-10-28T10:00:00Z', generation: 1, ...over },
      ]);
    const menuOf = async (title: string) => {
      fireEvent.contextMenu(row(title));
      return within(await screen.findByRole('menu')).getAllByRole('menuitem');
    };
    beforeEach(() => {
      for (const id of ['rename', 'fork', 'archive'] as const) offs.push(registerSessionAction(id, vi.fn()));
      offs.push(registerRemoteOpener('B', vi.fn())); // the chain merge: a listing's opens (U7a) take lane B's opener
    });
    afterEach(async () => {
      // a menu left open would hold its layer past the test
      if (screen.queryByRole('menu') === null) return;
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    });

    // the chain merge: U7a names every listed row's menu (its opens and Hide), a terminal session's included
    it('names the session in data-menu on every listed row, a terminal session’s included', () => {
      studioIs({ capabilities: [SESSION_ACTS_CAPABILITY], owner: true });
      fill([listedOn('b1', { title: 'Studio build' }), listedOn('a1', { title: 'Studio terminal', lane: 'A' })]);
      useSessions.setState({ listedMachines: new Set([OTHER_MACHINE]) });
      expandAll();
      render(<Sidebar />);
      expect(row('Studio build').getAttribute('data-menu')).toBe(`session:${studio('b1')}`);
      expect(row('Studio terminal').getAttribute('data-menu')).toBe(`session:${studio('a1')}`);
    });

    it('offers Rename…, Fork and Archive for a session you own, enabled on a machine that serves them', async () => {
      studioIs({ capabilities: [SESSION_ACTS_CAPABILITY], owner: true });
      fill([listedOn('b1', { title: 'Studio build' })]);
      useSessions.setState({ listedMachines: new Set([OTHER_MACHINE]) });
      expandAll();
      render(<Sidebar />);
      const items = await menuOf('Studio build');
      expect(items.map((m) => m.textContent)).toEqual(['Open', 'Open in new tab', 'Hide', 'Rename…', 'Fork', 'Archive']);
      expect(items.map((m) => m.hasAttribute('data-disabled'))).toEqual([false, false, false, false, false, false]);
    });

    it('draws each disabled with the update sentence on a machine whose build doesn’t list the capability (A14)', async () => {
      studioIs({ capabilities: ['rl2.project-acts'], owner: true });
      fill([listedOn('b1', { title: 'Studio build' })]);
      useSessions.setState({ listedMachines: new Set([OTHER_MACHINE]) });
      expandAll();
      render(<Sidebar />);
      const items = await menuOf('Studio build');
      expect(items.map((m) => [m.textContent, m.hasAttribute('data-disabled'), m.getAttribute('title')])).toEqual([
        ['Open', false, null],
        ['Open in new tab', false, null],
        ['Hide', false, null],
        ['Rename…', true, 'Can’t rename on Studio yet. Update MAWS on Studio and try again.'],
        ['Fork', true, 'Can’t fork on Studio yet. Update MAWS on Studio and try again.'],
        ['Archive', true, 'Can’t archive on Studio yet. Update MAWS on Studio and try again.'],
      ]);
    });

    it('offers a record of another machine’s Rename… and Archive when its listing says it is yours, and Fork disabled for a member who doesn’t own the machine', async () => {
      studioIs({ capabilities: [SESSION_ACTS_CAPABILITY], owner: false });
      const recorded = record(studio('b1'), { projectId: null, title: { text: 'Studio build (record)', source: 'user' } });
      fill([listedOn('b1', { title: 'Studio build' })], [here, recorded]);
      useSessions.setState({ listedMachines: new Set([OTHER_MACHINE]) });
      expandAll();
      render(<Sidebar />);
      const items = await menuOf('Studio build (record)');
      expect(items.map((m) => m.textContent)).toEqual(['Open', 'Open in new tab', 'Open in split', 'Pin', 'Hide', 'Rename…', 'Fork', 'Archive']); // U7a's Hide after Pin
      const fork = items.find((m) => m.textContent === 'Fork')!;
      expect(fork.hasAttribute('data-disabled')).toBe(true);
      expect(fork.getAttribute('title')).toBe('Only Studio’s owners can fork a session there.');
    });

    // The architect's ruling (Decision Log, SessionRow's overflow takes mine): the hover overflow is drawn from the facts
    // its menu reads, so a record row of another machine has it whether its acts are Rename… and Archive (its listing says
    // it is yours) or Fork alone (no listing says so yet)
    it('draws the hover overflow on another machine’s record rows, yours and one whose only act is Fork', () => {
      studioIs({ capabilities: [SESSION_ACTS_CAPABILITY], owner: true });
      const yours = record(studio('b1'), { projectId: null, title: { text: 'Yours (record)', source: 'user' } });
      const theirs = record(studio('b2'), { projectId: null, title: { text: 'Theirs (record)', source: 'user' } });
      fill([listedOn('b1', { title: 'Yours' })], [here, yours, theirs]);
      useSessions.setState({ listedMachines: new Set([OTHER_MACHINE]) });
      expandAll();
      render(<Sidebar />);
      expect(within(row('Yours (record)')).getByRole('button', { name: 'Actions for Yours (record)' })).toBeTruthy();
      expect(within(row('Theirs (record)')).getByRole('button', { name: 'Actions for Theirs (record)' })).toBeTruthy();
    });

    it('leaves the row at once when this window archives it, and it stays gone', async () => {
      studioIs({ capabilities: [SESSION_ACTS_CAPABILITY], owner: true });
      fill([listedOn('b1', { title: 'Studio build' }), listedOn('b2', { title: 'Studio chores' })]);
      useSessions.getState().applyRows({ machines: [OTHER_MACHINE], rows: [...useSessions.getState().listed.values()], complete: true, pending: [], members: [], member: 'member-1' });
      expandAll();
      render(<Sidebar />);
      act(() => useSessions.getState().noteArchived(studio('b1')));
      expect(screen.queryByRole('treeitem', { name: 'Studio build' })).toBeNull();
      act(() => useSessions.getState().applyRows({ machines: [OTHER_MACHINE], rows: [listedOn('b1', { title: 'Studio build' }), listedOn('b2', { title: 'Studio chores' })], complete: true, pending: [], members: [], member: 'member-1' }));
      expect(screen.queryByRole('treeitem', { name: 'Studio build' })).toBeNull();
      expect(row('Studio chores')).toBeTruthy();
    });
  });

  // P5 O7 M2: the record stands where its listing was filed (its project is not known here), so the row doesn't move
  it('draws one row where a record holds a listed address, and none for a row the member does not own', () => {
    const recorded = record(studio('b1'), { projectId: null, title: { text: 'Studio build (record)', source: 'user' } });
    fill([listedOn('b1', { title: 'Studio build (listing)' }), listedOn('b2', { title: 'Someone else’s', mine: false })], [here, recorded]);
    expandAll();
    render(<Sidebar />);
    expect(drawn(row('MAWS')).sort()).toEqual([['Sidebar pass', 'session'], ['Studio build (record)', 'session']]);
    expect(screen.queryByRole('treeitem', { name: 'Studio' })).toBeNull();
    expect(screen.queryByRole('treeitem', { name: 'Studio build (listing)' })).toBeNull();
    expect(screen.queryByRole('treeitem', { name: 'Someone else’s' })).toBeNull();
  });

  // P5 O7 M2: a lane B session on another machine is marked read in this app's memory, its owner's record never written
  it('"Mark all read" marks a session on another machine read in this app’s memory, writing only this Mac’s', async () => {
    const offMarks = connectRemoteReadMarks();
    const there = record(studio('b1'), { projectId: maws.id, unread: true, title: { text: 'Over there', source: 'user' } });
    fill([], [{ ...here, unread: true }, there]);
    useSessions.setState({ listedMachines: new Set([OTHER_MACHINE]) });
    const fake = fakeClient({ 'session.update': () => recordAsMain({ ...here, unread: false }) });
    window.maws = fake.client as unknown as PreloadBridge;
    render(<Sidebar />);
    fireEvent.contextMenu(row('MAWS'));
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Mark all read' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(fake.invoked('session.update')).toEqual([expect.objectContaining({ appSessionId: 'here' })]);
    expect(useSessions.getState().records.get(studio('b1'))?.unread).toBe(false);
    offMarks();
    resetRemoteReadMarks();
  });

  it('draws each state’s glyph, and counts waiting and busy rows in the collapsed project’s rollups', async () => {
    const states = ['busy', 'waiting', 'failed', 'done', 'stopped', 'retired', 'idle'];
    fill(states.map((state, i) => listedOn(`b${i}`, { state, title: `state ${state}`, issued: `2026-10-28T10:0${9 - i}:00Z` })));
    render(<Sidebar />);
    expect(within(row('MAWS')).getByLabelText('1 waiting').textContent).toBe('◐1');
    expect(within(row('MAWS')).getByLabelText('1 working').textContent).toBe('●1');
    act(() => useLayout.getState().setSidebar({ expandedProjects: [ORG] as ProjectKey[] }));
    await userEvent.click(screen.getByRole('treeitem', { name: 'Show more' }));
    const glyph = (state: string) => within(row(`state ${state}`)).getByRole('img').getAttribute('aria-label');
    expect(states.map(glyph)).toEqual(['Working', 'Needs you', 'Failed', 'Done', 'Done', 'Done', 'Idle']);
  });

  // P5 O7 M10 (a busy remote session's state): a tab open here holds the record at a listed address, and no digest says
  // another machine's lane B session's state, so its listing goes on saying it, as it did for the listed row: the glyph,
  // the rollups and the working tier, an unread idle one "Idle, unread"
  it('draws a record at a listed address by its listing’s state, counts it in the rollups and ranks a busy one among the working', async () => {
    const states = ['busy', 'waiting', 'failed', 'done', 'stopped', 'retired', 'idle'];
    const listed = states.map((state, i) => listedOn(`b${i}`, { state, title: `listing ${state}`, issued: `2026-10-28T10:0${9 - i}:00Z` }));
    const records = states.map((state, i) => record(studio(`b${i}`), { projectId: null, title: { text: `state ${state}`, source: 'user' }, updatedAt: '2026-10-28T08:00:00Z', unread: state === 'idle' }));
    fill(listed, [{ ...here, updatedAt: '2026-10-28T11:00:00Z' }, ...records]);
    render(<Sidebar />);
    expect(within(row('MAWS')).getByLabelText('1 waiting').textContent).toBe('◐1');
    expect(within(row('MAWS')).getByLabelText('1 working').textContent).toBe('●1');
    act(() => useLayout.getState().setSidebar({ expandedProjects: [ORG] as ProjectKey[] }));
    expect(drawn(row('MAWS')).map(([name]) => name)).toEqual(['state busy', 'Sidebar pass', 'state waiting', 'state failed', 'state done']); // busy among the working, the rest by recency
    await userEvent.click(screen.getByRole('treeitem', { name: 'Show more' }));
    const glyph = (state: string) => within(row(`state ${state}`)).getAllByRole('img').find((mark) => mark.getAttribute('aria-label') !== 'Unread')!.getAttribute('aria-label');
    expect(states.map(glyph)).toEqual(['Working', 'Needs you', 'Failed', 'Done', 'Done', 'Done', 'Idle, unread']);
    expect(row('state busy').querySelector('[data-session-age]')?.textContent).toBe(formatAge(0)); // a working session is "now"
  });

  // P5 O7 M6 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M6): another machine's item with no tab open has
  // no record; its listed row stands in, in Needs you, in the count and in the tree's glyph. A greyed machine's (main's
  // word, its link down until the next snapshot) is drawn, readable, and counted nowhere.
  describe('its attention', () => {
    const waitOn = (id: string, createdAt = '2026-10-28T08:00:00Z') => item(studio(id), 'permission', createdAt, { id: addressOf(OTHER_MACHINE, `att-${id}`) as never });
    const needsYou = () => within(screen.getByRole('list', { name: 'Needs you' })).getAllByRole('button');
    afterEach(() => act(() => useAttention.getState().applyRemote({ machine: OTHER_MACHINE, items: [], greyed: false })));

    it('draws an item of a session with no record under its listed row, counts it, and opens it through its lane’s opener', async () => {
      const opened: string[] = [];
      offs.push(registerRemoteOpener('B', (listed) => opened.push(listed.appId)));
      fill([listedOn('b1', { title: 'Studio build', state: 'idle' })]);
      useAttention.getState().applyRemote({ machine: OTHER_MACHINE, items: [waitOn('b1')], greyed: false });
      expandAll();
      render(<><Toolbar /><Sidebar /></>);
      expect(screen.getByRole('heading', { name: 'Needs you · 1' })).toBeTruthy();
      expect(needsYou().map((b) => b.getAttribute('aria-label'))).toEqual(['Studio · Studio build · Approval needed']);
      expect(needsYou()[0].dataset.needsYou).toBe(studio('b1'));
      expect(needsYou()[0].querySelector('[data-machine-chip]')?.textContent).toBe('@Studio');
      expect(screen.getByRole('button', { name: 'Overview, 1 waiting' })).toBeTruthy();
      expect(within(row('Studio build')).getByRole('img').getAttribute('aria-label')).toBe('Needs approval'); // its listing says idle
      await userEvent.click(needsYou()[0]);
      expect(opened).toEqual([studio('b1')]);
    });

    // UX wave U7, ticket 559: the store's own open skips the opener's retry for a session whose stream ended
    it('⌘-click and a middle click on its Needs you row open it in a tab of its own through its lane’s opener', () => {
      const calls: [AppSessionId, { newTab: boolean } | undefined][] = [];
      offs.push(registerRemoteOpener('B', (listed, how) => calls.push([listed.appId, how])));
      fill([listedOn('b1', { title: 'Studio build', state: 'idle' })]);
      useAttention.getState().applyRemote({ machine: OTHER_MACHINE, items: [waitOn('b1')], greyed: false });
      render(<Sidebar />);
      const tabsBefore = useLayout.getState().main;
      fireEvent.click(needsYou()[0], { metaKey: true });
      fireEvent(needsYou()[0], new MouseEvent('auxclick', { bubbles: true, button: 1 }));
      expect(calls).toEqual([[studio('b1'), { newTab: true }], [studio('b1'), { newTab: true }]]);
      expect(useLayout.getState().main).toBe(tabsBefore);
      expect(needsYou()[0].getAttribute('data-menu')).toBe('none'); // a Needs you row keeps no menu for a listed session
    });

    // UX wave U7, ticket 559: an owner item's row lands on its mark, and still opens a listed session through its lane's opener
    it('an anchored item of its Needs you row opens it through its lane’s opener, ⌘-click and a middle click with the new-tab request', () => {
      const calls: [AppSessionId, { newTab: boolean } | undefined][] = [];
      offs.push(registerRemoteOpener('B', (listed, how) => calls.push([listed.appId, how])));
      fill([listedOn('b1', { title: 'Studio build', state: 'idle' })]);
      const anchored = item(studio('b1'), 'async_input', '2026-10-28T08:00:00Z', {
        id: addressOf(OTHER_MACHINE, 'att-b1-owner') as never,
        request: { requestId: null, toolUseId: null, taskId: null, agentId: null },
        summary: 'Which name should it take?',
        anchor: { messageUuid: 'msg-b1-1' as never, blockIndex: 0, span: 0 },
      });
      useAttention.getState().applyRemote({ machine: OTHER_MACHINE, items: [anchored], greyed: false });
      render(<Sidebar />);
      const tabsBefore = useLayout.getState().main;
      fireEvent.click(needsYou()[0]);
      fireEvent.click(needsYou()[0], { metaKey: true });
      fireEvent(needsYou()[0], new MouseEvent('auxclick', { bubbles: true, button: 1 }));
      expect(calls).toEqual([[studio('b1'), undefined], [studio('b1'), { newTab: true }], [studio('b1'), { newTab: true }]]);
      expect(useLayout.getState().main).toBe(tabsBefore);
    });

    it('a greyed machine’s item is drawn after the live rows, readable and marked, and leaves every count until its snapshot', () => {
      fill([listedOn('b1', { title: 'Studio build' })]);
      useAttention.setState({ loaded: true, bySession: new Map([[here.appId, [pageItem('here', 'question', '2026-10-28T09:00:00Z')]]]), version: useAttention.getState().version + 1 });
      useAttention.getState().applyRemote({ machine: OTHER_MACHINE, items: [waitOn('b1')], greyed: true }); // the older wait
      roster('down');
      render(<><Toolbar /><Sidebar /></>);
      expect(screen.getByRole('heading', { name: 'Needs you · 1' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Overview, 1 waiting' })).toBeTruthy();
      expect(needsYou().map((b) => [b.getAttribute('aria-label'), b.dataset.greyed ?? null])).toEqual([
        ['MAWS · Sidebar pass · Question', null],
        ['Studio · Studio build · Approval needed, machine offline', 'true'],
      ]);
      expect(within(needsYou()[1]).getByText('Studio build').className).toContain('text-fg-muted');
      act(() => roster('up'));
      expect(needsYou()[1].getAttribute('aria-label')).toBe('Studio · Studio build · Approval needed, reconnecting'); // up is not the snapshot
      expect(screen.getByRole('heading', { name: 'Needs you · 1' })).toBeTruthy();
      act(() => useAttention.getState().applyRemote({ machine: OTHER_MACHINE, items: [waitOn('b1')], greyed: false }));
      expect(screen.getByRole('heading', { name: 'Needs you · 2' })).toBeTruthy();
      expect(needsYou().map((b) => b.dataset.greyed ?? null)).toEqual([null, null]);
      expect(screen.getByRole('button', { name: 'Overview, 2 waiting' })).toBeTruthy();
    });

    // The UX wave, U9 (the architect's ruling of 2026-11-13): main greys an item by its machine's phase, so a machine
    // reconnecting within the minute keeps its item live and counted; the row says the machine reconnects
    it('an item of a reconnecting machine is counted in its place and says “reconnecting”', () => {
      fill([listedOn('b1', { title: 'Studio build' })]);
      useAttention.getState().applyRemote({ machine: OTHER_MACHINE, items: [waitOn('b1')], greyed: false });
      useMachines.getState().applyRoster([
        { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-28T10:00:00Z', generation: 0 },
        { ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'down', since: new Date().toISOString(), generation: 1 },
      ]);
      render(<><Toolbar /><Sidebar /></>);
      expect(screen.getByRole('heading', { name: 'Needs you · 1' })).toBeTruthy();
      expect(needsYou().map((b) => [b.getAttribute('aria-label'), b.dataset.greyed ?? null])).toEqual([['Studio · Studio build · Approval needed, reconnecting', null]]);
    });
  });

  it('caps an expanded project at five over both kinds, then eight after Show more', async () => {
    const records = Array.from({ length: 5 }, (_, i) => record(at(`r${i}`), { projectId: maws.id, title: { text: `local ${i}`, source: 'user' }, updatedAt: `2026-10-28T09:${10 + 2 * i}:00Z` }));
    const listed = Array.from({ length: 5 }, (_, i) => listedOn(`l${i}`, { title: `remote ${i}`, issued: `2026-10-28T09:${11 + 2 * i}:00Z` }));
    fill(listed, records);
    act(() => useLayout.getState().setSidebar({ expandedProjects: [ORG] as ProjectKey[] }));
    render(<Sidebar />);
    expect(drawn(row('MAWS')).map(([name]) => name)).toEqual(['remote 4', 'local 4', 'remote 3', 'local 3', 'remote 2']);
    await userEvent.click(screen.getByRole('treeitem', { name: 'Show more' }));
    expect(drawn(row('MAWS')).map(([name]) => name)).toEqual(['remote 4', 'local 4', 'remote 3', 'local 3', 'remote 2', 'local 2', 'remote 1', 'local 1']);
    expect(screen.queryByRole('treeitem', { name: 'Show more' })).toBeNull();
  });

  it('a search finds a listed row by its title', async () => {
    fill([listedOn('b1', { title: 'Remote refactor' }), listedOn('b2', { title: 'Studio chores' })]);
    render(<Sidebar />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search projects and sessions' }), 'refactor');
    expect(projectRows()).toEqual(['MAWS']);
    expect(drawn(row('MAWS'))).toEqual([['Remote refactor', 'listed']]);
  });

  // UX wave U7, O-38 and ticket 559: a listed row opens like a local one, every way through its lane's opener
  it('a click calls its lane’s opener; with none the row is selected and its card shows, opening nothing, and its two opens are disabled', async () => {
    fill([listedOn('b1', { title: 'Studio build', lane: 'A' })]);
    act(() => useLayout.getState().setSidebar({ expandedProjects: [ORG] as ProjectKey[] }));
    render(<Sidebar />);
    const tabsBefore = useLayout.getState().main;
    await userEvent.click(row('Studio build'));
    expect(row('Studio build').getAttribute('aria-selected')).toBe('true');
    const card = await screen.findByRole('dialog', { name: 'Studio build' });
    expect(within(card).getByTestId('hover-meta').textContent).toMatch(/^Idle · updated /);
    expect(within(card).getByTestId('hover-machine').textContent).toBe('Studio');
    expect(useLayout.getState().main).toBe(tabsBefore);
    expect(row('Studio build').getAttribute('data-menu')).toBe(`session:${studio('b1')}`);
    fireEvent.contextMenu(row('Studio build'));
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem');
    expect(items.map((m) => [m.textContent, m.hasAttribute('data-disabled'), m.getAttribute('title')])).toEqual([
      ['Open', true, 'Not available here'],
      ['Open in new tab', true, 'Not available here'],
      ['Hide', false, null], // UX wave U7, O-16: hiding needs no opener
    ]);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    fireEvent.click(row('Studio build'), { metaKey: true }); // ⌘-click with no opener: as a plain click
    expect(row('Studio build').getAttribute('aria-selected')).toBe('true');
    expect(useLayout.getState().main).toBe(tabsBefore);

    const open = vi.fn();
    offs.push(registerRemoteOpener('A', open));
    await userEvent.click(row('Studio build'));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ appId: studio('b1'), lane: 'A' }), undefined);
    expect(useLayout.getState().main).toBe(tabsBefore);
  });

  it('its menu offers Open and Open in new tab; ⌘-click and a middle click open it in a tab of its own, Enter as a click, each through its lane’s opener', async () => {
    const calls: [AppSessionId, { newTab: boolean } | undefined][] = [];
    offs.push(registerRemoteOpener('B', (listed, how) => calls.push([listed.appId, how])));
    fill([listedOn('b1', { title: 'Studio build' })]);
    act(() => useLayout.getState().setSidebar({ expandedProjects: [ORG] as ProjectKey[] }));
    render(<Sidebar />);
    const tabsBefore = useLayout.getState().main;
    fireEvent.contextMenu(row('Studio build'));
    const menu = await screen.findByRole('menu');
    // the opens, Hide (U7's rule), then U9's acts over the link (disabled here: this case registers no handler for them),
    // the order the architect ruled on 2026-11-13
    expect(within(menu).getAllByRole('menuitem').map((m) => [m.textContent, m.hasAttribute('data-disabled')])).toEqual([['Open', false], ['Open in new tab', false], ['Hide', false], ['Rename…', true], ['Fork', true], ['Archive', true]]);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Open' }));
    fireEvent.contextMenu(row('Studio build'));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Open in new tab' }));
    fireEvent.click(row('Studio build'), { metaKey: true });
    fireEvent(row('Studio build'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    fireEvent.keyDown(row('Studio build'), { key: 'Enter' });
    expect(calls).toEqual([
      [studio('b1'), undefined],
      [studio('b1'), { newTab: true }],
      [studio('b1'), { newTab: true }],
      [studio('b1'), { newTab: true }],
      [studio('b1'), undefined],
    ]);
    expect(useLayout.getState().main).toBe(tabsBefore); // the opener opens; the row never runs the store's own open
  });

  it('draws the three dots on a listed row and on a record that cannot be renamed', async () => {
    const user = userEvent.setup();
    const held = record(at('held'), { projectId: maws.id, holder: { kind: 'terminal', pid: 7 }, title: { text: 'Terminal pass', source: 'user' }, updatedAt: '2026-10-28T08:00:00Z' });
    fill([listedOn('b1', { title: 'Studio build' })], [here, held]);
    act(() => useLayout.getState().setSidebar({ expandedProjects: [ORG] as ProjectKey[] }));
    render(<Sidebar />);
    await user.click(within(row('Studio build')).getByRole('button', { name: 'Actions for Studio build' }));
    // a listing you own: the opens, Hide, U9's acts (the architect's ruling of 2026-11-13)
    expect(within(await screen.findByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Open in new tab', 'Hide', 'Rename…', 'Fork', 'Archive']);
    expect(row('Studio build').getAttribute('aria-selected')).not.toBe('true'); // the dots open the menu, not the session
    await user.keyboard('{Escape}');
    await user.click(within(row('Terminal pass')).getByRole('button', { name: 'Actions for Terminal pass' }));
    expect(within(await screen.findByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Open in new tab', 'Hide']);
  });

  it('Hide from its three dots takes a listed row under Hidden, opening nothing; Unhide brings it back', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    offs.push(registerRemoteOpener('B', open));
    window.maws = fakeClient({ 'layout.get': { value: null }, 'layout.set': undefined }).client as unknown as PreloadBridge;
    fill([listedOn('b1', { title: 'Studio build' })]);
    act(() => useLayout.getState().setSidebar({ expandedProjects: [ORG] as ProjectKey[] }));
    render(<Sidebar />);
    await user.click(within(row('Studio build')).getByRole('button', { name: 'Actions for Studio build' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Hide' }));
    expect(drawn(row('MAWS'))).toEqual([['Sidebar pass', 'session']]);
    const hidden = within(row('MAWS')).getByRole('treeitem', { name: 'Hidden, 1 session' });
    await user.click(hidden);
    expect(row('Studio build').dataset.indented).toBe('true');
    expect(row('Studio build').getAttribute('aria-level')).toBe('3');
    await user.click(within(row('Studio build')).getByRole('button', { name: 'Actions for Studio build' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Unhide' }));
    expect(drawn(row('MAWS')).map(([title]) => title)).toEqual(['Studio build', 'Sidebar pass']);
    expect(open).not.toHaveBeenCalled();
  });

  // UX wave U7b (M5): with no session tab in front, a listed row picked as the selection is not selected under a page,
  // whose tab behind is not on screen; Back shows it selected again, the tab being the same.
  it('a listed row picked with no session tab in front is not selected under a page, and is again at Back', async () => {
    fill([listedOn('b1', { title: 'Studio build', lane: 'A' })]);
    act(() => useLayout.getState().setSidebar({ expandedProjects: [ORG] as ProjectKey[] }));
    render(<Sidebar />);
    await userEvent.click(row('Studio build'));
    expect(row('Studio build').getAttribute('aria-selected')).toBe('true');
    act(() => useLayout.getState().openDestination({ kind: 'projects' }));
    expect(row('Studio build').getAttribute('aria-selected')).not.toBe('true');
    act(() => useLayout.getState().closeDestination());
    expect(row('Studio build').getAttribute('aria-selected')).toBe('true');
  });

  it('a selected listed row stays unselected once the shown tab changes, even when the tab it was picked over returns', async () => {
    const other = record(at('other'), { projectId: maws.id, title: { text: 'Other pass', source: 'user' }, updatedAt: '2026-10-28T08:00:00Z' });
    fill([listedOn('b1', { title: 'Studio build', lane: 'A' })], [here, other]);
    act(() => useLayout.getState().setSidebar({ expandedProjects: [ORG] as ProjectKey[] }));
    act(() => useLayout.getState().openSession(here.appId));
    render(<Sidebar />);
    await userEvent.click(row('Studio build'));
    expect(row('Studio build').getAttribute('aria-selected')).toBe('true');
    act(() => useLayout.getState().openSession(other.appId));
    expect(row('Other pass').getAttribute('aria-selected')).toBe('true');
    act(() => useLayout.getState().openSession(here.appId));
    expect(row('Sidebar pass').getAttribute('aria-selected')).toBe('true');
    expect(row('Studio build').getAttribute('aria-selected')).not.toBe('true');
  });
});

// P5 O8 M5 (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, "The label", "The People toggle"; Q2, Q3): a row
// of a session you don't own alone names its owners, and each row's People toggle draws other people's sessions.
describe('owners and the People toggle', () => {
  const studio = (id: string) => addressOf(OTHER_MACHINE, id) as AppSessionId;
  const ORG = 'repo:maws' as OrgKey;
  const STUDIO_ROW = machineKey(OTHER_MACHINE);
  const ME = 'member-1';
  const members = [
    { id: ME, email: 'sam@example.com', name: 'Sam' },
    { id: 'ana', email: 'ana.lopez@example.com', name: 'Ana' },
    { id: 'ben', email: 'ben@example.com', name: 'Ben' },
  ];
  const maws = project(at('maws'), 0, { name: 'MAWS', org: { key: ORG, name: 'MAWS', source: 'remote', smnsId: null } });
  const here = record(at('here'), { projectId: maws.id, title: { text: 'Sidebar pass', source: 'user' }, updatedAt: '2026-10-28T09:00:00Z' });
  const listedOn = (id: string, over: Partial<ListedSession> = {}): ListedSession => ({ ...remoteRow(OTHER_MACHINE, id, { orgKey: ORG, owners: [ME], issued: '2026-10-28T10:00:00Z' }), appId: studio(id), ...over });
  const theirs = (id: string, over: Partial<ListedSession> = {}) => listedOn(id, { owners: ['ana', 'ben'], mine: false, ...over });
  const fill = (listed: ListedSession[], sessions: SessionRecord[] = [here]) =>
    useSessions.setState({
      loaded: true,
      projects: new Map([[maws.id, maws]]),
      records: new Map(sessions.map((r) => [r.appId, r])),
      listed: new Map(listed.map((l) => [l.appId, l])),
      members: new Map(members.map((m) => [m.id, m])),
      member: ME,
    });
  const drawn = (el: HTMLElement) => within(el).queryAllByRole('treeitem').filter((t) => t.dataset.kind === 'session' || t.dataset.kind === 'listed').map(label);
  const owners = (title: string) => row(title).querySelector('[data-owners]')?.textContent ?? null;
  const expandAll = () => act(() => useLayout.getState().setSidebar({ expandedProjects: [ORG, STUDIO_ROW] as ProjectKey[] }));
  const people = (...keys: string[]) => act(() => usePeople.setState({ on: new Set(keys as ProjectKey[]) }));
  beforeEach(() => {
    useAttention.setState({ loaded: true });
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-10-28T10:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: '2026-10-28T10:00:00Z', generation: 0 },
    ]);
  });
  afterEach(() => {
    useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
    usePeople.setState({ on: new Set() });
  });

  it('labels a co-owned and a foreign row after the title and before the chip, a record at a listed address by its listing, and none of yours', () => {
    const opened = record(studio('b4'), { projectId: null, title: { text: 'Opened', source: 'user' } });
    const shared = record(studio('b5'), { projectId: null, title: { text: 'Shared record', source: 'user' } });
    fill([listedOn('b1', { title: 'Mine alone' }), listedOn('b2', { title: 'Co-owned', owners: ['ana', ME] }), theirs('b3', { title: 'Theirs' }), theirs('b4', { owners: ['ana'] }), listedOn('b5', { orgKey: null, owners: [ME, 'ben'] })], [here, opened, shared]);
    people(ORG, STUDIO_ROW);
    expandAll();
    render(<Sidebar />);
    expect(owners('Mine alone')).toBeNull();
    expect(owners('Sidebar pass')).toBeNull(); // a local record: no owners
    expect(owners('Co-owned')).toBe('you, Ana');
    expect(owners('Theirs')).toBe('Ana, Ben');
    expect(owners('Opened')).toBe('Ana');
    expect(owners('Shared record')).toBe('you, Ben');
    const owned = row('Theirs').querySelector('[data-owners]')!;
    expect(owned.className).toContain('text-fg-muted');
    expect(row('Theirs').querySelector('[data-session-title]')!.compareDocumentPosition(owned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(owned.compareDocumentPosition(row('Theirs').querySelector('[data-machine-chip]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says "+N others", faint, while the toggle is off, hidden on hover as the rollups are, and keeps a machine’s row with others’ sessions alone', () => {
    fill([listedOn('b1', { title: 'Mine' }), theirs('b2', { title: 'Theirs 1' }), theirs('b3', { title: 'Theirs 2' }), theirs('b4', { title: 'Theirs elsewhere', orgKey: null })]);
    expandAll();
    render(<Sidebar />);
    expect(projectRows()).toEqual(['MAWS', 'Studio']);
    const others = within(row('MAWS')).getByLabelText('2 others');
    expect(others.textContent).toBe('+2 others');
    expect(others.className).toContain('text-fg-faint');
    expect(others.className).toContain('group-hover/line:hidden');
    expect(within(row('Studio')).getByLabelText('1 other').textContent).toBe('+1 other');
    expect(drawn(row('MAWS'))).toEqual(['Mine', 'Sidebar pass']);
    expect(drawn(row('Studio'))).toEqual([]);
    people(ORG);
    expect(within(row('MAWS')).queryByLabelText('2 others')).toBeNull();
  });

  it('draws others’ rows in activity order with their owners and chips while the toggle is on', () => {
    fill([theirs('b1', { title: 'Theirs late', issued: '2026-10-28T11:00:00Z' }), theirs('b2', { title: 'Theirs early', issued: '2026-10-28T08:00:00Z', owners: ['ben'] })]);
    people(ORG);
    expandAll();
    render(<Sidebar />);
    expect(drawn(row('MAWS'))).toEqual(['Theirs late', 'Sidebar pass', 'Theirs early']);
    expect(owners('Theirs late')).toBe('Ana, Ben');
    expect(owners('Theirs early')).toBe('Ben');
    expect(row('Theirs late').querySelector('[data-machine-chip]')?.textContent).toBe('@Studio');
  });

  it('lists every owner with its email in the hover card of a listed row and of a record at a listed address', async () => {
    const opened = record(studio('b4'), { projectId: null, title: { text: 'Opened', source: 'user' } });
    fill([listedOn('b1', { title: 'Co-owned', owners: ['ana', ME, 'gone'], lane: 'A' }), theirs('b4', { owners: ['ben'] })], [here, opened]);
    people(ORG); // P5 O7 M2: the record is filed where its listing is
    expandAll();
    render(<Sidebar />);
    await userEvent.click(row('Co-owned'));
    const card = await screen.findByRole('dialog', { name: 'Co-owned' });
    const entries = (list: HTMLElement) => within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(entries(within(card).getByRole('list', { name: 'Owners' }))).toEqual(['yousam@example.com', 'Anaana.lopez@example.com', 'former member']);
    act(() => row('Opened').focus());
    const recordCard = await screen.findByRole('dialog', { name: 'Opened' });
    expect(entries(within(recordCard).getByRole('list', { name: 'Owners' }))).toEqual(['Benben@example.com']);
  });

  // The project registry's M11 (review 1, finding 4): a project you see only through others' sessions is a row with no
  // folder, and keeps its People toggle, on the row and in its menu, so its "+N others" can be shown.
  it('offers the People toggle on a registry row with no location, and draws its others once on', async () => {
    const SEEN = '99999999-8888-4777-8666-555555555555';
    const KEY = `id:${SEEN}`;
    fill([theirs('b7', { title: 'Their report', orgKey: KEY as OrgKey, project: SEEN })]);
    useSessions.setState({ registry: { projects: [{ id: SEEN, name: 'Reports', hub: true, renamable: false, locations: [] }], keys: { [SEEN]: KEY as OrgKey }, moved: {}, removals: [], seen: {} } });
    act(() => useLayout.getState().setSidebar({ expandedProjects: [KEY] as ProjectKey[] }));
    render(<Sidebar />);
    expect(row('Reports').dataset.menu).toBe(`registry:${SEEN}`);
    expect(within(row('Reports')).getByLabelText('1 other').textContent).toBe('+1 other');
    expect(peopleAction('Reports')?.getAttribute('aria-pressed')).toBe('false');
    expect((await peopleItem('Reports'))?.getAttribute('aria-checked')).toBe('false');
    people(KEY);
    expect(drawn(row('Reports'))).toEqual(['Their report']);
  });

  // The toggle shows only where it can act: with others to show, or while it is on (so it can be turned off). A row with
  // neither is as it was before M5, so a person with no org sees no dead control and the row's hover geometry is unchanged.
  const peopleAction = (name: string) => within(row(name)).queryByRole('button', { name: /people’s sessions in/ });
  const peopleItem = async (name: string) => {
    fireEvent.contextMenu(row(name));
    const item = within(await screen.findByRole('menu')).queryByRole('menuitemcheckbox', { name: /Show people’s sessions/ });
    await userEvent.keyboard('{Escape}');
    return item;
  };

  it('offers no People toggle on a row with no others and the toggle off, project and machine rows alike', async () => {
    fill([listedOn('b1', { title: 'Mine' }), listedOn('b2', { title: 'Mine elsewhere', orgKey: null })]);
    expandAll();
    render(<Sidebar />);
    expect(projectRows()).toEqual(['MAWS', 'Studio']);
    expect(peopleAction('MAWS')).toBeNull();
    expect(within(row('MAWS').querySelector<HTMLElement>('[data-project-line]')!).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Resume a session in MAWS', 'Remove MAWS from sidebar', 'New chat in MAWS']);
    expect(await peopleItem('MAWS')).toBeNull();
    expect(await peopleItem('Studio')).toBeNull();
  });

  it('offers it with others to show, and while on with every other drawn, pressed and checked; off again, the count shows and the action stays', async () => {
    fill([theirs('b1', { title: 'Theirs here' }), theirs('b2', { title: 'Theirs elsewhere', orgKey: null })]);
    expandAll();
    render(<Sidebar />);
    expect(peopleAction('MAWS')?.getAttribute('aria-pressed')).toBe('false');
    expect((await peopleItem('MAWS'))?.getAttribute('aria-checked')).toBe('false');
    expect((await peopleItem('Studio'))?.getAttribute('aria-checked')).toBe('false');

    people(ORG);
    expect(within(row('MAWS')).queryByLabelText('1 other')).toBeNull(); // every other drawn
    expect(peopleAction('MAWS')?.getAttribute('aria-label')).toBe('Hide people’s sessions in MAWS');
    expect(peopleAction('MAWS')?.getAttribute('aria-pressed')).toBe('true');
    expect((await peopleItem('MAWS'))?.getAttribute('aria-checked')).toBe('true');

    // turned off (as the store sets it: the click and its write are the persistence test's, which owns the store's one read)
    people();
    expect(within(row('MAWS')).getByLabelText('1 other').textContent).toBe('+1 other');
    expect(peopleAction('MAWS')?.getAttribute('aria-label')).toBe('Show people’s sessions in MAWS');
  });

  it('names no owners in the hover card of your own session', async () => {
    fill([listedOn('b1', { title: 'Mine', lane: 'A' })]);
    expandAll();
    render(<Sidebar />);
    await userEvent.click(row('Mine'));
    const card = await screen.findByRole('dialog', { name: 'Mine' });
    expect(within(card).queryByRole('list', { name: 'Owners' })).toBeNull();
  });

  it('toggles from the hover action and the menu, project and machine rows alike, persisting through layout.set and restored from layout.get', async () => {
    const fake = fakeClient({ 'layout.get': ({ key }: { key: string }) => ({ value: key === 'sidebar.people' ? { version: 1, on: [STUDIO_ROW] } : null }), 'layout.set': undefined });
    window.maws = fake.client as unknown as PreloadBridge;
    await act(() => usePeople.getState().load());
    fill([theirs('b1', { title: 'Theirs here' }), theirs('b2', { title: 'Theirs elsewhere', orgKey: null })]);
    expandAll();
    render(<Sidebar />);
    expect(drawn(row('Studio'))).toEqual(['Theirs elsewhere']); // restored
    expect(drawn(row('MAWS'))).toEqual(['Sidebar pass']);

    const show = within(row('MAWS')).getByRole('button', { name: 'Show people’s sessions in MAWS' });
    expect(show.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(show);
    expect(drawn(row('MAWS'))).toEqual(['Sidebar pass', 'Theirs here']); // the pointer is within: arrivals follow the held rows
    expect(within(row('MAWS')).getByRole('button', { name: 'Hide people’s sessions in MAWS' }).getAttribute('aria-pressed')).toBe('true');
    expect(expanded()).toContain(ORG); // the hover action toggles People, not the row
    await vi.waitFor(() => expect(fake.invoked('layout.set')).toEqual([{ key: 'sidebar.people', value: { version: 1, on: [STUDIO_ROW, ORG] } }]));

    fireEvent.contextMenu(row('MAWS'));
    const menu = await screen.findByRole('menu');
    const names = [...menu.querySelectorAll('[role^="menuitem"]')].map((m) => m.textContent);
    expect(names.indexOf('Show people’s sessions✓')).toBe(names.indexOf('Mark all read') + 1);
    expect(within(menu).getByRole('menuitemcheckbox', { name: /Show people’s sessions/ }).getAttribute('aria-checked')).toBe('true');
    await userEvent.keyboard('{Escape}');

    fireEvent.contextMenu(row('Studio'));
    const item = within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: /Show people’s sessions/ });
    expect(item.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(item);
    expect(drawn(row('Studio'))).toEqual([]);
    expect(within(row('Studio')).getByLabelText('1 other')).toBeTruthy();
    await vi.waitFor(() => expect(fake.invoked('layout.set').at(-1)).toEqual({ key: 'sidebar.people', value: { version: 1, on: [ORG] } }));
  });
});

// The project registry's M11 (review 1, finding 1): a project with no folder on this Mac starts a session from its row on
// one of its locations elsewhere: the "+" opens a New chat tab with no project here, its machine already chosen, passing
// over a location whose machine is off (here the lowest ref, the row's own primary).
describe('New chat in a project with no folder here', () => {
  const LOW = 'AaaLowestRefMachine000' as typeof OTHER_MACHINE;
  const ID = '5d8e1c72-4b3a-4f6e-8d9c-0a1b2c3d4e5f';
  const location = (machine: typeof OTHER_MACHINE, pid: string) => ({ machine, pid, path: `/srv/${pid}`, key: `folder:${machine}:${pid}` as OrgKey, name: pid, source: 'folder' as const, acts: true });
  afterEach(() => {
    resetRemoteSpawn();
    useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  });

  it('opens a New chat tab whose machine is the first location up over RL2', async () => {
    fillStores({ projects: [], sessions: [], digests: [], engine: [], attention: [], timeline: [] });
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-10T09:00:00Z', generation: 0 },
      { ref: LOW, name: 'farm', local: false, state: 'down', since: '2026-11-10T09:00:00Z', generation: 1, carrier: 'direct' },
      { ref: OTHER_MACHINE, name: 'studio', local: false, state: 'up', since: '2026-11-10T09:00:00Z', generation: 1, carrier: 'direct' },
    ]);
    act(() => useSessions.getState().applyRegistry({ projects: [{ id: ID, name: 'scrape', hub: true, renamable: true, locations: [location(LOW, 'p-farm'), location(OTHER_MACHINE, 'p-studio')] }], keys: { [ID]: `id:${ID}` as OrgKey }, moved: {}, removals: [], seen: {} }, TEST_MACHINE));
    const tab = at('app-new-9' as AppSessionId);
    const asked: unknown[] = [];
    offs.push(registerSessionCreator(async (projectId) => (asked.push(projectId), tab)));
    render(<Sidebar />);
    expect(row('scrape').dataset.menu).toBe(`project:${addressOf(LOW, 'p-farm' as ProjectId)}`); // the row's primary: the machine that is off
    const plus = within(row('scrape')).getByRole('button', { name: 'New chat in scrape' }) as HTMLButtonElement;
    expect(plus.disabled).toBe(false);
    await userEvent.click(plus);
    await vi.waitFor(() => expect(spawnTargetOf(tab, null)).toEqual({ machine: OTHER_MACHINE, name: 'studio', checkout: '/srv/p-studio', key: null, label: 'scrape', registry: ID }));
    expect(asked).toEqual([null]);
  });
});

// The UX wave, U9 (O-39, A2): a registry row's machines line says "offline" by the link's phase, as its rows grey: not
// while the machine connects, nor while it reconnects within the minute an act is held; past the minute, and for a first
// attempt that failed, it does.
describe('a registry row’s machines line by the link’s phase', () => {
  const ID = '7e9f2d83-5c4b-4a7f-9e0d-1b2c3d4e5f60';
  const here = { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-13T08:00:00.000Z', generation: 0 } as const;
  const studio = (over: Partial<MachineState>): MachineState => ({ ref: OTHER_MACHINE, name: 'studio', local: false, state: 'up', since: new Date().toISOString(), generation: 1, carrier: 'direct', ...over });
  // the row by its name's start: offline, its name says so ("scrape, machine offline")
  const machinesLine = () => within(screen.getByRole('treeitem', { name: /^scrape/ })).getByText((_, el) => el?.hasAttribute('data-row-machines') ?? false).textContent;
  afterEach(() => useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() }));

  it('names the machine plain while it connects or reconnects, and “offline” past the minute or when its first attempt failed', async () => {
    fillStores({ projects: [], sessions: [], digests: [], engine: [], attention: [], timeline: [] });
    const location = { machine: OTHER_MACHINE, pid: 'p-studio', path: '/srv/p-studio', key: `folder:${OTHER_MACHINE}:p-studio` as OrgKey, name: 'p-studio', source: 'folder' as const, acts: true };
    act(() => useSessions.getState().applyRegistry({ projects: [{ id: ID, name: 'scrape', hub: true, renamable: true, locations: [location] }], keys: { [ID]: `id:${ID}` as OrgKey }, moved: {}, removals: [], seen: {} }, TEST_MACHINE));
    act(() => useMachines.getState().applyRoster([here, studio({ state: 'connecting', generation: 0 })]));
    render(<Sidebar />);
    expect(machinesLine(), 'connecting').toBe('studio');
    // down a second short of the minute: reconnecting now, offline at the phase clock's own turn, with no roster change
    act(() => useMachines.getState().applyRoster([here, studio({ state: 'down', since: new Date(Date.now() - REMOTE_ACT_PENDING_MS + 1_000).toISOString() })]));
    expect(machinesLine(), 'reconnecting').toBe('studio');
    await waitFor(() => expect(machinesLine(), 'past the minute, at the clock’s own turn').toBe('studio offline'), { timeout: 4_000 });
    act(() => useMachines.getState().applyRoster([here, studio({ state: 'down', generation: 0 })]));
    expect(machinesLine(), 'a first attempt that failed').toBe('studio offline');
    act(() => useMachines.getState().applyRoster([here, studio({})]));
    expect(machinesLine(), 'up').toBe('studio');
  });
});
