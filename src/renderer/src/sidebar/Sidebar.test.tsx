import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { WorktreeInfo } from '@shared/sessions/worktree';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerSessionAction } from '../app/session-actions';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { registerAction } from '../keymap/actions-runtime'; // C11
import { useAttention } from '../stores/attention';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { Sidebar } from './Sidebar';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const offs: (() => void)[] = [];

const projectsTree = () => screen.getByRole('tree', { name: 'Projects' });
const pageTree = (name: string) => screen.getByRole('tree', { name });
const row = (title: string) => screen.getByRole('treeitem', { name: title });
const projectRows = () => within(projectsTree()).getAllByRole('treeitem').map((t) => t.getAttribute('aria-label'));
const sessionRows = (el: HTMLElement) =>
  within(el)
    .queryAllByRole('treeitem')
    .filter((t) => t.dataset.kind === 'session')
    .map((t) => t.getAttribute('aria-label'));
const level = () => screen.getByTestId('sidebar-levels').dataset.level;
const openPage = (projectId: string) => act(() => useLayout.getState().setSidebar({ openProject: projectId as ProjectId }));

beforeEach(() => resetShellStores());
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  delete (window as { maws?: MawsBridge }).maws;
});

describe('the project list', () => {
  beforeEach(() => fillStores(nine));

  it('lists the projects most recently active first, then Other sessions, with no Needs-you or Pinned section', () => {
    render(<Sidebar />);
    expect(level()).toBe('1');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Projects']);
    expect(screen.queryByRole('list', { name: 'Needs you' })).toBeNull();
    expect(projectRows()).toEqual(['claude-usage-menubar', 'codex_somersault', 'MAWS', 'Other sessions']);
    expect(within(projectsTree()).queryAllByRole('treeitem').filter((t) => t.dataset.kind === 'session')).toHaveLength(0);
  });

  it('carries each project’s waiting (◐) and working (●) counts', () => {
    render(<Sidebar />);
    expect(within(row('MAWS')).getByLabelText('2 waiting').textContent).toBe('◐2');
    expect(within(row('MAWS')).getByLabelText('1 working').textContent).toBe('●1');
    expect(within(row('codex_somersault')).getByLabelText('1 waiting').textContent).toBe('◐1');
    expect(within(row('codex_somersault')).queryByLabelText(/working/)).toBeNull();
    expect(within(row('claude-usage-menubar')).getByLabelText('1 working')).toBeTruthy();
    expect(within(row('Other sessions')).queryByLabelText(/waiting|working/)).toBeNull();
  });

  it('a click opens the project’s page, persisted; "‹ Projects" goes back', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(row('MAWS'));
    expect(useLayout.getState().regions.sidebar.openProject).toBe('proj-maws');
    expect(level()).toBe('2');
    expect(screen.getByRole('heading', { level: 2, name: 'MAWS' })).toBeTruthy();
    expect(sessionRows(pageTree('MAWS'))).toEqual(['Workstation north star', 'Fix sidebar drag', 'Sidebar interaction pass', 'Charter + research']);
    await user.click(screen.getByRole('button', { name: 'Back to projects' }));
    expect(useLayout.getState().regions.sidebar.openProject).toBeNull();
    expect(level()).toBe('1');
    expect(document.activeElement).toBe(row('MAWS'));
  });

  it('the hidden level is inert and out of the accessibility tree', async () => {
    render(<Sidebar />);
    const panes = document.querySelectorAll<HTMLElement>('[data-level-pane]');
    expect([...panes].map((p) => [p.dataset.levelPane, p.inert, p.getAttribute('aria-hidden')])).toEqual([
      ['1', false, null],
      ['2', true, 'true'],
    ]);
    openPage('proj-maws');
    expect([...panes].map((p) => [p.dataset.levelPane, p.inert, p.getAttribute('aria-hidden')])).toEqual([
      ['1', true, 'true'],
      ['2', false, null],
    ]);
  });

  it('opens where the layout says, and falls back to the list for a project that is gone', () => {
    useLayout.getState().setSidebar({ openProject: 'proj-codex-somersault' as ProjectId });
    const { unmount } = render(<Sidebar />);
    expect(sessionRows(pageTree('codex_somersault'))).toEqual(['Quota reset recovery', 'Somersault terminal run', 'Trace stream reconnects']);
    unmount();
    useLayout.getState().setSidebar({ openProject: 'proj-removed' as ProjectId });
    render(<Sidebar />);
    expect(level()).toBe('1');
  });

  it('Other sessions is a page of its own, without a "+"', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    expect(within(row('Other sessions')).queryByRole('button')).toBeNull();
    await user.click(row('Other sessions'));
    expect(useLayout.getState().regions.sidebar.openProject).toBe('other');
    expect(sessionRows(pageTree('Other sessions'))).toEqual(['Terminal workflow notes']);
    expect(screen.queryByRole('button', { name: /New session in/ })).toBeNull();
  });
});

