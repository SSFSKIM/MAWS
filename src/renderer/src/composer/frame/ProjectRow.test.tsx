// New chat (2026-10-01, the owner's ruling after Codex's new-thread composer): the project row's chip, its menu (the
// project picker), the read-only branch and the Worktree checkbox.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { project, record } from '../../../../../test/support/builders';
import { addressOf } from '@shared/machine/address';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { OrgKey } from '@shared/machine/org-key';
import { HOME_CHECKOUT, SPAWN_HOME_CAPABILITY } from '@shared/ipc/schema/session';
import { ipc } from '../../ipc/client';
import { useDialogs } from '../../sessions/dialogs';
import { resetRemoteSpawn, SPAWN_WORDS, spawnTargetOf, useRemoteSpawn, type SpawnTarget } from '../../sessions/remote-spawn';
import { forgetRemotePlaces, SETUP_WORDS } from '../../sessions/remote-setup';
import { useMachines } from '../../stores/machines';
import { useSessions } from '../../stores/sessions';
import { resetShellStores } from '../../test-support/shell-stores';
import type { HookResult } from '../setup-intent';
import type { ProjectRowBinding } from './bindings';
import { matchesProject, NO_PROJECT_LABEL, PLACE_WORDS, ProjectRow, recentProjects } from './ProjectRow';

