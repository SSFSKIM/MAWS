// UX wave U6b-3a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-3a-what-changed.md, M2; acceptance B1 to B5 in unit
// tests; sequences S2 to S5): the Files tab's Changed group, the marks in its tree and the dimmed entries, over C8a's
// host with main as a fake bridge that answers `git.watch` with a status a test sets. Every name is invented.
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilesEntry } from '@shared/ipc/schema/files';
import type { GitFileStatus, GitStatus } from '@shared/ipc/schema/git';
import type { SessionRecord } from '@shared/graph/session';
import { record } from '../../../../../../test/support/builders';
import { connectCodeEvents, connectPanelEvents } from '../../../ipc/events';
import { machineFor } from '../../../ipc/machine';
import { panelHost, registerPanelTool } from '../../../panel/host';
import { useGit } from '../../../stores/git';
import { useLayout } from '../../../stores/layout';
import { currentSet } from '../../../stores/layout-model';
import { useSessions } from '../../../stores/sessions';
import { deferred, fail, installFakeMain, ok as answer } from '../../../test-support/code';
import { A, B, panelOf, resetPanelStores, TestHost } from '../../../test-support/panel';
import { installResizeObserver } from '../../../test-support/resize';
import { REVIEW_COPY } from '../copy';
import { resetKeptOpens } from '../open-file';
import { useViewer } from '../viewer/viewer-store';
import { filesTool, FILES_ROW_HEIGHT } from './FilesTool';
import { measureWith } from './path-cut';
import { useFiles } from './store';
import { resetTreeState, treeOf, useTreeState } from './tree-state';

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const dir = (path: string, more: Partial<FilesEntry> = {}): FilesEntry => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind: 'dir', size: 0, mtimeMs: 0, target: null, ...more });
const file = (path: string, more: Partial<FilesEntry> = {}): FilesEntry => ({ ...dir(path), kind: 'file', size: 10, ...more });

type Entry = Pick<GitFileStatus, 'path'> & Partial<GitFileStatus>;
const entry = (path: string, xy: string, more: Partial<GitFileStatus> = {}): Entry =>
  xy === '??' ? { path, index: '?', worktree: '?', untracked: true, ...more } : { path, index: xy[0], worktree: xy[1], untracked: false, ...more };
function statusOf(files: readonly Entry[], repoRoot = '/r', checkedAt = '2026-11-17T10:00:00.000Z'): GitStatus {
  return {
    repoRoot,
    gitDir: `${repoRoot}/.git`,
    commonDir: `${repoRoot}/.git`,
    isWorktree: false,
    branch: 'main',
    head: 'c0ffee',
    upstream: null,
    remoteUrl: null,
    ahead: 0,
    behind: 0,
    dirty: files.length > 0,
    files: files.map((f) => ({ oldPath: null, index: '.', worktree: '.', untracked: false, ...f })),
    stashCount: 0,
    checkedAt,
  };
}

// The repository of B1: a modified, an added, an untracked, a deleted, a renamed and a conflicted file and an untracked
// folder; two ignored entries beside a plain one.
const TREE: Record<string, FilesEntry[] | string> = {
  '': [dir('/r')],
  '/r': [dir('/r/node_modules', { ignored: true }), dir('/r/notes'), dir('/r/src'), file('/r/README.md'), file('/r/debug.log', { ignored: true })],
  '/r/src': [file('/r/src/cart.ts'), file('/r/src/fresh.ts'), file('/r/src/merge.ts'), file('/r/src/port.ts'), file('/r/src/rates.ts')],
  '/r/notes': [file('/r/notes/idea.md')],
  '/r/node_modules': [],
};
const SEVEN = [
  entry('src/cart.ts', '.M'),
  entry('src/rates.ts', 'A.'),
  entry('src/port.ts', 'R.', { oldPath: 'src/harbor-port.ts' }),
  entry('src/old.ts', '.D'),
  entry('src/merge.ts', 'UU'),
  entry('src/fresh.ts', '??'),
  entry('notes/', '??'),
];

