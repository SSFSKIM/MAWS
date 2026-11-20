// The Files tool (C8c execution document, M2): the tree's pure model, the listing store over a fake X2 client, and the
// tool over C8a's host. UX wave U6b-1 (M2): a file beside the chat as an editor; (M3) the tree at the file's left.
import { isolateHistory, undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { FilesEntry } from '@shared/ipc/schema/files';
import { FilesTreeSchema } from '@shared/ipc/schema/layout';
import type { SessionRecord } from '@shared/graph/session';
import { addressOf, bareOf } from '@shared/machine/address';
import type { MachineState } from '@shared/ipc/schema/machines';
import { record } from '../../../../../../test/support/builders';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../../../test/support/machine';
import { connectCodeEvents } from '../../../ipc/events';
import { panelHost, registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { useMachines } from '../../../stores/machines';
import { deferred, fail, installFakeMain, ok as answer } from '../../../test-support/code';
import { installDisk, leaveRl2, overRl2, rosterSays } from '../../../test-support/code-disk';
import { resetRemoteLaneBStore } from '../../../lane-b/remote-session'; // UX wave U6f
import { A, B, mainShowing, panelOf, resetPanelStores, TestHost } from '../../../test-support/panel';
import { focusedFile, registerEditor, sideFilesViewer } from '../editor/register';
import { openFile, resetKeptOpens } from '../open-file';
import { existingViewState, useViewer, VIEWER_ENTRIES_MAX } from '../viewer/viewer-store';
import { filesTool } from './FilesTool';
import { useFiles, WATCH_GRACE_MS } from './store';
import { FILE_WIDTH_MIN, resetTreeState, treeOf, TREE_WIDTH_DEFAULT, TREE_WIDTH_MIN, useTreeState } from './tree-state';
import { installResizeObserver } from '../../../test-support/resize';
import { connectSideFiles } from './tabs';
import { dirname, expandTo, hidden, joinPath, roleOf, rootsFor, rowsOf, sameFile, type Listing } from './tree';
import { activeTab, allTabs, currentSet } from '../../../stores/layout-model';
import { useSetup } from '../../../sessions/store'; // E11
import { FILES_COPY } from '../copy'; // E11

// P5 O6 M2: the page's ids (S, and the panel's A and B) are addresses; the fake main is asked and emits with bare ids.
const MAIN_S = 'app-a' as AppSessionId;
const S = at(MAIN_S);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const dir = (path: string): FilesEntry => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'dir', size: 0, mtimeMs: 0, target: null });
const file = (path: string): FilesEntry => ({ ...dir(path), kind: 'file', size: 10 });
const ok = (path: string, entries: FilesEntry[], truncated = false): Listing => ({ status: 'ok', value: { root: null, path, entries, truncated } });

describe('files tree', () => {
  it('derives the root candidates in record order with their roles, the worktree only when it differs', () => {
    const r = record('a', { directory: '/repo', additionalDirectories: ['/docs', '/repo'], worktree: { path: '/wt', branch: 'x' } });
    expect(rootsFor(r)).toEqual([
      { path: '/repo', role: 'directory' },
      { path: '/docs', role: 'additional directory' },
      { path: '/wt', role: 'worktree' },
    ]);
    expect(rootsFor(record('a', { directory: '/repo', worktree: { path: '/repo', branch: null } }))).toEqual([{ path: '/repo', role: 'directory' }]);
  });

  // UX wave U8c-2, M3 (§G): the launch folder and the working folder a fact names are candidates too, after the record's
  // own, in the service's order (it lists them only while the admission holds); a session that has not moved has none.
  // M4 decision 4: while the session is moved, the working folder is labelled `working folder` and the launch folder
  // `directory`, whatever today's rule would call them, on both kinds of move.
  it('adds the launch folder and the working folder a fact names as candidates, each once, labelled as moved', () => {
    const cd = record('a', { directory: '/repo', agentFolder: { checkout: '/repo-wt', cwd: '/repo-wt/src', branch: 'w', linked: true } });
    expect(rootsFor(cd)).toEqual([
      { path: '/repo', role: 'directory' },
      { path: '/repo-wt', role: 'working folder' },
    ]);
    const tool = record('a', { directory: '/repo/.claude/worktrees/w1', worktree: { path: '/repo/.claude/worktrees/w1', branch: 'w1' }, launchFolder: '/repo' });
    expect(rootsFor(tool)).toEqual([
      { path: '/repo/.claude/worktrees/w1', role: 'working folder' },
      { path: '/repo', role: 'directory' },
    ]);
    const toolInside = record('a', { directory: '/repo/.claude/worktrees/w1/src', worktree: { path: '/repo/.claude/worktrees/w1', branch: 'w1' }, launchFolder: '/repo' });
    expect(rootsFor(toolInside)).toEqual([
      { path: '/repo/.claude/worktrees/w1/src', role: 'directory' },
      { path: '/repo/.claude/worktrees/w1', role: 'working folder' },
      { path: '/repo', role: 'directory' },
    ]);
    const filed = record('a', { directory: '/repo/.claude/worktrees/w1', worktree: { path: '/repo/.claude/worktrees/w1', branch: 'w1' } });
    expect(rootsFor(filed)).toEqual([{ path: '/repo/.claude/worktrees/w1', role: 'directory' }]); // not moved: today's labels
    const inside = record('a', { directory: '/repo/sub', agentFolder: { checkout: '/repo', cwd: '/repo/sub', branch: 'main', linked: false } });
    expect(rootsFor(inside).map((c) => c.path)).toEqual(['/repo/sub', '/repo']);
  });

  it('matches a root realpath to its record entry through /tmp and case', () => {
    const candidates = [
      { path: '/tmp/Repo', role: 'directory' as const },
      { path: '/Users/new/developer/wt', role: 'worktree' as const },
    ];
    expect(roleOf('/private/tmp/Repo', candidates)).toBe('directory');
    expect(roleOf('/Users/new/Developer/wt', candidates)).toBe('worktree');
    expect(roleOf('/elsewhere', candidates)).toBeNull();
    expect(sameFile('/private/tmp/a/b.ts', '/tmp/a/b.ts')).toBe(true);
    expect(sameFile('/private/var/folders/x', '/var/folders/x')).toBe(true);
    expect(sameFile('/repo2/a', '/repo/a')).toBe(false);
  });

  it('never takes a path for another that merely ends like it (the only alias is /private)', () => {
    expect(sameFile('/Users/new/work/app/config.ts', '/app/config.ts')).toBe(false);
    expect(sameFile('/x/private/tmp/a', '/tmp/a')).toBe(false);
    expect(sameFile('/private/tmp/a', 'tmp/a')).toBe(false);
    expect(expandTo(['/Users/new/work/app'], '/app/config.ts')).toBeNull();
    expect(expandTo(['/Users/new/work/app'], '/work/app/config.ts')).toBeNull();
    expect(roleOf('/Users/new/work/app', [{ path: '/app', role: 'directory' }])).toBeNull();
  });

  it('hides .git only as a root direct child', () => {
    expect(hidden(dir('/r/.git'), true)).toBe(true);
    expect(hidden(file('/r/sub/.git'), false)).toBe(false); // a submodule's .git file is information
    expect(hidden(file('/r/.env'), true)).toBe(false); // dotfiles shown
  });

  it('expands every ancestor of a path under its root, through a spelling of the root the realpath does not share', () => {
    expect(expandTo(['/private/tmp/r', '/w'], '/tmp/r/src/app/main.ts')).toEqual({
      root: '/private/tmp/r',
      path: '/private/tmp/r/src/app/main.ts',
      ancestors: ['/private/tmp/r', '/private/tmp/r/src', '/private/tmp/r/src/app'],
    });
    expect(expandTo(['/r', '/r/nested'], '/r/nested/x.ts')?.root).toBe('/r/nested'); // the most specific root
    expect(expandTo(['/r'], '/r')).toEqual({ root: '/r', path: '/r', ancestors: [] });
    expect(expandTo(['/r'], '/r2/x.ts')).toBeNull();
    expect(dirname('/r/a/b.ts')).toBe('/r/a');
    expect(dirname('/r')).toBe('/');
    expect(joinPath('/', 'r')).toBe('/r');
  });

  it('flattens the roots and the expanded listings into rows, with notices under a directory', () => {
    const roots = [dir('/r'), dir('/w')];
    const listings = new Map<string, Listing>([
      ['/r', ok('/r', [dir('/r/.git'), dir('/r/src'), dir('/r/empty'), { ...file('/r/link'), kind: 'symlink', target: '/etc/hosts' }, file('/r/.env')])],
      ['/r/src', ok('/r/src', [file('/r/src/a.ts')], true)],
      ['/r/empty', ok('/r/empty', [])],
      ['/w', { status: 'error', message: "path outside the session's directories", failure: { code: 'internal', message: "path outside the session's directories", refusal: null } }],
    ]);
    const rows = rowsOf({ roots, listing: (path) => listings.get(path), expanded: new Set(['/r', '/r/src', '/r/empty', '/w']), roles: new Map([['/r', 'directory' as const]]) });
    expect(rows.map((row) => [row.kind, row.depth, row.kind === 'notice' ? row.notice : row.path])).toEqual([
      ['root', 0, '/r'],
      ['entry', 1, '/r/src'],
      ['entry', 2, '/r/src/a.ts'],
      ['notice', 2, 'truncated'],
      ['entry', 1, '/r/empty'],
      ['notice', 2, 'empty'],
      ['entry', 1, '/r/link'],
      ['entry', 1, '/r/.env'],
      ['root', 0, '/w'],
      ['notice', 1, 'refused'],
    ]);
    expect(rows[0]).toMatchObject({ role: 'directory', expanded: true, name: 'r' });
    expect(rows[8]).toMatchObject({ role: null });
  });

  it('shows a failed listing as its message and nothing while a first listing loads', () => {
    const rows = rowsOf({
      roots: [dir('/r'), dir('/s')],
      listing: (path) => (path === '/r' ? { status: 'error', message: 'not found: /r', failure: { code: 'internal', message: 'not found: /r', refusal: null } } : { status: 'loading' }),
      expanded: new Set(['/r', '/s']),
      roles: new Map(),
    });
    expect(rows.map((row) => (row.kind === 'notice' ? [row.notice, row.message] : row.path))).toEqual(['/r', ['error', 'not found: /r'], '/s']);
  });
});

// A directory answered from a table: path → entries (or a failure message).
// The panel's summary, drawn before a tool is selected, reads too: answered quietly.
const QUIET: Partial<Record<string, ReturnType<typeof answer>>> = {
  'layout.get': answer({ value: null }),
  'layout.set': answer(), // UX wave U6b-1 (M3): the tree's state, written after a person's act
  'git.watch': fail('not a git repository'),
  'git.unwatch': answer(),
  'fs.workflows': answer({ runs: [] }),
  'layout.openFile': answer({ status: 'cancelled' }), // UX wave U6e: the chooser, cancelled
};

