// E1 (M3): the window side of the pane bridge (residue 3). On `maws.pane.show` a window that knows the session opens
// what `PANES` names (a main tab for `file`, else the panel tool) and answers `maws.pane.answer` with what it opened; a
// pane whose tool this build lacks is answered with the host's own "not available" text; a session this window does not
// know is left to the window that does. UX wave U6d: a request for the retired `artifact` pane is refused with the
// host's sentence, and nothing is opened or read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import { tabId } from '@shared/ipc/schema/layout';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { TEST_MACHINE } from '../../../../../../test/support/machine';
import { connectPanelHost, registerPanelTool } from '../../../panel/host';
import { surfaceTabs } from '../../../panel/surface-model';
import { useLayout } from '../../../stores/layout';
import { activeTab, allTabs } from '../../../stores/layout-model';
import { useSessions } from '../../../stores/sessions';
import { A, B, C, heldBridge, hydrateHeld, panelOf, persisted, probeTool, resetPanelStores } from '../../../test-support/panel';
import { filesTool } from '../../code/files/FilesTool';
import { PANE_LAYOUT_WAIT_MS, resetKeptOpens } from '../../code/open-file';
import { connectPaneShows } from './connect';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const show = (fake: FakeClient, over: Record<string, unknown>) => fake.event('maws.pane.show', { appSessionId: A, requestId: 'r1' as RequestId, pane: 'terminal', target: null, line: null, ...over });

let fake: FakeClient;
let disconnect: () => void;
beforeEach(() => {
  resetPanelStores();
  resetKeptOpens();
  registerPanelTool(filesTool); // UX wave U6b-1: the file pane opens beside the chat, as a tab of Files
  fake = fakeClient({ 'maws.pane.answer': { outcome: 'delivered' } });
  disconnect = connectPaneShows(fake.client);
});
afterEach(() => {
  disconnect();
  resetKeptOpens();
});

const filesOf = (id: AppSessionId) => (panelOf(id)?.tabs ?? []).filter((tab) => tab.toolId === 'files');
const mainFiles = () => allTabs(useLayout.getState().main).filter((tab) => tab.kind === 'file');

