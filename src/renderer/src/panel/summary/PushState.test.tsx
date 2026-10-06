// The summary's push-state row as E6 grew it (E6 execution document, Design §6, T4.2): the push text opens Source
// control, and a second row says the PR's state from `scm.status` and `scm.pr.state` (shared with the tool's header by
// query key), with Install, Sign in and a manual refresh; the PR state is polled only while there is something to ask.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandName } from '@shared/ipc/schema';
import type { GitStatus } from '@shared/ipc/schema/git';
import type { ScmGhState, ScmPrState, ScmPrStateInput, ScmStatus } from '@shared/ipc/schema/scm';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { queryClient } from '../../ipc/query';
import { A, probeTool, resetPanelStores, TestHost } from '../../test-support/panel';
import { useGit } from '../../stores/git';
import { panelHost, registerPanelTool } from '../host';
import { PushState } from './PushState';

const DIR = '/work/app-a'; // A's directory in the builders' record
const GIT: GitStatus = {
  repoRoot: DIR, gitDir: `${DIR}/.git`, commonDir: `${DIR}/.git`, isWorktree: false, branch: 'feature', head: 'abcdef1234567', upstream: 'origin/feature',
  remoteUrl: 'git@github.com:o/r.git', ahead: 0, behind: 0, dirty: false, stashCount: 0, checkedAt: '2026-10-06T10:00:00.000Z', files: [],
};
const READY: ScmGhState = { state: 'ready', path: '/bin/gh', version: 'gh version 2.97.0' };
const SCM: ScmStatus = {
  directory: DIR, repository: true, trusted: true, trustKey: DIR, remotes: [{ name: 'origin', url: 'https://github.com/o/r.git' }],
  defaultRemote: 'origin', defaultBase: 'main', gh: READY, checkedAt: '2026-10-06T10:00:00.000Z',
};
const check = (bucket: 'pass' | 'pending', name: string) => ({ name, bucket, state: bucket.toUpperCase(), link: null, workflow: null });
const PR: ScmPrState = {
  checkedAt: '2026-10-06T10:00:01.000Z', branch: 'feature', gh: READY, error: null,
  pr: {
    number: 12, url: 'https://github.com/o/r/pull/12', title: 'Panel PR', state: 'OPEN', isDraft: false, reviewDecision: null, baseRefName: 'main', headRefName: 'feature',
    mergeStateStatus: 'CLEAN', checks: { summary: 'pending', items: [check('pass', 'lint'), check('pass', 'unit'), check('pending', 'e2e')] },
  },
};
const PASSED: ScmPrState = { ...PR, checkedAt: '2026-10-06T10:01:00.000Z', pr: { ...PR.pr!, checks: { summary: 'pass', items: [check('pass', 'lint'), check('pass', 'unit'), check('pass', 'e2e')] } } };

let fake: FakeClient;

function bridge(over: Partial<Record<CommandName, unknown>> = {}) {
  fake = fakeClient({
    'git.watch': GIT, 'git.diff': { patch: '', files: [] }, 'git.unwatch': undefined, 'layout.get': { value: null }, 'layout.set': undefined,
    'layout.openExternal': undefined, 'fs.workflows': { runs: [] }, 'scm.status': SCM,
    'scm.pr.state': (input: ScmPrStateInput) => (input.refresh ? PASSED : PR),
    ...over,
  });
  window.maws = fake.client;
  queryClient.clear(); // a case that mounts again starts from main's new answers
}

const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));
const push = () => screen.getByRole('region', { name: 'Push state' });
const prLine = () => within(push()).queryByTestId('pr-line');
// The line answers after main's two reads, however many turns that takes under load.
const lineReads = (text: string) => waitFor(() => expect(prLine()?.textContent).toBe(text));

async function mount() {
  const view = render(<TestHost />);
  for (let i = 0; i < 4; i++) await settle();
  return view;
}

