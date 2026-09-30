import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
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

const tree = (name: string) => screen.getByRole('tree', { name });
const row = (title: string) => screen.getByRole('treeitem', { name: title });
const rowTitles = (el: HTMLElement, level: number) =>
  within(el)
    .queryAllByRole('treeitem')
    .filter((t) => t.getAttribute('aria-level') === String(level))
    .map((t) => t.getAttribute('aria-label'));
const needsYouTitles = () => within(screen.getByRole('list', { name: 'Needs you' })).getAllByRole('listitem').map((li) => li.dataset.title);

beforeEach(() => resetShellStores());
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  delete (window as { maws?: MawsBridge }).maws;
});

describe('sidebar renders eleven sessions', () => {
  beforeEach(() => fillStores(nine));

  it('in the order Needs you, Pinned, Projects, Other sessions', () => {
    render(<Sidebar />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Needs you · 3', 'Pinned', 'Projects', 'Other sessions']);
    const sessions = screen.getAllByRole('treeitem').filter((t) => t.dataset.kind === 'session');
    expect(sessions).toHaveLength(11);
  });

  it('lists the three Needs-you rows longest wait first', () => {
    render(<Sidebar />);
    expect(needsYouTitles()).toEqual(['Fix sidebar drag', 'Sidebar interaction pass', 'Quota reset recovery']);
    const first = within(screen.getByRole('list', { name: 'Needs you' })).getAllByRole('listitem')[0];
    expect(within(first).getByText('MAWS ·')).toBeTruthy();
    expect(within(first).getByRole('img', { name: 'Needs approval' }).textContent).toBe('◐');
  });

  it('puts the projects in order with the pinned session under Pinned only', () => {
    render(<Sidebar />);
    expect(rowTitles(tree('Pinned'), 1)).toEqual(['Workstation north star']);
    expect(rowTitles(tree('Projects'), 1)).toEqual(['MAWS', 'codex_somersault', 'claude-usage-menubar']);
    const maws = within(tree('Projects')).getByRole('group', { name: 'MAWS' });
    expect(rowTitles(maws, 2)).toEqual(['Fix sidebar drag', 'Sidebar interaction pass', 'Charter + research']);
    expect(rowTitles(tree('Other sessions'), 1)).toEqual(['Terminal workflow notes']);
  });

  it('shows an unread dot on exactly the unread records', () => {
    render(<Sidebar />);
    const dotted = screen.getAllByLabelText('Unread').map((dot) => dot.closest('[role="treeitem"]')!.getAttribute('aria-label'));
    expect(dotted.sort()).toEqual(['Fix sidebar drag', 'Quota reset recovery', 'Terminal workflow notes']);
    expect(within(row('Settings idle probe')).getByRole('img', { name: 'Idle' }).textContent).toBe('○');
  });

  it('labels every glyph from the glyph table', () => {
    render(<Sidebar />);
    const label = (title: string) => within(row(title)).getAllByRole('img')[0].getAttribute('aria-label'); // the glyph leads the row
    expect(label('Charter + research')).toBe('Working');
    expect(label('Sidebar interaction pass')).toBe('Question');
    expect(label('Quota reset recovery')).toBe('Plan review');
    expect(label('Trace stream reconnects')).toBe('Done');
    expect(label('Terminal workflow notes')).toBe('Idle, unread');
    expect(label('Somersault terminal run')).toBe('Live in terminal');
  });

  it('shows the foreign-live holder and offers Open only in its context menu', async () => {
    render(<Sidebar />);
    const foreign = row('Somersault terminal run');
    expect(within(foreign).getByText('Terminal · pid 7135')).toBeTruthy();
    fireEvent.contextMenu(foreign);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Open']);
  });

  // Debt wave 4 (C5 row): a worktree session's row carries its branch chip; a background job reads by its short id.
  it('shows a worktree session’s branch chip and a background job’s short id', () => {
    const drag = idOf('Fix sidebar drag');
    const probe = idOf('Somersault terminal run');
    fillStores({
      ...nine,
      sessions: nine.sessions.map((r) =>
        r.appId === drag
          ? { ...r, worktree: { path: '/work/maws/.claude/worktrees/accept-one', branch: 'worktree-accept-one' } }
          : r.appId === probe
            ? { ...r, holder: { kind: 'background_job' as const, pid: 4242, jobId: 'e6dcd828' } }
            : r,
      ),
    });
    render(<Sidebar />);
    const chips = screen.getAllByTestId('session-row-branch');
    expect(chips.map((chip) => [chip.closest('[role="treeitem"]')!.getAttribute('aria-label'), chip.textContent])).toEqual([
      ['Fix sidebar drag', '⎇ worktree-accept-one'],
    ]);
    expect(within(row('Somersault terminal run')).getByText('bg · e6dcd828')).toBeTruthy();
  });

  it('offers §5.1’s session actions in a session’s context menu, disabled until a handler registers', async () => {
    offs.push(registerSessionAction('open', vi.fn()));
    render(<Sidebar />);
    fireEvent.contextMenu(row('Charter + research'));
    const menu = await screen.findByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    // C10: a live session offers no Resume; "Fork to a new worktree…" sits beside the fork in place
    expect(items.map((m) => m.textContent)).toEqual(['Open', 'Open in split', 'Pin', 'Rename…', 'Fork', 'Fork to a new worktree…', 'Archive', 'Delete conversation…']);
    expect(items.map((m) => m.hasAttribute('data-disabled'))).toEqual([false, true, true, true, true, true, true, true]);
  });

  it('gives a collapsed project its roll-up and hides it while expanded', () => {
    render(<Sidebar />);
    const maws = row('MAWS');
    expect(within(maws).queryByLabelText('2 need you')).toBeNull();
    act(() => useLayout.getState().setSidebar({ collapsedProjects: ['proj-maws' as ProjectId] }));
    expect(within(row('MAWS')).getByLabelText('2 need you').textContent).toContain('2');
    expect(within(row('MAWS')).getByLabelText('1 working').textContent).toContain('1');
    expect(within(tree('Projects')).queryByRole('group', { name: 'MAWS' })).toBeNull();
  });
});

describe('sidebar tree keyboard', () => {
  beforeEach(() => fillStores(nine));

  it('is one tab stop that arrows move through, across sections', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    const stops = screen.getAllByRole('treeitem').filter((t) => t.tabIndex === 0);
    expect(stops.map((t) => t.getAttribute('aria-label'))).toEqual(['Workstation north star']);
    stops[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(row('MAWS'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(row('Fix sidebar drag'));
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(document.activeElement).toBe(row('Workstation north star'));
    expect(screen.getAllByRole('treeitem').filter((t) => t.tabIndex === 0)).toEqual([row('Workstation north star')]);
  });

  it('ArrowLeft and ArrowRight collapse and expand a project; Space toggles; ArrowLeft on a session goes to its project', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    row('Fix sidebar drag').focus();
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(row('MAWS'));
    await user.keyboard('{ArrowLeft}');
    expect(useLayout.getState().regions.sidebar.collapsedProjects).toEqual(['proj-maws']);
    expect(row('MAWS').getAttribute('aria-expanded')).toBe('false');
    await user.keyboard('{ArrowRight}');
    expect(useLayout.getState().regions.sidebar.collapsedProjects).toEqual([]);
    await user.keyboard(' ');
    expect(useLayout.getState().regions.sidebar.collapsedProjects).toEqual(['proj-maws']);
  });

  it('Enter on a session opens its tab in the focused pane', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    row('Charter + research').focus();
    await user.keyboard('{Enter}');
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: idOf('Charter + research') });
    expect(row('Charter + research').getAttribute('aria-selected')).toBe('true');
  });
});

