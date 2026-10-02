import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { WorktreeInfo, WorktreeStatus } from '@shared/sessions/worktree';
import { project, record } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { intent, putIntent, REPO, resetSetupStore } from '../test-support/setup-intents';
import { resetShellStores } from '../test-support/shell-stores';
import { closeDialog, openDialog, useDialogs } from './dialogs';
import { SessionDialogs } from './SessionDialogs';
import { runProjectAction } from '../sidebar/project-actions';
import { registerSessionActions } from './actions';
import { currentSet } from '../stores/layout-model';

const P = 'p1' as ProjectId;
const HEAD = 'a'.repeat(40);
const at = (name: string) => `${REPO}/.claude/worktrees/${name}`;
const BOUND = 'b1111111-1111-4111-8111-111111111111' as AppSessionId;
const NEW = 'c1111111-1111-4111-8111-111111111111' as AppSessionId;
const EMPTY = { self: 0, foreign: 0, unbound: 0, idle: 0, archived: 0, idleAppSessionIds: [], liveAppSessionIds: [] };

const wt = (path: string, over: Partial<WorktreeInfo> = {}): WorktreeInfo => ({ repoRoot: REPO, path, branch: `worktree-${path.split('/').at(-1)}`, head: HEAD, isMain: false, locked: false, prunable: false, managed: true, ...over });
const MAIN = wt(REPO, { isMain: true, branch: 'main', managed: false });
const WORKTREES = [MAIN, wt(at('bound')), wt(at('orphan')), wt(at('gone'), { prunable: true })];
const statusOf = (path: string): WorktreeStatus => {
  const info = WORKTREES.find((w) => w.path === path)!;
  if (path === at('bound')) return { ...info, dirty: { tracked: 0, untracked: 0 }, occupancy: { ...EMPTY, idle: 1, idleAppSessionIds: [BOUND] }, state: 'clean' };
  if (path === at('orphan')) return { ...info, dirty: { tracked: 2, untracked: 1 }, occupancy: EMPTY, state: 'dirty' };
  return { ...info, dirty: { tracked: 0, untracked: 0 }, occupancy: EMPTY, state: 'clean' };
};

let fake: FakeClient;
let offActions: () => void;
beforeEach(() => {
  resetShellStores();
  resetSetupStore();
  useSessions.setState({
    projects: new Map([[P, project('p1', 0, { name: 'repo', directory: REPO })]]),
    records: new Map([[BOUND, record(BOUND, { projectId: P, title: { text: 'Bound work', source: 'user' }, directory: at('bound') })]]),
  });
  fake = fakeClient({
    'git.worktree.list': () => ({ repoRoot: REPO, commonDir: `${REPO}/.git`, worktrees: WORKTREES }),
    'git.worktree.status': ({ path }: { path: string }) => statusOf(path),
    'git.worktree.branch': () => null,
    'session.intent.patch': ({ appSessionId, patch }: { appSessionId: AppSessionId; patch: object }) => ({ ...intent({ appSessionId, projectId: P }), ...patch }),
  });
  window.maws = fake.client;
  offActions = registerSessionActions();
});
afterEach(() => {
  act(() => closeDialog());
  offActions();
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
});

const open = async () => {
  render(<SessionDialogs />);
  act(() => runProjectAction('worktrees', P));
  return screen.findByRole('dialog', { name: 'Worktrees · repo' });
};
const rowNamed = async (dialog: HTMLElement, name: string) => within(dialog).findByRole('listitem', { name });

describe('Worktrees… dialog', () => {
  it('lists the main checkout and every linked worktree with its state, the bound session from occupancy, and the orphan as No session', async () => {
    const dialog = await open();
    const rows = within(within(dialog).getByRole('list', { name: 'Worktrees' })).getAllByRole('listitem', { name: /./ });
    expect(rows.map((r) => [r.getAttribute('aria-label'), r.dataset.state])).toEqual([
      ['repo', 'clean'],
      ['bound', 'clean'],
      ['orphan', 'dirty'],
      ['gone', 'missing'],
    ]);
    expect(within(rows[0]!).queryByRole('button', { name: 'Remove…' })).toBeNull();
    expect(within(rows[1]!).getByRole('button', { name: 'Bound work' })).toBeTruthy();
    expect(within(rows[2]!).getByText('dirty · 3 changes')).toBeTruthy();
    expect(within(rows[2]!).getByText('No session')).toBeTruthy();
    expect(within(rows[3]!).getByRole('button', { name: 'New session here' }).hasAttribute('disabled')).toBe(true);
    expect(fake.invoked('git.worktree.list')).toEqual([{ repoRoot: REPO }]);
  });

  it('a checkout an unstarted tab uses is busy with its reason and cannot be removed', async () => {
    putIntent(intent({ appSessionId: NEW, projectId: P, location: { kind: 'existingWorktree', repoRoot: REPO, path: at('orphan') } }));
    const row = await rowNamed(await open(), 'orphan');
    expect(row.dataset.state).toBe('busy');
    expect(within(row).getByText('An unstarted tab uses this checkout')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Remove…' }).hasAttribute('disabled')).toBe(true);
  });

  it('New session here creates an unstarted session, sets its location to the checkout, opens its tab and closes the dialog', async () => {
    const offCreator = registerSessionCreator(async () => NEW);
    try {
      const row = await rowNamed(await open(), 'orphan');
      await userEvent.click(within(row).getByRole('button', { name: 'New session here' }));
      await waitFor(() => expect(fake.invoked('session.intent.patch')).toEqual([{ appSessionId: NEW, patch: { location: { kind: 'existingWorktree', repoRoot: REPO, path: at('orphan') } } }]));
      await waitFor(() => expect(useDialogs.getState().open).toBeNull());
      expect(currentSet(useLayout.getState().main).panes.flatMap((p) => p.tabs).some((t) => t.kind === 'session' && t.appSessionId === NEW)).toBe(true);
    } finally {
      offCreator();
    }
  });

  it('Remove… opens C10’s cleanup for that checkout, and closing it returns to a fresh read of the list', async () => {
    const row = await rowNamed(await open(), 'orphan');
    await userEvent.click(within(row).getByRole('button', { name: 'Remove…' }));
    const cleanupSheet = await screen.findByRole('dialog', { name: 'Clean up worktree orphan' });
    expect(useDialogs.getState().open).toMatchObject({ kind: 'cleanup', target: { repoRoot: REPO, path: at('orphan'), branch: 'worktree-orphan' }, returnTo: { kind: 'worktrees', projectId: P } });
    await userEvent.click(within(cleanupSheet).getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('dialog', { name: 'Worktrees · repo' });
    await waitFor(() => expect(fake.invoked('git.worktree.list').length).toBe(3)); // the list, the cleanup's identity read, the list again
  });

  it('says Not a git repository for a project outside one', async () => {
    fake = fakeClient({});
    window.maws = fake.client;
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'worktrees', projectId: P }));
    await fake.fail('git.worktree.list', 'not a git repository');
    expect(await screen.findByText('Not a git repository')).toBeTruthy();
  });

  it('a cleanup opened elsewhere closes to nothing', () => {
    act(() => openDialog({ kind: 'cleanup', target: { repoRoot: REPO, path: at('orphan'), branch: null } }));
    act(() => closeDialog());
    expect(useDialogs.getState().open).toBeNull();
  });
});
