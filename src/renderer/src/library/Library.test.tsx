// The Artifacts tab (the P3-L execution document, M4; Decision Log 13, 14): the three views over main's index, the
// type filter whose counts follow the view and the search, the date and Space groups, each row's facts, every row
// action through its command (Delete confirmed, a design system in use answered by naming what uses it), "Make
// something new" per kind, the Spaces' management, and the keyboard.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { LibraryFilter, LibraryRow, LibrarySpace } from '@shared/ipc/schema/library';
import { formatAgo } from '../app/date-format';
import { registerArtifactEditor, resetArtifactEditors } from '../artifacts/registry';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { installFakeMain, ok } from '../test-support/code';
import { resetShellStores } from '../test-support/shell-stores';
import { useLibraryDialog } from './dialogs';
import { Library } from './Library';
import { connectLibrary, resetLibrary } from './store';
import { resetLibraryView } from './view';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORK = id(0xa1);
const HOME = id(0xa2);
const S = (n: number) => `app-s${n}` as AppSessionId;
const NOW = Date.now();
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

function row(n: number, over: Partial<LibraryRow> = {}): LibraryRow {
  return {
    id: id(n),
    kind: 'document',
    title: `Artifact ${n}`,
    createdBy: { kind: 'human' },
    createdAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
    lastViewedAt: null,
    pinned: false,
    agentEditsAsSuggestions: false,
    revision: 1,
    lastEditor: { kind: 'human' },
    lastEditedAt: NOW - HOUR,
    sessions: [],
    ...over,
  };
}

// What main's index holds, and how `library.list` filters it (as M1's store does: counts without the kind).
let rows: LibraryRow[];
let spaces: LibrarySpace[];
let main: ReturnType<typeof installFakeMain>;
let answers: Partial<Record<string, (input: Record<string, unknown>) => unknown>>;

function admits(r: LibraryRow, f: LibraryFilter, withKind: boolean): boolean {
  if (withKind && f.kind && r.kind !== f.kind) return false;
  if (f.pinned !== undefined && r.pinned !== f.pinned) return false;
  if (f.spaceId !== undefined && (r.space?.id ?? null) !== f.spaceId) return false;
  if (f.query && !r.title.toLowerCase().includes(f.query.toLowerCase())) return false;
  return true;
}
function list(filter: LibraryFilter = {}) {
  const counts = Object.fromEntries(ARTIFACT_KINDS.map((k) => [k, 0])) as Record<ArtifactKind, number>;
  for (const r of rows) if (admits(r, filter, false)) counts[r.kind] += 1;
  return { rows: rows.filter((r) => admits(r, filter, true)).sort((a, b) => b.updatedAt - a.updatedAt), counts };
}
const host = (r: LibraryRow) => {
  const { lastEditor: _e, lastEditedAt: _t, sessions: _s, space: _sp, project: _p, snippet: _n, ...entity } = r;
  void [_e, _t, _s, _sp, _p, _n];
  return entity;
};

const changed = async () => {
  await act(async () => main.emit('library.changed', { revision: 2 }));
};
const offs: (() => void)[] = [];
const libraryCalls = () => main.callsOf('library.list').map((c) => (c as { filter?: LibraryFilter }).filter ?? {});
const article = (title: string) => screen.getByRole('article', { name: title });
const tabIds = () => allTabs(useLayout.getState().main).map((t) => t.id);

// happy-dom has no layout: the list's scroller gets a viewport so the virtualiser mounts its rows.
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-library-scroller') ? 4000 : 0;
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

