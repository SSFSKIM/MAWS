import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge, ProjectRecord } from '@shared/ipc/schema';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerSessionAction } from '../app/session-actions';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { closeDialog, useDialogs } from '../sessions/dialogs';
import { SessionDialogs } from '../sessions/SessionDialogs';
import { TabStrip } from '../main/TabStrip';
import { item, record } from '../../../../test/support/builders';
import { registerAction } from '../keymap/actions-runtime'; // C11
import { useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { activeTab, currentSet } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { fileTabsByProject, fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import type { ProjectKey } from './derive';
import { registerProjectAction } from './project-actions';
import { useResumeChooser } from '../resume/host'; // P2-D
import { clearPreviewCache } from '../resume/preview'; // P2-D
import { revealProject } from './reveal';
import { Sidebar } from './Sidebar';
import { formatClock } from '../app/date-format'; // L129

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
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
const expand = (...keys: string[]) => act(() => useLayout.getState().setSidebar({ expandedProjects: keys as ProjectKey[] }));
const expanded = () => useLayout.getState().regions.sidebar.expandedProjects;
const toggle = (user: ReturnType<typeof userEvent.setup>, name: string) => user.click(within(row(name)).getAllByText(name)[0]);

beforeEach(() => resetShellStores());
afterEach(() => {
  cleanup();
  closeDialog();
  useResumeChooser.setState({ open: null }); // P2-D
  offs.splice(0).forEach((off) => off());
  delete (window as { maws?: MawsBridge }).maws;
});

describe('sidebar recovery routes', () => {
  it.each(['footer', 'context menu'] as const)('recovers a project-less archive through the %s', async (route) => {
    const empty = scenarioFile('empty');
    fillStores(route === 'footer' ? empty : { ...empty, sessions: [record('listed-other', { projectId: null })] });
    const archived = record('archived-other', { projectId: null, archived: true, title: { text: 'Recovered notes', source: 'user' } });
    const elsewhere = record('archived-project', { projectId: 'project-a' as ProjectId, archived: true, title: { text: 'Project notes', source: 'user' } });
    const fake = fakeClient({
      'session.list': () => ({ sessions: [archived, elsewhere], revision: 1 }),
      'session.update': () => {
        archived.archived = false;
        useSessions.getState().applyChanged({ record: archived, cause: 'update', revision: useSessions.getState().revision + 1 });
        return archived;
      },
    });
    window.maws = fake.client;
    render(<><Sidebar /><SessionDialogs /></>);
    if (route === 'footer') {
      expect(screen.queryByRole('treeitem', { name: 'Other sessions' })).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Archived sessions…' }));
    } else {
      fireEvent.contextMenu(row('Other sessions'));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Archived sessions…' }));
    }
    const dialog = await screen.findByRole('dialog', { name: 'Archived sessions · Other sessions' });
    await within(dialog).findByText('Recovered notes');
    expect(within(dialog).queryByText('Project notes')).toBeNull();
    expect(fake.invoked('session.list')).toEqual([{ includeArchived: true }]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Unarchive' }));
    await within(dialog).findByText('No archived sessions.');
    expect(fake.invoked('session.update')).toEqual([{ appSessionId: archived.appId, patch: { archived: false } }]);
    act(() => closeDialog());
    await toggle(userEvent.setup(), 'Other sessions');
    expect(sessionRows(row('Other sessions'))).toContain('Recovered notes');
  });

  it('reports a failed hidden-project restore without revealing a row that remains hidden', async () => {
    const project = nine.projects.find((p) => p.name === 'MAWS')!;
    fillStores({ ...nine, projects: nine.projects.map((p) => ({ ...p, hidden: p.id === project.id })) });
    useLayout.getState().setSidebar({ collapsed: true });
    const fake = fakeClient();
    window.maws = fake.client;
    render(<Sidebar />);
    act(() => revealProject(project.id));
    await act(() => fake.fail('session.projects.add', 'Directory no longer exists'));
    expect(screen.queryByRole('treeitem', { name: 'MAWS' })).toBeNull();
    expect(useLayout.getState().regions.sidebar.collapsed).toBe(true);
    expect(expanded()).not.toContain(project.id);
    expect(useNotices.getState().notices.at(-1)).toMatchObject({ level: 'danger', text: 'Directory no longer exists' });
  });

  it('the hidden project tab label restores it before revealing and focusing its sidebar row', async () => {
    const project = nine.projects.find((p) => p.name === 'MAWS')!;
    fillStores({ ...nine, projects: nine.projects.map((p) => ({ ...p, hidden: p.id === project.id })) });
    useLayout.getState().setCurrentProject(project.id);
    useLayout.getState().setSidebar({ collapsed: true });
    const fake = fakeClient();
    window.maws = fake.client;
    render(<><Sidebar /><TabStrip pane={0} split={false} idPrefix="test" /></>);
    const button = screen.getByRole('button', { name: 'Tabs of MAWS' });
    expect(screen.queryByRole('treeitem', { name: 'MAWS' })).toBeNull();
    await userEvent.click(button);
    expect(fake.invoked('session.projects.add')).toEqual([{ directory: project.directory }]);
    expect(button.title).toBe('Show in sidebar');
    expect(useLayout.getState().regions.sidebar.collapsed).toBe(true);
    await act(() => fake.reply('session.projects.add', { ...project, hidden: false }));
    // Main's project event may arrive after its command response.
    act(() => useSessions.getState().applyProjects({ projects: nine.projects, revision: 10 }));
    await waitFor(() => expect(document.activeElement).toBe(row('MAWS')));
    expect(row('MAWS').getAttribute('aria-expanded')).toBe('true');
    expect(useLayout.getState().regions.sidebar.collapsed).toBe(false);
    expect(button.title).toBe('Reveal MAWS in the sidebar');
    await userEvent.click(button);
    expect(fake.invoked('session.projects.add')).toHaveLength(1);
  });
});

describe('Needs you across projects', () => {
  const waiting = () => screen.getByRole('list', { name: 'Needs you' });
  const buttons = () => within(waiting()).getAllByRole('button');

  it('shows every waiting session in wait order, with project, title and reason, unaffected by search or hidden projects', async () => {
    fillStores({ ...nine, projects: nine.projects.map((p) => ({ ...p, hidden: p.name === 'MAWS' })) });
    render(<Sidebar />);
    expect(buttons().map((b) => b.textContent)).toEqual([
      'MAWSFix sidebar dragApproval needed',
      'MAWSSidebar interaction passQuestion',
      'codex_somersaultQuota reset recoveryPlan review',
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
    window.maws = fake.client;
    const user = userEvent.setup();
    render(<Sidebar />);
    const search = screen.getByRole('searchbox');
    search.focus();
    await user.tab();
    expect(document.activeElement).toBe(buttons()[0]);
    expect(buttons().filter((b) => b.tabIndex === 0)).toHaveLength(1);
    await user.keyboard('{End}{ArrowUp}{Home}{ArrowDown}{Enter}');
    expect(document.activeElement).toBe(buttons()[1]);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ appSessionId: idOf('Sidebar interaction pass') });
    expect(useLayout.getState().main.current).toBe('proj-maws');
    expect(fake.invoked('session.answer')).toEqual([]);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sort sessions' }));
    search.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(buttons()[1]);
  });

  it('keeps keyboard focus in the sidebar when a focused waiting session retires', () => {
    fillStores(nine);
    render(<Sidebar />);
    act(() => buttons()[0].focus());
    act(() => useAttention.getState().applyChanged({ appSessionId: idOf('Fix sidebar drag'), items: [] }));
    expect(document.activeElement).toBe(buttons()[0]);
    act(() => {
      for (const entry of nine.attention) useAttention.getState().applyChanged({ appSessionId: entry.appSessionId, items: [] });
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
    act(() => useAttention.getState().applyChanged({ appSessionId: idOf(retired), items: [] }));
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
    act(() => useAttention.getState().applyChanged({ appSessionId: id, items: [item(id, 'interrupted', '2026-10-03T10:00:00Z')] }));
    expect(document.activeElement).toBe(focused);
    expect(buttons().at(-1)).toBe(focused);
    act(() => useAttention.getState().applyChanged({ appSessionId: id, items: [] }));
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
    act(() => useAttention.getState().applyChanged({ appSessionId: idOf('Fix sidebar drag'), items: [] }));
    expect(document.activeElement).toBe(target);
    act(() => {
      for (const entry of nine.attention) useAttention.getState().applyChanged({ appSessionId: entry.appSessionId, items: [] });
    });
    expect(document.activeElement).toBe(target);
  });

  it('updates reasons and ordering from attention, omits archived sessions, and disappears when empty', () => {
    fillStores(nine);
    render(<Sidebar />);
    const id = idOf('Fix sidebar drag');
    act(() => useAttention.getState().applyChanged({ appSessionId: id, items: [item(id, 'interrupted', '2026-10-03T10:00:00Z')] }));
    expect(buttons().at(-1)?.textContent).toBe('MAWSFix sidebar dragInterrupted');
    act(() => useAttention.getState().applyChanged({ appSessionId: id, items: [item(id, 'error', '2026-09-01T10:00:00Z')] }));
    expect(buttons()[0].textContent).toBe('MAWSFix sidebar dragError');
    act(() => useSessions.getState().applyChanged({ record: { ...useSessions.getState().records.get(id)!, archived: true }, cause: 'update', revision: useSessions.getState().revision + 1 }));
    expect(buttons()).toHaveLength(2);
    act(() => {
      for (const entry of nine.attention) useAttention.getState().applyChanged({ appSessionId: entry.appSessionId, items: [] });
    });
    expect(screen.queryByRole('list', { name: 'Needs you' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Needs you/ })).toBeNull();
  });
});

describe('the project list', () => {
  beforeEach(() => fillStores(nine));

  it('lists the projects most recently active first, then Other sessions, each collapsed, with no drill-in or Pinned section', () => {
    render(<Sidebar />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Needs you · 3', 'Projects']);
    expect(screen.queryByTestId('sidebar-levels')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to projects' })).toBeNull();
    expect(projectRows()).toEqual(['claude-usage-menubar', 'codex_somersault', 'MAWS', 'Other sessions']);
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
    expect(within(row('Other sessions')).queryByLabelText(/waiting|working/)).toBeNull();
    expand('proj-maws');
    expect(within(row('MAWS')).queryByLabelText('2 waiting')).toBeNull();
  });

  it('a click expands a project in place, persisted; another collapses it', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await toggle(user, 'MAWS');
    expect(expanded()).toEqual(['proj-maws']);
    expect(row('MAWS').getAttribute('aria-expanded')).toBe('true');
    expect(sessionRows(row('MAWS'))).toEqual(['Workstation north star', 'Fix sidebar drag', 'Sidebar interaction pass', 'Charter + research']);
    expect(within(row('MAWS')).getByRole('group', { name: 'MAWS' })).toBeTruthy();
    await toggle(user, 'codex_somersault');
    expect(expanded()).toEqual(['proj-maws', 'proj-codex-somersault']);
    await toggle(user, 'MAWS');
    expect(expanded()).toEqual(['proj-codex-somersault']);
    expect(row('MAWS').getAttribute('aria-expanded')).toBe('false');
    await waitFor(() => expect(sessionRows(row('MAWS'))).toEqual([])); // once the close has run
  });

  it('a click before the layout hydrates expands over the saved expansions, not in place of them', async () => {
    const user = userEvent.setup();
    act(() => useLayout.setState({ hydrated: false }));
    render(<Sidebar />);
    await toggle(user, 'MAWS');
    expect(expanded()).toEqual(['proj-maws']);
    const saved = { ...LAYOUT_DEFAULTS.regions, sidebar: { ...LAYOUT_DEFAULTS.regions.sidebar, expandedProjects: ['proj-codex-somersault'] } };
    const client = fakeClient({ 'layout.list': { keys: ['regions'] }, 'layout.get': ({ key }: { key: string }) => ({ value: key === 'regions' ? saved : null }), 'layout.set': undefined }).client;
    await act(() => useLayout.getState().hydrate(client, () => true));
    expect(expanded()).toEqual(['proj-codex-somersault', 'proj-maws']);
  });

  it('opens what the layout says, and passes over a project that is gone', () => {
    expand('proj-removed', 'proj-codex-somersault');
    render(<Sidebar />);
    expect(sessionRows(row('codex_somersault'))).toEqual(['Quota reset recovery', 'Somersault terminal run', 'Trace stream reconnects']);
    expect(projectRows()).toEqual(['claude-usage-menubar', 'codex_somersault', 'MAWS', 'Other sessions']);
  });

  it('Other sessions expands like a project, without a "+" but with archive recovery', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    expect(within(row('Other sessions')).queryByRole('button')).toBeNull();
    expect(row('Other sessions').getAttribute('data-menu')).toBe('other');
    await toggle(user, 'Other sessions');
    expect(expanded()).toEqual(['other']);
    expect(sessionRows(row('Other sessions'))).toEqual(['Terminal workflow notes']);
  });

  it('lists five projects, then "Show more" for the rest (not persisted), with Other sessions last; a search lists every project', async () => {
    const extra = (n: number): ProjectRecord => ({ ...nine.projects[0], id: `proj-x${n}` as ProjectId, name: `extra-${n}`, directory: `/x/extra-${n}`, order: 10 + n, createdAt: `2026-08-0${n}T00:00:00.000Z` });
    fillStores({ ...nine, projects: [...nine.projects, extra(1), extra(2), extra(3), extra(4)] });
    const user = userEvent.setup();
    const { unmount } = render(<Sidebar />);
    expect(projectRows()).toEqual(['claude-usage-menubar', 'codex_somersault', 'MAWS', 'extra-4', 'extra-3', 'Other sessions']);
    const rows = within(projectsTree()).getAllByRole('treeitem').map(label);
    expect(rows.indexOf('Show more')).toBe(rows.indexOf('Other sessions') - 1);
    const field = screen.getByRole('searchbox', { name: 'Search projects and sessions' });
    await user.type(field, 'extra');
    expect(projectRows()).toEqual(['extra-4', 'extra-3', 'extra-2', 'extra-1']);
    await user.clear(field);
    await user.click(row('Show more'));
    expect(projectRows()).toEqual(['claude-usage-menubar', 'codex_somersault', 'MAWS', 'extra-4', 'extra-3', 'extra-2', 'extra-1', 'Other sessions']);
    expect(screen.queryByRole('treeitem', { name: 'Show more' })).toBeNull();
    expect(document.activeElement).toBe(row('extra-2')); // the first project it revealed
    unmount();
    render(<Sidebar />);
    expect(projectRows()).toHaveLength(6);
  });
});

// W11 (I5): the archive icon removes a project from the sidebar; a hidden project and its sessions show nowhere in the
// tree (never under Other sessions), and "Hidden projects…" at the end offers them back.
describe('removing a project from the sidebar', () => {
  beforeEach(() => fillStores(nine));

  it('the archive icon beside "+" runs the confirmed removal, disabled until it has a handler', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    expect((within(row('MAWS')).getByRole('button', { name: 'Remove MAWS from sidebar' }) as HTMLButtonElement).disabled).toBe(true);
    const remove = vi.fn();
    offs.push(registerProjectAction('removeProject', remove));
    await user.click(within(row('MAWS')).getByRole('button', { name: 'Remove MAWS from sidebar' }));
    expect(remove).toHaveBeenCalledWith('proj-maws');
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
    expect(projectRows()).toEqual(['claude-usage-menubar', 'codex_somersault', 'Other sessions']);
    expect(sessionRows(row('Other sessions'))).toEqual(['Terminal workflow notes']); // none of MAWS's
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
    const glyph = (title: string) => within(row(title)).getAllByRole('img')[0].getAttribute('aria-label'); // the glyph leads the row
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
    expect(charter.textContent).toBe('●Charter + researchnow');
    expect(within(row('Workstation north star')).getByRole('img', { name: 'Pinned' })).toBeTruthy();
    expect(within(charter).queryByRole('img', { name: 'Pinned' })).toBeNull();
    expect(within(row('Fix sidebar drag')).getByRole('img', { name: 'Unread' })).toBeTruthy();
  });

  it('marks a worktree session with its ⎇ branch in one flat list, with no groups and no git call', () => {
    const fake = fakeClient();
    window.maws = fake.client;
    fillStores({
      ...nine,
      sessions: nine.sessions.map((r) =>
        r.appId === idOf('Fix sidebar drag')
          ? { ...r, worktree: { path: '/Users/new/Developer/GitHub/MAWS/.claude/worktrees/accept-one', branch: 'worktree-accept-one' } }
          : r.appId === idOf('Charter + research')
            ? { ...r, worktree: { path: '/Users/new/Developer/GitHub/MAWS-detached', branch: null }, branch: null }
            : r,
      ),
    });
    expand('proj-maws');
    render(<Sidebar />);
    expect(sessionRows(row('MAWS'))).toHaveLength(4);
    expect(within(row('MAWS')).getAllByRole('group')).toHaveLength(1); // the project's own: no Main or worktree groups
    expect(within(row('Fix sidebar drag')).getByTestId('row-branch').textContent).toBe('⎇ worktree-accept-one');
    expect(within(row('Charter + research')).queryByTestId('row-branch')).toBeNull(); // W9 (H2): no branch recorded, none guessed
    expect(within(row('Sidebar interaction pass')).queryByTestId('row-branch')).toBeNull();
    expect(fake.invoked('git.worktree.list')).toEqual([]);
  });

  it('offers a foreign-live session only the opens in its context menu, and no hover actions', async () => {
    expand('proj-codex-somersault');
    render(<Sidebar />);
    const foreign = row('Somersault terminal run');
    expect(within(foreign).queryByRole('button')).toBeNull();
    fireEvent.contextMenu(foreign);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open', 'Open in new tab']);
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

  it('a session row’s hover actions pin, and archive stays disabled until C10', async () => {
    const user = userEvent.setup();
    const pin = vi.fn();
    offs.push(registerSessionAction('pin', pin));
    expand('proj-maws');
    render(<Sidebar />);
    const charter = row('Charter + research');
    await user.click(within(charter).getByRole('button', { name: 'Pin Charter + research' }));
    expect(pin).toHaveBeenCalledWith(idOf('Charter + research'));
    expect(activeTab(useLayout.getState().main)).toBeNull(); // the action does not open the row
    const archive = within(charter).getByRole('button', { name: 'Archive Charter + research' }) as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    expect(archive.title).toBe('Not available here');
  });

  it('a session row carries its id for a drag to a tab strip', () => {
    expand('proj-maws');
    render(<Sidebar />);
    const setData = vi.fn();
    fireEvent.dragStart(row('Charter + research'), { dataTransfer: { setData, effectAllowed: 'none' } });
    expect(setData).toHaveBeenCalledWith('application/x-maws-session', idOf('Charter + research'));
  });

  it('"Mark all read" on a project row marks the project’s unread sessions read through session.update', async () => {
    const fake = fakeClient({ 'session.update': ({ appSessionId }: { appSessionId: AppSessionId }) => useSessions.getState().records.get(appSessionId) });
    window.maws = fake.client;
    render(<Sidebar />);
    fireEvent.contextMenu(row('MAWS'));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mark all read' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(fake.invoked('session.update')).toEqual([
      { appSessionId: idOf('Fix sidebar drag'), patch: { unread: false, lastSeen: { messageUuid: null, at: expect.any(String) } } },
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
    window.maws = fake.client;
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
    const base = nine.sessions.find((r) => r.projectId === 'proj-maws')!;
    const now = new Date().toISOString();
    const launched = { ...base, appId: '11111111-1111-4111-8111-111111111111' as AppSessionId, engineSessionId: null, title: { text: 'Fix the drag handle', source: 'none' as const }, pinned: false, unread: false, createdAt: now, updatedAt: now };
    const blank = { ...launched, appId: '22222222-2222-4222-8222-222222222222' as AppSessionId, title: { text: '', source: 'none' as const } };
    act(() => {
      useSessions.getState().applyChanged({ record: launched, cause: 'live', revision: 1000 });
      useSessions.getState().applyChanged({ record: blank, cause: 'live', revision: 1001 });
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
    expect(document.activeElement).toBe(row('Other sessions'));
    await user.keyboard('{ArrowUp}{Enter}');
    expect(expanded()).toEqual(['proj-maws']);
    expect(useLayout.getState().main.current, 'W12: Enter shows the project’s tab set, as a click does').toBe('proj-maws');
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
    expect(expanded()).toEqual(['proj-maws']);
  });

  // W12 (I3) on W11's tree: a project's activation is one path for the pointer and the keys, and it shows the project's
  // tab set, so a project reached by keyboard switches the strip as a click does.
  it('a click, Enter, ArrowRight or Space on a project row shows its tab set; Other sessions shows the no-project set', async () => {
    const user = userEvent.setup();
    fileTabsByProject();
    act(() => useLayout.getState().openSession(idOf('Fix sidebar drag')));
    const current = () => useLayout.getState().main.current;
    const shown = () => activeTab(useLayout.getState().main);
    expect(current()).toBe('proj-maws');
    render(<Sidebar />);
    await toggle(user, 'codex_somersault');
    expect(current()).toBe('proj-codex-somersault');
    expect(shown(), 'the other project’s set is empty').toBeNull();
    row('MAWS').focus();
    await user.keyboard('{Enter}');
    expect(current()).toBe('proj-maws');
    expect(shown()).toMatchObject({ kind: 'session', appSessionId: idOf('Fix sidebar drag') });
    row('claude-usage-menubar').focus();
    await user.keyboard('{ArrowRight}');
    expect(current()).toBe('proj-claude-usage-menubar');
    expect(expanded()).toEqual(['proj-codex-somersault', 'proj-maws', 'proj-claude-usage-menubar']);
    row('Other sessions').focus();
    await user.keyboard(' ');
    expect(current()).toBe('none');
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
    const creator = vi.fn(async () => 'app-new-1' as AppSessionId);
    offs.push(registerSessionCreator(creator));
    render(<Sidebar />);
    await user.click(within(row('MAWS')).getByRole('button', { name: 'New chat in MAWS' }));
    expect(creator).toHaveBeenCalledWith('proj-maws');
    expect(expanded()).toEqual([]);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: 'app-new-1' });
    expect(useSessions.getState().unstarted.get('app-new-1' as AppSessionId)?.projectId).toBe('proj-maws');
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
    act(() => revealProject('proj-x2' as ProjectId)); // the sixth project: folded under "Show more" on a plain load
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
    expect((screen.getByRole('button', { name: 'Add project' }) as HTMLButtonElement).disabled).toBe(true);
    const create = screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    offs.push(registerSessionCreator(async () => 'app-new-2' as AppSessionId));
    rerender(<Sidebar />);
    expect(create.disabled).toBe(false);
    await userEvent.setup().click(create);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: 'app-new-2' });
    expect(useSessions.getState().unstarted.get('app-new-2' as AppSessionId)?.projectId).toBeNull();
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
    window.maws = fakeClient().client;
  });

  it('reads idle with the muted word released, and says when and why in its title', () => {
    const id = idOf('Settings idle probe');
    const at = new Date(2026, 8, 29, 14, 2).toISOString();
    const digest = useSessions.getState().digests.get(id)!;
    act(() => useSessions.getState().applyDigest({ ...digest, released: { at, reason: 'budget', limitKiB: 8 * 1024 * 1024 }, revision: digest.revision + 1 }));
    expand('proj-claude-usage-menubar');
    render(<Sidebar />);
    const mark = within(row('Settings idle probe')).getByText('released');
    expect(mark.getAttribute('title')).toBe(`Released at ${formatClock(Date.parse(at))} to stay under the 8 GB memory budget · Send resumes it`);
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