describe('sidebar sections', () => {
  beforeEach(() => fillStores(nine));

  it('the search filters rows by title, project and directory and keeps the headings; Escape clears it', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.type(screen.getByRole('searchbox', { name: 'Search sessions' }), 'quota');
    expect(needsYouTitles()).toEqual(['Quota reset recovery']);
    expect(screen.getAllByRole('treeitem').filter((t) => t.dataset.kind === 'session').map((t) => t.getAttribute('aria-label'))).toEqual(['Quota reset recovery']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Needs you · 1', 'Pinned', 'Projects', 'Other sessions']);
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('treeitem').filter((t) => t.dataset.kind === 'session')).toHaveLength(11);
  });

  it('searching shows the matches of a collapsed project without expanding it for good', async () => {
    const user = userEvent.setup();
    useLayout.getState().setSidebar({ collapsedProjects: ['proj-codex-somersault' as ProjectId] });
    render(<Sidebar />);
    await user.type(screen.getByRole('searchbox', { name: 'Search sessions' }), 'trace');
    expect(row('Trace stream reconnects')).toBeTruthy();
    expect(useLayout.getState().regions.sidebar.collapsedProjects).toEqual(['proj-codex-somersault']);
  });

  it('the sort menu on the Projects heading switches between priority and recency', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByRole('button', { name: 'Sort sessions' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Recency' }));
    expect(useLayout.getState().regions.sidebar.sort).toBe('recency');
    const usage = within(tree('Projects')).getByRole('group', { name: 'claude-usage-menubar' });
    expect(rowTitles(usage, 2)).toEqual(['Usage reset countdown', 'Settings idle probe', 'SDK wire inventory']);
  });

  it('Pinned and Other sessions collapse, and the state persists in the layout', async () => {
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(useLayout.getState().regions.sidebar.collapsedSections).toEqual(['pinned']);
    expect(screen.queryByRole('treeitem', { name: 'Workstation north star' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Other sessions' }));
    expect(useLayout.getState().regions.sidebar.collapsedSections).toEqual(['pinned', 'other']);
    await user.click(screen.getByRole('button', { name: 'Pinned' }));
    expect(useLayout.getState().regions.sidebar.collapsedSections).toEqual(['other']);
  });

  it('a Needs-you row opens the Overview with its card focused; a double-click opens the session', async () => {
    const user = userEvent.setup();
    useLayout.getState().openSession(idOf('Charter + research'));
    render(<Sidebar />);
    const fix = within(screen.getByRole('list', { name: 'Needs you' })).getByRole('button', { name: /Fix sidebar drag/ });
    await user.click(fix);
    expect(activeTab(useLayout.getState().main)?.kind).toBe('overview');
    expect(useLayout.getState().focusedCardAppId).toBe(idOf('Fix sidebar drag'));
    await user.dblClick(fix);
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: idOf('Fix sidebar drag') });
  });

  it('a session row’s hover actions pin, and archive stays disabled until C10', async () => {
    const user = userEvent.setup();
    const pin = vi.fn();
    offs.push(registerSessionAction('pin', pin));
    render(<Sidebar />);
    const charter = row('Charter + research');
    await user.click(within(charter).getByRole('button', { name: 'Pin Charter + research' }));
    expect(pin).toHaveBeenCalledWith(idOf('Charter + research'));
    expect(activeTab(useLayout.getState().main)?.kind).toBe('overview'); // the action does not open the row
    const archive = within(charter).getByRole('button', { name: 'Archive Charter + research' }) as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    expect(archive.title).toBe('Arrives with C10');
  });

  it('a session row carries its id for a drag to a tab strip', () => {
    render(<Sidebar />);
    const setData = vi.fn();
    fireEvent.dragStart(row('Charter + research'), { dataTransfer: { setData, effectAllowed: 'none' } });
    expect(setData).toHaveBeenCalledWith('application/x-maws-session', idOf('Charter + research'));
  });

  it('"Mark all read" marks the project’s unread sessions read through session.update', async () => {
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
});

describe('new sessions from the sidebar', () => {
  beforeEach(() => fillStores(nine));

  it('"+" is disabled with "Arrives with C10" while no creator is registered', () => {
    render(<Sidebar />);
    const plus = within(row('MAWS')).getByRole('button', { name: 'New session in MAWS' }) as HTMLButtonElement;
    expect(plus.disabled).toBe(true);
    expect(plus.title).toBe('Arrives with C10');
  });

  it('with a creator, "+" opens an unstarted session tab in that project, and the sidebar does not list it', async () => {
    const user = userEvent.setup();
    const creator = vi.fn(async () => 'app-new-1' as AppSessionId);
    offs.push(registerSessionCreator(creator));
    render(<Sidebar />);
    await user.click(within(row('MAWS')).getByRole('button', { name: 'New session in MAWS' }));
    expect(creator).toHaveBeenCalledWith('proj-maws');
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'session', appSessionId: 'app-new-1' });
    expect(useSessions.getState().unstarted.get('app-new-1' as AppSessionId)?.projectId).toBe('proj-maws');
    expect(screen.getAllByRole('treeitem').filter((t) => t.dataset.kind === 'session')).toHaveLength(11);
  });
});

describe('sidebar states', () => {
  it('shows three skeleton rows per section until both snapshots have loaded', () => {
    fillStores(nine, { loaded: false });
    render(<Sidebar />);
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(9);
    act(() => useSessions.setState({ loaded: true }));
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(9);
    act(() => useAttention.setState({ loaded: true }));
    expect(screen.queryAllByTestId('skeleton-row')).toHaveLength(0);
  });

  it('an empty workspace reads "No projects yet" with its creation actions and keeps the Needs-you heading', async () => {
    fillStores(scenarioFile('empty'));
    const { rerender } = render(<Sidebar />);
    expect(screen.getByRole('heading', { name: 'Needs you · 0' })).toBeTruthy();
    expect(screen.getByText('Nothing needs you right now')).toBeTruthy();
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
  it('renders twenty sessions per project and "Show 100 more", fast', async () => {
    const many = scenarioFile('many-sessions');
    fillStores(many);
    const started = performance.now();
    render(<Sidebar />);
    const elapsed = performance.now() - started;
    if (elapsed > 200) console.info(`[sidebar] many-sessions mounted in ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(1000);
    const groups = within(tree('Projects')).getAllByRole('group');
    expect(groups.map((g) => within(g).getAllByRole('treeitem').filter((t) => t.dataset.kind === 'session').length)).toEqual([20, 20, 20]);
    expect(screen.getAllByRole('treeitem', { name: 'Show 100 more' })).toHaveLength(3);
    await userEvent.setup().click(screen.getAllByRole('treeitem', { name: 'Show 100 more' })[0]);
    expect(within(groups[0]).getAllByRole('treeitem').filter((t) => t.dataset.kind === 'session')).toHaveLength(120);
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
// word on an idle row, with the release's time and budget in its title; no glyph, unread or Needs-you change.
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
    render(<Sidebar />);
    const mark = within(row('Settings idle probe')).getByText('released');
    expect(mark.getAttribute('title')).toBe('Released at 14:02 to stay under the 8 GB memory budget · Send resumes it');
    expect(within(row('Settings idle probe')).getByRole('img', { name: 'Idle' }).textContent).toBe('○'); // the idle glyph, unchanged
    expect(within(row('Settings idle probe')).queryByLabelText('Unread')).toBeNull();
    expect(needsYouTitles()).not.toContain('Settings idle probe');
    expect(screen.getAllByText('released')).toHaveLength(1);
  });
});
// C12 end