beforeEach(() => {
  resetShellStores();
  resetLibrary();
  resetLibraryView();
  resetArtifactEditors();
  useLibraryDialog.setState({ open: null });
  spaces = [
    { id: WORK, name: 'Work', createdAt: 1, linkedDir: '/Users/me/work', count: 1 },
    { id: HOME, name: 'Home', createdAt: 1, count: 0 },
  ];
  rows = [
    row(1, { title: 'Launch plan', kind: 'document', updatedAt: NOW - HOUR, space: { id: WORK, name: 'Work' }, project: { id: 'p1' as ProjectId, name: 'maws' } }),
    row(2, { title: 'Pricing page', kind: 'html', updatedAt: NOW - 2 * HOUR, pinned: true }),
    row(3, { title: 'Quarterly deck', kind: 'presentation', updatedAt: NOW - 400 * DAY }),
    row(4, { title: 'export.csv', kind: 'file', updatedAt: NOW - 2 * HOUR }),
  ];
  answers = {};
  main = installFakeMain((name, input) => {
    const answer = answers[name];
    if (answer) return answer(input) as never;
    if (name === 'library.list') return ok(list((input as { filter?: LibraryFilter }).filter));
    if (name === 'library.spaces') return ok({ spaces });
    if (name === 'library.get') return ok({ row: rows.find((r) => r.id === input.artifactId) ?? null });
    if (name === 'artifacts.update' || name === 'artifacts.duplicate') return ok({ artifact: host(rows.find((r) => r.id === input.artifactId)!) });
    if (name === 'artifacts.create') return ok({ artifact: host(row(99, { kind: input.kind as ArtifactKind, title: input.title as string })) });
    if (name === 'artifacts.delete' || name === 'spaces.delete') return ok();
    if (name === 'spaces.create') return ok({ space: { id: id(0xa9), name: input.name, createdAt: 1, ...(input.linkedDir ? { linkedDir: input.linkedDir } : {}) } });
    if (name === 'spaces.update') {
      const { spaceId, ...patch } = input;
      const { count: _count, ...space } = spaces.find((s) => s.id === spaceId)!;
      void _count;
      return ok({ space: { ...space, ...patch } });
    }
    return new Promise(() => {});
  });
  offs.push(connectLibrary());
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: unknown }).maws;
  offs.splice(0).forEach((off) => off());
});

