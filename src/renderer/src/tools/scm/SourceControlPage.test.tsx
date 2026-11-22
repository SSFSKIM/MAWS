// Source control's page (UX wave U5b-2, docs/doperpowers/plans/2026-11-15-ux-wave-U5b-review-source-control.md, M10, §H
// and §I; A14's S1 to S10; the frames' rulings S1 to S14, Decision Log 30 and 31). Main is a fake X2 bridge behind the
// renderer's validating client; the branch read answers from `git.branchCommits`, and its failures are the answers that
// cause each sentence. Layout facts come through the measure seam Review's toolbar uses (`review/measure.ts`): happy-dom
// lays nothing out, so each case gives the widths and the page's decisions follow them.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { connectPanelEvents } from '../../ipc/events';
import { queryClient } from '../../ipc/query';
import { registerPanelTool } from '../../panel/host';
import { NOT_A_REPOSITORY } from '../../sessions/branch-label';
import { useGit } from '../../stores/git';
import { useMachines } from '../../stores/machines';
import { fail, ok } from '../../test-support/code';
import { probeTool, resetPanelStores } from '../../test-support/panel';
import { branchCommitOf, branchCommitsOf, DIR, prOf, prStateOf, scmMain, scmStatusOf, shaOf, statusOf } from '../../test-support/scm';
import { BRANCH_READ_EVERY_MS, useBranchReads } from '../code/review/branch-read';
import { reviewLayout } from '../code/review/measure';
import { createPageUi, SourceControlPage } from './SourceControlPage';

const LOCAL = addressOf(TEST_MACHINE, 'app-a' as AppSessionId);
const REMOTE = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);

const file = (path: string, index = '.', worktree = 'M') => ({ path, oldPath: null, index, worktree, untracked: false });
const FEATURE = statusOf({ branch: 'feature/x', upstream: 'origin/feature/x', isWorktree: true, files: [file('src/a.ts'), file('src/b.ts'), file('src/c.ts')] });
const diffOf = (insertions: number, deletions: number) => ({ patch: '', files: [{ path: 'src/a.ts', oldPath: null, insertions, deletions, binary: false }] });
const READY_GH = { state: 'ready' as const, path: '/usr/local/bin/gh', version: '2.97.0' };

let main: ReturnType<typeof scmMain>;
let review: ReturnType<typeof probeTool>['probe'];
const offs: (() => void)[] = [];