function mainWith(tree: Record<string, FilesEntry[] | string>) {
  return installFakeMain((name, input) => {
    if (QUIET[name]) return QUIET[name];
    if (name === 'files.watch' || name === 'files.unwatch') return answer();
    if (name === 'files.list') {
      const path = (input.path as string | undefined) ?? '';
      const found = tree[path];
      if (found === undefined) return fail(`not found: ${path}`);
      if (typeof found === 'string') return fail(found);
      return answer({ root: path === '' ? null : '/r', path, entries: found, truncated: false });
    }
    return fail(`unexpected ${name}`);
  });
}

describe('files store', () => {
  beforeEach(() => useFiles.getState().reset());
  afterEach(() => vi.useRealTimers());

  it('lists a directory once while a listing is in flight and keeps the last answer during a re-list', async () => {
    const main = mainWith({ '/r': [file('/r/a.ts')] });
    useFiles.getState().list(S, '/r');
    expect(useFiles.getState().listing(S, '/r')).toEqual({ status: 'loading' });
    useFiles.getState().list(S, '/r');
    await flush();
    expect(main.callsOf('files.list')).toHaveLength(2); // the first, then once more for the call that arrived meanwhile
    expect(useFiles.getState().listing(S, '/r')).toMatchObject({ status: 'ok', value: { entries: [file('/r/a.ts')] } });
  });

  it('applyChanged re-lists exactly the directory named by the event and no other', async () => {
    const main = mainWith({ '/r': [dir('/r/src')], '/r/src': [file('/r/src/a.ts')], '/r/other': [] });
    for (const path of ['/r', '/r/src', '/r/other']) useFiles.getState().list(S, path);
    await flush();
    main.calls.splice(0);
    useFiles.getState().applyChanged({ appSessionId: S, path: '/r/src/a.ts', kind: 'changed' });
    useFiles.getState().applyChanged({ appSessionId: at('app-b' as AppSessionId), path: '/r/other/x', kind: 'created' }); // another session's
    await flush();
    expect(main.callsOf('files.list')).toEqual([{ appSessionId: MAIN_S, path: '/r/src' }]);
  });

  // UX wave U6b-3a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, decision 14 (a)): a change of an
  // entry called `.gitignore` lists again every listing the session holds at or beneath its directory, and no other
  it('applyChanged of a .gitignore re-lists every listing at or beneath its directory, and no other', async () => {
    const tree = { '/r': [dir('/r/src')], '/r/src': [dir('/r/src/deep')], '/r/src/deep': [], '/r/srcs': [], '/r/other': [] };
    const main = mainWith(tree);
    for (const path of Object.keys(tree)) useFiles.getState().list(S, path);
    useFiles.getState().list(at('app-b' as AppSessionId), '/r/src/deep'); // another session's listing
    await flush();
    main.calls.splice(0);
    useFiles.getState().applyChanged({ appSessionId: S, path: '/r/src/.gitignore', kind: 'changed' });
    await flush();
    expect(main.callsOf('files.list').map((input) => input.path).sort()).toEqual(['/r/src', '/r/src/deep']);
    main.calls.splice(0);
    useFiles.getState().applyChanged({ appSessionId: S, path: '/r/src/.gitignored-not', kind: 'changed' }); // the control: another name lists its directory alone
    await flush();
    expect(main.callsOf('files.list').map((input) => input.path)).toEqual(['/r/src']);
    main.calls.splice(0);
    useFiles.getState().applyChanged({ appSessionId: S, path: '/r/.gitignore', kind: 'created' });
    await flush();
    expect(main.callsOf('files.list').map((input) => input.path).sort()).toEqual(['/r', '/r/other', '/r/src', '/r/src/deep', '/r/srcs']);
  });

  it('counts watches per directory, installs once and unwatches only after the grace', async () => {
    vi.useFakeTimers();
    const main = mainWith({ '/r': [] });
    const one = useFiles.getState().watch(S, '/r');
    const two = useFiles.getState().watch(S, '/r');
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('files.watch')).toEqual([{ appSessionId: MAIN_S, path: '/r' }]);
    one.release();
    two.release();
    await vi.advanceTimersByTimeAsync(WATCH_GRACE_MS - 1);
    const again = useFiles.getState().watch(S, '/r'); // a quick re-expand inside the grace does not churn
    await vi.advanceTimersByTimeAsync(WATCH_GRACE_MS);
    expect(main.callsOf('files.watch')).toHaveLength(1);
    expect(main.callsOf('files.unwatch')).toHaveLength(0);
    again.release();
    await vi.advanceTimersByTimeAsync(WATCH_GRACE_MS);
    expect(main.callsOf('files.unwatch')).toEqual([{ appSessionId: MAIN_S, path: '/r' }]);
  });

  it('drops a listing when its watch is finally released, so it is listed afresh on the next expand', async () => {
    vi.useFakeTimers();
    mainWith({ '/r': [] });
    const hold = useFiles.getState().watch(S, '/r');
    useFiles.getState().list(S, '/r');
    await vi.advanceTimersByTimeAsync(0);
    expect(useFiles.getState().listing(S, '/r')).toMatchObject({ status: 'ok' });
    hold.release();
    await vi.advanceTimersByTimeAsync(WATCH_GRACE_MS);
    expect(useFiles.getState().listing(S, '/r')).toBeUndefined();
    expect(useFiles.getState().holders(S, '/r')).toBe(0);
  });

  it('does not put back a listing whose answer arrives after the grace dropped it', async () => {
    vi.useFakeTimers();
    const gate = deferred<void>();
    installFakeMain(async (name, input) => {
      if (name === 'files.list') {
        await gate.promise;
        return answer({ root: '/r', path: input.path, entries: [], truncated: false });
      }
      return answer();
    });
    const hold = useFiles.getState().watch(S, '/r');
    await vi.advanceTimersByTimeAsync(0); // installed
    useFiles.getState().list(S, '/r'); // in flight, held at the gate
    hold.release();
    await vi.advanceTimersByTimeAsync(WATCH_GRACE_MS);
    expect(useFiles.getState().listing(S, '/r')).toBeUndefined();
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(useFiles.getState().listing(S, '/r')).toBeUndefined();
  });

  it('unwatches a watch whose grace ran out while main was still installing it, once the install answers', async () => {
    vi.useFakeTimers();
    const gate = deferred<void>();
    const main = installFakeMain(async (name) => {
      if (name === 'files.watch') await gate.promise;
      return answer();
    });
    const hold = useFiles.getState().watch(S, '/r');
    hold.release();
    await vi.advanceTimersByTimeAsync(WATCH_GRACE_MS);
    expect(main.callsOf('files.unwatch')).toHaveLength(0);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('files.unwatch')).toEqual([{ appSessionId: MAIN_S, path: '/r' }]);
  });

  it('lists a directory whose watch is installing only once the watch has answered, so no change is missed in between', async () => {
    const gate = deferred<void>();
    const main = installFakeMain(async (name, input) => {
      if (name === 'files.watch') await gate.promise;
      if (name === 'files.list') return answer({ root: '/r', path: input.path, entries: [], truncated: false });
      return answer();
    });
    const hold = useFiles.getState().watch(S, '/r');
    useFiles.getState().list(S, '/r');
    await flush();
    expect(main.callsOf('files.list')).toHaveLength(0);
    gate.resolve();
    await hold.ready;
    await flush();
    expect(main.callsOf('files.list')).toHaveLength(1);
  });

  it('re-lists once right after a watch installs over a directory already listed', async () => {
    const main = mainWith({ '/r': [] });
    useFiles.getState().list(S, '/r');
    await flush();
    const hold = useFiles.getState().watch(S, '/r');
    await hold.ready;
    await flush();
    expect(main.callsOf('files.list')).toHaveLength(2);
  });

  it('on invalidated drops the listing and the watch, then re-watches and re-lists a held directory', async () => {
    const main = mainWith({ '/r': [file('/r/a.ts')] });
    const hold = useFiles.getState().watch(S, '/r');
    useFiles.getState().list(S, '/r');
    await hold.ready;
    await flush();
    main.calls.splice(0);
    useFiles.getState().applyChanged({ appSessionId: S, path: '/r', kind: 'invalidated' });
    expect(useFiles.getState().listing(S, '/r')).toEqual({ status: 'loading' });
    await hold.ready;
    await flush();
    expect(main.calls.map((c) => c.name)).toEqual(['files.watch', 'files.list']);
    expect(useFiles.getState().listing(S, '/r')).toMatchObject({ status: 'ok' });
  });

  it('re-watches a directory invalidated while its watch installs once that install answers, so main keeps one hold for it', async () => {
    vi.useFakeTimers();
    const gate = deferred<void>();
    let firstWatch = true;
    const main = installFakeMain(async (name, input) => {
      if (name === 'files.watch' && firstWatch) {
        firstWatch = false;
        await gate.promise;
      }
      if (name === 'files.list') return answer({ root: '/r', path: input.path, entries: [], truncated: false });
      return answer();
    });
    const hold = useFiles.getState().watch(S, '/r');
    useFiles.getState().list(S, '/r');
    useFiles.getState().applyChanged({ appSessionId: S, path: '/r', kind: 'invalidated' });
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('files.watch')).toHaveLength(1); // no second install while the first is in flight
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    await hold.ready;
    // Main may have counted the first install before it dropped the watch: its hold is given back before the re-watch.
    expect(main.calls.map((c) => c.name)).toEqual(['files.watch', 'files.unwatch', 'files.watch', 'files.list']);
    expect(useFiles.getState().listing(S, '/r')).toMatchObject({ status: 'ok' });
    hold.release();
    await vi.advanceTimersByTimeAsync(WATCH_GRACE_MS);
    expect(main.callsOf('files.unwatch')).toHaveLength(main.callsOf('files.watch').length);
  });

  it('keeps a refused listing as its message', async () => {
    mainWith({ '/r': "path outside the session's directories" });
    useFiles.getState().list(S, '/r');
    await flush();
    // UX wave U6b-4b: the failure kept whole beside its message, for the notice
    expect(useFiles.getState().listing(S, '/r')).toEqual({ status: 'error', message: "path outside the session's directories", failure: { code: 'internal', message: "path outside the session's directories", refusal: null } });
  });

  it('retries a refused watch when a holder joins it again', async () => {
    let refuse = true;
    const main = installFakeMain((name) => (name === 'files.watch' && refuse ? fail("path outside the session's directories") : answer()));
    const first = useFiles.getState().watch(S, '/r');
    await first.ready;
    refuse = false;
    const second = useFiles.getState().watch(S, '/r');
    await second.ready;
    expect(main.callsOf('files.watch')).toHaveLength(2);
  });
});

// ---- the tool over C8a's host -----------------------------------------------------------------------------------------

// happy-dom has no layout: give the tree's scroller a viewport so the virtualiser mounts rows.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-files-scroller') ? 600 : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

const REPO: Record<string, FilesEntry[] | string> = {
  '': [dir('/r'), dir('/docs')],
  '/r': [dir('/r/.git'), dir('/r/src'), file('/r/.env'), { ...file('/r/link-out'), kind: 'symlink', target: '/elsewhere/secret' }],
  '/r/src': [file('/r/src/app.ts'), file('/r/src/staged.ts')],
  '/docs': "path outside the session's directories",
};

