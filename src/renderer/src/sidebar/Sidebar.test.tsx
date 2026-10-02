import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge, ProjectRecord } from '@shared/ipc/schema';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerSessionAction } from '../app/session-actions';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { useDialogs } from '../sessions/dialogs';
import { registerAction } from '../keymap/actions-runtime'; // C11
import { useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import type { ProjectKey } from './derive';
import { registerProjectAction } from './project-actions';
import { useResumePicker } from './ResumePicker';
import { Sidebar } from './Sidebar';

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
  useResumePicker.setState({ projectId: null });
  offs.splice(0).forEach((off) => off());
  delete (window as { maws?: MawsBridge }).maws;
});

describe('the project list', () => {
  beforeEach(() => fillStores(nine));

  it('lists the projects most recently active first, then Other sessions, each collapsed, with no levels and no Needs-you or Pinned section', () => {
    render(<Sidebar />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Projects']);
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

  it('Other sessions expands like a project, without a "+" or a context menu', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    expect(within(row('Other sessions')).queryByRole('button')).toBeNull();
    expect(row('Other sessions').hasAttribute('data-menu')).toBe(false);
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
    expect(within(row('Charter + research')).getByTestId('row-branch').textContent).toBe('⎇ detached');
    expect(within(row('Sidebar interaction pass')).queryByTestId('row-branch')).toBeNull();
    expect(fake.invoked('git.worktree.list')).toEqual([]);
  });

  it('offers a foreign-live session Open only in its context menu, and no hover actions', async () => {
    expand('proj-codex-somersault');
    render(<Sidebar />);
    const foreign = row('Somersault terminal run');
    expect(within(foreign).queryByRole('button')).toBeNull();
    fireEvent.contextMenu(foreign);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open']);
  });

  it('offers §5.1’s session actions in a session’s context menu, disabled until a handler registers', async () => {
    offs.push(registerSessionAction('open', vi.fn()));
    expand('proj-maws');
    render(<Sidebar />);
    fireEvent.contextMenu(row('Charter + research'));
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    // C10: a live session offers no Resume; "Fork to a new worktree…" sits beside the fork in place
    expect(items.map((m) => m.textContent)).toEqual(['Open', 'Open in split', 'Pin', 'Rename…', 'Fork', 'Fork to a new worktree…', 'Archive', 'Delete conversation…']);
    expect(items.map((m) => m.hasAttribute('data-disabled'))).toEqual([false, true, true, true, true, true, true, true]);
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

// W11 (I7, as the owner corrected it): the Resume… picker opens from the project row's search icon and its context menu,
// lists the project's sessions as `claude --resume` does, and opens one.
describe('the Resume… picker', () => {
  beforeEach(() => {
    fillStores(nine);
    const maws = nine.projects.find((p) => p.id === 'proj-maws')!;
    window.maws = fakeClient({
      'git.worktree.list': { repoRoot: maws.directory, commonDir: `${maws.directory}/.git`, worktrees: [{ repoRoot: maws.directory, path: maws.directory, branch: 'master', head: 'abc', isMain: true, locked: false, prunable: false, managed: false }] },
    }).client;
  });
  const picker = () => screen.getByRole('dialog', { name: 'Resume session' });
  const options = () => within(picker()).queryAllByRole('option').map((o) => o.querySelector('span')!.textContent);

  it('opens from the row’s search icon on the project, searches, and Enter opens the session', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const button = within(row('MAWS')).getByRole('button', { name: 'Resume a session in MAWS' });
    expect(button.title).toBe('Resume a session…');
    await user.click(button);
    expect(expanded()).toEqual([]); // the click does not toggle the row
    expect(within(picker()).getByTestId('resume-scope').textContent).toBe('MAWS');
    expect(options().sort()).toEqual(['Charter + research', 'Fix sidebar drag', 'Sidebar interaction pass', 'Workstation north star']);
    expect(within(picker()).getAllByRole('option')[0].querySelectorAll('span')[1].textContent).toMatch(/^(now|\d+[mhdw] ago)( · [^·]+)?$/); // age · branch
    await user.keyboard('drag');
    expect(options()).toEqual(['Fix sidebar drag']);
    await user.keyboard('{Enter}');
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: idOf('Fix sidebar drag') });
    expect(screen.queryByRole('dialog', { name: 'Resume session' })).toBeNull();
  });

  it('⌃A widens to every project, ⌘Enter opens in a new tab, Esc closes', async () => {
    const user = userEvent.setup();
    act(() => useLayout.getState().openSession(idOf('Charter + research')));
    render(<Sidebar />);
    await user.click(within(row('MAWS')).getByRole('button', { name: 'Resume a session in MAWS' }));
    await user.keyboard('{Control>}a{/Control}');
    expect(within(picker()).getByRole('button', { name: /^All projects/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(picker()).getByTestId('resume-scope').textContent).toBe('All projects');
    expect(options()).toContain('Quota reset recovery');
    expect(options()).toContain('Terminal workflow notes');
    await user.keyboard('quota{Meta>}{Enter}{/Meta}');
    const panes = useLayout.getState().main.panes;
    expect(panes[0].tabs.map((t) => (t.kind === 'session' ? t.appSessionId : t.id))).toEqual([idOf('Charter + research'), idOf('Quota reset recovery')]);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ appSessionId: idOf('Quota reset recovery') });
    await user.click(within(row('MAWS')).getByRole('button', { name: 'Resume a session in MAWS' }));
    expect(within(picker()).getByRole('button', { name: /^All projects/ }).getAttribute('aria-pressed')).toBe('false'); // a fresh picker
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Resume session' })).toBeNull();
  });

  it('a filter button keeps Enter and Space: Tab from the search to All projects, Enter presses it and opens nothing', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(within(row('MAWS')).getByRole('button', { name: 'Resume a session in MAWS' }));
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

  it('⌃B keeps the checkout’s branch; the project’s context menu offers Resume… too', async () => {
    const user = userEvent.setup();
    fillStores({ ...nine, sessions: nine.sessions.map((r) => (r.projectId === 'proj-maws' ? { ...r, branch: r.title.text === 'Fix sidebar drag' ? 'master' : 'feature' } : r)) });
    render(<Sidebar />);
    fireEvent.contextMenu(row('MAWS'));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent).slice(0, 2)).toEqual(['New chat', 'Resume…']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Resume…' }));
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
    expect(document.activeElement).toBe(row('MAWS'));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(row('Workstation north star'));
  });

  it('in a project arrows move, Enter opens a session, ArrowLeft steps out and then collapses, Space expands', async () => {
    const user = userEvent.setup();
    expand('proj-maws');
    render(<Sidebar />);
    row('MAWS').focus();
    await user.keyboard('{ArrowRight}{ArrowDown}{ArrowDown}{Enter}');
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: idOf('Sidebar interaction pass') });
    expect(row('Sidebar interaction pass').getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(row('MAWS'));
    await user.keyboard('{ArrowLeft}');
    expect(expanded()).toEqual([]);
    await user.keyboard(' ');
    expect(expanded()).toEqual(['proj-maws']);
  });

  it('the selected session is the tree’s stop when it is on screen', () => {
    expand('proj-maws');
    act(() => useLayout.getState().openSession(idOf('Fix sidebar drag')));
    render(<Sidebar />);
    expect(within(projectsTree()).getAllByRole('treeitem').filter((t) => t.tabIndex === 0).map(label)).toEqual(['Fix sidebar drag']);
  });

  it('ArrowDown from the search enters the tree', async () => {
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

  it('an empty workspace reads "No projects yet" with Add project, and the New chat row above opens a chat in no project', async () => {
    fillStores(scenarioFile('empty'));
    const { rerender } = render(<Sidebar />);
    expect(screen.getByText('No projects yet')).toBeTruthy();
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
    act(() => useSessions.getState().applyDigest({ ...digest, released: { at, limitKiB: 8 * 1024 * 1024 }, revision: digest.revision + 1 }));
    expand('proj-claude-usage-menubar');
    render(<Sidebar />);
    const mark = within(row('Settings idle probe')).getByText('released');
    expect(mark.getAttribute('title')).toBe('Released at 14:02 to stay under the 8 GB memory budget · Send resumes it');
    expect(within(row('Settings idle probe')).getByRole('img', { name: 'Idle' }).textContent).toBe('○'); // the idle glyph, unchanged
    expect(within(row('Settings idle probe')).queryByLabelText('Unread')).toBeNull();
    expect(screen.getAllByText('released')).toHaveLength(1);
  });
});
// C12 end