beforeEach(() => {
  resetPanelStores();
  bridge();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('push state row shows PR state, install and sign-in states and opens the tool', () => {
  it('reads the PR, its state and its checks, polling the shared query with refresh off; the number opens the PR', async () => {
    const user = userEvent.setup();
    await mount();
    await lineReads('PR #12 Open · 2 passed, 1 pending');
    expect(fake.invoked('scm.status')).toEqual([{ appSessionId: A }]);
    expect(fake.invoked('scm.pr.state')).toEqual([{ appSessionId: A, refresh: false }]);
    await user.click(within(push()).getByRole('button', { name: 'PR #12' }));
    expect(fake.invoked('layout.openExternal')).toEqual([{ url: 'https://github.com/o/r/pull/12' }]);
  });

  it('Refresh asks gh again, shows its answer and re-reads scm.status', async () => {
    const user = userEvent.setup();
    await mount();
    await lineReads('PR #12 Open · 2 passed, 1 pending');
    const refresh = within(push()).getByRole('button', { name: 'Refresh PR state' });
    expect(refresh.getAttribute('title')).toMatch(/^Checked /);
    await user.click(refresh);
    await lineReads('PR #12 Open · 3 passed');
    expect(fake.invoked('scm.pr.state')).toEqual([{ appSessionId: A, refresh: false }, { appSessionId: A, refresh: true }]);
    await waitFor(() => expect(fake.invoked('scm.status')).toEqual([{ appSessionId: A }, { appSessionId: A }]));
  });

  it('says No PR for the branch, and why the PR state is unavailable', async () => {
    bridge({ 'scm.pr.state': { ...PR, pr: null } });
    let view = await mount();
    await lineReads('No PR for feature');
    view.unmount();
    bridge({ 'scm.pr.state': { ...PR, pr: null, error: 'gh pr view: HTTP 502' } });
    view = await mount();
    await lineReads('PR state unavailable · gh pr view: HTTP 502');
    view.unmount();
    bridge();
    const invoke = fake.client.invoke;
    fake.client.invoke = (async (command: CommandName, input: never) =>
      command === 'scm.status' ? { ok: false, error: { code: 'internal', message: 'unknown app session: app-a' } } : invoke(command, input)) as never;
    await mount();
    await lineReads('PR state unavailable · unknown app session: app-a');
  });

  it('asks for trust, and polls nothing, in an untrusted checkout or one without a remote', async () => {
    const user = userEvent.setup();
    bridge({ 'scm.status': { ...SCM, trusted: false } });
    const view = await mount();
    await lineReads('Trust this folder to see PR state');
    expect(fake.invoked('scm.pr.state')).toEqual([]);
    // Refresh re-reads trust and asks gh nothing
    await user.click(within(push()).getByRole('button', { name: 'Refresh PR state' }));
    await waitFor(() => expect(fake.invoked('scm.status')).toHaveLength(2));
    expect(fake.invoked('scm.pr.state')).toEqual([]);
    view.unmount();
    bridge({ 'scm.status': { ...SCM, remotes: [] } });
    await mount();
    expect(prLine()).toBeNull();
    expect(fake.invoked('scm.pr.state')).toEqual([]);
  });

  it('Install opens cli.github.com when gh is missing; Sign in types gh auth login into a Terminal tab', async () => {
    const user = userEvent.setup();
    const addTool = vi.spyOn(panelHost, 'addTool');
    bridge({ 'scm.status': { ...SCM, gh: { state: 'missing' } }, 'scm.pr.state': { ...PR, gh: { state: 'missing' }, pr: null, error: 'gh_missing', checkedAt: SCM.checkedAt } });
    const view = await mount();
    await lineReads('GitHub CLI not installed · Install');
    await user.click(within(push()).getByRole('button', { name: 'Install' }));
    expect(fake.invoked('layout.openExternal')).toEqual([{ url: 'https://cli.github.com' }]);
    view.unmount();
    const signedOut: ScmGhState = { state: 'unauthenticated', path: '/bin/gh', version: null, detail: 'You are not logged into any GitHub hosts' };
    bridge({ 'scm.status': { ...SCM, gh: signedOut }, 'scm.pr.state': { ...PR, gh: signedOut, pr: null, error: 'gh_unauthenticated', checkedAt: SCM.checkedAt } });
    await mount();
    await lineReads('GitHub CLI not signed in · Sign in');
    await user.click(within(push()).getByRole('button', { name: 'Sign in' }));
    expect(addTool).toHaveBeenCalledWith('terminal', { appSessionId: A, params: { cwd: DIR, command: 'gh auth login' } });
  });

  it('asks the PR state again when the branch head or refs move in the repository, not for a worktree edit or another root', async () => {
    await mount();
    expect(fake.invoked('scm.pr.state')).toHaveLength(1);
    act(() => fake.event('git.changed', { repoRoot: DIR, status: GIT, reason: 'worktree' }));
    act(() => fake.event('git.changed', { repoRoot: '/elsewhere', status: { ...GIT, repoRoot: '/elsewhere' }, reason: 'refs' }));
    await settle();
    expect(fake.invoked('scm.pr.state')).toHaveLength(1);
    act(() => fake.event('git.changed', { repoRoot: DIR, status: GIT, reason: 'refs' }));
    await settle();
    expect(fake.invoked('scm.pr.state')).toHaveLength(2);
  });

  it('reads scm.status again when the branch head or refs move in the repository (a new remote, a new upstream), not for a worktree edit or another root', async () => {
    await mount();
    expect(fake.invoked('scm.status')).toHaveLength(1);
    act(() => fake.event('git.changed', { repoRoot: DIR, status: GIT, reason: 'worktree' }));
    act(() => fake.event('git.changed', { repoRoot: '/elsewhere', status: { ...GIT, repoRoot: '/elsewhere' }, reason: 'head' }));
    await settle();
    expect(fake.invoked('scm.status')).toHaveLength(1);
    act(() => fake.event('git.changed', { repoRoot: DIR, status: GIT, reason: 'refs' }));
    await settle();
    expect(fake.invoked('scm.status')).toHaveLength(2);
    act(() => fake.event('git.changed', { repoRoot: DIR, status: GIT, reason: 'head' }));
    await settle();
    expect(fake.invoked('scm.status')).toHaveLength(3);
  });

  // Main answers per branch; the query is the session's (E6 final review, finding 3).
  describe('an answer for another branch is no answer', () => {
    const setStatus = (status: GitStatus) =>
      act(() => useGit.setState((s) => ({ entries: new Map(s.entries).set(DIR, { ...s.entries.get(DIR)!, status }) })));
    const OTHER: GitStatus = { ...GIT, branch: 'other', upstream: 'origin/other', head: '1234567abcdef' };

    it('after a switch, says nothing of the old branch’s PR until the new branch’s answer', async () => {
      await mount();
      await lineReads('PR #12 Open · 2 passed, 1 pending');
      let answer: (value: ScmPrState) => void = () => {};
      const invoke = fake.client.invoke;
      fake.client.invoke = (async (command: CommandName, input: never) =>
        command === 'scm.pr.state' ? new Promise((resolve) => (answer = (value) => resolve({ ok: true, value }))) : invoke(command, input)) as never;
      setStatus(OTHER);
      act(() => fake.event('git.changed', { repoRoot: DIR, status: OTHER, reason: 'head' }));
      await settle();
      expect(within(push()).getByText('Up to date with origin/other')).toBeTruthy();
      expect(prLine()).toBeNull();
      act(() => answer({ ...PR, checkedAt: '2026-10-06T10:02:00.000Z', branch: 'other', pr: null }));
      await lineReads('No PR for other');
    });

    it('hides on a detached head, and back on another branch shows no PR of the branch it left', async () => {
      await mount();
      await lineReads('PR #12 Open · 2 passed, 1 pending');
      setStatus({ ...GIT, branch: null, upstream: null });
      await settle();
      expect(screen.queryByRole('region', { name: 'Push state' })).toBeNull();
      setStatus(OTHER); // no head event: the shared query still holds feature's answer
      await settle();
      expect(within(push()).getByText('Up to date with origin/other')).toBeTruthy();
      expect(prLine()).toBeNull();
    });
  });

  it('the push text opens Source control in the shown session once the tool is registered, and is plain text before', async () => {
    const user = userEvent.setup();
    const view = await mount();
    expect(within(push()).queryByRole('button', { name: 'Open Source control' })).toBeNull();
    expect(within(push()).getByText('Up to date with origin/feature')).toBeTruthy();
    view.unmount();
    const addTool = vi.spyOn(panelHost, 'addTool');
    registerPanelTool(probeTool('source-control', { multiInstance: false }).tool);
    await mount();
    const open = within(push()).getByRole('button', { name: 'Open Source control' });
    expect(open.textContent).toBe('Up to date with origin/feature');
    await user.click(open);
    expect(addTool).toHaveBeenCalledWith('source-control', { appSessionId: A });
  });

  it('leaves the trust sentence once the folder is trusted in a session’s setup, without another click', async () => {
    const user = userEvent.setup();
    let scm: ScmStatus = { ...SCM, trusted: false };
    bridge({ 'scm.status': () => scm });
    await mount();
    await lineReads('Trust this folder to see PR state');
    await user.click(within(push()).getByRole('button', { name: 'Refresh PR state' }));
    await settle();
    await lineReads('Trust this folder to see PR state');
    scm = { ...SCM, checkedAt: '2026-10-06T10:02:00.000Z' }; // main records the trust in the `trusting` phase
    act(() => fake.event('session.setup', { appSessionId: A, phase: 'trusting', detail: null, outcome: null }));
    for (let i = 0; i < 4; i++) await settle();
    await lineReads('PR #12 Open · 2 passed, 1 pending');
    expect(fake.invoked('scm.pr.state')).toEqual([{ appSessionId: A, refresh: false }]);
  });

  it('asks the PR state again when scm.status found gh ready after the PR state found it signed out', async () => {
    const signedOut: ScmGhState = { state: 'unauthenticated', path: '/bin/gh', version: null, detail: 'You are not logged into any GitHub hosts' };
    const answers: ScmPrState[] = [{ ...PR, checkedAt: '2026-10-06T09:59:00.000Z', gh: signedOut, pr: null, error: 'gh_unauthenticated' }, PR];
    bridge({ 'scm.pr.state': () => answers.shift() ?? PR });
    await mount();
    await lineReads('PR #12 Open · 2 passed, 1 pending');
    expect(fake.invoked('scm.pr.state')).toEqual([{ appSessionId: A, refresh: false }, { appSessionId: A, refresh: false }]);
  });

  it('polls the PR state every 2 minutes while the row is shown, and not at all once it is gone', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const view = await mount();
    await lineReads('PR #12 Open · 2 passed, 1 pending'); // the line's own render wakes the wait (its interval is faked)
    expect(fake.invoked('scm.pr.state')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(119_999));
    await settle();
    expect(fake.invoked('scm.pr.state')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    await vi.waitFor(() => expect(fake.invoked('scm.pr.state')).toHaveLength(2)); // vitest's wait runs on real timers
    view.unmount();
    act(() => vi.advanceTimersByTime(600_000));
    await settle();
    expect(fake.invoked('scm.pr.state')).toHaveLength(2);
  });

  it('shows the push text plain and no PR line for a directory that is not the shown session’s checkout', async () => {
    const OTHER = '/work/elsewhere';
    registerPanelTool(probeTool('source-control', { multiInstance: false }).tool);
    useGit.setState({ entries: new Map([[OTHER, { root: OTHER, status: { ...GIT, repoRoot: OTHER }, uncommitted: null, error: null }]]) });
    render(
      <QueryClientProvider client={queryClient}>
        <PushState directory={OTHER} />
      </QueryClientProvider>,
    );
    await settle();
    expect(within(push()).getByText('Up to date with origin/feature').tagName).toBe('SPAN');
    expect(within(push()).queryByRole('button', { name: 'Open Source control' })).toBeNull();
    expect(prLine()).toBeNull();
    expect(fake.invoked('scm.status')).toEqual([]);
  });
});
