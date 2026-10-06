// The Source control body (E6 execution document, Design §5, M3): the header, the four groups with their row and
// group actions, the diff body through Review's view, the notice, the trust and repository states. Main is a fake X2
// bridge behind the renderer's validating client; the status moves only through C4's `git.changed`, as the watcher's
// refresh after a mutation delivers it.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { connectPanelEvents } from '../../ipc/events';
import { queryClient } from '../../ipc/query';
import { REVIEW_FILE_LINES_CAP, REVIEW_SCOPE_BYTES_CAP } from '../code/review/review-model';
import { useGit } from '../../stores/git';
import { useLayout } from '../../stores/layout';
import { fail, ok } from '../../test-support/code';
import { A, DIR, planOf, prOf, prStateOf, refusal, SCRATCH_FILES, scmFile, scmMain, scmStatusOf, scmUntracked, statusOf, stubCanvas, TOKEN } from '../../test-support/scm';
import { useViewer } from '../code/viewer/viewer-store';
import { ScmShell } from './ScmShell';
import { SCM_REFRESH_MS, useScm } from './store';
import { createScmUi, type ScmUi } from './view-state';

// The highlighter would load shiki's grammars; the diff paints plain until it is ready, which here is never.
vi.mock('@git-diff-view/shiki', () => ({ getDiffViewHighlighter: () => new Promise(() => {}) }));
const openTerminal = vi.hoisted(() => vi.fn(() => 'terminal-1'));
vi.mock('../terminal', () => ({ openTerminal }));
stubCanvas();

let main: ReturnType<typeof scmMain>;
let ui: StoreApi<ScmUi>;
let off: () => void = () => {};

function renderShell() {
  return render(
    <QueryClientProvider client={queryClient}>
      <ScmShell appSessionId={A} directory={DIR} ui={ui} />
    </QueryClientProvider>,
  );
}

const group = (name: string) => screen.getByRole('region', { name });
const rowsOf = (name: string) => [...group(name).querySelectorAll<HTMLElement>('[data-scm-row]')].map((row) => row.dataset.path);
const rowButton = (name: string, path: string) => group(name).querySelector<HTMLButtonElement>(`[data-scm-row][data-path="${CSS.escape(path)}"] [data-scm-select]`)!;
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));
const untrackedReads = () => main.callsOf('git.diff').filter((input) => input.scope === 'untracked');

beforeEach(() => {
  queryClient.clear();
  useGit.setState({ entries: new Map() });
  useScm.getState().reset();
  useViewer.getState().reset();
  main = scmMain();
  ui = createScmUi({ session: A });
  off = connectPanelEvents(); // C4's change events into C8a's store, as App.tsx connects them
});
afterEach(() => {
  cleanup();
  off();
  vi.useRealTimers();
});

