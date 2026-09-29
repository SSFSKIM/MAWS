// The Files tool (C8c execution document, M2): the tree's pure model, the listing store over a fake X2 client, and the
// tool over C8a's host.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { FilesEntry } from '@shared/ipc/schema/files';
import { record } from '../../../../../../test/support/builders';
import { connectCodeEvents } from '../../../ipc/events';
import { instanceOf, panelHost, registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { useSessions } from '../../../stores/sessions';
import { deferred, fail, installFakeMain, ok as answer } from '../../../test-support/code';
import { A, B, panelOf, resetPanelStores, TestHost } from '../../../test-support/panel';
import { useViewer } from '../viewer/viewer-store';
import { filesTool, type FilesState } from './FilesTool';
import { useFiles, WATCH_GRACE_MS } from './store';
import { dirname, expandTo, hidden, joinPath, roleOf, rootsFor, rowsOf, sameFile, type Listing } from './tree';

const S = 'app-a' as AppSessionId;
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
      ['/w', { status: 'error', message: "path outside the session's directories" }],
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
      listing: (path) => (path === '/r' ? { status: 'error', message: 'not found: /r' } : { status: 'loading' }),
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
  'git.watch': fail('not a git repository'),
  'git.unwatch': answer(),
  'fs.workflows': answer({ runs: [] }),
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
    useFiles.getState().applyChanged({ appSessionId: 'app-b' as AppSessionId, path: '/r/other/x', kind: 'created' }); // another session's
    await flush();
    expect(main.callsOf('files.list')).toEqual([{ appSessionId: S, path: '/r/src' }]);
  });

  it('counts watches per directory, installs once and unwatches only after the grace', async () => {
    vi.useFakeTimers();
    const main = mainWith({ '/r': [] });
    const one = useFiles.getState().watch(S, '/r');
    const two = useFiles.getState().watch(S, '/r');
    await vi.advanceTimersByTimeAsync(0);
    expect(main.callsOf('files.watch')).toEqual([{ appSessionId: S, path: '/r' }]);
    one.release();
    two.release();
    await vi.advanceTimersByTimeAsync(WATCH_GRACE_MS - 1);
    const again = useFiles.getState().watch(S, '/r'); // a quick re-expand inside the grace does not churn
    await vi.advanceTimersByTimeAsync(WATCH_GRACE_MS);
    expect(main.callsOf('files.watch')).toHaveLength(1);
    expect(main.callsOf('files.unwatch')).toHaveLength(0);
    again.release();
    await vi.advanceTimersByTimeAsync(WATCH_GRACE_MS);
    expect(main.callsOf('files.unwatch')).toEqual([{ appSessionId: S, path: '/r' }]);
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
    expect(main.callsOf('files.unwatch')).toEqual([{ appSessionId: S, path: '/r' }]);
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

  it('keeps a refused listing as its message', async () => {
    mainWith({ '/r': "path outside the session's directories" });
    useFiles.getState().list(S, '/r');
    await flush();
    expect(useFiles.getState().listing(S, '/r')).toEqual({ status: 'error', message: "path outside the session's directories" });
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
const fileTabs = () => useLayout.getState().main.panes.flatMap((pane) => pane.tabs).filter((tab) => tab.kind === 'file');

describe('files tool', () => {
  const offs: (() => void)[] = [];
  let main: ReturnType<typeof mainWith>;
  beforeEach(() => {
    resetPanelStores();
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

  const openTool = (params?: { path?: string; line?: number }) => act(() => void panelHost.addTool('files', { appSessionId: A, params }));

  it('shows one root per directory in record order with its role, and lists a directory only when it expands', async () => {
    render(<TestHost />);
    openTool();
    await waitFor(() => expect(items()).toEqual(['rdirectory', 'docsadditional directory']));
    expect(main.callsOf('files.list')).toEqual([{ appSessionId: A }]);
    fireEvent.click(item('r'));
    await waitFor(() => expect(items()).toEqual(['rdirectory', 'src', '.env', 'link-outSymbolic link → /elsewhere/secret', 'docsadditional directory']));
    expect(main.calls.filter((c) => c.name.startsWith('files.')).map((c) => [c.name, c.input.path])).toEqual([
      ['files.list', undefined],
      ['files.watch', '/r'], // the watch first, then the listing it guards
      ['files.list', '/r'],
    ]);
    expect(item('r').getAttribute('aria-expanded')).toBe('true');
  });

  it('opens a clicked file in the main area for the session and leaves the panel; a symlink opens nothing', async () => {
    render(<TestHost />);
    openTool();
    fireEvent.click(await screen.findByText('r'));
    fireEvent.click(await screen.findByText('src'));
    fireEvent.click(await screen.findByText('app.ts'));
    expect(fileTabs()).toEqual([{ id: 'file:/r/src/app.ts', kind: 'file', path: '/r/src/app.ts', line: null, appSessionId: A, pinned: false }]);
    expect(panelOf(A)?.tabs.map((t) => t.toolId)).toEqual(['files']);
    expect(item('app.ts').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(item('link-out'));
    expect(fileTabs()).toHaveLength(1);
  });

  it('shows a refused root as the refusal with its path, and retries it when expanded again', async () => {
    render(<TestHost />);
    openTool();
    fireEvent.click(await screen.findByText('docs'));
    await waitFor(() => expect(document.querySelector('[data-notice="refused"]')).not.toBeNull());
    expect(document.querySelector('[data-notice="refused"]')!.textContent).toBe("Refused: path outside the session's directories/docs");
    fireEvent.click(item('docs'));
    fireEvent.click(item('docs'));
    await waitFor(() => expect(main.callsOf('files.list').filter((input) => input.path === '/docs')).toHaveLength(2));
  });

  it('open reveals a path: expands its ancestors, selects it and opens the file at the line', async () => {
    render(<TestHost />);
    openTool({ path: '/r/src/../src/staged.ts', line: 5 });
    await waitFor(() => expect(fileTabs()).toEqual([expect.objectContaining({ path: '/r/src/staged.ts', line: 5, appSessionId: A })]));
    expect(item('staged.ts').getAttribute('aria-selected')).toBe('true');
    expect(item('src').getAttribute('aria-expanded')).toBe('true');
    openTool({ path: '/r/src/app.ts', line: 9 }); // re-targeting the open tab
    await waitFor(() => expect(fileTabs().map((t) => t.kind === 'file' && [t.path, t.line])).toContainEqual(['/r/src/app.ts', 9]));
    expect(panelOf(A)?.tabs).toHaveLength(1);
  });

  it('open with a path that only ends like a root opens it as given, in no root', async () => {
    main = mainWith({ '': [dir('/Users/new/work/app')], '/Users/new/work/app': [file('/Users/new/work/app/config.ts')] });
    render(<TestHost />);
    openTool({ path: '/app/config.ts', line: 2 });
    await waitFor(() => expect(fileTabs()).toEqual([expect.objectContaining({ path: '/app/config.ts', line: 2, appSessionId: A })]));
    expect(item('app').getAttribute('aria-expanded')).toBe('false');
    expect(main.callsOf('files.list').filter((input) => input.path !== undefined)).toEqual([]);
  });

  it('lists the roots again when the session record changes its directories', async () => {
    render(<TestHost />);
    openTool();
    await waitFor(() => expect(items()).toHaveLength(2));
    act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r', additionalDirectories: [] })) })));
    await waitFor(() => expect(main.callsOf('files.list').filter((input) => input.path === undefined)).toHaveLength(2));
  });

  it('stops watching the expanded directories under a collapsed parent, and remembers their expansion', async () => {
    render(<TestHost />);
    openTool();
    fireEvent.click(await screen.findByText('r'));
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
        const content = parseFloat((this.firstElementChild as HTMLElement | null)?.style.height ?? '0') || 0;
        offsets.set(this, Math.max(0, Math.min(value, content - 600)));
      },
    });
    try {
      render(<TestHost />);
      openTool();
      fireEvent.click(await screen.findByText('r'));
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
    fireEvent.click(await screen.findByText('r'));
    fireEvent.click(await screen.findByText('src'));
    fireEvent.click(await screen.findByText('app.ts'));
    REPO['/r/src'] = [file('/r/src/app.ts'), file('/r/src/new.ts'), file('/r/src/staged.ts')];
    try {
      act(() => main.emit('files.changed', { appSessionId: A, path: '/r/src/new.ts', kind: 'created' }));
      await screen.findByText('new.ts');
      expect(item('app.ts').getAttribute('aria-selected')).toBe('true');
      main.calls.splice(0);
      act(() => main.emit('files.changed', { appSessionId: A, path: '/r/src', kind: 'invalidated' }));
      await waitFor(() => expect(main.calls.map((c) => [c.name, c.input.path])).toEqual([
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
    fireEvent.click(await screen.findByText('r'));
    await screen.findByText('src');
    const state = instanceOf(id)!.state as FilesState;
    act(() => useLayout.getState().openSession(B));
    act(() => panelHost.selectTab(id));
    await waitFor(() => expect(main.callsOf('files.list')).toContainEqual({ appSessionId: B }));
    expect(state.ui.getState().views[B]).toBeUndefined();
    act(() => useLayout.getState().openSession(A));
    expect(await screen.findByText('src')).toBeTruthy(); // A's expansion kept
    expect(within(screen.getByRole('tree')).getAllByRole('treeitem')[0].getAttribute('aria-expanded')).toBe('true');
  });
});
