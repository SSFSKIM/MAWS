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
import { useMachines } from '../stores/machines';
import { registerSessionAction } from '../app/session-actions';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { closeDialog, useDialogs } from '../sessions/dialogs';
import { SessionDialogs } from '../sessions/SessionDialogs';
import { Toolbar } from '../app/Toolbar';
import { digest, item, project, record, remoteRow, status } from '../../../../test/support/builders';
import { registerRemoteOpener } from '../sessions/remote-openers'; // P5 O8 M2
import { registerAction } from '../keymap/actions-runtime'; // C11
import { useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { activeTab, currentSet } from '../stores/layout-model';
import { useSessions, type ListedSession } from '../stores/sessions';
import { usePeople } from '../stores/people'; // P5 O8 M5
import { fileTabsByProject, fillStores, pageScenario, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import type { ProjectKey } from './derive';
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

  // P3-F wave S (F17): the title bar's project chip, whose context menu is the reveal the strip's label was
  it('the title bar chip’s Show in sidebar restores a hidden project before revealing and focusing its sidebar row', async () => {
    const project = nine.projects.find((p) => p.name === 'MAWS')!;
    fillStores({ ...nine, projects: nine.projects.map((p) => ({ ...p, hidden: p.id === project.id })) });
    useLayout.getState().setCurrentProject(at(project.id));
    useLayout.getState().setSidebar({ collapsed: true });
    const fake = fakeClient();
    window.maws = fake.client as unknown as PreloadBridge;
    render(<><Sidebar /><Toolbar /></>);
    const chip = document.querySelector<HTMLElement>('[data-toolbar-project]')!;
    const menuItem = async () => {
      fireEvent.contextMenu(chip);
      return screen.findByRole('menuitem');
    };
    expect(screen.queryByRole('treeitem', { name: 'MAWS' })).toBeNull();
    const show = await menuItem();
    expect(show.textContent).toBe('Show in sidebar');
    await userEvent.click(show);
    expect(fake.invoked('session.projects.add')).toEqual([{ directory: project.directory }]);
    expect(useLayout.getState().regions.sidebar.collapsed).toBe(true);
    await act(() => fake.reply('session.projects.add', { ...project, hidden: false }));
    // Main's project event may arrive after its command response.
    act(() => useSessions.getState().applyProjects({ projects: page.projects, revision: 10 }, TEST_MACHINE));
    await waitFor(() => expect(document.activeElement).toBe(row('MAWS')));
    expect(row('MAWS').getAttribute('aria-expanded')).toBe('true');
    expect(useLayout.getState().regions.sidebar.collapsed).toBe(false);
    const reveal = await menuItem();
    expect(reveal.textContent).toBe('Reveal in sidebar');
    await userEvent.click(reveal);
    expect(fake.invoked('session.projects.add')).toHaveLength(1);
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
    fileTabsByProject();
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
    expect(useLayout.getState().main.current).toBe(at('proj-maws'));
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
    expect(within(foreign).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Mark unread']); // local read state, no holder actions
    fireEvent.contextMenu(foreign);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Open in new tab']);
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
    // C10: a live session offers no Resume; "Fork to a new worktree…" sits beside the fork in place
    expect(items.map((m) => m.textContent)).toEqual(['Open', 'Open in new tab', 'Open in split', 'Pin', 'Rename…', 'Fork', 'Fork to a new worktree…', 'Archive', 'Delete conversation…']);
    expect(items.map((m) => m.hasAttribute('data-disabled'))).toEqual([false, true, true, true, true, true, true, true, true]);
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
    const panes = currentSet(useLayout.getState().main).panes; // W12: the strip's tab set (one here: no projectOf given)
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
    expect(useLayout.getState().main.current, 'W12: Enter shows the project’s tab set, as a click does').toBe(at('proj-maws'));
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

  // W12 (I3) on W11's tree: a project's activation is one path for the pointer and the keys, and it shows the project's
  // tab set, so a project reached by keyboard switches the strip as a click does.
  it('a click, Enter, ArrowRight or Space on a project row shows its tab set; a machine’s row shows its own set', async () => {
    const user = userEvent.setup();
    fileTabsByProject();
    act(() => useLayout.getState().openSession(idOf('Fix sidebar drag')));
    const current = () => useLayout.getState().main.current;
    const shown = () => activeTab(useLayout.getState().main);
    expect(current()).toBe(at('proj-maws'));
    render(<Sidebar />);
    await toggle(user, 'codex_somersault');
    expect(current()).toBe(at('proj-codex-somersault'));
    expect(shown(), 'the other project’s set is empty').toBeNull();
    row('MAWS').focus();
    await user.keyboard('{Enter}');
    expect(current()).toBe(at('proj-maws'));
    expect(shown()).toMatchObject({ kind: 'session', appSessionId: idOf('Fix sidebar drag') });
    row('claude-usage-menubar').focus();
    await user.keyboard('{ArrowRight}');
    expect(current()).toBe(at('proj-claude-usage-menubar'));
    expect(expanded()).toEqual([at('proj-codex-somersault'), at('proj-maws'), at('proj-claude-usage-menubar')]);
    row('This Mac').focus();
    await user.keyboard(' ');
    expect(current()).toBe(machineKey(TEST_MACHINE));
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

// C11 start: the footer's gear opens the Settings tab once C11 registers settings.open (C11 execution document, M5)
describe('the footer gear', () => {
  beforeEach(() => fillStores(nine));

  it('is disabled until settings.open has a handler, then runs it', () => {
    render(<Sidebar />);
    const gear = screen.getByRole('button', { name: 'Workspace settings' }) as HTMLButtonElement;
    expect(gear.disabled).toBe(true);
    const open = vi.fn();
    act(() => void offs.push(registerAction('settings.open', open)));
    expect(gear.disabled).toBe(false);
    expect(gear.title).toBe('Settings · ⌘,');
    fireEvent.click(gear);
    expect(open).toHaveBeenCalledOnce();
  });
});
// C11 end

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

  it('draws one row where a record holds a listed address, and none for a row the member does not own', () => {
    const recorded = record(studio('b1'), { projectId: null, title: { text: 'Studio build (record)', source: 'user' } });
    fill([listedOn('b1', { title: 'Studio build (listing)' }), listedOn('b2', { title: 'Someone else’s', mine: false })], [here, recorded]);
    expandAll();
    render(<Sidebar />);
    expect(drawn(row('MAWS'))).toEqual([['Sidebar pass', 'session']]);
    expect(drawn(row('Studio'))).toEqual([['Studio build (record)', 'session']]);
    expect(screen.queryByRole('treeitem', { name: 'Studio build (listing)' })).toBeNull();
    expect(screen.queryByRole('treeitem', { name: 'Someone else’s' })).toBeNull();
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

  it('a click calls its lane’s opener; with none the row is selected and its card shows, opening nothing and offering no menu', async () => {
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
    fireEvent.contextMenu(row('Studio build'));
    expect(screen.queryByRole('menu')).toBeNull();

    const open = vi.fn();
    offs.push(registerRemoteOpener('A', open));
    await userEvent.click(row('Studio build'));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ appId: studio('b1'), lane: 'A' }));
    expect(useLayout.getState().main).toBe(tabsBefore);
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
    people(STUDIO_ROW);
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