const items = () => screen.queryAllByRole('treeitem').map((item) => item.textContent);
const item = (name: string) => screen.getAllByRole('treeitem').find((i) => i.querySelector('span.truncate')?.textContent === name)!;
const fileTabs = () => currentSet(useLayout.getState().main).panes.flatMap((pane) => pane.tabs).filter((tab) => tab.kind === 'file');

describe('files tool', () => {
  const offs: (() => void)[] = [];
  let main: ReturnType<typeof mainWith>;
  beforeEach(() => {
    resetPanelStores();
    resetTreeState();
    useFiles.getState().reset();
    useViewer.getState().reset();
    main = mainWith(REPO);
    offs.push(connectCodeEvents(), registerPanelTool(filesTool));
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r', additionalDirectories: ['/docs'] })) }));
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
  });

  const openTool = () => act(() => void panelHost.addTool('files', { appSessionId: A }));

  it('gives the semantic tree its virtual content extent as directories expand and collapse, with Refresh outside it', async () => {
    render(<TestHost />);
    openTool();
    await waitFor(() => expect(items()).toHaveLength(5));
    const tree = screen.getByRole('tree', { name: FILES_COPY.title });
    const extent = () => Number.parseFloat(tree.style.height);
    const initial = extent();
    expect(initial).toBeGreaterThan(0);
    expect(tree.contains(screen.getByRole('button', { name: FILES_COPY.refresh }))).toBe(false);
    fireEvent.click(item('src'));
    await waitFor(() => expect(items()).toHaveLength(7));
    expect(extent()).toBeGreaterThan(initial);
    fireEvent.click(item('r'));
    await waitFor(() => expect(items()).toHaveLength(2));
    expect(extent()).toBeGreaterThan(0);
    expect(extent()).toBeLessThan(initial);
  });

  it('opens the project root immediately, keeps additional roots lazy, and preserves a deliberate collapse on refresh and remount', async () => {
    const mounted = render(<TestHost />);
    openTool();
    await waitFor(() => expect(items()).toEqual(['rdirectory', 'src', '.env', 'link-outSymbolic link → /elsewhere/secret', 'docsadditional directory']));
    expect(main.calls.filter((c) => c.name.startsWith('files.')).map((c) => [c.name, c.input.path])).toEqual([
      ['files.list', undefined],
      ['files.watch', '/r'], // the watch first, then the listing it guards
      ['files.list', '/r'],
    ]);
    expect(item('r').getAttribute('aria-expanded')).toBe('true');
    expect(item('docs').getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(item('r'));
    fireEvent.click(screen.getByRole('button', { name: FILES_COPY.refresh }));
    await waitFor(() => expect(main.callsOf('files.list').filter((input) => input.path === undefined)).toHaveLength(2));
    mounted.unmount();
    render(<TestHost />);
    expect(item('r').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('src')).toBeNull();
  });

  // UX wave U6b-1: a file opens beside the chat; the first one takes the session's tree-only tab (the tree at its left
  // is M3's), and nothing opens in the main area
  it('opens a clicked file beside the chat in the tree-only tab, the main area unchanged; a symlink opens nothing', async () => {
    render(<TestHost />);
    openTool();
    const [tab] = panelOf(A)!.tabs;
    fireEvent.click(await screen.findByText('src'));
    fireEvent.click(await screen.findByText('link-out'));
    expect(useLayout.getState().panelParams[tab.id]).toBeUndefined();
    fireEvent.click(await screen.findByText('app.ts'));
    expect(fileTabs()).toEqual([]);
    expect(panelOf(A)!.tabs.map((t) => t.id)).toEqual([tab.id]);
    expect(useLayout.getState().panelParams[tab.id]).toEqual({ file: '/r/src/app.ts', line: null, preview: true });
    expect(document.querySelector('[data-files-tab]')!.getAttribute('data-file')).toBe('/r/src/app.ts');
    expect(document.querySelector('[data-file-viewer]')!.getAttribute('data-path')).toBe('/r/src/app.ts');
  });

  it('shows a refused root as the notice’s first sentence for a folder with its path, and retries it when expanded again', async () => {
    render(<TestHost />);
    openTool();
    fireEvent.click(await screen.findByText('docs'));
    await waitFor(() => expect(document.querySelector('[data-notice="refused"]')).not.toBeNull());
    // UX wave U6b-4b (L11): the folder's sentence, the command's words as the row's title
    const row = document.querySelector('[data-notice="refused"]')!;
    expect(row.textContent).toBe('This folder is outside the folders this session works in./docs');
    expect(row.getAttribute('data-notice-cause')).toBe('outside');
    expect(row.getAttribute('title')).toBe("This folder is outside the folders this session works in.\npath outside the session's directories"); // the whole headline, then the command's words
    fireEvent.click(item('docs'));
    fireEvent.click(item('docs'));
    await waitFor(() => expect(main.callsOf('files.list').filter((input) => input.path === '/docs')).toHaveLength(2));
  });

  // UX wave U6b-4b (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4b-links.md, M3; L11): the Files list says the notice's
  // sentences for a folder
  it('a folder that is not there reads “No folder at this path.”, at the row’s height', async () => {
    main = mainWith({ ...REPO, '/r/src': 'not found: /r/src' });
    render(<TestHost />);
    openTool();
    fireEvent.click(await screen.findByText('src'));
    await waitFor(() => expect(document.querySelector('[data-notice="error"]')).not.toBeNull());
    const row = document.querySelector('[data-notice="error"]')!;
    expect(row.textContent).toBe('No folder at this path.');
    expect(row.getAttribute('data-notice-cause')).toBe('not-found');
    expect(row.getAttribute('title')).toBe('No folder at this path.\nnot found: /r/src');
  });

  it('roots that could not be listed read the folder’s sentences and the command’s words, and Retry lists them again', async () => {
    let up = false;
    main = installFakeMain((name, input) => {
      if (QUIET[name]) return QUIET[name];
      if (name === 'files.watch' || name === 'files.unwatch') return answer();
      if (name === 'files.list' && input.path === undefined) return up ? answer({ root: null, path: '', entries: [dir('/r')], truncated: false }) : fail('files.list: the files service is not running', 'host_unavailable');
      if (name === 'files.list') return answer({ root: '/r', path: input.path, entries: [], truncated: false });
      return fail(`unexpected ${name}`);
    });
    render(<TestHost />);
    openTool();
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('data-notice-cause')).toBe('unreachable');
    expect(screen.queryByRole('button', { name: 'Refresh' })).toBeNull(); // Retry is the one control that lists them again
    expect([...alert.querySelectorAll('p')].map((p) => p.textContent)).toEqual(["MAWS's service on this Mac is not answering.", 'files.list: the files service is not running']);
    for (const p of alert.querySelectorAll('p:not([data-notice-detail])')) expect(p.textContent).not.toMatch(/^(Refused|Could not list|files\.)/); // the sentences; the command's words are the small line's
    up = true;
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(item('r')).toBeTruthy()); // the root, listed now
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('roots refused as outside read the folder’s sentence with no Retry', async () => {
    main = mainWith({ ...REPO, '': "path outside the session's directories" });
    render(<TestHost />);
    openTool();
    const alert = await screen.findByRole('alert');
    expect([...alert.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['This folder is outside the folders this session works in.', "path outside the session's directories"]);
    expect(within(alert).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy(); // with no Retry, Refresh stands beside it as before
  });

  // UX wave U6b-1 (Decision 8): the reveal of `params.path`, which nothing in the window asked for, is gone
  it('a tab with params of the older reveal draws the tree and opens nothing', async () => {
    render(<TestHost />);
    act(() => void panelHost.addTool('files', { appSessionId: A, params: { path: '/r/src/app.ts', line: 5 } as never }));
    await waitFor(() => expect(items()).toHaveLength(5));
    expect(fileTabs()).toEqual([]);
    expect(document.querySelector('[data-files-tab]')!.getAttribute('data-file')).toBe('');
    expect(main.callsOf('files.read')).toEqual([]);
  });

  // UX wave U8c-2 (M4 decision 4, §I): while the session is moved, the root that is the working folder is listed first,
  // labelled "working folder", and expanded once; nothing is collapsed and the selection stays. Back at the launch folder,
  // its root is first again.
  describe('the agent moved', () => {
    const MOVED: Record<string, FilesEntry[] | string> = { ...REPO, '/wt': [file('/wt/w.ts')], '/wt/src': [file('/wt/src/x.ts')] };
    const put = (over: Partial<SessionRecord>) =>
      act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r', additionalDirectories: ['/docs'], ...over })) })));
    const byCd = { agentFolder: { checkout: '/wt', cwd: '/wt', branch: 'w', linked: true } };
    const rootsListed = () => main.callsOf('files.list').filter((input) => input.path === undefined).length;

    it('lists the working folder first after a cd, labelled and expanded, keeping open rows and the selection; back, the launch root is first', async () => {
      const tree = { ...MOVED };
      main = mainWith(tree);
      render(<TestHost />);
      openTool();
      await screen.findByText('src');
      fireEvent.click(item('src'));
      await screen.findByText('app.ts');
      tree[''] = [dir('/r'), dir('/docs'), dir('/wt')]; // the service appends the admitted working folder
      put(byCd);
      await waitFor(() => expect(items()[0]).toBe('wtworking folder'));
      await waitFor(() => expect(items()).toEqual(['wtworking folder', 'w.ts', 'rdirectory', 'src', 'app.ts', 'staged.ts', '.env', 'link-outSymbolic link → /elsewhere/secret', 'docsadditional directory']));
      expect(item('src').getAttribute('aria-selected')).toBe('true');
      tree[''] = [dir('/r'), dir('/docs')];
      put({});
      await waitFor(() => expect(items()[0]).toBe('rdirectory'));
      expect(items()).toEqual(['rdirectory', 'src', 'app.ts', 'staged.ts', '.env', 'link-outSymbolic link → /elsewhere/secret', 'docsadditional directory']);
    });

    it('lists the working folder first after a move by the tool, ahead of the directory the engine files the session in', async () => {
      const tree = { ...MOVED, '': [dir('/wt/src'), dir('/wt'), dir('/r')] };
      main = mainWith(tree);
      put({ directory: '/wt/src', additionalDirectories: [], worktree: { path: '/wt', branch: 'w' }, launchFolder: '/r' });
      render(<TestHost />);
      openTool();
      await waitFor(() => expect(items()).toEqual(['wtworking folder', 'w.ts', 'srcdirectory', 'rdirectory']));
    });

    // Held open: a roots listing is in flight when the agent moves. Its answer lands (without the working folder), and the
    // listing the move asked for replaces it; the first root is never one the listing does not hold.
    it('keeps the root in use while a listing in flight lands without the working folder, then lists it first', async () => {
      const tree = { ...MOVED };
      const answers: ReturnType<typeof deferred<ReturnType<typeof answer>>>[] = [];
      let hold = false;
      main = installFakeMain((name, input) => {
        if (QUIET[name]) return QUIET[name];
        if (name === 'files.watch' || name === 'files.unwatch') return answer();
        if (name !== 'files.list') return fail(`unexpected ${name}`);
        const path = (input.path as string | undefined) ?? '';
        const found = tree[path];
        const reply = typeof found === 'string' ? fail(found) : answer({ root: path === '' ? null : '/r', path, entries: found, truncated: false });
        if (!hold || path !== '') return reply;
        const held = deferred<ReturnType<typeof answer>>();
        answers.push(held);
        return held.promise;
      });
      render(<TestHost />);
      openTool();
      await screen.findByText('src');
      hold = true;
      fireEvent.click(screen.getByRole('button', { name: FILES_COPY.refresh }));
      await waitFor(() => expect(answers).toHaveLength(1)); // the old listing, in flight
      put(byCd); // the move asks again; the store re-lists once the flight lands
      await act(async () => answers[0].resolve(answer({ root: null, path: '', entries: [dir('/r'), dir('/docs')], truncated: false })));
      await waitFor(() => expect(answers).toHaveLength(2));
      expect(items()[0]).toBe('rdirectory'); // the root in use stays: the working folder is not listed yet
      expect(item('r').getAttribute('aria-expanded')).toBe('true');
      expect(rootsListed()).toBe(3);
      await act(async () => answers[1].resolve(answer({ root: null, path: '', entries: [dir('/r'), dir('/docs'), dir('/wt')], truncated: false })));
      await waitFor(() => expect(items().slice(0, 3)).toEqual(['wtworking folder', 'w.ts', 'rdirectory']));
    });
  });

  it('lists the roots again when the session record changes its directories', async () => {
    render(<TestHost />);
    openTool();
    await screen.findByText('src');
    act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r', additionalDirectories: [] })) })));
    await waitFor(() => expect(main.callsOf('files.list').filter((input) => input.path === undefined)).toHaveLength(2));
  });

  // E11's sitting (joint-sitting notes, A4 setup): a New chat's Files pane said "Could not list: unknown app session"
  // until the session started. Main now lists an unstarted session's location; the pane lists the roots again when the
  // intent's location changes (a project chosen after the pane opened), and before any is chosen says to open a session.
  it("an unstarted session's pane follows its intent's location, and says to open a session before it has one", async () => {
    useSessions.setState((s) => {
      const records = new Map(s.records);
      records.delete(A);
      return { records };
    });
    let chosen = false;
    installFakeMain((name, input) => {
      if (QUIET[name]) return QUIET[name];
      if (name === 'files.watch' || name === 'files.unwatch') return answer();
      if (name === 'files.list' && input.path === undefined) return chosen ? answer({ root: null, path: '', entries: [dir('/r')], truncated: false }) : fail(`unknown app session: ${bareOf(A)}`);
      return fail(`unexpected ${name}`);
    });
    const intent = (location: unknown) => ({ appSessionId: A, location, additionalDirectories: [], updatedAt: chosen ? '2026-10-08T10:00:01.000Z' : '2026-10-08T10:00:00.000Z', progress: { worktree: null } }) as never;
    act(() => useSetup.getState().applyIntents([intent(null)]));
    render(<TestHost />);
    openTool();
    await waitFor(() => expect(screen.getByText(FILES_COPY.noSession)).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    chosen = true;
    act(() => useSetup.getState().applyIntents([intent({ kind: 'directory', path: '/r' })]));
    await waitFor(() => expect(items()).toEqual(['r']));
    act(() => useSetup.setState({ intents: new Map() }));
  });

  // F2a review 4: main lists a new worktree's repository until the setup makes the worktree, then the worktree; the
  // location alone does not change at that step, so the pane follows the setup's progress too.
  it("an unstarted session's pane lists the new worktree once its setup has made it", async () => {
    useSessions.setState((s) => {
      const records = new Map(s.records);
      records.delete(A);
      return { records };
    });
    let made = false;
    installFakeMain((name, input) => {
      if (QUIET[name]) return QUIET[name];
      if (name === 'files.watch' || name === 'files.unwatch') return answer();
      if (name === 'files.list' && input.path === undefined) return answer({ root: null, path: '', entries: [dir(made ? '/r-feature' : '/r')], truncated: false });
      return fail(`unexpected ${name}`);
    });
    const location = { kind: 'newWorktree', repoRoot: '/r', name: 'feature', branch: { kind: 'new', name: 'feature', base: 'HEAD' } };
    const worktree = { path: '/r-feature', branch: 'feature', head: 'abc', createdHere: true };
    const intent = (updatedAt: string) => ({ appSessionId: A, location, additionalDirectories: [], updatedAt, progress: { worktree: made ? worktree : null } }) as never;
    act(() => useSetup.getState().applyIntents([intent('2026-10-08T10:00:00.000Z')]));
    render(<TestHost />);
    openTool();
    await waitFor(() => expect(items()).toEqual(['r']));
    made = true;
    act(() => useSetup.getState().applyIntents([intent('2026-10-08T10:00:01.000Z')]));
    await waitFor(() => expect(items()).toEqual(['r-feature']));
    act(() => useSetup.setState({ intents: new Map() }));
  });

  it('stops watching the expanded directories under a collapsed parent, and remembers their expansion', async () => {
    render(<TestHost />);
    openTool();
    await screen.findByText('src');
    fireEvent.click(await screen.findByText('src'));
    await screen.findByText('app.ts');
    expect([useFiles.getState().holders(A, '/r'), useFiles.getState().holders(A, '/r/src')]).toEqual([1, 1]);
    fireEvent.click(item('r'));
    await waitFor(() => expect([useFiles.getState().holders(A, '/r'), useFiles.getState().holders(A, '/r/src')]).toEqual([0, 0]));
    fireEvent.click(item('r'));
    expect(await screen.findByText('app.ts')).toBeTruthy(); // src is still expanded
    await waitFor(() => expect(useFiles.getState().holders(A, '/r/src')).toBe(1));
  });

  it('returns to its scroll offset when a tab hidden past the grace lists its directories again', async () => {
    const many = Array.from({ length: 100 }, (_, i) => file(`/r/src/f${String(i).padStart(3, '0')}.ts`));
    main = mainWith({ ...REPO, '/r/src': many });
    // A scroller that clamps as a browser does: never past its content (the tree's height) less its 600 px viewport.
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
    const scrollTop = own ?? Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    const offsets = new WeakMap<Element, number>();
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-files-scroller') ? (offsets.get(this) ?? 0) : scrollTop.get!.call(this);
      },
      set(this: HTMLElement, value: number) {
        if (!this.hasAttribute('data-files-scroller')) return scrollTop.set!.call(this, value);
        const content = parseFloat(this.querySelector<HTMLElement>('[role="tree"]')?.style.height ?? '0') || 0;
        offsets.set(this, Math.max(0, Math.min(value, content - 600)));
      },
    });
    try {
      render(<TestHost />);
      openTool();
      await screen.findByText('src');
      fireEvent.click(await screen.findByText('src'));
      await screen.findByText('f000.ts');
      const scroller = () => document.querySelector('[data-files-scroller]') as HTMLElement;
      act(() => void (scroller().scrollTop = 1200));
      expect(scroller().scrollTop).toBe(1200);
      const id = panelOf(A)!.tabs[0].id;
      act(() => panelHost.showSummary()); // hidden
      // …past the grace: the unwatched directories' listings are gone, the roots' stays.
      act(() => useFiles.setState((s) => ({ listings: new Map([...s.listings].filter(([key]) => key.endsWith('\n'))) })));
      act(() => panelHost.selectTab(id));
      await screen.findByText('src');
      await waitFor(() => expect(scroller().scrollTop).toBe(1200));
    } finally {
      if (own) Object.defineProperty(HTMLElement.prototype, 'scrollTop', own);
      else delete (HTMLElement.prototype as { scrollTop?: number }).scrollTop;
    }
  });

  it('keeps the selection through a refresh caused by files.changed, and re-lists and re-watches an invalidated directory', async () => {
    render(<TestHost />);
    openTool();
    await screen.findByText('src');
    fireEvent.click(await screen.findByText('src'));
    fireEvent.click(await screen.findByText('app.ts'));
    // UX wave U6b-1: the click opened app.ts in this tab, beside the chat; given back to the tree alone, the tab marks the
    // session's selection, the row the click made (a tab that holds a file marks its file: M3's suite)
    const id = panelOf(A)!.tabs[0].id;
    act(() => useLayout.getState().setPanelParams(id, null));
    await screen.findByText('app.ts');
    REPO['/r/src'] = [file('/r/src/app.ts'), file('/r/src/new.ts'), file('/r/src/staged.ts')];
    try {
      act(() => main.emit('files.changed', { appSessionId: bareOf(A), path: '/r/src/new.ts', kind: 'created' }));
      await screen.findByText('new.ts');
      expect(item('app.ts').getAttribute('aria-selected')).toBe('true');
      main.calls.splice(0);
      act(() => main.emit('files.changed', { appSessionId: bareOf(A), path: '/r/src', kind: 'invalidated' }));
      await waitFor(() => expect(main.calls.filter((c) => c.name.startsWith('files.')).map((c) => [c.name, c.input.path])).toEqual([
        ['files.watch', '/r/src'],
        ['files.list', '/r/src'],
      ]));
      expect(await screen.findByText('new.ts')).toBeTruthy();
    } finally {
      REPO['/r/src'] = [file('/r/src/app.ts'), file('/r/src/staged.ts')];
    }
  });

  it('follows the shown session under a pin and keeps each session its own tree', async () => {
    render(<TestHost />);
    openTool();
    const id = panelOf(A)!.tabs[0].id;
    act(() => useLayout.getState().setPanelTabPinned(A, id, true));
    await screen.findByText('src');
    await screen.findByText('src');
    act(() => useLayout.getState().openSession(B));
    act(() => panelHost.selectTab(id));
    await waitFor(() => expect(main.callsOf('files.list')).toContainEqual({ appSessionId: bareOf(B) }));
    await waitFor(() => expect(treeOf(useTreeState.getState(), B).defaultRoot).toBe('/r')); // UX wave U6b-1 (M3): the session's tree, not the tab's
    act(() => useLayout.getState().openSession(A));
    expect(await screen.findByText('src')).toBeTruthy(); // A's expansion kept
    expect(within(screen.getByRole('tree')).getAllByRole('treeitem')[0].getAttribute('aria-expanded')).toBe('true');
  });
});

// ---- the tree at the file's left (UX wave U6b-1, M3) -------------------------------------------------------------------
// Every Files tab draws the tree in a column at the left of its file, and a tab with no file the tree alone. The tree is
// the session's (`tree-state.ts`): the same folders open, the same width and fold in every tab of the session, and after a
// relaunch. A row's click opens the file in the preview tab, a double-click keeps it, ⌘-click opens a main tab. The row of
// the file in view is marked. In a tab too narrow for both, the tree folds, and its button shows it in the file's place
// (the owner's answer on card R8). happy-dom has no layout: a tab's width is reported by a fake ResizeObserver.
// UX wave U6e (M3; §D, "Reported" 1, K6, K7, K9): the Files list's menu, opened by a right-click in the tree or ⇧F10 with
// the keyboard in it, holds the one row "Open File…", with no chord; for a session on another machine the row is
// disabled and names the machine, the menu at most max-w-96 wide and a long name cut, the whole row its title.
describe('the Files list’s menu (U6e)', () => {
  const offs: (() => void)[] = [];
  let main: ReturnType<typeof mainWith>;
  const R = addressOf(OTHER_MACHINE, 'app-remote') as AppSessionId;
  const STUDIO = 'the-rehearsal-room-mac-mini-upstairs';
  beforeEach(() => {
    resetPanelStores();
    resetTreeState();
    useFiles.getState().reset();
    useViewer.getState().reset();
    main = mainWith(REPO);
    offs.push(connectCodeEvents(), registerPanelTool(filesTool));
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r' })).set(R, record(R, { directory: '/r' })) }));
    useMachines.setState({ machines: new Map([[OTHER_MACHINE, { name: STUDIO } as MachineState]]) });
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
    useMachines.setState({ machines: new Map() });
  });
  // Review finding 4 (K6, K12): at most the menus' width and never wider than the column less 1rem, the column measured
  // as the menu opens (and its edges the menu's collision boundary); M4's scene measures the boxes.
  const COLUMN_BOUND = 'max-w-[min(24rem,calc(var(--files-menu-column,25rem)_-_1rem))]';
  const COLUMN_FLOOR = 'min-w-[min(12rem,calc(var(--files-menu-column,25rem)_-_1rem))]';
  const openTree = async (appSessionId: AppSessionId) => {
    render(<TestHost />);
    act(() => void panelHost.addTool('files', { appSessionId }));
    return screen.findByRole('tree');
  };

  it('a right-click in the tree opens the one row “Open File…”, with no chord, which asks Open File… for the tab’s session', async () => {
    await openTree(A);
    await waitFor(() => expect(items().length).toBeGreaterThan(0));
    fireEvent.contextMenu(item('src'));
    const menu = await screen.findByRole('menu');
    expect(menu.hasAttribute('data-files-menu')).toBe(true);
    expect(menu.className.split(/\s+/)).toEqual(expect.arrayContaining([COLUMN_BOUND, 'shadow-float']));
    const rows = within(menu).getAllByRole('menuitem');
    expect(rows.map((row) => row.textContent)).toEqual(['Open File…']);
    expect(rows[0].hasAttribute('data-open-file')).toBe(true);
    fireEvent.click(rows[0]);
    await waitFor(() => expect(main.callsOf('layout.openFile')).toEqual([{ appSessionId: bareOf(A) }]));
  });

  // Panel fix wave, part 2 (M4's scene, "its row opens a second chosen file"): a menu that closes hands the keyboard back
  // to where it was a task later (Radix's focus scope, in a timer). A menu opened again before that task runs must not take
  // the late hand-back as the keyboard leaving it: the row stays the same element, frame after frame, and its click asks.
  it('opened again at once after Escape, the menu stays open: its row the same element across frames, and its click asks Open File…', async () => {
    const tree = await openTree(A);
    await waitFor(() => expect(items().length).toBeGreaterThan(0));
    act(() => item('src').focus()); // a right-click on a row puts the keyboard on it, as the scene's third does
    fireEvent.contextMenu(item('src'));
    fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.contextMenu(tree); // before the closed menu's hand-back has run
    const row = within(await screen.findByRole('menu')).getByRole('menuitem');
    for (let frame = 0; frame < 4; frame++) {
      await act(() => new Promise<void>((resolve) => setTimeout(() => requestAnimationFrame(() => resolve()), 0)));
      expect(row.isConnected, `frame ${frame}: the row is still in the page`).toBe(true);
      expect(within(screen.getByRole('menu')).getByRole('menuitem'), `frame ${frame}: the same element`).toBe(row);
    }
    fireEvent.click(row);
    await waitFor(() => expect(main.callsOf('layout.openFile')).toEqual([{ appSessionId: bareOf(A) }]));
  });

  // The architect's ruling 2: a second right-click while the menu is open closes it and opens it again in one gesture (its
  // press lands outside the open menu); Escape then hands the keyboard back to the row that held it when the menu first
  // opened, not to the page.
  it('right-clicked again while open, so it opens again, then closed by Escape, the menu hands the keyboard back to the row it first opened from', async () => {
    await openTree(A);
    await waitFor(() => expect(items().length).toBeGreaterThan(0));
    act(() => item('src').focus()); // a right-click on a row puts the keyboard on it
    fireEvent.contextMenu(item('src'));
    const first = await screen.findByRole('menu');
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))); // the open menu listens for a press outside it
    fireEvent.pointerDown(item('src')); // the second right-click: its press outside the open menu closes it …
    fireEvent.contextMenu(item('src')); // … and its contextmenu opens it again
    const second = await screen.findByRole('menu');
    expect(first.isConnected).toBe(false);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0))); // the first menu's deferred hand-back runs
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(item('src')));
  });

  it('closed by Escape and not opened again, the menu hands the keyboard back to the row it was on', async () => {
    await openTree(A);
    await waitFor(() => expect(items().length).toBeGreaterThan(0));
    act(() => item('src').focus());
    fireEvent.contextMenu(item('src'));
    fireEvent.keyDown(await screen.findByRole('menu'), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(item('src')));
  });

  // Re-review residual 2: at the tree's least width (160 px) the menu's least width yields to the column too.
  it('at a 160 px tree both the menu’s least and its most width stay under the column less 1rem', async () => {
    const tree = await openTree(A);
    await waitFor(() => expect(items().length).toBeGreaterThan(0));
    const column = document.querySelector('[data-tool="files"]')!;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ width: 160, height: 400, top: 0, left: 0, right: 160, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.contextMenu(tree);
    const menu = await screen.findByRole('menu');
    const classes = menu.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining([COLUMN_BOUND, COLUMN_FLOOR]));
    expect(classes).not.toContain('min-w-48');
    expect(menu.style.getPropertyValue('--files-menu-column')).toBe('160px');
  });

  it('⇧F10 with the keyboard in the tree opens it', async () => {
    await openTree(A);
    await waitFor(() => expect(items().length).toBeGreaterThan(0));
    act(() => item('src').focus());
    fireEvent.keyDown(item('src'), { key: 'F10', shiftKey: true });
    expect((await screen.findByRole('menu')).hasAttribute('data-files-menu')).toBe(true);
  });

  it('for a session on another machine the row is disabled, names the machine in the muted colour, cut, with its whole text as its title', async () => {
    const tree = await openTree(R);
    const column = document.querySelector('[data-tool="files"]')!;
    vi.spyOn(column, 'getBoundingClientRect').mockReturnValue({ width: 320, height: 600, top: 0, left: 0, right: 320, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.contextMenu(tree);
    const menu = await screen.findByRole('menu');
    expect(menu.className.split(/\s+/)).toContain(COLUMN_BOUND);
    expect(menu.className.split(/\s+/)).not.toContain('max-w-96');
    expect(menu.style.getPropertyValue('--files-menu-column')).toBe('320px');
    const row = within(menu).getByRole('menuitem');
    const whole = `Open File… (this session runs on ${STUDIO})`;
    expect(row.textContent).toBe(whole);
    expect(row.getAttribute('title')).toBe(whole);
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.className.split(/\s+/)).toContain('truncate');
    expect(row.querySelector('.text-fg-muted')?.textContent).toBe(` (this session runs on ${STUDIO})`);
    fireEvent.click(row);
    await act(flush);
    expect(main.callsOf('layout.openFile')).toEqual([]);
  });
});

