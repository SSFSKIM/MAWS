// The Artifacts tab (the P3-L execution document, M4; Decision Log 13, 14): the three views over main's index, the
// type filter whose counts follow the view and the search, the date and Space groups, each row's facts, every row
// action through its command (Delete confirmed, a design system in use answered by naming what uses it), "Make
// something new" per kind, the Spaces' management, and the keyboard.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import type { ArtifactKind } from '@shared/artifacts/entity';
import { ARTIFACT_KINDS } from '@shared/artifacts/entity';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { LibraryFilter, LibraryRow, LibrarySpace } from '@shared/ipc/schema/library';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { registerArtifactEditor, resetArtifactEditors } from '../artifacts/registry';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { useComposerStore } from '../stores/composer';
import { useSettings } from '../stores/settings';
import { useLayout } from '../stores/layout';
import { allTabs, currentSet } from '../stores/layout-model';
import { deferred, installFakeMain, ok } from '../test-support/code';
import { resetShellStores } from '../test-support/shell-stores';
import { resetDelivery, useDelivery } from '../delivery/store'; // P4-B5
import { prefillToDoc } from '../composer/editor/recall';
import { serializeDraft } from '../composer/editor/serialize';
import { askClaudePrefill } from './copy';
import { useLibraryDialog } from './dialogs';
import { resetExportFormats } from './export';
import { Library } from './Library';
import { connectLibrary, resetLibrary } from './store';
import { resetLibraryView, setLibraryView } from './view';

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const WORK = id(0xa1);
const HOME = id(0xa2);
const S = (n: number) => `app-s${n}` as AppSessionId; // main's (bare); the page holds at(S(n))
const artifactTab = (artifactId: string) => `artifact:${TEST_MACHINE}:${artifactId}`;
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