// Main as Files and the git store read it. `lists` and `watches` hold a gate per path a test wants to hold open.
function changedMain(tree: Record<string, FilesEntry[] | string>, statuses: Record<string, GitStatus | string>) {
  const lists = new Map<string, Promise<void>>();
  const watches = new Map<string, Promise<void>>();
  const main = installFakeMain(async (name, input) => {
    if (name === 'layout.get') return answer({ value: null });
    if (name === 'layout.set' || name === 'git.unwatch' || name === 'files.watch' || name === 'files.unwatch') return answer();
    if (name === 'git.diff') return answer({ patch: '', files: [] });
    if (name === 'fs.workflows') return answer({ runs: [] });
    if (name === 'git.watch') {
      const directory = input.directory as string;
      await watches.get(directory);
      const found = statuses[directory];
      if (found === undefined) return fail('not a git repository');
      return typeof found === 'string' ? fail(found) : answer(found);
    }
    if (name === 'files.list') {
      const path = (input.path as string | undefined) ?? '';
      await lists.get(path);
      const found = tree[path];
      if (found === undefined) return fail(`not found: ${path}`);
      return typeof found === 'string' ? fail(found) : answer({ root: path === '' ? null : '/r', path, entries: found, truncated: false });
    }
    if (name === 'files.read') {
      const content = `// ${String(input.path)}\n`;
      return answer({ encoding: 'utf8', content, bytes: content.length, offset: 0, length: content.length, truncated: false, mime: 'text/plain', hash: null, utf8: null });
    }
    return fail(`unexpected ${name}`);
  });
  const hold = (gates: Map<string, Promise<void>>, path: string) => {
    const gate = deferred<void>();
    gates.set(path, gate.promise);
    return () => {
      gates.delete(path);
      gate.resolve();
    };
  };
  return {
    ...main,
    holdList: (path: string) => hold(lists, path),
    holdWatch: (directory: string) => hold(watches, directory),
    listed: (path: string | undefined) => main.callsOf('files.list').filter((input) => input.path === path).length,
  };
}

// happy-dom has no layout: give the tree's scroller a viewport of 600 px so the virtualiser mounts rows.
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

const heading = () => document.querySelector<HTMLElement>('[data-files-changed]');
const changedPaths = () => [...document.querySelectorAll<HTMLElement>('[data-changed-row]')].map((row) => row.getAttribute('data-path'));
const changedRow = (path: string) => document.querySelector<HTMLElement>(`[data-changed-row][data-path="${path}"]`);
const treeRow = (path: string) => document.querySelector<HTMLElement>(`[role="treeitem"][data-kind][data-path="${path}"]`);
const scroller = () => document.querySelector<HTMLElement>('[data-files-scroller]')!;
const filesTab = () => document.querySelector<HTMLElement>('[data-files-tab]')!;
const fileTabs = () => currentSet(useLayout.getState().main).panes.flatMap((pane) => pane.tabs).filter((tab) => tab.kind === 'file');
// The path of the row whose box holds the scroller's offset: the first row in view.
const firstInView = () => {
  const top = Math.floor(scroller().scrollTop / FILES_ROW_HEIGHT) * FILES_ROW_HEIGHT;
  const box = [...scroller().querySelectorAll<HTMLElement>('[role="tree"] > div')].find((element) => element.style.top === `${top}px`);
  return box?.querySelector('[role="treeitem"]')?.getAttribute('data-path') ?? null;
};
const scrollTo = (top: number) => {
  scroller().scrollTop = top;
  fireEvent.scroll(scroller());
};