describe('the pane bridge, window side (E1)', () => {
  // UX wave U6b-1 (R2): the panel-tool form, with Files and the file's name, so the row still reads "Opened a.ts"
  it('file: beside the chat as a tab of Files at the line, answered panel-tool with its tab and the file’s name; the main strip gains nothing', async () => {
    show(fake, { pane: 'file', target: '/repo/src/../src/a.ts', line: 3 });
    await settle();
    const [tab] = filesOf(A);
    // UX wave U6e (decision 19): the tab the agent's show opens holds the agent's mark
    expect(useLayout.getState().panelParams[tab.id]).toEqual({ file: '/repo/src/a.ts', line: 3, preview: true, agent: true });
    expect(surfaceTabs(useLayout.getState(), A).map((ref) => ref.id)).toEqual([tab.id]);
    expect(mainFiles()).toEqual([]);
    expect(fake.invoked('maws.pane.answer')).toEqual([
      { appSessionId: A, requestId: 'r1', result: { ok: true, opened: { kind: 'panel-tool', toolId: 'files', tabId: tab.id, title: 'a.ts' } } },
    ]);
  });

  it('file: a main tab that already shows it is selected at the line, answered main-tab with its tab id', async () => {
    useLayout.getState().openTab({ kind: 'file', path: '/repo/src/a.ts', line: null, appSessionId: A, machine: TEST_MACHINE });
    useLayout.getState().openSession(A);
    show(fake, { pane: 'file', target: '/repo/src/a.ts', line: 3 });
    await settle();
    const tab = activeTab(useLayout.getState().main);
    expect(tab).toMatchObject({ kind: 'file', path: '/repo/src/a.ts', line: 3, appSessionId: A, machine: TEST_MACHINE });
    expect(filesOf(A)).toEqual([]);
    expect(fake.invoked('maws.pane.answer')).toEqual([
      { appSessionId: A, requestId: 'r1', result: { ok: true, opened: { kind: 'main-tab', tabId: tabId({ kind: 'file', path: '/repo/src/a.ts', line: 3, appSessionId: A, machine: TEST_MACHINE }), path: '/repo/src/a.ts', line: 3 } } },
    ]);
  });

  it('terminal: a Terminal tab in the session’s panel, answered panel-tool with its tab and title; a second show selects the same tab', async () => {
    const { tool, probe } = probeTool('terminal', { title: 'Terminal' });
    registerPanelTool(tool);
    show(fake, {});
    await settle();
    const [opened] = panelOf(A)!.tabs;
    expect(opened!.toolId).toBe('terminal');
    expect(panelOf(A)!.activeTabId).toBe(opened!.id);
    expect(probe.created.map((init) => init.params)).toEqual([{}]);
    expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: true, opened: { kind: 'panel-tool', toolId: 'terminal', tabId: opened!.id, title: 'Terminal' } } }]);
    show(fake, { requestId: 'r2' });
    await settle();
    expect(panelOf(A)!.tabs).toHaveLength(1);
    expect(fake.invoked('maws.pane.answer')[1]).toEqual({ appSessionId: A, requestId: 'r2', result: { ok: true, opened: { kind: 'panel-tool', toolId: 'terminal', tabId: opened!.id, title: 'Terminal' } } });
  });

  it('diff: Review on the uncommitted changes, at the file when the model named one', async () => {
    const { tool, probe } = probeTool('review', { title: 'Review', multiInstance: false });
    registerPanelTool(tool);
    show(fake, { pane: 'diff', target: '/repo/src/a.ts' });
    await settle();
    expect(probe.created.map((init) => init.params)).toEqual([{ scope: 'uncommitted', path: '/repo/src/a.ts' }]);
  });

  // UX wave U6d (O-44; Interfaces §D): the agent opens no artifact by itself. A request for the `artifact` pane, as an
  // engine host of an earlier build still sends it (with a target and an `at`), is answered with the host's own sentence
  // and nothing is opened or read: no tab is added and no command but the answer is invoked
  describe('the retired artifact pane (UX wave U6d)', () => {
    const DASH = '00000000-0000-4000-8000-000000000001';
    const reads = () => [fake.invoked('artifacts.get'), fake.invoked('artifacts.list'), fake.invoked('session.get')];
    const refused = (requestId: string) => ({ appSessionId: A, requestId, result: { ok: false, error: TOOL_ERRORS.artifactPaneRetired } });

    it('refuses a request in an earlier build’s form, with a target and an at, with the sentence; nothing opened or read', async () => {
      const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
      registerPanelTool(tool);
      const before = useLayout.getState().main;
      show(fake, { pane: 'artifact', target: DASH, at: { tab: 't2', block: 'b7' } });
      await settle();
      expect(fake.invoked('maws.pane.answer')).toEqual([refused('r1')]);
      expect(fake.invoked('maws.pane.answer')[0]).toMatchObject({ result: { error: 'show_pane: MAWS no longer opens an artifact for the user. Name it in your message as a Markdown link, [its title](maws-artifact:<artifactId>), and the user opens it with a click.' } });
      expect(probe.created).toEqual([]);
      expect(panelOf(A)?.tabs ?? []).toEqual([]);
      expect(useLayout.getState().main).toBe(before);
      expect(reads()).toEqual([[], [], []]);
    });

    it('refuses the same request without a target, which opened the list before', async () => {
      const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
      registerPanelTool(tool);
      show(fake, { pane: 'artifact', target: null });
      await settle();
      expect(fake.invoked('maws.pane.answer')).toEqual([refused('r1')]);
      expect(probe.created).toEqual([]);
      expect(panelOf(A)?.tabs ?? []).toEqual([]);
      expect(reads()).toEqual([[], [], []]);
    });

    it('refuses it whether or not the Artifacts tool is registered', async () => {
      show(fake, { pane: 'artifact', target: 'launch-plan' });
      await settle();
      expect(fake.invoked('maws.pane.answer')).toEqual([refused('r1')]);
      expect(panelOf(A)?.tabs ?? []).toEqual([]);
      expect(reads()).toEqual([[], [], []]);
    });
  });

  // (E4a: these two name the `tasks` pane, E7's, since the `browser` pane now validates its target and passes more.)
  it('a sibling’s tool, once registered, receives the target', async () => {
    const { tool, probe } = probeTool('tasks', { title: 'Tasks' });
    registerPanelTool(tool);
    show(fake, { pane: 'tasks', target: 'release' });
    await settle();
    expect(probe.created.map((init) => init.params)).toEqual([{ target: 'release' }]);
  });

  it('a multi-instance sibling tool shown twice with distinct targets receives both (only the Terminal reuses its tab)', async () => {
    const { tool, probe } = probeTool('tasks', { title: 'Tasks', multiInstance: true });
    registerPanelTool(tool);
    show(fake, { pane: 'tasks', target: 'release' });
    show(fake, { pane: 'tasks', target: 'review', requestId: 'r2' });
    await settle();
    expect(probe.created.map((init) => init.params)).toEqual([{ target: 'release' }, { target: 'review' }]);
    const tabs = panelOf(A)!.tabs.map((tab) => tab.id);
    expect(fake.invoked('maws.pane.answer').map((answer) => (answer as { result: { opened: { tabId: string } } }).result.opened.tabId)).toEqual(tabs);
  });

  // E4a start (Design §14, Decision Log 7): the `browser` pane validates its target as main will, so a refused address
  // is the model's error to read before anything opens. U12a (M1; Interfaces §B): a valid one is opened by the window
  // itself, through main's `browser.tabs.open` with `reload` and the request's own id (two windows handling one request
  // reach one tab and one outcome in main), and only once main has answered does the Browser tool open for the session,
  // on the tab main selected; the answer carries main's `page`. A refused open is a refusal and opens nothing (R9).
  describe('browser (E4a; U12a)', () => {
    const browserTool = () => {
      const { tool, probe } = probeTool('browser', { title: 'Browser', multiInstance: false });
      registerPanelTool(tool);
      return probe;
    };
    const opened = (tabId: string) => ({ kind: 'panel-tool', toolId: 'browser', tabId, title: 'Browser' });

    it('a valid target is opened by main first, parsed, with reload and the request id; the tool opens on its answer, which carries page', async () => {
      const probe = browserTool();
      show(fake, { pane: 'browser', target: 'https://Example.com' });
      await settle();
      expect(fake.invoked('browser.tabs.open')).toEqual([{ appSessionId: A, url: 'https://example.com/', select: true, reuse: 'url', reload: true, requestId: 'r1' }]);
      expect(probe.created).toEqual([]); // held: nothing opened, nothing answered
      expect(panelOf(A)?.tabs ?? []).toEqual([]);
      expect(fake.invoked('maws.pane.answer')).toEqual([]);
      await fake.reply('browser.tabs.open', { tab: {}, reused: true, page: 'reloaded' });
      expect(probe.created.map((init) => init.params)).toEqual([{ appSessionId: A }]);
      const [tab] = panelOf(A)!.tabs;
      expect(panelOf(A)!.activeTabId).toBe(tab!.id);
      expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: true, opened: opened(tab!.id), page: 'reloaded' } }]);
    });

    it('two windows given one request both ask main with its id and answer alike', async () => {
      browserTool();
      const second = connectPaneShows(fake.client);
      try {
        show(fake, { pane: 'browser', target: 'https://a.test/' });
        await settle();
        expect(fake.invoked('browser.tabs.open')).toHaveLength(2);
        expect(new Set(fake.invoked('browser.tabs.open').map((input) => JSON.stringify(input))).size).toBe(1);
        await fake.reply('browser.tabs.open', { tab: {}, reused: false, page: 'opened' });
        await fake.reply('browser.tabs.open', { tab: {}, reused: true, page: 'opened' });
        const [first, other] = fake.invoked('maws.pane.answer');
        expect(first).toEqual(other);
        expect(first).toMatchObject({ result: { ok: true, page: 'opened' } });
      } finally {
        second();
      }
    });

    it('a refused target answers navigationRefused and asks main nothing', async () => {
      const probe = browserTool();
      show(fake, { pane: 'browser', target: 'file:///etc/hosts' });
      show(fake, { pane: 'browser', target: 'wikipedia.org', requestId: 'r2' });
      await settle();
      expect(probe.created).toEqual([]);
      expect(fake.invoked('browser.tabs.open')).toEqual([]);
      expect(fake.invoked('maws.pane.answer')).toEqual([
        { appSessionId: A, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.navigationRefused('file:///etc/hosts') } },
        { appSessionId: A, requestId: 'r2', result: { ok: false, error: TOOL_ERRORS.navigationRefused('wikipedia.org') } },
      ]);
    });

    it('no target asks main nothing and opens the tool on the session’s own state; the answer has no page', async () => {
      const probe = browserTool();
      show(fake, { pane: 'browser', target: null });
      await settle();
      expect(fake.invoked('browser.tabs.open')).toEqual([]);
      expect(probe.created.map((init) => init.params)).toEqual([{ appSessionId: A }]);
      const [tab] = panelOf(A)!.tabs;
      expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: true, opened: opened(tab!.id) } }]);
    });

    it('an open main refuses opens no tool and answers browserOpenFailed with the target as given and main’s message', async () => {
      const probe = browserTool();
      show(fake, { pane: 'browser', target: 'https://Example.com' });
      await settle();
      await fake.fail('browser.tabs.open', 'unknown session', 'invalid_input');
      expect(probe.created).toEqual([]);
      expect(panelOf(A)?.tabs ?? []).toEqual([]);
      expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.browserOpenFailed('https://Example.com', 'unknown session') } }]);
    });
  });
  // E4a end

  it('a session this window does not know: nothing opened, no answer', async () => {
    const { tool } = probeTool('terminal', { title: 'Terminal' });
    registerPanelTool(tool);
    show(fake, { appSessionId: 'app-elsewhere' as AppSessionId });
    await settle();
    expect(panelOf('app-elsewhere' as AppSessionId)).toBeUndefined();
    expect(panelOf(B)).toBeUndefined();
    expect(fake.invoked('maws.pane.answer')).toEqual([]);
  });
});