// UX wave U10b: two design systems in the library, and the owner's and the Spaces' defaults (settings 14) as read
const HARBOR = id(0xd1);
const CLASSROOM = id(0xd2);
const SYSTEMS = [row(0xd1, { kind: 'design_system', title: 'Harbor' }), row(0xd2, { kind: 'design_system', title: 'Classroom' })];
function readDefaults(defaults: { owner?: string; spaces?: Record<string, string> }): void {
  const artifacts = { ...SETTINGS_DEFAULTS_V21.artifacts, defaultDesignSystem: defaults.owner ?? null, spaceDesignSystems: defaults.spaces ?? {} };
  useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V21, artifacts }, resolvedTheme: 'light' } });
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
  useSettings.setState({ state: null });
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
    await user.click(screen.getByRole('button', { name: 'Blank document' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Blank document' }));
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
    expect(tabIds()).toContain(artifactTab(id(1)));
    await user.click(within(article('Launch plan')).getByRole('button', { name: 'Session 1' }));
    expect(tabIds()).toContain(`session:${at(S(1))}`);
    expect(tabIds(), 'the artifact tab stays').toContain(artifactTab(id(1)));
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
    expect(tabIds()).toContain(artifactTab(id(4)));
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

  // UX wave U10b (M8 decision 3): the design-system choice holds while the page is open, scrolled away or not
  it('"Make something new" keeps its choice while the list scrolls away from it and back', async () => {
    rows = [...rows, ...SYSTEMS];
    readDefaults({});
    render(<Library />);
    const made = await screen.findByRole('region', { name: 'Make something new' });
    const user = userEvent.setup();
    await waitFor(() => expect(within(made).getByRole('button', { name: /^Design system/ }).textContent).toBe('MAWS · default'));
    await user.click(within(made).getByRole('button', { name: /^Design system/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Harbor' }));
    await scrollTo(3_000);
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Note 1' })).toBeNull());
    await scrollTo(0);
    const back = await screen.findByRole('region', { name: 'Make something new' });
    expect(within(back).getByRole('button', { name: /^Design system/ }).textContent).toBe('Harbor');
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
  // UX wave U10b (l6-artifacts-18, H9): an html page has Save a copy… too, and its html format is that item, not a row
  it('Export › a format exports the artifact and saves it; a File artifact and an html page save a copy; a kind with neither has no Export', async () => {
    answers['library.exportFormats'] = (input) => ok({ formats: input.kind === 'html' ? ['pdf', 'png', 'html'] : [] });
    answers['artifacts.export'] = () => ok({ path: '/store/x/exports/1-pdf.pdf', revision: 1 });
    answers['library.saveAs'] = () => ok({ saved: true, path: '/Users/me/Downloads/Pricing page.pdf' });
    const user = userEvent.setup();
    render(<Library />);
    await user.click(within(await openMenu(user, 'Pricing page')).getByRole('menuitem', { name: 'Export' }));
    await screen.findByRole('menuitem', { name: 'PDF' });
    const formats = screen.getAllByRole('menuitem', { name: /^(PDF|PNG|HTML|Save a copy…)$/ });
    expect(formats.map((item) => item.textContent)).toEqual(['PDF', 'PNG', 'Save a copy…']);
    fireEvent.click(formats[0]!);
    await waitFor(() => expect(main.callsOf('library.saveAs')).toEqual([{ artifactId: id(2), source: { export: { revision: 1, format: 'pdf' } } }]));
    expect(main.callsOf('artifacts.export')).toEqual([{ artifactId: id(2), format: 'pdf', ownFile: true }]); // P4 (W1, L302): a file of its own

    await user.keyboard('{Escape}');
    await user.click(within(await openMenu(user, 'Pricing page')).getByRole('menuitem', { name: 'Export' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save a copy…' }));
    await waitFor(() => expect(main.callsOf('library.saveAs')).toContainEqual({ artifactId: id(2), source: { content: {} } }));
    expect(main.callsOf('artifacts.export')).toHaveLength(1); // the stored page itself: nothing is exported

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
  // (UX wave U10b: on the deck's row, since an html page's Save a copy… shows Export before main answers)
  it('Export appears in the opening that asked, when main answers after the menu opened', async () => {
    const answer = deferred<unknown>();
    answers['library.exportFormats'] = (input) => (input.kind === 'presentation' ? answer.promise : ok({ formats: [] }));
    const user = userEvent.setup();
    render(<Library />);
    const menu = await openMenu(user, 'Quarterly deck');
    await waitFor(() => expect(main.callsOf('library.exportFormats')).toEqual([{ kind: 'presentation' }]));
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
    expect(items.slice(items.indexOf('PDF'))).toEqual(['PDF', 'PNG', 'Save a copy…', 'Send to Google Drive…']); // U10b: the page's copy
    fireEvent.click(screen.getByRole('menuitem', { name: 'Send to Google Drive…' }));
    await waitFor(() => expect(useDelivery.getState().sheet?.subject).toEqual({ artifactId: id(2), machine: TEST_MACHINE, kind: 'html', title: 'Pricing page' }));
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
    expect(tabIds()).toContain(artifactTab(id(3)));
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
  // UX wave U10b (l6-artifacts-08): four cards that ask Claude, a Blank beside each, More, and one design-system choice
  const CARD_KINDS = ['document', 'presentation', 'dashboard', 'design'] as const;
  const section = () => screen.findByRole('region', { name: 'Make something new' });
  const card = (within_: HTMLElement, label: string) => within(within(within_).getByRole('group', { name: label })).getByRole('button', { name: label });
  const blank = (within_: HTMLElement, label: string) => within(within(within_).getByRole('group', { name: label })).getByRole('button', { name: `Blank ${label.toLowerCase()}` });
  const choice = (within_: HTMLElement) => within(within_).getByRole('button', { name: /^Design system/ });
  const prefillOf = (n: number) => useComposerStore.getState().prefills.get(at(S(n)));
  const withSystems = (defaults: { owner?: string; spaces?: Record<string, string> } = {}) => {
    rows = [...rows, ...SYSTEMS];
    readDefaults(defaults);
  };
  const editors = (...kinds: ArtifactKind[]) => kinds.forEach((kind) => registerArtifactEditor(kind, { Panel: () => null }));

  it('opens with the words for the kind, its Space and a chosen system that is not the default', () => {
    for (const kind of CARD_KINDS) {
      const noun = kind;
      expect(askClaudePrefill(kind)).toBe(`Make a ${noun}: `);
      expect(askClaudePrefill(kind, 'Work')).toBe(`Make a ${noun} in the Space “Work”: `);
      expect(askClaudePrefill(kind, undefined, 'Classroom')).toBe(`Make a ${noun}, in the design system “Classroom”: `);
      expect(askClaudePrefill(kind, 'Work', 'Classroom')).toBe(`Make a ${noun} in the Space “Work”, in the design system “Classroom”: `);
    }
    expect(askClaudePrefill('html', 'Work')).toBe('Make an HTML page in the Space “Work”: ');
    expect(askClaudePrefill('design_system')).toBe('Make a design system: ');
  });

  it('is four cards, each one button that asks Claude, with Blank beside it, not in it', async () => {
    editors(...CARD_KINDS);
    render(<Library />);
    const made = await section();
    expect(within(made).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Document', 'Presentation', 'Dashboard', 'Design']);
    for (const [label, blurb] of [['Document', 'Notes, specs and reports'], ['Presentation', 'A slide deck'], ['Dashboard', 'Charts bound to data'], ['Design', 'Artboards on a canvas']]) {
      const group = within(made).getByRole('group', { name: label });
      expect(within(group).getAllByRole('button')).toEqual([card(made, label!), blank(made, label!)]);
      expect(card(made, label!).textContent).toBe(`${label}${blurb}`);
      expect(card(made, label!).contains(blank(made, label!))).toBe(false); // siblings: no button inside a button
      expect(blank(made, label!).textContent).toBe('Blank');
    }
    expect(within(made).queryByRole('group', { name: 'HTML page' })).toBeNull();
    expect(within(made).queryByRole('group', { name: 'File' })).toBeNull();
  });

  it('a card leaves the page for a new chat whose composer holds the opening words; it is disabled until the chat is made, so a second press starts none', async () => {
    const made = deferred<AppSessionId>();
    const creator = vi.fn(() => made.promise);
    offs.push(registerSessionCreator(creator));
    const user = userEvent.setup();
    render(<Library />);
    const presentation = card(await section(), 'Presentation');
    await user.click(presentation);
    await waitFor(() => expect(creator).toHaveBeenCalledWith(null));
    expect((presentation as HTMLButtonElement).disabled).toBe(true);
    await user.click(presentation);
    expect(creator).toHaveBeenCalledTimes(1);
    await act(async () => made.resolve(at(S(7))));
    expect(prefillOf(7)).toEqual({ text: 'Make a presentation: ' });
    expect(tabIds()).toContain(`session:${at(S(7))}`);
    expect((presentation as HTMLButtonElement).disabled).toBe(false);
  });

  // P3-F wave S (F5, the owner's DL13 change): from a Space a card starts in the Space's folder and names the Space
  it('a card from a Space starts in its linked folder’s project, else the focused project, and the words name the Space', async () => {
    const creator = vi.fn(async () => at(S(8)));
    offs.push(registerSessionCreator(creator));
    const location = { kind: 'directory', path: '/Users/me/work' };
    answers['session.projects.addFolder'] = () => ok({ project: { id: 'p-9', name: 'work', directory: '/Users/me/work', order: 3, createdAt: '2026-10-01T00:00:00.000Z' }, location });
    const user = userEvent.setup();
    act(() => setLibraryView({ view: 'bySpace', spaceId: WORK }));
    render(<Library />);
    const made = await section();
    await waitFor(() => expect((card(made, 'Presentation') as HTMLButtonElement).disabled).toBe(false));
    await user.click(card(made, 'Presentation'));
    await waitFor(() => expect(creator).toHaveBeenCalledWith(at('p-9'), location));
    expect(main.callsOf('session.projects.addFolder')).toEqual([{ directory: '/Users/me/work' }]);
    await waitFor(() => expect(prefillOf(8)).toEqual({ text: 'Make a presentation in the Space “Work”: ' }));

    act(() => setLibraryView({ spaceId: HOME })); // a Space with no linked folder
    await user.click(card(made, 'Document'));
    await waitFor(() => expect(creator).toHaveBeenCalledTimes(2));
    expect(creator).toHaveBeenLastCalledWith(null);
    expect(main.callsOf('session.projects.addFolder')).toHaveLength(1);
    await waitFor(() => expect(prefillOf(8)).toEqual({ text: 'Make a document in the Space “Home”: ' }));
  });

  // H23 (ruled 2026-11-15, L5): before the Spaces list has answered, a card would start in the focused project with no
  // Space words and Blank would make an artifact the page cannot yet name the Space of; both wait, disabled
  it('while the narrowed Space loads, each card and its Blank are disabled, Add a file… is not', async () => {
    editors(...CARD_KINDS);
    const creator = vi.fn(async () => at(S(9)));
    offs.push(registerSessionCreator(creator));
    let answerSpaces: (() => void) | null = null;
    answers['library.spaces'] = () => new Promise((resolve) => (answerSpaces = () => resolve(ok({ spaces }))));
    const user = userEvent.setup();
    act(() => setLibraryView({ view: 'bySpace', spaceId: HOME }));
    render(<Library />);
    const made = await section();
    await waitFor(() => expect(answerSpaces).not.toBeNull());
    for (const label of ['Document', 'Presentation', 'Dashboard', 'Design']) {
      expect((card(made, label) as HTMLButtonElement).disabled, label).toBe(true);
      expect((blank(made, label) as HTMLButtonElement).disabled, label).toBe(true);
    }
    await user.click(card(made, 'Document'));
    await user.click(blank(made, 'Document'));
    expect(creator).not.toHaveBeenCalled();
    expect(main.callsOf('artifacts.create')).toEqual([]);
    await user.click(within(made).getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menuitem', { name: 'Add a file…' }).hasAttribute('data-disabled')).toBe(false);
    await user.keyboard('{Escape}');

    await act(async () => answerSpaces!());
    await waitFor(() => expect((card(made, 'Document') as HTMLButtonElement).disabled).toBe(false));
    expect((blank(made, 'Document') as HTMLButtonElement).disabled).toBe(false);
    await user.click(card(made, 'Document'));
    await waitFor(() => expect(prefillOf(9)).toEqual({ text: 'Make a document in the Space “Home”: ' }));

    act(() => setLibraryView({ spaceId: 'gone' })); // a Space the loaded list does not hold (deleted meanwhile): every Space
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Make something new' })).toBeNull());
  });

  it('More holds Design system (Ask Claude, Blank), HTML page and Add a file…', async () => {
    editors('design_system');
    const creator = vi.fn(async () => at(S(7)));
    offs.push(registerSessionCreator(creator));
    answers['layout.pickFiles'] = () => ok({ files: [{ path: '/Users/me/report.pdf', name: 'report.pdf', bytes: 10, mediaType: null, data: null }] });
    const user = userEvent.setup();
    render(<Library />);
    const more = within(await section()).getByRole('button', { name: 'More' });
    await user.click(more);
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Design system', 'HTML page', 'Add a file…']);
    await user.click(screen.getByRole('menuitem', { name: 'Design system' }));
    const sub = await screen.findByRole('menuitem', { name: 'Ask Claude' });
    expect(within(sub.closest<HTMLElement>('[role="menu"]')!).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Ask Claude', 'Blank']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Blank' }));
    await waitFor(() => expect(main.callsOf('artifacts.create')).toEqual([{ kind: 'design_system', title: 'Untitled design system' }]));

    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: 'Design system' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ask Claude' }));
    await waitFor(() => expect(prefillOf(7)).toEqual({ text: 'Make a design system: ' }));

    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: 'HTML page' }));
    await waitFor(() => expect(creator).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(prefillOf(7)).toEqual({ text: 'Make an HTML page: ' }));

    await user.click(more);
    await user.click(screen.getByRole('menuitem', { name: 'Add a file…' }));
    await waitFor(() => expect(main.callsOf('artifacts.create')).toContainEqual({ kind: 'file', title: 'report.pdf', content: { path: '/Users/me/report.pdf' } }));
    expect(main.callsOf('layout.pickFiles')).toEqual([{ kind: 'files', directory: null, multiple: false, pathsOnly: true }]);
  });

  it('the choice shows the system a new artifact here gets, "<name> · default", first; a system chosen is named in a card’s words and bound by Blank; the default binds none', async () => {
    editors(...CARD_KINDS);
    withSystems({ spaces: { [HOME]: CLASSROOM } });
    const creator = vi.fn(async () => at(S(7)));
    offs.push(registerSessionCreator(creator));
    const user = userEvent.setup();
    act(() => setLibraryView({ view: 'bySpace', spaceId: HOME })); // a Space with no linked folder
    render(<Library />);
    const made = await section();
    await waitFor(() => expect(choice(made).getAttribute('aria-label')).toBe('Design system: Classroom · default'));
    expect(choice(made).textContent).toBe('Classroom · default');
    await user.click(choice(made));
    expect(screen.getAllByRole('menuitemradio').map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([['Classroom · default', 'true'], ['Harbor', 'false']]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Harbor' }));
    await waitFor(() => expect(choice(made).getAttribute('aria-label')).toBe('Design system: Harbor'));

    await user.click(card(made, 'Document'));
    await waitFor(() => expect(prefillOf(7)).toEqual({ text: 'Make a document in the Space “Home”, in the design system “Harbor”: ' }));
    await user.click(blank(made, 'Presentation'));
    await waitFor(() => expect(main.callsOf('artifacts.create')).toEqual([{ kind: 'presentation', title: 'Untitled presentation', spaceId: HOME, designSystemId: HARBOR }]));

    await user.click(choice(made));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Classroom · default' }));
    await waitFor(() => expect(choice(made).getAttribute('aria-label')).toBe('Design system: Classroom · default'));
    await user.click(blank(made, 'Design'));
    await waitFor(() => expect(main.callsOf('artifacts.create')).toContainEqual({ kind: 'design', title: 'Untitled design', spaceId: HOME }));
    await user.click(card(made, 'Dashboard'));
    await waitFor(() => expect(prefillOf(7)).toEqual({ text: 'Make a dashboard in the Space “Home”: ' }));
  });

  it('on All the default is the owner’s, else the bundled floor', async () => {
    withSystems({ owner: HARBOR });
    render(<Library />);
    const made = await section();
    await waitFor(() => expect(choice(made).textContent).toBe('Harbor · default'));
    act(() => readDefaults({}));
    await waitFor(() => expect(choice(made).textContent).toBe('MAWS · default'));
  });

  it('while the design systems or the defaults are read, the choice says "Design system", disabled, and a card starts its chat with no system in the words', async () => {
    withSystems({ owner: HARBOR });
    let answerSystems: (() => void) | null = null;
    answers['library.list'] = (input) => {
      const filter = (input as { filter?: LibraryFilter }).filter;
      if (filter?.kind !== 'design_system') return ok(list(filter));
      return new Promise((resolve) => (answerSystems = () => resolve(ok(list(filter)))));
    };
    const creator = vi.fn(async () => at(S(7)));
    offs.push(registerSessionCreator(creator));
    const user = userEvent.setup();
    render(<Library />);
    const made = await section();
    await waitFor(() => expect(answerSystems).not.toBeNull());
    expect(choice(made).textContent).toBe('Design system');
    expect((choice(made) as HTMLButtonElement).disabled).toBe(true);
    await user.click(card(made, 'Document'));
    await waitFor(() => expect(prefillOf(7)).toEqual({ text: 'Make a document: ' }));
    await act(async () => answerSystems!());
    await waitFor(() => expect(choice(made).textContent).toBe('Harbor · default'));
    act(() => useSettings.setState({ state: null })); // the defaults not read (yet)
    expect(choice(made).textContent).toBe('Design system');
    expect((choice(made) as HTMLButtonElement).disabled).toBe(true);
  });

  // M8 decision 3 (fix wave 1): the choice is the page's; the views that do not draw the section do not forget it
  it('the choice holds while the page is open: across a search typed and cleared, Pinned and back, and every Space and back; a page opened again starts at the default', async () => {
    editors(...CARD_KINDS);
    withSystems();
    const user = userEvent.setup();
    const page = render(<Library />);
    const shown = async () => choice(await section()).textContent;
    await waitFor(async () => expect(await shown()).toBe('MAWS · default'));
    await user.click(choice(await section()));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Harbor' }));
    await waitFor(async () => expect(await shown()).toBe('Harbor'));

    act(() => setLibraryView({ query: 'plan' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Make something new' })).toBeNull());
    act(() => setLibraryView({ query: '' }));
    expect(await shown()).toBe('Harbor');
    act(() => setLibraryView({ view: 'pinned' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Make something new' })).toBeNull());
    act(() => setLibraryView({ view: 'all' }));
    expect(await shown()).toBe('Harbor');
    act(() => setLibraryView({ view: 'bySpace', spaceId: null }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Make something new' })).toBeNull());
    act(() => setLibraryView({ spaceId: HOME }));
    expect(await shown()).toBe('Harbor');
    await user.click(blank(await section(), 'Presentation'));
    await waitFor(() => expect(main.callsOf('artifacts.create')).toEqual([{ kind: 'presentation', title: 'Untitled presentation', spaceId: HOME, designSystemId: HARBOR }]));

    page.unmount();
    act(() => setLibraryView({ view: 'all', spaceId: null }));
    render(<Library />);
    await waitFor(async () => expect(await shown()).toBe('MAWS · default'));
  });

  // M8 decision 6 (fix wave 2): a tab the person moved to while the Space's folder was being added stays in front
  it('a card whose Space’s folder is still being added opens its chat behind a tab the person moved to meanwhile', async () => {
    const creator = vi.fn(async () => at(S(8)));
    offs.push(registerSessionCreator(creator));
    const location = { kind: 'directory', path: '/Users/me/work' };
    const folder = deferred<unknown>();
    answers['session.projects.addFolder'] = () => folder.promise;
    const user = userEvent.setup();
    act(() => setLibraryView({ view: 'bySpace', spaceId: WORK })); // linked to a folder
    render(<Library />);
    const made = await section();
    await waitFor(() => expect((card(made, 'Document') as HTMLButtonElement).disabled).toBe(false));
    await user.click(card(made, 'Document'));
    await waitFor(() => expect(main.callsOf('session.projects.addFolder')).toHaveLength(1));
    act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: at(S(5)) })); // the person moved meanwhile
    await act(async () => folder.resolve(ok({ project: { id: 'p-9', name: 'work', directory: '/Users/me/work', order: 3, createdAt: '2026-10-01T00:00:00.000Z' }, location })));
    await waitFor(() => expect(tabIds()).toContain(`session:${at(S(8))}`));
    expect(currentSet(useLayout.getState().main).panes[0]!.activeTabId).toBe(`session:${at(S(5))}`);
    await waitFor(() => expect(prefillOf(8)).toEqual({ text: 'Make a document in the Space “Work”: ' }));
  });

  // §I's card row, Constraint 9: the awaited start fails
  it('a linked folder that cannot be added ends in a toast, and a chat that cannot be made in nothing; either way the card is enabled again', async () => {
    const { useNotices } = await import('../stores/notices');
    const creator = vi.fn(async (): Promise<AppSessionId | null> => null);
    offs.push(registerSessionCreator(creator));
    answers['session.projects.addFolder'] = () => ({ ok: false, error: { code: 'invalid_input', message: 'the folder is gone' } });
    const user = userEvent.setup();
    act(() => setLibraryView({ view: 'bySpace', spaceId: WORK })); // linked to a folder
    render(<Library />);
    const made = await section();
    await waitFor(() => expect((card(made, 'Document') as HTMLButtonElement).disabled).toBe(false));
    await user.click(card(made, 'Document'));
    await waitFor(() => expect(useNotices.getState().notices.map((n) => n.text)).toContain('the folder is gone'));
    expect(creator).not.toHaveBeenCalled();
    await waitFor(() => expect((card(made, 'Document') as HTMLButtonElement).disabled).toBe(false));

    act(() => setLibraryView({ spaceId: HOME })); // no folder: the session's creation itself fails
    await user.click(card(made, 'Presentation'));
    await waitFor(() => expect(creator).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((card(made, 'Presentation') as HTMLButtonElement).disabled).toBe(false));
    expect([...useComposerStore.getState().prefills.values()].map((prefill) => prefill.text)).not.toContain('Make a presentation in the Space “Home”: ');
  });

  it('a kind whose editor lands later gains its Blank at once', async () => {
    render(<Library />);
    const made = await section();
    expect(within(made).queryByRole('button', { name: 'Blank design' })).toBeNull();
    act(() => void registerArtifactEditor('design', { Panel: () => null }));
    expect(blank(made, 'Design')).toBeTruthy();
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

// UX wave U10b (l8-settings-13; docs/doperpowers/plans/2026-11-15-ux-wave-U10b-artifacts.md, M9 and §E.2, §E.3): a
// Space carries instructions for agents, written from its menu in a sheet with one field, held by the engine host's
// `spaces.instructions` and `spaces.setInstructions`; a Space that has them shows the mark "Instructions" on its heading
// line; a chat a card starts from such a Space carries them as one chip after the opening words.
describe('a Space’s instructions', () => {
  type Held = { spaceId: string; text: string; at: number };
  let held: Held[];
  const RECEIVERS = 'Every agent on this Mac that makes or opens an artifact in this Space is given these, and whoever can read its session can read them.';
  const prefillOf = (n: number) => useComposerStore.getState().prefills.get(at(S(n)));
  // the engine host's answer, then its announcement, as a write there makes them
  const store = async (next: Held[], spaceId: string) => {
    held = next;
    await act(async () => main.emit('spaces.changed', { spaceId, change: 'updated' }));
  };
  const bySpace = async (user: ReturnType<typeof userEvent.setup>) => {
    render(<Library />);
    await user.click(screen.getByRole('radio', { name: 'By Space' }));
  };
  const headingOf = async (name: string) => (await screen.findByRole('heading', { name, level: 2 })).parentElement as HTMLElement; // the Space's heading line
  const markOf = (heading: HTMLElement) => within(heading).queryByRole('button', { name: 'Instructions' });
  const markFound = async (space: string) => within(await headingOf(space)).findByRole('button', { name: 'Instructions' });
  const field = (sheet: HTMLElement) => within(sheet).getByRole('textbox') as HTMLTextAreaElement;
  const button = (sheet: HTMLElement, name: string) => within(sheet).getByRole('button', { name }) as HTMLButtonElement;

  beforeEach(() => {
    held = [];
    answers['spaces.instructions'] = () => ok({ instructions: held });
  });

  it('are written from the Space’s menu, “Instructions…” directly after “Rename…”, in a sheet that says who receives them; Enter makes a new line; the Space then shows the mark, which opens the sheet', async () => {
    answers['spaces.setInstructions'] = () => ok();
    const user = userEvent.setup();
    await bySpace(user);
    expect(markOf(await headingOf('Home'))).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Actions for the Space Home' }));
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual(['Show only this Space', 'Rename…', 'Instructions…', 'Link a folder…', 'Delete Space…']);
    await user.click(screen.getByRole('menuitem', { name: 'Instructions…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Instructions for “Home”' });
    expect(within(sheet).getByText(RECEIVERS)).toBeTruthy();
    expect(field(sheet).value).toBe('');
    expect(button(sheet, 'Save').disabled).toBe(true); // nothing differs from what is stored
    await user.type(field(sheet), 'Use metres.{Enter}Cite the field log.');
    expect(field(sheet).value).toBe('Use metres.\nCite the field log.');
    expect(main.callsOf('spaces.setInstructions')).toEqual([]);
    await user.click(button(sheet, 'Save'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(main.callsOf('spaces.setInstructions')).toEqual([{ spaceId: HOME, text: 'Use metres.\nCite the field log.' }]);

    await store([{ spaceId: HOME, text: 'Use metres.\nCite the field log.', at: 5 }], HOME);
    const mark = await markFound('Home');
    expect(markOf(await headingOf('Work'))).toBeNull();
    await user.click(mark);
    const again = await screen.findByRole('dialog', { name: 'Instructions for “Home”' });
    expect(field(again).value).toBe('Use metres.\nCite the field log.');
    expect(button(again, 'Save').disabled).toBe(true);
  });

  it('show the mark on the narrowed Space’s bar too, after its folder and before its menu', async () => {
    held = [{ spaceId: WORK, text: 'Use metres.', at: 5 }];
    act(() => setLibraryView({ view: 'bySpace', spaceId: WORK }));
    render(<Library />);
    const bar = (await screen.findByRole('button', { name: 'All Spaces' })).parentElement as HTMLElement;
    const mark = await within(bar).findByRole('button', { name: 'Instructions' });
    const order = [...bar.querySelectorAll('span, button')].map((el) => el.textContent || el.getAttribute('aria-label'));
    expect(order.indexOf('Mirrored to /Users/me/work/artifacts')).toBeLessThan(order.indexOf('Instructions'));
    expect(order.indexOf('Instructions')).toBeLessThan(order.indexOf('Actions for the Space Work'));
    expect(mark.className).toContain('h-6'); // a pressed area 24 px tall
  });

  it('saving an empty text removes the instructions, and the mark with them', async () => {
    held = [{ spaceId: WORK, text: 'Use metres.', at: 5 }];
    answers['spaces.setInstructions'] = () => ok();
    const user = userEvent.setup();
    await bySpace(user);
    await user.click(await markFound('Work'));
    const sheet = await screen.findByRole('dialog', { name: 'Instructions for “Work”' });
    await user.clear(field(sheet));
    expect(button(sheet, 'Save').disabled).toBe(false); // the empty text differs from what is stored
    await user.click(button(sheet, 'Save'));
    await waitFor(() => expect(main.callsOf('spaces.setInstructions')).toEqual([{ spaceId: WORK, text: '' }]));
    await store([], WORK);
    await waitFor(async () => expect(markOf(await headingOf('Work'))).toBeNull());
  });

  it('take at most 8,000 characters: a paste is cut there, a line under the field counts from 7,500, and 8,001 cannot be saved', async () => {
    answers['spaces.setInstructions'] = () => ok();
    const user = userEvent.setup();
    await bySpace(user);
    await user.click(await screen.findByRole('button', { name: 'Actions for the Space Home' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Instructions…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Instructions for “Home”' });
    expect(field(sheet).maxLength).toBe(8000);
    fireEvent.change(field(sheet), { target: { value: 'x'.repeat(7499) } });
    expect(within(sheet).queryByText(/of 8,000 characters/)).toBeNull();
    fireEvent.change(field(sheet), { target: { value: 'x'.repeat(7500) } });
    expect(within(sheet).getByText('7,500 of 8,000 characters')).toBeTruthy();
    fireEvent.change(field(sheet), { target: { value: 'y'.repeat(8001) } });
    expect(field(sheet).value).toBe('y'.repeat(8000));
    expect(within(sheet).getByText('8,000 of 8,000 characters')).toBeTruthy();
    await user.click(button(sheet, 'Save'));
    await waitFor(() => expect(main.callsOf('spaces.setInstructions')).toEqual([{ spaceId: HOME, text: 'y'.repeat(8000) }]));
  });

  it('a save held open disables both buttons and is not cancelled by closing the sheet; a failed save keeps the sheet open with its text and says why', async () => {
    const answer = deferred<ReturnType<typeof ok>>();
    answers['spaces.setInstructions'] = () => answer.promise;
    const user = userEvent.setup();
    await bySpace(user);
    await user.click(await screen.findByRole('button', { name: 'Actions for the Space Home' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Instructions…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Instructions for “Home”' });
    await user.type(field(sheet), 'Use metres.');
    await user.click(button(sheet, 'Save'));
    expect(button(sheet, 'Save').disabled).toBe(true);
    expect(button(sheet, 'Cancel').disabled).toBe(true);
    await user.click(button(sheet, 'Save'));
    expect(main.callsOf('spaces.setInstructions')).toHaveLength(1);
    await act(async () => answer.resolve({ ok: false, error: { code: 'internal', message: 'the store is read-only' } }));
    expect(within(sheet).getByText('the store is read-only')).toBeTruthy();
    expect(field(sheet).value).toBe('Use metres.');
    expect(button(sheet, 'Save').disabled).toBe(false);

    const second = deferred<ReturnType<typeof ok>>();
    answers['spaces.setInstructions'] = () => second.promise;
    await user.click(button(sheet, 'Save'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => second.resolve(ok()));
    expect(main.callsOf('spaces.setInstructions')).toEqual([{ spaceId: HOME, text: 'Use metres.' }, { spaceId: HOME, text: 'Use metres.' }]);
  });

  // the task review of M9: what is saved is what the field shows, so nothing typed while the save runs is lost
  it('a save in flight leaves the field read-only, so what is stored is what was shown', async () => {
    const answer = deferred<ReturnType<typeof ok>>();
    answers['spaces.setInstructions'] = () => answer.promise;
    const user = userEvent.setup();
    await bySpace(user);
    await user.click(await screen.findByRole('button', { name: 'Actions for the Space Home' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Instructions…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Instructions for “Home”' });
    expect(field(sheet).readOnly).toBe(false);
    await user.type(field(sheet), 'Use metres.');
    await user.click(button(sheet, 'Save'));
    expect(field(sheet).readOnly).toBe(true);
    await user.type(field(sheet), ' And Celsius.');
    expect(field(sheet).value).toBe('Use metres.');
    await act(async () => answer.resolve(ok()));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(main.callsOf('spaces.setInstructions')).toEqual([{ spaceId: HOME, text: 'Use metres.' }]);
  });

  // the branch review of U10b-4: text the person never saw is never overwritten. Until the stored text is read the field
  // is held (it takes no typing), and a read that failed offers no Save; once shown, a later answer does not replace
  // what the person typed.
  it('hold the field until the read answers, and a late answer never replaces what the person typed after the text was shown', async () => {
    held = [{ spaceId: WORK, text: 'Use metres.', at: 5 }];
    const first = deferred<ReturnType<typeof ok>>();
    answers['spaces.instructions'] = () => first.promise;
    answers['spaces.setInstructions'] = () => ok();
    const user = userEvent.setup();
    await bySpace(user);
    await user.click(await screen.findByRole('button', { name: 'Actions for the Space Work' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Instructions…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Instructions for “Work”' });
    expect(field(sheet).readOnly).toBe(true);
    await user.type(field(sheet), 'Use feet.');
    expect(field(sheet).value).toBe('');
    expect(button(sheet, 'Save').disabled).toBe(true);
    await act(async () => first.resolve(ok({ instructions: held })));
    await waitFor(() => expect(field(sheet).value).toBe('Use metres.'));
    expect(field(sheet).readOnly).toBe(false);
    await user.type(field(sheet), ' And Celsius.');
    answers['spaces.instructions'] = () => ok({ instructions: held });
    await store([{ spaceId: WORK, text: 'Use kilometres.', at: 6 }], WORK); // a later answer
    await waitFor(() => expect(main.callsOf('spaces.instructions').length).toBeGreaterThan(1));
    expect(field(sheet).value).toBe('Use metres. And Celsius.');
    await user.click(button(sheet, 'Save'));
    await waitFor(() => expect(main.callsOf('spaces.setInstructions')).toEqual([{ spaceId: WORK, text: 'Use metres. And Celsius.' }]));
  });

  // the task review of the branch fix: a refresh that fails after a good answer may hide text written since (here from
  // another window), so the sheet treats it as failed until a later read succeeds
  it('a refresh that fails after a successful read shows the failure, holds the field and offers no Save until a read succeeds', async () => {
    answers['spaces.setInstructions'] = () => ok();
    const user = userEvent.setup();
    await bySpace(user);
    await user.click(await screen.findByRole('button', { name: 'Actions for the Space Work' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Instructions…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Instructions for “Work”' });
    await waitFor(() => expect(field(sheet).readOnly).toBe(false)); // read: no instructions yet
    held = [{ spaceId: WORK, text: 'Use metres.', at: 5 }]; // written from another window
    answers['spaces.instructions'] = () => ({ ok: false, error: { code: 'internal', message: 'the engine host is unavailable' } });
    await act(async () => main.emit('spaces.changed', { spaceId: WORK, change: 'updated' }));
    await within(sheet).findByText('Couldn’t read this Space’s instructions: the engine host is unavailable');
    expect(field(sheet).readOnly).toBe(true);
    expect(within(sheet).queryByRole('button', { name: 'Save' })).toBeNull();
    answers['spaces.instructions'] = () => ok({ instructions: held });
    await store(held, WORK);
    await waitFor(() => expect(field(sheet).value).toBe('Use metres.'));
    expect(field(sheet).readOnly).toBe(false);
    expect(within(sheet).queryByText(/Couldn’t read/)).toBeNull();
    expect(button(sheet, 'Save').disabled).toBe(true);
    expect(main.callsOf('spaces.setInstructions')).toEqual([]);
  });

  it('a failed read shows the failure, holds the field and offers no Save', async () => {
    answers['spaces.instructions'] = () => ({ ok: false, error: { code: 'internal', message: 'the engine host is unavailable' } });
    answers['spaces.setInstructions'] = () => ok();
    const user = userEvent.setup();
    await bySpace(user);
    await user.click(await screen.findByRole('button', { name: 'Actions for the Space Work' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Instructions…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Instructions for “Work”' });
    await within(sheet).findByText('Couldn’t read this Space’s instructions: the engine host is unavailable');
    expect(field(sheet).readOnly).toBe(true);
    await user.type(field(sheet), 'Use feet.{Enter}');
    expect(field(sheet).value).toBe('');
    expect(within(sheet).queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.submit(field(sheet).closest('form')!);
    await user.click(button(sheet, 'Cancel'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(main.callsOf('spaces.setInstructions')).toEqual([]);
  });

  it('ride in a chat a card starts from the Space as one chip after the opening words, its body sent with the first message; a Space without them adds no chip', async () => {
    held = [{ spaceId: WORK, text: 'Use metres.\nCite the field log.', at: 5 }];
    const creator = vi.fn(async () => at(S(8)));
    offs.push(registerSessionCreator(creator));
    answers['session.projects.addFolder'] = () => ok({ project: { id: 'p-9', name: 'work', directory: '/Users/me/work', order: 3, createdAt: '2026-10-01T00:00:00.000Z' }, location: { kind: 'directory', path: '/Users/me/work' } });
    const user = userEvent.setup();
    act(() => setLibraryView({ view: 'bySpace', spaceId: WORK }));
    render(<Library />);
    const bar = (await screen.findByRole('button', { name: 'All Spaces' })).parentElement as HTMLElement;
    await within(bar).findByRole('button', { name: 'Instructions' }); // the instructions are read
    const made = await screen.findByRole('region', { name: 'Make something new' });
    const documentCard = within(within(made).getByRole('group', { name: 'Document' })).getByRole('button', { name: 'Document' });
    await waitFor(() => expect((documentCard as HTMLButtonElement).disabled).toBe(false));
    await user.click(documentCard);
    const body = 'Instructions of the Space “Work”, set by the user in MAWS:\nUse metres.\nCite the field log.';
    await waitFor(() => expect(prefillOf(8)).toEqual({ text: 'Make a document in the Space “Work”: [Pasted text #1 +3 lines]', pasted: [{ name: 'Instructions for “Work”', text: body }] }));
    const doc = prefillToDoc(prefillOf(8)!);
    const chips = (doc.content ?? []).flatMap((p) => p.content ?? []).filter((n) => n.type === 'pasted');
    expect(chips.map((chip) => [chip.attrs?.name, chip.attrs?.lines])).toEqual([['Instructions for “Work”', 3]]);
    const sent = serializeDraft(doc, { sessionId: 'eng-8', cwd: '/Users/me/work' });
    expect(sent.pastedContents['1']?.content).toBe(body);
    expect(String(sent.content)).toContain(`Make a document in the Space “Work”: `);
    expect(String(sent.content)).toContain(body);

    act(() => setLibraryView({ spaceId: HOME })); // a Space with no instructions
    await user.click(within(within(made).getByRole('group', { name: 'Document' })).getByRole('button', { name: 'Document' }));
    await waitFor(() => expect(creator).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(prefillOf(8)).toEqual({ text: 'Make a document in the Space “Home”: ' }));
  });
});
