// New chat (2026-10-01, the owner's ruling after Codex's new-thread composer): the project row's chip, its menu (the
// project picker), the read-only branch and the Worktree checkbox.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { project, record } from '../../../../../test/support/builders';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import type { HookResult } from '../setup-intent';
import type { ProjectRowBinding } from './bindings';
import { matchesProject, ProjectRow, recentProjects } from './ProjectRow';

const ALPHA = 'alpha' as ProjectId;
const BETA = 'beta' as ProjectId;
const GAMMA = 'gamma' as ProjectId;

function binding(over: Partial<ProjectRowBinding> = {}): ProjectRowBinding {
  return {
    projectId: null,
    label: null,
    path: null,
    branch: null,
    worktree: null,
    disabled: null,
    choose: vi.fn(async () => ({ ok: true as const })),
    newProject: vi.fn(async () => ({ ok: true as const })),
    setWorktree: vi.fn(async () => ({ ok: true as const })),
    ...over,
  };
}

beforeEach(() => {
  resetShellStores();
  // beta was active last, then alpha; gamma has no session (it sorts by when it was added, the oldest here)
  useSessions.setState({
    projects: new Map([
      [ALPHA, project('alpha', 0, { name: 'Alpha', directory: '/work/alpha' })],
      [BETA, project('beta', 1, { name: 'beta', directory: '/work/beta' })],
      [GAMMA, project('gamma', 2, { name: 'Alpha', directory: '/elsewhere/alpha-two', createdAt: '2026-01-01T00:00:00.000Z' })],
    ]),
    records: new Map([
      ['s-a' as AppSessionId, record('s-a', { projectId: ALPHA, updatedAt: '2026-09-29T10:00:00.000Z' })],
      ['s-b' as AppSessionId, record('s-b', { projectId: BETA, updatedAt: '2026-09-30T10:00:00.000Z' })],
    ]),
  });
});
afterEach(cleanup);

const menu = () => screen.getByRole('dialog', { name: 'Choose a project' });
const rows = () => within(menu()).getAllByRole('option').map((o) => o.textContent);

