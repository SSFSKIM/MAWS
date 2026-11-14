import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_IDS, ACTIONS, type ActionTable } from '@shared/keymap/actions';
import { EXTENDED_TABLE, sample } from '@shared/keymap/sample-rows'; // U6a
import { formatChord } from '@shared/keymap/chord';
import { registerShellActions } from '../app/shell-actions';
import { registerAction, runAction } from '../keymap/actions-runtime';
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
import { openConversationSearch, CommandPalette, paletteEntries, usePalette } from './CommandPalette';

const file = scenarioFile('nine-sessions');
const nine = pageScenario(file); // P5 O6 M2: the scenario as the page holds it
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const offs: (() => void)[] = [];

beforeEach(() => {
  resetShellStores();
  fillStores(file);
  usePalette.setState({ open: false });
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

  it('lists every action of the table with its chord, disabled ones greyed with what they wait for', async () => {
    await openAndType('');
    const actions = within(group('Actions')!).getAllByRole('option');
    const listed = ACTION_IDS.filter((id) => !(ACTIONS as ActionTable)[id].fixed); // U6a: an editor's own key is not an act to run
    expect(actions).toHaveLength(listed.length);
    for (const id of listed) {
      const option = actions.find((o) => o.dataset.value === `action:${id}`)!;
      expect(option, id).toBeTruthy();
      expect(option.textContent).toContain(ACTIONS[id].title);
      if (ACTIONS[id].chord) expect(option.textContent, id).toContain(formatChord(ACTIONS[id].chord!));
    }
    const newSession = actions.find((o) => o.dataset.value === 'action:session.new')!;
    expect(newSession.getAttribute('aria-disabled')).toBe('true');
    expect(newSession.textContent).toContain('Not available here');
    // UX wave U4a: ⌘Enter's two composer rows and Ctrl+R's search wait for the composer's focus; its fixed keys are not listed
    for (const id of ['composer.queue', 'composer.send', 'composer.historySearch']) expect(actions.find((o) => o.dataset.value === `action:${id}`)!.textContent, id).toContain('Keyboard only, in the composer');
    for (const id of ['composer.submit', 'composer.newLine', 'composer.newLineOption']) expect(actions.find((o) => o.dataset.value === `action:${id}`), id).toBeUndefined();
    // UX wave U1a (§D): a permission prompt's two allow keys wait for a focused request, as Enter and Esc do
    for (const id of ['request.allowOnce', 'request.allowLasting']) expect(actions.find((o) => o.dataset.value === `action:${id}`)!.textContent, id).toContain('Keyboard only, in a focused request');
    expect(actions.find((o) => o.dataset.value === 'action:tab.close')!.getAttribute('aria-disabled')).toBe('false');
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
    expect(paletteEntries('', { records, projects }).actions).toEqual(ACTION_IDS.filter((id) => !(ACTIONS as ActionTable)[id].fixed));
  });

  // U6a (decision 7): a fixed row (a key its editor handles) is not an act the palette can run, so it is not listed
  it('lists no fixed row, and every other row of a table extended with a sibling’s rows', () => {
    const empty = { records: new Map(), projects: new Map() };
    const actions = paletteEntries('', empty, EXTENDED_TABLE).actions;
    expect(actions).not.toContain(sample('sample.fixed'));
    expect(actions).toEqual(expect.arrayContaining([sample('sample.menu'), sample('sample.shared')]));
    expect(paletteEntries('sample', empty, EXTENDED_TABLE).actions).toEqual([sample('sample.menu'), sample('sample.shared')]);
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

  it('greys Project channel with its sentence while the tab in front has no project with a channel', async () => {
    await openAndType('project channel');
    const option = within(group('Actions')!).getAllByRole('option').find((o) => o.dataset.value === 'action:channel.open')!;
    expect(option.getAttribute('aria-disabled')).toBe('true');
    expect(option.textContent).toContain('This project has no channel');
  });
});

it('bounds mounted results for 3,279 sessions while searching the entire index', async () => {
  const template = nine.sessions[0];
  const records = Array.from({ length: 3279 }, (_, n) => ({ ...template, appId: at(`large-${n}` as AppSessionId), title: { ...template.title, text: `Indexed session ${n}` } }));
  useSessions.setState({ records: new Map(records.map((r) => [r.appId, r])) });
  const user = await openAndType('');
  expect(within(group('Sessions')!).getAllByRole('option').length).toBeLessThanOrEqual(50);
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
