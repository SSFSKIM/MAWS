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
    expect(tab).toMatchObject({ kind: 'file', path: '/repo/src/a.ts', line: 3, appSessionId: A });
    expect(fake.invoked('maws.pane.answer')).toEqual([
      { appSessionId: A, requestId: 'r1', result: { ok: true, opened: { kind: 'main-tab', tabId: tabId({ kind: 'file', path: '/repo/src/a.ts', line: 3, appSessionId: A }), path: '/repo/src/a.ts', line: 3 } } },
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

  it('deliverable with no deliverables tool registered: the host’s "not available in this build" text, nothing opened', async () => {
    show(fake, { pane: 'deliverable', target: 'none' });
    await settle();
    expect(panelOf(A)?.tabs ?? []).toEqual([]);
    expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.paneUnavailable('deliverable') } }]);
  });

  // E2 (Design §4 "show_pane 'deliverable'"): the target is resolved through main before anything opens, so the model
  // reads that its id was wrong rather than "shown" over a list.
  describe('deliverable (E2)', () => {
    const DASH = '00000000-0000-4000-8000-000000000001';
    const record = { id: DASH, appSessionId: A, kind: 'artifact', artifactId: 'dash', path: '/u/v1.html', title: 'Dashboard', versions: [{ path: '/u/v1.html', at: 't' }], createdAt: 't' };
    beforeEach(() => {
      disconnect();
      fake = fakeClient({
        'maws.pane.answer': { outcome: 'delivered' },
        'deliverables.get': (input: { id: string }) => (input.id === DASH ? { record, present: [true] } : { record: null, present: [] }),
        'deliverables.list': { records: [record] },
      });
      disconnect = connectPaneShows(fake.client);
    });

    it('a recorded target opens the Deliverables tool on it and answers panel-tool', async () => {
      const { tool, probe } = probeTool('deliverables', { title: 'Deliverables', multiInstance: false });
      registerPanelTool(tool);
      show(fake, { pane: 'deliverable', target: DASH });
      await settle();
      expect(fake.invoked('deliverables.get')).toEqual([{ appSessionId: A, id: DASH }]);
      expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH, appSessionId: A }]); // the session named, so a pinned tab follows it
      const [opened] = panelOf(A)!.tabs;
      expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: true, opened: { kind: 'panel-tool', toolId: 'deliverables', tabId: opened!.id, title: 'Deliverables' } } }]);
    });

    it('an artifact’s own id finds its record', async () => {
      const { tool, probe } = probeTool('deliverables', { title: 'Deliverables', multiInstance: false });
      registerPanelTool(tool);
      show(fake, { pane: 'deliverable', target: 'dash' });
      await settle();
      expect(fake.invoked('deliverables.get')).toEqual([]); // not a record id: main is not asked to read it
      expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH, appSessionId: A }]);
    });

    it('an artifact id shaped like a uuid is still found by the artifact search when no record has that id', async () => {
      const { tool, probe } = probeTool('deliverables', { title: 'Deliverables', multiInstance: false });
      registerPanelTool(tool);
      const shaped = '00000000-0000-4000-8000-0000000000aa';
      disconnect();
      fake = fakeClient({
        'maws.pane.answer': { outcome: 'delivered' },
        'deliverables.get': { record: null, present: [] },
        'deliverables.list': { records: [{ ...record, artifactId: shaped }] },
      });
      disconnect = connectPaneShows(fake.client);
      show(fake, { pane: 'deliverable', target: shaped });
      await settle();
      expect(fake.invoked('deliverables.get')).toEqual([{ appSessionId: A, id: shaped }]);
      expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH, appSessionId: A }]);
    });

    it('a refused read answers deliverableUnreadable with main’s message, nothing opened', async () => {
      const { tool, probe } = probeTool('deliverables', { title: 'Deliverables', multiInstance: false });
      registerPanelTool(tool);
      disconnect();
      fake = fakeClient({ 'maws.pane.answer': { outcome: 'delivered' } });
      disconnect = connectPaneShows(fake.client);
      show(fake, { pane: 'deliverable', target: DASH });
      await settle();
      await fake.fail('deliverables.get', 'EACCES');
      await settle();
      expect(probe.created).toEqual([]);
      expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.deliverableUnreadable(DASH, 'EACCES') } }]);
    });

    it('a target no record answers to: deliverableNotFound, nothing opened', async () => {
      const { tool, probe } = probeTool('deliverables', { title: 'Deliverables', multiInstance: false });
      registerPanelTool(tool);
      const missing = '00000000-0000-4000-8000-000000000009';
      show(fake, { pane: 'deliverable', target: missing });
      show(fake, { pane: 'deliverable', target: 'none', requestId: 'r2' });
      await settle();
      expect(probe.created).toEqual([]);
      // the two answers in whichever order their reads settle (the uuid is read, then searched for as an artifact id)
      const answers = fake.invoked('maws.pane.answer') as { requestId: string }[];
      expect([...answers].sort((a, b) => a.requestId.localeCompare(b.requestId))).toEqual([
        { appSessionId: A, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.deliverableNotFound(missing) } },
        { appSessionId: A, requestId: 'r2', result: { ok: false, error: TOOL_ERRORS.deliverableNotFound('none') } },
      ]);
    });

    it('no target opens the list', async () => {
      const { tool, probe } = probeTool('deliverables', { title: 'Deliverables', multiInstance: false });
      registerPanelTool(tool);
      show(fake, { pane: 'deliverable', target: null });
      await settle();
      expect(probe.created.map((init) => init.params)).toEqual([{}]);
      expect(fake.invoked('maws.pane.answer')[0]).toMatchObject({ result: { ok: true, opened: { kind: 'panel-tool', toolId: 'deliverables' } } });
    });

    // P2-F L122: a side thread's target resolves over its ancestor chain, nearest first, as its artifact tools do
    // (`artifactScopeOf`); the record found opens under the session that holds it, in the thread's own panel.
    describe('from a side thread (P2-F L122)', () => {
      const THREAD_OWN = '00000000-0000-4000-8000-000000000002';
      const threadOf = (parent: AppSessionId): Lineage => ({ kind: 'side-thread', parentAppSessionId: parent, parentEngineSessionId: null, openedBy: 'comment' });
      // C is a thread of B, a thread of root A; each session holds the records given
      const holding = (held: Partial<Record<AppSessionId, (typeof record)[]>>) => {
        const records = new Map(useSessions.getState().records);
        records.set(B, { ...records.get(B)!, lineage: threadOf(A) });
        records.set(C, { ...records.get(C)!, lineage: threadOf(B) });
        useSessions.setState({ records });
        disconnect();
        fake = fakeClient({
          'maws.pane.answer': { outcome: 'delivered' },
          'deliverables.get': (input: { appSessionId: AppSessionId; id: string }) => {
            const found = held[input.appSessionId]?.find((one) => one.id === input.id);
            return found ? { record: found, present: [true] } : { record: null, present: [] };
          },
          'deliverables.list': (input: { appSessionId: AppSessionId }) => ({ records: held[input.appSessionId] ?? [] }),
        });
        disconnect = connectPaneShows(fake.client);
      };

      it("a thread's target held by its parent opens the parent's record in the thread's panel", async () => {
        const { tool, probe } = probeTool('deliverables', { title: 'Deliverables', multiInstance: false });
        registerPanelTool(tool);
        holding({ [A]: [record] });
        show(fake, { appSessionId: B, pane: 'deliverable', target: DASH });
        await settle();
        show(fake, { appSessionId: B, pane: 'deliverable', target: 'dash', requestId: 'r2' });
        await settle();
        expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH, appSessionId: A }]); // the second call reuses the one tab
        expect(fake.invoked('deliverables.get')).toEqual([{ appSessionId: B, id: DASH }, { appSessionId: A, id: DASH }]);
        expect(fake.invoked('deliverables.list')).toEqual([{ appSessionId: B }, { appSessionId: B }, { appSessionId: A }]);
        const [opened] = panelOf(B)!.tabs;
        const answer = { ok: true, opened: { kind: 'panel-tool', toolId: 'deliverables', tabId: opened!.id, title: 'Deliverables' } };
        expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: B, requestId: 'r1', result: answer }, { appSessionId: B, requestId: 'r2', result: answer }]);
      });

      it("a thread of a thread reaches the family root's record", async () => {
        const { tool, probe } = probeTool('deliverables', { title: 'Deliverables', multiInstance: false });
        registerPanelTool(tool);
        holding({ [A]: [record] });
        show(fake, { appSessionId: C, pane: 'deliverable', target: 'dash' });
        await settle();
        expect(fake.invoked('deliverables.list')).toEqual([{ appSessionId: C }, { appSessionId: B }, { appSessionId: A }]);
        expect(probe.created.map((init) => init.params)).toEqual([{ target: DASH, appSessionId: A }]);
      });

      it("the nearest session holding the artifact id owns it: the thread's own before its parent's", async () => {
        const { tool, probe } = probeTool('deliverables', { title: 'Deliverables', multiInstance: false });
        registerPanelTool(tool);
        holding({ [A]: [record], [B]: [{ ...record, id: THREAD_OWN, appSessionId: B }] });
        show(fake, { appSessionId: B, pane: 'deliverable', target: 'dash' });
        await settle();
        expect(fake.invoked('deliverables.list')).toEqual([{ appSessionId: B }]);
        expect(probe.created.map((init) => init.params)).toEqual([{ target: THREAD_OWN, appSessionId: B }]);
      });

      it('a target no session of the chain holds is deliverableNotFound; a root session reads only its own', async () => {
        const { tool, probe } = probeTool('deliverables', { title: 'Deliverables', multiInstance: false });
        registerPanelTool(tool);
        holding({});
        show(fake, { appSessionId: C, pane: 'deliverable', target: 'none' });
        await settle();
        expect(fake.invoked('deliverables.list')).toEqual([{ appSessionId: C }, { appSessionId: B }, { appSessionId: A }]);
        show(fake, { appSessionId: A, pane: 'deliverable', target: 'none', requestId: 'r2' });
        await settle();
        expect(fake.invoked('deliverables.list')).toEqual([{ appSessionId: C }, { appSessionId: B }, { appSessionId: A }, { appSessionId: A }]);
        expect(probe.created).toEqual([]);
        expect(fake.invoked('maws.pane.answer')).toEqual([
          { appSessionId: C, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.deliverableNotFound('none') } },
          { appSessionId: A, requestId: 'r2', result: { ok: false, error: TOOL_ERRORS.deliverableNotFound('none') } },
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
  // is the model's error to read before anything opens; a valid one (as parsed) or none opens the Browser tool with the
  // session and the request's own id, so a pinned tool showing another session opens the tab in this one (P-21) and two
  // windows handling one request reach one tab in main.
  describe('browser (E4a)', () => {
    const browserTool = () => {
      const { tool, probe } = probeTool('browser', { title: 'Browser', multiInstance: false });
      registerPanelTool(tool);
      return probe;
    };

    it('a valid target opens the Browser tool on it, parsed, with the session and the request id', async () => {
      const probe = browserTool();
      show(fake, { pane: 'browser', target: 'https://Example.com' });
      await settle();
      expect(probe.created.map((init) => init.params)).toEqual([{ target: 'https://example.com/', appSessionId: A, requestId: 'r1' }]);
      const [opened] = panelOf(A)!.tabs;
      expect(fake.invoked('maws.pane.answer')).toEqual([{ appSessionId: A, requestId: 'r1', result: { ok: true, opened: { kind: 'panel-tool', toolId: 'browser', tabId: opened!.id, title: 'Browser' } } }]);
    });

    it('a refused target answers navigationRefused, nothing opened', async () => {
      const probe = browserTool();
      show(fake, { pane: 'browser', target: 'file:///etc/hosts' });
      show(fake, { pane: 'browser', target: 'wikipedia.org', requestId: 'r2' });
      await settle();
      expect(probe.created).toEqual([]);
      expect(fake.invoked('maws.pane.answer')).toEqual([
        { appSessionId: A, requestId: 'r1', result: { ok: false, error: TOOL_ERRORS.navigationRefused('file:///etc/hosts') } },
        { appSessionId: A, requestId: 'r2', result: { ok: false, error: TOOL_ERRORS.navigationRefused('wikipedia.org') } },
      ]);
    });

    it('no target opens the tool on the session’s own state, with the session and the request id', async () => {
      const probe = browserTool();
      show(fake, { pane: 'browser', target: null });
      await settle();
      expect(probe.created.map((init) => init.params)).toEqual([{ appSessionId: A, requestId: 'r1' }]);
      expect(fake.invoked('maws.pane.answer')[0]).toMatchObject({ result: { ok: true, opened: { kind: 'panel-tool', toolId: 'browser' } } });
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