describe('the project row', () => {
  it('reads "Choose a project" with a waiting dot and no branch or checkbox until one is chosen', () => {
    render(<ProjectRow binding={binding()} />);
    const chip = screen.getByRole('button', { name: 'Choose a project' });
    expect(chip.title).toBe('Select a project to run your chat in');
    expect(chip.querySelector('.bg-fg-faint')).not.toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByLabelText(/^Branch /)).toBeNull();
  });

  it('lists the projects most recently active first, the folder beside a name it differs from, then New project and Don’t work in a project', async () => {
    const b = binding();
    render(<ProjectRow binding={b} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Choose a project' }));
    expect(within(menu()).getByPlaceholderText('Search projects')).toBeTruthy();
    expect(rows()).toEqual(['beta', 'Alphaalpha', 'Alphaalpha-two', 'New project', "Don't work in a project"]);
    // two projects named alike: the path is the tooltip (Codex's collision rule)
    expect(within(menu()).getAllByRole('option').slice(1, 3).map((o) => o.title)).toEqual(['/work/alpha', '/elsewhere/alpha-two']);
    expect(within(menu()).getAllByRole('option')[0]!.title).toBe('');
  });

  it('searches names and paths, says when nothing matches, and chooses a project, a new one or none', async () => {
    const b = binding();
    render(<ProjectRow binding={b} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Choose a project' }));
    await user.type(within(menu()).getByPlaceholderText('Search projects'), 'elsewhere');
    expect(rows()).toEqual(['Alphaalpha-two', 'New project', "Don't work in a project"]);
    await user.clear(within(menu()).getByPlaceholderText('Search projects'));
    await user.type(within(menu()).getByPlaceholderText('Search projects'), 'zzz');
    expect(within(menu()).getByText('No projects found')).toBeTruthy();
    await user.clear(within(menu()).getByPlaceholderText('Search projects'));
    await user.click(within(menu()).getByRole('option', { name: 'beta' }));
    expect(b.choose).toHaveBeenCalledWith(BETA);
    expect(screen.queryByRole('dialog', { name: 'Choose a project' })).toBeNull(); // closes once chosen
    await user.click(screen.getByRole('button', { name: 'Choose a project' }));
    await user.click(within(menu()).getByRole('option', { name: 'New project' }));
    expect(b.newProject).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Choose a project' }));
    await user.click(within(menu()).getByRole('option', { name: "Don't work in a project" }));
    expect(b.choose).toHaveBeenLastCalledWith(null);
  });

  it.each(['choose', 'newProject', 'setWorktree'] as const)('disables the checkbox and all menu choices while %s is pending, then releases them', async (write) => {
    let resolve!: (result: HookResult) => void;
    const pending = new Promise<HookResult>((done) => { resolve = done; });
    const b = binding({ projectId: ALPHA, label: 'Alpha', path: '/work/alpha', worktree: false, [write]: vi.fn(() => pending) });
    render(<ProjectRow binding={b} />);
    const user = userEvent.setup();
    const checkbox = screen.getByRole('checkbox', { name: 'Worktree' }) as HTMLInputElement;
    const chip = screen.getByRole('button', { name: 'Project Alpha' });
    if (write === 'setWorktree') await user.click(checkbox);
    await user.click(chip);
    if (write !== 'setWorktree') await user.click(within(menu()).getByRole('option', { name: write === 'choose' ? 'beta' : 'New project' }));
    expect(b[write]).toHaveBeenCalledTimes(1);
    expect(checkbox.disabled).toBe(true);
    expect(within(menu()).getAllByRole('option').every((o) => o.getAttribute('aria-disabled') === 'true')).toBe(true);
    await user.click(within(menu()).getByRole('option', { name: 'beta' }));
    expect(b.choose).toHaveBeenCalledTimes(write === 'choose' ? 1 : 0);
    await act(async () => resolve({ ok: true }));
    expect(checkbox.disabled).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Choose a project' })).toBeNull();
    await user.click(chip);
    expect(within(menu()).getAllByRole('option').every((o) => o.getAttribute('aria-disabled') === 'false')).toBe(true);
  });

  it.each([
    ['New project', '{End}{ArrowUp}'],
    ["Don't work in a project", '{End}'],
  ])('reaches %s with the keyboard and selects it with Enter', async (name, keys) => {
    const b = binding();
    render(<ProjectRow binding={b} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Choose a project' }));
    await user.keyboard(`{ArrowDown}${keys}`);
    expect(within(menu()).getByRole('option', { name }).getAttribute('data-selected')).toBe('true');
    await user.keyboard('{Enter}');
    if (name === 'New project') expect(b.newProject).toHaveBeenCalledTimes(1);
    else expect(b.choose).toHaveBeenCalledWith(null);
  });

  it('can create a project with the keyboard when there are no projects and no project is already the choice', async () => {
    useSessions.setState({ projects: new Map(), records: new Map() });
    const b = binding({ label: 'No project' });
    render(<ProjectRow binding={b} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Project No project' }));
    expect(within(menu()).getByText('No projects found')).toBeTruthy();
    expect(rows()).toEqual(['New project']);
    await user.keyboard('{ArrowDown}{End}{Enter}');
    expect(b.newProject).toHaveBeenCalledTimes(1);
  });

  it('marks the chosen project, shows its branch read-only and the Worktree checkbox, which writes through the binding', async () => {
    const b = binding({ projectId: ALPHA, label: 'Alpha', path: '/work/alpha', branch: 'main', worktree: false });
    render(<ProjectRow binding={b} />);
    const chip = screen.getByRole('button', { name: 'Project Alpha' });
    expect(chip.title).toBe('/work/alpha · Change the project for this chat');
    expect(chip.querySelector('.bg-success')).not.toBeNull();
    expect(screen.getByLabelText('Branch main').textContent).toBe('⎇ main');
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: 'Worktree' }));
    expect(b.setWorktree).toHaveBeenCalledWith(true);
    await user.click(chip);
    const current = within(menu()).getAllByRole('option').filter((o) => o.getAttribute('aria-current') === 'true');
    expect(current.map((o) => o.title || o.textContent)).toEqual(['/work/alpha']);
  });

  it('hides Don’t work in a project once no project is the choice, and shows a refused write', async () => {
    const b = binding({ label: 'No project', path: '/Users/someone', choose: vi.fn(async () => ({ ok: false as const, error: 'projectId: unknown project beta' })) });
    render(<ProjectRow binding={b} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Project No project' }));
    expect(rows()).not.toContain("Don't work in a project");
    await user.click(within(menu()).getByRole('option', { name: 'beta' }));
    expect(screen.getByRole('alert').textContent).toBe('projectId: unknown project beta');
    expect(menu()).toBeTruthy(); // stays open on a refusal
  });

  it('disables every choice with the gate’s reason', async () => {
    const b = binding({ projectId: ALPHA, label: 'Alpha', path: '/work/alpha', worktree: true, disabled: 'Session is starting…' });
    render(<ProjectRow binding={b} />);
    expect(screen.getByRole('button', { name: 'Project Alpha' }).title).toBe('Session is starting…');
    expect((screen.getByRole('checkbox', { name: 'Worktree' }) as HTMLInputElement).disabled).toBe(true);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Project Alpha' }));
    expect(within(menu()).getAllByRole('option').every((o) => o.getAttribute('aria-disabled') === 'true')).toBe(true);
  });

  // W10 (C9): what the "+" menu's Add directory… gave the tab, read-only, in the chip's tooltip and at the menu's foot
  it('lists the additional directories read-only in the chip’s tooltip and its menu, and nothing when there are none', async () => {
    const b = binding({ projectId: ALPHA, label: 'Alpha', path: '/work/alpha' });
    const { rerender } = render(<ProjectRow binding={b} />);
    expect(screen.getByRole('button', { name: 'Project Alpha' }).title).toBe('/work/alpha · Change the project for this chat');
    rerender(<ProjectRow binding={b} directories={['/work/shared', '/Users/someone/notes']} />);
    expect(screen.getByRole('button', { name: 'Project Alpha' }).title).toBe('/work/alpha · Change the project for this chat\n\nAdditional directories\n/work/shared\n~/notes');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Project Alpha' }));
    const list = within(menu()).getByRole('list', { name: 'Additional directories' });
    expect(within(list).getAllByRole('listitem').map((li) => [li.textContent, li.title])).toEqual([
      ['/work/shared', '/work/shared'],
      ['~/notes', '/Users/someone/notes'],
    ]);
    expect(within(list).queryByRole('button')).toBeNull(); // read-only
    expect(rows()).not.toContain('/work/shared'); // a note, not a choice
  });
});

describe('the picker’s order and search', () => {
  it('orders as the sidebar’s level one, and matches a name or a path', () => {
    const { records, digests, projects } = useSessions.getState();
    expect(recentProjects({ records, digests, projects: [...projects.values()], rows: [] }).map((p) => p.id)).toEqual([BETA, ALPHA, GAMMA]);
    const gamma = projects.get(GAMMA)!;
    expect([matchesProject(gamma, ''), matchesProject(gamma, 'ALPHA'), matchesProject(gamma, 'elsewhere'), matchesProject(gamma, 'beta')]).toEqual([true, true, true, false]);
  });
});
