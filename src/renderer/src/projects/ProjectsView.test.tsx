import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MawsBridge, ProjectRecord } from '@shared/ipc/schema';
import { project, record } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerSessionActions } from '../sessions/actions';
import { closeDialog, useDialogs } from '../sessions/dialogs';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { ProjectsView } from './ProjectsView';
import { AddProject } from '../sidebar/AddProject';

const added = project('atlas-personal', 0, { name: 'atlas', directory: '/work/personal/atlas' });
const discovered = project('atlas-team', 1, { name: 'atlas', directory: '/work/team/atlas', discovered: true });
const hidden = project('notes', 2, { directory: '/work/writing/notes', hidden: true });
const choices = [added, discovered, hidden];
const offs: (() => void)[] = [];
let fake: ReturnType<typeof fakeClient>;

function setProjects(projects: ProjectRecord[], loaded = true) {
  act(() => useSessions.setState({ projects: new Map(projects.map((p) => [p.id, p])), loaded }));
}
const row = (name: string) => screen.getByRole('listitem', { name });
const show = (name: string) => within(row(name)).getByRole('button', { name: `Show in sidebar: ${name}` });
const hide = (name: string) => within(row(name)).getByRole('button', { name: `Hide from sidebar: ${name}` });
const answerRemoval = (yes: boolean) => {
  const dialog = useDialogs.getState().open;
  expect(dialog?.kind).toBe('confirm');
  if (dialog?.kind === 'confirm') act(() => dialog.answer(yes));
  act(() => closeDialog());
};

beforeEach(() => {
  resetShellStores();
  setProjects(choices);
  fake = fakeClient();
  window.maws = fake.client;
});
afterEach(() => {
  cleanup();
  closeDialog();
  offs.splice(0).forEach((off) => off());
  delete (window as { maws?: MawsBridge }).maws;
});

