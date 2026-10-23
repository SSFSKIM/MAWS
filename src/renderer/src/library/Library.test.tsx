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
import { registerArtifactEditor, resetArtifactEditors } from '../artifacts/registry';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { deferred, installFakeMain, ok } from '../test-support/code';
import { resetShellStores } from '../test-support/shell-stores';
import { resetDelivery, useDelivery } from '../delivery/store'; // P4-B5
import { useLibraryDialog } from './dialogs';
import { resetExportFormats } from './export';
import { Library } from './Library';
import { connectLibrary, resetLibrary } from './store';
import { resetLibraryView, setLibraryView } from './view';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORK = id(0xa1);
const HOME = id(0xa2);
const S = (n: number) => `app-s${n}` as AppSessionId;
// One local time for the fixtures and the component's clock (useNow reads Date.now), so the date groups never depend
// on when the suite runs.
const NOW = new Date(2026, 9, 13, 12, 0).getTime(); // a local noon
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

// happy-dom has no layout: the list's scroller gets a viewport (tall enough for every fixture unless a test shrinks it)
// so the virtualiser mounts its rows, and a measured line its height when a test gives lines one.
let viewport = 4000;
let lineHeight: number | null = null;
const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!;
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-library-scroller')) return viewport;
      return lineHeight !== null && this.hasAttribute('data-index') ? lineHeight : 0; // what the virtualiser measures a line by
    },
  });
});
afterAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  resetShellStores();
  resetLibrary();
  resetLibraryView();
  resetArtifactEditors();
  resetExportFormats();
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
  vi.useRealTimers();
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
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Home', 'Work', 'General']));
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
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Home', 'Work', 'General']));
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

