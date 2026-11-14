// E1 (M3): the window side of the pane bridge (residue 3). On `maws.pane.show` a window that knows the session opens
// what `PANES` names (a main tab for `file`, else the panel tool) and answers `maws.pane.answer` with what it opened; a
// pane whose tool this build lacks is answered with the host's own "not available" text; a session this window does not
// know is left to the window that does.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import type { Lineage } from '@shared/graph/session';
import { tabId } from '@shared/ipc/schema/layout';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { TEST_MACHINE } from '../../../../../../test/support/machine';
import { registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { activeTab } from '../../../stores/layout-model';
import { useSessions } from '../../../stores/sessions';
import { A, B, C, panelOf, probeTool, resetPanelStores } from '../../../test-support/panel';
import { connectPaneShows } from './connect';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const show = (fake: FakeClient, over: Record<string, unknown>) => fake.event('maws.pane.show', { appSessionId: A, requestId: 'r1' as RequestId, pane: 'terminal', target: null, line: null, ...over });

let fake: FakeClient;
let disconnect: () => void;
beforeEach(() => {
  resetPanelStores();
  fake = fakeClient({ 'maws.pane.answer': { outcome: 'delivered' } });
  disconnect = connectPaneShows(fake.client);
});
afterEach(() => disconnect());

describe('the pane bridge, window side (E1)', () => {
  it('file: a main tab at the line, answered main-tab with its tab id', async () => {
    show(fake, { pane: 'file', target: '/repo/src/a.ts', line: 3 });
    await settle();
    const tab = activeTab(useLayout.getState().main);
    expect(tab).toMatchObject({ kind: 'file', path: '/repo/src/a.ts', line: 3, appSessionId: A, machine: TEST_MACHINE });
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

  it('artifact with no Artifacts tool registered: the host’s "not available in this build" text, nothing opened', async () => {
    show(fake, { pane: 'artifact', target: 'none' });
    await settle();
    expect(panelOf(A)?.tabs ?? []).toEqual([]);
    expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.paneUnavailable('artifact') } }]);
  });

  // E2 (Design §4 "show_pane 'deliverable'"; P3-L M6b: the `artifact` pane and the Artifacts tool): the target is
  // resolved through the engine host's store before anything opens, so the model reads that its id was wrong rather
  // than "shown" over a list.
  describe('artifact (E2; P3-L M6b)', () => {
    const DASH = '00000000-0000-4000-8000-000000000001';
    const made = (id: string, by: AppSessionId, handle = 'dash') => ({
      id, kind: 'html', title: 'Dashboard', handle, createdBy: { kind: 'session', appSessionId: by }, createdAt: 1, updatedAt: 2, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 3,
    });
    const artifact = made(DASH, A);
    beforeEach(() => {
      disconnect();
      fake = fakeClient({
        'maws.pane.answer': { outcome: 'delivered' },
        'artifacts.get': (input: { artifactId: string }) => ({ artifact: input.artifactId === DASH ? artifact : null }),
        'artifacts.list': { artifacts: [artifact] },
      });
      disconnect = connectPaneShows(fake.client);
    });

    it('an artifact’s id opens the Artifacts tool on it and answers panel-tool', async () => {
      const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
      registerPanelTool(tool);
      show(fake, { pane: 'artifact', target: DASH });
      await settle();
      expect(fake.invoked('artifacts.get')).toEqual([{ artifactId: DASH }]);
      expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH }]);
      const [opened] = panelOf(A)!.tabs;
      expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: true, opened: { kind: 'panel-tool', toolId: 'artifacts', tabId: opened!.id, title: 'Artifacts' } } }]);
    });

    // P4-B4: `at` opens it at a place: the Artifacts tool is given it as the open's location (the latest version unless
    // the place names one); with no target there is no artifact to open at a place, and the list opens
    it('an artifact opened at a place gives the Artifacts tool the place; no target opens the list without it', async () => {
      const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
      registerPanelTool(tool);
      show(fake, { pane: 'artifact', target: DASH, at: { tab: 't2', block: 'b7' } });
      await settle();
      expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH, location: { tab: 't2', block: 'b7' } }]);
      show(fake, { requestId: 'r2', pane: 'artifact', target: 'dash', at: { version: 3 } });
      await settle();
      expect(probe.opens.map((open) => open.params)).toEqual([{ target: DASH, location: { version: 3 } }]);
      show(fake, { requestId: 'r3', pane: 'artifact', at: { slide: 's1' } });
      await settle();
      expect(probe.opens.map((open) => open.params).at(-1)).toEqual({});
      expect(fake.invoked('maws.pane.answer').map((answer) => (answer as { result: { ok: boolean } }).result.ok)).toEqual([true, true, true]);
    });

    it('the handle the agent named it by finds it', async () => {
      const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
      registerPanelTool(tool);
      show(fake, { pane: 'artifact', target: 'dash' });
      await settle();
      expect(fake.invoked('artifacts.get')).toEqual([]); // not an id: the host is not asked to read one
      expect(fake.invoked('artifacts.list')).toEqual([{ filter: { appSessionId: A } }]);
      expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH }]);
    });

    it('a handle shaped like a uuid is still found among the handles when no artifact has that id', async () => {
      const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
      registerPanelTool(tool);
      const shaped = '00000000-0000-4000-8000-0000000000aa';
      disconnect();
      fake = fakeClient({ 'maws.pane.answer': { outcome: 'delivered' }, 'artifacts.get': { artifact: null }, 'artifacts.list': { artifacts: [made(DASH, A, shaped)] } });
      disconnect = connectPaneShows(fake.client);
      show(fake, { pane: 'artifact', target: shaped });
      await settle();
      expect(fake.invoked('artifacts.get')).toEqual([{ artifactId: shaped }]);
      expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH }]);
    });

    it('a refused read answers artifactUnreadable with the host’s message, nothing opened', async () => {
      const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
      registerPanelTool(tool);
      disconnect();
      fake = fakeClient({ 'maws.pane.answer': { outcome: 'delivered' } });
      disconnect = connectPaneShows(fake.client);
      show(fake, { pane: 'artifact', target: DASH });
      await settle();
      await fake.fail('artifacts.get', 'unavailable');
      await settle();
      expect(probe.created).toEqual([]);
      expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.artifactUnreadable(DASH, 'unavailable') } }]);
    });

    it('a target no artifact answers to: artifactNotFound, nothing opened', async () => {
      const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
      registerPanelTool(tool);
      const missing = '00000000-0000-4000-8000-000000000009';
      show(fake, { pane: 'artifact', target: missing });
      show(fake, { pane: 'artifact', target: 'none', requestId: 'r2' });
      await settle();
      expect(probe.created).toEqual([]);
      // the two answers in whichever order their reads settle (the uuid is read, then searched for among the handles)
      const answers = fake.invoked('maws.pane.answer') as { requestId: string }[];
      expect([...answers].sort((a, b) => a.requestId.localeCompare(b.requestId))).toEqual([
        { appSessionId: A, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.artifactNotFound(missing) } },
        { appSessionId: A, requestId: 'r2', result: { ok: false, error: TOOL_ERRORS.artifactNotFound('none') } },
      ]);
    });

    it('no target opens the list', async () => {
      const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
      registerPanelTool(tool);
      show(fake, { pane: 'artifact', target: null });
      await settle();
      expect(probe.created.map((init) => init.params)).toEqual([{}]);
      expect(fake.invoked('maws.pane.answer')[0]).toMatchObject({ result: { ok: true, opened: { kind: 'panel-tool', toolId: 'artifacts' } } });
    });

    // P2-F L122: a side thread's handle resolves over its ancestor chain, nearest first, as its artifact tools do
    // (`artifactScopeOf`); the artifact found opens in the thread's own panel.
    describe('from a side thread (P2-F L122)', () => {
      const THREAD_OWN = '00000000-0000-4000-8000-000000000002';
      const threadOf = (parent: AppSessionId): Lineage => ({ kind: 'side-thread', parentAppSessionId: parent, parentEngineSessionId: null, openedBy: 'comment' });
      // C is a thread of B, a thread of root A; each session made the artifacts given. `archived` sessions are in main's
      // index (`session.get` answers them) but not in the window's records: the window's feed lists unarchived sessions.
      const holding = (held: Partial<Record<AppSessionId, ReturnType<typeof made>[]>>, archived: AppSessionId[] = []) => {
        const index = new Map(useSessions.getState().records);
        index.set(B, { ...index.get(B)!, lineage: threadOf(A) });
        index.set(C, { ...index.get(C)!, lineage: threadOf(B) });
        useSessions.setState({ records: new Map([...index].filter(([id]) => !archived.includes(id))) });
        disconnect();
        fake = fakeClient({
          'maws.pane.answer': { outcome: 'delivered' },
          'session.get': (input: { appSessionId: AppSessionId }) => index.get(input.appSessionId) ?? null,
          'artifacts.get': (input: { artifactId: string }) => ({ artifact: Object.values(held).flat().find((one) => one!.id === input.artifactId) ?? null }),
          'artifacts.list': (input: { filter: { appSessionId: AppSessionId } }) => ({ artifacts: held[input.filter.appSessionId] ?? [] }),
        });
        disconnect = connectPaneShows(fake.client);
      };

      it("a thread's target its parent made opens in the thread's panel, by id or by handle", async () => {
        const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
        registerPanelTool(tool);
        holding({ [A]: [artifact] });
        show(fake, { appSessionId: B, pane: 'artifact', target: DASH });
        await settle();
        show(fake, { appSessionId: B, pane: 'artifact', target: 'dash', requestId: 'r2' });
        await settle();
        expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH }]); // the second call reuses the one tab
        expect(fake.invoked('artifacts.get')).toEqual([{ artifactId: DASH }]);
        expect(fake.invoked('artifacts.list')).toEqual([{ filter: { appSessionId: B } }, { filter: { appSessionId: A } }]);
        const [opened] = panelOf(B)!.tabs;
        const answer = { ok: true, opened: { kind: 'panel-tool', toolId: 'artifacts', tabId: opened!.id, title: 'Artifacts' } };
        expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: B, requestId: 'r1', result: answer }, { appSessionId: B, requestId: 'r2', result: answer }]);
      });

      it("a thread of a thread reaches the family root's artifact", async () => {
        const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
        registerPanelTool(tool);
        holding({ [A]: [artifact] });
        show(fake, { appSessionId: C, pane: 'artifact', target: 'dash' });
        await settle();
        expect(fake.invoked('artifacts.list')).toEqual([{ filter: { appSessionId: C } }, { filter: { appSessionId: B } }, { filter: { appSessionId: A } }]);
        expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH }]);
      });

      it("the nearest session that made an artifact of the handle owns it: the thread's own before its parent's", async () => {
        const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
        registerPanelTool(tool);
        holding({ [A]: [artifact], [B]: [made(THREAD_OWN, B)] });
        show(fake, { appSessionId: B, pane: 'artifact', target: 'dash' });
        await settle();
        expect(fake.invoked('artifacts.list')).toEqual([{ filter: { appSessionId: B } }]);
        expect(probe.created.map((init) => init.params)).toEqual([{ target: THREAD_OWN }]);
      });

      it("a handle a session is only linked to (not its maker) is not that session's: the maker's is found", async () => {
        const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
        registerPanelTool(tool);
        holding({ [A]: [artifact], [B]: [artifact] }); // B edited A's page: linked, but A made it
        show(fake, { appSessionId: B, pane: 'artifact', target: 'dash' });
        await settle();
        expect(fake.invoked('artifacts.list')).toEqual([{ filter: { appSessionId: B } }, { filter: { appSessionId: A } }]);
        expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH }]);
      });

      // review fix: an archived intermediate thread is read from main's index, so the chain still reaches the family root
      // as the host's artifact tools see it (archiving B leaves its thread C active)
      it("an archived intermediate thread missing from the window's records is read through session.get; the root's artifact is found", async () => {
        const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
        registerPanelTool(tool);
        holding({ [A]: [artifact] }, [B]);
        show(fake, { appSessionId: C, pane: 'artifact', target: 'dash' });
        await settle();
        expect(fake.invoked('session.get')).toEqual([{ appSessionId: B }]);
        expect(fake.invoked('artifacts.list')).toEqual([{ filter: { appSessionId: C } }, { filter: { appSessionId: B } }, { filter: { appSessionId: A } }]);
        expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH }]);
      });

      it("an ancestor main's index does not hold ends the chain there, as main's own walk does", async () => {
        const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
        registerPanelTool(tool);
        holding({ [A]: [artifact] }, [B]);
        disconnect();
        fake = fakeClient({ 'maws.pane.answer': { outcome: 'delivered' }, 'session.get': null, 'artifacts.list': { artifacts: [] } });
        disconnect = connectPaneShows(fake.client);
        show(fake, { appSessionId: C, pane: 'artifact', target: 'dash' });
        await settle();
        expect(fake.invoked('artifacts.list')).toEqual([{ filter: { appSessionId: C } }, { filter: { appSessionId: B } }]);
        expect(probe.created).toEqual([]);
        expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: C, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.artifactNotFound('dash') } }]);
      });

      it('a target no session of the chain holds is artifactNotFound; a root session reads only its own', async () => {
        const { tool, probe } = probeTool('artifacts', { title: 'Artifacts', multiInstance: false });
        registerPanelTool(tool);
        holding({});
        show(fake, { appSessionId: C, pane: 'artifact', target: 'none' });
        await settle();
        expect(fake.invoked('artifacts.list')).toEqual([{ filter: { appSessionId: C } }, { filter: { appSessionId: B } }, { filter: { appSessionId: A } }]);
        show(fake, { appSessionId: A, pane: 'artifact', target: 'none', requestId: 'r2' });
        await settle();
        expect(fake.invoked('artifacts.list')).toEqual([{ filter: { appSessionId: C } }, { filter: { appSessionId: B } }, { filter: { appSessionId: A } }, { filter: { appSessionId: A } }]);
        expect(probe.created).toEqual([]);
        expect(fake.invoked('maws.pane.answer')).toEqual([
          { appSessionId: C, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.artifactNotFound('none') } },
          { appSessionId: A, requestId: 'r2', result: { ok: false, error: TOOL_ERRORS.artifactNotFound('none') } },
        ]);
      });
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
// Settings dialog, and what it brings forward is in front of the strip behind them; across the artifact's lookup the
// origin travels with the call, so the person's act in between closes the page as usual and the late add leaves it so.
describe('show_pane behind a page (UX wave U7b)', () => {
  const PAGE = { kind: 'projects' } as const;
  const DASH = '00000000-0000-4000-8000-000000000002';

  it('file: its tab is in front of the strip, and the page and the dialog stay', async () => {
    useLayout.getState().openDestination(PAGE);
    useLayout.getState().openSettings();
    show(fake, { pane: 'file', target: '/repo/src/b.ts', line: 1 });
    await settle();
    expect(activeTab(useLayout.getState().main)).toMatchObject({ kind: 'file', path: '/repo/src/b.ts' });
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

  describe('across the artifact’s lookup', () => {
    beforeEach(() => {
      disconnect();
      fake = fakeClient({ 'maws.pane.answer': { outcome: 'delivered' } }); // `artifacts.get` waits for the test's reply
      disconnect = connectPaneShows(fake.client);
      registerPanelTool(probeTool('artifacts', { title: 'Artifacts', multiInstance: false }).tool);
    });
    const artifact = { id: DASH, kind: 'html', title: 'Dashboard', handle: 'dash', createdBy: { kind: 'session', appSessionId: B }, createdAt: 1, updatedAt: 2, lastViewedAt: null, pinned: false, agentEditsAsSuggestions: false, revision: 3 };

    it('the add that arrives after the read leaves the page open', async () => {
      useLayout.getState().openDestination(PAGE);
      show(fake, { appSessionId: B, pane: 'artifact', target: DASH });
      await settle();
      expect(fake.pending('artifacts.get')).toBe(1);
      await fake.reply('artifacts.get', { artifact });
      expect(panelOf(B)!.tabs.map((tab) => tab.toolId)).toEqual(['artifacts']);
      expect(activeTab(useLayout.getState().main)?.id).toBe(`session:${B}`);
      expect(useLayout.getState().destination).toEqual(PAGE);
    });

    it('a session’s row clicked while the read is out closes the page, and the add that then arrives leaves it closed', async () => {
      useLayout.getState().openDestination(PAGE);
      show(fake, { appSessionId: B, pane: 'artifact', target: DASH });
      await settle();
      useLayout.getState().openSession(C); // the person's act
      expect(useLayout.getState().destination).toBeNull();
      await fake.reply('artifacts.get', { artifact });
      expect(panelOf(B)!.tabs.map((tab) => tab.toolId)).toEqual(['artifacts']);
      expect(useLayout.getState().destination).toBeNull();
    });
  });
});
