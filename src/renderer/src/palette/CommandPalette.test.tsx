import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_IDS, ACTIONS, type ActionId, type ActionTable } from '@shared/keymap/actions';
import { EXTENDED_TABLE, sample } from '@shared/keymap/sample-rows'; // U6a
import { formatChord } from '@shared/keymap/chord';
import { registerShellActions } from '../app/shell-actions';
import { isActionEnabled, registerAction, runAction } from '../keymap/actions-runtime';
import { connectVisits, useVisits } from '../keymap/visits'; // UX wave U6b-5a M4: Recent
import { EMPTY_RECORD } from '../keymap/places';
import { useLibraryView, resetLibraryView } from '../library/view';
import { artifactId, countsOf, libraryRow } from '../test-support/remote-artifacts';
import type { AppSessionId } from '@shared/graph/ids';
import { useSessions } from '../stores/sessions';
import { useLayout } from '../stores/layout';
import { activeTab, allTabs, currentSet } from '../stores/layout-model';
import { fillStores, pageScenario, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { addressOf } from '@shared/machine/address';
import type { MachineRef } from '@shared/machine/ref';
import type { OrgKey } from '@shared/machine/org-key';
import type { PreloadBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { record, remoteRow } from '../../../../test/support/builders';
import { useMachines } from '../stores/machines';
import { registerRemoteOpener } from '../sessions/remote-openers';
import { Sidebar } from '../sidebar/Sidebar';
import { projectNodeId } from '../sidebar/tree';
import { ipc } from '../ipc/client';
import { openConversationSearch, CommandPalette, listable, paletteEntries, usePalette } from './CommandPalette';
import { RECENT_MAX } from './recent';

const file = scenarioFile('nine-sessions');
const nine = pageScenario(file); // P5 O6 M2: the scenario as the page holds it
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const offs: (() => void)[] = [];

beforeEach(() => {
  resetShellStores();
  fillStores(file);
  usePalette.setState({ open: false });
  useVisits.setState({ record: EMPTY_RECORD, opened: [] }); // UX wave U6b-5a M4: nothing opened in this run
  resetLibraryView();
  offs.push(registerShellActions({ invoke: vi.fn(async () => ({ ok: true, value: undefined })), on: vi.fn(() => () => {}) } as never));
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
});

const dialog = () => screen.getByRole('dialog', { name: 'Command palette' });
const group = (name: string) => within(dialog()).queryByRole('group', { name });
const options = (name: string) => {
  const g = group(name);
  return g ? within(g).queryAllByRole('option').map((o) => o.getAttribute('aria-label') ?? o.textContent) : [];
};

async function openAndType(query: string) {
  const user = userEvent.setup();
  render(<CommandPalette />);
  act(() => runAction('palette.open'));
  if (query) await user.keyboard(query);
  return user;
}

describe('command palette', () => {
  it('opens on palette.open with the query field focused, and closes on Escape', async () => {
    const user = await openAndType('');
    expect(document.activeElement).toBe(within(dialog()).getByRole('combobox'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // UX wave U6b-5a (M4; P9; Interfaces §E): a row is listed when it is listable (not fixed, not a renderer row of a pane or
  // the composer, which only a key in a focused element can run) and has a handler; nothing is drawn disabled
  it('lists the rows it can run, each with its chord; a row with no handler, and a pane or composer key, are absent', async () => {
    await openAndType('');
    const values = () => within(group('Actions')!).getAllByRole('option').map((o) => o.dataset.value);
    const runnable = ACTION_IDS.filter((id) => listable(id, ACTIONS) && isActionEnabled(id));
    expect(runnable.length).toBeGreaterThan(0);
    expect(values()).toEqual(runnable.map((id) => `action:${id}`));
    for (const option of within(group('Actions')!).getAllByRole('option')) {
      const id = option.dataset.value!.slice('action:'.length) as ActionId;
      expect(option.textContent, id).toContain(ACTIONS[id].title);
      if (ACTIONS[id].chord) expect(option.textContent, id).toContain(formatChord(ACTIONS[id].chord!));
      expect(option.getAttribute('aria-disabled'), id).toBe('false');
    }
    expect(isActionEnabled('session.new')).toBe(false);
    expect(values()).not.toContain('action:session.new'); // no handler
    expect(isActionEnabled('tab.next')).toBe(true);
    expect(values()).not.toContain('action:tab.next'); // a pane's key, with a handler
    for (const id of ['composer.submit', 'composer.newLine', 'composer.newLineOption']) expect(values(), id).not.toContain(`action:${id}`); // U6a: fixed
    act(() => void offs.push(registerAction('composer.queue', () => {}), registerAction('request.allowOnce', () => {})));
    expect(values()).not.toContain('action:composer.queue'); // a composer's key, even with a handler
    expect(values()).not.toContain('action:request.allowOnce'); // a focused request's
    act(() => void offs.push(registerAction('session.new', () => {}))); // the control: a listable row's handler makes it appear
    expect(values()).toContain('action:session.new');
  });

  it('decides what is listable from the row alone: not fixed, not a renderer row of a pane or the composer', () => {
    expect(listable('session.new', ACTIONS)).toBe(true);
    expect(listable('composer.focus', ACTIONS)).toBe(true); // a renderer row of the app
    expect(listable('tab.next', ACTIONS)).toBe(false);
    expect(listable('composer.cycleMode', ACTIONS)).toBe(false);
    expect(listable('composer.submit', ACTIONS)).toBe(false);
  });

  it('“quota” lists exactly one session, Quota reset recovery, with its glyph and project', async () => {
    await openAndType('quota');
    const sessions = within(group('Sessions')!).getAllByRole('option');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].textContent).toContain('Quota reset recovery');
    expect(sessions[0].textContent).toContain('codex_somersault');
    expect(within(sessions[0]).getByRole('img', { name: 'Plan review' })).toBeTruthy();
    expect(options('Actions')).toEqual([]);
  });

  // P5 O7 M10 (a busy remote session's state): another machine's lane B record, which has no digest, by its listing
  it('draws another machine’s lane B record by its listing’s state, its age "now" while busy', async () => {
    const b1 = addressOf(OTHER_MACHINE, 'b1' as AppSessionId);
    useSessions.setState({
      records: new Map([...useSessions.getState().records, [b1, record(b1, { title: { text: 'Studio build', source: 'user' } })]]),
      listed: new Map([[b1, { ...remoteRow(OTHER_MACHINE, 'b1', { state: 'busy' }), appId: b1 }]]),
    });
    await openAndType('studio build');
    const option = within(dialog()).getAllByRole('option').find((o) => o.textContent?.includes('Studio build'))!;
    expect(within(option).getByRole('img', { name: 'Working' })).toBeTruthy();
    expect(option.textContent).toMatch(/now$/);
  });

  it('“dark” lists exactly one action, Appearance: Dark', async () => {
    await openAndType('dark');
    const actions = within(group('Actions')!).getAllByRole('option');
    expect(actions.map((o) => o.dataset.value)).toEqual(['action:theme.dark']);
    expect(group('Sessions')).toBeNull();
  });

  // UX wave U6b-5a (M4; decision 19): the sidebar's rule admits, the scorer orders by title; a session found by its folder
  // alone has no score and follows those found by title
  it('orders the sessions the sidebar’s rule finds by the scorer, one found by its folder alone after those found by title', async () => {
    const extra = [
      record(at('r1'), { title: { text: 'Ship it', source: 'user' }, directory: '/work/deploy-tools' }),
      record(at('r2'), { title: { text: 'Undeployable plan', source: 'user' }, directory: '/work/r2' }),
      record(at('r3'), { title: { text: 'Deploy checklist', source: 'user' }, directory: '/work/r3' }),
    ];
    useSessions.setState({ records: new Map([...useSessions.getState().records, ...extra.map((r) => [r.appId, r] as const)]) });
    await openAndType('deploy');
    expect(options('Sessions')).toEqual([expect.stringContaining('Deploy checklist'), expect.stringContaining('Undeployable plan'), expect.stringContaining('Ship it')]);
  });

  // Decision Log 11 (vii): Back and Forward are listable rows with handlers, listed while they can run
  it('lists Back while there is a place before, and Forward only once there is one after', async () => {
    offs.push(connectVisits());
    const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (const title of ['Quota reset recovery', 'Fix sidebar drag']) {
      act(() => useLayout.getState().openTab({ kind: 'session', appSessionId: idOf(title) }));
      await act(turn);
    }
    const user = await openAndType('back');
    const values = () => (group('Actions') ? within(group('Actions')!).getAllByRole('option').map((o) => o.dataset.value) : []);
    expect(values()).toContain('action:go.back');
    await user.clear(within(dialog()).getByRole('combobox'));
    await user.keyboard('forward');
    expect(values()).not.toContain('action:go.forward');
    act(() => runAction('go.back')); // the control: with a place after, Forward can run and is listed
    await act(turn);
    expect(values()).toContain('action:go.forward');
  });

  it('⏎ on a session opens its tab in the focused pane and closes the palette', async () => {
    const user = await openAndType('quota');
    await user.keyboard('{Enter}');
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${idOf('Quota reset recovery')}`);
    expect(currentSet(useLayout.getState().main).panes).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('⌘⏎ on a session opens it in the split', async () => {
    useLayout.getState().openSession(idOf('Charter + research')); // a tab beside which to split (an empty pane takes the session itself)
    const user = await openAndType('quota');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(currentSet(useLayout.getState().main).panes).toHaveLength(2);
    expect(currentSet(useLayout.getState().main).panes[1]?.activeTabId).toBe(`session:${idOf('Quota reset recovery')}`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('⏎ on an action closes the palette and runs it', async () => {
    const run = vi.fn();
    offs.push(registerAction('diagnostics.open', run));
    const user = await openAndType('diagnostics');
    await user.keyboard('{Enter}');
    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    ['Focus sidebar', 'Sidebar destination'],
    ['Focus next region', 'Panel destination'],
    ['Focus previous region', 'Sidebar destination'],
  ])('runs %s after the palette releases its modal focus', async (title, destination) => {
    const user = userEvent.setup();
    render(<>
      <section id="region-sidebar"><button>Sidebar destination</button></section>
      <section id="region-main"><button>Main destination</button></section>
      <section id="region-panel"><button>Panel destination</button></section>
      <CommandPalette />
    </>);
    screen.getByRole('button', { name: 'Main destination' }).focus();
    act(() => runAction('palette.open'));
    await user.keyboard(title);
    expect(document.activeElement).toBe(within(dialog()).getByRole('combobox'));
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: destination })));
  });

  // UX wave U6b-3b (M1, fix 1): Go to file records where the keyboard is for Esc's second step, so it runs once the
  // palette has given the keyboard back to its opener, as the region steps do; an action that moves no keyboard runs at once
  it('runs Go to file after the palette gives the keyboard back to its opener; another action runs while the palette holds it', async () => {
    const user = userEvent.setup();
    const seen: Record<string, Element | null> = {};
    offs.push(registerAction('files.goToFile', () => void (seen.goToFile = document.activeElement)));
    offs.push(registerAction('diagnostics.open', () => void (seen.diagnostics = document.activeElement)));
    render(<><textarea aria-label="Composer" /><CommandPalette /></>);
    const composer = screen.getByRole('textbox', { name: 'Composer' });
    act(() => composer.focus());
    act(() => runAction('palette.open'));
    await user.keyboard('Go to file');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await vi.waitFor(() => expect(seen.goToFile).toBe(composer));
    act(() => composer.focus()); // the control: an action outside the set runs while the palette's field holds the keyboard
    act(() => runAction('palette.open'));
    const field = within(dialog()).getByRole('combobox');
    await user.keyboard('Diagnostics');
    await user.keyboard('{Enter}');
    expect(seen.diagnostics).toBe(field);
  });

  it('a project reveals it in the sidebar: shown, its row expanded', async () => {
    useLayout.getState().setSidebar({ collapsed: true, expandedProjects: [] });
    const user = await openAndType(nine.projects[1].name.slice(0, 7));
    expect(options('Projects')).toEqual([nine.projects[1].name]);
    await user.click(within(group('Projects')!).getByRole('option'));
    expect(useLayout.getState().regions.sidebar).toMatchObject({ collapsed: false, expandedProjects: [nine.projects[1].id] });
  });

  it('a project the sidebar’s search hides is revealed: the search clears, the project expands and its row takes focus', async () => {
    const project = nine.projects[1];
    const user = userEvent.setup();
    render(<Sidebar />);
    await user.type(screen.getByRole('searchbox', { name: 'Search projects and sessions' }), 'Terminal workflow');
    const projectRow = () => document.querySelector<HTMLElement>(`[data-tree-id="${projectNodeId(project.id)}"]`);
    expect(projectRow()).toBeNull(); // the filter hides the project
    render(<CommandPalette />);
    act(() => runAction('palette.open'));
    await user.keyboard(project.name.slice(0, 7));
    await user.click(within(group('Projects')!).getByRole('option'));
    expect((screen.getByRole('searchbox', { name: 'Search projects and sessions' }) as HTMLInputElement).value).toBe('');
    await vi.waitFor(() => expect(document.activeElement).toBe(projectRow()));
    expect(projectRow()!.getAttribute('aria-expanded')).toBe('true');
    expect(within(projectRow()!).getByRole('treeitem', { name: 'Quota reset recovery' })).toBeTruthy();
  });
});

// P5 O7 M6 (docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md, M6 "Search"): conversation search asks this Mac and
// each RL2 machine that is up, and draws each machine's hits under its name; a listed hit with no record is its listed
// row, opened through its lane's opener; a machine that can't answer is left out with no error.
describe('conversation search across machines', () => {
  const THIRD = 'ThirdMachineRef0000000' as MachineRef;
  const onB = (id: string) => addressOf(OTHER_MACHINE, id as AppSessionId);
  let bridge: unknown;
  beforeEach(() => {
    bridge = window.maws;
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-01T00:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: '2026-11-01T00:00:00Z', generation: 1 },
      { ref: THIRD, name: 'Lab', local: false, state: 'up', since: '2026-11-01T00:00:00Z', generation: 1 },
    ]);
    useSessions.setState({ listedMachines: new Set([OTHER_MACHINE, THIRD]), listed: new Map([[onB('b1'), { ...remoteRow(OTHER_MACHINE, 'b1', { title: 'Studio build' }), appId: onB('b1') }]]) });
  });
  afterEach(() => {
    window.maws = bridge as PreloadBridge;
    useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  });

  it('merges every machine’s hits under its machine and leaves out one that can’t answer, quietly', async () => {
    const opened: AppSessionId[] = [];
    offs.push(registerRemoteOpener('B', (listed) => opened.push(listed.appId)));
    const fake = fakeClient();
    window.maws = fake.client as unknown as PreloadBridge;
    act(() => openConversationSearch('deploy'));
    render(<CommandPalette />);
    await vi.waitFor(() => expect(fake.pending('session.search')).toBe(3));
    expect(fake.machines('session.search')).toEqual([TEST_MACHINE, OTHER_MACHINE, THIRD]);
    const quota = nine.sessions.find((r) => r.title.text === 'Quota reset recovery')!;
    await act(async () => {
      await fake.reply('session.search', { hits: [{ appSessionId: quota.appId.slice(TEST_MACHINE.length + 1), snippet: 'the deploy step' }], indexing: false, incomplete: false });
      await fake.reply('session.search', { hits: [{ appSessionId: 'b1', snippet: 'deploy to the studio' }, { appSessionId: 'unlisted', snippet: null }], indexing: false, incomplete: false });
      await fake.fail('session.search', 'Lab is offline', 'host_unavailable');
    });
    await vi.waitFor(() => expect(group('Studio')).not.toBeNull());
    expect(options('This Mac')).toEqual([expect.stringContaining('Quota reset recovery')]);
    expect(options('Studio')).toEqual([expect.stringContaining('Studio build')]);
    expect(within(group('Studio')!).getByRole('option').textContent).toContain('deploy to the studio');
    expect(group('Lab')).toBeNull();
    expect(group('Studio')!.closest('[data-search-machine]')?.getAttribute('data-search-machine')).toBe(OTHER_MACHINE); // M6d's selector
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    await userEvent.click(within(group('Studio')!).getByRole('option'));
    expect(opened).toEqual([onB('b1')]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps one “Sessions” group while only this Mac has hits', async () => {
    const fake = fakeClient();
    window.maws = fake.client as unknown as PreloadBridge;
    act(() => openConversationSearch('quota'));
    render(<CommandPalette />);
    await vi.waitFor(() => expect(fake.pending('session.search')).toBe(3));
    const quota = nine.sessions.find((r) => r.title.text === 'Quota reset recovery')!;
    await act(async () => {
      await fake.reply('session.search', { hits: [{ appSessionId: quota.appId.slice(TEST_MACHINE.length + 1), snippet: null }], indexing: false, incomplete: false });
      await fake.reply('session.search', { hits: [], indexing: false, incomplete: false });
      await fake.fail('session.search', 'refused', 'timeout');
    });
    await vi.waitFor(() => expect(group('Sessions')).not.toBeNull());
    expect(options('Sessions')).toEqual([expect.stringContaining('Quota reset recovery')]);
    expect(within(dialog()).getByRole('alert').textContent).toBe('Lab: refused');
  });
});

describe('palette entries', () => {
  it('search sessions as the sidebar does, projects by name and directory, actions by title; archived sessions never', () => {
    const records = new Map(nine.sessions.map((r) => [r.appId, r]));
    const projects = new Map(nine.projects.map((p) => [p.id, p]));
    const quota = idOf('Quota reset recovery');
    records.set(quota, { ...records.get(quota)!, archived: true });
    const found = paletteEntries('quota', { records, projects });
    expect(found.sessions).toEqual([]);
    expect(paletteEntries('MAWS', { records, projects }).projects.map((p) => p.name)).toEqual(['MAWS']);
    expect(paletteEntries('', { records, projects }).actions).toEqual(ACTION_IDS.filter((id) => listable(id, ACTIONS as ActionTable))); // UX wave U6b-5a M4
  });

  // U6a (decision 7): a fixed row (a key its editor handles) is not an act the palette can run, so it is not listed.
  // UX wave U6b-5a M4 (P9): nor is a composer's own key, which only the focused composer runs
  it('lists no fixed row and no composer key, and every other row of a table extended with a sibling’s rows', () => {
    const empty = { records: new Map(), projects: new Map() };
    const actions = paletteEntries('', empty, EXTENDED_TABLE).actions;
    expect(actions).not.toContain(sample('sample.fixed'));
    expect(actions).not.toContain(sample('sample.shared'));
    expect(actions).toContain(sample('sample.menu')); // the control: a sibling's menu row is listed
    expect(paletteEntries('sample', empty, EXTENDED_TABLE).actions).toEqual([sample('sample.menu')]);
  });
});

// UX wave U11a M5 (S-10; Interfaces §F, "The Channel's entries"): "<project> · channel" for each project that has one,
// with "N waiting" from its Channel's own waiting list; Enter opens the tab, or brings it forward.
describe('the Channel entries', () => {
  const SMNS = '1f0e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
  const USAGE = '2a3b4c5d-6e7f-4081-9293-a4b5c6d7e8f9';
  const named = (name: string) => [...useSessions.getState().projects.values()].find((p) => p.name === name)!;
  // MAWS and claude-usage-menubar become hub projects; codex_somersault stays a plain folder
  const withChannels = () => {
    const projects = new Map(useSessions.getState().projects);
    for (const [name, smnsId] of [['MAWS', SMNS], ['claude-usage-menubar', USAGE]] as const) {
      const project = named(name);
      projects.set(project.id, { ...project, org: { key: `smns:${smnsId}` as OrgKey, name, source: 'smns', smnsId } });
    }
    useSessions.setState({ projects });
  };
  const channelOptions = () => (group('Channels') ? within(group('Channels')!).getAllByRole('option') : []);
  const labelOf = (option: HTMLElement) => option.querySelector('[data-channel-name]')?.textContent ?? null;
  const detailOf = (option: HTMLElement) => option.querySelector('[data-channel-count]')?.textContent ?? null;

  beforeEach(withChannels);

  it('lists an entry per project that has a channel, with an empty query, in a group after Projects and before Actions', async () => {
    await openAndType('');
    expect(channelOptions().map(labelOf)).toEqual(['claude-usage-menubar · channel', 'MAWS · channel']);
    const before = (a: string, b: string) => Boolean(group(a)!.compareDocumentPosition(group(b)!) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before('Projects', 'Channels')).toBe(true);
    expect(before('Channels', 'Actions')).toBe(true);
  });

  it('says how many requests wait in the project, from its Channel’s waiting list, and no count at zero', async () => {
    await openAndType('');
    const [usage, maws] = channelOptions();
    expect(detailOf(maws)).toBe('2 waiting'); // the permission and the question of MAWS's sessions
    expect(detailOf(usage)).toBeNull();
  });

  it('matches by the project’s name and by “channel”, case ignored', async () => {
    const user = await openAndType('maws');
    expect(channelOptions().map(labelOf)).toEqual(['MAWS · channel']);
    await user.clear(within(dialog()).getByRole('combobox'));
    await user.keyboard('CHANNEL');
    expect(channelOptions().map(labelOf)).toEqual(['claude-usage-menubar · channel', 'MAWS · channel']);
    await user.clear(within(dialog()).getByRole('combobox'));
    await user.keyboard('somersault');
    expect(group('Channels')).toBeNull();
  });

  it('⏎ opens the Channel tab; with it open, brings it forward without a second tab', async () => {
    const user = await openAndType('channel');
    await user.keyboard('{Enter}');
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'channel', project: USAGE });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useLayout.getState().openSession(idOf('Charter + research'), { how: 'tab' }));
    act(() => runAction('palette.open'));
    await user.keyboard('channel');
    await user.keyboard('{Enter}');
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'channel', project: USAGE });
    expect(allTabs(useLayout.getState().main).filter((tab) => tab.kind === 'channel')).toHaveLength(1);
  });

  // UX wave U6b-5a (M4; P9): no row is greyed; the row comes while the tab in front has a project with a channel
  it('lists no Project channel row while the tab in front has no project with a channel', async () => {
    await openAndType('project channel');
    const values = () => (group('Actions') ? within(group('Actions')!).getAllByRole('option').map((o) => o.dataset.value) : []);
    expect(values()).not.toContain('action:channel.open');
    act(() => void offs.push(registerAction('channel.open', () => {}))); // the control: registered, it is listed
    expect(values()).toContain('action:channel.open');
  });
});

it('bounds mounted results for 3,279 sessions while searching the entire index', async () => {
  const template = nine.sessions[0];
  const records = Array.from({ length: 3279 }, (_, n) => ({ ...template, appId: at(`large-${n}` as AppSessionId), title: { ...template.title, text: `Indexed session ${n}` } }));
  useSessions.setState({ records: new Map(records.map((r) => [r.appId, r])) });
  const user = await openAndType('Indexed'); // UX wave U6b-5a M4: with nothing typed there is no Sessions group, only Recent
  expect(within(group('Sessions')!).getAllByRole('option').length).toBeLessThanOrEqual(50);
  expect(within(dialog()).getByText(/Showing the first 50 matches per group/)).toBeTruthy();
  await user.clear(within(dialog()).getByRole('combobox'));
  await user.keyboard('Indexed session 3278');
  expect(options('Sessions')).toEqual([expect.stringContaining('Indexed session 3278')]);
});

it('Escape returns focus to the element focused before each palette opening', async () => {
  const user = userEvent.setup();
  render(<><input aria-label="First opener" /><button>Second opener</button><CommandPalette /></>);
  for (const opener of [screen.getByRole('textbox'), screen.getByRole('button', { name: 'Second opener' })]) {
    act(() => opener.focus());
    act(() => runAction('palette.open'));
    expect(document.activeElement).toBe(within(dialog()).getByRole('combobox'));
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(document.activeElement).toBe(opener));
  }
});

// UX wave U6b-5a M4 (Decision Log 16 (ii)): S5's following of the first row is the All scope's; in Conversations a retry
// while indexing that adds an earlier hit leaves the selection where it was, and Enter runs it
it('keeps the Conversations selection by value when an indexing retry adds an earlier hit', async () => {
  vi.useFakeTimers();
  const quota = idOf('Quota reset recovery');
  const charter = idOf('Charter + research');
  const invoke = vi.spyOn(ipc, 'invoke')
    .mockResolvedValueOnce({ ok: true, value: { hits: [{ appSessionId: quota, snippet: 'a needle' }], indexing: true, incomplete: false } } as never)
    .mockResolvedValue({ ok: true, value: { hits: [{ appSessionId: charter, snippet: 'an earlier needle' }, { appSessionId: quota, snippet: 'a needle' }], indexing: false, incomplete: false } } as never);
  try {
    render(<CommandPalette />);
    act(() => openConversationSearch('needle'));
    await act(() => vi.advanceTimersByTimeAsync(150));
    const selectedValue = () => within(dialog()).getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')?.dataset.value;
    expect(selectedValue()).toBe(`session:${quota}`);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(within(dialog()).getAllByRole('option').map((o) => o.dataset.value)).toEqual([`session:${charter}`, `session:${quota}`]); // the control: the earlier hit is drawn first
    expect(selectedValue()).toBe(`session:${quota}`);
    fireEvent.keyDown(within(dialog()).getByRole('combobox'), { key: 'Enter' });
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${quota}`);
  } finally { invoke.mockRestore(); vi.useRealTimers(); }
});

it('shows terminal incomplete indexing without polling forever or hiding available results', async () => {
  vi.useFakeTimers();
  const id = idOf('Quota reset recovery');
  const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { hits: [{ appSessionId: id, snippet: 'Available conversation text' }], indexing: false, incomplete: true } } as never);
  try {
    render(<CommandPalette />);
    act(() => openConversationSearch('needle'));
    await act(() => vi.advanceTimersByTimeAsync(150));
    expect(screen.getByRole('alert').textContent).toContain('Some conversations could not be indexed');
    expect(screen.getByText('Available conversation text')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(invoke).toHaveBeenCalledTimes(1);
  } finally { invoke.mockRestore(); vi.useRealTimers(); }
});

it('opens conversation matches from the sidebar query with a snippet, without mixing in commands', async () => {
  const id = idOf('Quota reset recovery');
  const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { hits: [{ appSessionId: id, snippet: 'Remember bg-finished in the prompt' }], indexing: false } } as never);
  try {
    render(<CommandPalette />);
    act(() => openConversationSearch('bg-finished'));
    expect((within(dialog()).getByRole('combobox') as HTMLInputElement).value).toBe('bg-finished');
    expect(await screen.findByText('Remember bg-finished in the prompt')).toBeTruthy();
    expect(group('Actions')).toBeNull();
    await userEvent.setup().keyboard('{Enter}');
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${id}`);
  } finally { invoke.mockRestore(); }
});

it.each([
  ['...red apple <message>green pear</message> blue plum...', '...red apple green pear blue plum...'],
  ['...<message>green pear', '...green pear'],
  ['green pear</message>...', 'green pear...'],
  ['Use `<message>` for green pear, not <example>.', 'Use `<message>` for green pear, not <example>.'],
])('conversation snippets hide owner wrappers without hiding words: %s', async (snippet, shown) => {
  const id = idOf('Quota reset recovery');
  const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ ok: true, value: { hits: [{ appSessionId: id, snippet }], indexing: false } } as never);
  try {
    render(<CommandPalette />);
    act(() => openConversationSearch('green pear'));
    expect(await screen.findByText(shown)).toBeTruthy();
  } finally { invoke.mockRestore(); }
});

// UX wave U6b-5a (docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-of-keyboard.md, M4; decisions 18 and 20; B6): with
// nothing typed the palette opens on Recent, the sessions and artifacts opened in this run (`keymap/visits.ts`), filled
// with the sessions most recently active; an artifact's row is drawn with the title its machine answers.
describe('Recent', () => {
  let bridge: unknown;
  beforeEach(() => void (bridge = window.maws));
  afterEach(() => void (window.maws = bridge as PreloadBridge));

  it('lists Recent first with nothing typed: newest first, mixed, filled by activity, eight at most; no Sessions group, no notice, no Library row', async () => {
    const notes = libraryRow(1, { title: 'Launch notes' });
    const fake = fakeClient({ 'library.get': (input: { artifactId: string }) => ({ row: input.artifactId === notes.id ? notes : null }) });
    window.maws = fake.client as unknown as PreloadBridge;
    const archived = idOf('Somersault terminal run'); // the second most recently active
    const records = new Map(useSessions.getState().records);
    records.set(archived, { ...records.get(archived)!, archived: true });
    useSessions.setState({ records });
    useVisits.setState({
      opened: [
        { kind: 'artifact', artifactId: notes.id, machine: TEST_MACHINE },
        { kind: 'session', appSessionId: idOf('Quota reset recovery') },
        { kind: 'artifact', artifactId: artifactId(2), machine: TEST_MACHINE }, // no longer exists: answered null
        { kind: 'session', appSessionId: archived },
      ],
    });
    await openAndType('');
    await vi.waitFor(() => expect(options('Recent')[0]).toContain('Launch notes')); // the control: the one that exists, by the same read
    expect(options('Recent')).toEqual([
      expect.stringContaining('Launch notes'),
      expect.stringContaining('Quota reset recovery'),
      expect.stringContaining('Usage reset countdown'), // then by last activity: the archived one and Quota left out
      expect.stringContaining('Terminal workflow notes'),
      expect.stringContaining('Trace stream reconnects'),
      expect.stringContaining('Settings idle probe'),
      expect.stringContaining('SDK wire inventory'),
      expect.stringContaining('Charter + research'),
    ]);
    expect(options('Recent')).toHaveLength(RECENT_MAX);
    expect(fake.invoked('library.get')).toEqual([{ artifactId: notes.id }, { artifactId: artifactId(2) }]);
    expect(fake.machines('library.get')).toEqual([TEST_MACHINE, TEST_MACHINE]);
    expect(group('Sessions')).toBeNull();
    expect(within(dialog()).queryByText(/Showing the first/)).toBeNull();
    expect(within(dialog()).queryByText(/Search the Library/)).toBeNull();
    const before = (a: string, b: string) => Boolean(group(a)!.compareDocumentPosition(group(b)!) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before('Recent', 'Projects')).toBe(true);
    expect(before('Projects', 'Actions')).toBe(true);
    // S5 (Decision Log 15 (viii)): until the person moves it, the selection follows the first row, so once the artifact's
    // answer is drawn above the session that was first, the artifact is selected and no session stays selected above it
    const selected = within(dialog()).getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')!;
    expect(selected.dataset.value).toBe(`artifact:${TEST_MACHINE}/${notes.id}`);
    // the widget's own selection follows too: the combobox names the artifact's option as its active descendant
    await vi.waitFor(() => expect(within(dialog()).getByRole('combobox').getAttribute('aria-activedescendant')).toBe(selected.id));
  });

  // M4's re-review: a press or a hover that does not change the row is no move, and Enter still runs the row selected
  it.each([
    ['Home', (row: HTMLElement) => fireEvent.keyDown(within(dialog()).getByRole('combobox'), { key: 'Home' }) && row],
    ['the pointer over the selected row', (row: HTMLElement) => fireEvent.pointerMove(row)],
  ])('keeps Enter on the first row after %s, which changes no row', async (_, act_) => {
    useVisits.setState({ opened: [{ kind: 'session', appSessionId: idOf('Quota reset recovery') }] });
    await openAndType('');
    const first = () => within(group('Recent')!).getAllByRole('option')[0]!;
    await vi.waitFor(() => expect(first().getAttribute('aria-selected')).toBe('true'));
    act(() => void act_(first()));
    expect(first().getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(within(dialog()).getByRole('combobox'), { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${idOf('Quota reset recovery')}`);
  });

  // Decision Log 16 (v): Recent's reads are staged, no more out at once than the slots left in the first eight
  it('has no more library.get reads out than slots are left, and a null answer frees its slot for the next read', async () => {
    const fake = fakeClient();
    window.maws = fake.client as unknown as PreloadBridge;
    useVisits.setState({ opened: [{ kind: 'session', appSessionId: idOf('Quota reset recovery') }, ...Array.from({ length: 9 }, (_, n) => ({ kind: 'artifact' as const, artifactId: artifactId(n + 1), machine: TEST_MACHINE }))] });
    await openAndType('');
    await vi.waitFor(() => expect(fake.pending('library.get')).toBe(7));
    expect(options('Recent')[0]).toContain('Quota reset recovery'); // a session's row is drawn at once
    expect(fake.invoked('library.get')).toEqual(Array.from({ length: 7 }, (_, n) => ({ artifactId: artifactId(n + 1) })));
    await act(() => fake.reply('library.get', { row: null })); // the first no longer exists
    await vi.waitFor(() => expect(fake.invoked('library.get')).toHaveLength(8));
    expect(fake.invoked('library.get')[7]).toEqual({ artifactId: artifactId(8) });
    expect(fake.pending('library.get')).toBe(7);
  });

  it('opens a recent session’s tab on ⏎, and a recent artifact by the artifact link’s rule', async () => {
    const notes = libraryRow(1, { title: 'Launch notes' });
    window.maws = fakeClient({ 'library.get': { row: notes } }).client as unknown as PreloadBridge;
    useVisits.setState({ opened: [{ kind: 'session', appSessionId: idOf('Quota reset recovery') }, { kind: 'artifact', artifactId: notes.id, machine: TEST_MACHINE }] });
    const user = await openAndType('');
    await vi.waitFor(() => expect(options('Recent')[1]).toContain('Launch notes'));
    await user.keyboard('{Enter}');
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${idOf('Quota reset recovery')}`);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => runAction('palette.open'));
    await vi.waitFor(() => expect(options('Recent')[1]).toContain('Launch notes'));
    await user.click(within(group('Recent')!).getAllByRole('option')[1]!);
    expect(screen.queryByRole('dialog')).toBeNull();
    const shown = `artifact:${TEST_MACHINE}:${notes.id}`;
    // a session on screen and no main tab of the artifact: beside the chat while a build registers the Artifacts tool,
    // else (as here) a main tab
    expect(activeTab(useLayout.getState().main)?.id).toBe(shown);
  });
});

// UX wave U6b-5a (M4; S5; decisions 19 to 22; Interfaces §E): with text typed, "Artifacts" lists the Library's matches of
// this Mac and of each machine the conversation search asks, 150 ms after the last keystroke, one group per machine by
// name when more than one has matches; an answer for an older query is dropped, a later one adds rows and moves no
// selection; the last row opens the Library on the text.
describe('Artifacts in the palette', () => {
  const THIRD = 'ThirdMachineRef0000000' as MachineRef;
  type Held = { input: unknown; machine: MachineRef | undefined; resolve(value: unknown): void };
  let held: Held[];
  let restore: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    held = [];
    const invoke = vi.spyOn(ipc, 'invoke').mockImplementation(((name: string, input: unknown, opts?: { machine?: MachineRef }) =>
      name === 'library.list'
        ? new Promise((resolve) => held.push({ input, machine: opts?.machine, resolve }))
        : Promise.resolve({ ok: false, error: { code: 'internal', message: 'not staged' } })) as never);
    restore = () => invoke.mockRestore();
    render(<CommandPalette />);
  });
  afterEach(() => {
    restore();
    vi.useRealTimers();
    useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  });
  const typed = async (query: string) => {
    act(() => usePalette.setState({ open: true, scope: 'all', query }));
    await act(() => vi.advanceTimersByTimeAsync(150));
  };
  const answer = async (n: number, rows: ReturnType<typeof libraryRow>[]) => {
    held[n]!.resolve({ ok: true, value: { rows, counts: countsOf(rows) } });
    await act(() => vi.advanceTimersByTimeAsync(0));
  };
  const refuse = async (n: number, code: string) => {
    held[n]!.resolve({ ok: false, error: { code, message: 'no answer' } });
    await act(() => vi.advanceTimersByTimeAsync(0));
  };
  const selected = () => within(dialog()).getAllByRole('option').find((o) => o.getAttribute('aria-selected') === 'true')?.dataset.value;
  const enter = () => fireEvent.keyDown(within(dialog()).getByRole('combobox'), { key: 'Enter' });
  const twoMachines = () => {
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-01T00:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: '2026-11-01T00:00:00Z', generation: 1 },
      { ref: THIRD, name: 'Lab', local: false, state: 'up', since: '2026-11-01T00:00:00Z', generation: 1 },
    ]);
    useSessions.setState({ listedMachines: new Set([OTHER_MACHINE, THIRD]) });
  };

  it('asks 150 ms after the last keystroke; an answer that comes later adds its rows and does not move the selection', async () => {
    act(() => usePalette.setState({ open: true, scope: 'all', query: 'quo' }));
    await act(() => vi.advanceTimersByTimeAsync(100));
    act(() => usePalette.setState({ query: 'quota' }));
    await act(() => vi.advanceTimersByTimeAsync(149));
    expect(held).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(held.map((h) => [h.input, h.machine])).toEqual([[{ filter: { query: 'quota' } }, undefined]]);
    const quota = `session:${idOf('Quota reset recovery')}`;
    expect(selected()).toBe(quota);
    await answer(0, [libraryRow(1, { title: 'Quota notes' })]);
    expect(options('Artifacts')).toEqual([expect.stringContaining('Quota notes')]);
    expect(selected()).toBe(quota);
    enter();
    expect(activeTab(useLayout.getState().main)?.id).toBe(quota);
  });

  // S5 (Decision Log 15 (viii)): the selection follows the first row until the person moves it
  it('selects the first row as answers arrive: a title typed with nothing else matching selects the artifact once it is drawn, and Enter opens it', async () => {
    await typed('launch');
    expect(selected()).toBe('library:search'); // the only row before the answer
    await answer(0, [libraryRow(1, { title: 'Launch notes' })]);
    expect(selected()).toBe(`artifact:${TEST_MACHINE}/${artifactId(1)}`);
    enter();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(activeTab(useLayout.getState().main)?.id).toBe(`artifact:${TEST_MACHINE}:${artifactId(1)}`);
    expect(useLayout.getState().destination).toBeNull(); // not the Library
  });

  it('keeps a selection the person moved by value when a later answer comes above it', async () => {
    await typed('quota');
    const quota = `session:${idOf('Quota reset recovery')}`;
    expect(selected()).toBe(quota);
    fireEvent.keyDown(within(dialog()).getByRole('combobox'), { key: 'ArrowDown' });
    const moved = selected();
    expect(moved).not.toBe(quota);
    await answer(0, [libraryRow(1, { title: 'Quota notes' })]);
    expect(options('Artifacts')).toEqual([expect.stringContaining('Quota notes')]);
    expect(selected()).toBe(moved);
    act(() => usePalette.setState({ query: 'quota ' })); // the control: new text gives the selection back to the first row
    expect(selected()).toBe(quota);
  });

  // Decision Log 16 (i): a moved selection is forgotten at every change of the text, so it does not come back with it
  it('forgets a moved selection when the text changes and comes back: a space typed and erased selects the first row', async () => {
    await typed('quota');
    const quota = `session:${idOf('Quota reset recovery')}`;
    fireEvent.keyDown(within(dialog()).getByRole('combobox'), { key: 'ArrowDown' });
    expect(selected()).toBe('library:search');
    act(() => usePalette.setState({ query: 'quota ' }));
    act(() => usePalette.setState({ query: 'quota' }));
    expect(selected()).toBe(quota);
    enter();
    expect(activeTab(useLayout.getState().main)?.id).toBe(quota);
    expect(useLayout.getState().destination).toBeNull();
  });

  it('runs on Enter the row selected when it is pressed; an answer released afterwards changes nothing', async () => {
    await typed('quota');
    enter();
    expect(screen.queryByRole('dialog')).toBeNull();
    const quota = `session:${idOf('Quota reset recovery')}`;
    expect(activeTab(useLayout.getState().main)?.id).toBe(quota);
    await answer(0, [libraryRow(1, { title: 'Quota notes' })]);
    expect(activeTab(useLayout.getState().main)?.id).toBe(quota);
    expect(allTabs(useLayout.getState().main).filter((t) => t.kind === 'artifact')).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('drops an answer for the older of two queries released last', async () => {
    await typed('artifact');
    await typed('artifact 2');
    expect(held).toHaveLength(2);
    await answer(1, [libraryRow(2)]);
    expect(options('Artifacts')).toEqual([expect.stringContaining('Artifact 2')]); // the control: the newer answer is drawn
    await answer(0, [libraryRow(1), libraryRow(2)]);
    expect(options('Artifacts')).toEqual([expect.stringContaining('Artifact 2')]);
  });

  it('leaves out a machine that does not answer and draws no line for it; one machine with matches is one group “Artifacts”', async () => {
    twoMachines();
    await typed('plan');
    expect(held.map((h) => h.machine)).toEqual([undefined, OTHER_MACHINE, THIRD]);
    await answer(0, [libraryRow(1, { title: 'Plan A' })]);
    await refuse(1, 'host_unavailable');
    await answer(2, []);
    expect(options('Artifacts')).toEqual([expect.stringContaining('Plan A')]);
    expect(group('Artifacts · Studio')).toBeNull();
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    expect(within(dialog()).queryByRole('status')).toBeNull();
  });

  it('draws one group per machine by name when two have matches', async () => {
    twoMachines();
    await typed('plan');
    await answer(0, [libraryRow(1, { title: 'Plan A' })]);
    await answer(1, [libraryRow(2, { title: 'Plan B' })]);
    await refuse(2, 'timeout');
    expect(group('Artifacts')).toBeNull();
    expect(options('Artifacts · This Mac')).toEqual([expect.stringContaining('Plan A')]);
    expect(options('Artifacts · Studio')).toEqual([expect.stringContaining('Plan B')]);
    expect(group('Artifacts · Lab')).toBeNull();
    expect(within(dialog()).queryByRole('alert')).toBeNull();
  });

  it('orders a machine’s matches by the scorer over their titles, one found by its text alone after those', async () => {
    await typed('quarter');
    await answer(0, [libraryRow(1, { title: 'Headquarters move' }), libraryRow(2, { title: 'Text only', snippet: 'the quarter ahead' }), libraryRow(3, { title: 'Quarter in review' })]);
    expect(options('Artifacts')).toEqual([expect.stringContaining('Quarter in review'), expect.stringContaining('Headquarters move'), expect.stringContaining('Text only')]);
  });

  it('opens an artifact found by its title on ⏎, by the artifact link’s rule', async () => {
    await typed('launch');
    await answer(0, [libraryRow(1, { title: 'Launch notes' })]);
    fireEvent.click(within(group('Artifacts')!).getByRole('option'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(activeTab(useLayout.getState().main)?.id).toBe(`artifact:${TEST_MACHINE}:${artifactId(1)}`); // no session on screen: a main tab
  });

  it('ends on the row “Search the Library for …”, which sets the Library’s query and opens its page', async () => {
    useLibraryView.setState({ view: 'pinned', query: 'old', kind: 'document', spaceId: null, machine: OTHER_MACHINE });
    await typed('  quarter ');
    const last = within(dialog()).getAllByRole('option').at(-1)!;
    expect(last.textContent).toBe('Search the Library for “quarter”');
    fireEvent.click(last);
    expect(useLibraryView.getState()).toEqual({ view: 'all', query: 'quarter', kind: null, spaceId: null, machine: null });
    expect(useLayout.getState().destination).toEqual({ kind: 'library' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
