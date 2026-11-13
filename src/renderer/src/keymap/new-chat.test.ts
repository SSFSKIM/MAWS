// New chat (UX wave U13a; its plan's Interfaces §E, the section's O-01 "New chat" and ticket 497): one entry for every control,
// which adds one tab after the tab in front, brings an empty chat back instead of making a second, closes the other empty
// chats without the ordinary close's wait, and lets a late chat arrive unselected.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { LAYOUT_DEFAULTS, tabId } from '@shared/ipc/schema/layout';
import { addressOf } from '@shared/machine/address';
import { machineKey, type OrgKey } from '@shared/machine/org-key';
import { project, record } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { connectPanelHost, instanceOf, panelHost, registerPanelTool } from '../panel/host';
import { resetRemoteSpawn, spawnTargetOf } from '../sessions/remote-spawn';
import { probeTool, resetPanelStores } from '../test-support/panel';
import { registerFocusTarget, resetComposerStore, useComposerStore } from '../stores/composer';
import { frontOf, useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { useMachines } from '../stores/machines';
import { useSessions } from '../stores/sessions';
import { closeEmptyChat, createSession, newChat, registerEmptyChats, registerSessionCreator, runAction } from './actions-runtime';

const P = at('proj-here' as ProjectId);
const Q = at('proj-second' as ProjectId);
const THERE = addressOf(OTHER_MACHINE, 'proj-there' as ProjectId);
const [IN_P, IN_P2, IN_P3, LOOSE] = ['in-p', 'in-p-2', 'in-p-3', 'loose'].map((id) => at(id as AppSessionId));
const ON_B = addressOf(OTHER_MACHINE, 'on-b' as AppSessionId);
const [E, F, NEW, NEW2] = ['empty-1', 'empty-2', 'new-1', 'new-2'].map((id) => at(id as AppSessionId));
const T0 = '2026-11-12T09:00:00.000Z';

const sessionTab = (id: AppSessionId) => tabId({ kind: 'session', appSessionId: id });
const open = (id: AppSessionId, opts?: { pane?: 0 | 1 }) => useLayout.getState().openTab({ kind: 'session', appSessionId: id }, opts);
const panes = () => useLayout.getState().main.panes.map((p) => p.tabs.map((t) => t.id));
const front = () => frontOf(useLayout.getState());
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// the chats `sessions/` would call empty (the port), each an unstarted session in the project it was made for
const empty = new Set<AppSessionId>();
let discard: (id: AppSessionId) => Promise<boolean>;
const unstarted = (id: AppSessionId, projectId: ProjectId | null, over: { registry?: string } = {}) => {
  useSessions.getState().addUnstarted(id, { projectId, createdAt: T0, ...over });
  empty.add(id);
};

// a creator that answers when the test says, recording the project it was asked for
function heldCreator() {
  const asked: (ProjectId | null)[] = [];
  const answers: ((id: AppSessionId | null) => void)[] = [];
  const off = registerSessionCreator((projectId) => {
    asked.push(projectId);
    return new Promise((resolve) => answers.push(resolve));
  });
  const answer = async (id: AppSessionId | null) => {
    answers.shift()!(id);
    await settle();
  };
  return { asked, answer, off };
}

const disposers: (() => void)[] = [];
beforeEach(() => {
  window.maws = fakeClient().client as unknown as PreloadBridge;
  useMachines.setState({ loaded: new Set([TEST_MACHINE, OTHER_MACHINE]) });
  useSessions.setState({
    projects: new Map([[P, project(P, 0)], [Q, project(Q, 1)], [THERE, project(THERE, 2)]]),
    records: new Map(([[IN_P, P], [IN_P2, P], [IN_P3, P], [LOOSE, null], [ON_B, THERE]] as const).map(([id, projectId]) => [id, record(id, { projectId })])),
  });
  discard = async () => true;
  disposers.push(registerEmptyChats({ isEmpty: (id) => empty.has(id), discard: (id) => discard(id) }));
});
afterEach(() => {
  disposers.splice(0).forEach((off) => off());
  resetPanelStores();
  empty.clear();
  resetRemoteSpawn();
  resetComposerStore();
  useLayout.setState({ main: LAYOUT_DEFAULTS.main });
  useSessions.setState({ projects: new Map(), records: new Map(), unstarted: new Map() });
  useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('a press of New chat (A2)', () => {
  it('adds one tab right after the tab in front, in the current project, and the three stay', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    [IN_P, IN_P2, IN_P3].forEach((id) => open(id));
    useLayout.getState().activateTab(sessionTab(IN_P2));
    const press = newChat();
    await creator.answer(NEW);
    await expect(press).resolves.toBe(NEW);
    expect(creator.asked).toEqual([P]);
    expect(panes()).toEqual([[IN_P, IN_P2, NEW, IN_P3].map(sessionTab)]);
    expect(front()).toBe(sessionTab(NEW));
    expect(useSessions.getState().unstarted.get(NEW)).toMatchObject({ projectId: P });
  });

  it('with a session in front whose project has no folder on this Mac, adds a chat with no project and keeps every tab', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    [IN_P, ON_B, IN_P3].forEach((id) => open(id));
    useLayout.getState().activateTab(sessionTab(ON_B));
    const press = newChat();
    await creator.answer(NEW);
    await press;
    expect(creator.asked).toEqual([null]);
    expect(panes()).toEqual([[IN_P, ON_B, NEW, IN_P3].map(sessionTab)]);
    expect(front()).toBe(sessionTab(NEW));
  });

  it('⌘N (the session.new action) is a New chat', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    open(IN_P);
    unstarted(E, P);
    open(E);
    open(IN_P2);
    runAction('session.new');
    await settle();
    expect(creator.asked).toEqual([]); // the empty chat of the project came forward instead
    expect(front()).toBe(sessionTab(E));
  });
});