describe('a project’s page', () => {
  beforeEach(() => fillStores(nine));

  it('pins on top, then the rest in the chosen sort; the sort menu switches to recency', async () => {
    const user = userEvent.setup();
    openPage('proj-claude-usage-menubar');
    render(<Sidebar />);
    expect(sessionRows(pageTree('claude-usage-menubar'))).toEqual(['Usage reset countdown', 'Settings idle probe', 'SDK wire inventory']);
    await user.click(screen.getByRole('button', { name: 'Sort sessions' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Recency' }));
    expect(useLayout.getState().regions.sidebar.sort).toBe('recency');
  });

  it('shows an unread dot on exactly the unread records and labels every glyph from the glyph table', () => {
    render(<Sidebar />);
    for (const project of ['proj-maws', 'proj-codex-somersault', 'other']) {
      openPage(project);
      for (const dot of screen.queryAllByLabelText('Unread')) expect(['Fix sidebar drag', 'Quota reset recovery', 'Terminal workflow notes']).toContain(dot.closest('[role="treeitem"]')!.getAttribute('aria-label'));
    }
    openPage('proj-codex-somersault');
    const label = (title: string) => within(row(title)).getAllByRole('img')[0].getAttribute('aria-label'); // the glyph leads the row
    expect(label('Quota reset recovery')).toBe('Plan review');
    expect(label('Trace stream reconnects')).toBe('Done');
    expect(label('Somersault terminal run')).toBe('Live in terminal');
    openPage('proj-maws');
    expect(label('Charter + research')).toBe('Working');
    expect(label('Sidebar interaction pass')).toBe('Question');
  });

  it('shows the foreign-live holder and offers Open only in its context menu', async () => {
    openPage('proj-codex-somersault');
    render(<Sidebar />);
    const foreign = row('Somersault terminal run');
    expect(within(foreign).getByText('Terminal · pid 7135')).toBeTruthy();
    fireEvent.contextMenu(foreign);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open']);
  });

  it('offers §5.1’s session actions in a session’s context menu, disabled until a handler registers', async () => {
    offs.push(registerSessionAction('open', vi.fn()));
    openPage('proj-maws');
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
    openPage('proj-maws');
    render(<Sidebar />);
    const charter = row('Charter + research');
    await user.click(within(charter).getByRole('button', { name: 'Pin Charter + research' }));
    expect(pin).toHaveBeenCalledWith(idOf('Charter + research'));
    expect(activeTab(useLayout.getState().main)?.kind).toBe('overview'); // the action does not open the row
    const archive = within(charter).getByRole('button', { name: 'Archive Charter + research' }) as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    expect(archive.title).toBe('Not available here');
  });

  it('a session row carries its id for a drag to a tab strip', () => {
    openPage('proj-maws');
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

  it('the search filters the list by project and by the sessions it holds, then the open page by session; Escape clears it', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.type(screen.getByRole('searchbox', { name: 'Search projects and sessions' }), 'sidebar');
    expect(projectRows()).toEqual(['MAWS']);
    await user.click(row('MAWS'));
    expect(sessionRows(pageTree('MAWS'))).toEqual(['Fix sidebar drag', 'Sidebar interaction pass']);
    const field = screen.getByRole('searchbox', { name: 'Search MAWS' });
    await user.click(field);
    await user.keyboard('{Escape}');
    expect(sessionRows(pageTree('MAWS'))).toHaveLength(4);
    await user.type(field, 'nothing like it');
    expect(screen.getByText('No sessions match')).toBeTruthy();
  });

  it('groups a project’s sessions Main first, then each worktree in git’s order, each with its branch and a "+"', async () => {
    const maws = (title: string) => idOf(title);
    const worktree = (path: string, branch: string | null) => ({ worktree: { path, branch } });
    fillStores({
      ...nine,
      sessions: nine.sessions.map((r) =>
        r.appId === maws('Fix sidebar drag')
          ? { ...r, ...worktree('/Users/new/Developer/GitHub/MAWS/.claude/worktrees/accept-one', 'worktree-accept-one') }
          : r.appId === maws('Charter + research')
            ? { ...r, ...worktree('/Users/new/Developer/GitHub/MAWS-sibling', null), branch: 'feature/sibling' }
            : r,
      ),
    });
    const info = (path: string, branch: string, isMain = false): WorktreeInfo => ({
      repoRoot: '/Users/new/Developer/GitHub/MAWS', path, branch, head: 'abc', isMain, locked: false, prunable: false, managed: path.includes('/.claude/'),
    });
    const fake = fakeClient({
      'git.worktree.list': {
        repoRoot: '/Users/new/Developer/GitHub/MAWS',
        commonDir: '/Users/new/Developer/GitHub/MAWS/.git',
        worktrees: [
          info('/Users/new/Developer/GitHub/MAWS', 'master', true),
          info('/Users/new/Developer/GitHub/MAWS-sibling', 'feature/sibling'),
          info('/Users/new/Developer/GitHub/MAWS/.claude/worktrees/accept-one', 'worktree-accept-one'),
        ],
      },
    });
    window.maws = fake.client;
    const creator = vi.fn(async () => 'app-new-wt' as AppSessionId);
    offs.push(registerSessionCreator(creator));
    openPage('proj-maws');
    render(<Sidebar />);
    await waitFor(() =>
      expect(within(pageTree('MAWS')).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual([
        'Main · master',
        'MAWS-sibling · feature/sibling',
        'accept-one · worktree-accept-one',
      ]),
    );
    expect(fake.invoked('git.worktree.list')).toEqual([{ repoRoot: '/Users/new/Developer/GitHub/MAWS' }]);
    const groups = within(pageTree('MAWS')).getAllByRole('group');
    expect(groups.map((g) => sessionRows(g))).toEqual([['Sidebar interaction pass'], ['Charter + research'], ['Fix sidebar drag']]);
    expect(sessionRows(pageTree('MAWS'))[0]).toBe('Workstation north star'); // pinned, above the groups
    const user = userEvent.setup();
    await user.click(within(groups[1]).getByRole('button', { name: 'New session in MAWS-sibling' }));
    expect(creator).toHaveBeenCalledWith('proj-maws', { kind: 'existingWorktree', repoRoot: '/Users/new/Developer/GitHub/MAWS', path: '/Users/new/Developer/GitHub/MAWS-sibling' });
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: 'app-new-wt' });
    await user.click(within(groups[0]).getByRole('button', { name: 'New session in Main' }));
    expect(creator).toHaveBeenLastCalledWith('proj-maws');
  });

  it('asks git for nothing when no session of the project sits in a worktree', () => {
    const fake = fakeClient();
    window.maws = fake.client;
    openPage('proj-maws');
    render(<Sidebar />);
    expect(within(pageTree('MAWS')).queryAllByRole('group')).toHaveLength(0);
    expect(fake.invoked('git.worktree.list')).toEqual([]);
  });
});

describe('sidebar keyboard', () => {
  beforeEach(() => fillStores(nine));

  it('the list is one tab stop that arrows move through; Enter opens a page and focuses its first row', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const stops = within(projectsTree()).getAllByRole('treeitem').filter((t) => t.tabIndex === 0);
    expect(stops.map((t) => t.getAttribute('aria-label'))).toEqual(['claude-usage-menubar']);
    stops[0].focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(document.activeElement).toBe(row('MAWS'));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(row('Other sessions'));
    await user.keyboard('{ArrowUp}{Enter}');
    expect(useLayout.getState().regions.sidebar.openProject).toBe('proj-maws');
    expect(document.activeElement).toBe(row('Workstation north star'));
  });

  it('on a page arrows move, Enter opens a session, and Backspace or ArrowLeft goes back to the project', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    row('MAWS').focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(row('Workstation north star'));
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: idOf('Sidebar interaction pass') });
    expect(row('Sidebar interaction pass').getAttribute('aria-selected')).toBe('true');
    await user.keyboard('{Backspace}');
    expect(useLayout.getState().regions.sidebar.openProject).toBeNull();
    expect(document.activeElement).toBe(row('MAWS'));
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(row('Sidebar interaction pass')); // the selected session is the page's stop
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(row('MAWS'));
  });

  it('ArrowDown from the search enters the level on screen', async () => {
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
    const plus = within(row('MAWS')).getByRole('button', { name: 'New session in MAWS' }) as HTMLButtonElement;
    expect(plus.disabled).toBe(true);
    expect(plus.title).toBe('Not available here');
  });

  it('with a creator, a project row’s "+" or its page’s "+" opens an unstarted session tab in that project, and the sidebar does not list it', async () => {
    const user = userEvent.setup();
    const creator = vi.fn(async () => 'app-new-1' as AppSessionId);
    offs.push(registerSessionCreator(creator));
    render(<Sidebar />);
    await user.click(within(row('MAWS')).getByRole('button', { name: 'New session in MAWS' }));
    expect(creator).toHaveBeenCalledWith('proj-maws');
    expect(useLayout.getState().regions.sidebar.openProject).toBeNull(); // the "+" does not open the page
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: 'app-new-1' });
    expect(useSessions.getState().unstarted.get('app-new-1' as AppSessionId)?.projectId).toBe('proj-maws');
    openPage('proj-maws');
    await user.click(within(screen.getByRole('heading', { name: 'MAWS' }).parentElement!).getByRole('button', { name: 'New session in MAWS' }));
    expect(creator).toHaveBeenCalledTimes(2);
    expect(sessionRows(pageTree('MAWS'))).toHaveLength(4);
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

  it('an empty workspace reads "No projects yet" with its creation actions', async () => {
    fillStores(scenarioFile('empty'));
    const { rerender } = render(<Sidebar />);
    expect(screen.getByText('No projects yet')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add project' }) as HTMLButtonElement).disabled).toBe(true);
    const create = screen.getByRole('button', { name: 'New session' }) as HTMLButtonElement;
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
  it('lists the projects, and a project’s page renders all of its sessions, fast', async () => {
    const many = scenarioFile('many-sessions');
    fillStores(many);
    let started = performance.now();
    render(<Sidebar />);
    let elapsed = performance.now() - started;
    if (elapsed > 200) console.info(`[sidebar] many-sessions list mounted in ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(1000);
    expect(projectRows()).toHaveLength(3);
    started = performance.now();
    await userEvent.setup().click(row('MAWS'));
    elapsed = performance.now() - started;
    if (elapsed > 300) console.info(`[sidebar] a 120-session page opened in ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(2000);
    expect(sessionRows(pageTree('MAWS'))).toHaveLength(many.sessions.filter((r) => r.projectId === 'proj-maws' && !r.archived).length);
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
    openPage('proj-claude-usage-menubar');
    render(<Sidebar />);
    const mark = within(row('Settings idle probe')).getByText('released');
    expect(mark.getAttribute('title')).toBe('Released at 14:02 to stay under the 8 GB memory budget · Send resumes it');
    expect(within(row('Settings idle probe')).getByRole('img', { name: 'Idle' }).textContent).toBe('○'); // the idle glyph, unchanged
    expect(within(row('Settings idle probe')).queryByLabelText('Unread')).toBeNull();
    expect(screen.getAllByText('released')).toHaveLength(1);
  });
});
// C12 end