function roster(machines: Partial<MachineState>[]) {
  useMachines.getState().applyRoster(
    machines.map((m) => ({ ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up' as const, since: '2026-11-16T10:00:00.000Z', generation: 0, ...m })),
  );
}
const serves = (capabilities = ['rl2.git-reads']) => roster([{ capabilities }]);
const servesRemote = (over: Partial<MachineState> = {}) => roster([{ capabilities: ['rl2.git-reads'] }, { ref: OTHER_MACHINE, name: 'berth-mini', local: false, capabilities: ['rl2.git-reads'], ...over }]);

function mount(appSessionId: AppSessionId = LOCAL, visible = true) {
  const ui = createPageUi(appSessionId, DIR);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <SourceControlPage appSessionId={appSessionId} directory={DIR} ui={ui} visible={visible} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    ui,
    show: (shown: boolean) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <SourceControlPage appSessionId={appSessionId} directory={DIR} ui={ui} visible={shown} />
        </QueryClientProvider>,
      ),
  };
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-scm-part="${name}"]`);
const parts = () => [...document.querySelectorAll<HTMLElement>('[data-scm-part]')].map((el) => el.dataset.scmPart);
// What a person reads in an element: its text pieces in order, a space between blocks and pieces, spaces collapsed
function text(el: Element | null | undefined): string | null {
  if (!el) return null;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const pieces: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) pieces.push(node.textContent ?? '');
  return pieces.join(' ').replace(/\s+/g, ' ').trim();
}
const commitRows = () => [...(part('commits')?.querySelectorAll<HTMLButtonElement>('[data-scm-commit]') ?? [])];
const branchAsks = () => main.callsOf('git.branchCommits').length;
const flush = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)));

// The measure seam: the natural widths by selector, and each line's room by its own selector.
function measures(widths: Record<string, number>, rooms: Record<string, number>) {
  vi.spyOn(reviewLayout, 'width').mockImplementation((element) => {
    for (const [selector, width] of Object.entries(widths)) if (element.matches(selector)) return width;
    return 0;
  });
  vi.spyOn(reviewLayout, 'contentWidth').mockImplementation((element) => {
    for (const [selector, room] of Object.entries(rooms)) if (element.matches(selector)) return room;
    return 0;
  });
}

beforeEach(() => {
  queryClient.clear();
  resetPanelStores();
  useGit.setState({ entries: new Map() });
  useBranchReads.getState().reset();
  main = scmMain({ status: FEATURE, scm: scmStatusOf({ gh: READY_GH }) });
  main.state.diffs.worktree = diffOf(48, 12);
  main.state.answers['scm.pr.state'] = () => ok(prStateOf({ branch: 'feature/x' }));
  const probed = probeTool('review', { title: 'Review', multiInstance: false });
  review = probed.probe;
  offs.push(connectPanelEvents(), registerPanelTool(probed.tool));
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  useBranchReads.getState().reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the page (S1, S2)', () => {
  it('draws Where, Uncommitted, Commits and Pull request in that order, as the frames name them', async () => {
    serves();
    mount();
    await waitFor(() => expect(text(part('pr'))).toBe('Pull request No PR for feature/x'));
    expect(parts()).toEqual(['uncommitted', 'commits', 'pr']);
    expect(text(document.querySelector('[data-scm-where]'))).toBe('⎇ feature/x · worktree');
    // the word cut (N57): the folder's path is the line's tooltip and description, the line taking the keyboard
    const where = document.querySelector<HTMLElement>('[data-scm-where]')!;
    expect([where.hasAttribute('title'), where.tabIndex, document.getElementById(where.getAttribute('aria-describedby')!)?.textContent]).toEqual([false, 0, DIR]);
    where.focus();
    expect((await screen.findByRole('tooltip')).textContent).toBe(DIR);
    expect(text(part('uncommitted'))).toBe('Uncommitted 3 +48 −12 Review ›');
    expect(text(part('commits')?.querySelector('[data-scm-commits-heading]'))).toBe('Commits 4 since origin/main Review ›');
    expect([...part('commits')!.querySelectorAll('[data-scm-commit-group]')].map(text)).toEqual(['Not pushed 2', 'Pushed to origin/feature/x 2']);
    expect(commitRows().map((row) => text(row))).toEqual(['Change number 1 0001bbb 1h', 'Change number 2 0002bbb 2h', 'Change number 3 0003bbb 3h', 'Change number 4 0004bbb 4h']);
  });

  it('holds the git watch and the branch read, and asks nothing that changes the repository or that the acting pane asked', async () => {
    serves();
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(4));
    await flush();
    const asked = new Set(main.calls.map((call) => call.name));
    expect([...asked].sort()).toEqual(['git.branchCommits', 'git.diff', 'git.watch', 'scm.pr.state', 'scm.status']);
    expect(main.callsOf('git.branchCommits')).toEqual([{ directory: DIR, limit: 50 }]);
  });

  it('holds no text field and no checkbox (the acting pane’s markers are held out of the source by test/source-control-reads-only.test.ts)', async () => {
    serves();
    main.state.answers['scm.pr.state'] = () => ok(prStateOf({ branch: 'feature/x', pr: prOf({ checks: { summary: 'pass', items: [{ name: 'build', bucket: 'pass', state: 'SUCCESS', link: null, workflow: null }] } }) }));
    mount();
    await waitFor(() => expect(screen.queryByRole('button', { name: '1 passed' })).toBeTruthy());
    expect(screen.queryAllByRole('textbox')).toEqual([]);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(document.querySelectorAll('input, textarea, select')).toHaveLength(0);
    expect(screen.getAllByRole('button').every((button) => button.tagName === 'BUTTON')).toBe(true);
  });

  it('waits for the first git read with the quiet spinner, nothing for its first half second (the word cut, P211)', async () => {
    serves();
    main.state.answers['git.watch'] = () => new Promise(() => {});
    mount();
    await waitFor(() => expect(main.callsOf('git.watch')).toHaveLength(1));
    expect(text(document.querySelector('[data-scm-page]'))).toBe('');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(await screen.findByRole('progressbar', { name: 'Loading' }, { timeout: 2000 })).toBeTruthy();
    expect(parts()).toEqual([]);
  });

  it('says "Not a git repository" alone outside a repository', async () => {
    serves();
    main.state.watchError = NOT_A_REPOSITORY;
    mount();
    await waitFor(() => expect(text(document.querySelector('[data-scm-page]'))).toBe('Not a git repository'));
    expect(parts()).toEqual([]);
  });
});

describe('when the branch read is asked (S3; S21’s page half)', () => {
  it('on mount, on git.changed with head or refs, every two minutes in view, and when the page comes into view again; never out of view', async () => {
    serves();
    vi.useFakeTimers();
    const page = mount();
    const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
    await tick(0);
    expect(branchAsks()).toBe(1);
    act(() => main.emit('git.changed', { repoRoot: DIR, status: FEATURE, reason: 'head' }));
    await tick(0);
    expect(branchAsks()).toBe(2);
    act(() => main.emit('git.changed', { repoRoot: DIR, status: FEATURE, reason: 'refs' }));
    await tick(0);
    expect(branchAsks()).toBe(3);
    act(() => main.emit('git.changed', { repoRoot: DIR, status: FEATURE, reason: 'worktree' }));
    await tick(0);
    expect(branchAsks()).toBe(3);
    await tick(BRANCH_READ_EVERY_MS - 1);
    expect(branchAsks()).toBe(3);
    await tick(1);
    expect(branchAsks()).toBe(4);
    page.show(false);
    await tick(BRANCH_READ_EVERY_MS * 3);
    act(() => main.emit('git.changed', { repoRoot: DIR, status: FEATURE, reason: 'head' }));
    await tick(0);
    expect(branchAsks()).toBe(4);
    page.show(true);
    await tick(0);
    expect(branchAsks()).toBe(5);
  });

  it('shows a commit made in the checkout first under "Not pushed" with no reload, and under "Pushed to …" after a push', async () => {
    serves();
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(4));
    const made = branchCommitOf(0, false, { subject: 'Made in a terminal', authoredAt: new Date().toISOString() });
    main.state.branch = { ...branchCommitsOf({ all: 5, notPushed: 3 }), commits: [made, ...branchCommitsOf({ all: 4, notPushed: 2 }).commits] };
    act(() => main.emit('git.changed', { repoRoot: DIR, status: FEATURE, reason: 'head' }));
    await waitFor(() => expect(text(commitRows()[0])).toBe('Made in a terminal 0000bbb 1m'));
    expect(text(part('commits')!.querySelector('[data-scm-commit-group="not-pushed"]'))).toBe('Not pushed 3');
    main.state.branch = { ...branchCommitsOf({ all: 5, notPushed: 0 }), commits: [{ ...made, pushed: true }, ...branchCommitsOf({ all: 4, notPushed: 0 }).commits] };
    act(() => main.emit('git.changed', { repoRoot: DIR, status: FEATURE, reason: 'refs' }));
    await waitFor(() => expect([...part('commits')!.querySelectorAll('[data-scm-commit-group]')].map(text)).toEqual(['Pushed to origin/feature/x 5']));
  });
});

// The branch's max panel, ruling 1 (Decision Log 49): what a tab has loaded, it keeps. The list in hand stays shown when
// the machine stops serving the reads, by a disconnect or by no longer listing them; nothing is asked meanwhile, and the
// read is asked again once they are served
describe('the commit list in hand when the reads are lost (Decision Log 49)', () => {
  const losses: [string, Partial<MachineState>][] = [
    ['a disconnect', { state: 'down' }],
    ['the reads no longer listed', { capabilities: ['rl2.project-acts'] }],
  ];
  for (const [loss, lost] of losses)
    it(`keeps the list shown through ${loss}, asks nothing meanwhile, and asks once the reads are served again`, async () => {
      serves();
      mount();
      await waitFor(() => expect(commitRows()).toHaveLength(4));
      expect(branchAsks()).toBe(1);
      act(() => roster([lost]));
      await flush();
      expect(commitRows()).toHaveLength(4);
      expect(part('commits')?.querySelector('[data-scm-failure]')).toBeNull();
      act(() => main.emit('git.changed', { repoRoot: DIR, status: FEATURE, reason: 'head' }));
      await flush();
      expect(branchAsks()).toBe(1);
      act(() => serves());
      await waitFor(() => expect(branchAsks()).toBe(2));
      expect(commitRows()).toHaveLength(4);
    });
});

describe('the commit list and its rows (frames’ S1, S2, S12; S13’s row)', () => {
  it('says "Show 50 of 60 commits", then lists fifty with "10 older commits not shown" and "Show fewer" directly after', async () => {
    serves();
    main.state.branch = branchCommitsOf({ all: 60, notPushed: 2 });
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(8));
    fireEvent.click(screen.getByRole('button', { name: 'Show 50 of 60 commits' }));
    expect(commitRows()).toHaveLength(50);
    const older = part('commits')!.querySelector('[data-scm-older]')!;
    expect(text(older)).toBe('10 older commits not shown');
    expect(older.nextElementSibling).toBe(screen.getByRole('button', { name: 'Show fewer' }));
  });

  it('says "1 older commit not shown" for a branch of fifty-one, and no control for one of eight', async () => {
    serves();
    main.state.branch = branchCommitsOf({ all: 51, notPushed: 1 });
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(8));
    fireEvent.click(screen.getByRole('button', { name: 'Show 50 of 51 commits' }));
    expect(text(part('commits')!.querySelector('[data-scm-older]'))).toBe('1 older commit not shown');
    cleanup();
    useBranchReads.getState().reset();
    main.state.branch = branchCommitsOf({ all: 8, notPushed: 1 });
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(8));
    expect(part('commits')!.querySelector('[data-scm-commits-control]')).toBeNull();
  });

  it('"Show fewer" folds to eight rows and brings the Commits heading to the top of the scrolling part where the page can scroll that far', async () => {
    serves();
    main.state.branch = branchCommitsOf({ all: 30, notPushed: 2 });
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(8));
    fireEvent.click(screen.getByRole('button', { name: 'Show all 30 commits' }));
    const scroller = document.querySelector<HTMLElement>('[data-scm-scroll]')!;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 600 });
    scroller.scrollTop = 1400;
    vi.spyOn(reviewLayout, 'offsetWithin').mockImplementation((element) => (element.matches('[data-scm-commits-heading]') ? -1250 : 0)); // 150 px below the content's top
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(commitRows()).toHaveLength(8);
    expect(scroller.scrollTop).toBe(150);
  });

  it('moves nothing after "Show fewer" on a page that no longer scrolls', async () => {
    serves();
    main.state.branch = branchCommitsOf({ all: 12, notPushed: 2 });
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(8));
    fireEvent.click(screen.getByRole('button', { name: 'Show all 12 commits' }));
    const scroller = document.querySelector<HTMLElement>('[data-scm-scroll]')!;
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 500 });
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 600 });
    const writes: number[] = [];
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => 0, set: (value: number) => void writes.push(value) });
    fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(commitRows()).toHaveLength(8);
    expect(writes).toEqual([]);
  });

  it('makes the age column as wide as the widest age drawn, five characters for "1003d", right-aligned in tabular numerals', async () => {
    serves();
    const old = (n: number, days: number) => branchCommitOf(n, false, { authoredAt: new Date(Date.now() - days * 86_400_000 - 60_000).toISOString() });
    main.state.branch = { ...branchCommitsOf({ all: 3, notPushed: 3 }), commits: [branchCommitOf(1, false), old(2, 981), old(3, 1003)] };
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(3));
    const ages = commitRows().map((row) => row.querySelector<HTMLElement>('[data-scm-age]')!);
    expect(ages.map(text)).toEqual(['1h', '981d', '1003d']);
    expect(ages.map((age) => age.style.width)).toEqual(['5ch', '5ch', '5ch']);
    expect(ages.every((age) => age.classList.contains('tabular-nums') && age.classList.contains('text-right'))).toBe(true);
  });

  it('makes a row a button named "Open commit <sha7> in Review" that opens Review on the full hash, by Tab and Enter too', async () => {
    serves();
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(4));
    const row = screen.getByRole('button', { name: 'Open commit 0002bbb in Review' });
    expect(row).toBe(commitRows()[1]);
    expect(row.title).toContain('Ada Example');
    expect(row.title).toContain(shaOf(2));
    fireEvent.click(row);
    expect(review.created.map((init) => init.params)).toEqual([{ scope: 'commit', commit: shaOf(2) }]);
    const user = userEvent.setup();
    commitRows()[2]!.focus();
    await user.keyboard('{Enter}');
    expect(review.opens.map((open) => open.params)).toEqual([{ scope: 'commit', commit: shaOf(3) }]);
  });
});

describe('the links (S8; frames’ S8)', () => {
  it('opens Review on Uncommitted from Uncommitted’s "Review ›", and on This branch from the Commits heading’s', async () => {
    serves();
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(4));
    fireEvent.click(within(part('uncommitted')!).getByRole('button', { name: 'Review ›' }));
    fireEvent.click(within(part('commits')!).getByRole('button', { name: 'Review ›' }));
    expect([review.created[0]!.params, review.opens[0]!.params]).toEqual([{ scope: 'uncommitted' }, { scope: 'branch' }]);
  });

  it('reads "Uncommitted 0" with no button on a clean tree, and "· 1 conflict" whole for one', async () => {
    serves();
    main.state.status = statusOf({ ...FEATURE, dirty: false, files: [] });
    mount();
    await waitFor(() => expect(text(part('uncommitted'))).toBe('Uncommitted 0'));
    expect(within(part('uncommitted')!).queryByRole('button')).toBeNull();
    cleanup();
    useGit.setState({ entries: new Map() });
    main.state.status = statusOf({ ...FEATURE, files: [file('src/a.ts', 'U', 'U'), file('src/b.ts')] });
    mount();
    await waitFor(() => expect(text(part('uncommitted')?.querySelector('[data-scm-conflicts]'))).toBe('· 1 conflict'));
    expect(part('uncommitted')!.querySelector('[data-scm-conflicts]')!.className).toContain('text-danger');
  });

  it('with no base: "Commits · latest" (the word cut, N62: the Where line names the branch) and no "Review ›"; a group line only with an upstream, with no count; "Commits · latest" on a detached HEAD', async () => {
    serves();
    const rows = Array.from({ length: 10 }, (_, i) => branchCommitOf(i + 1, true));
    main.state.branch = { base: null, upstream: 'origin/feature/x', commits: rows, counts: null, behind: null };
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(8));
    expect(text(part('commits')!.querySelector('[data-scm-commits-heading]'))).toBe('Commits · latest');
    expect(within(part('commits')!).queryByRole('button', { name: 'Review ›' })).toBeNull();
    expect([...part('commits')!.querySelectorAll('[data-scm-commit-group]')].map(text)).toEqual(['Pushed to origin/feature/x']);
    cleanup();
    useGit.setState({ entries: new Map() });
    useBranchReads.getState().reset();
    main.state.status = statusOf({ ...FEATURE, branch: null, upstream: null });
    main.state.branch = { base: null, upstream: null, commits: rows.map((row) => ({ ...row, pushed: false })), counts: null, behind: null };
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(8));
    expect(text(part('commits')!.querySelector('[data-scm-commits-heading]'))).toBe('Commits · latest');
    expect(part('commits')!.querySelectorAll('[data-scm-commit-group]')).toHaveLength(0);
    expect(text(document.querySelector('[data-scm-where]'))).toBe(`detached at ${FEATURE.head.slice(0, 7)} · worktree`);
  });

  it('with no upstream, lists one group, "Not pushed"', async () => {
    serves();
    main.state.branch = branchCommitsOf({ all: 2, notPushed: 2, upstream: null, counts: { all: 2, notPushed: 2, pushed: 0 } });
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(2));
    expect([...part('commits')!.querySelectorAll('[data-scm-commit-group]')].map(text)).toEqual(['Not pushed 2']);
  });
});

describe('a failed read, told apart (S9; frames’ S9, S14)', () => {
  const failed = (code: string, message: string, issues?: Record<string, unknown>) => () => ({ ok: false as const, error: { code, message, ...(issues && { issues }) } });
  const sentence = () => text(part('commits')?.querySelector('[data-scm-failure]'));
  const refresh = () => part('commits')?.querySelector<HTMLButtonElement>('[data-scm-refresh]') ?? null;
  const otherParts = () => expect(parts()).toEqual(['uncommitted', 'commits', 'pr']);

  it('another machine that lists capabilities without the reads: "runs an older MAWS", nothing asked, no refresh', async () => {
    servesRemote({ capabilities: ['rl2.session-acts'] });
    mount(REMOTE);
    await waitFor(() => expect(sentence()).toBe('Unavailable: berth-mini runs an older MAWS'));
    expect(text(part('commits')!.querySelector('[data-scm-commits-heading]'))).toBe('Commits');
    expect(refresh()).toBeNull();
    expect(branchAsks()).toBe(0);
    await waitFor(() => expect(text(part('pr'))).toBe('Pull request No PR for feature/x'));
    otherParts();
  });

  it('this Mac’s service answering unknown_command: "Unavailable: this Mac’s MAWS service is older than this window" (N68: not the heading again), no refresh', async () => {
    serves();
    main.state.answers['git.branchCommits'] = failed('unknown_command', 'no such command');
    mount();
    await waitFor(() => expect(sentence()).toBe('Unavailable: this Mac’s MAWS service is older than this window'));
    expect(refresh()).toBeNull();
    await waitFor(otherParts);
  });

  it('an endpoint that does not offer the read (internal, not-offered): "runs an older MAWS", no refresh', async () => {
    servesRemote();
    main.state.answers['git.branchCommits'] = failed('internal', 'not offered', { refusal: 'not-offered' });
    mount(REMOTE);
    await waitFor(() => expect(sentence()).toBe('Unavailable: berth-mini runs an older MAWS'));
    expect(refresh()).toBeNull();
  });

  it('host_unavailable with nothing read: "Unavailable while <machine> is offline" (N69), whose refresh asks again', async () => {
    servesRemote();
    main.state.answers['git.branchCommits'] = failed('host_unavailable', 'the link dropped');
    mount(REMOTE);
    await waitFor(() => expect(sentence()).toBe('Unavailable while berth-mini is offline'));
    expect(branchAsks()).toBe(1);
    fireEvent.click(refresh()!);
    await waitFor(() => expect(branchAsks()).toBe(2));
    otherParts();
  });

  it('host_unavailable with something read: the last read stays and no error is drawn', async () => {
    servesRemote();
    mount(REMOTE);
    await waitFor(() => expect(commitRows()).toHaveLength(4));
    main.state.answers['git.branchCommits'] = failed('host_unavailable', 'the link dropped');
    act(() => main.emit('git.changed', { repoRoot: DIR, status: FEATURE, reason: 'head' }, OTHER_MACHINE));
    await waitFor(() => expect(branchAsks()).toBe(2));
    await flush();
    expect(commitRows()).toHaveLength(4);
    expect(sentence()).toBeNull();
  });

  it('another refusal: "Unavailable: <machine> refused" (N70), with no tooltip and a refresh', async () => {
    servesRemote();
    main.state.answers['git.branchCommits'] = failed('internal', 'refused', { refusal: 'no-target' });
    mount(REMOTE);
    await waitFor(() => expect(sentence()).toBe('Unavailable: berth-mini refused'));
    expect(part('commits')!.querySelector('[data-scm-failure]')!.hasAttribute('title')).toBe(false);
    expect(refresh()).not.toBeNull();
  });

  it('git’s failure: "Unavailable: <message>" (N71), breaking anywhere inside its box, with a refresh', async () => {
    serves();
    main.state.answers['git.branchCommits'] = () => fail('git rev-list failed: object file .git/objects/7e/0123456789abcdef is empty');
    mount();
    await waitFor(() => expect(sentence()).toBe('Unavailable: git rev-list failed: object file .git/objects/7e/0123456789abcdef is empty'));
    expect(part('commits')!.querySelector('[data-scm-failure]')!.className).toContain('wrap-anywhere');
    expect(refresh()).not.toBeNull();
  });

  it('draws the heading with no count and no rows while the first read is out, and after half a second the quiet spinner under it, named "Commits" (N63)', async () => {
    serves();
    main.state.answers['git.branchCommits'] = () => new Promise(() => {});
    mount();
    await waitFor(() => expect(branchAsks()).toBe(1));
    expect(text(part('commits'))).toBe('Commits');
    expect(commitRows()).toHaveLength(0);
    expect(within(part('commits')!).queryByRole('progressbar')).toBeNull();
    expect(await within(part('commits')!).findByRole('progressbar', { name: 'Commits' }, { timeout: 2000 })).toBeTruthy();
  });

  it('names the machine in the header, "· offline" after it while its link is down', async () => {
    servesRemote({ state: 'down', since: '2026-01-01T00:00:00.000Z' });
    mount(REMOTE);
    await waitFor(() => expect(text(document.querySelector('[data-scm-where]'))).toBe('⎇ feature/x · worktree · berth-mini · offline'));
  });
});

describe('the pull request (S5, S6, S10; frames’ S11)', () => {
  const check = (name: string, bucket: 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel', link: string | null = `https://github.com/o/r/actions/${name.replace(/\W/g, '-')}`) => ({ name, bucket, state: bucket.toUpperCase(), link, workflow: null });
  const scripted = (over: Parameters<typeof prOf>[0]) => (main.state.answers['scm.pr.state'] = () => ok(prStateOf({ branch: 'feature/x', pr: prOf(over) })));
  const checkRows = () => [...part('pr')!.querySelectorAll<HTMLElement>('[data-scm-check]')];

  it('reads the number, the title, the state line, the counts, the failed check first in the danger colour with its link, and folds the passed', async () => {
    serves();
    scripted({ title: 'Export the berths as CSV', reviewDecision: 'CHANGES_REQUESTED', checks: { summary: 'fail', items: [check('lint', 'pass'), check('integration', 'pending'), check('unit tests', 'fail'), check('types', 'pass'), check('build', 'pass')] } });
    mount();
    await waitFor(() => expect(part('pr')?.querySelector('[data-scm-pr-title]')).toBeTruthy());
    const pr = part('pr')!;
    expect(text(pr.querySelector('[data-scm-pr-heading]'))).toBe('Pull request #7');
    expect(text(pr.querySelector('[data-scm-pr-title]'))).toBe('Export the berths as CSV');
    // the word cut: an open pull request's state is not said (N72), and the counts line counts what it lists (N75)
    expect(text(pr.querySelector('[data-scm-pr-state]'))).toBe('into main · Changes requested');
    expect(text(pr.querySelector('[data-scm-checks]'))).toBe('Checks 1 failed · 1 pending');
    expect(checkRows().map((row) => text(row))).toEqual(['unit tests failed ↗', 'integration pending ↗']);
    expect(checkRows()[0]!.querySelector('[data-scm-check-word]')!.className).toContain('text-danger');
    expect(checkRows()[0]!.querySelector('[data-scm-dot]')!.className).toContain('bg-danger');
    const fold = screen.getByRole('button', { name: '3 passed' });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(within(checkRows()[0]!).getByRole('button', { name: 'Open unit tests on GitHub' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitHub ↗' }));
    await waitFor(() => expect(main.callsOf('layout.openExternal')).toEqual([{ url: 'https://github.com/o/r/actions/unit-tests' }, { url: 'https://github.com/o/r/pull/7' }]));
    fireEvent.click(fold);
    expect(checkRows().map((row) => text(row))).toEqual(['unit tests failed ↗', 'integration pending ↗', 'lint passed ↗', 'types passed ↗', 'build passed ↗']);
  });

  it('draws a cancelled row neutral, the opened fold’s rows in the answer’s order with a passed dot in the success token and a skipped in the neutral, and keeps a missing link’s place', async () => {
    serves();
    scripted({ mergeStateStatus: 'BLOCKED', checks: { summary: 'fail', items: [check('build', 'pass'), check('e2e (macOS)', 'cancel'), check('docs preview', 'skipping', null), check('integration', 'pending'), check('unit tests', 'pass')] } });
    mount();
    await waitFor(() => expect(checkRows()).toHaveLength(2));
    expect(text(part('pr')!.querySelector('[data-scm-pr-state]'))).toBe('into main · Merging is blocked');
    const cancelled = checkRows()[0]!;
    expect(text(cancelled)).toBe('e2e (macOS) cancelled ↗');
    expect(cancelled.querySelector('[data-scm-check-word]')!.className).not.toContain('text-danger');
    expect(cancelled.querySelector('[data-scm-dot]')!.className).toContain('bg-border-strong');
    fireEvent.click(screen.getByRole('button', { name: '2 passed · 1 skipped' }));
    expect(checkRows().slice(2).map((row) => text(row))).toEqual(['build passed ↗', 'docs preview skipped', 'unit tests passed ↗']);
    expect(checkRows()[2]!.querySelector('[data-scm-dot]')!.className).toContain('bg-success');
    const skipped = checkRows()[3]!;
    expect(skipped.querySelector('[data-scm-dot]')!.className).toContain('bg-border-strong');
    const place = skipped.querySelector('[data-scm-check-link]')!;
    expect(place.tagName).toBe('SPAN');
    expect(place.className).toContain('w-5');
  });

  // Decision Log 41: nothing to list, so no counts line; the folded line in its place lists the checks at a click
  it('with every check passed draws the folded line in the counts line’s place, and lists the checks at a click', async () => {
    serves();
    scripted({ checks: { summary: 'pass', items: [check('build', 'pass'), check('docs preview', 'skipping', null), check('lint', 'pass')] } });
    mount();
    const fold = await screen.findByRole('button', { name: '2 passed · 1 skipped' });
    expect(part('pr')!.querySelector('[data-scm-checks]')).toBeNull();
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(checkRows()).toHaveLength(0);
    fireEvent.click(fold);
    expect(checkRows().map((row) => text(row))).toEqual(['build passed ↗', 'docs preview skipped', 'lint passed ↗']);
  });

  // Decision Log 45: the part's first line opens with the muted "Checks" in every state, and "Checks" is drawn once
  const checksLines = () => [...part('pr')!.querySelectorAll<HTMLElement>('[data-scm-checks], [data-scm-fold-line]')].map((line) => text(line));
  const checksWords = () => (text(part('pr'))!.match(/Checks/g) ?? []).length;
  // The folded line's own text as it is copied (textContent, its spaces folded): `text` joins the text nodes with a space
  // and so cannot tell a space drawn from a gap between flex items
  const foldText = () => (part('pr')!.querySelector('[data-scm-fold-line]')!.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('with every check passed opens the folded line with "Checks", outside the fold’s button: "Checks › 5 passed", once', async () => {
    serves();
    scripted({ checks: { summary: 'pass', items: ['build', 'lint', 'types', 'unit tests', 'docs'].map((name) => check(name, 'pass')) } });
    mount();
    const fold = await screen.findByRole('button', { name: '5 passed' });
    expect(checksLines()).toEqual(['Checks › 5 passed']);
    expect(foldText()).toBe('Checks › 5 passed');
    expect(checksWords()).toBe(1);
    expect(fold.textContent).not.toContain('Checks');
    const label = part('pr')!.querySelector('[data-scm-fold-line] [data-scm-checks-label]')!;
    expect(label.className).toContain('text-fg-muted');
  });

  it('with the checks passed or skipped reads "Checks › 3 passed · 1 skipped" on one line, "Checks" once', async () => {
    serves();
    scripted({ checks: { summary: 'pass', items: [check('build', 'pass'), check('lint', 'pass'), check('docs preview', 'skipping', null), check('types', 'pass')] } });
    mount();
    await screen.findByRole('button', { name: '3 passed · 1 skipped' });
    expect(checksLines()).toEqual(['Checks › 3 passed · 1 skipped']);
    expect(checksWords()).toBe(1);
  });

  it('with one check failed beside the passed draws "Checks" once, on the counts line, and the folded line under it without it', async () => {
    serves();
    scripted({ checks: { summary: 'fail', items: [check('build', 'pass'), check('unit tests', 'fail'), check('lint', 'pass'), check('types', 'pass')] } });
    mount();
    await screen.findByRole('button', { name: '3 passed' });
    expect(checksLines()).toEqual(['Checks 1 failed', '› 3 passed']);
    expect(foldText()).toBe('› 3 passed');
    expect(checksWords()).toBe(1);
  });

  it('reads "Merged · into main" with no checks, and words a merge state GitHub adds later under the line, "Merge state: <value>" (N74)', async () => {
    serves();
    scripted({ state: 'MERGED', mergeStateStatus: 'CLEAN', checks: { summary: 'pass', items: [check('build', 'pass')] } });
    mount();
    await waitFor(() => expect(text(part('pr')?.querySelector('[data-scm-pr-state]'))).toBe('Merged · into main'));
    expect(part('pr')!.querySelector('[data-scm-checks]')).toBeNull();
    cleanup();
    queryClient.clear();
    scripted({ mergeStateStatus: 'QUEUED' });
    mount();
    await waitFor(() => expect(text(part('pr')?.querySelector('[data-scm-merge-unknown]'))).toBe('Merge state: QUEUED'));
    expect(text(part('pr')!.querySelector('[data-scm-pr-state]'))).toBe('into main');
  });

  it('breaks the state line only between its phrases, each phrase whole', async () => {
    serves();
    scripted({ reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN' });
    mount();
    await waitFor(() => expect(part('pr')?.querySelector('[data-scm-pr-state]')).toBeTruthy());
    const phrases = [...part('pr')!.querySelectorAll<HTMLElement>('[data-scm-pr-state] [data-scm-phrase]')];
    expect(phrases.map(text)).toEqual(['into main ·', 'Approved ·', 'Ready to merge']);
    expect(phrases.every((phrase) => phrase.className.includes('whitespace-nowrap'))).toBe(true);
    expect(phrases[2]!.className).toContain('text-success');
  });

  it('in an untrusted folder draws the first three parts, says "Trust this folder to see PR state", and asks no PR state', async () => {
    serves();
    main.state.scm = scmStatusOf({ trusted: false, gh: READY_GH });
    mount();
    await waitFor(() => expect(text(part('pr'))).toBe('Pull request Trust this folder to see PR state'));
    expect(parts()).toEqual(['uncommitted', 'commits', 'pr']);
    expect(main.callsOf('scm.pr.state')).toEqual([]);
  });

  it('with no remote on GitHub has no Pull request part', async () => {
    serves();
    main.state.answers['scm.pr.state'] = () => ok(prStateOf({ branch: 'feature/x', error: 'no_remote' }));
    mount();
    await waitFor(() => expect(commitRows()).toHaveLength(4));
    await waitFor(() => expect(main.callsOf('scm.pr.state').length).toBeGreaterThan(0));
    await flush();
    expect(parts()).toEqual(['uncommitted', 'commits']);
  });

  it('says the GitHub CLI is missing with Install, naming the machine when it is not this Mac', async () => {
    servesRemote();
    main.state.scm = scmStatusOf({ gh: { state: 'missing' } });
    main.state.answers['scm.pr.state'] = () => ok(prStateOf({ branch: 'feature/x', gh: { state: 'missing' }, error: 'gh_missing' }));
    mount(REMOTE);
    await waitFor(() => expect(text(part('pr'))).toBe('Pull request GitHub CLI not installed on berth-mini · Install'));
  });

  it('on another machine signed out: Sign in by the shell right, the second line without it, and neither while the rights are not known', async () => {
    const signedOut = scmStatusOf({ gh: { state: 'unauthenticated', path: '/usr/local/bin/gh', version: '2.97.0', detail: 'gh auth status: not logged in' } });
    main.state.answers['scm.pr.state'] = () => ok(prStateOf({ branch: 'feature/x', gh: signedOut.gh, error: 'gh_unauthenticated' }));
    const lines = () => [...part('pr')!.querySelectorAll('[data-scm-pr-line]')].map(text);
    servesRemote({ rights: ['spawn', 'shell'] });
    main.state.scm = signedOut;
    mount(REMOTE);
    await waitFor(() => expect(lines()).toEqual(['GitHub CLI not signed in on berth-mini · Sign in']));
    cleanup();
    queryClient.clear();
    servesRemote({ rights: ['spawn'] });
    mount(REMOTE);
    await waitFor(() => expect(lines()).toEqual(['GitHub CLI not signed in on berth-mini', 'Signing in needs shell access on berth-mini']));
    expect(within(part('pr')!).queryByRole('button', { name: 'Sign in' })).toBeNull();
    cleanup();
    queryClient.clear();
    servesRemote();
    mount(REMOTE);
    await waitFor(() => expect(lines()).toEqual(['GitHub CLI not signed in on berth-mini']));
  });
});

describe('what gives way where a line lacks room (frames’ S4, S6), through the measure seam', () => {
  const where = () => document.querySelector<HTMLElement>('[data-scm-where]')!;
  const WIDTHS = { '[data-scm-measure="branch"]': 160, '[data-scm-measure="branch-min"]': 70, '[data-scm-measure="worktree"]': 60, '[data-scm-measure="machine"]': 110 };
  const shape = () => ({
    branch: where().querySelector<HTMLElement>('[data-scm-where-branch]')!.style.minWidth,
    worktree: where().querySelector('[data-scm-where-worktree]') !== null,
    below: text(where().querySelector('[data-scm-where-below]')),
  });

  it('the Where line: the branch to eight characters first, then "· worktree" out, then the machine’s label with "· offline" on a second line, never cut', async () => {
    servesRemote({ state: 'down', since: '2026-01-01T00:00:00.000Z' });
    const at = async (room: number) => {
      measures(WIDTHS, { '[data-scm-where]': room });
      const page = mount(REMOTE);
      await waitFor(() => expect(where().querySelector('[data-scm-where-branch]')).not.toBeNull());
      await flush();
      const seen = shape();
      page.unmount();
      vi.restoreAllMocks();
      return seen;
    };
    expect(await at(400)).toEqual({ branch: '', worktree: true, below: null });
    expect(await at(300)).toEqual({ branch: '70px', worktree: true, below: null });
    expect(await at(200)).toEqual({ branch: '70px', worktree: false, below: null });
    expect(await at(150)).toEqual({ branch: '70px', worktree: false, below: 'berth-mini · offline' });
    measures(WIDTHS, { '[data-scm-where]': 150 });
    mount(REMOTE);
    await waitFor(() => expect(where().querySelector('[data-scm-where-below]')).not.toBeNull());
    expect(where().querySelector('[data-scm-where-below]')!.className).toContain('wrap-anywhere');
  });

  it('never shortens a detached HEAD’s words', async () => {
    serves();
    main.state.status = statusOf({ ...FEATURE, branch: null, upstream: null });
    measures({ ...WIDTHS, '[data-scm-measure="branch"]': 120, '[data-scm-measure="branch-min"]': 120 }, { '[data-scm-where]': 150 });
    mount();
    await waitFor(() => expect(where().querySelector('[data-scm-where-branch]')).not.toBeNull());
    await flush();
    expect(shape()).toEqual({ branch: '', worktree: false, below: null });
    expect(where().querySelector('[data-scm-where-branch]')!.className).not.toContain('truncate');
  });

  it('Uncommitted leaves its "+A −R" out whole before anything of the conflicts', async () => {
    serves();
    main.state.status = statusOf({ ...FEATURE, files: [file('src/a.ts', 'U', 'U'), file('src/b.ts', 'U', 'U'), file('src/c.ts')] });
    measures({ '[data-scm-uncommitted] [data-scm-fixed]': 60, '[data-scm-measure="counts"]': 70, '[data-scm-measure="conflicts"]': 80 }, { '[data-scm-uncommitted]': 250 });
    mount();
    await waitFor(() => expect(text(part('uncommitted')?.querySelector('[data-scm-conflicts]'))).toBe('· 2 conflicts'));
    await flush();
    expect(part('uncommitted')!.querySelector('[data-scm-counts]')).toBeNull();
    expect(part('uncommitted')!.querySelector('[data-scm-conflicts]')!.className).toContain('whitespace-nowrap');
  });

  // The measure seam with a count's badge as wide as its digits (10 px each), so a count that gains a digit widens its
  // line's fixed part at the same room
  const measuresDigits = (widths: Record<string, number>, rooms: Record<string, number>) => {
    measures(widths, rooms);
    vi.spyOn(reviewLayout, 'width').mockImplementation((element) => (element.matches('[data-scm-count]') ? 10 * (element.textContent ?? '').length : (Object.entries(widths).find(([selector]) => element.matches(selector))?.[1] ?? 0)));
  };

  it('measures the Commits heading again when its count gains a digit at the same room: "since <base>" shortened at 9 commits, left out at 10', async () => {
    serves();
    main.state.branch = branchCommitsOf({ all: 9, notPushed: 1, behind: 3 });
    measuresDigits({ '[data-scm-commits-heading] [data-scm-fixed]': 50, '[data-scm-measure="since"]': 120, '[data-scm-measure="since-min"]': 90, '[data-scm-measure="behind"]': 70 }, { '[data-scm-commits-heading]': 275 });
    mount();
    const heading = () => part('commits')!.querySelector('[data-scm-commits-heading]')!;
    await waitFor(() => expect(text(heading().querySelector('[data-scm-count]'))).toBe('9'));
    await flush();
    expect(heading().querySelector<HTMLElement>('[data-scm-since]')?.dataset.fit).toBe('shortened');
    main.state.branch = branchCommitsOf({ all: 10, notPushed: 1, behind: 3 });
    act(() => main.emit('git.changed', { repoRoot: DIR, status: FEATURE, reason: 'head' }));
    await waitFor(() => expect(text(heading().querySelector('[data-scm-count]'))).toBe('10'));
    await flush();
    expect(heading().querySelector('[data-scm-since]')).toBeNull();
    expect(text(heading().querySelector('[data-scm-behind]'))).toBe('· 3 behind');
  });

  it('measures Uncommitted again when its file count gains a digit at the same room: "+A −R" drawn at 9 files, left out at 10', async () => {
    serves();
    const files = (n: number) => Array.from({ length: n }, (_, i) => file(`src/f${i}.ts`));
    main.state.status = statusOf({ ...FEATURE, files: files(9) });
    measuresDigits({ '[data-scm-uncommitted] [data-scm-fixed]': 60, '[data-scm-measure="counts"]': 70 }, { '[data-scm-uncommitted]': 205 });
    mount();
    const line = () => part('uncommitted')!.querySelector('[data-scm-uncommitted]')!;
    await waitFor(() => expect(text(line().querySelector('[data-scm-counts]'))).toBe('+48 −12'));
    await flush();
    expect(text(line().querySelector('[data-scm-count]'))).toBe('9');
    const ten = statusOf({ ...FEATURE, files: files(10) });
    main.state.status = ten;
    act(() => main.emit('git.changed', { repoRoot: DIR, status: ten, reason: 'worktree' }));
    await waitFor(() => expect(text(line().querySelector('[data-scm-count]'))).toBe('10'));
    await flush();
    expect(line().querySelector('[data-scm-counts]')).toBeNull();
  });

  it('the Commits heading shortens its base with "· N behind" whole, and leaves "since <base>" out whole where even that does not fit', async () => {
    serves();
    main.state.branch = branchCommitsOf({ all: 12, notPushed: 1, behind: 3 });
    const at = async (room: number) => {
      measures({ '[data-scm-commits-heading] [data-scm-fixed]': 50, '[data-scm-measure="since"]': 120, '[data-scm-measure="since-min"]': 90, '[data-scm-measure="behind"]': 70 }, { '[data-scm-commits-heading]': room });
      const page = mount();
      await waitFor(() => expect(commitRows()).toHaveLength(8));
      await flush();
      const heading = part('commits')!.querySelector('[data-scm-commits-heading]')!;
      const seen = { since: heading.querySelector<HTMLElement>('[data-scm-since]')?.dataset.fit ?? null, behind: text(heading.querySelector('[data-scm-behind]')) };
      page.unmount();
      vi.restoreAllMocks();
      return seen;
    };
    expect(await at(400)).toEqual({ since: 'whole', behind: '· 3 behind' });
    expect(await at(330)).toEqual({ since: 'shortened', behind: '· 3 behind' });
    expect(await at(250)).toEqual({ since: null, behind: '· 3 behind' });
  });
});