describe('Projects sidebar membership', () => {
  it('puts sidebar projects first on the page and in Add project, followed by hidden projects, then discoveries', async () => {
    const mine = project('z-workstation', 0);
    const other = project('b-notes', 1);
    const hidden = project('y-hidden', 2, { hidden: true });
    const discovered = project('a-temporary', 3, { discovered: true });
    setProjects([discovered, hidden, other, mine]);
    render(<><ProjectsView /><AddProject /></>);
    const lists = screen.getAllByRole('list');
    expect(lists.map((list) => list.getAttribute('aria-label'))).toEqual(['Sidebar projects', 'Hidden projects', 'Discovered projects']);
    expect(screen.getAllByRole('listitem').map((r) => r.getAttribute('aria-label'))).toEqual(['z-workstation', 'b-notes', 'y-hidden', 'a-temporary']);
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }));
    const chooser = await screen.findByRole('dialog', { name: 'Add project' });
    const groups = within(chooser).getAllByRole('group');
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Sidebar projects', 'Hidden projects', 'Discovered projects']);
    expect(within(groups[0]).getAllByRole('button').map((button) => button.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('z-workstation'), expect.stringContaining('b-notes')]));
    expect(within(chooser).getByRole('button', { name: 'In sidebar: z-workstation' })).toHaveProperty('disabled', true);
    await userEvent.click(within(chooser).getByRole('button', { name: 'Add y-hidden' }));
    expect(fake.invoked('session.projects.add')).toEqual([{ directory: hidden.directory }]);
    await act(() => fake.reply('session.projects.add', { ...hidden, hidden: false }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add project' })).toBeNull());
  });

  it('offers every known project without adding discoveries, and searches names and directories with stable duplicate labels', async () => {
    const user = userEvent.setup();
    render(<ProjectsView />);
    expect(screen.getAllByRole('listitem').map((r) => r.getAttribute('aria-label'))).toEqual(['atlas · personal', 'notes', 'atlas · team']);
    expect(hide('atlas · personal')).toBeTruthy();
    expect(show('atlas · team')).toBeTruthy();
    expect(show('notes')).toBeTruthy();
    expect(within(row('atlas · team')).getByText(discovered.directory)).toBeTruthy();
    const search = screen.getByRole('searchbox', { name: 'Search projects' });
    await user.type(search, '  /WORK/TEAM  ');
    expect(screen.getAllByRole('listitem').map((r) => r.getAttribute('aria-label'))).toEqual(['atlas · team']);
    await user.clear(search);
    await user.type(search, 'No matching folder');
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.getByText('No matching projects')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    // Discovery can keep arriving while the page is open; none of it is membership.
    setProjects([...choices, project('research', 3, { discovered: true })]);
    expect(show('research')).toBeTruthy();
    expect(fake.calls).toEqual([]);
  });

  it.each([
    ['atlas · team', discovered],
    ['notes', hidden],
  ] as const)('adds %s only on request, prevents duplicate submissions, and follows the authoritative project update', async (label, chosen) => {
    const user = userEvent.setup();
    render(<ProjectsView />);
    await user.click(show(label));
    expect(fake.invoked('session.projects.add')).toEqual([{ directory: chosen.directory }]);
    expect(show(label)).toHaveProperty('disabled', true);
    await user.click(show(label));
    expect(fake.invoked('session.projects.add')).toHaveLength(1);
    const promoted = { ...chosen, discovered: false, hidden: false };
    await act(() => fake.reply('session.projects.add', promoted));
    // A command response has no project-list revision and must not overwrite the store.
    expect(useSessions.getState().projects.get(chosen.id)).toBe(chosen);
    setProjects(choices.map((p) => p.id === chosen.id ? promoted : p));
    expect(hide(label)).toBeTruthy();
    expect(fake.calls).toEqual(['invoke session.projects.add']);
  });

  it('keeps a failed choice available, exposes the error, and permits retry without changing membership', async () => {
    const user = userEvent.setup();
    render(<ProjectsView />);
    await user.click(show('notes'));
    await act(() => fake.fail('session.projects.add', 'Directory no longer exists'));
    expect(screen.getByRole('alert').textContent).toContain('Directory no longer exists');
    expect(useSessions.getState().projects.get(hidden.id)).toBe(hidden);
    expect(show('notes')).toHaveProperty('disabled', false);
    await user.click(show('notes'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fake.invoked('session.projects.add')).toEqual([{ directory: hidden.directory }, { directory: hidden.directory }]);
    await act(() => fake.reply('session.projects.add', { ...hidden, hidden: false }));
  });

  it('uses the existing confirmed hide action, leaving running sessions and their records untouched', async () => {
    const running = record('running-atlas', { projectId: added.id });
    act(() => useSessions.setState({ records: new Map([[running.appId, running]]) }));
    offs.push(registerSessionActions());
    render(<ProjectsView />);
    const user = userEvent.setup();
    await user.click(hide('atlas · personal'));
    expect(fake.calls).toEqual([]);
    answerRemoval(false);
    expect(fake.calls).toEqual([]);
    await user.click(hide('atlas · personal'));
    answerRemoval(true);
    await waitFor(() => expect(fake.invoked('session.projects.remove')).toEqual([{ id: added.id }]));
    await act(() => fake.reply('session.projects.remove', undefined));
    setProjects(choices.map((p) => p.id === added.id ? { ...p, hidden: true } : p));
    expect(show('atlas · personal')).toBeTruthy();
    expect(useSessions.getState().records.get(running.appId)).toBe(running);
    expect(fake.calls).toEqual(['invoke session.projects.remove']);
  });

  it('disables unavailable registry actions and uses the registered native folder chooser, including cancellation', async () => {
    const user = userEvent.setup();
    render(<ProjectsView />);
    expect(hide('atlas · personal')).toHaveProperty('disabled', true);
    const choose = screen.getByRole('button', { name: 'Choose folder…' });
    expect(choose).toHaveProperty('disabled', true);
    act(() => { offs.push(registerSessionActions()); });
    expect(hide('atlas · personal')).toHaveProperty('disabled', false);
    expect(choose).toHaveProperty('disabled', false);
    await user.click(choose);
    expect(fake.invoked('layout.pickFiles')).toEqual([{ kind: 'directory', directory: null, multiple: false }]);
    await act(() => fake.reply('layout.pickFiles', { files: [] }));
    expect(fake.invoked('session.projects.add')).toEqual([]);
    await user.click(choose);
    await act(() => fake.reply('layout.pickFiles', { files: [{ path: '/work/selected', name: 'selected', bytes: 0, mediaType: 'inode/directory', data: null }] }));
    expect(fake.invoked('session.projects.add')).toEqual([{ directory: '/work/selected' }]);
    await act(() => fake.reply('session.projects.add', project('selected', 4, { directory: '/work/selected' })));
  });

  it('distinguishes loading from an empty workspace and still offers the folder chooser when empty', () => {
    setProjects([], false);
    render(<ProjectsView />);
    expect(screen.getByRole('status').textContent).toContain('Loading projects');
    expect(screen.queryByText('No projects yet')).toBeNull();
    setProjects([]);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('No projects yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose folder…' })).toBeTruthy();
  });
});