describe('an empty chat (A3)', () => {
  it('is brought to the front for a press of its project, with its composer taking the keyboard, and nothing is made', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    open(IN_P);
    unstarted(E, P);
    open(E);
    open(IN_P2);
    await expect(newChat()).resolves.toBe(E);
    expect(creator.asked).toEqual([]);
    expect(front()).toBe(sessionTab(E));
    expect(useComposerStore.getState().focusOnMount.has(E)).toBe(true); // it mounts as it comes to the front
  });

  it('already in front, its mounted composer takes the keyboard at once', async () => {
    disposers.push(heldCreator().off);
    unstarted(E, P);
    open(E);
    const focusFrame = vi.fn();
    disposers.push(registerFocusTarget(E, { focusEditor: vi.fn(), focusFrame, insertText: vi.fn() }));
    await expect(newChat({ row: P })).resolves.toBe(E);
    expect(focusFrame).toHaveBeenCalledTimes(1);
    expect(useComposerStore.getState().focusOnMount.has(E)).toBe(false);
  });

  it('moves to the pane asked for when it sits in the other', async () => {
    disposers.push(heldCreator().off);
    open(IN_P);
    unstarted(E, P);
    open(E);
    open(IN_P2, { pane: 1 });
    await expect(newChat({ pane: 1, row: P })).resolves.toBe(E);
    expect(panes()).toEqual([[sessionTab(IN_P)], [sessionTab(IN_P2), sessionTab(E)]]);
    expect(useLayout.getState().main.focusedPane).toBe(1);
    expect(front()).toBe(sessionTab(E));
  });

  it('gives its place to a new chat for another project: the new tab opens after it and takes the front, then it closes', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    open(IN_P);
    unstarted(E, Q);
    open(E);
    const press = newChat({ row: P });
    await creator.answer(NEW);
    await press;
    expect(creator.asked).toEqual([P]);
    expect(panes()).toEqual([[sessionTab(IN_P), sessionTab(NEW)]]);
    expect(front()).toBe(sessionTab(NEW));
    expect(useSessions.getState().unstarted.has(E)).toBe(false); // its discard answered true
  });

  it('with a draft typed in it is not reused: a second chat opens and the first keeps its tab', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    unstarted(E, P);
    open(E);
    empty.delete(E); // typed into
    const press = newChat({ row: P });
    await creator.answer(NEW);
    await press;
    expect(panes()).toEqual([[sessionTab(E), sessionTab(NEW)]]);
    expect(useSessions.getState().unstarted.has(E)).toBe(true);
  });

  it('two presses before the first answer make one chat', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    open(IN_P);
    const first = newChat();
    const second = newChat({ pane: 1 });
    expect(second).toBe(first);
    await creator.answer(NEW);
    await expect(second).resolves.toBe(NEW);
    expect(creator.asked).toEqual([P]);
    expect(allTabs(useLayout.getState().main).map((t) => t.id)).toEqual([sessionTab(IN_P), sessionTab(NEW)]);
  });

  it('every other empty chat closes as the press brings one forward, leaving one empty chat', async () => {
    disposers.push(heldCreator().off);
    unstarted(E, P);
    unstarted(F, null);
    open(E);
    open(F);
    open(IN_P);
    await expect(newChat({ row: P })).resolves.toBe(E);
    expect(panes()).toEqual([[sessionTab(E), sessionTab(IN_P)]]);
    expect(useSessions.getState().unstarted.has(F)).toBe(false);
  });

  it('with no port registered, none counts as empty and each press makes a chat (launch mode scenario)', async () => {
    disposers.splice(0).forEach((off) => off()); // the port goes
    const creator = heldCreator();
    disposers.push(creator.off);
    unstarted(E, P);
    open(E);
    const press = newChat({ row: P });
    await creator.answer(NEW);
    await expect(press).resolves.toBe(NEW);
    expect(panes()).toEqual([[sessionTab(E), sessionTab(NEW)]]);
  });
});