// P5 O6 M2: the page holds addresses; the picker lists this machine's projects (M5)
const ALPHA = at('alpha' as ProjectId);
const BETA = at('beta' as ProjectId);
const GAMMA = at('gamma' as ProjectId);
const THERE = addressOf(OTHER_MACHINE, 'studio' as ProjectId);

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
      [ALPHA, project(ALPHA, 0, { name: 'Alpha', directory: '/work/alpha' })],
      [BETA, project(BETA, 1, { name: 'beta', directory: '/work/beta' })],
      [GAMMA, project(GAMMA, 2, { name: 'Alpha', directory: '/elsewhere/alpha-two', createdAt: '2026-01-01T00:00:00.000Z' })],
      [THERE, project(THERE, 3, { name: 'studio-only', directory: '/work/studio' })], // another machine's: not offered
    ]),
    records: new Map([
      [at('s-a' as AppSessionId), record(at('s-a'), { projectId: ALPHA, updatedAt: '2026-09-29T10:00:00.000Z' })],
      [at('s-b' as AppSessionId), record(at('s-b'), { projectId: BETA, updatedAt: '2026-09-30T10:00:00.000Z' })],
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

// 2026-11-06 (the owner's ruling: the machine first, the place following it): with another machine chosen for a place of
// its own, the chip and its menu are that machine's: its projects, New project there and its home, each greyed with why
// when that machine can't offer it; This Mac chosen again, the local row as it was.
describe('the project row on another machine', () => {
  const TAB = at('new-1' as AppSessionId);
  const HOME_PAGE = { entries: [{ name: 'Developer', path: '/Users/mini/Developer', protected: false }], cursor: null };
  const theirs = (id: string, name: string, directory: string, createdAt = '2026-01-01T00:00:00.000Z') => project(addressOf(OTHER_MACHINE, id as ProjectId), 0, { name, directory, createdAt });
  const onMini = (over: Partial<SpawnTarget> = {}) => useRemoteSpawn.getState().choose(TAB, { machine: OTHER_MACHINE, name: 'mini', checkout: null, key: null, ...over });
  const answer = (owner = true) =>
    vi.spyOn(ipc, 'invoke').mockImplementation((async (name: string) => {
      if (name === 'session.projects.list') return { ok: true, value: { projects: [theirs('notes', 'notes', '/Users/mini/notes'), theirs('app', 'app', '/Users/mini/src/app', '2026-02-01T00:00:00.000Z')], revision: 1 } };
      if (name === 'machine.folders.list') return owner ? { ok: true, value: HOME_PAGE } : { ok: false, error: { code: 'internal', message: 'refused owners-only', issues: { refusal: 'owners-only' } } };
      return { ok: false, error: { code: 'internal', message: `unexpected ${name}` } };
    }) as never);
  const mini = (capabilities: string[] = [SPAWN_HOME_CAPABILITY]): MachineState => ({ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-11-06T00:00:00Z', generation: 1, carrier: 'relay', capabilities });
  const roster = (capabilities?: string[]) => useMachines.getState().applyRoster([{ ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-06T00:00:00Z', generation: 0 }, mini(capabilities)]);
  afterEach(() => {
    resetRemoteSpawn();
    forgetRemotePlaces(); // the UX wave, U9: the chooser's listing of this run
    useDialogs.setState({ open: null });
    useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
    vi.restoreAllMocks();
  });

  // The UX wave, U9 (O-39, A1; M5): the machine's projects show as they answer, the folder read holding nothing back;
  // the two choices that need it wait for it
  it('lists the machine’s projects before its folders answer, New project and Don’t work in a project disabled until they do', async () => {
    roster();
    let folders: (value: unknown) => void = () => {};
    vi.spyOn(ipc, 'invoke').mockImplementation((async (name: string) => {
      if (name === 'session.projects.list') return { ok: true, value: { projects: [theirs('notes', 'notes', '/Users/mini/notes')], revision: 1 } };
      if (name === 'machine.folders.list') return new Promise((resolve) => (folders = resolve));
      return { ok: false, error: { code: 'internal', message: `unexpected ${name}` } };
    }) as never);
    onMini();
    render(<ProjectRow binding={binding()} appSessionId={TAB} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Choose a project' }));
    await vi.waitFor(() => expect(rows()).toEqual(['notes', 'New project', "Don't work in a project"]));
    expect(within(menu()).getAllByRole('option').slice(1).map((o) => o.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
    await act(async () => folders({ ok: true, value: HOME_PAGE }));
    await vi.waitFor(() => expect(within(menu()).getAllByRole('option').slice(1).map((o) => o.getAttribute('aria-disabled'))).toEqual(['false', 'false']));
  });

  it('reads Choose a project there, lists that machine’s projects newest first, and a choice is the place there, no branch or Worktree box', async () => {
    roster();
    const invoke = answer();
    onMini();
    render(<ProjectRow binding={binding({ projectId: ALPHA, label: 'Alpha', path: '/work/alpha', branch: 'main', worktree: false })} appSessionId={TAB} />);
    const chip = screen.getByRole('button', { name: 'Choose a project' });
    expect(chip.title).toBe(PLACE_WORDS.choose('mini'));
    expect(screen.queryByLabelText(/^Branch /)).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    const user = userEvent.setup();
    await user.click(chip);
    await vi.waitFor(() => expect(rows()).toEqual(['app', 'notes', 'New project', "Don't work in a project"])); // app's sessions none here: by when each was added
    expect(invoke).toHaveBeenCalledWith('session.projects.list', undefined, { machine: OTHER_MACHINE });
    expect(invoke).toHaveBeenCalledWith('machine.folders.list', {}, { machine: OTHER_MACHINE });
    await user.click(within(menu()).getByRole('option', { name: 'notes' }));
    expect(spawnTargetOf(TAB, null)).toEqual({ machine: OTHER_MACHINE, name: 'mini', checkout: '/Users/mini/notes', key: null, label: 'notes' });
    expect(screen.getByRole('button', { name: 'Project notes' }).title).toBe(PLACE_WORDS.change('notes', 'mini'));
  });

  it('takes the home for Don’t work in a project, and opens that machine’s folder sheet for New project', async () => {
    roster();
    answer();
    onMini();
    render(<ProjectRow binding={binding()} appSessionId={TAB} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Choose a project' }));
    await vi.waitFor(() => expect(within(menu()).getByRole('option', { name: "Don't work in a project" }).getAttribute('aria-disabled')).toBe('false'));
    await user.click(within(menu()).getByRole('option', { name: "Don't work in a project" }));
    expect(spawnTargetOf(TAB, null)).toEqual({ machine: OTHER_MACHINE, name: 'mini', checkout: HOME_CHECKOUT, key: null, label: NO_PROJECT_LABEL });
    await user.click(screen.getByRole('button', { name: `Project ${NO_PROJECT_LABEL}` }));
    await vi.waitFor(() => expect(within(menu()).getByRole('option', { name: 'New project' }).getAttribute('aria-disabled')).toBe('false'));
    expect(rows()).not.toContain("Don't work in a project"); // the choice already
    await user.click(within(menu()).getByRole('option', { name: 'New project' }));
    expect(useDialogs.getState().open).toEqual({ kind: 'remoteSetup', request: { kind: 'folder', tab: TAB, machine: OTHER_MACHINE, name: 'mini', key: null, home: '/Users/mini', first: HOME_PAGE, suggestions: [] } });
  });

  it('greys New project and Don’t work in a project with why: not its owner, or an endpoint that predates a chat in its home', async () => {
    roster();
    answer(false);
    onMini();
    const { unmount } = render(<ProjectRow binding={binding()} appSessionId={TAB} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Choose a project' }));
    await vi.waitFor(() => expect(rows()).toEqual(['app', 'notes', `New project${SETUP_WORDS.notOwner('mini')}`, `Don't work in a project${SETUP_WORDS.homeNotOwner('mini')}`]));
    expect(within(menu()).getAllByRole('option').slice(2).map((o) => o.getAttribute('aria-disabled'))).toEqual(['true', 'true']);
    unmount();
    roster(['rl2.feeds']);
    vi.restoreAllMocks();
    answer();
    render(<ProjectRow binding={binding()} appSessionId={TAB} />);
    await user.click(screen.getByRole('button', { name: 'Choose a project' }));
    await vi.waitFor(() => expect(rows().at(-1)).toBe(`Don't work in a project${SPAWN_WORDS.noHome('mini')}`));
    expect(within(menu()).getByRole('option', { name: 'New project' }).getAttribute('aria-disabled')).toBe('false');
  });

  it('keeps the local project’s words, branch and Worktree box for its checkout there, the menu that machine’s, the checkout marked', async () => {
    const KEY = 'repo:github.com/acme/app' as OrgKey;
    useSessions.setState({ projects: new Map(useSessions.getState().projects).set(ALPHA, project(ALPHA, 0, { name: 'Alpha', directory: '/work/alpha', org: { key: KEY, name: 'app', source: 'remote', smnsId: null } })) });
    roster();
    answer();
    useRemoteSpawn.getState().choose(TAB, { machine: OTHER_MACHINE, name: 'mini', checkout: '/Users/mini/src/app', key: KEY });
    render(<ProjectRow binding={binding({ projectId: ALPHA, label: 'Alpha', path: '/work/alpha', branch: 'main', worktree: false })} appSessionId={TAB} />);
    expect(screen.getByLabelText('Branch main')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Worktree' })).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Project Alpha' }));
    await vi.waitFor(() => expect(rows()).toEqual(['app✓', 'notes', 'New project', "Don't work in a project"]));
  });

  it('names the place there, and gives the local row and menu back once This Mac is chosen again', async () => {
    roster();
    answer();
    render(<ProjectRow binding={binding({ projectId: ALPHA, label: 'Alpha', path: '/work/alpha', branch: 'main', worktree: false })} appSessionId={TAB} />);
    act(() => onMini({ checkout: '/Users/mini/notes', label: 'notes' }));
    expect(screen.getByRole('button', { name: 'Project notes' })).toBeTruthy();
    act(() => useRemoteSpawn.getState().choose(TAB, null));
    expect(screen.getByRole('button', { name: 'Project Alpha' })).toBeTruthy();
    expect(screen.getByLabelText('Branch main')).toBeTruthy();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Project Alpha' }));
    expect(rows()).toEqual(['beta', 'Alphaalpha✓', 'Alphaalpha-two', 'New project', "Don't work in a project"]);
  });
});

describe('the picker’s order and search', () => {
  it('orders as the sidebar’s level one, and matches a name or a path', () => {
    const { records, digests, projects } = useSessions.getState();
    expect(recentProjects({ records, digests, projects: [...projects.values()].filter((p) => p.id !== THERE), rows: [] }).map((p) => p.id)).toEqual([BETA, ALPHA, GAMMA]);
    const gamma = projects.get(GAMMA)!;
    expect([matchesProject(gamma, ''), matchesProject(gamma, 'ALPHA'), matchesProject(gamma, 'elsewhere'), matchesProject(gamma, 'beta')]).toEqual([true, true, true, false]);
  });
});
