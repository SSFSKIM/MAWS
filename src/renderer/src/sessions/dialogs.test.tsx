import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { WorktreeStatus } from '@shared/sessions/worktree';
import { project, record, remoteRow, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import { REMOTE_UNAVAILABLE, SESSION_ACTS_CAPABILITY } from '@shared/ipc/remote-unavailable';
import { REMOTE_ACT_PENDING_MS } from '@shared/machine/remote-pending';
import type { MachineState } from '@shared/ipc/schema/machines';
import type { OrgKey } from '@shared/machine/org-key';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import type { OrgProjects } from '../stores/registry';
import { REPO, resetSetupStore } from '../test-support/setup-intents';
import { resetShellStores } from '../test-support/shell-stores';
import { closeDialog, openDialog, useDialogs } from './dialogs';
import { Sheet, SheetForm } from './Sheet';
import { cleanupTargetOf, confirmLabel } from './CleanupDialog';
import { SessionDialogs, DeletionNotice } from './SessionDialogs';
import { useSetup } from './store';
import { useMachines } from '../stores/machines';
import { currentSet } from '../stores/layout-model';

const WT = `${REPO}/.claude/worktrees/accept-one`;
const HEAD = 'a'.repeat(40);
const ids = ['a1111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 'a3333333-3333-4333-8333-333333333333', 'a4444444-4444-4444-8444-444444444444'] as AppSessionId[];
// P5 O6 M2: the page holds addresses; the fake `window.maws` (main) is asked and answers with the bare ids
const [BARE_IDLE1, BARE_IDLE2, BARE_LIVE, BARE_TERM] = ids as [AppSessionId, AppSessionId, AppSessionId, AppSessionId];
const [IDLE1, IDLE2, LIVE, TERM] = [BARE_IDLE1, BARE_IDLE2, BARE_LIVE, BARE_TERM].map(at) as [AppSessionId, AppSessionId, AppSessionId, AppSessionId];

let fake: FakeClient;
function withMain(auto: NonNullable<Parameters<typeof fakeClient>[0]>) {
  fake = fakeClient(Object.fromEntries(Object.entries(auto).filter(([, answer]) => answer !== undefined)));
  window.maws = fake.client as unknown as PreloadBridge;
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
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('cleanup dialog archives idle only', () => {
  it('counts the idle sessions, names every live one as skipped, archives only the idle ones, and names a skipped_live answer', async () => {
    const busy = worktreeStatus({ state: 'busy', occupancy: { self: 1, foreign: 1, unbound: 0, idle: 2, archived: 0, idleAppSessionIds: [BARE_IDLE1, BARE_IDLE2], liveAppSessionIds: [BARE_LIVE, BARE_TERM] } });
    withMain({
      'git.worktree.list': () => listed,
      'git.worktree.status': () => busy,
      'git.worktree.branch': () => branchStatus(),
      'session.archive': ({ appSessionId }: { appSessionId: AppSessionId }) => (appSessionId === BARE_IDLE2 ? { status: 'skipped_live', holder: { kind: 'terminal', pid: 5151 } } : { archived: true }),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'cleanup', target: { machine: TEST_MACHINE, repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
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
      { appSessionId: BARE_IDLE1, onlyIfIdle: true },
      { appSessionId: BARE_IDLE2, onlyIfIdle: true },
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
    act(() => openDialog({ kind: 'cleanup', target: { machine: TEST_MACHINE, repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
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
    act(() => openDialog({ kind: 'cleanup', target: { machine: TEST_MACHINE, repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/dirty · 1 change/);
    expect(within(dialog).getByText('dirty: 1 change')).toBeTruthy(); // the remove step's guard
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Discard changes and remove' }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Delete branch' }));
    const confirmButton = within(dialog).getByRole('button', { name: 'Discard and remove and delete branch' });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByText('1 commit not on main is lost.')).toBeTruthy();
    const discardAck = within(dialog).getByRole('checkbox', { name: 'Discard 1 uncommitted change; this cannot be undone' });
    const unmergedAck = within(dialog).getByRole('checkbox', { name: 'Delete 1 commit not on main; this cannot be undone' });
    // named by their own attribute, as the steps are, not only by the label around them
    expect([discardAck, unmergedAck].map((c) => c.getAttribute('aria-label'))).toEqual(['Discard 1 uncommitted change; this cannot be undone', 'Delete 1 commit not on main; this cannot be undone']);
    await userEvent.click(discardAck);
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
    await userEvent.click(unmergedAck);
    await userEvent.click(confirmButton);
    expect(await within(dialog).findByText(`Remove refused · changed: head moved to ${'b'.repeat(40)}`)).toBeTruthy();
    expect(fake.invoked('git.worktree.remove')).toEqual([{ repoRoot: REPO, path: WT, expect: { branch: 'worktree-accept-one', head: HEAD }, discard: true }]);
    expect(fake.invoked('git.worktree.deleteBranch')).toEqual([]);
  });

  it('says the unmerged commits a branch delete loses in the right number', async () => {
    withMain({
      'git.worktree.list': () => listed,
      'git.worktree.status': () => worktreeStatus(),
      'git.worktree.branch': () => branchStatus({ ahead: 2, merged: false }),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'cleanup', target: { machine: TEST_MACHINE, repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('2 commits not on main are lost.')).toBeTruthy();
  });

  it('reopened after the checkout was removed, it still reaches the leftover branch (detached) from the record’s branch', async () => {
    withMain({
      'git.worktree.list': () => ({ ...listed, worktrees: [] }),
      'git.worktree.status': () => null,
      'git.worktree.branch': () => branchStatus({ checkedOutAt: null }),
      'git.worktree.deleteBranch': () => ({ deleted: true, wasMerged: true }),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'cleanup', target: { machine: TEST_MACHINE, repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
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
    act(() => openDialog({ kind: 'cleanup', target: { machine: TEST_MACHINE, repoRoot: REPO, path: '/tmp/maws-e2e/repo/.claude/worktrees/accept-one', branch: 'worktree-accept-one' } }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/· clean/);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Remove checkout' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(fake.invoked('git.worktree.remove')).toEqual([{ repoRoot: REPO, path: canonical, expect: { branch: 'worktree-accept-one', head: HEAD }, discard: false }]));
  });

  it('says so when a checked Delete branch cannot run because the branch was not read when the dialog opened', async () => {
    let branchReads = 0;
    withMain({
      'git.worktree.list': () => ({ ...listed, worktrees: [] }),
      'git.worktree.status': () => null,
      'git.worktree.branch': () => (++branchReads === 1 ? null : branchStatus({ checkedOutAt: null })),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'cleanup', target: { machine: TEST_MACHINE, repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/· detached/);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Delete branch' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete branch' }));
    expect(await within(dialog).findByText(/Delete branch not run: the branch was not read when this dialog opened; close and reopen it/)).toBeTruthy();
    expect(fake.invoked('git.worktree.deleteBranch')).toEqual([]);
  });

  it('shows all four ladder steps, Discard disabled with its reason on a clean tree', async () => {
    withMain({ 'git.worktree.list': () => listed, 'git.worktree.status': () => worktreeStatus(), 'git.worktree.branch': () => branchStatus() });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'cleanup', target: { machine: TEST_MACHINE, repoRoot: REPO, path: WT, branch: 'worktree-accept-one' } }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/· clean/);
    const discard = within(dialog).getByRole('checkbox', { name: 'Discard changes and remove' });
    expect(discard.hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByText('Nothing to discard')).toBeTruthy();
    expect(within(dialog).getAllByRole('checkbox').map((c) => c.getAttribute('aria-label'))).toEqual(['Archive sessions', 'Remove checkout', 'Discard changes and remove', 'Delete branch']);
  });

  it('targets a managed worktree at its repository root, which survives the checkout', () => {
    expect(cleanupTargetOf(record(IDLE1, { directory: WT, worktree: { path: WT, branch: 'worktree-accept-one' } }))).toEqual({ machine: TEST_MACHINE, repoRoot: REPO, path: WT, branch: 'worktree-accept-one' });
    expect(cleanupTargetOf(record(IDLE1, { directory: '/elsewhere/hand', worktree: { path: '/elsewhere/hand', branch: 'hand/made' } }))).toEqual({ machine: TEST_MACHINE, repoRoot: '/elsewhere/hand', path: '/elsewhere/hand', branch: 'hand/made' });
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
      'session.fork': () => ({ status: 'invalid', appSessionId: BARE_IDLE1, field: 'location', message: 'worktree path exists' }),
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
      { appSessionId: BARE_IDLE1, target: { kind: 'newWorktree', name: 'accept-fork', branch: { kind: 'new', name: 'worktree-accept-fork', base: 'HEAD' } }, message: null, rewindTo: null },
    ]));
    expect(await within(dialog).findByText('worktree path exists')).toBeTruthy();
    // the branch radios paint with the accent token, not the system accent colour
    for (const radio of [within(dialog).getByRole('radio', { name: 'New' }), within(dialog).getByRole('radio', { name: 'Existing' })]) expect(radio.classList.contains('accent-accent')).toBe(true);
  });

  it('rename routes through session.rename and states whose act named the title', async () => {
    withMain({ 'session.rename': () => ({ record: record(BARE_IDLE1), via: 'override' }) });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'rename', appSessionId: IDLE1 }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename' });
    expect(within(dialog).getByText('Named by you, in MAWS or the terminal')).toBeTruthy();
    const field = within(dialog).getByRole('textbox', { name: 'Title' });
    await userEvent.clear(field);
    await userEvent.type(field, 'C10 override{Enter}');
    await waitFor(() => expect(fake.invoked('session.rename')).toEqual([{ appSessionId: BARE_IDLE1, title: 'C10 override' }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('delete names what moves and needs its acknowledgement before Enter acts; a partial delete is said with its next step', async () => {
    withMain({
      'session.deletions.preview': () => ({ transcript: `${REPO}/x.jsonl`, subagents: 2, recordings: 1, paths: 5, store: '/private/tmp/scratch/config' }),
      'session.delete': () => ({ status: 'partial', trashed: ['/a.cast'], failed: { path: '/b.json', error: 'EPERM' } }),
      'session.deletions.list': () => ({ manifests: [{ appSessionId: BARE_IDLE1, engineSessionId: null, paths: ['/a.cast', '/b.json'], trashed: ['/a.cast'], createdAt: '2026-09-29T10:00:00.000Z' }] }),
    });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'delete', appSessionId: IDLE1 }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete “Idle one”?' });
    expect(await within(dialog).findByText(/Removes the transcript, its 2 subagent transcripts and 1 recording from \/private\/tmp\/scratch\/config to the Trash/)).toBeTruthy();
    expect(within(dialog).getByRole('checkbox', { name: 'Move the transcript to the Trash' }).getAttribute('aria-label')).toBe('Move the transcript to the Trash');
    const button = within(dialog).getByRole('button', { name: 'Delete' });
    expect(button.hasAttribute('disabled')).toBe(true);
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Move the transcript to the Trash' }));
    await userEvent.click(button);
    expect(await within(dialog).findByText(/Moved 1 to the Trash; \/b.json could not be moved \(EPERM\)/)).toBeTruthy();
    expect(fake.invoked('session.delete')).toEqual([{ appSessionId: BARE_IDLE1, stopIfLive: false }]);
    await waitFor(() => expect(useSetup.getState().deletions.has(IDLE1)).toBe(true));
  });

  it('a live session is stopped and deleted', async () => {
    withMain({ 'session.deletions.preview': () => ({ transcript: null, subagents: 0, recordings: 0, paths: 0, store: '~/.claude' }), 'session.delete': () => ({ status: 'deleted', trashed: [] }) });
    useLayout.getState().openTab({ kind: 'session', appSessionId: LIVE });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'delete', appSessionId: LIVE }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Move the transcript to the Trash' }));
    expect(await within(dialog).findByText(/^Removes what is left of the conversation from ~\/.claude to the Trash/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop and delete' }));
    await waitFor(() => expect(fake.invoked('session.delete')).toEqual([{ appSessionId: BARE_LIVE, stopIfLive: true }]));
    await waitFor(() => expect(currentSet(useLayout.getState().main).panes[0].tabs.some((t) => t.kind === 'session' && t.appSessionId === LIVE)).toBe(false));
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
    // the config home is the engine's (CLAUDE_CONFIG_DIR may move it), so the copy names none
    expect(dialog.textContent).toContain('The transcript stays where Claude Code keeps it; resume it from Archived sessions or with claude --resume in the terminal.');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(fake.invoked('session.archive')).toEqual([{ appSessionId: BARE_LIVE }]));
    expect(await screen.findByRole('dialog', { name: 'Clean up worktree accept-one' })).toBeTruthy();
  });

  it('the archived sessions list unarchives through session.update', async () => {
    const P = at('p1' as ProjectId);
    const archived = record(BARE_IDLE1, { projectId: 'p1' as ProjectId, archived: true, title: { text: 'Old work', source: 'user' } }); // as main answers it
    withMain({ 'session.list': () => ({ sessions: [archived], revision: 3 }), 'session.update': () => ({ ...archived, archived: false }) });
    useSessions.setState({ projects: new Map([[P, project(P, 0, { name: 'maws' })]]) });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'archived', projectId: P }));
    const dialog = await screen.findByRole('dialog', { name: 'Archived sessions · maws' });
    const row = await within(dialog).findByRole('listitem', { name: 'Old work' });
    await userEvent.click(within(row).getByRole('button', { name: 'Unarchive' }));
    expect(fake.invoked('session.update')).toEqual([{ appSessionId: BARE_IDLE1, patch: { archived: false } }]);
    expect(fake.invoked('session.list')[0]).toEqual({ includeArchived: true });
  });

  // P5 O6 M5: a row's archived sessions are the row's, read from each machine its projects are on
  it('an org project’s archived sessions come from every checkout it groups, each read on its machine', async () => {
    const org = { key: 'repo:maws' as OrgKey, name: 'MAWS', source: 'remote' as const, smnsId: null };
    const here = project(at('p1'), 0, { name: 'maws', org });
    const there = project(addressOf(OTHER_MACHINE, 'p2'), 1, { name: 'maws-b', org: { ...org, name: 'maws-b' } });
    const lists: Record<string, unknown[]> = {
      [TEST_MACHINE]: [
        record(BARE_IDLE1, { projectId: 'p1' as ProjectId, archived: true, title: { text: 'Here', source: 'user' }, updatedAt: '2026-10-01T10:00:00.000Z' }),
        record(BARE_IDLE2, { projectId: null, archived: true, title: { text: 'Loose', source: 'user' } }),
      ],
      [OTHER_MACHINE]: [record(BARE_TERM, { projectId: 'p2' as ProjectId, archived: true, title: { text: 'There', source: 'user' }, updatedAt: '2026-10-02T10:00:00.000Z' })],
    };
    withMain({ 'session.list': (_: unknown, machine: string | undefined) => ({ sessions: lists[machine ?? TEST_MACHINE], revision: 1 }) });
    useSessions.setState({ projects: new Map([here, there].map((p) => [p.id, p])) });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'archived', projectId: here.id }));
    const dialog = await screen.findByRole('dialog', { name: 'Archived sessions · MAWS' });
    await waitFor(() => expect(within(dialog).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['There', 'Here']));
    expect([...fake.machines('session.list')].sort()).toEqual([OTHER_MACHINE, TEST_MACHINE].sort());
  });

  it('a machine’s archived sessions include those in a folder nobody opened there', async () => {
    const tmp = project(addressOf(OTHER_MACHINE, 'tmp'), 0, { discovered: true, org: { key: `folder:${OTHER_MACHINE}:tmp` as OrgKey, name: 'tmp', source: 'folder', smnsId: null } });
    const sessions = [
      record(BARE_IDLE1, { projectId: 'tmp' as ProjectId, archived: true, title: { text: 'In tmp', source: 'user' }, updatedAt: '2026-10-01T10:00:00.000Z' }),
      record(BARE_IDLE2, { projectId: null, archived: true, title: { text: 'Loose', source: 'user' }, updatedAt: '2026-10-02T10:00:00.000Z' }),
    ];
    withMain({ 'session.list': () => ({ sessions, revision: 1 }) });
    useSessions.setState({ projects: new Map([[tmp.id, tmp]]) });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'archived', projectId: null, machine: OTHER_MACHINE }));
    const dialog = await screen.findByRole('dialog', { name: `Archived sessions · ${OTHER_MACHINE}` });
    await waitFor(() => expect(within(dialog).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['Loose', 'In tmp']));
    expect(fake.machines('session.list')).toEqual([OTHER_MACHINE]);
  });

  // P5 O7 M8 ("The offer audit and its contract"): deleting is declared not offered on another machine its sessions reach
  // over RL2 (REMOTE_UNAVAILABLE), so Delete… stays greyed with those words. The UX wave, U9 (S-02, A9): Unarchive is
  // offered there now, for a machine whose build lists `rl2.session-acts`, and returns the session to this sidebar at once
  describe('of a machine reached over RL2', () => {
    const tmp = project(addressOf(OTHER_MACHINE, 'tmp'), 0, { discovered: true, org: { key: `folder:${OTHER_MACHINE}:tmp` as OrgKey, name: 'tmp', source: 'folder', smnsId: null } });
    const THERE = addressOf(OTHER_MACHINE, BARE_IDLE1);
    const studio = (over: Partial<MachineState>) =>
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: new Date().toISOString(), generation: 1, carrier: 'relay', ...over }]);
    beforeEach(() => useSessions.setState({ projects: new Map([[tmp.id, tmp]]), listedMachines: new Set([OTHER_MACHINE]) }));
    afterEach(() => {
      useSessions.setState({ listedMachines: new Set(), listed: new Map() });
      useMachines.setState({ roster: 'unread', machines: new Map() });
    });
    const archivedOn = async () => {
      render(<SessionDialogs />);
      act(() => openDialog({ kind: 'archived', projectId: null, machine: OTHER_MACHINE }));
      return screen.findByRole('dialog', { name: 'Archived sessions · Studio' });
    };

    it('lists its archived sessions, Unarchive enabled and Delete… greyed with the declared words; Unarchive returns the session at once', async () => {
      studio({ capabilities: [SESSION_ACTS_CAPABILITY], owner: true });
      const archived = record(BARE_IDLE1, { projectId: 'tmp' as ProjectId, archived: true, title: { text: 'In tmp', source: 'user' } });
      withMain({ 'session.list': () => ({ sessions: [archived], revision: 1 }), 'session.update': () => ({ ...archived, archived: false }) });
      act(() => useSessions.getState().applyChanged({ record: { ...archived, appId: THERE }, cause: 'live', revision: 2 }, OTHER_MACHINE));
      const row = await within(await archivedOn()).findByRole('listitem', { name: 'In tmp' });
      const unarchive = within(row).getByRole('button', { name: 'Unarchive' });
      expect(unarchive).toHaveProperty('disabled', false);
      const del = within(row).getByRole('button', { name: 'Delete…' });
      expect(del).toHaveProperty('disabled', true);
      expect(del.title).toBe(REMOTE_UNAVAILABLE['session.delete']);
      expect(within(row).queryByRole('button', { name: 'Remove worktree…' })).toBeNull();
      await userEvent.click(unarchive);
      await waitFor(() => expect(fake.invoked('session.update')).toEqual([{ appSessionId: BARE_IDLE1, patch: { archived: false } }]));
      expect(fake.machines('session.update')).toEqual([OTHER_MACHINE]);
      await waitFor(() => expect(useSessions.getState().records.get(THERE)?.archived).toBe(false));
    });

    it('asks nothing of a machine whose build doesn’t list the capability, and says so as that machine’s line (A14)', async () => {
      studio({ capabilities: ['rl2.project-acts'], owner: true });
      withMain({ 'session.list': () => ({ sessions: [], revision: 1 }) });
      const dialog = await archivedOn();
      expect(await within(dialog).findByText('Can’t list archived sessions on Studio yet. Update MAWS on Studio and try again.')).toBeTruthy();
      expect(within(dialog).queryByText('Loading…')).toBeNull();
      expect(fake.invoked('session.list')).toEqual([]);
    });

    // The UX wave, U9 (the architect's ruling (A), 2026-11-13): the footer's "Archived sessions…" reaches every machine's
    // own row, since a machine's row leaves the sidebar with its last listed session and its menu with it
    it('the footer’s sheet lists another machine’s archived session under its name, after this Mac’s, and Unarchive acts there', async () => {
      studio({ capabilities: [SESSION_ACTS_CAPABILITY], owner: true });
      const mine = record(BARE_IDLE2, { projectId: null, archived: true, title: { text: 'Archived here', source: 'user' } });
      const theirs = record(BARE_IDLE1, { projectId: null, archived: true, title: { text: 'Archived on Studio', source: 'user' } });
      withMain({ 'session.list': (_: unknown, machine: string | undefined) => ({ sessions: machine === OTHER_MACHINE ? [theirs] : [mine], revision: 1 }), 'session.update': () => ({ ...theirs, archived: false }) });
      render(<SessionDialogs />);
      act(() => openDialog({ kind: 'archived', projectId: null }));
      const dialog = await screen.findByRole('dialog', { name: 'Archived sessions' });
      const there = await within(dialog).findByRole('region', { name: 'Studio' });
      const row = await within(there).findByRole('listitem', { name: 'Archived on Studio' });
      const here = within(dialog).getByRole('region', { name: 'This Mac' });
      await within(here).findByRole('listitem', { name: 'Archived here' });
      expect(within(dialog).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['This Mac', 'Studio']);
      await userEvent.click(within(row).getByRole('button', { name: 'Unarchive' }));
      await waitFor(() => expect(fake.machines('session.update')).toEqual([OTHER_MACHINE]));
    });

    it('the footer’s sheet holds no machine for another: each section its rows, its line or its loading, none for a machine with nothing archived', async () => {
      const LOFT = 'LoftMachineRef00000000' as MachineRef;
      useMachines.getState().applyRoster([
        { ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: new Date().toISOString(), generation: 1, carrier: 'relay', capabilities: [SESSION_ACTS_CAPABILITY], owner: true },
        { ref: LOFT, name: 'Loft', local: false, state: 'up', since: new Date().toISOString(), generation: 1, carrier: 'relay', capabilities: ['rl2.project-acts'], owner: true },
      ]);
      useSessions.setState({ listedMachines: new Set([OTHER_MACHINE, LOFT]) });
      withMain({});
      render(<SessionDialogs />);
      act(() => openDialog({ kind: 'archived', projectId: null }));
      const dialog = await screen.findByRole('dialog', { name: 'Archived sessions' });
      await waitFor(() => expect(fake.pending('session.list')).toBe(2)); // this Mac and Studio; Loft is not asked
      const order = fake.machines('session.list');
      await act(() => fake.reply('session.list', { sessions: [], revision: 1 }, order.findIndex((machine) => machine !== OTHER_MACHINE))); // this Mac's
      const here = within(dialog).getByRole('region', { name: 'This Mac' });
      expect(await within(here).findByText('No archived sessions.')).toBeTruthy();
      expect(within(within(dialog).getByRole('region', { name: 'Studio' })).getByText('Loading…')).toBeTruthy();
      expect(within(within(dialog).getByRole('region', { name: 'Loft' })).getByText('Can’t list archived sessions on Loft yet. Update MAWS on Loft and try again.')).toBeTruthy();
      await act(() => fake.reply('session.list', { sessions: [], revision: 1 }));
      await waitFor(() => expect(within(dialog).queryByRole('region', { name: 'Studio' })).toBeNull());
    });

    it('asks nothing of a machine that is offline or connecting, and says which as its line', async () => {
      studio({ state: 'down', generation: 0 });
      withMain({ 'session.list': () => ({ sessions: [], revision: 1 }) });
      expect(await within(await archivedOn()).findByText('List archived sessions is unavailable while Studio is offline.')).toBeTruthy();
      act(() => studio({ state: 'connecting', generation: 0 }));
      expect(await screen.findByText('Connecting to Studio…')).toBeTruthy();
      expect(fake.invoked('session.list')).toEqual([]);
    });
  });

  // The UX wave, U9 (S-02, A9, A10): Rename… and Archive work from a listing alone. The sheets take the title and the
  // machine from the listing and skip what needs a record; what this window did shows in the sidebar at once.
  describe('of a session on another machine with only its listing here', () => {
    const THERE = addressOf(OTHER_MACHINE, BARE_IDLE1);
    beforeEach(() => {
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: new Date().toISOString(), generation: 1, carrier: 'relay', capabilities: [SESSION_ACTS_CAPABILITY], owner: true }]);
      useSessions.setState({ listed: new Map([[THERE, { ...remoteRow(OTHER_MACHINE, BARE_IDLE1, { title: 'Listed over there', revision: 3 }), appId: THERE }]]), listedMachines: new Set([OTHER_MACHINE]) });
      useSessions.getState().applyRows({ machines: [OTHER_MACHINE], rows: [remoteRow(OTHER_MACHINE, BARE_IDLE1, { title: 'Listed over there', revision: 3 })], complete: true, pending: [], members: [], member: 'member-1' });
    });
    afterEach(() => {
      useSessions.getState().applyRows({ machines: [], rows: [], complete: true, pending: [], members: [], member: null });
      useMachines.setState({ roster: 'unread', machines: new Map() });
    });

    it('renames it from the listing’s title, on its machine, and the listing says the new title at once', async () => {
      withMain({ 'session.rename': () => ({ record: record(BARE_IDLE1, { title: { text: 'Renamed from here', source: 'user' } }), via: 'override' }) });
      render(<SessionDialogs />);
      act(() => openDialog({ kind: 'rename', appSessionId: THERE }));
      const dialog = await screen.findByRole('dialog', { name: 'Rename' });
      const field = within(dialog).getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
      expect(field.value).toBe('Listed over there');
      expect(within(dialog).queryByRole('button', { name: 'Regenerate' })).toBeNull();
      await userEvent.clear(field);
      await userEvent.type(field, 'Renamed from here{Enter}');
      await waitFor(() => expect(fake.invoked('session.rename')).toEqual([{ appSessionId: BARE_IDLE1, title: 'Renamed from here' }]));
      expect(fake.machines('session.rename')).toEqual([OTHER_MACHINE]);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(useSessions.getState().listed.get(THERE)?.title).toBe('Renamed from here');
    });

    it('archives it from the listing, its sheet naming the machine, closes its tab, and the listing leaves at once', async () => {
      withMain({ 'session.archive': () => ({ archived: true }) });
      useLayout.getState().openTab({ kind: 'session', appSessionId: THERE });
      render(<SessionDialogs />);
      act(() => openDialog({ kind: 'archive', appSessionId: THERE }));
      const dialog = await screen.findByRole('dialog', { name: 'Archive “Listed over there”?' });
      expect(dialog.textContent).toContain('Ends its engine process on Studio and hides it.');
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(fake.invoked('session.archive')).toEqual([{ appSessionId: BARE_IDLE1 }]));
      expect(fake.machines('session.archive')).toEqual([OTHER_MACHINE]);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(useSessions.getState().listed.has(THERE)).toBe(false);
      expect(currentSet(useLayout.getState().main).panes[0].tabs.some((t) => t.kind === 'session' && t.appSessionId === THERE)).toBe(false);
    });

    it('says a refusal main worded, and keeps the listing', async () => {
      withMain({});
      render(<SessionDialogs />);
      act(() => openDialog({ kind: 'archive', appSessionId: THERE }));
      const dialog = await screen.findByRole('dialog', { name: 'Archive “Listed over there”?' });
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(fake.pending('session.archive')).toBe(1));
      await act(() => fake.fail('session.archive', 'Not archived: only the session’s owners can', 'internal', { refusal: 'grade' }));
      expect(await within(dialog).findByText('Not archived: only the session’s owners can')).toBeTruthy();
      expect(useSessions.getState().listed.has(THERE)).toBe(true);
    });

    it('words a typed refusal the machine answered as the act not done', async () => {
      withMain({ 'session.archive': () => ({ status: 'held', holder: { kind: 'terminal', pid: 4 } }) });
      render(<SessionDialogs />);
      act(() => openDialog({ kind: 'archive', appSessionId: THERE }));
      const dialog = await screen.findByRole('dialog', { name: 'Archive “Listed over there”?' });
      await userEvent.keyboard('{Enter}');
      expect(await within(dialog).findByText('Not archived: held by terminal · 4; archive it where it runs')).toBeTruthy();
      expect(useSessions.getState().listed.has(THERE)).toBe(true);
    });

    // Review (M4): a sheet opened while the machine is up reads the helper, so a link that goes reconnecting or offline
    // while it is open greys its submit with the helper's sentence, and Enter sends nothing
    const studioDown = (since: number) =>
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'down', since: new Date(since).toISOString(), generation: 1, carrier: 'relay', capabilities: [SESSION_ACTS_CAPABILITY], owner: true }]);
    const studioUp = () =>
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: new Date().toISOString(), generation: 2, carrier: 'relay', capabilities: [SESSION_ACTS_CAPABILITY], owner: true }]);

    it('greys Rename once the link goes reconnecting, then offline, after the sheet opened, and sends nothing', async () => {
      withMain({ 'session.rename': () => ({ record: record(BARE_IDLE1, { title: { text: 'Renamed from here', source: 'user' } }), via: 'override' }) });
      render(<SessionDialogs />);
      act(() => openDialog({ kind: 'rename', appSessionId: THERE }));
      const dialog = await screen.findByRole('dialog', { name: 'Rename' });
      const field = within(dialog).getByRole('textbox', { name: 'Title' });
      await userEvent.clear(field);
      await userEvent.type(field, 'Renamed from here');
      const submit = within(dialog).getByRole('button', { name: 'Rename' });
      expect(submit).toHaveProperty('disabled', false);
      act(() => studioDown(Date.now()));
      expect(await within(dialog).findByText('Reconnecting to Studio…')).toBeTruthy();
      expect(submit).toHaveProperty('disabled', true);
      act(() => studioDown(Date.now() - REMOTE_ACT_PENDING_MS - 1_000));
      expect(await within(dialog).findByText('Rename is unavailable while Studio is offline.')).toBeTruthy();
      await userEvent.type(field, '{Enter}');
      expect(fake.invoked('session.rename')).toEqual([]);
      act(() => studioUp());
      await waitFor(() => expect(submit).toHaveProperty('disabled', false));
      expect(within(dialog).queryByText('Rename is unavailable while Studio is offline.')).toBeNull();
    });

    it('greys Archive once the link goes offline after the sheet opened, and sends nothing', async () => {
      withMain({ 'session.archive': () => ({ archived: true }) });
      render(<SessionDialogs />);
      act(() => openDialog({ kind: 'archive', appSessionId: THERE }));
      const dialog = await screen.findByRole('dialog', { name: 'Archive “Listed over there”?' });
      const submit = within(dialog).getByRole('button', { name: 'Archive' });
      expect(submit).toHaveProperty('disabled', false);
      act(() => studioDown(Date.now() - REMOTE_ACT_PENDING_MS - 1_000));
      expect(await within(dialog).findByText('Archive is unavailable while Studio is offline.')).toBeTruthy();
      expect(submit).toHaveProperty('disabled', true);
      await userEvent.keyboard('{Enter}');
      expect(fake.invoked('session.archive')).toEqual([]);
      act(() => studioDown(Date.now()));
      expect(await within(dialog).findByText('Reconnecting to Studio…')).toBeTruthy();
      expect(submit).toHaveProperty('disabled', true);
    });
  });

  // ticket 644: a row's archived sessions are the ones the sidebar files under it: another machine's record by its listing,
  // though the registry places its project on that machine
  describe('another machine’s archived session at a listed address, its project a registry location there', () => {
    const ID = '11111111-2222-4333-8444-555555555555';
    const KEY = 'remote:example.org/app' as OrgKey;
    const registry: OrgProjects = {
      projects: [{ id: ID, name: 'app', hub: true, renamable: true, locations: [{ machine: OTHER_MACHINE, pid: 'app', path: '/srv/app', key: KEY, name: 'app', source: 'remote', acts: true }] }],
      keys: { [ID]: KEY }, moved: {}, removals: [], seen: {},
    };
    const b = addressOf(OTHER_MACHINE, BARE_IDLE1);
    const stage = (orgKey: OrgKey | null) => {
      withMain({
        'session.list': (_: unknown, machine: string | undefined) => ({ sessions: machine === OTHER_MACHINE ? [record(BARE_IDLE1, { projectId: 'app' as ProjectId, archived: true, title: { text: 'Archived on B', source: 'user' } })] : [], revision: 1 }),
        'session.update': () => record(BARE_IDLE1, { projectId: 'app' as ProjectId, archived: false }),
      });
      useSessions.getState().applyRegistry(registry, TEST_MACHINE);
      useSessions.setState({ listed: new Map([[b, { ...remoteRow(OTHER_MACHINE, BARE_IDLE1, { orgKey, project: orgKey === null ? null : ID }), appId: b }]]) });
      render(<SessionDialogs />);
    };
    const shown = (dialog: HTMLElement) => within(dialog).queryAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
    // archived from this window: its listing leaves at the act (`noteArchived`) and at the hub's withdrawal (main's rows)
    const archivedHereAndWithdrawn = () => {
      act(() => useSessions.getState().noteArchived(b));
      act(() => useSessions.getState().applyRows({ machines: [], rows: [], complete: true, pending: [], members: [], member: null }));
      expect(useSessions.getState().listed.has(b), 'no listing names it').toBe(false);
    };
    afterEach(() => useMachines.setState({ roster: 'unread', machines: new Map() }));

    it('lists it under its machine’s row when its listing’s key is none of the key table’s', async () => {
      stage(null);
      act(() => openDialog({ kind: 'archived', projectId: null, machine: OTHER_MACHINE }));
      const dialog = await screen.findByRole('dialog', { name: `Archived sessions · ${OTHER_MACHINE}` });
      await waitFor(() => expect(within(dialog).queryByText('Loading…')).toBeNull());
      expect(shown(dialog)).toEqual(['Archived on B']);
    });

    // the UX wave, U9: a session this window archived stays under the row it sat under before the archive, whatever the
    // order of the hub's withdrawal and the registry's arrival, in the row's sheet and in the footer's
    it('lists it under its machine’s row once this window archived it and its listing left, and Unarchive acts there', async () => {
      stage(null);
      archivedHereAndWithdrawn();
      act(() => openDialog({ kind: 'archived', projectId: null, machine: OTHER_MACHINE }));
      const dialog = await screen.findByRole('dialog', { name: `Archived sessions · ${OTHER_MACHINE}` });
      await waitFor(() => expect(within(dialog).queryByText('Loading…')).toBeNull());
      expect(shown(dialog)).toEqual(['Archived on B']);
      await userEvent.click(within(within(dialog).getByRole('listitem', { name: 'Archived on B' })).getByRole('button', { name: 'Unarchive' }));
      await waitFor(() => expect(fake.machines('session.update')).toEqual([OTHER_MACHINE]));
    });

    it('lists it in its machine’s section of the footer’s sheet once this window archived it and its listing left, and Unarchive acts there', async () => {
      useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: new Date().toISOString(), generation: 1, carrier: 'relay', capabilities: [SESSION_ACTS_CAPABILITY], owner: true }]);
      stage(null);
      archivedHereAndWithdrawn();
      act(() => openDialog({ kind: 'archived', projectId: null }));
      const dialog = await screen.findByRole('dialog', { name: 'Archived sessions' });
      const there = await within(dialog).findByRole('region', { name: 'Studio' });
      const row = await within(there).findByRole('listitem', { name: 'Archived on B' });
      await userEvent.click(within(row).getByRole('button', { name: 'Unarchive' }));
      await waitFor(() => expect(fake.machines('session.update')).toEqual([OTHER_MACHINE]));
    });

    it('lists it under the registry project’s row when its listing and the registry agree on the key', async () => {
      stage(KEY);
      act(() => openDialog({ kind: 'archived', projectId: addressOf(OTHER_MACHINE, 'app' as ProjectId) }));
      const dialog = await screen.findByRole('dialog', { name: 'Archived sessions · app' });
      await waitFor(() => expect(within(dialog).queryByText('Loading…')).toBeNull());
      expect(shown(dialog)).toEqual(['Archived on B']);
    });
  });

  // W11 (I5): the projects removed from the sidebar, each shown again by adding its directory
  it('the hidden projects list shows a project again through session.projects.add', async () => {
    const hidden = project(at('p2'), 1, { name: 'old-repo', directory: '/Users/someone/work/old-repo', hidden: true });
    withMain({ 'session.projects.add': () => ({ ...hidden, id: 'p2', hidden: undefined }) }); // main answers the bare id
    useSessions.setState({ projects: new Map([[hidden.id, hidden], [at('p1' as ProjectId), project(at('p1'), 0, { name: 'maws' })]]), projectsVersion: useSessions.getState().projectsVersion + 1 });
    render(<SessionDialogs />);
    act(() => openDialog({ kind: 'hiddenProjects' }));
    const dialog = await screen.findByRole('dialog', { name: 'Hidden projects' });
    expect(within(dialog).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))).toEqual(['old-repo']);
    expect(within(dialog).getByText('~/work/old-repo')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Show again' }));
    expect(fake.invoked('session.projects.add')).toEqual([{ directory: '/Users/someone/work/old-repo' }]);
  });

  it("an interrupted delete offers 'Finish deleting' and 'Keep' in the session's tab", async () => {
    withMain({ 'session.deletions.keep': () => undefined });
    useSetup.getState().applyDeletions([{ appSessionId: IDLE1, engineSessionId: null, paths: ['/a', '/b', '/c'], trashed: ['/a'], createdAt: '2026-09-29T10:00:00.000Z' }]);
    render(<DeletionNotice appSessionId={IDLE1} />);
    expect(screen.getByText('Deleting this conversation stopped part-way: 1 of 3 files moved to the Trash.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Finish deleting' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(fake.invoked('session.deletions.keep')).toEqual([{ appSessionId: BARE_IDLE1 }]);
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
  });
});