describe('where a press starts the chat', () => {
  const ID = '5d8e1c72-4b3a-4f6e-8d9c-0a1b2c3d4e5f';
  const KEY = `id:${ID}` as OrgKey;
  const location = (machine: typeof OTHER_MACHINE, pid: string) => ({ machine, pid, path: `/srv/${pid}`, key: `folder:${machine}:${pid}` as OrgKey, name: pid, source: 'folder' as const, acts: true });
  const withRegistry = () => {
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: T0, generation: 0 },
      { ref: OTHER_MACHINE, name: 'studio', local: false, state: 'up', since: T0, generation: 1, carrier: 'direct' },
    ]);
    useSessions.getState().applyRegistry({ projects: [{ id: ID, name: 'scrape', hub: true, renamable: true, locations: [location(OTHER_MACHINE, 'p-studio')] }], keys: { [ID]: KEY }, moved: {}, removals: [], seen: {} }, TEST_MACHINE);
  };

  it('for a row with no folder here opens it as the row’s "+" does, on a machine that has the project, and brings it back on the next press', async () => {
    withRegistry();
    const creator = heldCreator();
    disposers.push(creator.off);
    const press = newChat({ row: KEY });
    await creator.answer(NEW);
    await expect(press).resolves.toBe(NEW);
    expect(creator.asked).toEqual([null]);
    expect(useSessions.getState().unstarted.get(NEW)).toMatchObject({ projectId: null, registry: ID });
    expect(spawnTargetOf(NEW, null)).toEqual({ machine: OTHER_MACHINE, name: 'studio', checkout: '/srv/p-studio', key: null, label: 'scrape', registry: ID });
    empty.add(NEW);
    await expect(newChat({ row: KEY })).resolves.toBe(NEW);
    expect(creator.asked).toEqual([null]);
  });

  it('for a row with neither opens it with no project, and an empty chat of a registry project is not that chat', async () => {
    withRegistry();
    const creator = heldCreator();
    disposers.push(creator.off);
    unstarted(E, null, { registry: ID });
    open(E);
    open(LOOSE); // a session in no project: the machine's own row
    const press = newChat();
    await creator.answer(NEW);
    await press;
    expect(creator.asked).toEqual([null]);
    expect(useSessions.getState().unstarted.get(NEW)?.registry).toBeUndefined();
    expect(spawnTargetOf(NEW, null)).toBeNull();
    expect(panes()).toEqual([[sessionTab(LOOSE), sessionTab(NEW)]]); // the registry project's empty chat gave its place
    empty.add(NEW); // nothing typed into it
    await expect(newChat({ row: machineKey(TEST_MACHINE) }), 'a machine’s row: the same place, no project').resolves.toBe(NEW);
    expect(creator.asked).toEqual([null]);
  });
});