describe('source control tool renders groups, selects a file and draws its hunks', () => {
  it('lists Staged 1, Unstaged 1 and Untracked 2 under the branch line, with no Conflicts group', async () => {
    renderShell();
    await waitFor(() => expect(rowsOf('Untracked')).toEqual(['untracked.txt', 'udir/']));
    expect(rowsOf('Staged')).toEqual(['src/staged.ts']);
    expect(rowsOf('Unstaged')).toEqual(['src/app.ts']);
    expect(screen.queryByRole('region', { name: 'Conflicts' })).toBeNull();
    expect([...document.querySelectorAll('[data-scm-count]')].map((el) => el.textContent)).toEqual(['1', '1', '2']);
    expect(document.querySelector('[data-scm-header]')?.textContent).toBe('⎇ main · origin/main · 1 ahead');
    expect(screen.getByText('Select a file to see its changes')).toBeTruthy();
    expect(main.callsOf('git.diff').filter((input) => input.scope !== 'all')).toEqual([]); // nothing read before a selection
  });

  it('draws the selected file’s hunks through Review’s diff view, reading its group’s scope', async () => {
    renderShell();
    await waitFor(() => expect(rowsOf('Unstaged')).toEqual(['src/app.ts']));
    fireEvent.click(rowButton('Unstaged', 'src/app.ts'));
    await waitFor(() => expect(document.querySelector('[data-review-block]')).not.toBeNull());
    expect(document.querySelector('[data-scm-file-header]')?.textContent).toBe('src/app.ts · Modified');
    expect(screen.getByText('Showing hunk 1 of 1')).toBeTruthy();
    expect(main.callsOf('git.diff')).toContainEqual({ directory: DIR, scope: 'worktree' });
    expect(rowButton('Unstaged', 'src/app.ts').getAttribute('aria-current')).toBe('true');
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1);

    fireEvent.click(rowButton('Staged', 'src/staged.ts'));
    await waitFor(() => expect(document.querySelector('[data-scm-file-header]')?.textContent).toBe('src/staged.ts · Added'));
    expect(main.callsOf('git.diff')).toContainEqual({ directory: DIR, scope: 'staged' });
    await waitFor(() => expect(document.querySelector('[data-review-block]')).not.toBeNull());
  });

  it('reads an untracked file’s diff only once it is selected, as an all-added diff; a directory entry reads nothing', async () => {
    renderShell();
    await waitFor(() => expect(rowsOf('Untracked')).toHaveLength(2));
    fireEvent.click(rowButton('Untracked', 'udir/'));
    expect(screen.getByText('An untracked directory: Stage adds every file in it')).toBeTruthy();
    expect(untrackedReads()).toEqual([]);
    fireEvent.click(rowButton('Untracked', 'untracked.txt'));
    await waitFor(() => expect(document.querySelector('[data-review-block]')).not.toBeNull());
    expect(untrackedReads()).toEqual([{ directory: DIR, scope: 'untracked', path: 'untracked.txt' }]);
    expect(document.querySelector('[data-scm-file-header]')?.textContent).toBe('untracked.txt · Untracked');
  });

  it('stages and unstages a row, and the selection follows the file to the group git lists it in next', async () => {
    renderShell();
    await waitFor(() => expect(rowsOf('Unstaged')).toEqual(['src/app.ts']));
    fireEvent.click(rowButton('Unstaged', 'src/app.ts'));
    fireEvent.click(screen.getByRole('button', { name: 'Stage src/app.ts' }));
    await waitFor(() => expect(main.callsOf('scm.stage')).toEqual([{ appSessionId: A, paths: ['src/app.ts'] }]));
    expect(rowsOf('Unstaged')).toEqual(['src/app.ts']); // the answer moves nothing; the watcher's event does
    act(() => main.change(statusOf({ ahead: 1, files: [scmFile('src/app.ts', 'M', '.'), ...SCRATCH_FILES.slice(1)] })));
    await waitFor(() => expect(rowsOf('Staged')).toEqual(['src/app.ts', 'src/staged.ts']));
    expect(rowsOf('Unstaged')).toEqual([]);
    expect(ui.getState().selected).toEqual({ group: 'staged', path: 'src/app.ts' });
    await waitFor(() => expect(main.callsOf('git.diff')).toContainEqual({ directory: DIR, scope: 'staged' }));

    fireEvent.click(screen.getByRole('button', { name: 'Unstage src/app.ts' }));
    await waitFor(() => expect(main.callsOf('scm.unstage')).toEqual([{ appSessionId: A, paths: ['src/app.ts'] }]));
  });

  it('releases a staged untracked file’s hold before the re-read, so its diff never reads as no diff', async () => {
    renderShell();
    await waitFor(() => expect(rowsOf('Untracked')).toHaveLength(2));
    fireEvent.click(rowButton('Untracked', 'untracked.txt'));
    await waitFor(() => expect(document.querySelector('[data-review-block]')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Stage untracked.txt' }));
    await waitFor(() => expect(main.callsOf('scm.stage')).toHaveLength(1));
    main.state.untracked.delete('untracked.txt'); // main would now refuse it: "not an untracked file"
    main.state.diffs.staged = { patch: main.state.diffs.staged.patch + UNTRACKED_STAGED, files: [...main.state.diffs.staged.files, { path: 'untracked.txt', oldPath: null, insertions: 2, deletions: 0, binary: false }] };
    act(() => main.change(statusOf({ ahead: 1, files: [scmFile('src/app.ts', '.', 'M'), scmFile('src/staged.ts', 'A', '.'), scmFile('untracked.txt', 'A', '.'), scmUntracked('udir/')] })));
    await waitFor(() => expect(ui.getState().selected).toEqual({ group: 'staged', path: 'untracked.txt' }));
    await wait(SCM_REFRESH_MS + 50);
    expect(untrackedReads()).toHaveLength(1); // the stale hold was released before its 250 ms re-read
    expect(screen.queryByText('No diff for this entry')).toBeNull();
    await waitFor(() => expect(document.querySelector('[data-scm-file-header]')?.textContent).toBe('untracked.txt · Added'));
  });

  it('acts on a whole group from its header, and opens the Discard and Delete sheets naming every file', async () => {
    main.change(statusOf({ files: [...SCRATCH_FILES, scmFile('src/b.ts', '.', 'D')] }));
    renderShell();
    await waitFor(() => expect(rowsOf('Unstaged')).toEqual(['src/app.ts', 'src/b.ts']));
    fireEvent.click(screen.getByRole('button', { name: 'Stage all unstaged changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stage all untracked files' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unstage all' }));
    await waitFor(() => expect(main.callsOf('scm.unstage')).toHaveLength(1));
    expect(main.callsOf('scm.stage')).toEqual([
      { appSessionId: A, paths: ['src/app.ts', 'src/b.ts'] },
      { appSessionId: A, paths: ['untracked.txt', 'udir/'] },
    ]);
    expect(main.callsOf('scm.unstage')).toEqual([{ appSessionId: A, paths: ['src/staged.ts'] }]);

    fireEvent.click(screen.getByRole('button', { name: 'Discard all unstaged changes' }));
    const sheet = await screen.findByRole('dialog', { name: 'Discard changes' });
    expect([...sheet.querySelectorAll('[data-scm-sheet-path]')].map((el) => el.textContent)).toEqual(['src/app.ts', 'src/b.ts']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Delete all untracked files' }));
    const deleting = await screen.findByRole('dialog', { name: 'Delete untracked files' });
    expect([...deleting.querySelectorAll('[data-scm-sheet-path]')].map((el) => el.textContent)).toEqual(['untracked.txt', 'udir/']);
    expect(ui.getState().sheet).toEqual({ kind: 'discard', entries: [{ path: 'untracked.txt', group: 'untracked' }, { path: 'udir/', group: 'untracked' }] });
  });

  it('discards one row through the sheet: Discard… for an unstaged file, Delete… for an untracked one', async () => {
    renderShell();
    await waitFor(() => expect(rowsOf('Unstaged')).toEqual(['src/app.ts']));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes to src/app.ts' }));
    expect(ui.getState().sheet).toEqual({ kind: 'discard', entries: [{ path: 'src/app.ts', group: 'unstaged' }] });
    const sheet = await screen.findByRole('dialog', { name: 'Discard changes' });
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Discard 1 change; this cannot be undone' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(main.callsOf('scm.discard')).toEqual([{ appSessionId: A, entries: [{ path: 'src/app.ts', group: 'unstaged' }] }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Delete untracked.txt' }));
    expect(ui.getState().sheet).toEqual({ kind: 'discard', entries: [{ path: 'untracked.txt', group: 'untracked' }] });
  });

  it('offers Mark resolved and Open file on a conflict row, never a discard, and draws no diff for it', async () => {
    main.change(statusOf({ files: [scmFile('f.txt', 'U', 'U'), scmFile('src/app.ts', '.', 'M')] }));
    const openTab = vi.fn();
    const original = useLayout.getState().openTab;
    useLayout.setState({ openTab });
    try {
      renderShell();
      await waitFor(() => expect(rowsOf('Conflicts')).toEqual(['f.txt']));
      const row = group('Conflicts').querySelector<HTMLElement>('[data-scm-row]')!;
      expect([...row.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label'))).toEqual(['Mark f.txt resolved', 'Open f.txt']);
      expect(row.querySelector('[data-change]')?.getAttribute('title')).toBe('Both modified');
      fireEvent.click(rowButton('Conflicts', 'f.txt'));
      expect(screen.getByText('A merge conflict: resolve it in the file, then Mark resolved')).toBeTruthy();
      expect(main.callsOf('git.diff').filter((input) => input.scope !== 'all')).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'Mark f.txt resolved' }));
      await waitFor(() => expect(main.callsOf('scm.stage')).toEqual([{ appSessionId: A, paths: ['f.txt'] }]));
      fireEvent.click(screen.getByRole('button', { name: 'Open f.txt' }));
      expect(openTab).toHaveBeenCalledWith({ kind: 'file', path: `${DIR}/f.txt`, line: null, appSessionId: A });
    } finally {
      useLayout.setState({ openTab: original });
    }
  });

  it('shows a refusal in the notice with what git printed behind a disclosure, and clears it on the next success', async () => {
    main.state.answers['scm.stage'] = () => ok(refusal('git_failed', 'fatal: Unable to create index.lock', 'stdout words\nfatal: Unable to create index.lock'));
    renderShell();
    await waitFor(() => expect(rowsOf('Unstaged')).toEqual(['src/app.ts']));
    fireEvent.click(screen.getByRole('button', { name: 'Stage src/app.ts' }));
    const notice = await screen.findByRole('alert');
    expect(notice.querySelector('[data-scm-notice-text]')?.textContent).toBe('git failed: fatal: Unable to create index.lock');
    expect(within(notice).getByText('Output')).toBeTruthy();
    expect(notice.querySelector('pre')?.textContent).toBe('stdout words\nfatal: Unable to create index.lock');
    delete main.state.answers['scm.stage'];
    fireEvent.click(screen.getByRole('button', { name: 'Stage src/app.ts' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows the untrusted notice with every action disabled, the lists still shown', async () => {
    main.state.scm = scmStatusOf({ trusted: false });
    renderShell();
    await waitFor(() => expect(screen.getByText('MAWS runs git here only after you trust the folder in a session')).toBeTruthy());
    await waitFor(() => expect(rowsOf('Untracked')).toHaveLength(2));
    const actions = [...document.querySelectorAll<HTMLButtonElement>('[data-scm-action]')];
    expect(actions.length).toBeGreaterThan(5);
    for (const action of actions) expect(action.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Commit' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(rowButton('Unstaged', 'src/app.ts')); // reading is not gated
    await waitFor(() => expect(document.querySelector('[data-review-block]')).not.toBeNull());
  });

  it('says why the actions are off when scm.status fails, the lists still shown', async () => {
    main.state.answers['scm.status'] = () => fail('unknown app session: app-a');
    renderShell();
    await waitFor(() => expect(screen.getByText('Source control unavailable: unknown app session: app-a')).toBeTruthy());
    await waitFor(() => expect(rowsOf('Unstaged')).toEqual(['src/app.ts']));
    for (const action of document.querySelectorAll<HTMLButtonElement>('[data-scm-action]')) expect(action.disabled).toBe(true);
  });

  it('clears the untrusted notice once a session’s setup records trust in-app, without a remount', async () => {
    main.state.scm = scmStatusOf({ trusted: false });
    renderShell();
    await waitFor(() => expect(screen.getByText('MAWS runs git here only after you trust the folder in a session')).toBeTruthy());
    await waitFor(() => expect(rowsOf('Unstaged')).toEqual(['src/app.ts']));
    main.state.scm = scmStatusOf({ trusted: true }); // C10's Trust and start recorded it in main
    act(() => main.emit('session.setup', { appSessionId: A, phase: 'launching', detail: null, outcome: null }));
    await waitFor(() => expect(screen.queryByText('MAWS runs git here only after you trust the folder in a session')).toBeNull());
    expect((screen.getByRole('button', { name: 'Stage src/app.ts' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the actions and says nothing when a re-read of scm.status fails over a cached answer', async () => {
    renderShell();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Stage src/app.ts' }) as HTMLButtonElement).disabled).toBe(false));
    main.state.answers['scm.status'] = () => fail('engine host restarting');
    act(() => main.emit('session.setup', { appSessionId: A, phase: 'ready', detail: null, outcome: null }));
    await waitFor(() => expect(main.callsOf('scm.status')).toHaveLength(2));
    await wait(20);
    expect(screen.queryByText(/Source control unavailable/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Stage src/app.ts' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says Not a git repository and nothing else outside a repository', async () => {
    main.state.watchError = 'not a git repository';
    renderShell();
    await waitFor(() => expect(screen.getByText('Not a git repository')).toBeTruthy());
    expect(screen.queryAllByRole('region')).toEqual([]);
    expect(screen.queryByRole('textbox', { name: 'Commit message' })).toBeNull();
  });

  it('selects an open() target once the status is known, Staged first, and expands its group', async () => {
    ui.setState({ request: { target: `${DIR}/src/staged.ts` }, collapsed: new Set(['staged'] as const) });
    renderShell();
    await waitFor(() => expect(ui.getState().selected).toEqual({ group: 'staged', path: 'src/staged.ts' }));
    expect(ui.getState().request).toBeNull();
    expect(rowsOf('Staged')).toEqual(['src/staged.ts']);
    await waitFor(() => expect(document.querySelector('[data-scm-file-header]')?.textContent).toBe('src/staged.ts · Added'));
  });

  it('collapses a group from its header', async () => {
    renderShell();
    await waitFor(() => expect(rowsOf('Untracked')).toHaveLength(2));
    const toggle = within(group('Untracked')).getByRole('button', { name: /^Untracked/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(rowsOf('Untracked')).toEqual([]);
  });
});

describe('the header’s Push and Open PR open their sheets, and the Output follows the session’s run', () => {
  const remoteAction = (name: string) => document.querySelector<HTMLButtonElement>(`[data-scm-remote-action="${name}"]`);

  it('offers Push for the commits ahead and Open PR only once pushed, each opening its sheet', async () => {
    renderShell();
    await waitFor(() => expect(remoteAction('push')?.disabled).toBe(false));
    expect(remoteAction('push')?.textContent).toBe('Push');
    expect(remoteAction('push')?.title).toBe('Push 1 commit to origin/main');
    expect(remoteAction('pr')).toMatchObject({ disabled: true, title: 'Push first' });
    fireEvent.click(remoteAction('push')!);
    const sheet = await screen.findByRole('dialog', { name: 'Push' });
    await waitFor(() => expect(sheet.querySelector('[data-scm-plan-command]')?.textContent).toBe('/usr/bin/git push --progress origin refs/heads/main:refs/heads/main'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    main.change(statusOf({ files: SCRATCH_FILES, ahead: 0 }));
    await waitFor(() => expect(remoteAction('pr')?.disabled).toBe(false));
    expect(remoteAction('push')).toMatchObject({ disabled: true, title: 'Nothing to push' });
    fireEvent.click(remoteAction('pr')!);
    expect(await screen.findByRole('dialog', { name: 'Open pull request' })).toBeTruthy();
  });

  it('reads Publish for a branch with no upstream of its own', async () => {
    main.state.status = statusOf({ files: SCRATCH_FILES, branch: 'feature', upstream: 'origin/main', ahead: 2 });
    renderShell();
    await waitFor(() => expect(remoteAction('push')?.textContent).toBe('Publish'));
    expect(remoteAction('push')).toMatchObject({ disabled: false, title: 'Publish feature' });
  });

  it('links the branch’s open PR in place of Open PR, from the PR state the summary’s row shares', async () => {
    main.state.status = statusOf({ files: SCRATCH_FILES, ahead: 0 });
    main.state.answers['scm.pr.state'] = () => ok(prStateOf({ pr: prOf() }));
    renderShell();
    const link = await screen.findByRole('button', { name: 'Open PR #7 on GitHub' });
    expect(link.textContent).toBe('PR #7 ↗');
    expect(remoteAction('pr')).toBeNull();
    expect(main.callsOf('scm.pr.state')).toEqual([{ appSessionId: A, refresh: false }]);
    fireEvent.click(link);
    await waitFor(() => expect(main.callsOf('layout.openExternal')).toEqual([{ url: 'https://github.com/o/r/pull/7' }]));
  });

  // Main answers per branch; the query is the session's. An answer for another branch, or any answer once there is
  // nothing to ask (a detached head), is no answer (E6 final review, finding 3).
  it('drops the old branch’s PR link after a switch until the new branch’s answer, and on a detached head', async () => {
    main.state.status = statusOf({ files: SCRATCH_FILES, ahead: 0 });
    main.state.answers['scm.pr.state'] = () => {
      const branch = main.state.status.branch;
      return ok(prStateOf({ branch, pr: branch === 'main' ? prOf() : null, checkedAt: '2026-10-06T10:00:01.000Z' }));
    };
    renderShell();
    await screen.findByRole('button', { name: 'Open PR #7 on GitHub' });

    main.change(statusOf({ files: SCRATCH_FILES, branch: 'feature', upstream: 'origin/feature', ahead: 0 })); // no re-read yet
    await waitFor(() => expect(document.querySelector('[data-scm-header]')?.textContent).toBe('⎇ feature · origin/feature · 0 ahead'));
    expect(screen.queryByRole('button', { name: 'Open PR #7 on GitHub' })).toBeNull();
    expect(remoteAction('pr')).toMatchObject({ disabled: false, title: 'Open a pull request for feature' });
    act(() => main.emit('git.changed', { repoRoot: DIR, status: main.state.status, reason: 'head' }));
    await waitFor(() => expect(main.callsOf('scm.pr.state')).toHaveLength(2));
    await wait(20);
    expect(remoteAction('pr')?.textContent).toBe('Open PR'); // feature has none

    main.change(statusOf({ files: SCRATCH_FILES, ahead: 0 })); // back on main: its PR is asked again
    act(() => main.emit('git.changed', { repoRoot: DIR, status: main.state.status, reason: 'head' }));
    await screen.findByRole('button', { name: 'Open PR #7 on GitHub' });
    main.change(statusOf({ files: SCRATCH_FILES, branch: null, upstream: null, ahead: 0 }));
    await waitFor(() => expect(document.querySelector('[data-scm-header]')?.textContent).toBe('detached at 0123456'));
    expect(screen.queryByRole('button', { name: 'Open PR #7 on GitHub' })).toBeNull();
    expect(remoteAction('pr')?.disabled).toBe(true);
  });

  it('reads the PR state again when the head or refs move, not on an index change', async () => {
    renderShell();
    await waitFor(() => expect(main.callsOf('scm.pr.state')).toHaveLength(1));
    main.change(statusOf({ files: SCRATCH_FILES.slice(1), ahead: 1 })); // reason: index
    await wait(20);
    expect(main.callsOf('scm.pr.state')).toHaveLength(1);
    const status = statusOf({ files: SCRATCH_FILES, ahead: 0 });
    act(() => main.emit('git.changed', { repoRoot: DIR, status, reason: 'refs' }));
    await waitFor(() => expect(main.callsOf('scm.pr.state')).toHaveLength(2));
  });

  it('says in the row’s words why an open PR cannot be read when gh is missing or signed out, with the way out', async () => {
    main.state.status = statusOf({ files: SCRATCH_FILES, ahead: 0 });
    main.state.answers['scm.pr.state'] = () => ok(prStateOf({ gh: { state: 'missing' }, error: 'gh_missing' }));
    renderShell();
    const note = () => document.querySelector('[data-scm-gh-note]');
    await waitFor(() => expect(note()?.textContent).toBe('GitHub CLI not installed · Install'));
    fireEvent.click(within(note() as HTMLElement).getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(main.callsOf('layout.openExternal')).toEqual([{ url: 'https://cli.github.com' }]));
    cleanup();
    queryClient.clear();

    const signedOut = { state: 'unauthenticated', path: '/opt/homebrew/bin/gh', version: '2.97.0', detail: 'You are not logged into any GitHub hosts.' } as const;
    main.state.scm = scmStatusOf({ gh: signedOut });
    main.state.answers['scm.pr.state'] = () => ok(prStateOf({ gh: signedOut, error: 'gh_unauthenticated' }));
    renderShell();
    await waitFor(() => expect(note()?.textContent).toBe('GitHub CLI not signed in · Sign in'));
    fireEvent.click(within(note() as HTMLElement).getByRole('button', { name: 'Sign in' }));
    expect(openTerminal).toHaveBeenCalledWith({ appSessionId: A, cwd: DIR, command: 'gh auth login' });
  });

  it('says nothing of gh when it is ready', async () => {
    main.state.scm = scmStatusOf({ gh: { state: 'ready', path: '/opt/homebrew/bin/gh', version: '2.97.0' } });
    renderShell();
    await waitFor(() => expect(main.callsOf('scm.pr.state')).toHaveLength(1));
    await wait(20);
    expect(document.querySelector('[data-scm-gh-note]')).toBeNull();
  });

  it('asks nothing of gh and offers neither action in an untrusted checkout', async () => {
    main.state.scm = scmStatusOf({ trusted: false });
    renderShell();
    await waitFor(() => expect(remoteAction('push')?.title).toBe('Trust the folder to push'));
    expect(remoteAction('push')?.disabled).toBe(true);
    expect(remoteAction('pr')).toMatchObject({ disabled: true, title: 'Trust the folder to open a pull request' });
    await wait(20);
    expect(main.callsOf('scm.pr.state')).toEqual([]);
  });

  it('resumes the session’s run below the commit form, and reads the PR state again when it ends', async () => {
    main.state.answers['scm.remote.last'] = () =>
      ok({ token: TOKEN, kind: 'push', plan: planOf(), running: true, exitCode: null, signal: null, output: 'Enumerating objects: 3, done.\n', truncated: false, seq: 1, startedAt: '2026-10-06T10:00:00.000Z' });
    renderShell();
    const output = await screen.findByRole('region', { name: 'Output' });
    expect(main.callsOf('scm.remote.last')).toEqual([{ appSessionId: A }]);
    expect(document.querySelector('[data-scm-commit]')?.compareDocumentPosition(output)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await waitFor(() => expect(output.querySelector('[data-scm-output-text]')?.textContent).toBe('Enumerating objects: 3, done.'));
    await waitFor(() => expect(main.callsOf('scm.pr.state')).toHaveLength(1));
    act(() => main.emit('scm.remote.output', { appSessionId: A, token: TOKEN, seq: 2, kind: 'exit', exitCode: 0, signal: null }));
    await waitFor(() => expect(main.callsOf('scm.pr.state')).toHaveLength(2));
  });
});

describe('the diff body’s other states', () => {
  const note = () => document.querySelector('[data-scm-note]')?.textContent;
  const select = async (name: string, path: string) => {
    renderShell();
    await waitFor(() => expect(rowsOf(name)).toContain(path));
    fireEvent.click(rowButton(name, path));
  };

  it('reads one file on its own when its scope is past the cap, and draws it', async () => {
    main.state.diffs.worktree = { patch: APP_PATCH_HEAD + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP), files: [{ path: 'src/app.ts', oldPath: null, insertions: 1, deletions: 0, binary: false }] };
    main.state.fileDiffs.set('src/app.ts', { patch: APP_PATCH_HEAD, files: [] });
    await select('Unstaged', 'src/app.ts');
    await waitFor(() => expect(document.querySelector('[data-review-block]')).not.toBeNull());
    expect(main.callsOf('git.diff')).toContainEqual({ directory: DIR, scope: 'worktree', path: 'src/app.ts' });
  });

  it('says a binary file is binary', async () => {
    main.change(statusOf({ files: [scmFile('logo.png', '.', 'M')] }));
    main.state.diffs.worktree = { patch: 'diff --git a/logo.png b/logo.png\nindex 1111111..2222222 100644\nBinary files a/logo.png and b/logo.png differ\n', files: [{ path: 'logo.png', oldPath: null, insertions: 0, deletions: 0, binary: true }] };
    await select('Unstaged', 'logo.png');
    await waitFor(() => expect(note()).toBe('Binary file'));
  });

  it('says a file past the line cap is too large and offers it at its first changed line', async () => {
    const lines = Array.from({ length: REVIEW_FILE_LINES_CAP + 1 }, (_, i) => `+line ${i}`);
    main.state.diffs.worktree = { patch: ['diff --git a/src/app.ts b/src/app.ts', 'index 1..2 100644', '--- a/src/app.ts', '+++ b/src/app.ts', `@@ -3,0 +4,${lines.length} @@`, ...lines, ''].join('\n'), files: [] };
    const openTab = vi.fn();
    const original = useLayout.getState().openTab;
    useLayout.setState({ openTab });
    try {
      await select('Unstaged', 'src/app.ts');
      await waitFor(() => expect(note()).toBe('Diff too large to display. Open the file'));
      fireEvent.click(screen.getByRole('button', { name: 'Open the file' }));
      expect(openTab).toHaveBeenCalledWith({ kind: 'file', path: `${DIR}/src/app.ts`, line: 4, appSessionId: A });
    } finally {
      useLayout.setState({ openTab: original });
    }
  });

  it('says an untracked file past the scope cap is too large, rather than loading forever', async () => {
    main.state.untracked.set('untracked.txt', UNTRACKED_HEAD + 'x'.repeat(REVIEW_SCOPE_BYTES_CAP));
    await select('Untracked', 'untracked.txt');
    await waitFor(() => expect(note()).toBe('Diff too large to display. Open the file'));
    expect(main.callsOf('git.diff').filter((input) => input.path !== undefined && input.scope !== 'untracked')).toEqual([]);
  });

  it('says no diff for an untracked file C4 no longer lists', async () => {
    main.state.untracked.delete('untracked.txt');
    await select('Untracked', 'untracked.txt');
    await waitFor(() => expect(note()).toBe('No diff for this entry'));
  });

  it('says any other failure of an untracked read in its own words', async () => {
    main.state.answers['git.diff'] = () => fail('timed out after 10 s');
    await select('Untracked', 'untracked.txt');
    await waitFor(() => expect(note()).toBe('Diff unavailable: timed out after 10 s'));
  });
});

const APP_PATCH_HEAD = 'diff --git a/src/app.ts b/src/app.ts\nindex 1111111..2222222 100644\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,3 @@\n one\n+two\n three\n';
const UNTRACKED_HEAD = 'diff --git a/untracked.txt b/untracked.txt\nnew file mode 100644\nindex 0000000..4444444\n--- /dev/null\n+++ b/untracked.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n';
const UNTRACKED_STAGED = 'diff --git a/untracked.txt b/untracked.txt\nnew file mode 100644\nindex 0000000..4444444\n--- /dev/null\n+++ b/untracked.txt\n@@ -0,0 +1,2 @@\n+one\n+two\n';