// UX wave U7b (M6, decision 5; Interfaces §F, "Not the person's act"): what an agent shows closes neither a page nor the
// Settings dialog, and what it brings forward is in front of the strip behind them; across an await (U6d: the browser's
// open, since the artifact's lookup left with the retired pane) the origin travels with the call, so the person's act in
// between closes the page as usual and the late add leaves it so.
describe('show_pane behind a page (UX wave U7b)', () => {
  const PAGE = { kind: 'projects' } as const;

  it('file: beside the chat of its session, which is in front of the strip, and the page and the dialog stay', async () => {
    useLayout.getState().openDestination(PAGE);
    useLayout.getState().openSettings();
    show(fake, { appSessionId: B, pane: 'file', target: '/repo/src/b.ts', line: 1 });
    await settle();
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${B}`);
    expect(useLayout.getState().panelParams[filesOf(B)[0].id]).toMatchObject({ file: '/repo/src/b.ts', line: 1 });
    expect(useLayout.getState().destination).toEqual(PAGE);
    expect(useLayout.getState().settings).toEqual({ section: null });
  });

  it('a panel pane for a session not in front brings it to the front of the strip behind the page, which stays', async () => {
    registerPanelTool(probeTool('terminal', { title: 'Terminal' }).tool);
    useLayout.getState().openDestination(PAGE);
    show(fake, { appSessionId: B });
    await settle();
    expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${B}`);
    expect(useLayout.getState().destination).toEqual(PAGE);
  });

  describe('across the browser’s open', () => {
    beforeEach(() => registerPanelTool(probeTool('browser', { title: 'Browser', multiInstance: false }).tool)); // `browser.tabs.open` waits for the test's reply

    it('the add that arrives after the open leaves the page open', async () => {
      useLayout.getState().openDestination(PAGE);
      show(fake, { appSessionId: B, pane: 'browser', target: 'https://a.test/' });
      await settle();
      expect(fake.pending('browser.tabs.open')).toBe(1);
      await fake.reply('browser.tabs.open', { tab: {}, reused: false, page: 'opened' });
      expect(panelOf(B)!.tabs.map((tab) => tab.toolId)).toEqual(['browser']);
      expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${B}`);
      expect(useLayout.getState().destination).toEqual(PAGE);
    });

    it('a session’s row clicked while the open is out closes the page, and the add that then arrives leaves it closed', async () => {
      useLayout.getState().openDestination(PAGE);
      show(fake, { appSessionId: B, pane: 'browser', target: 'https://a.test/' });
      await settle();
      useLayout.getState().openSession(C); // the person's act
      expect(useLayout.getState().destination).toBeNull();
      await fake.reply('browser.tabs.open', { tab: {}, reused: false, page: 'opened' });
      expect(panelOf(B)!.tabs.map((tab) => tab.toolId)).toEqual(['browser']);
      expect(useLayout.getState().destination).toBeNull();
    });
  });
});

// UX wave U6b-1 (Decision 10, sequence 4): a show of a file before the window has read its layout waits for the read and
// answers with the tab that then holds the file, once; a session the read keeps no list for, and a wait that runs out,
// are answered without a tab, and none opens then or later.
describe('show_pane for a file before the layout is read (UX wave U6b-1)', () => {
  const answers = () => fake.invoked('maws.pane.answer') as { result: unknown }[];

  it('is answered once, after the read, with the id of the tab the layout holds; the stored tab of the file is the one', async () => {
    resetPanelStores({ hydrated: false });
    registerPanelTool(filesTool);
    const stored = { id: 'files:stored', toolId: 'files', pinned: false };
    const bridge = heldBridge(persisted({ [`panel.${A}`]: { tabs: [stored], activeTabId: null }, 'panelTools.params': { version: 1, params: { [stored.id]: { file: '/repo/src/a.ts', line: null } } } }));
    const off = connectPanelHost();
    await hydrateHeld(bridge, () => show(fake, { pane: 'file', target: '/repo/src/a.ts', line: 5 }));
    await settle();
    await settle();
    off();
    expect(answers()).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: true, opened: { kind: 'panel-tool', toolId: 'files', tabId: stored.id, title: 'a.ts' } } }]);
    expect(filesOf(A)).toEqual([stored]);
    expect(useLayout.getState().panelParams[stored.id]).toEqual({ file: '/repo/src/a.ts', line: 5 });
  });

  it('a session the read keeps no list for: paneUnavailable, and no tab opens', async () => {
    resetPanelStores({ hydrated: false });
    registerPanelTool(filesTool);
    const bridge = heldBridge(persisted({}));
    await hydrateHeld(bridge, () => {
      show(fake, { pane: 'file', target: '/repo/src/a.ts', line: null });
      useSessions.setState((s) => {
        const records = new Map(s.records);
        records.delete(A);
        return { records };
      });
    });
    await settle();
    await settle();
    expect(answers()).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.paneUnavailable('file') } }]);
    expect(panelOf(A)).toBeUndefined();
  });

  it('a read that does not come within the wait: paneNotReady, word for word, and the read that comes later opens nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      resetPanelStores({ hydrated: false });
      registerPanelTool(filesTool);
      show(fake, { pane: 'file', target: '/repo/src/a.ts', line: null });
      await vi.advanceTimersByTimeAsync(PANE_LAYOUT_WAIT_MS - 1);
      expect(answers()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(answers()).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: false, error: 'show_pane: the MAWS window was still loading its layout; try again' } }]);
      useLayout.setState({ hydrated: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(panelOf(A)).toBeUndefined();
      expect(answers()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