describe('a late chat (ticket 497, A4)', () => {
  it('opens selected when nothing else came to the front meanwhile', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    open(IN_P);
    const press = createSession(P);
    await creator.answer(NEW);
    await press;
    expect(front()).toBe(sessionTab(NEW));
    expect(useComposerStore.getState().focusOnMount.has(NEW)).toBe(true);
  });

  it('is added unselected after the tab now in front, and takes the keyboard when the person selects it', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    open(IN_P);
    open(IN_P2);
    useLayout.getState().activateTab(sessionTab(IN_P));
    const press = newChat();
    open(IN_P3); // the person opened another tab during the wait
    await creator.answer(NEW);
    await press;
    expect(front()).toBe(sessionTab(IN_P3));
    expect(panes()).toEqual([[IN_P, IN_P3, NEW, IN_P2].map(sessionTab)]);
    const focusFrame = vi.fn();
    useLayout.getState().activateTab(sessionTab(NEW));
    disposers.push(registerFocusTarget(NEW, { focusEditor: vi.fn(), focusFrame, insertText: vi.fn() }));
    expect(focusFrame).toHaveBeenCalledTimes(1);
  });

  // UX wave U7b (M5, decision 11): the arrival rule compares what the person looks at (`placeOf`), a page and the
  // Settings dialog among it.
  it('a page opened during the wait stays, and the chat arrives unselected behind it', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    open(IN_P);
    const press = createSession(P);
    useLayout.getState().openDestination({ kind: 'projects' });
    await creator.answer(NEW);
    await press;
    expect(useLayout.getState().destination).toEqual({ kind: 'projects' });
    expect(front()).toBe(sessionTab(IN_P));
    expect(panes()).toEqual([[IN_P, NEW].map(sessionTab)]);
  });

  it('the Settings dialog opened during the wait stays, and the chat arrives unselected', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    open(IN_P);
    const press = createSession(P);
    useLayout.getState().openSettings();
    await creator.answer(NEW);
    await press;
    expect(useLayout.getState().settings).toEqual({ section: null });
    expect(front()).toBe(sessionTab(IN_P));
  });

  it('a chat asked for from a page that is still open when it arrives is selected and closes the page', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    open(IN_P);
    useLayout.getState().openDestination({ kind: 'library' });
    const press = createSession(P);
    await creator.answer(NEW);
    await press;
    expect(front()).toBe(sessionTab(NEW));
    expect(useLayout.getState().destination).toBeNull();
  });

  it('closes no empty chat that is in front when it arrives, and none the person typed into meanwhile', async () => {
    const creator = heldCreator();
    disposers.push(creator.off);
    unstarted(E, Q);
    unstarted(F, Q);
    open(E);
    open(F);
    open(IN_P);
    const press = newChat({ row: P });
    useLayout.getState().activateTab(sessionTab(E)); // selected during the wait
    empty.delete(F); // typed into during the wait
    await creator.answer(NEW);
    await press;
    expect(front()).toBe(sessionTab(E));
    expect(panes()).toEqual([[E, NEW, F, IN_P].map(sessionTab)]);
    expect(useSessions.getState().unstarted.has(E)).toBe(true);
    expect(useSessions.getState().unstarted.has(F)).toBe(true);
    // the next press finds two empty chats of other projects and leaves one
    const next = newChat({ row: Q });
    await expect(next).resolves.toBe(E);
    expect(allTabs(useLayout.getState().main).map((t) => t.id)).toEqual([E, NEW, F, IN_P].map(sessionTab)); // F is not empty, NEW is not marked empty
  });
});