describe('the Changed group (U6b-3a)', () => {
  const offs: (() => void)[] = [];
  let reviews: unknown[];

  const setRecord = (over: Partial<SessionRecord> = {}) =>
    act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(A, record(A, { directory: '/r', ...over })) })));
  const openTree = async () => {
    render(<TestHost />);
    act(() => void panelHost.addTool('files', { appSessionId: A }));
    await waitFor(() => expect(treeRow('/r')).not.toBeNull());
  };
  const expand = async (path: string) => {
    fireEvent.click(treeRow(path)!);
    await waitFor(() => expect(treeRow(path)!.getAttribute('aria-expanded')).toBe('true'));
    await flush();
  };
  const changed = (main: { emit: ReturnType<typeof installFakeMain>['emit'] }, status: GitStatus) =>
    act(() => main.emit('git.changed', { repoRoot: status.repoRoot, status, reason: 'worktree' }));

  beforeEach(() => {
    resetPanelStores();
    resetKeptOpens();
    resetTreeState();
    useFiles.getState().reset();
    useViewer.getState().reset();
    reviews = [];
    const add = panelHost.addTool.bind(panelHost);
    vi.spyOn(panelHost, 'addTool').mockImplementation(((toolId: string, options: unknown) => {
      if (toolId !== 'review') return add(toolId, options as never);
      reviews.push(options);
      return 'review-tab';
    }) as typeof panelHost.addTool);
    setRecord();
  });
  afterEach(() => {
    cleanup();
    offs.splice(0).forEach((off) => off());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    measureWith(null);
  });
  const connect = () => offs.push(connectCodeEvents(), connectPanelEvents(), registerPanelTool(filesTool));

  it('lists every changed entry with its letter, conflicts first, under a heading that counts them and stands above the tree', async () => {
    changedMain(TREE, { '/r': statusOf(SEVEN) });
    connect();
    await openTree();
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('7'));
    const head = heading()!;
    expect([head.textContent, head.getAttribute('aria-expanded'), head.getAttribute('aria-level'), head.getAttribute('role')]).toEqual(['Changed 7', 'true', '1', 'treeitem']);
    expect(changedPaths()).toEqual(['/r/src/merge.ts', '/r/notes', '/r/src/cart.ts', '/r/src/fresh.ts', '/r/src/old.ts', '/r/src/port.ts', '/r/src/rates.ts']);
    expect(changedPaths().map((path) => changedRow(path!)!.getAttribute('data-letter'))).toEqual(['!', 'U', 'M', 'U', 'D', 'R', 'A']);
    expect(changedPaths().filter((path) => changedRow(path!)!.hasAttribute('data-folder'))).toEqual(['/r/notes']);
    expect(changedPaths().every((path) => changedRow(path!)!.getAttribute('aria-level') === '2')).toBe(true);
    expect(head.compareDocumentPosition(treeRow('/r')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the title is the path the row shows, whole; a rename's is Review's words; a folder's row is its name with its slash
    expect(changedRow('/r/src/cart.ts')!.getAttribute('title')).toBe('src/cart.ts');
    expect(changedRow('/r/src/port.ts')!.getAttribute('title')).toBe(REVIEW_COPY.renamedFrom('src/harbor-port.ts'));
    expect(changedRow('/r/notes')!.getAttribute('title')).toBe('notes/');
    expect(changedRow('/r/notes')!.textContent).toContain('notes/');
    // the letter is hidden from a screen reader, which hears the state after the name; the letter's title says it too
    const mark = changedRow('/r/src/cart.ts')!.querySelector<HTMLElement>('[data-mark]')!;
    expect([mark.getAttribute('aria-hidden'), mark.getAttribute('title'), mark.textContent, mark.className]).toEqual(['true', 'Modified', 'M', expect.stringContaining('text-warning')]);
    expect(changedRow('/r/src/cart.ts')!.textContent).toContain('Modified');
    expect(changedRow('/r/src/merge.ts')!.textContent).toContain('Conflict');
    expect(changedRow('/r/src/merge.ts')!.querySelector('[data-mark]')!.className).toContain('text-danger');
    expect(changedRow('/r/src/rates.ts')!.querySelector('[data-mark]')!.className).toContain('text-success');
  });

  it('a click opens what each kind of row says: a folder in the tree, Review at a deleted file, a file beside the chat, ⌘ a main tab', async () => {
    changedMain(TREE, { '/r': statusOf(SEVEN) });
    connect();
    await openTree();
    await waitFor(() => expect(heading()).not.toBeNull());
    fireEvent.click(changedRow('/r/notes')!);
    await waitFor(() => expect(treeRow('/r/notes')!.getAttribute('aria-expanded')).toBe('true'));
    expect(treeRow('/r/notes')!.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(changedRow('/r/src/old.ts')!);
    expect(reviews).toEqual([{ appSessionId: A, params: { scope: 'uncommitted', path: 'src/old.ts' } }]);
    expect(filesTab().getAttribute('data-file')).toBe(''); // no file's tab for a file that is not on disk
    fireEvent.click(changedRow('/r/src/cart.ts')!);
    await waitFor(() => expect(filesTab().getAttribute('data-file')).toBe('/r/src/cart.ts'));
    expect(useLayout.getState().panelParams[panelOf(A)!.tabs[0].id]).toEqual({ file: '/r/src/cart.ts', line: null, preview: true });
    fireEvent.click(changedRow('/r/src/rates.ts')!, { metaKey: true });
    await waitFor(() => expect(fileTabs().map((tab) => tab.kind === 'file' && tab.path)).toEqual(['/r/src/rates.ts']));
    expect(reviews).toHaveLength(1);
  });

  it('a row outside the session’s folders opens Review at its entry, a file and a folder alike; the file inside opens its tab', async () => {
    setRecord({ directory: '/coast/harbor' });
    changedMain(
      { '': [dir('/coast/harbor')], '/coast/harbor': [dir('/coast/harbor/src')], '/coast/harbor/src': [file('/coast/harbor/src/gauge.ts')] },
      { '/coast/harbor': statusOf([entry('lighthouse/beacon.ts', '.M'), entry('harbor/src/gauge.ts', '.M'), entry('lighthouse/charts/', '??')], '/coast') },
    );
    connect();
    render(<TestHost />);
    act(() => void panelHost.addTool('files', { appSessionId: A }));
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('3'));
    expect(changedPaths()).toEqual(['/coast/harbor/src/gauge.ts', '/coast/lighthouse/beacon.ts', '/coast/lighthouse/charts']);
    const outside = (path: string) => changedRow(path)!.hasAttribute('data-outside');
    expect(changedPaths().map((path) => outside(path!))).toEqual([false, true, true]);
    expect(changedRow('/coast/lighthouse/beacon.ts')!.getAttribute('title')).toBe('lighthouse/beacon.ts · Outside the folders this session works in');
    expect(changedRow('/coast/harbor/src/gauge.ts')!.getAttribute('title')).toBe('src/gauge.ts'); // from the working folder
    expect(changedRow('/coast/harbor/src/gauge.ts')!.textContent).toContain('src/');
    expect(changedRow('/coast/harbor/src/gauge.ts')!.textContent).not.toContain('harbor/');
    expect(changedRow('/coast/lighthouse/beacon.ts')!.textContent).toContain('lighthouse/'); // from the repository's root
    fireEvent.click(changedRow('/coast/lighthouse/beacon.ts')!);
    fireEvent.click(changedRow('/coast/lighthouse/charts')!);
    expect(reviews).toEqual([
      { appSessionId: A, params: { scope: 'uncommitted', path: 'lighthouse/beacon.ts' } },
      { appSessionId: A, params: { scope: 'uncommitted', path: 'lighthouse/charts/' } },
    ]);
    await flush();
    expect(filesTab().getAttribute('data-file')).toBe(''); // no file's tab, no viewer onto a refusal
    fireEvent.click(changedRow('/coast/harbor/src/gauge.ts')!); // the control: inside, the file's tab
    await waitFor(() => expect(filesTab().getAttribute('data-file')).toBe('/coast/harbor/src/gauge.ts'));
    expect(reviews).toHaveLength(2);
  });

  it('draws no Changed row before the roots’ listing has answered, and the rows once it has', async () => {
    const main = changedMain(TREE, { '/r': statusOf(SEVEN) });
    connect();
    const release = main.holdList('');
    render(<TestHost />);
    act(() => void panelHost.addTool('files', { appSessionId: A }));
    await waitFor(() => expect(useGit.getState().entries.size).toBeGreaterThan(0));
    await waitFor(() => expect([...useGit.getState().entries.values()].some((e) => e.status !== null)).toBe(true));
    await flush();
    expect(heading()).toBeNull();
    expect(changedPaths()).toEqual([]);
    release();
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('7'));
    expect(changedPaths()).toHaveLength(7);
  });

  it('marks the tree: the letters in their tones, a dot above each change, U beneath an untracked folder, ignored entries muted', async () => {
    changedMain(TREE, { '/r': statusOf(SEVEN) });
    connect();
    await openTree();
    await waitFor(() => expect(heading()).not.toBeNull());
    await expand('/r/src');
    await expand('/r/notes');
    const attr = (path: string, name: string) => treeRow(path)!.getAttribute(name);
    expect([attr('/r', 'data-dot'), attr('/r/src', 'data-dot'), attr('/r/notes', 'data-dot'), attr('/r/notes', 'data-letter')]).toEqual(['!', '!', null, 'U']);
    expect(treeRow('/r/src')!.textContent).toContain('Contains changes');
    expect(attr('/r/notes/idea.md', 'data-letter')).toBe('U');
    expect(['/r/src/cart.ts', '/r/src/rates.ts', '/r/src/merge.ts', '/r/src/fresh.ts', '/r/src/port.ts'].map((path) => attr(path, 'data-letter'))).toEqual(['M', 'A', '!', 'U', 'R']);
    const tone = (path: string) => treeRow(path)!.querySelector('[data-mark]')!.className;
    expect(tone('/r/src/cart.ts')).toContain('text-warning');
    expect(tone('/r/src/rates.ts')).toContain('text-success');
    expect(tone('/r/src/merge.ts')).toContain('text-danger');
    expect(tone('/r/src')).toContain('text-danger'); // the dot in the weightiest change's colour
    // the mark's slot stands only on a row that carries a mark
    expect(treeRow('/r/README.md')!.querySelector('[data-mark]')).toBeNull();
    expect(treeRow('/r/src/cart.ts')!.querySelector('[data-mark]')).not.toBeNull();
    // ignored entries: the muted name and the words; an entry without the key in the same listing is plain
    for (const path of ['/r/node_modules', '/r/debug.log']) {
      expect(treeRow(path)!.hasAttribute('data-ignored')).toBe(true);
      expect(treeRow(path)!.querySelector('[data-name]')!.className).toContain('text-fg-muted');
      expect(treeRow(path)!.textContent).toContain('Ignored by git');
    }
    expect(treeRow('/r/README.md')!.hasAttribute('data-ignored')).toBe(false);
    expect(treeRow('/r/README.md')!.querySelector('[data-name]')!.className).not.toContain('text-fg-muted');
    expect(treeRow('/r/README.md')!.textContent).not.toContain('Ignored by git');
  });

  it('draws no group, no mark and no error in a folder that is no repository or that git refuses; with a status it draws them', async () => {
    for (const refusal of ['not a git repository', 'fatal: bad config line 1 in file .git/config']) {
      const main = changedMain(TREE, { '/r': refusal });
      connect();
      await openTree();
      await waitFor(() => expect(main.callsOf('git.watch')).toHaveLength(1));
      await flush();
      await expand('/r/src');
      expect(heading()).toBeNull();
      expect(document.querySelectorAll('[data-letter], [data-dot], [data-mark]')).toHaveLength(0);
      expect(document.querySelectorAll('[role="alert"], [data-notice]')).toHaveLength(0);
      expect(treeRow('/r/src/cart.ts')).not.toBeNull(); // the tree lists as it does today
      cleanup();
      offs.splice(0).forEach((off) => off());
      resetTreeState();
      useFiles.getState().reset();
    }
    changedMain(TREE, { '/r': statusOf(SEVEN) }); // the control: the same tree with a status
    connect();
    await openTree();
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('7'));
    expect(treeRow('/r/src')!.getAttribute('data-dot')).toBe('!');
  });

  it('keeps the group drawn when a later read of the status fails (S2)', async () => {
    const statuses: Record<string, GitStatus | string> = { '/r': statusOf(SEVEN) };
    const main = changedMain(TREE, statuses);
    connect();
    await openTree();
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('7'));
    statuses['/r'] = 'the link to the machine dropped';
    const release = useGit.getState().watch(machineFor(A), '/r', B); // another surface's read, which fails
    await waitFor(() => expect(main.callsOf('git.watch')).toHaveLength(2));
    await flush();
    expect(heading()?.getAttribute('data-count')).toBe('7');
    expect(changedPaths()).toHaveLength(7);
    release();
  });

  it('keeps the first tree row in view where it was when the group grows, and leaves a list at its top where it is (S2)', async () => {
    const many = Array.from({ length: 60 }, (_, i) => file(`/r/src/f${String(i).padStart(2, '0')}.ts`));
    const main = changedMain({ ...TREE, '/r/src': many }, { '/r': statusOf([entry('src/f00.ts', '.M')]) });
    connect();
    await openTree();
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('1'));
    await expand('/r/src');
    scrollTo(30 * FILES_ROW_HEIGHT + 5);
    const before = firstInView();
    expect(before).toMatch(/^\/r\/src\/f/); // a tree row
    changed(main, statusOf([entry('src/f00.ts', '.M'), entry('src/f01.ts', '.M'), entry('src/f02.ts', '.M'), entry('src/f03.ts', '.M')]));
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('4'));
    fireEvent.scroll(scroller());
    expect(scroller().scrollTop).toBe(33 * FILES_ROW_HEIGHT + 5);
    expect(firstInView()).toBe(before);
    changed(main, statusOf([entry('src/f00.ts', '.M')])); // and back: the group loses three rows
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('1'));
    fireEvent.scroll(scroller());
    expect(scroller().scrollTop).toBe(30 * FILES_ROW_HEIGHT + 5);
    expect(firstInView()).toBe(before);
    scrollTo(0); // at the list's top the group grows in view
    changed(main, statusOf([entry('src/f00.ts', '.M'), entry('src/f01.ts', '.M')]));
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('2'));
    expect(scroller().scrollTop).toBe(0);
  });

  it('keeps Refresh on the first root’s row, with its room, while a Changed group stands above it, and with none', async () => {
    const main = changedMain(TREE, { '/r': statusOf(SEVEN.slice(0, 3)) });
    connect();
    await openTree();
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('3'));
    const refresh = () => within(scroller()).queryByRole('button', { name: 'Refresh' });
    const box = (element: Element) => element.closest<HTMLElement>('[style*="top"]')!;
    expect(refresh()).not.toBeNull();
    expect(box(refresh()!).style.top).toBe(box(treeRow('/r')!).style.top);
    expect(box(treeRow('/r')!).style.top).toBe(`${4 * FILES_ROW_HEIGHT}px`);
    expect(box(treeRow('/r')!).className).toContain('pr-8');
    changed(main, statusOf([])); // clean: no group, and Refresh where it is today
    await waitFor(() => expect(heading()).toBeNull());
    expect(refresh()).not.toBeNull();
    expect(box(refresh()!).style.top).toBe('0px');
    expect(box(treeRow('/r')!).className).toContain('pr-8');
  });

  it('folds the group to its heading by a press, keeping the count and the tree’s marks; a second press opens it', async () => {
    changedMain(TREE, { '/r': statusOf(SEVEN) });
    connect();
    await openTree();
    await waitFor(() => expect(heading()).not.toBeNull());
    await expand('/r/src');
    fireEvent.click(heading()!);
    await waitFor(() => expect(changedPaths()).toEqual([]));
    expect([heading()!.getAttribute('data-count'), heading()!.getAttribute('aria-expanded'), heading()!.textContent]).toEqual(['7', 'false', 'Changed 7']);
    expect(treeRow('/r/src/cart.ts')!.getAttribute('data-letter')).toBe('M');
    expect(treeOf(useTreeState.getState(), A).changedFolded).toBe(true);
    fireEvent.click(heading()!);
    await waitFor(() => expect(changedPaths()).toHaveLength(7));
    expect(heading()!.getAttribute('aria-expanded')).toBe('true');
  });

  it('selects only the tree’s row of the file in view, its letter in the row’s colour; the Changed row of the same path stays plain', async () => {
    changedMain(TREE, { '/r': statusOf(SEVEN) });
    connect();
    await openTree();
    await waitFor(() => expect(heading()).not.toBeNull());
    await expand('/r/src');
    fireEvent.click(changedRow('/r/src/cart.ts')!);
    await waitFor(() => expect(treeRow('/r/src/cart.ts')!.getAttribute('aria-selected')).toBe('true'));
    expect(changedRow('/r/src/cart.ts')!.getAttribute('aria-selected')).toBe('false');
    expect(treeRow('/r/src/cart.ts')!.querySelector('[data-mark]')!.className).not.toContain('text-warning');
    expect(changedRow('/r/src/cart.ts')!.querySelector('[data-mark]')!.className).toContain('text-warning');
  });

  // Decision 14 (b), S3: the tree remembers the set of the last status it drew from
  describe('a status that changes what is ignored', () => {
    const TWO_ROOTS = { ...TREE, '': [dir('/r'), dir('/docs')], '/docs': [file('/docs/guide.md')] };
    const first = statusOf([entry('src/cart.ts', '.M')]);
    const moved = statusOf([entry('src/cart.ts', '.M'), entry('src/rates.ts', 'A.')]);
    beforeEach(() => setRecord({ additionalDirectories: ['/docs'] }));
    const ready = async (main: ReturnType<typeof changedMain>) => {
      await openTree();
      await expand('/r/src');
      fireEvent.click(treeRow('/docs')!);
      await waitFor(() => expect(main.listed('/docs')).toBe(1));
      await flush();
    };
    const counts = (main: ReturnType<typeof changedMain>) => ['/r', '/r/src', '/docs'].map((path) => main.listed(path));

    it('lists again each drawn directory under the repository’s root once, and none of another root', async () => {
      const main = changedMain(TWO_ROOTS, { '/r': first });
      connect();
      await ready(main);
      const before = counts(main);
      changed(main, moved);
      await flush();
      expect(counts(main)).toEqual([before[0] + 1, before[1] + 1, before[2]]);
    });

    it('lists nothing again for a status that differs only in when it was read, nor for a same set rewritten', async () => {
      const main = changedMain(TWO_ROOTS, { '/r': first });
      connect();
      await ready(main);
      const before = counts(main);
      changed(main, statusOf([entry('src/cart.ts', '.M')], '/r', '2026-11-17T10:05:00.000Z'));
      changed(main, { ...first, ahead: 2 });
      await flush();
      expect(counts(main)).toEqual(before);
      changed(main, moved); // the control: a set that changed
      await flush();
      expect(counts(main)).toEqual([before[0] + 1, before[1] + 1, before[2]]);
    });

    it('lists nothing again for the first status the tree receives', async () => {
      const main = changedMain(TWO_ROOTS, { '/r': first });
      const release = main.holdWatch('/r');
      connect();
      await ready(main);
      const before = counts(main);
      release();
      await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('1'));
      await flush();
      expect(counts(main)).toEqual(before);
      changed(main, moved); // the control
      await flush();
      expect(counts(main)[1]).toBe(before[1] + 1);
    });

    it('asks each directory twice and never three times for two set changes in a row with the first flight held', async () => {
      const main = changedMain(TWO_ROOTS, { '/r': first });
      connect();
      await ready(main);
      const before = main.listed('/r/src');
      const release = main.holdList('/r/src');
      changed(main, moved);
      await flush();
      expect(main.listed('/r/src')).toBe(before + 1);
      changed(main, statusOf([entry('src/cart.ts', '.M'), entry('src/rates.ts', 'A.'), entry('src/port.ts', '.M')]));
      await flush();
      expect(main.listed('/r/src')).toBe(before + 1); // waiting behind the flight
      release();
      await flush();
      await flush();
      expect(main.listed('/r/src')).toBe(before + 2);
    });
  });

  // S4: a folder opened in the tree from its Changed row is scrolled into view once its row exists
  describe('a folder opened in the tree', () => {
    const DEEP: Record<string, FilesEntry[] | string> = {
      '': [dir('/r')],
      '/r': [dir('/r/a'), file('/r/README.md')],
      '/r/a': [...Array.from({ length: 40 }, (_, i) => dir(`/r/a/c${String(i).padStart(2, '0')}`)), dir('/r/a/b')],
      '/r/a/b': [dir('/r/a/b/new'), file('/r/a/b/z.ts')],
      '/r/a/b/new': [file('/r/a/b/new/tide.md')],
    };
    const status = statusOf([entry('a/b/new/', '??')]);

    it('scrolls the folder into view when its row arrives two listings later, selected, and forgets the note', async () => {
      const main = changedMain(DEEP, { '/r': status });
      connect();
      await openTree();
      await waitFor(() => expect(heading()).not.toBeNull());
      const releaseA = main.holdList('/r/a');
      const releaseB = main.holdList('/r/a/b');
      fireEvent.click(changedRow('/r/a/b/new')!);
      expect(treeOf(useTreeState.getState(), A).reveal).toBe('/r/a/b/new');
      releaseA();
      await waitFor(() => expect(treeRow('/r/a/b')).not.toBeNull());
      expect(treeOf(useTreeState.getState(), A).reveal).toBe('/r/a/b/new'); // not there yet
      expect(scroller().scrollTop).toBe(0);
      releaseB();
      await waitFor(() => expect(treeOf(useTreeState.getState(), A).reveal).toBeNull());
      fireEvent.scroll(scroller());
      await waitFor(() => expect(treeRow('/r/a/b/new')).not.toBeNull());
      const top = Number.parseFloat(treeRow('/r/a/b/new')!.closest<HTMLElement>('[style*="top"]')!.style.top);
      expect(top).toBeGreaterThan(600); // out of the first view
      expect(top).toBeGreaterThanOrEqual(scroller().scrollTop);
      expect(top + FILES_ROW_HEIGHT).toBeLessThanOrEqual(scroller().scrollTop + 600);
      expect(treeRow('/r/a/b/new')!.getAttribute('aria-selected')).toBe('true');
      expect(treeRow('/r/a/b/new')!.getAttribute('aria-expanded')).toBe('true');
    });

    it('drops the note when the person scrolls first, and the list stays where it is', async () => {
      const main = changedMain(DEEP, { '/r': status });
      connect();
      await openTree();
      await waitFor(() => expect(heading()).not.toBeNull());
      const releaseA = main.holdList('/r/a');
      fireEvent.click(changedRow('/r/a/b/new')!);
      fireEvent.wheel(scroller());
      expect(treeOf(useTreeState.getState(), A).reveal).toBeNull();
      releaseA();
      await waitFor(() => expect(treeRow('/r/a/b/new')).not.toBeNull());
      await flush();
      expect(scroller().scrollTop).toBe(0);
    });
  });

  // S5: the watch is keyed on the working folder
  it('follows the working folder when it moves: the new folder’s group once its status comes, and that first status lists nothing', async () => {
    const tree = { ...TREE, '': [dir('/r'), dir('/wt')], '/wt': [file('/wt/w.ts')] };
    const main = changedMain(tree, { '/r': statusOf(SEVEN), '/wt': statusOf([entry('w.ts', '.M')], '/wt') });
    connect();
    await openTree();
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('7'));
    const release = main.holdWatch('/wt');
    setRecord({ agentFolder: { checkout: '/wt', cwd: '/wt', branch: 'w', linked: true } });
    await waitFor(() => expect(main.callsOf('git.watch').map((input) => input.directory)).toEqual(['/r', '/wt']));
    await waitFor(() => expect(heading()).toBeNull()); // no rows until the new folder's status comes
    await waitFor(() => expect(main.callsOf('git.unwatch').map((input) => input.directory)).toEqual(['/r']));
    await waitFor(() => expect(treeRow('/wt')?.getAttribute('aria-expanded')).toBe('true'));
    await flush();
    const before = ['/r', '/wt'].map((path) => main.listed(path));
    release();
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('1'));
    expect(changedPaths()).toEqual(['/wt/w.ts']);
    await flush();
    expect(['/r', '/wt'].map((path) => main.listed(path))).toEqual(before);
  });

  // Decision Log 8: each distinct string measured once per font, and only for the drawn rows
  it('measures each distinct string once per font, and only for the drawn rows, over a list scrolled through twice', async () => {
    const observer = installResizeObserver();
    const calls: string[] = [];
    measureWith((font, text) => {
      calls.push(`${font}\n${text}`);
      return text.length * 7;
    });
    const files = Array.from({ length: 120 }, (_, i) => entry(`deep/folder-${String(i).padStart(3, '0')}/sub/file-${String(i).padStart(3, '0')}.ts`, '.M'));
    changedMain(TREE, { '/r': statusOf(files) });
    connect();
    await openTree();
    await waitFor(() => expect(heading()?.getAttribute('data-count')).toBe('120'));
    observer.resize(scroller(), { width: 220, height: 600 });
    await flush();
    const drawn = calls.length;
    expect(drawn).toBeGreaterThan(0);
    const pass = async () => {
      for (let top = 0; top <= 124 * FILES_ROW_HEIGHT; top += 10 * FILES_ROW_HEIGHT) {
        act(() => scrollTo(top));
        await flush();
      }
      act(() => scrollTo(0));
      await flush();
    };
    await pass();
    const once = calls.length;
    expect(once).toBeGreaterThan(drawn); // the rows first drawn were not all of them
    await pass();
    expect(calls.length).toBe(once);
    expect(new Set(calls).size).toBe(calls.length);
    expect(changedRow('/r/deep/folder-000/sub/file-000.ts')!.textContent).toContain('…');
  });
});