describe('the views and the groups', () => {
  it('All lists every artifact, Pinned first, then by date; a read of the index again follows library.changed', async () => {
    render(<Library />);
    await screen.findByRole('article', { name: 'Launch plan' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Make something new', 'Pinned', 'Today', 'Older']);
    const order = screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'));
    expect(order).toEqual(['Pricing page', 'Launch plan', 'export.csv', 'Quarterly deck']);

    rows = [...rows, row(5, { title: 'Agent notes', updatedAt: NOW })];
    await changed();
    await screen.findByRole('article', { name: 'Agent notes' });
  });

  it('Pinned shows only pinned artifacts, by date; By Space one group per Space, then No Space', async () => {
    const user = userEvent.setup();
    render(<Library />);
    await screen.findByRole('article', { name: 'Launch plan' });
    await user.click(screen.getByRole('radio', { name: 'Pinned' }));
    await waitFor(() => expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Pricing page']));
    expect(libraryCalls()).toContainEqual({ pinned: true });
    expect(screen.queryByRole('heading', { name: 'Make something new' })).toBeNull();

    await user.click(screen.getByRole('radio', { name: 'By Space' }));
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Home', 'Work', 'No Space']));
    expect(screen.getByText('Nothing in this Space yet')).toBeTruthy();
    expect(screen.getByText('Mirrored to /Users/me/work/artifacts')).toBeTruthy();
  });

  it('a row’s Space chip narrows By Space to it, and new artifacts are made there', async () => {
    const user = userEvent.setup();
    const created = vi.fn();
    registerArtifactEditor('document', { Panel: () => null, createState: created });
    render(<Library />);
    await screen.findByRole('article', { name: 'Launch plan' });
    await user.click(within(article('Launch plan')).getByRole('button', { name: 'Work' }));
    await waitFor(() => expect(libraryCalls()).toContainEqual({ spaceId: WORK }));
    expect(screen.getByRole('radio', { name: 'By Space' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('heading', { level: 2, name: 'Work' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'New document' }));
    await waitFor(() => expect(main.callsOf('artifacts.create')).toEqual([{ kind: 'document', title: 'Untitled document', spaceId: WORK }]));

    await user.click(screen.getByRole('button', { name: 'All Spaces' }));
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Home', 'Work', 'No Space']));
  });

  it('says what puts artifacts here when a view is empty', async () => {
    rows = [];
    spaces = [];
    const user = userEvent.setup();
    render(<Library />);
    await screen.findByText(/Nothing here yet/);
    await user.click(screen.getByRole('radio', { name: 'Pinned' }));
    await screen.findByText('Pin an artifact from its menu to keep it here.');
    await user.click(screen.getByRole('radio', { name: 'By Space' }));
    await screen.findByText(/A Space is a named folder for artifacts/);
  });

  it('a failed read keeps nothing it never had and offers Try again', async () => {
    answers['library.list'] = () => ({ ok: false, error: { code: 'internal', message: 'the index is unavailable' } });
    const user = userEvent.setup();
    render(<Library />);
    await screen.findByText('Couldn’t read the library: the index is unavailable');
    delete answers['library.list'];
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('article', { name: 'Launch plan' });
  });
});

describe('search and the type filter', () => {
  it('the type filter’s counts follow the view and the search; choosing a type asks main for it', async () => {
    const user = userEvent.setup();
    render(<Library />);
    await screen.findByRole('article', { name: 'Launch plan' });
    const counts = async () => {
      await user.click(screen.getByRole('button', { name: /Filter by type/ }));
      const menu = await screen.findByRole('menu');
      const items = within(menu).getAllByRole('menuitemradio').map((item) => item.textContent);
      await user.keyboard('{Escape}');
      return items;
    };
    expect(await counts()).toEqual(['All types4', 'Documents1', 'Presentations1', 'Designs0', 'Design systems0', 'Dashboards0', 'HTML pages1', 'Files1']);

    await user.click(screen.getByRole('radio', { name: 'Pinned' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    expect(await counts()).toEqual(['All types1', 'Documents0', 'Presentations0', 'Designs0', 'Design systems0', 'Dashboards0', 'HTML pages1', 'Files0']);

    await user.click(screen.getByRole('radio', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search artifacts' }), 'pla');
    await waitFor(() => expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['Launch plan']));
    expect(libraryCalls()).toContainEqual({ query: 'pla' });
    expect(screen.queryByRole('heading', { name: 'Make something new' }), 'a search shows only what it found').toBeNull();
    expect(await counts()).toEqual(['All types1', 'Documents1', 'Presentations0', 'Designs0', 'Design systems0', 'Dashboards0', 'HTML pages0', 'Files0']);

    await user.click(screen.getByRole('button', { name: /Filter by type/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: /Presentations/ }));
    await waitFor(() => expect(libraryCalls()).toContainEqual({ kind: 'presentation', query: 'pla' }));
    await screen.findByText('No artifacts match “pla”.');
    expect(screen.getByRole('button', { name: /Filter by type/ }).textContent).toContain('Presentations');
  });

  it('shows the matched passage of a row’s text under a search', async () => {
    rows = [row(1, { title: 'Notes', snippet: '…the launch window opens…' })];
    answers['library.list'] = () => ok({ rows, counts: list({}).counts }); // main's search matched the row's text, not its title
    const user = userEvent.setup();
    render(<Library />);
    await screen.findByRole('article', { name: 'Notes' });
    await user.type(screen.getByRole('searchbox', { name: 'Search artifacts' }), 'window');
    await waitFor(() => expect(within(article('Notes')).getByText('…the launch window opens…')).toBeTruthy());
  });
});

describe('a row', () => {
  it('shows its kind, title, Space, project, last editor and time, and the sessions that touched it', async () => {
    const sessions = [1, 2, 3, 4].map((n) => ({ appSessionId: S(n), title: `Session ${n}`, roles: n === 1 ? (['created', 'edited'] as const) : (['viewed'] as const), lastAt: NOW - n * HOUR }));
    rows = [
      row(1, { title: 'Launch plan', space: { id: WORK, name: 'Work' }, project: { id: 'p1' as ProjectId, name: 'maws' }, lastEditor: { kind: 'session', appSessionId: S(1) }, lastEditedAt: NOW - 3 * 60_000, sessions: sessions.map((s) => ({ ...s, roles: [...s.roles] })) }),
      row(2, { title: 'Mine', kind: 'html', lastEditor: { kind: 'human' }, lastEditedAt: NOW - 2 * HOUR }),
      row(3, { title: 'Unknown session', lastEditor: { kind: 'session', appSessionId: S(9) }, sessions: [{ appSessionId: S(9), title: '', roles: ['created'], lastAt: NOW }] }),
    ];
    render(<Library />);
    const launch = await screen.findByRole('article', { name: 'Launch plan' });
    expect(within(launch).getByText('Document')).toBeTruthy();
    expect(within(launch).getByRole('button', { name: 'Work' })).toBeTruthy();
    expect(within(launch).getByText('maws')).toBeTruthy();
    expect(within(launch).getByText(`Edited ${formatAgo(3 * 60_000)} by Session 1`)).toBeTruthy();
    const chips = within(launch).getAllByRole('button', { name: /^Session \d/ });
    expect(chips.map((c) => c.textContent)).toEqual(['Session 1', 'Session 2', 'Session 3']);
    expect(chips[0].getAttribute('title')).toMatch(/^Session 1: created, edited, /);
    expect(within(launch).getByText('+1').getAttribute('title')).toContain('Session 4');
    expect(within(article('Mine')).getByText('HTML page')).toBeTruthy();
    expect(within(article('Mine')).getByText(/Edited .* by You/)).toBeTruthy();
    expect(within(article('Unknown session')).getByText(/by Claude$/)).toBeTruthy();
    expect(within(article('Unknown session')).getByRole('button', { name: 'Untitled session' })).toBeTruthy();
  });

  it('opens its artifact in a main tab on a click, and a session chip opens the session beside the library', async () => {
    rows = [row(1, { title: 'Launch plan', sessions: [{ appSessionId: S(1), title: 'Session 1', roles: ['created'], lastAt: NOW }] })];
    const user = userEvent.setup();
    render(<Library />);
    await user.click(await screen.findByRole('article', { name: 'Launch plan' }));
    expect(tabIds()).toContain(`artifact:${id(1)}`);
    await user.click(within(article('Launch plan')).getByRole('button', { name: 'Session 1' }));
    expect(tabIds()).toContain('session:app-s1');
    expect(tabIds(), 'the artifact tab stays').toContain(`artifact:${id(1)}`);
  });

  it('the keyboard: arrows move between rows, Enter opens, Shift+F10 opens the row’s menu', async () => {
    const user = userEvent.setup();
    render(<Library />);
    const first = await screen.findByRole('article', { name: 'Pricing page' });
    expect(first.tabIndex).toBe(0);
    expect(article('Launch plan').tabIndex).toBe(-1);
    first.focus();
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(document.activeElement).toBe(article('Launch plan')));
    await user.keyboard('{End}');
    await waitFor(() => expect(document.activeElement).toBe(article('Quarterly deck')));
    await user.keyboard('{ArrowUp}{Enter}');
    expect(tabIds()).toContain(`artifact:${id(4)}`);
    await user.keyboard('{Shift>}{F10}{/Shift}');
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Rename…' })).toBeTruthy();
  });
});

describe('the row actions', () => {
  // A submenu's item is clicked without moving the pointer there: happy-dom has no layout, so Radix's pointer grace
  // would read the move as leaving the submenu and close it first.
  const openMenu = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
    await user.click(within(await screen.findByRole('article', { name: title })).getByRole('button', { name: `Actions for ${title}` }));
    return screen.findByRole('menu');
  };

  it('Pin and Unpin, Duplicate, and Move to Space call their commands', async () => {
    const user = userEvent.setup();
    render(<Library />);
    await user.click(within(await openMenu(user, 'Launch plan')).getByRole('menuitem', { name: 'Pin' }));
    await waitFor(() => expect(main.callsOf('artifacts.update')).toEqual([{ artifactId: id(1), pinned: true }]));
    await user.click(within(await openMenu(user, 'Pricing page')).getByRole('menuitem', { name: 'Unpin' }));
    await waitFor(() => expect(main.callsOf('artifacts.update')).toContainEqual({ artifactId: id(2), pinned: false }));
    await user.click(within(await openMenu(user, 'Launch plan')).getByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(main.callsOf('artifacts.duplicate')).toEqual([{ artifactId: id(1) }]));

    await user.click(within(await openMenu(user, 'Pricing page')).getByRole('menuitem', { name: 'Move to Space' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Home' }));
    await waitFor(() => expect(main.callsOf('artifacts.update')).toContainEqual({ artifactId: id(2), spaceId: HOME }));
    await user.click(within(await openMenu(user, 'Launch plan')).getByRole('menuitem', { name: 'Move to Space' }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'No Space' }));
    await waitFor(() => expect(main.callsOf('artifacts.update')).toContainEqual({ artifactId: id(1), spaceId: null }));
  });

  it('Move to Space › New Space… makes the Space and moves the artifact into it', async () => {
    const user = userEvent.setup();
    render(<Library />);
    await user.click(within(await openMenu(user, 'Launch plan')).getByRole('menuitem', { name: 'Move to Space' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'New Space…' }));
    const sheet = await screen.findByRole('dialog', { name: 'New Space' });
    await user.type(within(sheet).getByRole('textbox', { name: 'Name' }), 'Research');
    await user.click(within(sheet).getByRole('button', { name: 'Create and move “Launch plan”' }));
    await waitFor(() => expect(main.callsOf('artifacts.update')).toEqual([{ artifactId: id(1), spaceId: id(0xa9) }]));
    expect(main.callsOf('spaces.create')).toEqual([{ name: 'Research' }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Rename goes through its sheet', async () => {
    const user = userEvent.setup();
    render(<Library />);
    await user.click(within(await openMenu(user, 'Launch plan')).getByRole('menuitem', { name: 'Rename…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Rename artifact' });
    const field = within(sheet).getByRole('textbox', { name: 'Title' });
    expect((field as HTMLInputElement).value).toBe('Launch plan');
    await user.clear(field);
    await user.type(field, 'Launch plan v2{Enter}');
    await waitFor(() => expect(main.callsOf('artifacts.update')).toEqual([{ artifactId: id(1), title: 'Launch plan v2' }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Delete asks first, and deletes only on confirmation', async () => {
    const user = userEvent.setup();
    render(<Library />);
    await user.click(within(await openMenu(user, 'Launch plan')).getByRole('menuitem', { name: 'Delete…' }));
    let sheet = await screen.findByRole('dialog', { name: 'Delete “Launch plan”?' });
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(main.callsOf('artifacts.delete')).toEqual([]);
    await user.click(within(await openMenu(user, 'Launch plan')).getByRole('menuitem', { name: 'Delete…' }));
    sheet = await screen.findByRole('dialog', { name: 'Delete “Launch plan”?' });
    await user.click(within(sheet).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(main.callsOf('artifacts.delete')).toEqual([{ artifactId: id(1) }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('a design system still in use is not deleted: a dialog names what uses it, each opening in a tab', async () => {
    rows = [row(1, { title: 'House style', kind: 'design_system' }), row(2, { title: 'Brief' }), row(3, { title: 'Deck', kind: 'presentation' })];
    answers['artifacts.delete'] = () => ({ ok: false, error: { code: 'invalid_input', message: 'the design system is in use', issues: { reason: 'designSystemInUse', data: { artifactIds: [id(2), id(3)] } } } });
    const user = userEvent.setup();
    render(<Library />);
    await user.click(within(await openMenu(user, 'House style')).getByRole('menuitem', { name: 'Delete…' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete “House style”?' })).getByRole('button', { name: 'Delete' }));
    const sheet = await screen.findByRole('dialog', { name: 'This design system is in use' });
    expect(within(sheet).getByText(/“House style” styles the artifacts below/)).toBeTruthy();
    await within(sheet).findByRole('button', { name: 'Brief' });
    expect(within(sheet).getByRole('button', { name: 'Deck' })).toBeTruthy();
    await user.click(within(sheet).getByRole('button', { name: 'Deck' }));
    expect(tabIds()).toContain(`artifact:${id(3)}`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a refused write is said in a toast', async () => {
    answers['artifacts.duplicate'] = () => ({ ok: false, error: { code: 'internal', message: 'the store is read-only' } });
    const { useNotices } = await import('../stores/notices');
    const user = userEvent.setup();
    render(<Library />);
    await user.click(within(await openMenu(user, 'Launch plan')).getByRole('menuitem', { name: 'Duplicate' }));
    await waitFor(() => expect(useNotices.getState().notices.map((n) => n.text)).toContain('the store is read-only'));
  });
});

describe('Make something new', () => {
  it('a kind with an editor makes an untitled one and opens it; the others ask Claude; HTML only asks Claude; File adds a file', async () => {
    registerArtifactEditor('document', { Panel: () => null });
    const creator = vi.fn(async () => S(7));
    offs.push(registerSessionCreator(creator));
    answers['layout.pickFiles'] = () => ok({ files: [{ path: '/Users/me/report.pdf', name: 'report.pdf', bytes: 10, mediaType: null, data: null }] });
    const user = userEvent.setup();
    render(<Library />);
    const section = await screen.findByRole('region', { name: 'Make something new' });
    const card = (kind: string) => within(section).getByRole('group', { name: kind });

    expect(within(card('Document')).getAllByRole('button').map((b) => b.textContent)).toEqual(['New', 'Ask Claude']);
    expect(within(card('Presentation')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Ask Claude']);
    expect(within(card('HTML page')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Ask Claude']);
    expect(within(card('File')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Add a file…', 'Ask Claude']);

    await user.click(within(card('Document')).getByRole('button', { name: 'New document' }));
    await waitFor(() => expect(main.callsOf('artifacts.create')).toEqual([{ kind: 'document', title: 'Untitled document' }]));
    await waitFor(() => expect(tabIds()).toContain(`artifact:${id(99)}`));

    await user.click(within(card('File')).getByRole('button', { name: 'Add a file…' }));
    await waitFor(() => expect(main.callsOf('artifacts.create')).toContainEqual({ kind: 'file', title: 'report.pdf', content: { path: '/Users/me/report.pdf' } }));
    expect(main.callsOf('layout.pickFiles')).toEqual([{ kind: 'files', directory: null, multiple: false, pathsOnly: true }]);

    await user.click(within(card('Presentation')).getByRole('button', { name: 'Ask Claude to make a presentation' }));
    await waitFor(() => expect(creator).toHaveBeenCalledWith(null));
    expect(useComposerStore.getState().prefills.get(S(7))).toEqual({ text: 'Make a presentation: ' });
    expect(tabIds()).toContain('session:app-s7');
  });

  it('a kind whose editor lands later gains its New at once', async () => {
    render(<Library />);
    const section = await screen.findByRole('region', { name: 'Make something new' });
    expect(within(section).queryByRole('button', { name: 'New design' })).toBeNull();
    act(() => void registerArtifactEditor('design', { Panel: () => null }));
    expect(within(section).getByRole('button', { name: 'New design' })).toBeTruthy();
  });
});

describe('Spaces', () => {
  it('New Space names it and can link a folder', async () => {
    answers['layout.pickFiles'] = () => ok({ files: [{ path: '/Users/me/proj', name: 'proj', bytes: 0, mediaType: null, data: null }] });
    const user = userEvent.setup();
    render(<Library />);
    await user.click(screen.getByRole('button', { name: 'New Space' }));
    const sheet = await screen.findByRole('dialog', { name: 'New Space' });
    const create = within(sheet).getByRole('button', { name: 'Create' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    await user.type(within(sheet).getByRole('textbox', { name: 'Name' }), 'Research');
    await user.click(within(sheet).getByRole('button', { name: 'Link a folder…' }));
    await within(sheet).findByText('Mirrored to /Users/me/proj/artifacts');
    expect(main.callsOf('layout.pickFiles')).toEqual([{ kind: 'directory', directory: null, multiple: false }]);
    await user.click(create);
    await waitFor(() => expect(main.callsOf('spaces.create')).toEqual([{ name: 'Research', linkedDir: '/Users/me/proj' }]));
  });

  it('a Space’s menu renames it, links and unlinks its folder, and deletes it after asking', async () => {
    answers['layout.pickFiles'] = () => ok({ files: [{ path: '/Users/me/home', name: 'home', bytes: 0, mediaType: null, data: null }] });
    const user = userEvent.setup();
    render(<Library />);
    await user.click(screen.getByRole('radio', { name: 'By Space' }));
    const spaceMenu = async (name: string) => {
      await user.click(await screen.findByRole('button', { name: `Actions for the Space ${name}` }));
      return screen.findByRole('menu');
    };

    await user.click(within(await spaceMenu('Home')).getByRole('menuitem', { name: 'Rename…' }));
    const rename = await screen.findByRole('dialog', { name: 'Rename Space' });
    await user.clear(within(rename).getByRole('textbox', { name: 'Name' }));
    await user.type(within(rename).getByRole('textbox', { name: 'Name' }), 'House{Enter}');
    await waitFor(() => expect(main.callsOf('spaces.update')).toEqual([{ spaceId: HOME, name: 'House' }]));

    await user.click(within(await spaceMenu('Home')).getByRole('menuitem', { name: 'Link a folder…' }));
    await waitFor(() => expect(main.callsOf('spaces.update')).toContainEqual({ spaceId: HOME, linkedDir: '/Users/me/home' }));
    await user.click(within(await spaceMenu('Work')).getByRole('menuitem', { name: 'Unlink folder' }));
    await waitFor(() => expect(main.callsOf('spaces.update')).toContainEqual({ spaceId: WORK, linkedDir: null }));

    await user.click(within(await spaceMenu('Work')).getByRole('menuitem', { name: 'Delete Space…' }));
    const remove = await screen.findByRole('dialog', { name: 'Delete the Space “Work”?' });
    expect(within(remove).getByText(/Its artifact stays in the library, in no Space/)).toBeTruthy();
    expect(main.callsOf('spaces.delete')).toEqual([]);
    await user.click(within(remove).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(main.callsOf('spaces.delete')).toEqual([{ spaceId: WORK }]));
  });

  it('a narrowed Space that is deleted returns the view to every Space', async () => {
    const user = userEvent.setup();
    render(<Library />);
    await user.click(within(await screen.findByRole('article', { name: 'Launch plan' })).getByRole('button', { name: 'Work' }));
    await screen.findByRole('button', { name: 'All Spaces' });
    spaces = spaces.filter((s) => s.id !== WORK);
    rows = rows.map((r) => ({ ...r, space: undefined }));
    await changed();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'All Spaces' })).toBeNull());
    expect(screen.getByRole('radio', { name: 'By Space' }).getAttribute('aria-checked')).toBe('true');
  });
});