describe('the tree at the file’s left', () => {
  const APP = '/r/src/app.ts';
  const STAGED = '/r/src/staged.ts';
  const WIDE = 700;
  const offs: (() => void)[] = [];
  let main: ReturnType<typeof treeMain>;
  let observer: ReturnType<typeof installResizeObserver>;

  // Main as the tree reads it (REPO's listings), a file's text, and the tree's stored state
  function treeMain(stored: unknown = null) {
    return installFakeMain((name, input) => {
      if (name === 'layout.get') return answer({ value: input.key === 'files.tree' ? stored : null });
      if (QUIET[name]) return QUIET[name];
      if (name === 'files.watch' || name === 'files.unwatch') return answer();
      if (name === 'files.list') {
        const found = REPO[(input.path as string | undefined) ?? ''];
        if (found === undefined) return fail(`not found: ${String(input.path)}`);
        return typeof found === 'string' ? fail(found) : answer({ root: input.path === undefined ? null : '/r', path: input.path ?? '', entries: found, truncated: false });
      }
      if (name === 'files.read') {
        const content = `// ${String(input.path)}\n`;
        return answer({ encoding: 'utf8', content, bytes: content.length, offset: 0, length: content.length, truncated: false, mime: 'text/plain', hash: null, utf8: null });
      }
      return fail(`unexpected ${name}`);
    });
  }

  beforeEach(() => {
    resetPanelStores();
    resetKeptOpens();
    resetTreeState();
    useFiles.getState().reset();
    useViewer.getState().reset();
    observer = installResizeObserver();
    main = treeMain();
    offs.push(connectCodeEvents(), registerPanelTool(filesTool));
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r', additionalDirectories: ['/docs'] })) }));
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
    vi.unstubAllGlobals();
    resetKeptOpens();
  });

  const sideTabs = () => (panelOf(A)?.tabs ?? []).filter((tab) => tab.toolId === 'files');
  const paramsOf = (tabId: string) => useLayout.getState().panelParams[tabId];
  const filesTab = () => document.querySelector<HTMLElement>('[data-files-tab]')!;
  const widen = (width: number) => observer.resize(filesTab(), { width, height: 600 });
  const treeColumn = () => document.querySelector<HTMLElement>('[data-files-tree]');
  const toggle = () => document.querySelector<HTMLElement>('[data-files-tree-toggle]');
  const divider = () => screen.getByRole('separator', { name: FILES_COPY.resizeTree });
  const row = (path: string) => document.querySelector<HTMLElement>(`[role="treeitem"][data-path="${path}"]`);
  const shown = async (path: string) => waitFor(() => expect(row(path)).not.toBeNull());
  const marked = () => [...document.querySelectorAll('[role="treeitem"][aria-selected="true"]')].map((element) => element.getAttribute('data-path'));
  // The file's viewer drawn and not hidden (while the tree stands in its place it stays mounted, hidden)
  const fileShown = () => {
    const viewer = document.querySelector('[data-file-viewer]');
    return viewer !== null && viewer.closest('[hidden]') === null;
  };
  const NARROW = TREE_WIDTH_DEFAULT + FILE_WIDTH_MIN - 1;
  const openBeside = async (path: string, options: { keep?: boolean } = {}) => {
    act(() => void openFile(A, path, null, options));
    await waitFor(() => expect(filesTab().getAttribute('data-file')).toBe(path));
  };

  it('every Files tab draws the tree at the left of its file, and a tab with no file the tree alone', async () => {
    render(<TestHost />);
    act(() => void panelHost.addTool('files', { appSessionId: A }));
    await shown('/r/src');
    expect(treeColumn()?.getAttribute('data-place')).toBe('alone');
    expect(toggle()).toBeNull();
    fireEvent.click(row('/r/src')!);
    await shown(APP);
    fireEvent.click(row(APP)!);
    await waitFor(() => expect(filesTab().getAttribute('data-file')).toBe(APP));
    widen(WIDE);
    const tree = treeColumn()!;
    expect(tree.getAttribute('data-place')).toBe('beside');
    expect(tree.style.width).toBe(`${TREE_WIDTH_DEFAULT}px`);
    const viewer = document.querySelector<HTMLElement>('[data-file-viewer]')!;
    expect(viewer.getAttribute('data-path')).toBe(APP);
    expect(tree.compareDocumentPosition(viewer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // the tree at the file's left
    expect(row(STAGED)).not.toBeNull(); // the same tree: src still open
    const button = within(viewer).getByRole('button', { name: FILES_COPY.hideTree });
    expect(button.hasAttribute('data-files-tree-toggle')).toBe(true);
    expect(fileTabs()).toEqual([]);
  });

  it('is the session’s tree: every Files tab of the session shows the same folders open, width and fold', async () => {
    render(<TestHost />);
    await openBeside(APP, { keep: true });
    await openBeside(STAGED, { keep: true });
    const [first, second] = sideTabs();
    expect(paramsOf(second.id)).toMatchObject({ file: STAGED });
    widen(WIDE);
    await shown('/r/src');
    fireEvent.click(row('/r/src')!);
    await shown(APP);
    fireEvent.keyDown(divider(), { key: 'ArrowRight' });
    expect(treeColumn()!.style.width).toBe(`${TREE_WIDTH_DEFAULT + 8}px`);
    act(() => panelHost.selectTab(first.id));
    await waitFor(() => expect(filesTab().getAttribute('data-file')).toBe(APP));
    widen(WIDE);
    expect(treeColumn()!.style.width).toBe(`${TREE_WIDTH_DEFAULT + 8}px`);
    expect(divider().getAttribute('aria-valuenow')).toBe(String(TREE_WIDTH_DEFAULT + 8));
    await shown(APP); // src open in this tab too
    fireEvent.click(toggle()!);
    expect(treeColumn()).toBeNull();
    expect(toggle()!.getAttribute('aria-label')).toBe(FILES_COPY.showTree);
    act(() => panelHost.selectTab(second.id));
    await waitFor(() => expect(filesTab().getAttribute('data-file')).toBe(STAGED));
    widen(WIDE);
    expect(treeColumn()).toBeNull(); // folded for the session
    expect(toggle()!.getAttribute('aria-label')).toBe(FILES_COPY.showTree);
  });

  it('a row’s click opens the file in the preview tab, a double-click keeps it, and ⌘-click opens a main tab with no side tab left', async () => {
    render(<TestHost />);
    act(() => void panelHost.addTool('files', { appSessionId: A }));
    await shown('/r/src');
    fireEvent.click(row('/r/src')!);
    await shown(APP);
    fireEvent.click(row(APP)!);
    const [tab] = sideTabs();
    await waitFor(() => expect(filesTab().getAttribute('data-file')).toBe(APP));
    widen(WIDE);
    await shown(STAGED);
    fireEvent.click(row(STAGED)!);
    expect(sideTabs().map((ref) => ref.id)).toEqual([tab.id]);
    expect(paramsOf(tab.id)).toEqual({ file: STAGED, line: null, preview: true }); // the preview tab reused
    fireEvent.click(row(STAGED)!);
    fireEvent.dblClick(row(STAGED)!);
    expect(paramsOf(tab.id)).toEqual({ file: STAGED, line: null }); // kept
    fireEvent.click(row(APP)!);
    const second = sideTabs().find((ref) => ref.id !== tab.id)!;
    expect(sideTabs()).toHaveLength(2);
    expect(paramsOf(second.id)).toEqual({ file: APP, line: null, preview: true }); // a second tab, the new preview
    await waitFor(() => expect(filesTab().getAttribute('data-file')).toBe(APP));
    widen(WIDE);
    await shown(STAGED);
    fireEvent.click(row(STAGED)!, { metaKey: true });
    expect(fileTabs().map((ref) => ref.path)).toEqual([STAGED]);
    expect(sideTabs().map((ref) => paramsOf(ref.id))).toEqual([{ file: APP, line: null, preview: true }]); // rule 3: none of it beside the chat
  });

  it('marks the row of the file in view, and opens no folder to reach it', async () => {
    render(<TestHost />);
    await openBeside(APP);
    widen(WIDE);
    await shown('/r/src');
    expect(row(APP)).toBeNull(); // its folder stays closed
    expect(marked()).toEqual([]);
    fireEvent.click(row('/r/src')!);
    await shown(APP);
    expect(marked()).toEqual([APP]);
    await openBeside(STAGED); // the preview tab reused
    expect(marked()).toEqual([STAGED]);
  });

  it('in a tab too narrow for both the tree folds, and its button shows the tree in the file’s place until a file is chosen or it is pressed again', async () => {
    render(<TestHost />);
    await openBeside(APP);
    const threshold = TREE_WIDTH_DEFAULT + FILE_WIDTH_MIN;
    widen(threshold - 1);
    expect(treeColumn()).toBeNull();
    expect(document.querySelector('[data-file-viewer]')).not.toBeNull();
    expect(toggle()!.getAttribute('aria-label')).toBe(FILES_COPY.showTree);
    widen(threshold);
    expect(treeColumn()?.getAttribute('data-place')).toBe('beside');
    expect(toggle()!.getAttribute('aria-label')).toBe(FILES_COPY.hideTree);
    widen(threshold - 1);
    expect(treeColumn()).toBeNull();
    fireEvent.click(toggle()!);
    expect(treeColumn()?.getAttribute('data-place')).toBe('instead');
    expect(fileShown()).toBe(false); // in the file's place, nothing beside it
    expect(document.querySelector('[data-file-viewer]')!.closest('[inert]')).not.toBeNull(); // mounted, hidden and inert
    expect(toggle()!.getAttribute('aria-label')).toBe(FILES_COPY.hideTree);
    expect(within(filesTab()).getByText(FILES_COPY.title)).toBeTruthy();
    fireEvent.click(toggle()!); // pressed again: the file
    expect(treeColumn()).toBeNull();
    expect(fileShown()).toBe(true);
    expect(document.querySelector('[data-file-viewer]')?.getAttribute('data-path')).toBe(APP);
    fireEvent.click(toggle()!);
    await shown('/r/src');
    fireEvent.click(row('/r/src')!); // a folder is not a file: the tree stays
    await shown(STAGED);
    expect(treeColumn()?.getAttribute('data-place')).toBe('instead');
    fireEvent.click(row(STAGED)!); // a file chosen: it shows, in the preview tab
    await waitFor(() => expect(document.querySelector('[data-file-viewer]')?.getAttribute('data-path')).toBe(STAGED));
    expect(treeColumn()).toBeNull();
    expect(treeOf(useTreeState.getState(), A).folded).toBe(false); // the narrow button stores nothing
  });

  // M3's review: the first click of a double-click ends the tree in the file's place, so the second lands on the file
  // UX wave U6e (decision 19): a row's click is the person's open, through `openFile` with no `asked`: on the file the
  // agent's tab holds, the tab's mark and the entry's go, so the entry's next reads are the person's (a file the tree lists
  // is inside the session's folders, admitted either way, so a shown one is not read again for it); the narrow tree's
  // double-click then keeps the tab, still unmarked.
  it('a row’s click on the file the agent’s tab holds takes the agent’s mark back from the tab and the entry; the narrow tree’s double-click keeps it unmarked', async () => {
    render(<TestHost />);
    act(() => void openFile(A, APP, null, { asked: 'agent' }));
    const [tab] = sideTabs();
    expect(paramsOf(tab.id)).toEqual({ file: APP, line: null, preview: true, agent: true });
    await waitFor(() => expect(useViewer.getState().entries.get(`file:${TEST_MACHINE}:${APP}`)).toMatchObject({ status: 'ready', agent: true }));
    const reads = () => main.callsOf('files.read').filter((input) => input.path === APP);
    expect(reads().every((input) => input.agent === true)).toBe(true);
    widen(NARROW);
    fireEvent.click(toggle()!);
    await shown('/r/src');
    fireEvent.click(row('/r/src')!, { detail: 1 });
    await shown(APP);
    fireEvent.click(row(APP)!, { detail: 1 }); // the person's open of the file the tab holds
    expect(paramsOf(tab.id)).toEqual({ file: APP, line: null, preview: true });
    expect(useViewer.getState().entries.get(`file:${TEST_MACHINE}:${APP}`)).toMatchObject({ status: 'ready', agent: false });
    await waitFor(() => expect(fileShown()).toBe(true));
    const there = document.querySelector<HTMLElement>('[data-file-viewer]')!;
    fireEvent.click(there, { detail: 2 });
    fireEvent.dblClick(there, { detail: 2 });
    expect(paramsOf(tab.id)).toEqual({ file: APP, line: null }); // kept, unmarked
  });

  it('a double-click on a row of the tree in the file’s place keeps the tab, its first click showing the file at once', async () => {
    render(<TestHost />);
    await openBeside(APP);
    const [tab] = sideTabs();
    widen(NARROW);
    fireEvent.click(toggle()!);
    await shown('/r/src');
    fireEvent.click(row('/r/src')!, { detail: 1 });
    await shown(STAGED);
    fireEvent.click(row(STAGED)!, { detail: 1 }); // the pair's first click: the file at once, in the preview tab
    await waitFor(() => expect(document.querySelector('[data-file-viewer]')?.getAttribute('data-path')).toBe(STAGED));
    expect(fileShown()).toBe(true);
    expect(paramsOf(tab.id)).toEqual({ file: STAGED, line: null, preview: true });
    const there = document.querySelector<HTMLElement>('[data-file-viewer]')!; // what now stands where the row was
    fireEvent.click(there, { detail: 2 });
    fireEvent.dblClick(there, { detail: 2 });
    expect(paramsOf(tab.id)).toEqual({ file: STAGED, line: null }); // kept
    // a later double-click in the file keeps nothing: its own first click ends the chosen row's pair
    act(() => void openFile(A, APP, null));
    await waitFor(() => expect(filesTab().getAttribute('data-file')).toBe(APP));
    const preview = sideTabs().find((ref) => ref.id !== tab.id)!;
    widen(NARROW);
    fireEvent.click(toggle()!);
    await shown(APP);
    fireEvent.click(row(APP)!, { detail: 1 }); // the file the tab holds, chosen: the file shows again
    await waitFor(() => expect(fileShown()).toBe(true));
    const file = document.querySelector<HTMLElement>('[data-file-viewer]')!;
    fireEvent.click(file, { detail: 1 }); // later, a double-click of its own
    fireEvent.click(file, { detail: 2 });
    fireEvent.dblClick(file, { detail: 2 });
    expect(paramsOf(preview.id)).toEqual({ file: APP, line: null, preview: true });
  });

  // M3's review, the record's bounds: the file a row's click chose is kept by the pair's second click only. Each case
  // interrupts the row's first click before a click with `detail` 2 and a double-click arrive; none keeps a file.
  describe('a double-click keeps only the file its own first click chose', () => {
    const ENV = '/r/.env';
    // `path` in the preview tab, the tree in its place, and a click on ENV's row: the preview reused, ENV shown
    async function chooseFromNarrowTree(path: string) {
      await openBeside(path);
      widen(NARROW);
      fireEvent.click(toggle()!, { detail: 1 });
      await shown(ENV);
      fireEvent.click(row(ENV)!, { detail: 1 });
      await waitFor(() => expect(document.querySelector('[data-file-viewer]')?.getAttribute('data-path')).toBe(ENV));
      return sideTabs().find((ref) => paramsOf(ref.id) && (paramsOf(ref.id) as { file: string }).file === ENV)!;
    }
    const secondClickOn = (element: Element) => {
      fireEvent.click(element, { detail: 2 });
      fireEvent.dblClick(element, { detail: 2 });
    };

    it('an unrelated change of the tab in view between the two clicks', async () => {
      render(<TestHost />);
      await openBeside(APP, { keep: true });
      const other = sideTabs()[0];
      act(() => void openFile(A, STAGED, null)); // a second tab, the preview
      await waitFor(() => expect(filesTab().getAttribute('data-file')).toBe(STAGED));
      const chosen = await chooseFromNarrowTree(STAGED);
      act(() => panelHost.selectTab(other.id)); // not the row's doing
      await waitFor(() => expect(filesTab().getAttribute('data-file')).toBe(APP));
      secondClickOn(document.querySelector('[data-file-viewer]')!);
      expect(paramsOf(chosen.id)).toEqual({ file: ENV, line: null, preview: true });
      expect(filesTab().getAttribute('data-file')).toBe(APP); // still in view
    });

    it('a key pressed between the two clicks', async () => {
      render(<TestHost />);
      const chosen = await chooseFromNarrowTree(APP);
      fireEvent.keyDown(document.querySelector('[data-file-viewer]')!, { key: 'Enter' });
      secondClickOn(document.querySelector('[data-file-viewer]')!);
      expect(paramsOf(chosen.id)).toEqual({ file: ENV, line: null, preview: true });
    });

    it('a click outside every Files tab between the two clicks', async () => {
      render(<TestHost />);
      const chosen = await chooseFromNarrowTree(APP);
      fireEvent.click(document.body, { detail: 1 }); // a pair's first click elsewhere
      secondClickOn(document.querySelector('[data-file-viewer]')!);
      expect(paramsOf(chosen.id)).toEqual({ file: ENV, line: null, preview: true });
    });

    it('a second click on the tree’s button or on the divider does that control’s own thing and keeps no file', async () => {
      render(<TestHost />);
      const chosen = await chooseFromNarrowTree(APP);
      secondClickOn(toggle()!); // the button where the tree's own stood: it shows the tree again
      expect(treeColumn()?.getAttribute('data-place')).toBe('instead');
      expect(paramsOf(chosen.id)).toEqual({ file: ENV, line: null, preview: true });
      widen(WIDE); // room for both: the tree beside the file
      fireEvent.keyDown(divider(), { key: 'End' });
      await shown('/r/src');
      fireEvent.click(row('/r/src')!, { detail: 1 }); // a folder's click: nothing chosen …
      await shown(STAGED);
      fireEvent.click(row(STAGED)!, { detail: 1 }); // … then a file's, which reuses the preview
      await waitFor(() => expect(paramsOf(chosen.id)).toEqual({ file: STAGED, line: null, preview: true }));
      secondClickOn(divider()); // the divider's own double-click: the default width
      expect(treeOf(useTreeState.getState(), A).width).toBeNull();
      expect(paramsOf(chosen.id)).toEqual({ file: STAGED, line: null, preview: true });
    });
  });

  it('a reuse of the tab ends the tree in the file’s place: a file opened again from a link shows, not the tree', async () => {
    render(<TestHost />);
    await openBeside(APP);
    widen(NARROW);
    fireEvent.click(toggle()!);
    expect(treeColumn()?.getAttribute('data-place')).toBe('instead');
    await openBeside(STAGED); // from a link: the preview tab reused, no row chosen
    expect(treeColumn()).toBeNull();
    await openBeside(APP); // and the first file again
    expect(treeColumn()).toBeNull();
    expect(fileShown()).toBe(true);
    expect(toggle()!.getAttribute('aria-label')).toBe(FILES_COPY.showTree);
  });

  it('a tab of a fractional width stores the divider’s maximum as a whole number, and a reload keeps every session’s tree', async () => {
    main = treeMain({ version: 1, sessions: { [B]: { width: 300, folded: true, expanded: ['/r'] } } });
    render(<TestHost />);
    await openBeside(APP);
    widen(WIDE + 0.5);
    expect(Number(divider().getAttribute('aria-valuemax'))).toBe(WIDE - FILE_WIDTH_MIN);
    fireEvent.keyDown(divider(), { key: 'End' });
    await waitFor(() => expect(main.callsOf('layout.set')).toHaveLength(1));
    const written = main.callsOf('layout.set')[0].value;
    expect(FilesTreeSchema.safeParse(written).success).toBe(true);
    act(() => resetTreeState());
    main = treeMain(written);
    await act(() => useTreeState.getState().load());
    expect(treeOf(useTreeState.getState(), A).width).toBe(WIDE - FILE_WIDTH_MIN);
    expect(treeOf(useTreeState.getState(), B)).toMatchObject({ width: 300, folded: true, expanded: new Set(['/r']) });
  });

  it('in a tab wide enough its button folds the tree for the session, and the fold is stored', async () => {
    render(<TestHost />);
    await openBeside(APP);
    widen(WIDE);
    await shown('/r/src');
    fireEvent.click(toggle()!);
    expect(treeColumn()).toBeNull();
    expect(toggle()!.getAttribute('aria-label')).toBe(FILES_COPY.showTree);
    await waitFor(() => expect(main.callsOf('layout.set')).toContainEqual({ key: 'files.tree', value: { version: 1, sessions: { [A]: { width: null, folded: true, expanded: ['/r'] } } } }));
    fireEvent.click(toggle()!);
    expect(treeColumn()?.getAttribute('data-place')).toBe('beside');
    expect(treeOf(useTreeState.getState(), A).folded).toBe(false);
  });

  it('drags the divider between the tree’s least width and what leaves the file its own, and a double-click returns it to the default', async () => {
    render(<TestHost />);
    await openBeside(APP);
    widen(WIDE);
    const bounds = () => ['aria-valuemin', 'aria-valuemax', 'aria-valuenow'].map((name) => Number(divider().getAttribute(name)));
    expect(bounds()).toEqual([TREE_WIDTH_MIN, WIDE - FILE_WIDTH_MIN, TREE_WIDTH_DEFAULT]);
    fireEvent.keyDown(divider(), { key: 'End' });
    expect(treeColumn()!.style.width).toBe(`${WIDE - FILE_WIDTH_MIN}px`);
    fireEvent.keyDown(divider(), { key: 'Home' });
    expect(treeColumn()!.style.width).toBe(`${TREE_WIDTH_MIN}px`);
    expect(treeOf(useTreeState.getState(), A).width).toBe(TREE_WIDTH_MIN);
    fireEvent.dblClick(divider());
    expect(treeColumn()!.style.width).toBe(`${TREE_WIDTH_DEFAULT}px`);
    expect(treeOf(useTreeState.getState(), A).width).toBeNull();
  });

  it('after a relaunch the session’s tree has its stored width, fold and open folders', async () => {
    main = treeMain({ version: 1, sessions: { [A]: { width: 300, folded: true, expanded: ['/r', '/r/src'] } } });
    render(<TestHost />);
    await openBeside(APP);
    widen(WIDE);
    await waitFor(() => expect(toggle()!.getAttribute('aria-label')).toBe(FILES_COPY.showTree));
    expect(treeColumn()).toBeNull(); // folded, as stored
    fireEvent.click(toggle()!);
    expect(treeColumn()!.style.width).toBe('300px');
    await shown(APP); // src open, as stored
    expect(marked()).toEqual([APP]);
    expect(main.callsOf('layout.get').filter((input) => input.key === 'files.tree')).toHaveLength(1);
  });
});

// ---- a file beside the chat as an editor (UX wave U6b-1, M2) -----------------------------------------------------------
// The first edit keeps the preview tab (L1), so nothing replaces an unsaved file beside the chat; and a session that goes
// leaves no unsaved file behind unasked (R5, sequence 6): the side tabs' one subscriber opens a main tab, not in front,
// for each file that left them with unsaved edits or a save under way, before the viewer's prune runs.
describe('a file beside the chat as an editor', () => {
  const APP = '/r/app.ts';
  const LIB = '/r/lib.ts';
  const OTHER = '/r/c.ts';
  const KEY = (path: string) => `file:${TEST_MACHINE}:${path}`;
  const offs: (() => void)[] = [];
  let disk: ReturnType<typeof installDisk>;
  beforeAll(() => import('../viewer/CodeView'));
  beforeEach(() => {
    resetPanelStores();
    useLayout.setState({ main: mainShowing(B, A) }); // A in front, B's tab beside it: what comes to the front when A goes
    resetKeptOpens();
    resetTreeState();
    useViewer.getState().reset();
    useFiles.getState().reset();
    disk = installDisk({ [APP]: 'const a = 1;\n', [LIB]: 'export const b = 2;\n', [OTHER]: 'c\n' });
    offs.push(registerPanelTool(filesTool), registerEditor(), connectSideFiles(sideFilesViewer), connectCodeEvents());
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
    resetKeptOpens();
  });

  const sideTabs = (id: AppSessionId) => (panelOf(id)?.tabs ?? []).filter((tab) => tab.toolId === 'files');
  const paramsOf = (tabId: string) => useLayout.getState().panelParams[tabId];
  const editor = () => {
    const element = document.querySelector<HTMLElement>('[data-files-tab] .cm-editor');
    return element ? EditorView.findFromDOM(element) : null;
  };
  const type = (text: string) => act(() => editor()!.dispatch({ changes: { from: 0, insert: text }, userEvent: 'input.type', annotations: isolateHistory.of('full') }));
  const entryOf = (path: string) => useViewer.getState().entries.get(KEY(path));
  const documentOf = (path: string) => existingViewState(KEY(path))?.docOf?.();
  const mainTab = (path: string) => allTabs(useLayout.getState().main).find((tab) => tab.id === KEY(path));

  // `path` beside A's chat in the preview tab (or kept), shown and editable.
  async function openBeside(path: string, options: { keep?: boolean } = {}) {
    act(() => void openFile(A, path, null, options));
    await waitFor(() => expect(editor()?.state.facet(EditorView.editable)).toBe(true));
    await waitFor(() => expect(document.querySelector('[data-files-tab]')?.getAttribute('data-file')).toBe(path));
  }

  it('the first edit keeps the preview tab, so the next single click opens a second tab and the edited file stands', async () => {
    render(<TestHost />);
    await openBeside(APP);
    const [preview] = sideTabs(A);
    expect(paramsOf(preview.id)).toEqual({ file: APP, line: null, preview: true });
    act(() => {
      editor()!.dispatch({ changes: { from: 0, insert: '// mine\n' }, userEvent: 'input.type' });
      expect(paramsOf(preview.id)).toEqual({ file: APP, line: null }); // in the same step as the edit, before any render
    });
    await openBeside(LIB);
    expect(sideTabs(A)).toHaveLength(2);
    expect(paramsOf(preview.id)).toEqual({ file: APP, line: null });
    expect(entryOf(APP)?.dirty).toBe(true);
    expect(documentOf(APP)).toBe('// mine\nconst a = 1;\n');
  });

  it.each([
    ['not in view', true],
    ['in view', false],
  ])('a session that goes with its unsaved file %s leaves the file as a main tab, not in front, with its edit', async (_, other) => {
    render(<TestHost />);
    await openBeside(APP, { keep: true });
    type('// mine\n');
    await waitFor(() => expect(entryOf(APP)?.dirty).toBe(true));
    if (other) {
      await openBeside(LIB); // another file in view: app.ts's view unmounts, its entry and document stay
      expect(document.querySelectorAll('[data-files-tab]')).toHaveLength(1);
    }
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${A}`);
    act(() => useLayout.getState().dropSession(A));
    expect(panelOf(A)).toBeUndefined();
    expect(mainTab(APP)).toMatchObject({ kind: 'file', path: APP, appSessionId: A });
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${B}`);
    expect(entryOf(APP)?.dirty).toBe(true);
    expect(documentOf(APP)).toBe('// mine\nconst a = 1;\n');
    expect(mainTab(LIB)).toBeUndefined(); // a clean file goes with its session, as any side tab does
    await act(() => new Promise((resolve) => setTimeout(resolve, 0))); // the unmounts' prunes
    expect(entryOf(APP)?.dirty).toBe(true);
    expect(entryOf(LIB)).toBeUndefined();
  });

  // The review's finding: each main tab the rule opens notifies the viewer's own layout subscriber, whose prune would take
  // the next unsaved file's entry before its tab exists; every file to keep is held as the side's across the opens.
  it('a session that goes with two unsaved files not in view leaves both as main tabs, not in front, each with its edit', async () => {
    render(<TestHost />);
    await openBeside(APP, { keep: true });
    type('// app\n');
    await openBeside(LIB, { keep: true });
    type('// lib\n');
    await waitFor(() => expect([entryOf(APP)?.dirty, entryOf(LIB)?.dirty]).toEqual([true, true]));
    await openBeside(OTHER); // a third file in view: both edited views unmount, their entries and documents stay
    act(() => useLayout.getState().dropSession(A));
    expect([mainTab(APP)?.id, mainTab(LIB)?.id]).toEqual([KEY(APP), KEY(LIB)]);
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${B}`);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0))); // the unmounts' prunes
    expect([entryOf(APP)?.dirty, entryOf(LIB)?.dirty]).toEqual([true, true]);
    expect([documentOf(APP), documentOf(LIB)]).toEqual(['// app\nconst a = 1;\n', '// lib\nexport const b = 2;\n']);
    expect(mainTab(OTHER)).toBeUndefined();
  });

  it('a session that goes while its file saves leaves the file as a main tab; the save lands there', async () => {
    render(<TestHost />);
    await openBeside(APP, { keep: true });
    type('// mine\n');
    await waitFor(() => expect(entryOf(APP)?.dirty).toBe(true));
    const write = disk.hold('files.write');
    const saving = useViewer.getState().save(KEY(APP));
    await waitFor(() => expect(entryOf(APP)?.saving).toBe(true));
    act(() => useLayout.getState().dropSession(A));
    expect(mainTab(APP)).toBeDefined();
    await act(async () => write.release());
    expect(await saving).toBe('ok');
    expect(disk.files[APP]).toBe('// mine\nconst a = 1;\n');
    expect(entryOf(APP)).toMatchObject({ dirty: false, saving: false });
  });

  // M3's review: while the tree stands in the file's place the viewer stays mounted, so at the viewer's cap a clean file
  // keeps its entry and its undo history; and the hidden file is not where the keyboard is
  it('at the viewer’s cap a clean file whose tree stood in its place keeps its undo history', async () => {
    const observer = installResizeObserver();
    const others: (() => void)[] = [];
    try {
      render(<TestHost />);
      await openBeside(APP, { keep: true });
      type('// mine\n');
      await waitFor(() => expect(entryOf(APP)?.dirty).toBe(true));
      expect(await act(() => useViewer.getState().save(KEY(APP)))).toBe('ok');
      expect(entryOf(APP)?.dirty).toBe(false);
      for (let i = 0; i < VIEWER_ENTRIES_MAX; i++) others.push(useViewer.getState().mount(KEY(`/r/x${i}.ts`), { appSessionId: A, path: `/r/x${i}.ts`, line: null }));
      act(() => editor()!.contentDOM.focus());
      expect(focusedFile()).toBe(KEY(APP));
      observer.resize(document.querySelector('[data-files-tab]')!, { width: TREE_WIDTH_DEFAULT + FILE_WIDTH_MIN - 1, height: 600 });
      fireEvent.click(document.querySelector('[data-files-tree-toggle]')!);
      expect(document.querySelector('[data-files-tree]')?.getAttribute('data-place')).toBe('instead');
      expect(focusedFile()).toBeNull(); // hidden: not where the keyboard is
      act(() => sideFilesViewer.prune()); // past the cap, with the tree in the file's place
      expect(entryOf(APP)).toBeDefined();
      fireEvent.click(document.querySelector('[data-files-tree-toggle]')!);
      expect(document.querySelector('[data-files-tree]')).toBeNull();
      act(() => void undo(editor()!));
      expect(editor()!.state.doc.toString()).toBe('const a = 1;\n');
    } finally {
      act(() => others.forEach((off) => off()));
      vi.unstubAllGlobals();
    }
  });

  it('a file another session’s list still holds stays beside that chat, and no main tab is made', async () => {
    render(<TestHost />);
    await openBeside(APP, { keep: true });
    type('// mine\n');
    await waitFor(() => expect(entryOf(APP)?.dirty).toBe(true));
    act(() => void openFile(B, APP, null, { keep: true }));
    act(() => useLayout.getState().dropSession(A));
    expect(sideTabs(B).map((tab) => paramsOf(tab.id))).toEqual([{ file: APP, line: null }]);
    expect(mainTab(APP)).toBeUndefined();
    expect(entryOf(APP)?.dirty).toBe(true);
  });
});

// ---- UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, §E; decision 12) --------
// The Files list's row for a session that takes the remote route: enabled for one of the machine's owners, opening MAWS's
// own chooser there; otherwise disabled with the first sentence of decision 12's table that applies as its title.
describe('the Files list’s menu for a session on another machine (U6f)', () => {
  const offs: (() => void)[] = [];
  let main: ReturnType<typeof mainWith>;
  const T = addressOf(OTHER_MACHINE, 'app-there') as AppSessionId;
  const TERMINAL = addressOf(OTHER_MACHINE, 'app-terminal') as AppSessionId;
  beforeEach(() => {
    resetPanelStores();
    resetTreeState();
    resetRemoteLaneBStore();
    useFiles.getState().reset();
    useViewer.getState().reset();
    main = mainWith(REPO);
    offs.push(connectCodeEvents(), registerPanelTool(filesTool));
    useSessions.setState((s) => ({ records: new Map(s.records).set(T, record(T, { directory: '/r' })).set(TERMINAL, record(TERMINAL, { directory: '/r' })) }));
    overRl2(T);
  });
  afterEach(() => {
    document.querySelectorAll('[data-remote-chooser]').forEach((sheet) => fireEvent.click(within(sheet as HTMLElement).getByRole('button', { name: 'Cancel' })));
    cleanup();
    offs.splice(0).forEach((off) => off());
    leaveRl2();
  });
  const menuRow = async (appSessionId: AppSessionId) => {
    render(<TestHost />);
    act(() => void panelHost.addTool('files', { appSessionId }));
    fireEvent.contextMenu(await screen.findByRole('tree'));
    return within(await screen.findByRole('menu')).getByRole('menuitem');
  };

  it('for one of the machine’s owners the row is enabled, reads Open File…, and opens the chooser there, never main’s', async () => {
    const row = await menuRow(T);
    expect(row.textContent).toBe('Open File…');
    expect(row.hasAttribute('data-open-file')).toBe(true);
    expect(row.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(row);
    await waitFor(() => expect(document.querySelector('[data-remote-chooser]')).not.toBeNull());
    expect(main.callsOf('files.listOutside')).toEqual([{ appSessionId: bareOf(T) }]);
    expect(main.callsOf('layout.openFile')).toEqual([]);
  });

  it.each([
    ['not one of the machine’s owners', { owner: false }, 'Only studio’s owners can open a file there.'],
    ['the roster not yet saying (R10)', { owner: undefined }, 'Only studio’s owners can open a file there.'],
    ['a build that does not list the capability', { capabilities: ['rl2.channel'] }, 'Can’t open a file on studio yet. Update MAWS on studio and try again.'],
    ['the machine offline', { state: 'down', since: '2026-01-01T00:00:00.000Z', capabilities: undefined }, 'Open File is unavailable while studio is offline.'],
    ['the link connecting', { state: 'connecting', capabilities: undefined }, 'Connecting to studio…'],
  ] as const)('%s: the row is disabled, its title the sentence, and nothing is asked', async (_, over, sentence) => {
    rosterSays(T, over as Partial<MachineState>);
    const row = await menuRow(T);
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.getAttribute('title')).toBe(sentence);
    expect(row.textContent).toBe('Open File…');
    fireEvent.click(row);
    await act(flush);
    expect(document.querySelector('[data-remote-chooser]')).toBeNull();
    expect(main.callsOf('files.listOutside')).toEqual([]);
    expect(main.callsOf('layout.openFile')).toEqual([]);
  });

  // UX wave U6b-4b (L11): a folder there is said with the machine's name
  it('a refused folder there reads the folder’s sentence that names the machine', async () => {
    render(<TestHost />);
    act(() => void panelHost.addTool('files', { appSessionId: T }));
    fireEvent.click(await screen.findByText('docs'));
    await waitFor(() => expect(document.querySelector('[data-notice="refused"]')).not.toBeNull());
    expect(document.querySelector('[data-notice="refused"] span')!.textContent).toBe('This folder is outside the folders this session works in on studio.');
  });

  it('for a terminal session there the row keeps U6e’s sentence', async () => {
    overRl2(TERMINAL, {}, 'A');
    const row = await menuRow(TERMINAL);
    expect(row.getAttribute('title')).toBe('Open File… (this session runs on studio)');
    expect(row.getAttribute('aria-disabled')).toBe('true');
  });
});