describe('closing an empty chat for the person', () => {
  let release!: (answer: boolean | Error) => void;
  const hold = () => {
    discard = () => new Promise<boolean>((resolve, reject) => (release = (answer) => (answer instanceof Error ? reject(answer) : resolve(answer))));
  };
  const setUp = () => {
    unstarted(E, Q);
    open(E);
    open(IN_P);
  };

  it('takes the tab out of the strip before main answers: it cannot be selected and leaves no reopen entry; a discard that answers true drops its entry', async () => {
    hold();
    setUp();
    closeEmptyChat(E);
    expect(panes()).toEqual([[sessionTab(IN_P)]]);
    useLayout.getState().activateTab(sessionTab(E));
    expect(front()).toBe(sessionTab(IN_P));
    expect(useLayout.getState().main.closedTabs).toEqual([]);
    release(true);
    await settle();
    expect(useSessions.getState().unstarted.has(E)).toBe(false);
    expect(panes()).toEqual([[sessionTab(IN_P)]]);
  });

  it('puts the tab back unselected, its entry kept, when main refuses', async () => {
    hold();
    setUp();
    closeEmptyChat(E);
    release(false);
    await settle();
    expect(panes()).toEqual([[sessionTab(IN_P), sessionTab(E)]]);
    expect(front()).toBe(sessionTab(IN_P));
    expect(useSessions.getState().unstarted.get(E)).toMatchObject({ projectId: Q });
  });

  it('puts the tab back unselected when the discard throws, and says so in the log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    hold();
    setUp();
    closeEmptyChat(E);
    release(new Error('main went away'));
    await settle();
    expect(panes()).toEqual([[sessionTab(IN_P), sessionTab(E)]]);
    expect(front()).toBe(sessionTab(IN_P));
    expect(error).toHaveBeenCalledWith('[actions] discarding an empty chat failed; its tab is back', expect.any(Error));
    error.mockRestore();
  });

  it.each([['refuses', false], ['throws', new Error('main went away')]] as const)('puts a pinned chat back pinned when main %s', async (_how, answer) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    hold();
    setUp();
    useLayout.getState().togglePinned(sessionTab(E));
    closeEmptyChat(E);
    expect(panes()).toEqual([[sessionTab(IN_P)]]);
    release(answer);
    await settle();
    expect(useLayout.getState().main.panes[0].tabs).toEqual([expect.objectContaining({ id: sessionTab(E), pinned: true }), expect.objectContaining({ id: sessionTab(IN_P), pinned: false })]);
    expect(front()).toBe(sessionTab(IN_P));
    error.mockRestore();
  });

  // the branch review (finding 3): only the tab leaves at once; the side tools go once main has said yes
  it.each([['refuses', false], ['throws', new Error('main went away')], ['agrees', true]] as const)('keeps the chat’s side tools and their state until main agrees (main %s)', async (_how, answer) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    resetPanelStores();
    useLayout.setState({ main: LAYOUT_DEFAULTS.main });
    disposers.push(connectPanelHost());
    const { tool, probe } = probeTool('t');
    disposers.push(registerPanelTool(tool));
    hold();
    setUp();
    const tab = panelHost.addTool('t', { appSessionId: E, activate: false });
    const state = instanceOf(tab)!.state;
    closeEmptyChat(E);
    expect(panes()).toEqual([[sessionTab(IN_P)]]);
    expect(probe.disposed, 'while main works').toEqual([]);
    release(answer);
    await settle();
    if (answer === true) {
      expect(probe.disposed).toEqual([tab]);
      expect(useLayout.getState().panelBySession.has(E)).toBe(false);
    } else {
      expect(probe.disposed).toEqual([]);
      expect(instanceOf(tab)?.state).toBe(state);
      expect(useLayout.getState().panelBySession.get(E)?.tabs.map((t) => t.id)).toEqual([tab]);
      expect(panes()).toEqual([[sessionTab(IN_P), sessionTab(E)]]);
    }
    error.mockRestore();
  });

  it('does nothing for a chat in front, a chat no longer empty, or a chat with no tab', () => {
    const asked = vi.fn(async () => true);
    discard = asked;
    unstarted(E, Q);
    unstarted(F, Q);
    open(F);
    open(E);
    closeEmptyChat(E); // in front
    empty.delete(F);
    closeEmptyChat(F); // typed into
    closeEmptyChat(NEW2); // no tab
    expect(panes()).toEqual([[sessionTab(F), sessionTab(E)]]);
    expect(asked).not.toHaveBeenCalled();
  });
});
