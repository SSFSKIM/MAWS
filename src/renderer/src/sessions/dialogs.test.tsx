import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { WorktreeStatus } from '@shared/sessions/worktree';
import { project, record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { REPO, resetSetupStore } from '../test-support/setup-intents';
import { resetShellStores } from '../test-support/shell-stores';
import { closeDialog, openDialog } from './dialogs';
import { cleanupTargetOf, confirmLabel } from './CleanupDialog';
import { SessionDialogs, DeletionNotice } from './SessionDialogs';
import { useSetup } from './store';

const WT = `${REPO}/.claude/worktrees/accept-one`;
const HEAD = 'a'.repeat(40);
const ids = ['a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 'a3333333-3333-4333-8333-333333333333', 'a4444444-4444-4444-8444-444444444444'] as AppSessionId[];
const [IDLE1, IDLE2, LIVE, TERM] = ids as [AppSessionId, AppSessionId, AppSessionId, AppSessionId];

let fake: FakeClient;
function withMain(auto: NonNullable<Parameters<typeof fakeClient>[0]>) {
  fake = fakeClient(Object.fromEntries(Object.entries(auto).filter(([, answer]) => answer !== undefined)));
  window.maws = fake.client;
}

function worktreeStatus(over: Partial<WorktreeStatus> = {}): WorktreeStatus {
  return {
    repoRoot: REPO,
    path: WT,
    branch: 'worktree-accept-one',
    head: HEAD,
    isMain: false,
    locked: false,
    prunable: false,
    managed: true,
    dirty: { tracked: 0, untracked: 0 },
    occupancy: { self: 0, foreign: 0, unbound: 0, idle: 0, archived: 0, idleAppSessionIds: [], liveAppSessionIds: [] },
    state: 'clean',
    ...over,
  };
}

const listed = { repoRoot: REPO, commonDir: `${REPO}/.git`, worktrees: [{ repoRoot: REPO, path: WT, branch: 'worktree-accept-one', head: HEAD, isMain: false, locked: false, prunable: false, managed: true }] };
const branchStatus = (over = {}) => ({ repoRoot: REPO, branch: 'worktree-accept-one', head: HEAD, checkedOutAt: WT, base: 'main', ahead: 0, merged: true, ...over });

beforeEach(() => {
  resetShellStores();
  resetSetupStore();
  useSessions.setState({
    records: new Map(
      [
        record(IDLE1, { title: { text: 'Idle one', source: 'user' }, worktree: { path: WT, branch: 'worktree-accept-one' } }),
        record(IDLE2, { title: { text: 'Idle two', source: 'user' }, worktree: { path: WT, branch: 'worktree-accept-one' } }),
        record(LIVE, { title: { text: 'Working here', source: 'user' }, holder: { kind: 'self' }, worktree: { path: WT, branch: 'worktree-accept-one' } }),
        record(TERM, { title: { text: 'In a terminal', source: 'user' }, holder: { kind: 'terminal', pid: 4242 }, worktree: { path: WT, branch: 'worktree-accept-one' } }),
      ].map((r) => [r.appId, r]),
    ),
    engine: new Map([[LIVE, status(LIVE)]]),
  });
});
afterEach(() => {
  act(() => closeDialog());
  cleanup();
  delete (window as { maws?: MawsBridge }).maws;
});

describe('cleanup dialog archives idle only', () => {
  it('counts the idle sessions, names every live one as skipped, archives only the idle ones, and names a skipped_live answer', async () => {
    const busy = worktreeStatus({ state: 'busy', occupancy: { self: 1, foreign: 1, unbound: 0, idle: 2, archived: 0, idleAppSessionIds: [IDLE1, IDLE2], liveAppSessionIds: [LIVE, TERM] } });
    withMain({
      'git.worktree.list': () => listed,
      'git.worktree.status': () => busy,
      'git.worktree.branch': () => branchStatus(),
      'session.archive': ({ appSessionId }: { appSessionId: AppSessionId }) => (appSessionId === IDLE2 ? { status: 'skipped_live', holder: { kind: 'terminal', pid: 5151 } } : { archived: true }),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'cleanup', target: { repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
    const dialog = await screen.findByRole('dialog', { name: 'Clean up worktree accept-one' });
    await within(dialog).findByText('2 idle sessions to archive');
    expect(within(dialog).getByText(/busy · 2 sessions live here/)).toBeTruthy();
    expect(within(dialog).getByText('Not archived: 2 live sessions; archive them from their rows')).toBeTruthy();
    expect(within(within(dialog).getByRole('list', { name: 'Not archived' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Working here · Working in MAWS',
      'In a terminal · terminal · 4242',
    ]);
    for (const step of ['Remove checkout', 'Delete branch']) expect(within(dialog).getByRole('checkbox', { name: step }).hasAttribute('disabled'), step).toBe(true);

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Archive sessions' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive 2' }));
    await waitFor(() => expect(fake.invoked('session.archive')).toEqual([
      { appSessionId: IDLE1, onlyIfIdle: true },
      { appSessionId: IDLE2, onlyIfIdle: true },
    ]));
    await waitFor(() =>
      expect(within(within(dialog).getByRole('list', { name: 'Not archived' })).getAllByRole('listitem').map((li) => li.textContent)).toContain('Idle two · terminal · 5151'),
    );
    expect(fake.invoked('git.worktree.remove')).toEqual([]);
  });

  it('removes a clean checkout and deletes its merged branch in order, each expecting the identity read at open', async () => {
    let removed = false;
    withMain({
      'git.worktree.list': () => listed,
      'git.worktree.status': () => (removed ? null : worktreeStatus()),
      'git.worktree.branch': () => branchStatus(removed ? { checkedOutAt: null } : {}),
      'git.worktree.remove': () => ((removed = true), { removed: true, prunedOnly: false }),
      'git.worktree.deleteBranch': () => ({ deleted: true, wasMerged: true }),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'cleanup', target: { repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/· clean/);
    expect(within(dialog).getByText('After removal only')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Remove checkout' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Delete branch' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove and delete branch' }));
    await waitFor(() => expect(fake.invoked('git.worktree.deleteBranch')).toHaveLength(1));
    expect(fake.invoked('git.worktree.remove')).toEqual([{ repoRoot: REPO, path: WT, expect: { branch: 'worktree-accept-one', head: HEAD }, discard: false }]);
    expect(fake.invoked('git.worktree.deleteBranch')).toEqual([{ repoRoot: REPO, branch: 'worktree-accept-one', expect: { head: HEAD }, acknowledgeUnmerged: false }]);
    await within(dialog).findByText(/· detached/);
  });

  it('discard and an unmerged branch each need their acknowledgement, and a refusal stops at its step in words', async () => {
    withMain({
      'git.worktree.list': () => listed,
      'git.worktree.status': () => worktreeStatus({ state: 'dirty', dirty: { tracked: 0, untracked: 1 } }),
      'git.worktree.branch': () => branchStatus({ ahead: 1, merged: false }),
      'git.worktree.remove': () => ({ refused: 'changed', detail: `head moved to ${'b'.repeat(40)}` }),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'cleanup', target: { repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/dirty · 1 change/);
    expect(within(dialog).getByText('dirty: 1 change')).toBeTruthy(); // the remove step's guard
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Discard changes and remove' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Delete branch' }));
    const confirmButton = within(dialog).getByRole('button', { name: 'Discard and remove and delete branch' });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Discard 1 uncommitted change; this cannot be undone' }));
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Delete 1 commit not on main; this cannot be undone' }));
    await userEvent.click(confirmButton);
    expect(await within(dialog).findByText(`Remove refused · changed: head moved to ${'b'.repeat(40)}`)).toBeTruthy();
    expect(fake.invoked('git.worktree.remove')).toEqual([{ repoRoot: REPO, path: WT, expect: { branch: 'worktree-accept-one', head: HEAD }, discard: true }]);
    expect(fake.invoked('git.worktree.deleteBranch')).toEqual([]);
  });

  it('reopened after the checkout was removed, it still reaches the leftover branch (detached) from the record’s branch', async () => {
    withMain({
      'git.worktree.list': () => ({ ...listed, worktrees: [] }),
      'git.worktree.status': () => null,
      'git.worktree.branch': () => branchStatus({ checkedOutAt: null }),
      'git.worktree.deleteBranch': () => ({ deleted: true, wasMerged: true }),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'cleanup', target: { repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/· detached/);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Delete branch' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete branch' }));
    await waitFor(() => expect(fake.invoked('git.worktree.deleteBranch')).toEqual([{ repoRoot: REPO, branch: 'worktree-accept-one', expect: { head: HEAD }, acknowledgeUnmerged: false }]));
  });

  it('finds the worktree under another spelling of its path (/tmp for /private/tmp), as main canonicalises it', async () => {
    const canonical = '/private/tmp/maws-e2e/repo/.claude/worktrees/accept-one';
    withMain({
      'git.worktree.list': () => ({ ...listed, worktrees: [{ ...listed.worktrees[0]!, path: canonical }] }),
      'git.worktree.status': () => worktreeStatus({ path: canonical }),
      'git.worktree.branch': () => branchStatus({ checkedOutAt: canonical }),
      'git.worktree.remove': () => ({ removed: true, prunedOnly: false }),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'cleanup', target: { repoRoot: REPO, path: '/tmp/maws-e2e/repo/.claude/worktrees/accept-one', branch: 'worktree-accept-one' } }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/· clean/);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Remove checkout' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(fake.invoked('git.worktree.remove')).toEqual([{ repoRoot: REPO, path: canonical, expect: { branch: 'worktree-accept-one', head: HEAD }, discard: false }]));
  });

  it('says so when a checked Delete branch cannot run because the branch was not there when the dialog opened', async () => {
    let branchReads = 0;
    withMain({
      'git.worktree.list': () => ({ ...listed, worktrees: [] }),
      'git.worktree.status': () => null,
      'git.worktree.branch': () => (++branchReads === 1 ? null : branchStatus({ checkedOutAt: null })),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'cleanup', target: { repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/· detached/);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Delete branch' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete branch' }));
    expect(await within(dialog).findByText(/Delete branch not run: the branch appeared after this dialog opened; close and reopen it/)).toBeTruthy();
    expect(fake.invoked('git.worktree.deleteBranch')).toEqual([]);
  });

  it('shows all four ladder steps, Discard disabled with its reason on a clean tree', async () => {
    withMain({ 'git.worktree.list': () => listed, 'git.worktree.status': () => worktreeStatus(), 'git.worktree.branch': () => branchStatus() });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'cleanup', target: { repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/· clean/);
    const discard = within(dialog).getByRole('checkbox', { name: 'Discard changes and remove' });
    expect(discard.hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByText('Nothing to discard')).toBeTruthy();
    expect(within(dialog).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['Archive sessions', 'Remove checkout', 'Discard changes and remove', 'Delete branch']);
  });

  it('targets a managed worktree at its repository root, which survives the checkout', () => {
    expect(cleanupTargetOf(record(IDLE1, { directory: WT, worktree: { path: WT, branch: 'worktree-accept-one' } }))).toEqual({ repoRoot: REPO, path: WT, branch: 'worktree-accept-one' });
    expect(cleanupTargetOf(record(IDLE1, { directory: '/elsewhere/hand', worktree: { path: '/elsewhere/hand', branch: 'hand/made' } }))).toEqual({ repoRoot: '/elsewhere/hand', path: '/elsewhere/hand', branch: 'hand/made' });
    expect(cleanupTargetOf(record(IDLE1, { worktree: null }))).toBeNull();
  });

  it('names exactly what is checked', () => {
    expect(confirmLabel({ archive: 2, remove: true, discard: false, deleteBranch: true })).toBe('Archive 2, remove and delete branch');
    expect(confirmLabel({ archive: null, remove: false, discard: false, deleteBranch: false })).toBe('Clean up');
  });
});

describe('dialogs', () => {
  it('the fork sheet validates the name as the intent does, and a refusal keeps the sheet with the reason', async () => {
    withMain({
      'git.branches': () => ({ current: 'main', branches: [{ name: 'main', upstream: null, isCurrent: true }] }),
      'session.fork': () => ({ status: 'invalid', appSessionId: IDLE1, field: 'location', message: 'worktree path exists' }),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'fork', appSessionId: IDLE1 }));
    const dialog = await screen.findByRole('dialog', { name: 'Fork to a new worktree' });
    const name = within(dialog).getByRole('textbox', { name: 'Worktree name' });
    expect((name as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z2-7]{4}$/);
    await userEvent.clear(name);
    await userEvent.type(name, '-bad');
    expect(within(dialog).getByText("Worktree name cannot start with '-'")).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Fork' }).hasAttribute('disabled')).toBe(true);
    await userEvent.clear(name);
    await userEvent.type(name, 'accept-fork{Enter}');
    await waitFor(() => expect(fake.invoked('session.fork')).toEqual([
      { appSessionId: IDLE1, target: { kind: 'newWorktree', name: 'accept-fork', branch: { kind: 'new', name: 'worktree-accept-fork', base: 'HEAD' } }, message: null, rewindTo: null },
    ]));
    expect(await within(dialog).findByText('worktree path exists')).toBeTruthy();
  });

  it('rename routes through session.rename and states whose act named the title', async () => {
    withMain({ 'session.rename': () => ({ record: record(IDLE1), via: 'override' }) });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'rename', appSessionId: IDLE1 }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename' });
    expect(within(dialog).getByText('Named by you, in MAWS or the terminal')).toBeTruthy();
    const field = within(dialog).getByRole('textbox', { name: 'Title' });
    await userEvent.clear(field);
    await userEvent.type(field, 'C10 override{Enter}');
    await waitFor(() => expect(fake.invoked('session.rename')).toEqual([{ appSessionId: IDLE1, title: 'C10 override' }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('delete names what moves and needs its acknowledgement before Enter acts; a partial delete is said with its next step', async () => {
    withMain({
      'session.deletions.preview': () => ({ transcript: `${REPO}/x.jsonl`, subagents: 2, recordings: 1, paths: 5 }),
      'session.delete': () => ({ status: 'partial', trashed: ['/a.cast'], failed: { path: '/b.json', error: 'EPERM' } }),
      'session.deletions.list': () => ({ manifests: [{ appSessionId: IDLE1, engineSessionId: null, paths: ['/a.cast', '/b.json'], trashed: ['/a.cast'], createdAt: '2026-09-29T10:00:00.000Z' }] }),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'delete', appSessionId: IDLE1 }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete “Idle one”?' });
    expect(await within(dialog).findByText(/Removes the transcript, its 2 subagent transcripts and 1 recording from ~\/.claude to the Trash/)).toBeTruthy();
    const button = within(dialog).getByRole('button', { name: 'Delete' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Move the transcript to the Trash' }));
    await userEvent.click(button);
    expect(await within(dialog).findByText(/Moved 1 to the Trash; \/b.json could not be moved \(EPERM\)/)).toBeTruthy();
    expect(fake.invoked('session.delete')).toEqual([{ appSessionId: IDLE1, stopIfLive: false }]);
    await waitFor(() => expect(useSetup.getState().deletions.has(IDLE1)).toBe(true));
  });

  it('a live session is stopped and deleted', async () => {
    withMain({ 'session.deletions.preview': () => ({ transcript: null, subagents: 0, recordings: 0, paths: 0 }), 'session.delete': () => ({ status: 'deleted', trashed: [] }) });
    useLayout.getState().openTab({ kind: 'session', appSessionId: LIVE });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'delete', appSessionId: LIVE }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Move the transcript to the Trash' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop and delete' }));
    await waitFor(() => expect(fake.invoked('session.delete')).toEqual([{ appSessionId: LIVE, stopIfLive: true }]));
    await waitFor(() => expect(useLayout.getState().main.panes[0].tabs.some((t) => t.kind === 'session' && t.appSessionId === LIVE)).toBe(false));
  });

  it('archive names the background work it would stop, and offers the cleanup when the session was the last of its worktree', async () => {
    withMain({ 'session.archive': () => ({ archived: true }), 'git.worktree.list': () => listed, 'git.worktree.status': () => worktreeStatus(), 'git.worktree.branch': () => branchStatus() });
    useSessions.setState({
      records: new Map([[LIVE, record(LIVE, { title: { text: 'Working here', source: 'user' }, holder: { kind: 'self' }, worktree: { path: WT, branch: 'worktree-accept-one' } })]]),
      engine: new Map([[LIVE, { ...status(LIVE), backgroundTasks: [{ taskId: 't1' as never, taskType: 'shell', description: 'bun test --watch', ambient: false }] }]]),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'archive', appSessionId: LIVE }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive “Working here”?' });
    expect(within(dialog).getByText('1 background task is still running and will be stopped:')).toBeTruthy();
    expect(within(dialog).getByText('bun test --watch')).toBeTruthy();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(fake.invoked('session.archive')).toEqual([{ appSessionId: LIVE }]));
    expect(await screen.findByRole('dialog', { name: 'Clean up worktree accept-one' })).toBeTruthy();
  });

  it('the archived sessions list unarchives through session.update', async () => {
    const P = 'p1' as ProjectId;
    const archived = record(IDLE1, { projectId: P, archived: true, title: { text: 'Old work', source: 'user' } });
    withMain({ 'session.list': () => ({ sessions: [archived], revision: 3 }), 'session.update': () => ({ ...archived, archived: false }) });
    useSessions.setState({ projects: new Map([[P, project('p1', 0, { name: 'maws' })]]) });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'archived', projectId: P }));
    const dialog = await screen.findByRole('dialog', { name: 'Archived sessions · maws' });
    const row = await within(dialog).findByRole('listitem', { name: 'Old work' });
    await userEvent.click(within(row).getByRole('button', { name: 'Unarchive' }));
    expect(fake.invoked('session.update')).toEqual([{ appSessionId: IDLE1, patch: { archived: false } }]);
    expect(fake.invoked('session.list')[0]).toEqual({ includeArchived: true });
  });

  it("an interrupted delete offers 'Finish deleting' and 'Keep' in the session's tab", async () => {
    withMain({ 'session.deletions.keep': () => undefined });
    useSetup.getState().applyDeletions([{ appSessionId: IDLE1, engineSessionId: null, paths: ['/a', '/b', '/c'], trashed: ['/a'], createdAt: '2026-09-29T10:00:00.000Z' }]);
    render(<DeletionNotice appSessionId={IDLE1} />);
    expect(screen.getByText('Deleting this conversation stopped part-way: 1 of 3 files moved to the Trash.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Finish deleting' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(fake.invoked('session.deletions.keep')).toEqual([{ appSessionId: IDLE1 }]);
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
  });
});