describe('General home', () => {
  it('filters to artifacts without a Space and creates there, as All does', async () => {
    registerArtifactEditor('document', { Panel: () => null, createState: vi.fn() });
    render(<Library />);
    await screen.findByRole('article', { name: 'Launch plan' });
    fireEvent.click(screen.getByRole('radio', { name: 'General' }));
    await waitFor(() => expect(libraryCalls()).toContainEqual({ spaceId: null }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Launch plan' })).toBeNull());
    expect(screen.getByRole('article', { name: 'Pricing page' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    await waitFor(() => expect(main.callsOf('artifacts.create')).toEqual([{ kind: 'document', title: 'Untitled document' }]));
  });
});

describe('a row', () => {
  it('shows built-in provenance instead of attributing installation to the owner', async () => {
    rows = [row(1, { title: 'House', kind: 'design_system', builtIn: true, seedOnly: true })];
    render(<Library />);
    const builtin = await screen.findByRole('article', { name: 'House' });
    expect(within(builtin).getByText('Built in')).toBeTruthy();
    expect(builtin.textContent).not.toContain('by You');
  });

  it.each(['human', 'session'] as const)('keeps built-in provenance alongside the real %s editor and time', async (kind) => {
    rows = [row(1, { title: 'Edited house', kind: 'design_system', builtIn: true, lastEditor: kind === 'human' ? { kind } : { kind, appSessionId: S(1) }, lastEditorTitle: 'Improve the house', lastEditedAt: NOW - 3 * 60_000 })];
    render(<Library />);
    const builtin = await screen.findByRole('article', { name: 'Edited house' });
    expect(builtin.textContent).toContain('Built in');
    expect(builtin.textContent).toContain(`Edited 3 minutes ago by ${kind === 'human' ? 'You' : 'Improve the house'}`);
  });

  it('shows its kind, title, Space, project, last editor and time, and the sessions that touched it', async () => {
    const sessions = [1, 2, 3, 4].map((n) => ({ appSessionId: S(n), title: `Session ${n}`, roles: n === 1 ? (['created', 'edited'] as const) : (['viewed'] as const), lastAt: NOW - n * HOUR }));
    rows = [
      row(1, { title: 'Launch plan', space: { id: WORK, name: 'Work' }, project: { id: 'p1' as ProjectId, name: 'maws' }, lastEditor: { kind: 'session', appSessionId: S(1) }, lastEditorTitle: 'Session 1', lastEditedAt: NOW - 3 * 60_000, sessions: sessions.map((s) => ({ ...s, roles: [...s.roles] })) }),
      row(2, { title: 'Mine', kind: 'html', lastEditor: { kind: 'human' }, lastEditedAt: NOW - 2 * HOUR }),
      row(3, { title: 'Unknown session', lastEditor: { kind: 'session', appSessionId: S(9) }, lastEditorTitle: '', sessions: [{ appSessionId: S(9), title: '', roles: ['created'], lastAt: NOW }] }),
      row(4, { title: 'Unlinked editor', lastEditor: { kind: 'session', appSessionId: S(7) }, lastEditorTitle: 'Side quest', sessions: [] }), // DL 27f
    ];
    render(<Library />);
    const launch = await screen.findByRole('article', { name: 'Launch plan' });
    expect(within(launch).getByText('Document')).toBeTruthy();
    expect(within(launch).getByRole('button', { name: 'Work' })).toBeTruthy();
    expect(within(launch).getByText('maws')).toBeTruthy();
    expect(within(launch).getByText('Edited 3 minutes ago by Session 1')).toBeTruthy(); // English under the Korean system locale (P4 DL 4)
    const chips = within(launch).getAllByRole('button', { name: /^Session \d/ });
    expect(chips.map((c) => c.textContent)).toEqual(['Session 1', 'Session 2', 'Session 3']);
    expect(chips[0].getAttribute('title')).toMatch(/^Session 1: created, edited, /);
    expect(within(launch).getByText('+1').getAttribute('title')).toContain('Session 4');
    expect(within(article('Mine')).getByText('HTML page')).toBeTruthy();
    expect(within(article('Mine')).getByText('Edited 2 hours ago by You')).toBeTruthy();
    expect(within(article('Unknown session')).getByText(/by Claude$/)).toBeTruthy();
    expect(within(article('Unlinked editor')).getByText(/by Side quest$/)).toBeTruthy();
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

// The review of M4: the list mounts only what is near the viewport, so its one tab stop must be a mounted row whatever
// the scroll, and a row holding the keyboard stays mounted while it scrolls away.
describe('the tab stop across virtualization', () => {
  const scrollTo = async (top: number) => {
    const scroller = document.querySelector<HTMLElement>('[data-library-scroller]')!;
    scroller.scrollTop = top;
    await act(async () => void scroller.dispatchEvent(new Event('scroll')));
  };
  const stops = () => screen.getAllByRole('article').filter((a) => a.tabIndex === 0);
  const startOf = (el: HTMLElement) => Number(/translateY\(([\d.]+)px\)/.exec(el.closest<HTMLElement>('[data-index]')!.style.transform)![1]);

  beforeEach(() => {
    viewport = 300;
    lineHeight = 56;
    rows = Array.from({ length: 80 }, (_, i) => row(i + 1, { title: `Note ${i + 1}`, updatedAt: NOW - (i + 1) * 60_000 }));
  });
  afterEach(() => {
    viewport = 4000;
    lineHeight = null;
  });

  it('scrolled past the stop row, the first row in view takes the tab stop', async () => {
    render(<Library />);
    await screen.findByRole('article', { name: 'Note 1' });
    expect(stops().map((a) => a.getAttribute('aria-label'))).toEqual(['Note 1']);
    await scrollTo(2_000);
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Note 1' })).toBeNull());
    const [stop] = stops();
    expect(stops()).toHaveLength(1);
    const inView = screen.getAllByRole('article').filter((a) => startOf(a) + 56 > 2_000).sort((a, b) => startOf(a) - startOf(b));
    expect(stop).toBe(inView[0]);
  });

  it('a row holding the keyboard stays mounted, focused and the tab stop while the list scrolls away from it', async () => {
    render(<Library />);
    const second = await screen.findByRole('article', { name: 'Note 2' });
    act(() => second.focus());
    await scrollTo(3_000);
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Note 1' })).toBeNull());
    expect(screen.getByRole('article', { name: 'Note 2' })).toBe(second);
    expect(document.activeElement).toBe(second);
    expect(stops()).toEqual([second]);
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
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'General' }));
    await waitFor(() => expect(main.callsOf('artifacts.update')).toContainEqual({ artifactId: id(1), spaceId: null }));
  });

  // M5b (Decision Log 14): Export lists the formats main's exporters serve for the kind, and a File artifact's Save a copy…
  it('Export › a format exports the artifact and saves it; a File artifact saves a copy; a kind with neither has no Export', async () => {
    answers['library.exportFormats'] = (input) => ok({ formats: input.kind === 'html' ? ['pdf', 'png'] : [] });
    answers['artifacts.export'] = () => ok({ path: '/store/x/exports/1-pdf.pdf', revision: 1 });
    answers['library.saveAs'] = () => ok({ saved: true, path: '/Users/me/Downloads/Pricing page.pdf' });
    const user = userEvent.setup();
    render(<Library />);
    await user.click(within(await openMenu(user, 'Pricing page')).getByRole('menuitem', { name: 'Export' }));
    const formats = await screen.findAllByRole('menuitem', { name: /^(PDF|PNG|Save a copy…)$/ });
    expect(formats.map((item) => item.textContent)).toEqual(['PDF', 'PNG']);
    fireEvent.click(formats[0]!);
    await waitFor(() => expect(main.callsOf('library.saveAs')).toEqual([{ artifactId: id(2), source: { export: { revision: 1, format: 'pdf' } } }]));
    expect(main.callsOf('artifacts.export')).toEqual([{ artifactId: id(2), format: 'pdf', ownFile: true }]); // P4 (W1, L302): a file of its own

    await user.keyboard('{Escape}');
    await user.click(within(await openMenu(user, 'export.csv')).getByRole('menuitem', { name: 'Export' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save a copy…' }));
    await waitFor(() => expect(main.callsOf('library.saveAs')).toContainEqual({ artifactId: id(4), source: { content: {} } }));

    await user.keyboard('{Escape}');
    const menu = await openMenu(user, 'Launch plan');
    await waitFor(() => expect(main.callsOf('library.exportFormats')).toContainEqual({ kind: 'document' }));
    expect(within(menu).queryByRole('menuitem', { name: 'Export' })).toBeNull();
  });

  // P3-H (P3 Decision Log 92): the first menu to ask for a kind shows Export once main answers, in the same opening. Run
  // in `renderer-compiled` too, where a format read from the module's cache in render was memoized on the kind and the
  // answer never showed until the menu was opened again.
  it('Export appears in the opening that asked, when main answers after the menu opened', async () => {
    const answer = deferred<unknown>();
    answers['library.exportFormats'] = (input) => (input.kind === 'html' ? answer.promise : ok({ formats: [] }));
    const user = userEvent.setup();
    render(<Library />);
    const menu = await openMenu(user, 'Pricing page');
    await waitFor(() => expect(main.callsOf('library.exportFormats')).toEqual([{ kind: 'html' }]));
    expect(within(menu).queryByRole('menuitem', { name: 'Export' })).toBeNull();
    await act(async () => answer.resolve(ok({ formats: ['pdf', 'png'] })));
    expect(await within(menu).findByRole('menuitem', { name: 'Export' })).toBeTruthy();
    expect(screen.getAllByRole('menu')).toEqual([menu]); // the same opening
  });

  // P3-H (Decision Log 87): Send to Google Drive and Notion, inside Export only, for a kind with a format to send
  // P4-B5: the items open the app's direct Send to sheet (../delivery/, drawn by the App's host), Notion only for a kind
  // whose Markdown makes a page
  it('Export › Send to Google Drive… (and Send to Notion… for a kind with Markdown) follow the formats and open the direct sheet; a kind with no format has neither', async () => {
    answers['library.exportFormats'] = (input) => ok({ formats: input.kind === 'html' ? ['pdf', 'png'] : [] });
    answers['delivery.status'] = () => ok({ target: 'drive', state: 'absent' });
    const user = userEvent.setup();
    render(<Library />);
    await user.click(within(await openMenu(user, 'Pricing page')).getByRole('menuitem', { name: 'Export' }));
    await screen.findByRole('menuitem', { name: 'PDF' });
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items.slice(items.indexOf('PDF'))).toEqual(['PDF', 'PNG', 'Send to Google Drive…']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Send to Google Drive…' }));
    await waitFor(() => expect(useDelivery.getState().sheet?.subject).toEqual({ artifactId: id(2), kind: 'html', title: 'Pricing page' }));
    expect(useDelivery.getState().sheet?.run.state.getState().target).toBe('drive');
    expect(main.callsOf('artifacts.export')).toEqual([]); // nothing runs before the owner's Send
    act(() => useDelivery.getState().sheet?.run.close());
    resetDelivery();

    await user.click(within(await openMenu(user, 'export.csv')).getByRole('menuitem', { name: 'Export' }));
    await screen.findByRole('menuitem', { name: 'Save a copy…' });
    expect(screen.queryByRole('menuitem', { name: 'Send to Google Drive…' })).toBeNull();
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

// A sheet's answer arrives after the owner dismissed it and opened another: it settles its own request only, never the
// sheet shown now (the review of M4: completions guarded by the dialog that asked).
describe('a late answer to a dismissed sheet', () => {
  const openMenu = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
    await user.click(within(await screen.findByRole('article', { name: title })).getByRole('button', { name: `Actions for ${title}` }));
    return screen.findByRole('menu');
  };
  const dismissThenRename = async (user: ReturnType<typeof userEvent.setup>, dialog: string, confirm: string) => {
    await user.click(within(await screen.findByRole('dialog', { name: dialog })).getByRole('button', { name: confirm }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(within(await openMenu(user, 'Pricing page')).getByRole('menuitem', { name: 'Rename…' }));
    await screen.findByRole('dialog', { name: 'Rename artifact' });
  };

  it('a Delete that succeeds late leaves the Rename opened since', async () => {
    const answer = deferred<unknown>();
    answers['artifacts.delete'] = () => answer.promise;
    const user = userEvent.setup();
    render(<Library />);
    await user.click(within(await openMenu(user, 'Launch plan')).getByRole('menuitem', { name: 'Delete…' }));
    await dismissThenRename(user, 'Delete “Launch plan”?', 'Delete');
    await act(async () => answer.resolve(ok()));
    expect(screen.getByRole('dialog', { name: 'Rename artifact' })).toBeTruthy();
  });

  it('a late designSystemInUse refusal does not replace the Rename opened since', async () => {
    const answer = deferred<unknown>();
    answers['artifacts.delete'] = () => answer.promise;
    const user = userEvent.setup();
    render(<Library />);
    await user.click(within(await openMenu(user, 'Launch plan')).getByRole('menuitem', { name: 'Delete…' }));
    await dismissThenRename(user, 'Delete “Launch plan”?', 'Delete');
    await act(async () =>
      answer.resolve({ ok: false, error: { code: 'invalid_input', message: 'in use', issues: { reason: 'designSystemInUse', data: { artifactIds: [id(2)] } } } }),
    );
    expect(screen.getByRole('dialog', { name: 'Rename artifact' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'This design system is in use' })).toBeNull();
  });

  it('a Rename, a New Space and a Space’s Delete that answer late leave the sheet opened since', async () => {
    const user = userEvent.setup();
    render(<Library />);
    const pending: ReturnType<typeof deferred<unknown>>[] = [];
    for (const name of ['artifacts.update', 'spaces.create', 'spaces.delete']) answers[name] = () => (pending.push(deferred<unknown>()), pending.at(-1)!.promise);

    await user.click(within(await openMenu(user, 'Launch plan')).getByRole('menuitem', { name: 'Rename…' }));
    await user.type(within(await screen.findByRole('dialog', { name: 'Rename artifact' })).getByRole('textbox', { name: 'Title' }), ' v2');
    await dismissThenRename(user, 'Rename artifact', 'Rename');

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'New Space' }));
    await user.type(within(await screen.findByRole('dialog', { name: 'New Space' })).getByRole('textbox', { name: 'Name' }), 'Late');
    await dismissThenRename(user, 'New Space', 'Create');

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('radio', { name: 'By Space' }));
    await user.click(await screen.findByRole('button', { name: 'Actions for the Space Home' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Delete Space…' }));
    await dismissThenRename(user, 'Delete the Space “Home”?', 'Delete');

    const rename = screen.getByRole('dialog', { name: 'Rename artifact' });
    await act(async () => {
      pending[0].resolve(ok({ artifact: host(rows[0]) }));
      pending[1].resolve(ok({ space: { id: id(0xa9), name: 'Late', createdAt: 1 } }));
      pending[2].resolve(ok());
    });
    expect(screen.getByRole('dialog', { name: 'Rename artifact' })).toBe(rename);
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

  // P3-F wave S (F5, the owner's DL13 change): Ask Claude from a Space starts in the Space's folder and names the Space
  it('Ask Claude from a Space starts in its linked folder’s project, else the focused project, and the prefill names the Space', async () => {
    const creator = vi.fn(async () => S(8));
    offs.push(registerSessionCreator(creator));
    const location = { kind: 'directory', path: '/Users/me/work' };
    answers['session.projects.addFolder'] = () => ok({ project: { id: 'p-9', name: 'work', directory: '/Users/me/work', order: 3, createdAt: '2026-10-01T00:00:00.000Z' }, location });
    const user = userEvent.setup();
    act(() => setLibraryView({ view: 'bySpace', spaceId: WORK }));
    render(<Library />);
    const section = await screen.findByRole('region', { name: 'Make something new' });
    const card = (kind: string) => within(section).getByRole('group', { name: kind });

    await user.click(await within(card('Presentation')).findByRole('button', { name: 'Ask Claude to make a presentation in the Space “Work”' }));
    await waitFor(() => expect(creator).toHaveBeenCalledWith('p-9', location));
    expect(main.callsOf('session.projects.addFolder')).toEqual([{ directory: '/Users/me/work' }]);
    expect(useComposerStore.getState().prefills.get(S(8))).toEqual({ text: 'Make a presentation in the Space “Work”: ' });

    act(() => setLibraryView({ spaceId: HOME })); // a Space with no linked folder
    await user.click(await within(card('Document')).findByRole('button', { name: 'Ask Claude to make a document in the Space “Home”' }));
    await waitFor(() => expect(creator).toHaveBeenCalledTimes(2));
    expect(creator).toHaveBeenLastCalledWith(null);
    expect(main.callsOf('session.projects.addFolder')).toHaveLength(1);
    expect(useComposerStore.getState().prefills.get(S(8))).toEqual({ text: 'Make a document in the Space “Home”: ' });
  });

  // P4: before the Spaces list has answered, a narrowed view's Ask Claude would start in the focused project with no
  // Space words; it waits, disabled, until the Space is known, and stays so for a Space the list does not hold
  it('Ask Claude from a narrowed Space is disabled until the Spaces list names the Space, then its prefill names it', async () => {
    const creator = vi.fn(async () => S(9));
    offs.push(registerSessionCreator(creator));
    let answerSpaces: (() => void) | null = null;
    answers['library.spaces'] = () => new Promise((resolve) => (answerSpaces = () => resolve(ok({ spaces }))));
    const user = userEvent.setup();
    act(() => setLibraryView({ view: 'bySpace', spaceId: HOME }));
    render(<Library />);
    const section = await screen.findByRole('region', { name: 'Make something new' });
    const ask = () => within(within(section).getByRole('group', { name: 'Document' })).getByRole('button', { name: /^Ask Claude/ });
    await waitFor(() => expect(answerSpaces).not.toBeNull());
    expect((ask() as HTMLButtonElement).disabled).toBe(true);
    await user.click(ask());
    expect(creator).not.toHaveBeenCalled();

    await act(async () => answerSpaces!());
    await waitFor(() => expect((ask() as HTMLButtonElement).disabled).toBe(false));
    expect(ask().getAttribute('aria-label')).toBe('Ask Claude to make a document in the Space “Home”');
    await user.click(ask());
    await waitFor(() => expect(creator).toHaveBeenCalledWith(null));
    expect(useComposerStore.getState().prefills.get(S(9))).toEqual({ text: 'Make a document in the Space “Home”: ' });

    act(() => setLibraryView({ spaceId: 'gone' })); // a Space the loaded list does not hold (deleted meanwhile)
    expect((ask() as HTMLButtonElement).disabled).toBe(true);
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