// Debt wave 4: a sheet whose answer is owed to a caller (C11's gateway sheets) closes through its own callback
describe('the sheet’s close seam', () => {
  it('Cancel and Escape reach `onClose`, leaving C10’s dialog store alone; without it Cancel closes the store’s dialog', async () => {
    const heard: string[] = [];
    act(() => openDialog({ kind: 'rename', appSessionId: IDLE1 }));
    const { unmount } = render(
      <Sheet title="Owed" onClose={() => heard.push('close')} data-probe="owed">
        <SheetForm canSubmit onSubmit={() => heard.push('submit')} submitLabel="Go" submitClass="" cancelLabel="Not now">
          <p>body</p>
        </SheetForm>
      </Sheet>,
    );
    const sheet = screen.getByRole('dialog', { name: 'Owed' });
    expect(sheet.dataset.probe).toBe('owed');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Not now' }));
    await userEvent.keyboard('{Escape}');
    expect(heard).toEqual(['close', 'close']);
    expect(useDialogs.getState().open, 'the store’s dialog is not the owed sheet’s').not.toBeNull();
    unmount();
    render(
      <Sheet title="Plain">
        <SheetForm canSubmit onSubmit={() => {}} submitLabel="Go" submitClass="">
          <p>body</p>
        </SheetForm>
      </Sheet>,
    );
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Plain' })).getByRole('button', { name: 'Cancel' }));
    expect(useDialogs.getState().open).toBeNull();
  });
});
